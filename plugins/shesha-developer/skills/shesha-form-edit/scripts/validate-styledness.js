#!/usr/bin/env node
/**
 * validate-styledness.js — fails forms that would render structure-only / default AntD.
 *
 * Usage: node scripts/validate-styledness.js <form.json> [--generation 043|045] [--warn-only]
 *                                            [--archetype <blueprint archetype>]
 *                                            [--metadata <entity-metadata.json>]
 *
 * Accepts raw markup ({components:[...]}), a GetJson response, or a golden wrapper.
 * Checks (FAIL unless --warn-only):
 *   1. page-chrome  — a root-level card/container establishing page ground (background or
 *                     className like "sha-page", or explicit page padding).
 *   2. style-coverage — share of visual components carrying ANY explicit styling
 *                     (0.45: desktop/tablet/mobile blocks; 0.43: style/stylingBox/flat props).
 *                     FAIL below 40%, WARN below 70%.
 *   3. typography   — at least one explicit font declaration somewhere in the tree.
 *   4. inline-style-conflict — WARN when a component has both an inline `style` string and
 *                     structured style blocks (inline wins and silently masks the rest).
 *   5. page-anatomy — a PAGE archetype (table-worklist/record-detail/hub/dashboard) must open
 *                     with a header band: a first-child container/KeyInformationBar that
 *                     carries a surface (background or a bottom hairline) AND a title-scale
 *                     text descendant. Detection is STRUCTURAL; the compiler's deterministic
 *                     componentName is accepted as a hint, never as the only evidence.
 *   6. status-as-text — a reference-list status property rendered as text/textField instead of
 *                     refListStatus. A status is a CHIP; plain text throws the lifecycle away.
 *                     Covers BOTH carriers: a status-bound component, AND a datatable COLUMN
 *                     whose `displayComponent` is `[default]` / a text type (which renders the
 *                     raw enum number — the same lifecycle loss, one level deeper). For a
 *                     column the severity follows what the author could have KNOWN:
 *                     FAIL when the reference-list identity is knowable (this form already
 *                     identifies that property elsewhere, or --metadata says it is a reference
 *                     list), WARN when it is not (an offline compile with no declared
 *                     `bindings[].referenceList` cannot invent an identity [R-015]).
 *   7. datatable-presentation — every datatable must author the grid presentation channels the
 *                     measured matrix proves render: `rowDimensions.height` (density) plus one
 *                     of `headerBackgroundColor` / a `desktop.font` block. NOTE: the obvious
 *                     hover/stripe props (rowHoverBackgroundColor, striped, rowDividers,
 *                     rowPaddingTop/Bottom) are all `not-measured` in
 *                     assets/measured-capability-matrix.json, so they are NOT accepted as
 *                     evidence — an unproven channel is not styling.
 *
 * The archetype is a BLUEPRINT fact, not a component, so it cannot be read off the markup.
 * compile-blueprint.js passes --archetype from its self-gate. Without the flag check 5
 * degrades to a WARN ("archetype unknown") — never to a silent pass.
 * Exit: 0 pass, 1 fail. Findings printed as FAIL/WARN/OK lines.
 */
import fs from 'fs';

const argv = process.argv.slice(2);
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const VALUED_FLAGS = new Set(['--generation', '--archetype', '--metadata']);
const file = argv.find((a, i) => !a.startsWith('--') && !VALUED_FLAGS.has(argv[i - 1]));
const warnOnly = argv.includes('--warn-only');
const generation = flagVal('--generation') ?? '045';
const archetype = flagVal('--archetype') ?? null;
// Optional entity metadata (the same shape validate-guardrails.js takes as arg 2). Present =
// the reference-list identity of a property is KNOWABLE, which is what turns a status column
// left on `[default]` from a WARN into a FAIL. Absent is the normal offline case.
const metadataFile = flagVal('--metadata') ?? null;
// The blueprint's own `chrome: false` opt-out, forwarded by compile-blueprint.js. A screen
// embedded in a host page that already draws a header genuinely has no band; the check
// reports that as a WARN so the decision stays visible instead of disappearing.
const chromeOptOut = argv.includes('--no-page-anatomy');

if (!file) { console.error('usage: validate-styledness.js <form.json> [--generation 043|045] [--warn-only] [--archetype <archetype>]'); process.exit(1); }

let doc = JSON.parse(fs.readFileSync(file, 'utf8'));
if (doc.markup && typeof doc.markup === 'object') doc = doc.markup;
if (typeof doc.markup === 'string') doc = JSON.parse(doc.markup);
const components = doc.components || (Array.isArray(doc) ? doc : null);
if (!components) { console.error('FAIL no components tree found'); process.exit(1); }

const VISUAL = new Set(['container', 'card', 'text', 'textField', 'textArea', 'numberField', 'dropdown',
  'autocomplete', 'button', 'buttonGroup', 'datatable', 'datalist', 'alert', 'collapsiblePanel', 'tabs',
  'columns', 'sectionSeparator', 'refListStatus', 'statusTag', 'dateField', 'checkbox', 'radio', 'progress',
  'KeyInformationBar', 'statistic']);
const findings = [];
let visual = 0, styled = 0, fontDecls = 0, inlineConflicts = 0;
const datatables = [];   // for check 7
const statusAsText = []; // for check 6

// A reference-list status property name (status / state / stage, plain or suffixed) and the
// component types that would render it as prose. `text` is included: a bound text node shows
// the raw enum member, not the chip.
const STATUS_PROP = /(^|[a-z])(status|state|stage)$/;
const PLAIN_TEXT_TYPES = new Set(['text', 'textField', 'textArea']);
// the cell carriers that DO render a lifecycle as a chip
const CHIP_TYPES = new Set(['refListStatus', 'refListDropDown', 'statusTag']);
// a column path is dotted (`asset.status`), so the lifecycle test reads the LAST segment
const isStatusPath = (prop) => STATUS_PROP.test(String(prop).split('.').pop());
// properties this form (or the supplied metadata) already IDENTIFIES as a reference list —
// evidence that a chip was possible, keyed by the last path segment so `asset.status` and
// `status` are the same lifecycle
const reflistKnown = new Set();
const noteKnown = (prop) => { if (prop) reflistKnown.add(String(prop).split('.').pop().toLowerCase()); };

if (metadataFile) {
  try {
    let m = JSON.parse(fs.readFileSync(metadataFile, 'utf8').replace(/^﻿/, ''));
    const rows = Array.isArray(m) ? m
      : (Array.isArray(m?.result) ? m.result
      : (Array.isArray(m?.result?.properties) ? m.result.properties
      : (Array.isArray(m?.properties) ? m.properties : [])));
    for (const p of rows) if (p?.path && p.referenceListName) noteKnown(p.path);
  } catch {
    findings.push(`WARN status-as-text — --metadata ${metadataFile} could not be read; column severity falls back to the offline (WARN) rule`);
  }
}

function hasStructuredStyle(c) {
  if (generation === '045') {
    return ['desktop', 'tablet', 'mobile'].some((k) => c[k] && typeof c[k] === 'object' && Object.keys(c[k]).length);
  }
  return Boolean(c.style || c.stylingBox || c.backgroundColor || c.color || c.fontSize || c.fontWeight);
}
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (typeof node.type === 'string') {
    if (VISUAL.has(node.type)) {
      visual++;
      if (hasStructuredStyle(node) || node.className || node.stylingBox) styled++;
    }
    const blob = JSON.stringify(node);
    if (/"font"\s*:\s*{/.test(blob) || node.fontSize || node.fontWeight) fontDecls++;
    if (typeof node.style === 'string' && node.style.trim() && hasStructuredStyle(node)) {
      inlineConflicts++;
      findings.push(`WARN inline-style-conflict on ${node.type} "${node.propertyName || node.componentName || node.id}" — inline style string wins over structured blocks`);
    }
    if (node.type === 'datatable') datatables.push(node);
    if (STATUS_PROP.test(String(node.propertyName || '')) && PLAIN_TEXT_TYPES.has(node.type)) statusAsText.push(node);
    // in-form identity evidence: a component (or a column cell) that names a reference list
    // proves the identity of that property was available to whoever authored this form
    if (node.referenceListId && (node.referenceListId.name || typeof node.referenceListId === 'string')) noteKnown(node.propertyName);
  }
  // a chip CELL identifies the column's property, and the cell carries no propertyName of its own
  if (Array.isArray(node.items)) {
    for (const it of node.items) {
      if (it && typeof it === 'object' && CHIP_TYPES.has(it.displayComponent?.type)) noteKnown(it.propertyName);
    }
  }
  for (const k of Object.keys(node)) walk(node[k]);
}
walk(components);

// 1. page chrome
const rootBlob = JSON.stringify(components.slice ? components.slice(0, 3) : components).slice(0, 20000);
const hasChrome = /sha-page/.test(rootBlob) || /"background"\s*:\s*{/.test(rootBlob) || /"hideHeading"\s*:\s*true/.test(rootBlob);
findings.push(`${hasChrome ? 'OK  ' : 'FAIL'} page-chrome — ${hasChrome ? 'page ground present' : 'no page ground (sha-page class / root background / hideHeading card) — will render default AntD'}`);

// 2. coverage
const cov = visual ? Math.round((styled / visual) * 100) : 0;
const covLevel = cov >= 70 ? 'OK  ' : cov >= 40 ? 'WARN' : 'FAIL';
findings.push(`${covLevel} style-coverage — ${styled}/${visual} visual components styled (${cov}%; generation ${generation})`);

// 3. typography
findings.push(`${fontDecls ? 'OK  ' : 'FAIL'} typography — ${fontDecls} explicit font declaration(s)`);

// 5. page anatomy — a page archetype opens with a header band.
// A band is recognised STRUCTURALLY: a container (or KeyInformationBar) that is the first
// child of the page root, carries a surface (background, or a bottom hairline border), and
// holds a title-scale text descendant. The compiler's deterministic "pageHeaderBand" name is
// a HINT that shortcuts the surface test — it can never substitute for the title.
const PAGE_ARCHETYPES = new Set(['table-worklist', 'record-detail', 'hub', 'dashboard']);
const TITLE_MIN_PX = 18;   // the smallest type step any shipped theme uses for a page title
const BAND_HINT = /(pageHeader|headerBand|pageTitleBand)/i;

const firstChildOfPageRoot = () => {
  const root = Array.isArray(components) ? components[0] : null;
  if (!root || typeof root !== 'object') return null;
  const kids = Array.isArray(root.components) ? root.components : [];
  return kids[0] ?? null;
};
const carriesSurface = (n) => {
  const blocks = ['desktop', 'tablet', 'mobile'].map((k) => n[k]).filter((b) => b && typeof b === 'object');
  return blocks.some((b) => (b.background && Object.keys(b.background).length)
    || (b.border && JSON.stringify(b.border).includes('bottom'))
    || (b.border && Object.keys(b.border).length));
};
const titleText = (n) => {
  let hit = null;
  (function w(x) {
    if (hit || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(w);
    if (x.type === 'text' && String(x.content ?? '').trim()) {
      const size = Number(['desktop', 'tablet', 'mobile'].map((k) => x[k]?.font?.size).find((s) => s != null));
      if (Number.isFinite(size) && size >= TITLE_MIN_PX) { hit = x; return; }
    }
    for (const v of Object.values(x)) w(v);
  })(n);
  return hit;
};

if (chromeOptOut) {
  findings.push(`WARN page-anatomy — the blueprint opted out (chrome:false)${archetype ? ` on a "${archetype}" page` : ''}; the page-header-band floor was waived by the author`);
} else if (!archetype) {
  findings.push('WARN page-anatomy — archetype unknown (pass --archetype; compile-blueprint.js does this from its self-gate) — the page-header-band floor was NOT enforced');
} else if (!PAGE_ARCHETYPES.has(archetype)) {
  findings.push(`OK   page-anatomy — archetype "${archetype}" is not a page archetype; dialogs/login pages carry no page chrome by design`);
} else {
  const first = firstChildOfPageRoot();
  const kind = first?.type;
  const structural = (kind === 'container' || kind === 'card' || kind === 'KeyInformationBar');
  const surface = structural && (carriesSurface(first) || BAND_HINT.test(String(first.componentName ?? '')));
  const title = structural ? titleText(first) : null;
  if (structural && surface && title) {
    findings.push(`OK   page-anatomy — page-header band present ("${first.componentName ?? first.id}", title "${String(title.content).slice(0, 40)}")`);
  } else {
    const why = !structural ? `the page root opens with ${kind ? `a ${kind}` : 'nothing'}, not a band container/KeyInformationBar`
      : !surface ? `"${first.componentName ?? first.id}" carries no band surface (no background and no border in any breakpoint block)`
      : `"${first.componentName ?? first.id}" has no title-scale text (a text node with font.size ≥ ${TITLE_MIN_PX}px)`;
    findings.push(`FAIL page-anatomy — a "${archetype}" page must open with a page-header band: ${why}. A page with no header band is vanilla, whatever its style coverage.`);
  }
}

// 6. a reference-list status must render as a chip, not as prose — as a component AND as a cell
const statusColumns = [];
for (const t of datatables) {
  for (const it of Array.isArray(t.items) ? t.items : []) {
    if (!it || typeof it !== 'object' || !it.propertyName || !isStatusPath(it.propertyName)) continue;
    const cell = it.displayComponent?.type ?? null;
    if (CHIP_TYPES.has(cell)) continue;
    if (cell !== null && cell !== '[default]' && !PLAIN_TEXT_TYPES.has(cell)) continue;   // some other deliberate cell
    statusColumns.push({ table: t.componentName || t.propertyName || t.id, prop: it.propertyName, cell });
  }
}
for (const c of statusColumns) {
  // The severity rule, stated in the finding so a developer knows which case they are in:
  // the identity was KNOWABLE (this form identifies that reference list elsewhere, or
  // --metadata says so) ⇒ a chip was possible and was not emitted ⇒ FAIL. Nothing knows the
  // identity ⇒ the compiler could not have invented one [R-015] ⇒ WARN.
  const known = reflistKnown.has(String(c.prop).split('.').pop().toLowerCase());
  findings.push(`${known ? 'FAIL' : 'WARN'} status-as-text — datatable "${c.table}" column "${c.prop}" displays as `
    + `${c.cell === null ? 'no displayComponent' : `\`${c.cell}\``} — a reference-list column on \`[default]\` renders the raw enum NUMBER; `
    + 'use displayComponent {type:"refListStatus", settings:{referenceListId:{module,name}}} (the lifecycle colour comes from the reference-list items [R-036]). '
    + (known
      ? 'FAIL because the reference-list identity for this property IS known here (another component/column in this form names it, or --metadata declares it) — a chip was possible.'
      : 'WARN, not FAIL, because nothing available to this check knows the reference-list identity (offline compile, no `bindings[].referenceList` declared) — '
        + 'an identity is never guessed [R-015]. Declare it on the blueprint binding, or compile against live metadata, and this becomes a FAIL.'));
}
if (statusAsText.length) {
  for (const n of statusAsText) {
    findings.push(`FAIL status-as-text — ${n.type} "${n.propertyName}" renders a reference-list status as plain text; use refListStatus (the lifecycle colour comes from the reference-list items [R-036])`);
  }
} else if (!statusColumns.length) {
  findings.push('OK   status-as-text — no status property rendered as plain text/textField, and no status column left on a default cell');
}

// 7. every datatable authors the grid presentation channels that PROVABLY render
if (!datatables.length) {
  findings.push('OK   datatable-presentation — no datatable in this form');
} else {
  for (const t of datatables) {
    const density = t.rowDimensions?.height ?? t.rowHeight;
    const contrast = t.headerBackgroundColor
      || ['desktop', 'tablet', 'mobile'].some((k) => t[k]?.font && Object.keys(t[k].font).length);
    if (density != null && density !== '' && contrast) {
      findings.push(`OK   datatable-presentation — "${t.componentName || t.propertyName || t.id}" carries row density + header/body contrast`);
    } else {
      const gaps = [];
      if (density == null || density === '') gaps.push('rowDimensions.height (row density)');
      if (!contrast) gaps.push('headerBackgroundColor or a desktop.font block (header/body contrast)');
      findings.push(`FAIL datatable-presentation — datatable "${t.componentName || t.propertyName || t.id}" is default-AntD: missing ${gaps.join(' and ')}. `
        + 'These are the channels the measured matrix records as rendering; rowHoverBackgroundColor / striped / rowDividers / rowPaddingTop-Bottom are all "not-measured" there, so they do not count as evidence.');
    }
  }
}

findings.forEach((f) => console.log(f));
const failed = findings.some((f) => f.startsWith('FAIL'));
// this script IS the mechanical check behind [R-042] — no form ships unstyled
console.log(`\n${failed ? 'STYLEDNESS: FAIL' : 'STYLEDNESS: PASS'} [R-042] (${cov}% coverage, ${inlineConflicts} inline conflicts)`);
process.exit(failed && !warnOnly ? 1 : 0);
