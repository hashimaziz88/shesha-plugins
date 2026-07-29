import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flatten, CHILD_KEYS } from './walk.mjs';
import { requiredNodes } from './flow.mjs';
import { isSplitWidthValue } from './expand-style.mjs';

// ---------------------------------------------------------------------------
// Default theme tokens — loaded lazily, only when a caller doesn't supply
// its own `tokens`. Mirrors compile-spec.mjs's own default-path pattern:
// validate-form.mjs's CLI (which this check ultimately runs under) has no
// `--tokens` flag and never will (it is on the "do not modify" list for this
// task), so T2-STYLE-OFF-TOKEN resolving "the active theme" on its own,
// falling back to the project's default brand, is what makes it usable from
// that CLI at all rather than only from callers sophisticated enough to pass
// tokens explicitly.
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOKENS_PATH = join(HERE, '../../../shesha-design-system/assets/themes/shesha.tokens.json');

let cachedDefaultTokens;
function loadDefaultTokens() {
  if (cachedDefaultTokens !== undefined) return cachedDefaultTokens;
  try {
    cachedDefaultTokens = existsSync(DEFAULT_TOKENS_PATH) ? JSON.parse(readFileSync(DEFAULT_TOKENS_PATH, 'utf8')) : {};
  } catch {
    cachedDefaultTokens = {};
  }
  return cachedDefaultTokens;
}

/**
 * Tier 2 — contract checks.
 *
 * These encode the project's CONSTRUCTION rules — things a human reviewer (or
 * `form-quality.md`) would flag by reading the markup, not render crashes.
 * Every finding is `severity: 'fail'`, except the two checks that need input
 * this function was not given (`archetype`, `knownForms`): those emit a
 * `T2-SKIPPED` finding (`severity: 'skip'`) instead of guessing, because a
 * wrong guess (especially of archetype) produces a wall of false failures
 * that would get the whole validator disabled.
 *
 * @param {object} markup - A form's markup object ({ components: [...], formSettings: {...} }).
 * @param {{
 *   registry: object,
 *   roles: object,
 *   tokens?: object,
 *   flows?: Record<string, object>,
 *   archetype?: string,
 *   knownForms?: Array<{module: string, name: string}>,
 * }} opts
 * @returns {Finding[]}
 */
export function tier2(markup, { registry, roles, tokens, flows, archetype, knownForms } = {}) {
  const out = [];
  const components = Array.isArray(markup?.components) ? markup.components : [];
  const entries = flatten(components);
  const themeTokenColors = collectThemeTokenColors(tokens ?? loadDefaultTokens());

  // --- Whole-tree / whole-form checks ---
  checkColumnsPresent(entries, out);
  checkValidationErrorsMissing(entries, out);
  checkSubmitWiring(entries, out);
  checkExitMissing(entries, out);
  checkModelTypeShape(markup, entries, out);
  checkFlowIncomplete(entries, { archetype, flows }, out);
  checkDanglingFormRef(entries, { knownForms }, out);
  checkRowListNoVGap(entries, out);
  checkDuplicateCaption(entries, out);
  checkLabelColVsNarrowRow(markup, entries, out);

  // --- Per-node checks ---
  const isDetailForm = hasDetailLifecycle(entries);
  for (const { node, ctx } of entries) {
    const comp = registry?.components?.[node.type];

    if (node.type === 'container') {
      checkFlexNoDisplay(node, ctx, out);
      checkNoDefaultStylingDropsStyle(node, ctx, out);
      checkStyleIncomplete(node, ctx, registry, out);
      checkFlexChildNotContainer(node, ctx, out);
      checkStyleOffToken(node, ctx, themeTokenColors, out);
    } else {
      checkWidthOnNonContainer(node, ctx, out);
      checkSplitWidthOnLeaf(node, ctx, out);
    }

    checkLooseButton(node, ctx, out);
    checkPropertyNameCase(node, ctx, out);
    checkDropdownSource(node, ctx, out);
    checkDateComponent(node, ctx, out);
    checkEditModeMismatch(node, ctx, comp, isDetailForm, out);
    checkDataContextProps(node, ctx, out);
    checkSlotStyleMismatch(node, ctx, out);
    checkCodemodeTitle(node, ctx, out);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function finding(code, path, message, expected, actual) {
  return { tier: 2, code, severity: 'fail', path, message, expected, actual };
}

function skipFinding(path, message) {
  return { tier: 2, code: 'T2-SKIPPED', severity: 'skip', path, message, expected: null, actual: null };
}

const STRUCTURAL_KEYS = new Set(CHILD_KEYS);
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nodeLabel(node) {
  return node.propertyName ?? node.componentName ?? node.id ?? '(unnamed)';
}

// A container's flex properties (display/flexDirection/flexWrap/gap/
// justifyContent/alignItems) are set UN-nested at the top level of the node
// (verified against tests/fixtures/t1-clean.json and the brief's own test
// fixtures), while dimensions/border/background/shadow/stylingBox are
// nested per-breakpoint under desktop/tablet/mobile (verified against
// assets/examples/employee-create.json, and the shape roles.styles.json
// resolves to). Some fully-styled components duplicate the flex props again
// inside each breakpoint block. This view merges both: the breakpoint block
// (if any) overrides the top-level fallback, so a check works whichever shape
// the markup uses.
const FLEX_PROP_NAMES = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];
const STYLE_BLOCK_NAMES = ['dimensions', 'stylingBox', 'border', 'background', 'shadow'];

function bpView(node, bp) {
  const merged = {};
  for (const key of [...FLEX_PROP_NAMES, ...STYLE_BLOCK_NAMES]) {
    if (node[key] !== undefined) merged[key] = node[key];
  }
  const nested = isPlainObject(node[bp]) ? node[bp] : {};
  return { ...merged, ...nested };
}

function hasPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return cur !== undefined;
}

// ---------------------------------------------------------------------------
// buttonGroup item collection (shared by SUBMIT-WIRING, EXIT-MISSING,
// LOOSE-BUTTON-adjacent checks, FLOW-INCOMPLETE). buttonGroup items live in
// `items[]` but carry no top-level `type`, so walk.mjs's flatten() does not
// visit them as their own nodes (same as tier1's datatable-column handling).
// ---------------------------------------------------------------------------

function collectButtonGroupItems(entries) {
  const out = [];
  for (const { node, ctx } of entries) {
    if (node.type === 'buttonGroup' && Array.isArray(node.items)) {
      node.items.forEach((item, idx) => {
        if (isPlainObject(item)) out.push({ item, path: `${ctx.path}.items[${idx}]`, groupPath: ctx.path });
      });
    }
  }
  return out;
}

function hasAction(items, actionName, actionOwner) {
  return items.some(({ item }) => {
    const ac = item.actionConfiguration;
    return isPlainObject(ac) && ac.actionName === actionName && ac.actionOwner === actionOwner;
  });
}

function hasDetailLifecycle(entries) {
  return hasAction(collectButtonGroupItems(entries), 'Start Edit', 'shesha.form');
}

// ---------------------------------------------------------------------------
// T2-COLUMNS-PRESENT
// ---------------------------------------------------------------------------

function checkColumnsPresent(entries, out) {
  for (const { node, ctx } of entries) {
    if (node.type === 'columns') {
      out.push(finding(
        'T2-COLUMNS-PRESENT',
        ctx.path,
        `"columns" component found at ${ctx.path} — field groups split via a flex "container" row (each child sized by its own dimensions.width), never the "columns" layout component.`,
        'a flex container split (sibling containers each carrying dimensions.width)',
        'columns',
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T2-FLEXCHILD-NOT-CONTAINER / T2-WIDTH-ON-NONCONTAINER
// ---------------------------------------------------------------------------

const ROW_LIKE = new Set(['row', 'row-reverse']);

function isFlexRow(node) {
  const view = bpView(node, 'desktop');
  return view.display === 'flex' && ROW_LIKE.has(view.flexDirection);
}

function checkFlexChildNotContainer(node, ctx, out) {
  if (!isFlexRow(node)) return;
  const children = Array.isArray(node.components) ? node.components : [];
  children.forEach((child, idx) => {
    if (isPlainObject(child) && typeof child.type === 'string' && child.type !== 'container') {
      out.push(finding(
        'T2-FLEXCHILD-NOT-CONTAINER',
        `${ctx.path}.components[${idx}]`,
        `"${child.type}" is a direct child of flex-row container "${nodeLabel(node)}" but is not itself a "container" — a flex container has two DOM nodes (dimensions/border/background/shadow on the outer div, display/flexDirection/gap on the inner div), so only a container child is sized correctly by its own dimensions.width; a bare input's dimensions.width instead resizes inside its antd Form.Item wrapper (see T2-WIDTH-ON-NONCONTAINER).`,
        'type: "container"',
        child.type,
      ));
    }
  });
}

// Scoped apart from T2-SPLIT-WIDTH-ON-LEAF (task 8): a PROPORTIONAL width
// (%, calc()) on a leaf is that check's exclusive territory now — see this
// file's header-adjacent note near checkSplitWidthOnLeaf for the full
// supersede-vs-scope-apart reasoning. This check keeps its original scope
// (any OTHER width value: fixed px/em/rem/vw/auto/etc — a "190px toolbar
// filter" is the canonical benign example) so the two never double-report
// the same node/path under two codes.
function checkWidthOnNonContainer(node, ctx, out) {
  if (node.type === 'container') return;
  for (const bp of BREAKPOINTS) {
    const w = node[bp]?.dimensions?.width;
    // "100%" is excluded too, not just split values: it is the literal
    // end-state T2-SPLIT-WIDTH-ON-LEAF's own fix stamps onto a leaf (task 8)
    // — flagging it here would mean the two checks' fixed points can never
    // both be satisfied at once for the same node.
    if (w !== undefined && w !== '100%' && !isSplitWidthValue(w)) {
      out.push(finding(
        'T2-WIDTH-ON-NONCONTAINER',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") sets ${bp}.dimensions.width: ${JSON.stringify(w)} — non-container components render inside an antd Form.Item chain (.ant-row/.ant-form-item-row/.ant-form-item-control*) forced to width:100% !important, so this resizes the ALREADY-100%-wide wrapper, not the field: two 50%-width siblings will NOT split 50/50.`,
        'no dimensions.width on a non-container type — size via a wrapping flex container instead',
        w,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T2-SPLIT-WIDTH-ON-LEAF (task 8)
//
// Narrower and more accurate than T2-WIDTH-ON-NONCONTAINER: only a
// PROPORTIONAL width (a percentage under 100, or any calc() expression) on a
// non-container leaf is the defect this check names — a fixed px/em/rem
// width on a leaf is inert-but-benign (T2-WIDTH-ON-NONCONTAINER's remaining
// scope), whereas a proportional width on a leaf is actively WRONG: the
// antd Form.Item chain forces the leaf's wrapper to width:100% !important,
// so "calc(50% - 6px)" resolves against that already-100%-wide box, not
// against the row — two such siblings render at their OWN intrinsic content
// width, never split 50/50 (measured: 257/285/247px rendered vs ~446px
// expected across the flight-* corpus, 62/69 inputs affected).
//
// SUPERSEDE vs SCOPE-APART decision (see task-8 report): scoped apart, not
// superseded. T2-WIDTH-ON-NONCONTAINER's existing Group-B classification and
// measured 19.9% corpus rate cover EVERY width value including deliberately
// benign fixed ones; collapsing it into this new, narrower check would lose
// that coverage. Instead T2-WIDTH-ON-NONCONTAINER was narrowed (above) to
// exclude proportional values, so the two codes partition the space
// (proportional vs everything else) instead of overlapping on the same node.
// ---------------------------------------------------------------------------

function checkSplitWidthOnLeaf(node, ctx, out) {
  if (node.type === 'container') return;
  for (const bp of BREAKPOINTS) {
    const w = node[bp]?.dimensions?.width;
    if (isSplitWidthValue(w)) {
      out.push(finding(
        'T2-SPLIT-WIDTH-ON-LEAF',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") sets ${bp}.dimensions.width: ${JSON.stringify(w)} — a PROPORTIONAL width (%, calc()) on a non-container leaf is inert: the antd Form.Item chain (.ant-row/.ant-form-item-row/.ant-form-item-control*) is forced width:100% !important around this leaf, so the proportional value only resizes that already-100%-wide inner box, never the flex track two siblings need to actually split. Wrap this leaf in its own container and put the proportional width THERE; set the leaf itself to "100%".`,
        'dimensions.width: "100%" on the leaf, with the proportional width instead on a wrapping container',
        w,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T2-FLEX-NO-DISPLAY
// ---------------------------------------------------------------------------

function checkFlexNoDisplay(node, ctx, out) {
  const bad = [];
  for (const bp of BREAKPOINTS) {
    const view = bpView(node, bp);
    const triggers = FLEX_PROP_NAMES.filter((p) => p !== 'display' && view[p] !== undefined);
    if (triggers.length && view.display !== 'flex') {
      bad.push({ bp, triggers, display: view.display });
    }
  }
  if (!bad.length) return;
  const bps = bad.map((b) => b.bp).join('/');
  const sample = bad[0];
  out.push(finding(
    'T2-FLEX-NO-DISPLAY',
    ctx.path,
    `Container "${nodeLabel(node)}" sets ${sample.triggers.join(', ')} (${bps}) but display is ${JSON.stringify(sample.display ?? null)}, not "flex" — getAlignmentStyle only emits gap/justifyContent/alignItems when direction === 'horizontal' || display !== 'block', and flexDirection/flexWrap only when display === 'flex'; without it these props are silently inert.`,
    'display: "flex"',
    sample.display ?? null,
  ));
}

// ---------------------------------------------------------------------------
// T2-NODEFAULTSTYLING-DROPS-STYLE
// ---------------------------------------------------------------------------

function checkNoDefaultStylingDropsStyle(node, ctx, out) {
  if (node.noDefaultStyling !== true) return;
  const carriers = new Set();
  for (const bp of BREAKPOINTS) {
    const view = bpView(node, bp);
    for (const key of ['dimensions', 'border', 'background', 'shadow']) {
      const v = view[key];
      if (v && (typeof v !== 'object' || Object.keys(v).length > 0)) carriers.add(`${bp}.${key}`);
    }
  }
  if (carriers.size) {
    out.push(finding(
      'T2-NODEFAULTSTYLING-DROPS-STYLE',
      ctx.path,
      `Container "${nodeLabel(node)}" sets noDefaultStyling: true while still carrying ${[...carriers].join(', ')} — noDefaultStyling removes the wrapper that renders these, so the values are dead weight at best and misleading to a future editor at worst.`,
      'no dimensions/border/background/shadow set when noDefaultStyling is true',
      [...carriers],
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-STYLE-INCOMPLETE
//
// The required set is DERIVED from the registry's container.props (never
// hand-typed), so a framework change that adds/removes a style channel can't
// silently shrink what this check demands.
// ---------------------------------------------------------------------------

const LAYOUT_PROP_NAMES = new Set(['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems', 'stylingBox']);

function requiredLayoutProps(registry) {
  const containerProps = registry?.components?.container?.props ?? [];
  return containerProps.filter((p) => LAYOUT_PROP_NAMES.has(p) || p.startsWith('dimensions.'));
}

function checkStyleIncomplete(node, ctx, registry, out) {
  const required = requiredLayoutProps(registry);
  if (!required.length) return;

  const missingEntries = [];
  let completeCount = 0;
  for (const prop of required) {
    const missingBps = BREAKPOINTS.filter((bp) => !hasPath(bpView(node, bp), prop));
    if (missingBps.length === 0) {
      completeCount++;
    } else {
      for (const bp of missingBps) missingEntries.push(`${bp}.${prop}`);
    }
  }

  if (missingEntries.length) {
    out.push(finding(
      'T2-STYLE-INCOMPLETE',
      ctx.path,
      `Container "${nodeLabel(node)}" is missing ${missingEntries.join(', ')} (${completeCount} of ${required.length} required layout props set) — every container must carry the full layout contract (display, flexDirection, flexWrap, gap, justifyContent, alignItems, all six dimensions.*, stylingBox) on each of desktop/tablet/mobile; a missing dimensions.minHeight in particular turns a squeezed container into a scrollbar, since container inner divs are hard-coded overflow:auto.`,
      `${required.length} required layout props (derived from registry container.props) on desktop/tablet/mobile`,
      missingEntries,
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-STYLE-OFF-TOKEN
//
// Scoped to `container` nodes' literal color values — verified every role in
// roles.styles.json has componentType: "container", so the container is the
// ONLY surface the design-system's token/role governance actually reaches;
// scoring every color on every leaf component (button item chrome, per-field
// AntD defaults, etc.) against "matches a token" would fire on ~100% of any
// real form and mean nothing (that overfire was measured directly against
// assets/examples/ before this scope narrowing — see the task-3 report). A
// `color` leaf that looks like a raw hex/rgb(a) literal must either be
// absent, or be recorded in a sibling `overrides[]` entry carrying measured
// provenance.
//
// Reconciled in task 7: this used to read a `styleOverrides[path] = {source,
// evidence}` object (task-3's own convention). The Phase 1 blueprint schema
// (../shesha-design-comprehension/assets/blueprint.schema.json) already
// defines the same concept as `overrides[] = {prop, value, source,
// evidence}` — older and more explicit (it also carries the literal `value`,
// not just the path). Rather than have two shapes for one concept across
// artifacts that must interoperate, this check now reads `node.overrides[]`
// (matched by `.prop`); the normalizer (scripts/normalize-form.mjs) migrates
// any markup still carrying the legacy `styleOverrides` shape forward.
// scripts/lib/tier3.mjs's T3-RAW-HEX was ALSO reconciled to this same
// `overrides[]` shape (see its own header comment) — both consumers of the
// override concept now agree on one shape.
//
// Made THEME-AWARE in the Phase 3 compiler-placement pass: `resolveRole`
// (shesha-design-system) legitimately resolves a role's token references
// down to literal hex ("$roles.pageBg" -> "palette.surfaces.canvas" ->
// "#F8F8F9") — that is what resolution IS, not a defect. The check used to
// have no way to tell such a governed literal apart from an ad hoc
// copy-pasted hex, which forced the compiler to self-stamp synthetic
// `overrides[]` provenance onto every role-derived color just to survive
// this check — forging the exact "this is a measured deviation" record
// `overrides[]` exists to guarantee is real. The fix belongs here: this
// check now loads the active theme's token file (`tokens`, defaulting to
// shesha.tokens.json when a caller doesn't supply one — see
// `loadDefaultTokens` above) and treats ANY literal color value that
// appears anywhere in that theme (not just in a role, but the theme's whole
// token tree — palette, statusLifecycle, $antdTheme, ...) as on-token by
// definition, with no override required. Only a hex/rgb(a) matching NO
// token in the active theme, and carrying no genuine `overrides[]`
// provenance, is still a finding — a raw hex that happens to equal a real
// design-system token is not a "copy-pasted accident" needing a paper
// trail; a hex nothing in the theme can explain still needs one.
// ---------------------------------------------------------------------------

const COLOR_LITERAL_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(/i;

// Corrected in Task 5: a literal color that exactly matches a value the
// FRAMEWORK'S OWN style migrator stamps on every component load — never a
// human's deliberate brand choice — does not need override provenance,
// because there was no design decision to justify. Verified against
// shesha-framework source: the container migrator
// (designer-components/container/containerComponent.tsx's v7 migrator,
// _common-migrations/migrateStyles.ts) hardcodes border color "#d9d9d9" and
// shadow color "#000"/"#000000" as unconditional fallbacks, mirrored
// identically into desktop/tablet/mobile — exactly the pattern measured in
// the corpus (82/100 forms, 30,188 T3-RAW-HEX instances, virtually all
// these three exact values). "#ffffff" for background.color carries the
// same evidence via the framework's initialStyles.ts default generator.
// Deliberately NOT included: font.color's corpus value ("#1a1a1a") has no
// confirmed framework-default origin, so it remains a live finding.
function isFrameworkDefaultColor(path, value) {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  const grandparent = parts[parts.length - 3];
  const v = value.toLowerCase();
  if (last === 'color' && parent === 'shadow' && (v === '#000' || v === '#000000')) return true;
  if (last === 'color' && parent === 'background' && v === '#ffffff') return true;
  if (last === 'color' && grandparent === 'border' && ['all', 'top', 'bottom', 'left', 'right'].includes(parent) && v === '#d9d9d9') return true;
  return false;
}

// Normalize a color-literal string for equality matching: lowercase, no
// internal whitespace (rgba(0, 59, 178, 0.2) vs rgba(0,59,178,0.2) are the
// same token either way this check will ever encounter it).
function normalizeColorForMatch(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!COLOR_LITERAL_RE.test(s) && !RGB_RE.test(s)) return null;
  return s.toLowerCase().replace(/\s+/g, '');
}

// Walk the ENTIRE active theme token document (not just roles.styles.json —
// palette, statusLifecycle badges, $antdTheme, anything else the theme
// carries) and collect every literal hex/rgb(a) value it contains anywhere,
// normalized for matching. This is "the active theme resolved into a flat
// set of known tokens" — a value equal to any of these is on-token by
// definition, per how `resolveRole` (shesha-design-system) actually
// resolves a role's token references down to these exact literals.
function collectThemeTokenColors(tokens) {
  const set = new Set();
  function visit(value) {
    if (typeof value === 'string') {
      const norm = normalizeColorForMatch(value);
      if (norm) set.add(norm);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isPlainObject(value)) {
      for (const v of Object.values(value)) visit(v);
    }
  }
  visit(tokens);
  return set;
}

function isOnToken(value, themeTokenColors) {
  const norm = normalizeColorForMatch(value);
  return norm !== null && themeTokenColors.has(norm);
}

function collectColorPaths(node) {
  const found = [];
  function visit(obj, path) {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (STRUCTURAL_KEYS.has(key) || key === 'overrides' || key === 'styleOverrides') continue;
      const value = obj[key];
      const p = path ? `${path}.${key}` : key;
      if (key === 'color' && typeof value === 'string' && (COLOR_LITERAL_RE.test(value) || RGB_RE.test(value))) {
        found.push({ path: p, value });
      } else if (isPlainObject(value)) {
        visit(value, p);
      }
    }
  }
  visit(node, '');
  return found;
}

function checkStyleOffToken(node, ctx, themeTokenColors, out) {
  if (node.type !== 'container') return;
  const colors = collectColorPaths(node);
  if (!colors.length) return;
  const overridesArr = Array.isArray(node.overrides) ? node.overrides : [];
  const overrideByProp = new Map(
    overridesArr.filter(isPlainObject).map((o) => [o.prop, o]),
  );
  for (const { path, value } of colors) {
    if (isFrameworkDefaultColor(path, value)) continue;
    if (isOnToken(value, themeTokenColors)) continue;
    const ov = overrideByProp.get(path);
    const covered = isPlainObject(ov) && typeof ov.source === 'string' && ov.source.length > 0
      && typeof ov.evidence === 'string' && ov.evidence.length > 0;
    if (!covered) {
      out.push(finding(
        'T2-STYLE-OFF-TOKEN',
        `${ctx.path}.${path}`,
        `"${node.type}" ("${nodeLabel(node)}") hardcodes ${path}: ${JSON.stringify(value)} — a literal color with no matching overrides[] entry ({ prop: "${path}", value, source, evidence }), so there is no way to tell a deliberate brand override from a copy-pasted hex.`,
        `a design-system role/token, or an overrides[] entry { prop: "${path}", value, source, evidence }`,
        value,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T2-VALIDATIONERRORS-MISSING
// ---------------------------------------------------------------------------

function checkValidationErrorsMissing(entries, out) {
  const hasRequired = entries.some(({ node }) => isPlainObject(node.validate) && node.validate.required === true);
  if (!hasRequired) return;
  const hasValidationErrors = entries.some(({ node }) => node.type === 'validationErrors');
  if (!hasValidationErrors) {
    out.push(finding(
      'T2-VALIDATIONERRORS-MISSING',
      'components',
      'The form has at least one field with validate.required: true but no "validationErrors" component anywhere in the tree — a failed submit renders nothing, so the form looks dead with no surfaced messages.',
      'a "validationErrors" component in the tree (conventionally just above the action row)',
      'none found',
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-SUBMIT-WIRING / T2-EXIT-MISSING
// ---------------------------------------------------------------------------

const SAVE_LABEL_RE = /\b(save|submit)\b/i;

function checkSubmitWiring(entries, out) {
  for (const { item, path } of collectButtonGroupItems(entries)) {
    const label = typeof item.label === 'string' ? item.label : '';
    if (!SAVE_LABEL_RE.test(label)) continue;
    const ac = item.actionConfiguration;
    const ok = isPlainObject(ac) && ac.actionName === 'Submit' && ac.actionOwner === 'shesha.form';
    if (!ok) {
      out.push(finding(
        'T2-SUBMIT-WIRING',
        path,
        `Save item "${label}" has actionConfiguration ${JSON.stringify(ac ?? null)} — the Save action must be exactly { actionName: "Submit", actionOwner: "shesha.form" } or the submit never fires.`,
        '{ actionName: "Submit", actionOwner: "shesha.form" }',
        ac ?? null,
      ));
    }
  }
}

const EXIT_MATCHERS = [
  { actionName: 'Navigate', actionOwner: 'shesha.common' },
  { actionName: 'Close Dialog', actionOwner: 'shesha.common' },
  { actionName: 'Cancel Edit', actionOwner: 'shesha.form' },
];

function checkExitMissing(entries, out) {
  const items = collectButtonGroupItems(entries);
  const submitItem = items.find(({ item }) => {
    const ac = item.actionConfiguration;
    return isPlainObject(ac) && ac.actionName === 'Submit' && ac.actionOwner === 'shesha.form';
  });
  if (!submitItem) return;
  const hasExit = EXIT_MATCHERS.some((m) => hasAction(items, m.actionName, m.actionOwner));
  if (!hasExit) {
    out.push(finding(
      'T2-EXIT-MISSING',
      submitItem.groupPath,
      'A Submit action exists but no paired exit action was found anywhere in the tree — a user who can save must be able to leave without saving. Add the exit action matching the host: standalone page -> { actionName: "Navigate", actionOwner: "shesha.common" } (Back), dialog -> { actionName: "Close Dialog", actionOwner: "shesha.common" }, detail form -> { actionName: "Cancel Edit", actionOwner: "shesha.form" }.',
      'one of Navigate/shesha.common, Close Dialog/shesha.common, Cancel Edit/shesha.form',
      'none found',
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-LOOSE-BUTTON
// ---------------------------------------------------------------------------

function checkLooseButton(node, ctx, out) {
  if (node.type !== 'button') return;
  if (ctx.parent?.type === 'buttonGroup') return;
  out.push(finding(
    'T2-LOOSE-BUTTON',
    ctx.path,
    `Standalone "button" component ("${nodeLabel(node)}") sits outside any buttonGroup (parent is "${ctx.parent?.type ?? 'root'}") — tooling reads a form's intent (create/edit/details/read-only) largely from buttonGroup items, so a loose button can get the whole form misread as read-only, and its action never lands in the Save/exit pairing checks.`,
    'a buttonGroup item ({ itemType: "item", itemSubType: "button", ... }) inside a buttonGroup.items[]',
    `standalone type:"button" under parent "${ctx.parent?.type ?? 'root'}"`,
  ));
}

// ---------------------------------------------------------------------------
// T2-PROPERTYNAME-CASE
//
// Corrected in Task 5: a DOTTED propertyName (e.g. "usedModule.name",
// "baseProject.status") is a sanctioned Shesha convention for reaching a
// property on a related/nested entity — it appears throughout this very
// skill's own bundled canonical seeds (assets/examples/rs-detail-with-
// header.json, rs-table.json, rs-subtable-tab-fragment.json). The original
// regex had no notion of a path separator, so it flagged every nested
// binding as a case violation even when each individual segment was
// correctly camelCase. isCamel() now checks each dot-separated segment
// independently; a genuine violation (a segment that is snake_case,
// PascalCase, etc.) is still caught.
// ---------------------------------------------------------------------------

const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/;

function isCamel(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return name.split('.').every((segment) => CAMEL_RE.test(segment));
}

function lowerFirst(s) {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

function checkPropertyNameCase(node, ctx, out) {
  if (typeof node.propertyName === 'string' && node.propertyName && !isCamel(node.propertyName)) {
    out.push(finding(
      'T2-PROPERTYNAME-CASE',
      ctx.path,
      `propertyName "${node.propertyName}" on "${node.type}" is not camelCase — Metadata/GetProperties returns the path in PascalCase, and copying it verbatim renders fine but produces a blank cell/value at runtime (the accessor reads the PascalCase key against camelCase data).`,
      `camelCase, e.g. "${lowerFirst(node.propertyName)}"`,
      node.propertyName,
    ));
  }

  // datatable column definitions: items[] with no top-level `.type`, so they
  // are invisible to the general walk (same reason tier1 special-cases them
  // for T1-EDITCOMPONENT-SHAPE) — check their propertyName here too.
  if (node.type === 'datatable' && Array.isArray(node.items)) {
    node.items.forEach((col, idx) => {
      if (isPlainObject(col) && typeof col.propertyName === 'string' && col.propertyName && !isCamel(col.propertyName)) {
        out.push(finding(
          'T2-PROPERTYNAME-CASE',
          `${ctx.path}.items[${idx}]`,
          `Datatable column propertyName "${col.propertyName}" is not camelCase — the cell accessor reads this literal key against camelCase row data, so a PascalCase column fetches the right row count but renders every cell blank.`,
          `camelCase, e.g. "${lowerFirst(col.propertyName)}"`,
          col.propertyName,
        ));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// T2-DROPDOWN-SOURCE
// ---------------------------------------------------------------------------

const DATASOURCE_TYPES = new Set(['dropdown', 'radio', 'checkboxGroup', 'autocomplete']);

function checkDropdownSource(node, ctx, out) {
  if (!DATASOURCE_TYPES.has(node.type)) return;

  if (node.dataSourceType == null || node.dataSourceType === '') {
    out.push(finding(
      'T2-DROPDOWN-SOURCE',
      ctx.path,
      `"${node.type}" ("${nodeLabel(node)}") has no dataSourceType — a missing source fails silently (empty dropdown/options, no console error).`,
      'dataSourceType: "values" | "referenceList" | "entitiesList"',
      node.dataSourceType ?? null,
    ));
    return;
  }

  if (node.dataSourceType === 'values') {
    const key = node.type === 'checkboxGroup' ? 'items' : 'values';
    const requiredKeys = node.type === 'checkboxGroup' ? ['label', 'value'] : ['id', 'label', 'value'];
    const list = Array.isArray(node[key]) ? node[key] : null;
    const bad = !list || list.length === 0
      || list.some((v) => !isPlainObject(v) || requiredKeys.some((k) => v[k] === undefined));
    if (bad) {
      out.push(finding(
        'T2-DROPDOWN-SOURCE',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") has dataSourceType: "values" but "${key}" is ${JSON.stringify(node[key] ?? null)} — every item needs {${requiredKeys.join(', ')}}, or the option list silently fails to render.`,
        `${key}: [ { ${requiredKeys.join(', ')} }, ... ]`,
        node[key] ?? null,
      ));
    }
  } else if (node.dataSourceType === 'referenceList') {
    const rl = node.referenceListId;
    if (!isPlainObject(rl) || typeof rl.module !== 'string' || !rl.module || typeof rl.name !== 'string' || !rl.name) {
      out.push(finding(
        'T2-DROPDOWN-SOURCE',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") has dataSourceType: "referenceList" but referenceListId is ${JSON.stringify(rl ?? null)} — it must be an object with BOTH module and name (never a Guid, never name-only), or the dropdown renders silently empty.`,
        'referenceListId: { module: "<module>", name: "<Module>.<RefListName>" }',
        rl ?? null,
      ));
    }
  } else if (node.dataSourceType === 'entitiesList') {
    // Corrected in Task 5: entityType accepts EITHER the { name, module }
    // object OR a non-empty full-class-name string — the same
    // isEntityTypeIdentifier/getEntityTypeIdentifier normalization
    // (providers/metadataDispatcher/entities/utils.ts) that resolves
    // formSettings.modelType (see T2-MODELTYPE-SHAPE) also governs
    // entityPicker's `entityType`, confirmed typed `string |
    // IEntityTypeIdentifier` and fed through the identical query-param
    // builder. Corpus grading found full-class-name strings here on real
    // production forms; only a genuinely absent/empty entityType is a
    // defect.
    const et = node.entityType;
    const okObject = isPlainObject(et) && typeof et.name === 'string' && et.name.length > 0;
    const okString = typeof et === 'string' && et.length > 0;
    if (!okObject && !okString) {
      out.push(finding(
        'T2-DROPDOWN-SOURCE',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") has dataSourceType: "entitiesList" but entityType is ${JSON.stringify(et ?? null)} — an entity-FK source with no entityType renders an empty box.`,
        'entityType: { name: "<ShortClass>", module: "<Module>" } or a non-empty full-class-name string',
        et ?? null,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T2-DATE-COMPONENT
//
// No entity metadata is available to this function (tier2's signature has
// no dataType/property-metadata input), so this is a name-based heuristic:
// a propertyName whose camelCase WORD segments include "date"/"dob" reads as
// a date property. Word-segmented (not substring) matching deliberately
// avoids false positives like "candidate" (single word, never splits).
// ---------------------------------------------------------------------------

const DATE_WORDS = new Set(['date', 'dob']);

function propertyNameWords(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

function checkDateComponent(node, ctx, out) {
  if (typeof node.propertyName !== 'string' || !node.propertyName) return;
  if (node.type === 'dateField') return;
  if (!propertyNameWords(node.propertyName).some((w) => DATE_WORDS.has(w))) return;
  out.push(finding(
    'T2-DATE-COMPONENT',
    ctx.path,
    `propertyName "${node.propertyName}" reads as a date/date-time property by name but the component is "${node.type}", not "dateField" — a textField/numberField loses the date picker and breaks the ISO round-trip.`,
    'type: "dateField" (showTime: true for date-time)',
    node.type,
  ));
}

// ---------------------------------------------------------------------------
// T2-MODELTYPE-SHAPE
//
// Corrected in Task 5: corpus grading (100 real RequirementsStudio
// production forms) found 90/100 using a bare full-class-name STRING here,
// only 1/100 using the { name, module } object — and framework-source
// verification (shesha-reactjs) confirmed both are first-class, fully
// supported shapes with NO functional difference: `IFormSettingsCommon.
// modelType` is typed `IEntityTypeIdentifier | string`, and every metadata
// consumer (metadataDispatcher/dispatcher.ts's getMetadata/isEntityType,
// entityMetadataFetcher.ts) branches on `isEntityTypeIdentifier()` and calls
// symmetrically-implemented fetchers for either shape (getByTypeId vs
// getByClassName both delegate to the same getByEntityType). The object
// shape is a newer, ADDITIVE convention layered on top of the string shape
// (introduced in commit 30ea93c93), not a replacement for it — the 0.43
// worktree only ever had the string form. A bare string is therefore NOT a
// defect; only a genuinely missing/empty/malformed modelType is.
//
// Made CONDITIONAL in the Phase 3 compiler-placement pass: this check used
// to fire unconditionally, on every form, with no way to express that
// `hub`/`dashboard` archetypes (a landing page of navigation tiles, a
// metrics rollup) are legitimately not bound to any entity at all — the
// compiler was forced to synthesize a placeholder modelType purely to
// survive this check, planting meaningless data into real form config that
// a runtime loader might actually try to resolve, which is worse than no
// modelType at all. The real fault was in the check, not the compiler: a
// missing modelType is only a defect when the form actually needs one.
// `formHasBoundFields` decides that from the markup alone (no blueprint is
// available at check time) via the signals an entity-bound form actually
// carries: an INTERACTIVE_TYPES field with a real propertyName (a create/
// edit form's own inputs), or a `dataContext` node (which, per
// T2-DATACONTEXT-PROPS, always carries a real `entityType` — its mere
// presence already proves an entity binding exists), or
// `formSettings.dataLoaderType` set to anything other than "none". A
// modelType's SHAPE, when one IS present, is still validated unconditionally
// — an entity-less form that carries a malformed modelType anyway is still
// a defect; only the "must be present at all" half of the rule is gated.
// ---------------------------------------------------------------------------

function formHasBoundFields(markup, entries) {
  const dataLoaderType = markup?.formSettings?.dataLoaderType;
  if (typeof dataLoaderType === 'string' && dataLoaderType !== 'none') return true;
  return entries.some(({ node }) => {
    if (node.type === 'dataContext') return true;
    return INTERACTIVE_TYPES.has(node.type) && typeof node.propertyName === 'string' && node.propertyName.length > 0;
  });
}

function checkModelTypeShape(markup, entries, out) {
  const mt = markup?.formSettings?.modelType;
  const isMissing = mt === undefined || mt === null || mt === '';

  if (isMissing) {
    if (!formHasBoundFields(markup, entries)) return; // genuinely entity-less archetype (hub, dashboard, ...) — nothing to bind
    out.push(finding(
      'T2-MODELTYPE-SHAPE',
      'formSettings.modelType',
      `formSettings.modelType is ${JSON.stringify(mt ?? null)}, but this form is entity-bound (it has an interactive input with a propertyName, a dataContext node, or formSettings.dataLoaderType set to a real loader) — it must be either the object { name, module } (e.g. { "name": "Person", "module": "Shesha" }) or a non-empty full-class-name string; an absent/empty value cannot resolve entity metadata at all.`,
      '{ name: "<ShortClass>", module: "<Module>" } or a non-empty full-class-name string',
      mt ?? null,
    ));
    return;
  }

  const okObject = isPlainObject(mt) && typeof mt.name === 'string' && mt.name.length > 0
    && typeof mt.module === 'string' && mt.module.length > 0;
  const okString = typeof mt === 'string' && mt.length > 0;
  if (!okObject && !okString) {
    out.push(finding(
      'T2-MODELTYPE-SHAPE',
      'formSettings.modelType',
      `formSettings.modelType is ${JSON.stringify(mt ?? null)} — it must be either the object { name, module } (e.g. { "name": "Person", "module": "Shesha" }) or a non-empty full-class-name string; both resolve identically at runtime, but a malformed value cannot resolve entity metadata at all.`,
      '{ name: "<ShortClass>", module: "<Module>" } or a non-empty full-class-name string',
      mt ?? null,
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-EDITMODE-MISMATCH
//
// Binary form-type detection derived purely from markup content (no
// archetype required): a "Start Edit"/shesha.form buttonGroup action anywhere
// marks this as a detail form governed by a Start Edit/Submit/Cancel Edit
// lifecycle (interactive inputs must be "inherited"); its absence means a
// dialog/action-page context (interactive inputs must be "editable"), per
// references/components/edit-mode.md. INTERACTIVE_TYPES is a curated subset
// of the registry's isInput:true types — deliberately excluding structural/
// meta "input" widgets (dataContext, queryBuilder, metadataEditor, ...) that
// don't carry this edit/dialog semantic.
//
// Corrected in Task 5: `editMode: "readOnly"` is exempted from the mismatch
// check. references/components/edit-mode.md documents THREE legitimate
// values — 'editable' | 'readOnly' | 'inherited' — and is explicit that
// "editMode === 'readOnly' always wins" regardless of form type: it is a
// deliberate, permanent read-only field (e.g. a computed/audit value), not a
// detail/dialog-lifecycle bug. The corpus (100 real forms) showed this
// mismatch firing on every non-detail form with a legitimately read-only
// field; flagging a field an author explicitly marked readOnly as if it
// were an accidentally-wrong editable/inherited value was the false
// positive — the check still fires (correctly) when editMode is missing, or
// is the OTHER wrong value of the editable/inherited pair.
// ---------------------------------------------------------------------------

const INTERACTIVE_TYPES = new Set([
  'textField', 'textArea', 'numberField', 'dropdown', 'autocomplete', 'checkbox', 'checkboxGroup',
  'switch', 'radio', 'dateField', 'timePicker', 'calendar', 'entityPicker', 'entityReference',
  'fileUpload', 'colorPicker', 'rate', 'slider', 'richTextEditor', 'passwordCombo', 'address',
  'attachmentsEditor', 'editableTagGroup', 'autocompleteTagGroup', 'formAutocomplete', 'iconPicker',
]);

function checkEditModeMismatch(node, ctx, comp, isDetailForm, out) {
  if (!INTERACTIVE_TYPES.has(node.type)) return;
  if (node.editMode === 'readOnly') return;
  const expected = isDetailForm ? 'inherited' : 'editable';
  if (node.editMode !== expected) {
    out.push(finding(
      'T2-EDITMODE-MISMATCH',
      ctx.path,
      `"${node.type}" ("${nodeLabel(node)}") has editMode ${JSON.stringify(node.editMode ?? null)} — ${isDetailForm
        ? 'this form carries a Start Edit/Submit/Cancel Edit lifecycle, so interactive inputs must be "inherited" (an explicit "editable" makes the field editable before Edit is clicked)'
        : 'this form has no detail-lifecycle buttons (dialog/action-page context), so interactive inputs must be "editable" ("inherited" resolves read-only with no data loader and renders dead inputs)'}.`,
      `editMode: "${expected}"`,
      node.editMode ?? null,
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-DATACONTEXT-PROPS
//
// Corrected in Task 5: `uniqueStateId` removed from the required set.
// Corpus grading found EVERY dataContext-scoped finding was for this one key
// (never entityType/sourceType/dataFetchingMode/defaultPageSize) on 37/100
// real, actively-used production forms — and framework-source verification
// found `uniqueStateId` is not, and has never been, a property of the
// dataContext component at all: `IDataContextComponentProps` has no such
// field, and `dataContextComponent/settings.tsx` doesn't offer it.
// `uniqueStateId` IS a real property, but of unrelated legacy components
// (table/childTable/dataSource/entityPicker/wizard/button), where it is read
// with a `prev['uniqueStateId'] ?? prev['name']` fallback during migration —
// tolerated, never a hard requirement, even on the types that once had it.
// The check was validating a property against the wrong component's
// contract; the corpus forms it fired on were never broken.
// ---------------------------------------------------------------------------

const DATACONTEXT_REQUIRED = ['entityType', 'sourceType', 'dataFetchingMode', 'defaultPageSize'];

function checkDataContextProps(node, ctx, out) {
  if (node.type !== 'dataContext') return;
  const missing = DATACONTEXT_REQUIRED.filter((k) => node[k] === undefined || node[k] === null || node[k] === '');
  if (missing.length) {
    out.push(finding(
      'T2-DATACONTEXT-PROPS',
      ctx.path,
      `dataContext "${nodeLabel(node)}" is missing ${missing.join(', ')} — without these a dataContext silently fails to fetch/paginate/identify its bound entity.`,
      DATACONTEXT_REQUIRED.join(', '),
      missing,
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-FLOW-INCOMPLETE (skippable — needs an explicit archetype)
// ---------------------------------------------------------------------------

function checkFlowIncomplete(entries, { archetype, flows }, out) {
  if (!archetype) {
    out.push(skipFinding(
      'formSettings',
      'T2-FLOW-INCOMPLETE skipped — no archetype was supplied. Guessing an archetype risks a wall of false failures on a correctly-built form, so this check only runs when the caller passes an explicit { archetype } option.',
    ));
    return;
  }
  if (!flows || typeof flows !== 'object') {
    out.push(skipFinding(
      'formSettings',
      `T2-FLOW-INCOMPLETE skipped — archetype "${archetype}" was given but no flows catalogue was supplied; pass { flows } (archetype name -> loaded .flow.json manifest) to enable this check.`,
    ));
    return;
  }
  const flow = flows[archetype];
  if (!flow) {
    out.push(skipFinding(
      'formSettings',
      `T2-FLOW-INCOMPLETE skipped — archetype "${archetype}" was not found in the supplied flows catalogue.`,
    ));
    return;
  }

  const required = requiredNodes(flow);
  const present = new Set(entries.map(({ node }) => node.type));
  const buttonItems = collectButtonGroupItems(entries);
  const missing = [];

  for (const req of required) {
    if (!present.has(req.type)) {
      missing.push(`"${req.node}" (type "${req.type}")`);
      continue;
    }
    if (Array.isArray(req.actions)) {
      for (const act of req.actions) {
        if (!hasAction(buttonItems, act.actionName, act.actionOwner)) {
          missing.push(`"${req.node}" action ${act.actionName}/${act.actionOwner}`);
        }
      }
    }
  }

  if (missing.length) {
    out.push(finding(
      'T2-FLOW-INCOMPLETE',
      'components',
      `Archetype "${archetype}" requires ${missing.join(', ')} — missing from this form's tree.`,
      required.map((r) => `${r.node} (${r.type})`).join(', '),
      missing,
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-DANGLING-FORMREF (skippable — needs a knownForms list)
// ---------------------------------------------------------------------------

// Unlike most structural keys, `items` is NOT separately walked by flatten()
// into its own typed nodes (buttonGroup/datatable items carry no top-level
// `type`), so it must NOT be skipped here or a formId/targetUrl nested under
// an item's actionConfiguration would never be seen.
const FORMREF_SKIP_KEYS = new Set(CHILD_KEYS.filter((k) => k !== 'items'));

function collectFormRefsFromNode(node) {
  const refs = [];
  function visit(obj, path) {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (FORMREF_SKIP_KEYS.has(key)) continue;
      const value = obj[key];
      const p = path ? `${path}.${key}` : key;
      if (key === 'formId' && isPlainObject(value) && typeof value.name === 'string') {
        refs.push({ kind: 'formId', ref: { module: value.module, name: value.name }, path: p });
      } else if (key === 'targetUrl' && typeof value === 'string') {
        refs.push({ kind: 'targetUrl', ref: value, path: p });
      } else if (isPlainObject(value)) {
        visit(value, p);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => { if (isPlainObject(v)) visit(v, `${p}[${i}]`); });
      }
    }
  }
  visit(node, '');
  return refs;
}

function isFormKnown(target, knownForms) {
  return knownForms.some((f) => f && f.module === target.module && f.name === target.name);
}

function checkDanglingFormRef(entries, { knownForms }, out) {
  if (!Array.isArray(knownForms)) {
    out.push(skipFinding(
      'formSettings',
      'T2-DANGLING-FORMREF skipped — no knownForms list was supplied; pass { knownForms: [{ module, name }, ...] } to enable this check.',
    ));
    return;
  }

  for (const { node, ctx } of entries) {
    for (const r of collectFormRefsFromNode(node)) {
      let target = null;
      if (r.kind === 'formId') {
        target = r.ref;
      } else {
        const m = /^\/dynamic\/([^/?]+)\/([^/?]+)/.exec(r.ref);
        if (m) target = { module: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) };
      }
      if (!target) continue; // not a recognizable form-reference shape — nothing to check
      if (!isFormKnown(target, knownForms)) {
        out.push(finding(
          'T2-DANGLING-FORMREF',
          `${ctx.path}.${r.path}`,
          `${r.kind === 'formId' ? 'actionArguments.formId' : 'targetUrl'} points at "${target.module}/${target.name}", which is not in the known-forms list — this reference resolves to nothing at runtime.`,
          'a { module, name } naming a form present in knownForms',
          r.kind === 'formId' ? target : r.ref,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T2-SLOT-STYLE-MISMATCH (task 8)
//
// A component whose children live in a separate SLOT object (content.
// components / header.components / customHeader.components — the same three
// slot keys walk.mjs treats specially) is a two-DOM-node component: the
// layout style set on the component's own top-level/per-breakpoint props
// styles the OUTER node, but the slot's children are laid out by whatever
// style (if any) sits on the SLOT OBJECT ITSELF, which is a fully separate
// prop surface (`node.content.display`, not `node.desktop.display`).
//
// Evidence (flight-details.pushed.json / flight-booking-details.pushed.json):
// `card` "statusPanel" carries desktop:{display:"flex",flexDirection:
// "column",gap:16} on ITSELF, while `content` was stamped only `{id,
// components:[]}` — no style at all. Its two children (a hideLabel "Status"
// text + a hideLabel refListStatus chip) collapse into the literal run-on
// string "StatusFlight status" with no gap between them; "metaPanel"'s three
// text nodes collapse into "RecordCapturedUpdated" the same way.
//
// Scoped to slots with 2+ children — a single-child slot (the common case:
// a card's `header` holding just a title) has no adjacency to collapse, so
// flagging it would be pure noise with no matching failure mode.
// ---------------------------------------------------------------------------

const SLOT_KEYS = ['content', 'header', 'customHeader'];

function nodeLayoutStyleKeys(node) {
  const view = bpView(node, 'desktop');
  return FLEX_PROP_NAMES.filter((p) => view[p] !== undefined);
}

function checkSlotStyleMismatch(node, ctx, out) {
  for (const slotKey of SLOT_KEYS) {
    const slot = node[slotKey];
    if (!isPlainObject(slot) || !Array.isArray(slot.components) || slot.components.length < 2) continue;
    const nodeStyleKeys = nodeLayoutStyleKeys(node);
    if (!nodeStyleKeys.length) continue; // nothing on the node itself to propagate
    const slotHasAnyStyle = FLEX_PROP_NAMES.some((p) => slot[p] !== undefined);
    if (slotHasAnyStyle) continue;
    out.push(finding(
      'T2-SLOT-STYLE-MISMATCH',
      `${ctx.path}.${slotKey}`,
      `"${node.type}" ("${nodeLabel(node)}") sets layout style (${nodeStyleKeys.join(', ')}) on ITSELF, but its ${slot.components.length} children live in the separate "${slotKey}" slot, which carries no layout style of its own — the slot is a distinct DOM node from the component's own top-level props, so its children render with no display:flex/gap between them and collapse adjacent into one run-on string (e.g. a hideLabel caption immediately followed by a hideLabel value: "StatusFlight status").`,
      `${slotKey}.{${nodeStyleKeys.join(', ')}} mirroring the node's own layout style`,
      Object.fromEntries(FLEX_PROP_NAMES.filter((p) => slot[p] !== undefined).map((p) => [p, slot[p]])),
    ));
  }
}

// ---------------------------------------------------------------------------
// T2-ROWLIST-NO-VGAP (task 8)
//
// A components array whose direct children are two-or-more flex-ROW
// containers (each already carrying its own horizontal gap) needs a
// VERTICAL gap of its own on the host — otherwise row-to-row spacing falls
// back to whatever intrinsic height each row's tallest field happens to be,
// producing visibly uneven gaps (a dateField picker row sits taller than a
// textField row, so consecutive rows look randomly spaced even though every
// row's OWN horizontal gap is identical).
//
// Evidence: flight-details' three field tabs ("service": rowService/
// rowOrigin/rowDest, "schedule": rowTimes/rowOps, "commercial": rowSeats/
// rowFare) each give every row gap:12 horizontally, but the tab pane object
// itself ({id, key, title, components} — confirmed against the registry's
// "tabs" component: tab panes carry NO style props at all, not even `gap`)
// declares no vertical spacing whatsoever between the rows.
//
// Two host shapes are checked because a "row list" can sit under either:
//   (a) a real `container` node (has its own gap prop — check its bpView), or
//   (b) a `tabs` component's tab-pane object (no style props at all in the
//       registry — the pane itself can never carry a fix-able gap, so this
//       still fires, but the NORMALIZER fix for this shape must wrap rather
//       than stamp — see normalize-form.mjs's handling).
// ---------------------------------------------------------------------------

function isRowLikeContainer(child) {
  if (!isPlainObject(child) || child.type !== 'container') return false;
  return isFlexRow(child);
}

function hasPositiveGap(gap) {
  if (typeof gap === 'number') return gap > 0;
  if (typeof gap === 'string') return parseFloat(gap) > 0;
  return false;
}

function checkRowListNoVGap(entries, out) {
  for (const { node, ctx } of entries) {
    // (a) a container hosting 2+ row-containers directly in .components.
    if (node.type === 'container') {
      const children = Array.isArray(node.components) ? node.components : [];
      const rowChildren = children.filter(isRowLikeContainer);
      if (rowChildren.length >= 2) {
        const view = bpView(node, 'desktop');
        if (!hasPositiveGap(view.gap)) {
          out.push(finding(
            'T2-ROWLIST-NO-VGAP',
            ctx.path,
            `Container "${nodeLabel(node)}" hosts ${rowChildren.length} row-containers directly in its components[] (each with its own horizontal gap) but sets no vertical gap itself (desktop.gap: ${JSON.stringify(view.gap ?? null)}) — row-to-row spacing falls back to each row's intrinsic content height instead of a consistent value.`,
            'desktop/tablet/mobile.gap: a positive value (the theme section gap)',
            view.gap ?? null,
          ));
        }
      }
    }

    // (b) a `tabs` component's own tab-pane objects (no top-level `type`,
    // invisible to the general per-node walk — same reason buttonGroup items
    // and datatable columns are special-cased elsewhere in this file).
    if (node.type === 'tabs' && Array.isArray(node.tabs)) {
      node.tabs.forEach((tab, idx) => {
        if (!isPlainObject(tab)) return;
        const children = Array.isArray(tab.components) ? tab.components : [];
        const rowChildren = children.filter(isRowLikeContainer);
        if (rowChildren.length < 2) return;
        if (!hasPositiveGap(tab.gap)) {
          out.push(finding(
            'T2-ROWLIST-NO-VGAP',
            `${ctx.path}.tabs[${idx}]`,
            `Tab "${tab.key ?? idx}" hosts ${rowChildren.length} row-containers directly in its components[] (each with its own horizontal gap) but the tab pane itself has no vertical gap — the registry's "tabs" component schema gives tab-pane objects ({id, key, title, components}) no style props at all, so this cannot be fixed by stamping a prop; the rows must be wrapped in a single child container that carries the vertical gap.`,
            'the tab\'s rows wrapped in one child container carrying a positive vertical gap (the theme section gap)',
            null,
          ));
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// T2-CODEMODE-TITLE (task 8)
//
// An entity-bound title/subtitle `text` node should bind via a mustache
// content string ("{{data.field}}"), not a one-shot `{_mode:"code", _code:
// "..."}` block that string-concatenates possibly-unresolved fields. This
// skill's own canonical `assets/blocks/page-header-band.block.json` uses
// mustache for exactly this reason.
//
// Evidence: flight-details heading (id 2cd28b95-...) used `_code: "return
// (data?.flightNumber ?? '') + \" · \" + (data?.airline ?? '');"` and a
// subtitle concatenated origin/destination the same way. With `data`
// unresolved at render time (a real, observed timing state — not a
// hypothetical), string concatenation of all-empty-string fallbacks
// collapses to EXACTLY the bare separators: `" · "` and `"() → ()"` —
// byte-for-byte the broken literal seen on screen, with no error thrown
// anywhere (`??` swallows it). A mustache string has no equivalent failure
// mode: each `{{data.x}}` token resolves (or blanks) independently.
//
// REPORT-ONLY, not blocking (see task-8 report for the full justification):
// rewriting a `_code` string into an equivalent mustache template requires
// understanding the AUTHOR'S INTENDED separator/punctuation between fields
// (" · " vs ", " vs " - " vs "()" all appear in real forms) — a mechanical
// rewrite risks silently changing what the heading reads, which is worse
// than leaving a correct-but-fragile code block in place. This is exactly
// the kind of judgment call Group A/B exists to keep OUT of the gate.
// ---------------------------------------------------------------------------

function checkCodemodeTitle(node, ctx, out) {
  if (node.type !== 'text') return;
  const content = node.content;
  if (!isPlainObject(content) || content._mode !== 'code') return;
  const code = typeof content._code === 'string' ? content._code : '';
  if (!/data\??\.|data\?\[|data\[/.test(code)) return; // only entity-data-bound code is this defect
  if (!/\+/.test(code)) return; // the defect is specifically STRING CONCATENATION, not any code content
  out.push(finding(
    'T2-CODEMODE-TITLE',
    ctx.path,
    `"text" ("${nodeLabel(node)}") binds via a one-shot content._mode:"code" block that string-concatenates data fields (${JSON.stringify(code)}) instead of a mustache content string — if a referenced field is unresolved when this code runs, "??" fallbacks silently collapse the WHOLE expression to just its literal separators (e.g. " · ", "() → ()"), rendering that broken literal with no error. A mustache string ("{{data.fieldA}} · {{data.fieldB}}") has no equivalent failure mode: each token resolves independently.`,
    'content: "{{data.fieldA}} · {{data.fieldB}}" (mustache string, no _mode:"code")',
    code,
  ));
}

// ---------------------------------------------------------------------------
// T2-DUPLICATE-CAPTION (task 8)
//
// No `text` node whose plain-string content duplicates a SIBLING control's
// own `label` when that sibling has hideLabel:true — the caption ends up
// authored twice (once as a standalone text node, once as the hidden label
// the sibling still carries for a11y/API purposes), and with flat spacing
// between all siblings the control reads as an orphaned extra item rather
// than a labelled field.
//
// Evidence: asset-detail's "railStatusPanel" carries a text node
// ("railActiveLabel", content: "On active register") immediately followed
// by a sibling checkbox ("railActive"/propertyName isActive) carrying
// label: "On active register", hideLabel: true — the exact caption,
// authored twice, in the same parent's components[].
//
// Grouped by ctx.parent (the flattened tree's own notion of "same slot"),
// which transparently covers both a plain container's components[] AND a
// card's content/header/customHeader slot children — flatten() sets
// ctx.parent to the nearest ancestor NODE regardless of which slot key it
// descended through (see walk.mjs's descend()).
// ---------------------------------------------------------------------------

function normalizeCaptionText(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : null;
}

const ROOT_PARENT_KEY = Symbol('root-parent');

function checkDuplicateCaption(entries, out) {
  const byParent = new Map();
  for (const entry of entries) {
    const key = entry.ctx.parent ?? ROOT_PARENT_KEY;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(entry);
  }

  for (const siblings of byParent.values()) {
    for (const { node: textNode, ctx } of siblings) {
      if (textNode.type !== 'text') continue;
      if (typeof textNode.content !== 'string' || !textNode.content) continue;
      const normContent = normalizeCaptionText(textNode.content);
      const dupe = siblings.find(({ node: sib }) => sib !== textNode
        && sib.hideLabel === true
        && typeof sib.label === 'string'
        && normalizeCaptionText(sib.label) === normContent);
      if (dupe) {
        out.push(finding(
          'T2-DUPLICATE-CAPTION',
          ctx.path,
          `text node "${nodeLabel(textNode)}" (content: ${JSON.stringify(textNode.content)}) duplicates the label of sibling "${dupe.node.type}" ("${nodeLabel(dupe.node)}", label: ${JSON.stringify(dupe.node.label)}, hideLabel: true) — the caption is authored twice; with flat spacing between siblings the control reads as an unlabelled orphan rather than a labelled field.`,
          'either drop the standalone text node (let the sibling\'s own label show, hideLabel: false) or drop the sibling\'s duplicate label — not both',
          { textContent: textNode.content, siblingLabel: dupe.node.label },
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T2-LABELCOL-VS-NARROW-ROW (task 8)
//
// formSettings.layout: "horizontal" + a labelCol span applies ONE global
// label-column width to every field on the form — the renderer applies it
// at the Form level, and (per this skill's own references/components/
// detail-page-pattern.md) a field-level labelCol override is silently
// ignored. That global label width is incompatible with any field sitting
// inside a sub-50%-width container: the same labelCol:{span:6} that reads
// fine in a full-width row truncates ("Assign Employ...") or crams
// ("Asset Name :") once the row itself is already only half (or a third)
// of the form's width.
//
// Evidence: asset-detail sets layout:"horizontal", labelCol:{span:6},
// wrapperCol:{span:18} uniformly while fields sit in calc(50% - 8px) and
// calc(33.333% - 10.667px) containers. The flight forms avoid the whole
// class of defect with layout:"vertical" (no labelCol/wrapperCol row
// splitting at all), so they are the negative fixture.
//
// One whole-form finding (not one per narrow container) — the defect is a
// single wrong formSettings value, not N separate ones.
// ---------------------------------------------------------------------------

function isNarrowSplitWidth(w) {
  if (typeof w !== 'string') return false;
  const s = w.trim();
  const calcPct = /^calc\((\d+(?:\.\d+)?)%/.exec(s);
  if (calcPct) return parseFloat(calcPct[1]) <= 50;
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(s);
  return pct ? parseFloat(pct[1]) <= 50 : false;
}

function checkLabelColVsNarrowRow(markup, entries, out) {
  const fs = markup?.formSettings;
  if (!isPlainObject(fs) || fs.layout !== 'horizontal') return;
  const labelSpan = fs.labelCol?.span;
  if (typeof labelSpan !== 'number' || labelSpan <= 0) return;

  const narrowPaths = [];
  for (const { node, ctx } of entries) {
    if (node.type !== 'container') continue;
    const isNarrow = BREAKPOINTS.some((bp) => isNarrowSplitWidth(node[bp]?.dimensions?.width));
    if (!isNarrow) continue;
    const children = Array.isArray(node.components) ? node.components : [];
    if (children.some((c) => isPlainObject(c) && INTERACTIVE_TYPES.has(c.type))) {
      narrowPaths.push(ctx.path);
    }
  }
  if (!narrowPaths.length) return;

  out.push(finding(
    'T2-LABELCOL-VS-NARROW-ROW',
    'formSettings.labelCol',
    `formSettings sets layout:"horizontal" with labelCol:{span:${labelSpan}} applied globally, but ${narrowPaths.length} container(s) holding an interactive input sit at half-width-or-narrower (e.g. ${narrowPaths[0]}) — a field-level labelCol override is silently ignored by the renderer (see references/components/detail-page-pattern.md), so the SAME label column truncates or crams once its row is no longer full-width.`,
    'layout:"vertical" (no labelCol row-splitting), or labelCol/wrapperCol spans small enough to fit inside the narrowest row that still holds an input',
    { layout: fs.layout, labelColSpan: labelSpan, narrowContainerCount: narrowPaths.length },
  ));
}
