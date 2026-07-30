import { flatten, CHILD_KEYS } from './walk.mjs';
import { themeColorSet, isOnToken } from './theme-tokens.mjs';

/**
 * Tier 3 — appearance/quality observations.
 *
 * Unlike Tier 1 (renderability) and Tier 2 (construction contract), Tier 3
 * checks judgement calls a human reviewer would raise in a design critique,
 * not things that are objectively broken. Every finding here is
 * `severity: 'observe'` and NONE of them affect a caller's pass/fail
 * decision — that is enforced by `validate-form.mjs`, not by this module,
 * but it is the single most important property of this file: appearance
 * judgement is genuinely subjective, and a subjective check wired to a
 * blocking gate is how a team disables the gate entirely the first time it
 * cries wolf. Tier 3 only ever produces a `score` (0-100) and a list of
 * observations a human can choose to act on.
 *
 * @param {object} markup
 * @param {{
 *   registry?: object,
 *   thresholds?: { calibrated: boolean, componentBindingRatioBudget?: number },
 *   blueprint?: object, // reserved for a future design-comprehension check; unused today
 * }} opts
 * @returns {{ score: number, findings: Finding[], uncalibrated: boolean }}
 */
export function tier3(markup, { registry, thresholds, blueprint, tokens } = {}) {
  const out = [];
  const components = Array.isArray(markup?.components) ? markup.components : [];
  const entries = flatten(components);

  checkLabelCasing(entries, out);
  checkActionZones(entries, out);
  checkHeaderFont(entries, registry, out);
  checkRawHex(entries, out, tokens);
  checkComponentRatio(entries, thresholds, out);
  checkOrphanContainers(entries, out);
  checkNonAuthorableType(entries, registry, out);
  checkRowChildNoFill(entries, out);

  const uncalibrated = !(thresholds && thresholds.calibrated === true);
  const score = computeScore(out);

  return { score, findings: out, uncalibrated };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function finding(code, path, message, expected, actual) {
  return { tier: 3, code, severity: 'observe', path, message, expected, actual };
}

const STRUCTURAL_KEYS = new Set(CHILD_KEYS);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nodeLabel(node) {
  return node.propertyName ?? node.componentName ?? node.id ?? '(unnamed)';
}

// ---------------------------------------------------------------------------
// Scoring
//
// Weighted by how loud a real form-reviewer would be about each thing, and
// each code's contribution is CAPPED so that a form which racks up many
// occurrences of the same minor issue (e.g. twenty Title-Case labels) still
// lands at a legible score rather than being clubbed to zero by one
// category. Rationale per weight:
//
//  - T3-LABEL-CASING (2/occurrence, cap 10): cosmetic, extremely common in
//    hand-authored markup, lowest severity of the set.
//  - T3-PRIMARY-COUNT (8/zone, cap 24): a button row with zero or multiple
//    "loud" actions reads as confused visual hierarchy — worse than a label,
//    but still just one row looking off, not the whole form.
//  - T3-DESTRUCTIVE-PRIMARY (12/occurrence, cap 24): a Delete/Cancel/Reset
//    button rendered as the visually dominant action is a real usability
//    trap (accidental data loss), so it outweighs a plain primary-count
//    mismatch per occurrence.
//  - T3-HEADER-FONT-INCOMPLETE (5/occurrence, cap 15): a title with no
//    explicit size/weight usually still renders (inherits body text styling)
//    — a real but modest miss.
//  - T3-RAW-HEX (4/occurrence, cap 16): a literal hex/rgb color outside the
//    documented overrides[] convention erodes theming, scored per
//    occurrence since a form that's hardcoded everywhere is worse than one
//    stray value, but capped so it doesn't dominate the whole score.
//  - T3-COMPONENT-RATIO (flat 15, single whole-form finding): one signal,
//    one deduction — see the note on the check itself about calibration.
//  - T3-ORPHAN-CONTAINER (3/occurrence, cap 15): dead wrapper divs are
//    housekeeping debt, not a user-facing defect.
//  - T3-NON-AUTHORABLE-TYPE (2/occurrence, cap 10): informational — the brief
//    is explicit that this is "legitimate in existing markup", so it costs
//    the least of any category; it exists to be noticed in NEW markup, not
//    to punish forms that already use these types.
//  - T3-ROW-CHILD-NOFILL (6/occurrence, cap 18): a row that fails to split is
//    a visible layout defect, so it outweighs housekeeping items; scored per
//    occurrence because a form where every row collapses is much worse than
//    one stray container, and capped so a wide form still lands legibly.
//    It sits in Tier 3 rather than Tier 2 only because the CORRECT width is
//    intent-dependent (equal share vs. filling column vs. fixed rail), which
//    makes it a judgement call rather than a contract violation.
//
// A single occurrence of any one check therefore costs at most 15 points
// (T3-COMPONENT-RATIO or T3-PRIMARY-COUNT/T3-DESTRUCTIVE-PRIMARY are the
// priciest single dings), so "a form failing one minor observation" cannot
// land anywhere near 20 — it lands in the 76-98 range depending on which
// check fired.
// ---------------------------------------------------------------------------

const WEIGHTS = {
  'T3-LABEL-CASING': { per: 2, cap: 10 },
  'T3-PRIMARY-COUNT': { per: 8, cap: 24 },
  'T3-DESTRUCTIVE-PRIMARY': { per: 12, cap: 24 },
  'T3-HEADER-FONT-INCOMPLETE': { per: 5, cap: 15 },
  'T3-RAW-HEX': { per: 4, cap: 16 },
  'T3-COMPONENT-RATIO': { per: 15, cap: 15 },
  'T3-ORPHAN-CONTAINER': { per: 3, cap: 15 },
  'T3-NON-AUTHORABLE-TYPE': { per: 2, cap: 10 },
  'T3-ROW-CHILD-NOFILL': { per: 6, cap: 18 },
};

function computeScore(findings) {
  const counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;

  let penalty = 0;
  for (const [code, count] of Object.entries(counts)) {
    const w = WEIGHTS[code];
    if (!w) continue;
    penalty += Math.min(count * w.per, w.cap);
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

// ---------------------------------------------------------------------------
// T3-LABEL-CASING
//
// Canonical form is sentence case: the label's first word is capitalized,
// every subsequent word is lowercase UNLESS it looks like an acronym (all
// letters/digits, e.g. "ID", "URL") — acronyms are exempted so "Vendor ID"
// isn't flagged for its second word.
// ---------------------------------------------------------------------------

function isSentenceCase(label) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (/^[a-zA-Z]/.test(words[0]) && !/^[A-Z]/.test(words[0])) return false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (/^[A-Z]/.test(w) && !/^[A-Z0-9]+$/.test(w)) return false;
  }
  return true;
}

function toSentenceCase(label) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      if (i > 0 && /^[A-Z0-9]+$/.test(w)) return w; // keep acronyms as-is
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function checkLabelCasing(entries, out) {
  for (const { node, ctx } of entries) {
    if (typeof node.label !== 'string' || !node.label.trim()) continue;
    if (!isSentenceCase(node.label)) {
      out.push(finding(
        'T3-LABEL-CASING',
        ctx.path,
        `Label "${node.label}" on "${node.type}" ("${nodeLabel(node)}") is not sentence case.`,
        toSentenceCase(node.label),
        node.label,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T3-PRIMARY-COUNT / T3-DESTRUCTIVE-PRIMARY
//
// An "action zone" is a buttonGroup's set of items that carry a buttonType
// (i.e. render as actual buttons, as opposed to a dropdown-only item shape).
// A zone with no such items has no primary-button semantics to judge and is
// skipped rather than guessed at.
// ---------------------------------------------------------------------------

const DESTRUCTIVE_LABEL_RE = /\b(delete|remove|cancel|reset|discard)\b/i;

function collectButtonZones(entries) {
  const zones = [];
  for (const { node, ctx } of entries) {
    if (node.type !== 'buttonGroup' || !Array.isArray(node.items)) continue;
    const items = node.items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => isPlainObject(item) && typeof item.buttonType === 'string');
    if (items.length) zones.push({ node, ctx, items });
  }
  return zones;
}

function checkActionZones(entries, out) {
  for (const { node, ctx, items } of collectButtonZones(entries)) {
    const primaries = items.filter(({ item }) => item.buttonType === 'primary');

    if (primaries.length !== 1) {
      out.push(finding(
        'T3-PRIMARY-COUNT',
        ctx.path,
        `Action zone "${nodeLabel(node)}" has ${primaries.length} buttonType:"primary" item(s) among ${items.length} button(s) — a well-formed action row draws the eye to exactly one primary action.`,
        'exactly one buttonType: "primary" item',
        primaries.length,
      ));
    }

    for (const { item, idx } of items) {
      if (item.buttonType === 'primary' && typeof item.label === 'string' && DESTRUCTIVE_LABEL_RE.test(item.label)) {
        out.push(finding(
          'T3-DESTRUCTIVE-PRIMARY',
          `${ctx.path}.items[${idx}]`,
          `Item "${item.label}" reads as a destructive action but is styled buttonType:"primary" — the visually dominant button should never be the one that deletes/cancels/resets/discards.`,
          'buttonType other than "primary" (e.g. "default" or "danger")',
          item.buttonType,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T3-HEADER-FONT-INCOMPLETE
//
// A "header/title" text node is identified by a heading level of 1, or by
// its component/property name reading as a heading (mirrors the
// componentName: "heading" convention already used elsewhere in this
// skill's own fixtures). The explicit-styling check looks for the
// registry's real nested `font.size`/`font.weight` fields — the "text"
// component has NO flat `fontSize`/`fontWeight` props at all (verified
// against assets/registry/registry-0.45.1.json: its font settings are
// exclusively `font`, `font.align`, `font.color`, `font.size`,
// `font.type`, `font.weight`). An earlier version of this check looked for
// flat fontSize/fontWeight, sourced from tests/fixtures/t2-clean.json
// rather than the registry — that fixture was itself non-conformant (the
// flat spelling tripped T1-PROP-UNKNOWN) and has since been corrected. The
// required prop names are derived from the registry's own
// `components.text.props`, the same way T2-STYLE-INCOMPLETE derives its
// required set from `registry.components.container.props`, so a framework
// change to the text component's font props can't silently desync this
// check again.
// ---------------------------------------------------------------------------

const HEADER_NAME_RE = /head|title/i;
const FONT_PROP_NAMES = new Set(['font.size', 'font.weight']);

function requiredFontProps(registry) {
  const textProps = registry?.components?.text?.props ?? [];
  return textProps.filter((p) => FONT_PROP_NAMES.has(p));
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

function isHeaderText(node) {
  if (node.type !== 'text') return false;
  if (node.level === 1) return true;
  return HEADER_NAME_RE.test(String(node.componentName ?? '')) || HEADER_NAME_RE.test(String(node.propertyName ?? ''));
}

function checkHeaderFont(entries, registry, out) {
  const required = requiredFontProps(registry);
  if (!required.length) return; // no registry info to derive the required set from — nothing to check

  for (const { node, ctx } of entries) {
    if (!isHeaderText(node)) continue;
    const missing = required.filter((p) => !hasPath(node, p));
    if (missing.length) {
      out.push(finding(
        'T3-HEADER-FONT-INCOMPLETE',
        ctx.path,
        `Header/title text "${nodeLabel(node)}" is missing ${missing.join(', ')} — it will inherit ambient body-text styling rather than reading as a title.`,
        `${required.join(' and ')} both set`,
        { 'font.size': node.font?.size ?? null, 'font.weight': node.font?.weight ?? null },
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T3-RAW-HEX
//
// Broader than Tier 2's T2-STYLE-OFF-TOKEN (which is deliberately scoped to
// `container` nodes only, per its own comment — every role in
// roles.styles.json resolves to a container). Tier 3 has no such
// blocking-severity concern, so it scans every node type for a literal
// hex/rgb(a) color.
//
// Override contract: this used to read a `styleOverrides[path] = {source,
// evidence}` object, a superseded shape. The project standardised on the
// Phase 1 blueprint schema's (../shesha-design-comprehension/assets/
// blueprint.schema.json) `overrides[] = {prop, value, source, evidence}` —
// tier2.mjs's T2-STYLE-OFF-TOKEN was already migrated to it (see its own
// comment). This check now reads `node.overrides[]` (matched by `.prop`)
// the same way, so all consumers of the override concept agree on one
// shape. An override entry missing `source` or `evidence` does not count
// as covered — a literal color may only deviate from a theme token when it
// carries measurement provenance.
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
// confirmed framework-default origin, so it remains a live finding. (Same
// exemption as tier2.mjs's T2-STYLE-OFF-TOKEN — kept as a sibling copy here
// rather than a shared import, matching this file's existing pattern of
// duplicating collectColorPaths rather than sharing it with tier2.mjs.)
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

function collectColorPaths(node) {
  const found = [];
  function visit(obj, path) {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (STRUCTURAL_KEYS.has(key) || key === 'overrides') continue;
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

function checkRawHex(entries, out, tokens) {
  // `resolveRole` resolves a role's token references down to literal hex
  // values — that is what resolution means — so a correctly-themed form is
  // full of literal hexes that all came from the active theme. Without this
  // set, the check fires on exactly the output the design system is supposed
  // to produce: it depressed every compiled archetype's score from 85 to 69.
  // Shared with T2-STYLE-OFF-TOKEN via theme-tokens.mjs so the two cannot
  // drift — they already did once, which is why this module exists.
  const themeTokenColors = themeColorSet(tokens);

  for (const { node, ctx } of entries) {
    const colors = collectColorPaths(node);
    if (!colors.length) continue;
    const overridesArr = Array.isArray(node.overrides) ? node.overrides : [];
    const overrideByProp = new Map(
      overridesArr.filter(isPlainObject).map((o) => [o.prop, o]),
    );
    for (const { path, value } of colors) {
      if (isFrameworkDefaultColor(path, value)) continue;
      // On-token by definition: the value IS a colour the active theme defines.
      if (isOnToken(value, themeTokenColors)) continue;
      const ov = overrideByProp.get(path);
      const covered = isPlainObject(ov) && typeof ov.source === 'string' && ov.source.length > 0
        && typeof ov.evidence === 'string' && ov.evidence.length > 0;
      if (!covered) {
        out.push(finding(
          'T3-RAW-HEX',
          `${ctx.path}.${path}`,
          `"${node.type}" ("${nodeLabel(node)}") hardcodes ${path}: ${JSON.stringify(value)} — no design-system role/token and no overrides[] entry ({ prop: "${path}", value, source, evidence }).`,
          `a design-system role/token, or overrides[] entry { prop: "${path}", value, source, evidence }`,
          value,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T3-COMPONENT-RATIO
//
// UNCALIBRATED: `thresholds.componentBindingRatioBudget` is a provisional
// guess (see assets/thresholds.json, `calibrated: false`) until Task 5
// measures the real corpus. Skipped entirely (no finding, no penalty) when
// there is no budget to compare against, or no bound field to divide by —
// a ratio against zero bindings is meaningless, not "infinitely bad".
// ---------------------------------------------------------------------------

/**
 * A "field cell" is a `container` whose only typed child is a single input
 * leaf. The normalizer inserts exactly these to carry a field's geometry,
 * because a width set on an input leaf lands inside an antd Form.Item chain
 * forced to `width: 100% !important` and cannot size a flex track.
 *
 * They are structural, machine-inserted, and mandated — so they must not
 * count against a form's component budget or be reported as orphan wrapper
 * debt. Without this exemption a 4-node form scoring clean at ratio 1.33
 * trips the budget at 2.33 purely because normalization did its job, which
 * would corrupt the very scores used to calibrate the eval threshold.
 *
 * Detected structurally rather than by a marker prop: a marker would be an
 * undeclared property and would itself trip T1-PROP-UNKNOWN.
 */
export function isFieldCell(node) {
  if (node?.type !== 'container') return false;
  const kids = (node.components ?? []).filter((c) => c && typeof c.type === 'string');
  if (kids.length !== 1) return false;
  const child = kids[0];
  // An input leaf: binds a property and holds no children of its own.
  return typeof child.propertyName === 'string'
    && child.propertyName.length > 0
    && !(child.components ?? []).some((c) => c && typeof c.type === 'string');
}

function checkComponentRatio(entries, thresholds, out) {
  const budget = thresholds?.componentBindingRatioBudget;
  if (typeof budget !== 'number' || !(budget > 0)) return;

  const bindings = entries.filter(({ node }) => typeof node.propertyName === 'string' && node.propertyName.length > 0).length;
  if (bindings === 0) return;

  // Exempt normalizer-inserted field cells — see isFieldCell above.
  const counted = entries.filter(({ node }) => !isFieldCell(node));

  const ratio = counted.length / bindings;
  if (ratio > budget) {
    out.push(finding(
      'T3-COMPONENT-RATIO',
      'components',
      `${counted.length} components for ${bindings} bound field(s) (ratio ${ratio.toFixed(2)}) exceeds the provisional budget of ${budget} — this form may be more deeply wrapped/nested than its data warrants. (${entries.length - counted.length} normalizer-inserted field cell(s) excluded.)`,
      `components/bindings <= ${budget}`,
      Number(ratio.toFixed(2)),
    ));
  }
}

// ---------------------------------------------------------------------------
// T3-ORPHAN-CONTAINER
//
// A container with exactly one structural child AND no styling of its own
// (no border/background/shadow/non-empty stylingBox on any breakpoint, and
// no non-default gap/justifyContent/alignItems) is pure wrapper debt — it
// contributes nesting depth and a row in every future diff with nothing to
// show for it. `dimensions.*` and the plain presence of flex prop KEYS are
// deliberately excluded from this "has styling" test: Tier 2's
// T2-STYLE-INCOMPLETE requires every container to carry the full layout
// contract regardless of whether it does anything visually interesting, so
// mere presence of those keys is not evidence of an intentional wrapper —
// only a MEANINGFUL (non-default, non-empty) value is.
// ---------------------------------------------------------------------------

const STYLE_BLOCK_KEYS = ['border', 'background', 'shadow'];
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

function isMeaningfulStyleValue(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || s === '{}' || s === 'none' || s === '0') return false;
    try {
      const parsed = JSON.parse(s);
      return isMeaningfulStyleValue(parsed);
    } catch {
      return true;
    }
  }
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.values(v).some(isMeaningfulStyleValue);
  return Boolean(v);
}

function hasOwnVisualStyling(node) {
  for (const key of STYLE_BLOCK_KEYS) {
    if (isMeaningfulStyleValue(node[key])) return true;
  }
  if (isMeaningfulStyleValue(node.stylingBox)) return true;
  for (const bp of BREAKPOINTS) {
    const b = node[bp];
    if (!isPlainObject(b)) continue;
    for (const key of STYLE_BLOCK_KEYS) {
      if (isMeaningfulStyleValue(b[key])) return true;
    }
    if (isMeaningfulStyleValue(b.stylingBox)) return true;
  }
  if (typeof node.gap === 'number' && node.gap > 0) return true;
  if (node.justifyContent && !['flex-start', 'normal', 'start'].includes(node.justifyContent)) return true;
  if (node.alignItems && !['stretch', 'normal'].includes(node.alignItems)) return true;
  return false;
}

function checkOrphanContainers(entries, out) {
  const childCount = new Map();
  for (const { ctx } of entries) {
    if (!ctx.parent) continue;
    childCount.set(ctx.parent, (childCount.get(ctx.parent) ?? 0) + 1);
  }

  for (const { node, ctx } of entries) {
    if (node.type !== 'container') continue;
    if ((childCount.get(node) ?? 0) !== 1) continue;
    // A field cell is a mandated structural wrapper, not wrapper debt — the
    // normalizer inserts it so the field's geometry has a node that can hold
    // it. Flagging it would be flagging the fix. See isFieldCell.
    if (isFieldCell(node)) continue;
    if (hasOwnVisualStyling(node)) continue;
    out.push(finding(
      'T3-ORPHAN-CONTAINER',
      ctx.path,
      `Container "${nodeLabel(node)}" wraps exactly one child and carries no border/background/shadow/gap/alignment styling of its own — it can likely be removed with its child re-parented to this container's own parent.`,
      'either more than one child, or some styling that justifies the wrapper',
      { childCount: 1, styled: false },
    ));
  }
}

// ---------------------------------------------------------------------------
// T3-NON-AUTHORABLE-TYPE
//
// Purely informational: `authorable: false` types (legacy/hidden/dev-only)
// are expected to show up in existing markup migrated from older forms —
// the brief is explicit that this is legitimate there. It is worth a human
// glance in NEWLY authored markup, hence the lowest weight in the table.
// ---------------------------------------------------------------------------

function checkNonAuthorableType(entries, registry, out) {
  if (!registry?.components) return;
  for (const { node, ctx } of entries) {
    const comp = registry.components[node.type];
    if (comp && comp.authorable === false) {
      out.push(finding(
        'T3-NON-AUTHORABLE-TYPE',
        ctx.path,
        `"${node.type}" is marked authorable: false in the registry (reason: ${comp.authorableReason ?? 'unspecified'}) — legitimate if this is existing/migrated markup, worth a second look if this was just authored.`,
        'an authorable type, or a deliberate legacy/hidden-type choice',
        node.type,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// T3-ROW-CHILD-NOFILL
//
// A container child of a flex ROW whose own desktop `dimensions.width` is
// `"auto"` cannot fill its share of the track: `auto` resolves flex-basis to
// the child's content size and flex-grow defaults to 0, so the child hugs its
// content and the row silently fails to split. Two fields meant to sit
// side-by-side render as two narrow stubs with empty space beside them.
//
// This is deliberately invisible to the styled-ness checks: T2-STYLE-INCOMPLETE
// asks only whether the `width` KEY is present, and `"auto"` is present. So the
// defect passes every blocking gate while looking, to the checks, fully styled.
//
// Report-only on purpose. The width that IS correct depends on intent — an
// equal share (`100%`, letting equal bases shrink to `(track - gaps) / N`), a
// filling main column (`calc(100% - <rail+gap>px)`), or a fixed rail (`<n>px`
// with matching min/max) — so this names the problem and leaves the choice to
// the author. `normalize-form.mjs`'s A3 already applies the equal-share default
// to any width-less row child it wraps; what reaches here is markup that
// declared `"auto"` explicitly, or a container the normalizer did not synthesize.
// ---------------------------------------------------------------------------

const T3_ROW_LIKE = new Set(['row', 'row-reverse']);

function t3DesktopView(node) {
  const merged = {};
  for (const key of ['display', 'flexDirection', 'dimensions']) {
    if (node[key] !== undefined) merged[key] = node[key];
  }
  const nested = isPlainObject(node.desktop) ? node.desktop : {};
  return { ...merged, ...nested };
}

function checkRowChildNoFill(entries, out) {
  for (const { node, ctx } of entries) {
    if (node.type !== 'container') continue;
    const view = t3DesktopView(node);
    if (view.display !== 'flex' || !T3_ROW_LIKE.has(view.flexDirection)) continue;

    const children = Array.isArray(node.components) ? node.components : [];
    // A single child has no siblings to share the track with, so "auto" there
    // is a styling choice rather than a broken split.
    if (children.length < 2) continue;

    for (const child of children) {
      if (!isPlainObject(child) || child.type !== 'container') continue;
      const width = t3DesktopView(child).dimensions?.width;
      if (width !== 'auto') continue;
      out.push(finding(
        'T3-ROW-CHILD-NOFILL',
        `${ctx.path} > ${nodeLabel(child)}`,
        `"${nodeLabel(child)}" is a child of a flex row but its desktop dimensions.width is "auto" — flex-basis resolves to its content size and flex-grow is 0, so it hugs its content instead of taking a share of the row.`,
        'an explicit share of the track — "100%" for an equal split, "calc(100% - <rail+gap>px)" for a filling main column, or "<n>px" with matching minWidth/maxWidth for a fixed rail',
        'auto',
      ));
    }
  }
}
