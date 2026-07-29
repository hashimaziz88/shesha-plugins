import { flatten, CHILD_KEYS } from './walk.mjs';
import { requiredNodes } from './flow.mjs';

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
 *   flows?: Record<string, object>,
 *   archetype?: string,
 *   knownForms?: Array<{module: string, name: string}>,
 * }} opts
 * @returns {Finding[]}
 */
export function tier2(markup, { registry, roles, flows, archetype, knownForms } = {}) {
  const out = [];
  const components = Array.isArray(markup?.components) ? markup.components : [];
  const entries = flatten(components);

  // --- Whole-tree / whole-form checks ---
  checkColumnsPresent(entries, out);
  checkValidationErrorsMissing(entries, out);
  checkSubmitWiring(entries, out);
  checkExitMissing(entries, out);
  checkModelTypeShape(markup, out);
  checkFlowIncomplete(entries, { archetype, flows }, out);
  checkDanglingFormRef(entries, { knownForms }, out);

  // --- Per-node checks ---
  const isDetailForm = hasDetailLifecycle(entries);
  for (const { node, ctx } of entries) {
    const comp = registry?.components?.[node.type];

    if (node.type === 'container') {
      checkFlexNoDisplay(node, ctx, out);
      checkNoDefaultStylingDropsStyle(node, ctx, out);
      checkStyleIncomplete(node, ctx, registry, out);
      checkFlexChildNotContainer(node, ctx, out);
      checkStyleOffToken(node, ctx, out);
    } else {
      checkWidthOnNonContainer(node, ctx, out);
    }

    checkLooseButton(node, ctx, out);
    checkPropertyNameCase(node, ctx, out);
    checkDropdownSource(node, ctx, out);
    checkDateComponent(node, ctx, out);
    checkEditModeMismatch(node, ctx, comp, isDetailForm, out);
    checkDataContextProps(node, ctx, out);
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

function checkWidthOnNonContainer(node, ctx, out) {
  if (node.type === 'container') return;
  for (const bp of BREAKPOINTS) {
    const w = node[bp]?.dimensions?.width;
    if (w !== undefined) {
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
// any markup still carrying the legacy `styleOverrides` shape forward. NOTE:
// scripts/lib/tier3.mjs independently reimplements the OLD `styleOverrides`
// convention and was NOT reconciled here — it is another agent's
// concurrently-in-progress file and out of this task's scope; see the task-7
// report for what still needs changing there.
// ---------------------------------------------------------------------------

const COLOR_LITERAL_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(/i;

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

function checkStyleOffToken(node, ctx, out) {
  if (node.type !== 'container') return;
  const colors = collectColorPaths(node);
  if (!colors.length) return;
  const overridesArr = Array.isArray(node.overrides) ? node.overrides : [];
  const overrideByProp = new Map(
    overridesArr.filter(isPlainObject).map((o) => [o.prop, o]),
  );
  for (const { path, value } of colors) {
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
// ---------------------------------------------------------------------------

const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/;

function isCamel(name) {
  return typeof name === 'string' && name.length > 0 && CAMEL_RE.test(name);
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
    const et = node.entityType;
    if (!isPlainObject(et) || typeof et.name !== 'string' || !et.name) {
      out.push(finding(
        'T2-DROPDOWN-SOURCE',
        ctx.path,
        `"${node.type}" ("${nodeLabel(node)}") has dataSourceType: "entitiesList" but entityType is ${JSON.stringify(et ?? null)} — an entity-FK source with no entityType renders an empty box.`,
        'entityType: { name: "<ShortClass>", module: "<Module>" }',
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
// ---------------------------------------------------------------------------

function checkModelTypeShape(markup, out) {
  const mt = markup?.formSettings?.modelType;
  const ok = isPlainObject(mt) && typeof mt.name === 'string' && mt.name.length > 0
    && typeof mt.module === 'string' && mt.module.length > 0;
  if (!ok) {
    out.push(finding(
      'T2-MODELTYPE-SHAPE',
      'formSettings.modelType',
      `formSettings.modelType is ${JSON.stringify(mt ?? null)} — current Shesha builds emit the object { name, module } (e.g. { "name": "Person", "module": "Shesha" }); a bare full-class-name string still renders on legacy forms but is not what to author.`,
      '{ name: "<ShortClass>", module: "<Module>" }',
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
// ---------------------------------------------------------------------------

const INTERACTIVE_TYPES = new Set([
  'textField', 'textArea', 'numberField', 'dropdown', 'autocomplete', 'checkbox', 'checkboxGroup',
  'switch', 'radio', 'dateField', 'timePicker', 'calendar', 'entityPicker', 'entityReference',
  'fileUpload', 'colorPicker', 'rate', 'slider', 'richTextEditor', 'passwordCombo', 'address',
  'attachmentsEditor', 'editableTagGroup', 'autocompleteTagGroup', 'formAutocomplete', 'iconPicker',
]);

function checkEditModeMismatch(node, ctx, comp, isDetailForm, out) {
  if (!INTERACTIVE_TYPES.has(node.type)) return;
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
// ---------------------------------------------------------------------------

const DATACONTEXT_REQUIRED = ['entityType', 'sourceType', 'dataFetchingMode', 'defaultPageSize', 'uniqueStateId'];

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
