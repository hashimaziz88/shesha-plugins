#!/usr/bin/env node
/**
 * The normalizer / style expander (Phase 2, Task 7).
 *
 * `normalize(markup, { registry, roles, tokens }) => markup` is a pure,
 * deterministic, IDEMPOTENT function that turns a handful of mechanical
 * declarations (chiefly a container's `role`) into the full, correct markup
 * a human author would otherwise have to type by hand — and deletes a few
 * values that provably do nothing. Expansion is the primary purpose;
 * stripping is secondary.
 *
 * Pipeline (order matters — see the task-7 report):
 *   Phase A — structural / per-node, top-down, mutates in place:
 *     A0. migrate legacy `styleOverrides{}` -> `overrides[]` (override reconciliation)
 *     A1. role -> complete per-breakpoint style block (expand-style.mjs)
 *     A2. columns -> flex container + one child container per column
 *     A3. wrap bare non-container children of a flex-row container
 *     A4. strip customStyle
 *     A5. strip dimensions.width from remaining non-containers
 *     A6. add display:"flex" where gap/flexDirection/etc is set but display isn't
 *     A7. sentence-case `label`
 *   Phase B — needs the FINAL tree shape, single forward (pre-order) walk:
 *     B1. mint/de-duplicate ids
 *     B2. stamp parentId ("root" at top level, else the parent's — possibly
 *         just-minted — id)
 *     B3. stamp version from the registry (skip types whose registry version is null)
 *   Phase C:
 *     C1. canonical prop ordering (deep, whole document) — for byte-identical,
 *         diff-stable output.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flatten, CHILD_KEYS } from './lib/walk.mjs';
import {
  expandRole,
  neutralContainerStyle,
  isPlainObject,
  getPath,
  BREAKPOINTS,
  isSplitWidthValue,
  resolveRole,
} from './lib/expand-style.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function normalize(markup, { registry, roles, tokens } = {}) {
  const doc = structuredClone(markup ?? {});
  doc.components = Array.isArray(doc.components) ? doc.components : [];

  // Phase A — structural + per-node transforms, top-down.
  for (const node of doc.components) {
    visitStructural(node, { roles, tokens });
  }

  // Phase A2 (task 8) — row-list vertical gap, a SEPARATE pass over the tree
  // AFTER Phase A has fully normalized every node. This must not be inlined
  // into visitStructural's own top-down walk: a parent evaluating "are 2+ of
  // my children row-like containers" needs each child's OWN display already
  // fixed (Phase A's A6 step) to answer that reliably, but top-down means
  // the parent is visited BEFORE its children — so on a first pass some
  // children are still pre-fix (display not yet 'flex') and get
  // undercounted, while a SECOND normalize() pass sees them already fixed
  // and counts differently, which broke idempotence (see the task-8
  // report). Running this as its own pass, strictly after Phase A finishes
  // for the WHOLE tree, means every child's display is already stable
  // before any row-list gap decision is made — first pass and every
  // subsequent pass agree.
  for (const node of doc.components) {
    visitRowListGap(node, { roles, tokens });
  }

  // Phase B — id/parentId/version, single ordered pass over the FINAL tree.
  const entries = flatten(doc.components);
  const seenIds = new Set();
  for (const { node, ctx } of entries) {
    fixId(node, ctx, seenIds);
    node.parentId = ctx.parent ? ctx.parent.id : 'root';
    stampVersion(node, registry);
  }

  // Phase C — canonical key ordering, whole document.
  return canonicalizeKeys(doc);
}

// ---------------------------------------------------------------------------
// Phase A — structural / per-node transforms
// ---------------------------------------------------------------------------

const FLEX_PROP_NAMES = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];
const ROW_LIKE = new Set(['row', 'row-reverse']);

function getChildArrayRefs(node) {
  const refs = [];
  if (Array.isArray(node.components)) {
    refs.push({ get: () => node.components });
  }
  if (Array.isArray(node.tabs)) {
    for (const tab of node.tabs) {
      if (isPlainObject(tab) && Array.isArray(tab.components)) refs.push({ get: () => tab.components });
    }
  }
  for (const slotKey of ['content', 'header', 'customHeader']) {
    if (isPlainObject(node[slotKey]) && Array.isArray(node[slotKey].components)) {
      refs.push({ get: () => node[slotKey].components });
    }
  }
  return refs;
}

function visitStructural(node, opts) {
  if (!isPlainObject(node)) return;

  // A0. Migrate the legacy styleOverrides{} shape to the canonical overrides[]
  // shape BEFORE anything else touches the node's style (see report: override
  // reconciliation).
  migrateStyleOverrides(node);

  // A1. role -> complete style (only containers; only when a role is declared).
  if (node.type === 'container' && typeof node.role === 'string' && node.role) {
    applyRoleStyle(node, opts);
  }

  // A2. columns -> flex container + per-column containers.
  if (node.type === 'columns' && Array.isArray(node.columns)) {
    convertColumnsNode(node);
  }

  // A2.1 (task 8). propagate a slot-hosting component's own layout style onto
  // its content/header/customHeader slot when the slot has 2+ children and
  // carries none of its own — see T2-SLOT-STYLE-MISMATCH. Runs before A6/A3
  // (doesn't interact with either) and works off the node's OWN already-
  // resolved style (post role-expansion if this node used a role).
  propagateSlotStyle(node);

  // A2.2 (task 8). wrap any non-container child, in ANY of this node's child
  // slots, that carries a PROPORTIONAL width (%, calc() under 100) directly
  // on itself — see T2-SPLIT-WIDTH-ON-LEAF. Deliberately independent of
  // isFlexRowNode/A3 below: a split-width leaf is wrong under ANY parent
  // (Form.Item forces the leaf's OWN wrapper to 100% regardless of the
  // parent's display mode), and real corpus containers were found carrying
  // their flex props ONLY nested under desktop/tablet/mobile with no
  // top-level mirror — exactly the shape isFlexRowNode's top-level-only
  // check does not see. Runs BEFORE A3: a child this step already wrapped is
  // now type:"container", so A3's own non-container check skips it (no
  // double-wrap).
  wrapSplitWidthLeaves(node);

  // A6 (before A3 on purpose). add display:"flex" wherever a flex-only prop
  // is set without it. MUST run before the flex-row wrap check below: a
  // container authored with e.g. display:"grid" + flexDirection:"row" is not
  // yet detected as a flex row until this fixes `display`, and running the
  // wrap check first would make its own output re-triggerable on a SECOND
  // pass (the wrap check would fire only once display had already been
  // patched by a prior run) — a direct idempotence break. Fixing display
  // first means both the first AND every subsequent pass see the same
  // flex-row determination.
  if (node.type === 'container') ensureDisplayFlex(node);

  // A3. wrap bare non-container children of a flex-row container.
  if (node.type === 'container' && isFlexRowNode(node) && Array.isArray(node.components)) {
    node.components = node.components.map((child) => (needsFlexChildWrap(child) ? wrapFlexChild(child) : child));
  }

  // A4. strip customStyle (0 corpus occurrences; pure dead weight).
  if ('customStyle' in node) delete node.customStyle;

  // A5. strip dimensions.width from remaining non-containers (anything A3
  // didn't already relocate onto a wrapper).
  if (node.type !== 'container') stripDimensionsWidth(node);

  // A7. sentence-case the label.
  if (typeof node.label === 'string') node.label = sentenceCaseLabel(node.label);

  // Recurse into whatever child arrays now exist (post A1-A3/A2.1-A2.2 mutation).
  for (const ref of getChildArrayRefs(node)) {
    for (const child of ref.get()) visitStructural(child, opts);
  }
}

// --- A0. override reconciliation -------------------------------------------
//
// tier2.mjs's T2-STYLE-OFF-TOKEN and the Phase 1 blueprint schema
// (../shesha-design-comprehension/assets/blueprint.schema.json) each define a
// shape for "this style value carries measured provenance": tier2 originated
// `styleOverrides[path] = {source, evidence}`; the blueprint schema — older
// and more explicit — defines `overrides[] = {prop, value, source, evidence}`.
// This normalizer standardises on the blueprint's `overrides[]` (tier2.mjs is
// updated to match; see the task-7 report) and migrates any markup still
// carrying the legacy shape forward, so a role-expansion later in this same
// pass has the provenance it needs to avoid clobbering a deliberate value.
function migrateStyleOverrides(node) {
  if (!isPlainObject(node.styleOverrides)) return;
  const migrated = Array.isArray(node.overrides) ? [...node.overrides] : [];
  for (const [prop, rec] of Object.entries(node.styleOverrides)) {
    if (!isPlainObject(rec)) continue;
    migrated.push({
      prop,
      value: getPath(node, prop),
      source: rec.source,
      evidence: rec.evidence,
    });
  }
  node.overrides = migrated;
  delete node.styleOverrides;
}

// --- A1. role -> complete style ---------------------------------------------

function applyRoleStyle(node, { roles, tokens }) {
  const styles = expandRole(node.role, { roles, tokens }, node.overrides);
  for (const bp of BREAKPOINTS) node[bp] = styles[bp];
  for (const p of FLEX_PROP_NAMES) node[p] = styles.desktop[p];
  delete node.role;
}

// --- A2. columns -> flex container -------------------------------------------

function convertColumnsNode(node) {
  const slots = node.columns.filter(isPlainObject);
  const gap = typeof node.gutterX === 'number' ? node.gutterX : 0;
  delete node.columns;
  delete node.gutterX;
  delete node.gutterY;
  node.type = 'container';

  const children = slots.map((slot, idx) => buildColumnContainer(slot, idx));
  node.components = children;
  applyNeutralStyleTo(node, { flexDirection: 'row' });
  // Row gap comes from the original gutter, if any (mirror onto top-level + breakpoints).
  node.gap = gap;
  for (const bp of BREAKPOINTS) node[bp].gap = gap;
}

function buildColumnContainer(slot, idx) {
  const flex = typeof slot.flex === 'number' ? slot.flex : 24;
  const pct = `${round2((flex / 24) * 100)}%`;
  const child = {
    type: 'container',
    componentName: `column${idx + 1}`,
    components: Array.isArray(slot.components) ? slot.components : [],
  };
  applyNeutralStyleTo(child, {
    flexDirection: 'column',
    widthByBp: { desktop: pct, tablet: '100%', mobile: '100%' },
  });
  return child;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function applyNeutralStyleTo(node, { flexDirection, widthByBp }) {
  const styles = neutralContainerStyle({ flexDirection, widthByBp });
  for (const bp of BREAKPOINTS) node[bp] = styles[bp];
  for (const p of FLEX_PROP_NAMES) node[p] = styles.desktop[p];
}

// --- A3. wrap bare flex-row children -----------------------------------------

// Mirrors tier2.mjs's T2-FLEXCHILD-NOT-CONTAINER isFlexRow() exactly: a
// merged desktop view (top-level flex props, with a nested `desktop` block
// overriding), NOT a top-level-only check. Real corpus containers were found
// carrying their flex-row style ONLY nested under desktop/tablet/mobile with
// no top-level mirror (docs/corpus-report.md Task 9's dashboard.json case) —
// under the old top-level-only check this normalizer never even recognised
// such a container as a flex row, so A3 never ran on its children at all,
// regardless of whether they carried a width. Using the same desktopView()
// helper A2.1/A8 already use below keeps this check and T2-FLEXCHILD-NOT-
// CONTAINER's own definition of "flex row" identical, so whatever the
// normalizer now fixes is exactly what that check would otherwise flag.
function isFlexRowNode(node) {
  const view = desktopView(node);
  return view.display === 'flex' && ROW_LIKE.has(view.flexDirection);
}

// The universal container rule (project owner, verbatim): every component
// sits inside its own container, with layout settings applied on that
// container — never on the component leaf itself. The framework backs this:
// an input renders inside an antd Form.Item chain forced width:100%
// !important, so geometry set on the leaf can never size the track it sits
// in. This has always been unconditional on the child's OWN width (any
// non-container child of a flex-row container needs wrapping, not just one
// carrying a proportional width) — the previously-reported "only wraps
// proportional-width leaves" gap was really isFlexRowNode's top-level-only
// blind spot above, which meant this function's own body never ran at all
// for a desktop-only flex row's children.
function needsFlexChildWrap(child) {
  return isPlainObject(child) && typeof child.type === 'string' && child.type !== 'container';
}

// A width-less child of a flex ROW must not fall through to
// neutralContainerStyle's `width:"auto"` default. `auto` resolves flex-basis to
// the child's content size, and flex-grow is 0, so the wrapper hugs its content
// and the row never splits — two fields in a row each shrink to their own label
// width and leave the rest of the track empty. That is a layout defect the
// styled-ness checks cannot see, because T2-STYLE-INCOMPLETE only asks whether
// the `width` key is PRESENT, and `"auto"` satisfies it.
//
// `100%` at every breakpoint is the fix, and it needs no knowledge of the
// sibling count: every width-less child gets an equal flex-basis of the full
// track, flex-shrink defaults to 1, and minWidth is already `0`, so N children
// shrink proportionally to exactly `(track - gaps) / N` each. A sibling with a
// real declared width keeps it, and a fixed rail declared with matching
// minWidth/maxWidth (the documented convention) does not shrink at all.
const FILL_ROW_WIDTH = Object.freeze({ desktop: '100%', tablet: '100%', mobile: '100%' });

function wrapFlexChild(child) {
  const extracted = extractAndStripWidth(child);
  // Empty only ever means "A3 wrapped a width-less child of a flex row" —
  // A2.2's trigger (hasSplitWidth) guarantees a width was present there.
  const widthByBp = Object.keys(extracted).length > 0 ? extracted : { ...FILL_ROW_WIDTH };
  const wrapper = {
    type: 'container',
    componentName: `${child.propertyName ?? child.componentName ?? 'field'}Wrap`,
    components: [child],
  };
  applyNeutralStyleTo(wrapper, { flexDirection: 'column', widthByBp });
  // The wrapper now carries the geometry; stamp the leaf's own width
  // explicitly to "100%" (never leave it absent) — an honest, literal
  // statement of what the Form.Item chain already forces, rather than
  // silence that could be mistaken for "never considered." A5
  // (stripDimensionsWidth) is taught to leave this exact value alone (see
  // its own comment) so it survives both this same pass and a second whole-
  // document normalize() pass unchanged — required for idempotence.
  if (!isPlainObject(child.dimensions)) child.dimensions = {};
  child.dimensions.width = '100%';
  return wrapper;
}

function extractAndStripWidth(child) {
  const widths = {};
  for (const bp of BREAKPOINTS) {
    const w = child[bp]?.dimensions?.width;
    if (w !== undefined) {
      widths[bp] = w;
      delete child[bp].dimensions.width;
    }
  }
  if (child.dimensions?.width !== undefined) {
    if (widths.desktop === undefined) widths.desktop = child.dimensions.width;
    delete child.dimensions.width;
  }
  return widths;
}

// --- A2.1. propagate slot-hosting component's own style to its slot (task 8) -
//
// Mirror of tier2.mjs's T2-SLOT-STYLE-MISMATCH check: a component whose
// children live in a separate content/header/customHeader slot styles the
// OUTER node via its own top-level/per-breakpoint props, but the slot's
// children are laid out by whatever style sits on the SLOT OBJECT ITSELF —
// a fully separate prop surface. Fix: copy the node's own resolved layout
// style directly onto the slot when the slot has 2+ children and none of
// its own (matches the check's own >=2 threshold — a single-child slot has
// no adjacency to collapse, so nothing to fix).

const SLOT_KEYS = ['content', 'header', 'customHeader'];

/** Merge a node's top-level flex props with its `desktop` breakpoint block
 * (the nested value wins) — the same merge tier2.mjs's bpView() performs,
 * needed here because real corpus containers were found carrying flex
 * props ONLY nested under desktop/tablet/mobile with no top-level mirror. */
function desktopView(node) {
  const merged = {};
  for (const key of FLEX_PROP_NAMES) {
    if (node[key] !== undefined) merged[key] = node[key];
  }
  const nested = isPlainObject(node.desktop) ? node.desktop : {};
  return { ...merged, ...nested };
}

function propagateSlotStyle(node) {
  for (const slotKey of SLOT_KEYS) {
    const slot = node[slotKey];
    if (!isPlainObject(slot) || !Array.isArray(slot.components) || slot.components.length < 2) continue;
    const slotHasAnyStyle = FLEX_PROP_NAMES.some((p) => slot[p] !== undefined);
    if (slotHasAnyStyle) continue;
    const view = desktopView(node);
    for (const p of FLEX_PROP_NAMES) {
      if (view[p] !== undefined) slot[p] = view[p];
    }
  }
}

// --- A2.2. wrap a split-width leaf, anywhere, independent of A3 (task 8) -----
//
// Mirror of tier2.mjs's T2-SPLIT-WIDTH-ON-LEAF check. Deliberately does NOT
// reuse isFlexRowNode's top-level-only flex-row detection (A3's own
// trigger): a proportional width on a leaf is wrong under ANY parent, flex-
// row or not, since the leaf's own Form.Item wrapper is forced 100% either
// way. Reuses A3's own wrapFlexChild/extractAndStripWidth verbatim — the
// repair (extract the width(s) onto a new wrapper container, leave the leaf
// width-less so Form.Item's forced 100% is the only value in effect) is
// identical; only the TRIGGER differs (any split width, not "any non-
// container child of a flex-row parent").

function hasSplitWidth(child) {
  if (!isPlainObject(child) || child.type === 'container') return false;
  if (isSplitWidthValue(child.dimensions?.width)) return true;
  return BREAKPOINTS.some((bp) => isSplitWidthValue(child[bp]?.dimensions?.width));
}

function wrapSplitWidthLeaves(node) {
  for (const ref of getChildArrayRefs(node)) {
    const arr = ref.get();
    for (let i = 0; i < arr.length; i++) {
      if (hasSplitWidth(arr[i])) arr[i] = wrapFlexChild(arr[i]);
    }
  }
}

// --- A5. strip dimensions.width from non-containers --------------------------
//
// "100%" is deliberately left alone, not stripped: it is the literal
// end-state wrapFlexChild (A3/A2.2) stamps onto a leaf it just wrapped —
// an honest statement of what the Form.Item chain already forces, not a
// misleading real size. Stripping it here would undo A3's own stamp on the
// very same top-down pass (this leaf is revisited, as the wrapper's own
// child, later in the same visitStructural walk) and reintroduce it via
// wrapFlexChild's stamp every subsequent pass — a direct idempotence break.
// Only a REAL (non-"100%") width, which A3/A2.2 don't produce, is stripped.

function stripDimensionsWidth(node) {
  if (node.dimensions && 'width' in node.dimensions && node.dimensions.width !== '100%') {
    delete node.dimensions.width;
  }
  for (const bp of BREAKPOINTS) {
    if (node[bp]?.dimensions && 'width' in node[bp].dimensions && node[bp].dimensions.width !== '100%') {
      delete node[bp].dimensions.width;
    }
  }
}

// --- A6. add display:"flex" where a flex-only prop is set --------------------

const FLEX_TRIGGER_PROPS = ['flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];

function hasFlexTrigger(obj) {
  return isPlainObject(obj) && FLEX_TRIGGER_PROPS.some((k) => obj[k] !== undefined);
}

function ensureDisplayFlex(node) {
  if (hasFlexTrigger(node) && node.display !== 'flex') node.display = 'flex';
  for (const bp of BREAKPOINTS) {
    const nested = node[bp];
    if (!isPlainObject(nested)) continue;
    const effectiveDisplay = nested.display !== undefined ? nested.display : node.display;
    if (hasFlexTrigger(nested) && effectiveDisplay !== 'flex') nested.display = 'flex';
  }
}

// --- A8. stamp a vertical gap on a row-list host (task 8) --------------------
//
// Mirror of tier2.mjs's T2-ROWLIST-NO-VGAP check. Two host shapes, because a
// "row list" can sit under either a real `container` (has its own gap prop —
// stamp it directly) or a `tabs` component's tab-pane object (the registry's
// "tabs" schema gives tab-pane objects, {id, key, title, components}, NO
// style props at all — a pane can never carry a fix-able gap, so the rows
// are wrapped in one new child container that carries it instead).
//
// SECTION_GAP resolves dynamically off the design-system's "section-card"
// role (flexDirection:"column", the same vertical-stack shape a row list
// is) when roles/tokens are available, falling back to the literal 16
// ($spacing.4 in shesha.tokens.json — also detail-rail/dialog-root/
// wizard-shell's gap) otherwise, so a brand/token change is picked up
// without touching this file.

function isRowLikeContainerForNormalize(child) {
  if (!isPlainObject(child) || child.type !== 'container') return false;
  const view = desktopView(child);
  return view.display === 'flex' && ROW_LIKE.has(view.flexDirection);
}

function hasPositiveGapValue(gap) {
  if (typeof gap === 'number') return gap > 0;
  if (typeof gap === 'string') return parseFloat(gap) > 0;
  return false;
}

function sectionGapValue({ roles, tokens } = {}) {
  try {
    const resolved = resolveRole('section-card', { roles, tokens });
    if (typeof resolved?.desktop?.gap === 'number') return resolved.desktop.gap;
  } catch {
    // fall through to the literal default below
  }
  return 16; // $spacing.4 — see the header comment above
}

function stampGap(node, gap) {
  node.gap = gap;
  for (const bp of BREAKPOINTS) {
    if (!isPlainObject(node[bp])) node[bp] = {};
    node[bp].gap = gap;
  }
}

function normalizeRowListGap(node, opts) {
  if (node.type !== 'container') return;
  const children = Array.isArray(node.components) ? node.components : [];
  const rowChildren = children.filter(isRowLikeContainerForNormalize);
  if (rowChildren.length < 2) return;
  if (hasPositiveGapValue(desktopView(node).gap)) return;
  stampGap(node, sectionGapValue(opts));
  // The gap we just stamped is itself a flex-trigger prop; fix `display` in
  // the SAME step rather than waiting for a future pass's A6 to notice it
  // (this runs strictly after Phase A/A6, in its own pass — see the
  // Phase A2 comment in normalize() for why).
  ensureDisplayFlex(node);
}

function normalizeTabRowListGap(node, opts) {
  if (node.type !== 'tabs' || !Array.isArray(node.tabs)) return;
  for (const tab of node.tabs) {
    if (!isPlainObject(tab) || !Array.isArray(tab.components)) continue;
    const rowChildren = tab.components.filter(isRowLikeContainerForNormalize);
    if (rowChildren.length < 2) continue; // already wrapped (1 child) or nothing to wrap
    const wrapper = {
      type: 'container',
      componentName: 'sectionGap',
      components: tab.components,
    };
    applyNeutralStyleTo(wrapper, { flexDirection: 'column' });
    stampGap(wrapper, sectionGapValue(opts));
    tab.components = [wrapper];
  }
}

/**
 * Phase A2's own driver: recurse the (already Phase-A-normalized) tree,
 * applying the two row-list-gap transforms at every node. Separate from
 * visitStructural's own recursion (see normalize()'s Phase A2 comment for
 * why this must run as an independent pass rather than being inlined into
 * the top-down Phase A walk).
 */
function visitRowListGap(node, opts) {
  if (!isPlainObject(node)) return;
  normalizeRowListGap(node, opts);
  normalizeTabRowListGap(node, opts);
  for (const ref of getChildArrayRefs(node)) {
    for (const child of ref.get()) visitRowListGap(child, opts);
  }
}

// --- A7. sentence-case labels -------------------------------------------------
//
// Rule (documented in full in the task-7 report): capitalize the first
// letter of the first word; lowercase every subsequent word — UNLESS that
// word is (a) fully uppercase, 2+ letters ("ID", "URL", "VAT": treated as an
// acronym), (b) carries an uppercase letter past its own first character
// ("DevOps", "McDonald", "iPhone": treated as an intentionally-cased brand/
// compound word), or (c) matches the curated proper-noun allowlist below
// (case-insensitive), in which case it is Title-cased regardless of position.
// This is a heuristic, not NLP — the allowlist is small and extend-only.
const PROPER_NOUN_WORDS = new Set([
  'i',
  'south', 'north', 'east', 'west',
  'africa', 'african', 'america', 'american', 'europe', 'european',
  'asia', 'asian', 'australia', 'australian', 'antarctica',
  'england', 'english', 'scotland', 'scottish', 'wales', 'welsh',
  'ireland', 'irish', 'britain', 'british', 'kingdom', 'united', 'states',
  'london', 'york', 'zealand',
  'shesha', 'boxfusion',
]);

function capitalizeFirst(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Splice `newLetters` back into `token`'s letter-run positions, preserving non-letter characters. */
function applyLettersToToken(token, newLetters) {
  let consumed = 0;
  return token.replace(/[A-Za-z]+/g, (run) => {
    const replacement = newLetters.slice(consumed, consumed + run.length);
    consumed += run.length;
    return replacement;
  });
}

function transformWord(token, wordIndex) {
  const letters = token.replace(/[^A-Za-z]/g, '');
  if (!letters) return token; // punctuation-only token, nothing to case

  // Acronym: entirely uppercase (2+ letters) — preserve verbatim.
  if (letters.length >= 2 && letters === letters.toUpperCase()) return token;

  const lower = letters.toLowerCase();

  // Curated proper-noun allowlist — Title-case regardless of position.
  if (PROPER_NOUN_WORDS.has(lower)) {
    return applyLettersToToken(token, capitalizeFirst(lower));
  }

  // Mixed-case / embedded-caps (DevOps, McDonald, iPhone) — preserve verbatim.
  if (/[A-Z]/.test(token.slice(1))) return token;

  if (wordIndex === 0) {
    return applyLettersToToken(token, capitalizeFirst(lower));
  }
  return applyLettersToToken(token, lower);
}

export function sentenceCaseLabel(label) {
  if (typeof label !== 'string' || !label) return label;
  let wordIndex = -1;
  return label
    .split(/(\s+)/)
    .map((tok) => {
      if (tok === '' || /^\s+$/.test(tok)) return tok;
      wordIndex += 1;
      return transformWord(tok, wordIndex);
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Phase B — id / parentId / version (single ordered pass, entries are
// pre-order so a parent's (possibly just-minted) id is already final by the
// time a child reads it via ctx.parent).
// ---------------------------------------------------------------------------

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(v) {
  return typeof v === 'string' && UUID_V4_RE.test(v);
}

/**
 * Deterministic v4-shaped UUID, seeded from a stable input string. Using
 * `ctx.path` (unique per node, by construction of walk.mjs) as the seed means
 * the SAME input markup always mints the SAME replacement id — required for
 * both idempotence (a second normalize() pass sees only already-valid,
 * already-unique ids) and determinism (same input -> byte-identical output).
 * A real crypto.randomUUID() would violate both.
 */
function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; // version nibble
  const variants = '89ab';
  hex[16] = variants[parseInt(hex[16], 16) % 4]; // variant nibble
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function fixId(node, ctx, seenIds) {
  const isDupe = typeof node.id === 'string' && seenIds.has(node.id);
  if (!isUuidV4(node.id) || isDupe) {
    let seed = `shesha-normalize-id:${ctx.path}:${String(node.id ?? '')}`;
    let candidate = deterministicUuid(seed);
    // Vanishingly unlikely, but guard against a hash collision with an
    // already-assigned id rather than silently reintroducing a duplicate.
    let salt = 0;
    while (seenIds.has(candidate)) {
      salt += 1;
      candidate = deterministicUuid(`${seed}:${salt}`);
    }
    node.id = candidate;
  }
  seenIds.add(node.id);
}

function stampVersion(node, registry) {
  const comp = registry?.components?.[node.type];
  if (!comp || comp.version === null) return; // no migrator for this type — leave as authored
  node.version = comp.version;
}

// ---------------------------------------------------------------------------
// Phase C — canonical key ordering
// ---------------------------------------------------------------------------

const CANONICAL_KEY_ORDER = [
  'id', 'type', 'isDynamic', 'componentName', 'name', 'propertyName',
  'label', 'labelAlign', 'hideLabel', 'hideBorder',
  'parentId', 'version', 'editMode', 'hidden', 'permissions', 'tooltip', 'description',
  'display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems',
  'desktop', 'tablet', 'mobile',
  'validate', 'defaultValue', 'dataSourceType', 'textType',
  'overrides',
  'components', 'columns', 'tabs', 'content', 'header', 'customHeader', 'items',
];
const CANONICAL_INDEX = new Map(CANONICAL_KEY_ORDER.map((k, i) => [k, i]));

function canonicalizeKeys(value) {
  if (Array.isArray(value)) return value.map(canonicalizeKeys);
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const known = keys.filter((k) => CANONICAL_INDEX.has(k)).sort((a, b) => CANONICAL_INDEX.get(a) - CANONICAL_INDEX.get(b));
    const rest = keys.filter((k) => !CANONICAL_INDEX.has(k)).sort();
    const out = {};
    for (const k of [...known, ...rest]) out[k] = canonicalizeKeys(value[k]);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadJson(relPath) {
  return JSON.parse(readFileSync(join(HERE, relPath), 'utf8'));
}

function runCli(argv) {
  const args = argv.slice(2);
  const inPath = args[0];
  if (!inPath) {
    process.stderr.write('Usage: node scripts/normalize-form.mjs <in.json> [--out <out.json>]\n');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

  const registry = loadJson('../assets/registry/registry-0.45.1.json');
  const roles = loadJson('../../shesha-design-system/assets/roles.styles.json');
  const tokens = loadJson('../../shesha-design-system/assets/themes/shesha.tokens.json');

  const markup = JSON.parse(readFileSync(resolve(inPath), 'utf8'));
  const result = normalize(markup, { registry, roles, tokens });
  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    writeFileSync(resolve(outPath), json + '\n', 'utf8');
  } else {
    process.stdout.write(json + '\n');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv);
}
