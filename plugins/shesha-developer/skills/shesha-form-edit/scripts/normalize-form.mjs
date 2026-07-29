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

  // Recurse into whatever child arrays now exist (post A1-A3 mutation).
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

function isFlexRowNode(node) {
  return node.display === 'flex' && ROW_LIKE.has(node.flexDirection);
}

function needsFlexChildWrap(child) {
  return isPlainObject(child) && typeof child.type === 'string' && child.type !== 'container';
}

function wrapFlexChild(child) {
  const widthByBp = extractAndStripWidth(child);
  const wrapper = {
    type: 'container',
    componentName: `${child.propertyName ?? child.componentName ?? 'field'}Wrap`,
    components: [child],
  };
  applyNeutralStyleTo(wrapper, { flexDirection: 'column', widthByBp });
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

// --- A5. strip dimensions.width from non-containers --------------------------

function stripDimensionsWidth(node) {
  if (node.dimensions && 'width' in node.dimensions) delete node.dimensions.width;
  for (const bp of BREAKPOINTS) {
    if (node[bp]?.dimensions && 'width' in node[bp].dimensions) delete node[bp].dimensions.width;
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
