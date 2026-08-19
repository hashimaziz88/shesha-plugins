#!/usr/bin/env node
/**
 * defect-census.mjs - normalisation-defect census over Shesha form envelopes.
 *
 * A MEASUREMENT INSTRUMENT, NOT A GATE. It asserts nothing and exits 0 whether
 * it finds one defect or ten thousand. Gates are the rebuild's job; conflating
 * the two is how a repo ends up with green signals that check nothing.
 * The single exception is --fail-on-regression, which you opt into explicitly.
 *
 * Pure function of the JSON. No compiler, no registry, no backend, no browser.
 * Runs today, before any of the rebuild exists.
 *
 * USAGE
 *   node defect-census.mjs <dir> [options]
 *
 *   --json <path>            write the machine-readable report
 *   --md <path>              write a committable markdown report
 *   --compare <baseline>     diff against an earlier --json report
 *   --fail-on-regression     with --compare, exit 1 if any class got worse
 *   --detail <N>             print up to N instances per class (default 3)
 *   --quiet                  suppress the console report
 *
 * EXIT  0 measured - 1 regression (only with --fail-on-regression) - 2 unusable input
 *
 * SELF-TEST
 *   Run against docs/rebuild-brief/artifacts/bookings-table.revision2.json and it
 *   must report exactly: 12 components, 19170 markup bytes, 43.9% breakpoint
 *   share, 11 components carrying breakpoints, 6 byte-identical desktop/tablet,
 *   7 real leaf differences, and all eight classes for 13 instances. Those
 *   figures were measured by hand from that form. If the tool disagrees, the
 *   tool is wrong.
 */

import fs from 'node:fs';
import path from 'node:path';

const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const STYLE_SUBTREES = ['border', 'background', 'shadow', 'font'];

const INPUT_TYPES = new Set([
  'textField', 'numberField', 'dropdown', 'checkbox', 'checkboxGroup', 'dateField',
  'textArea', 'autocomplete', 'radio', 'switch', 'entityPicker', 'fileUpload',
  'timePicker', 'richTextEditor', 'phoneNumberInput', 'passwordCombo',
  'colorPicker', 'slider', 'rate', 'address', 'attachmentsEditor', 'codeEditor',
]);
const DATA_TYPES = new Set(['datatable', 'datalist']);

// ---------------------------------------------------------------------------
// Envelope / tree handling. One unwrapper and one walker, defined once. The
// pre-rebuild repo had three unwrappers and five walkers, and that divergence
// is exactly what this file refuses to reproduce.
// ---------------------------------------------------------------------------

function unwrapMarkup(doc) {
  let value = doc;
  for (let hop = 0; hop < 4; hop++) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); continue; } catch { return null; }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.Markup === 'string') { value = value.Markup; continue; }
      if (typeof value.markup === 'string') { value = value.markup; continue; }
      if (value.result !== undefined && value.components === undefined) { value = value.result; continue; }
    }
    break;
  }
  if (Array.isArray(value)) value = { components: value };
  if (!value || typeof value !== 'object' || !Array.isArray(value.components)) return null;
  return value;
}

/** Visit every component node. A node is an object with a string `type` and an `id`. */
function eachComponent(root, visit) {
  const stack = [{ node: root, depth: 0, parent: null, path: 'components' }];
  while (stack.length) {
    const { node, depth, parent, path: at } = stack.pop();
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], depth, parent, path: `${at}[${i}]` });
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const isComponent = typeof node.type === 'string' && node.id !== undefined;
    if (isComponent) visit(node, depth, parent, at);
    const childDepth = isComponent ? depth + 1 : depth;
    const childParent = isComponent ? node : parent;
    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === 'object') {
        stack.push({ node: child, depth: childDepth, parent: childParent, path: `${at}.${key}` });
      }
    }
  }
}

function flattenLeaves(value, prefix = '', out = new Map()) {
  if (value === null || typeof value !== 'object') { out.set(prefix, value); return out; }
  if (Array.isArray(value)) { value.forEach((v, i) => flattenLeaves(v, `${prefix}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(value)) flattenLeaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const jsonBytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const labelOf = (n) => n.propertyName || n.componentName || n.type;

function descendantCount(node) {
  let n = 0;
  eachComponent(node, () => { n++; });
  return Math.max(0, n - 1);
}

// ---------------------------------------------------------------------------
// The eight normalisation classes, each measured in bookings-table revision 2.
// A detector receives the per-form analysis context and pushes instances.
// ---------------------------------------------------------------------------

const DETECTORS = [
  {
    id: 'N1',
    title: 'Stray designer label',
    why: 'The designer names a component "Card1" and nothing clears it, so a label renders that no one authored.',
    rule: 'label matches /^[A-Z][A-Za-z]*\\d+$/ and hideLabel is not true',
    node(n, push) {
      if (typeof n.label === 'string' && /^[A-Z][A-Za-z]*\d+$/.test(n.label) && n.hideLabel !== true) {
        push(`${labelOf(n)}: label "${n.label}", hideLabel ${n.hideLabel === undefined ? 'unset' : n.hideLabel}`);
      }
    },
  },
  {
    id: 'N2',
    title: 'Breakpoint style inconsistency',
    why: 'The same style leaf holds different values at base and across breakpoints, so which one wins is accidental.',
    rule: 'a leaf under border/background/shadow/font disagrees between two or more of base/desktop/tablet/mobile. dimensions is excluded: it is the legitimate channel for responsive intent.',
    node(n, push) {
      for (const subtree of STYLE_SUBTREES) {
        const perLevel = {};
        for (const level of ['base', ...BREAKPOINTS]) {
          const source = level === 'base' ? n[subtree] : (n[level] && n[level][subtree]);
          if (source && typeof source === 'object') perLevel[level] = flattenLeaves(source);
        }
        const keys = new Set(Object.values(perLevel).flatMap((m) => [...m.keys()]));
        for (const key of keys) {
          const seen = new Map();
          for (const [level, map] of Object.entries(perLevel)) {
            if (map.has(key)) seen.set(level, JSON.stringify(map.get(key)));
          }
          if (seen.size >= 2 && new Set(seen.values()).size > 1) {
            push(`${labelOf(n)}: ${subtree}.${key} = ` + [...seen].map(([l, v]) => `${l}=${v}`).join(', '));
          }
        }
      }
    },
  },
  {
    id: 'N3',
    title: 'className on some breakpoints only',
    why: 'A class that styles the page shell is present at one breakpoint and missing at the others.',
    rule: 'className appears in 1 or 2 of the 3 breakpoint blocks',
    node(n, push) {
      const present = BREAKPOINTS.filter((b) => n[b] && typeof n[b].className === 'string');
      if (present.length > 0 && present.length < 3) {
        push(`${labelOf(n)}: className "${n[present[0]].className}" on ${present.join('+')} only`);
      }
    },
  },
  {
    id: 'N4',
    title: 'Fixed small height on a wrapper',
    why: 'A container that wraps a whole page is pinned to a height smaller than its content.',
    rule: 'a breakpoint sets dimensions.height to a fixed value under 100px on a node with 3 or more descendants',
    node(n, push) {
      for (const b of BREAKPOINTS) {
        const h = n[b] && n[b].dimensions && n[b].dimensions.height;
        if (typeof h === 'string' && /^\d+(\.\d+)?px$/.test(h) && parseFloat(h) < 100) {
          const kids = descendantCount(n);
          if (kids >= 3) { push(`${labelOf(n)}: ${b}.dimensions.height=${h} wrapping ${kids} descendants`); return; }
        }
      }
    },
  },
  {
    id: 'N5',
    title: 'Dual styling channels',
    why: 'Legacy and v7 styling both set the same property, so the rendered result depends on precedence nobody declared.',
    rule: 'component carries fontSize or fontWeight at the top level AND a v7 desktop.font block',
    node(n, push) {
      const legacy = ['fontSize', 'fontWeight'].filter((k) => n[k] !== undefined);
      if (legacy.length && n.desktop && n.desktop.font) {
        push(`${labelOf(n)}: legacy ${legacy.join('+')} alongside desktop.font`);
      }
    },
  },
  {
    id: 'N6',
    title: 'stylingBox duplicated',
    why: 'The same spacing is declared at base and again inside breakpoints, so an edit to one silently does nothing.',
    rule: 'stylingBox present at the node root AND in at least one breakpoint block',
    node(n, push) {
      if (n.stylingBox === undefined) return;
      const dupes = BREAKPOINTS.filter((b) => n[b] && n[b].stylingBox !== undefined);
      if (dupes.length) push(`${labelOf(n)}: stylingBox at base and in ${dupes.join('+')}`);
    },
  },
  {
    id: 'N7',
    title: 'Redundant row-click wiring',
    why: 'Row navigation configured three ways at once; two of them are dead weight and diverge on the next edit.',
    rule: 'onRowClick present alongside rowClickActionConfiguration',
    node(n, push) {
      if (!n.onRowClick || !n.rowClickActionConfiguration) return;
      const dblIdentical = n.dblClickActionConfiguration &&
        JSON.stringify(n.dblClickActionConfiguration) === JSON.stringify(n.rowClickActionConfiguration);
      push(`${labelOf(n)}: onRowClick + rowClickActionConfiguration${dblIdentical ? ' + byte-identical dblClickActionConfiguration' : ''}`);
    },
  },
  {
    id: 'N8',
    title: 'Submit plumbing on a read-only list',
    why: 'A list form carries a create/update submit pipeline copied from a detail form. It never submits.',
    rule: 'formSettings declares dataSubmitterType, a dynamicEndpoint, or onBeforeDataLoad, while the form has a datatable/datalist and no input components',
    form(markup, components, push) {
      const settings = markup.formSettings || {};
      const types = new Set(components.map((c) => c.type));
      const hasData = [...types].some((t) => DATA_TYPES.has(t));
      const hasInputs = [...types].some((t) => INPUT_TYPES.has(t));
      if (!hasData || hasInputs) return;
      const found = [];
      if (settings.dataSubmitterType) found.push(`dataSubmitterType=${settings.dataSubmitterType}`);
      if (settings.dataSubmittersSettings && JSON.stringify(settings.dataSubmittersSettings).includes('dynamicEndpoint')) found.push('dynamicEndpoint');
      if (settings.onBeforeDataLoad) found.push('onBeforeDataLoad');
      if (found.length) push(`formSettings: ${found.join(', ')}`);
    },
  },
];

// ---------------------------------------------------------------------------

function analyseForm(markup) {
  const hits = {};
  for (const d of DETECTORS) hits[d.id] = [];

  const components = [];
  let maxDepth = 0;
  let breakpointBytes = 0;
  let withBreakpoints = 0;
  let identicalDesktopTablet = 0;
  let realLeafDiffs = 0;

  eachComponent(markup.components, (node, depth) => {
    components.push(node);
    if (depth > maxDepth) maxDepth = depth;

    for (const b of BREAKPOINTS) {
      if (node[b] && typeof node[b] === 'object') breakpointBytes += jsonBytes(node[b]);
    }

    for (const d of DETECTORS) {
      if (d.node) d.node(node, (detail) => hits[d.id].push(detail));
    }

    if (node.desktop && node.tablet) {
      withBreakpoints++;
      if (JSON.stringify(node.desktop) === JSON.stringify(node.tablet)) {
        identicalDesktopTablet++;
      } else {
        const a = flattenLeaves(node.desktop);
        const b = flattenLeaves(node.tablet);
        for (const k of new Set([...a.keys(), ...b.keys()])) {
          if (JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))) realLeafDiffs++;
        }
      }
    }
  });

  for (const d of DETECTORS) {
    if (d.form) d.form(markup, components, (detail) => hits[d.id].push(detail));
  }

  const markupBytes = jsonBytes(markup);
  const classes = DETECTORS.filter((d) => hits[d.id].length).map((d) => d.id);
  return {
    components: components.length,
    maxDepth,
    markupBytes,
    breakpointBytes,
    breakpointSharePct: markupBytes ? Number(((breakpointBytes / markupBytes) * 100).toFixed(1)) : 0,
    componentsWithBreakpoints: withBreakpoints,
    identicalDesktopTablet,
    realLeafDiffs,
    classes,
    instances: Object.values(hits).reduce((sum, list) => sum + list.length, 0),
    hits,
  };
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dir: null, json: null, md: null, compare: null, failOnRegression: false, detail: 3, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = argv[++i];
    else if (a === '--md') opts.md = argv[++i];
    else if (a === '--compare') opts.compare = argv[++i];
    else if (a === '--fail-on-regression') opts.failOnRegression = true;
    else if (a === '--detail') opts.detail = Number(argv[++i]);
    else if (a === '--quiet') opts.quiet = true;
    else if (a.startsWith('--')) { console.error(`unknown option: ${a}`); process.exit(2); }
    else if (!opts.dir) opts.dir = a;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.dir) {
  console.error('usage: node defect-census.mjs <dir> [--json out.json] [--md out.md] [--compare base.json] [--fail-on-regression] [--detail N] [--quiet]');
  process.exit(2);
}

let entries;
try {
  const stat = fs.statSync(opts.dir);
  entries = stat.isDirectory()
    ? fs.readdirSync(opts.dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort()
    : [path.basename(opts.dir)];
  if (!stat.isDirectory()) opts.dir = path.dirname(opts.dir);
} catch (err) {
  console.error(`cannot read ${opts.dir}: ${err.message}`);
  process.exit(2);
}
if (!entries.length) { console.error(`no .json files in ${opts.dir}`); process.exit(2); }

const forms = [];
const unreadable = [];
for (const file of entries) {
  const full = path.join(opts.dir, file);
  let raw;
  try { raw = fs.readFileSync(full, 'utf8').replace(/^﻿/, ''); }
  catch (err) { unreadable.push({ file, reason: `read failed: ${err.message}` }); continue; }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (err) { unreadable.push({ file, reason: `JSON parse failed: ${err.message}` }); continue; }
  const markup = unwrapMarkup(doc);
  if (!markup) { unreadable.push({ file, reason: 'no components array after unwrapping the envelope' }); continue; }
  forms.push({ file, ...analyseForm(markup) });
}

const sum = (key) => forms.reduce((a, f) => a + f[key], 0);
const totals = {
  formsRead: forms.length,
  unreadable: unreadable.length,
  components: sum('components'),
  markupBytes: sum('markupBytes'),
  breakpointBytes: sum('breakpointBytes'),
  componentsWithBreakpoints: sum('componentsWithBreakpoints'),
  identicalDesktopTablet: sum('identicalDesktopTablet'),
  realLeafDiffs: sum('realLeafDiffs'),
  defectInstances: sum('instances'),
  cleanForms: forms.filter((f) => f.instances === 0).length,
};
totals.breakpointSharePct = totals.markupBytes
  ? Number(((totals.breakpointBytes / totals.markupBytes) * 100).toFixed(1)) : 0;
totals.byClass = {};
for (const d of DETECTORS) {
  totals.byClass[d.id] = {
    title: d.title,
    forms: forms.filter((f) => f.hits[d.id].length).length,
    instances: forms.reduce((a, f) => a + f.hits[d.id].length, 0),
  };
}

// -------------------------------------------------------------- comparison --
let comparison = null;
if (opts.compare) {
  let base;
  try { base = JSON.parse(fs.readFileSync(opts.compare, 'utf8')); }
  catch (err) { console.error(`cannot read baseline ${opts.compare}: ${err.message}`); process.exit(2); }
  comparison = { baseline: opts.compare, rows: [], regressions: [], eliminated: [] };
  for (const d of DETECTORS) {
    const before = (base.totals && base.totals.byClass && base.totals.byClass[d.id]) ? base.totals.byClass[d.id].instances : 0;
    const after = totals.byClass[d.id].instances;
    const row = { id: d.id, title: d.title, before, after, delta: after - before };
    comparison.rows.push(row);
    if (row.delta > 0) comparison.regressions.push(row);
    if (before > 0 && after === 0) comparison.eliminated.push(row);
  }
  comparison.baselineInstances = base.totals ? base.totals.defectInstances : null;
  comparison.currentInstances = totals.defectInstances;
}

// ------------------------------------------------------------------ output --
if (!opts.quiet) {
  const width = Math.min(56, Math.max(18, ...forms.map((f) => f.file.length)));
  console.log('\n=== SHESHA NORMALISATION DEFECT CENSUS ===\n');
  console.log(`corpus       ${opts.dir}`);
  console.log(`forms read   ${totals.formsRead}    unreadable ${totals.unreadable}\n`);

  console.log('FORM'.padEnd(width) + '  COMPS  DEPTH   MARKUP_B   BP%  DEFECTS  CLASSES');
  console.log('-'.repeat(width) + '  -----  -----  ---------  ----  -------  -------');
  for (const f of [...forms].sort((a, b) => b.instances - a.instances || a.file.localeCompare(b.file))) {
    console.log(
      f.file.slice(0, width).padEnd(width) +
      String(f.components).padStart(7) +
      String(f.maxDepth).padStart(7) +
      String(f.markupBytes).padStart(11) +
      String(f.breakpointSharePct).padStart(6) +
      String(f.instances).padStart(9) + '  ' + f.classes.join(',')
    );
  }

  console.log('\n--- by class ---');
  for (const d of DETECTORS) {
    const t = totals.byClass[d.id];
    console.log(`${d.id}  ${String(t.forms).padStart(4)}/${totals.formsRead} forms  ${String(t.instances).padStart(6)} inst   ${d.title}`);
    if (opts.detail > 0 && t.instances > 0) {
      let shown = 0;
      for (const f of forms) {
        for (const inst of f.hits[d.id]) {
          if (shown >= opts.detail) break;
          console.log(`        ${f.file} -> ${inst}`);
          shown++;
        }
        if (shown >= opts.detail) break;
      }
      if (t.instances > shown) console.log(`        ... ${t.instances - shown} more`);
    }
  }

  console.log('\n--- mechanical expansion ---');
  console.log(`  components                        ${totals.components}`);
  console.log(`  markup bytes                      ${totals.markupBytes}`);
  console.log(`  breakpoint-block bytes            ${totals.breakpointBytes}  (${totals.breakpointSharePct}% of markup)`);
  console.log(`  components carrying breakpoints   ${totals.componentsWithBreakpoints}`);
  console.log(`  desktop === tablet byte-identical ${totals.identicalDesktopTablet}`);
  console.log(`  actual desktop/tablet leaf diffs  ${totals.realLeafDiffs}`);
  console.log('\n--- totals ---');
  console.log(`  forms with zero defects           ${totals.cleanForms}/${totals.formsRead}`);
  console.log(`  defect instances                  ${totals.defectInstances}`);

  if (unreadable.length) {
    console.log('\n--- unreadable ---');
    for (const u of unreadable) console.log(`  ${u.file}: ${u.reason}`);
  }

  if (comparison) {
    console.log(`\n--- vs baseline ${comparison.baseline} ---`);
    console.log('CLASS  BEFORE   AFTER   DELTA');
    for (const r of comparison.rows) {
      const flag = r.delta > 0 ? '  REGRESSION' : (r.before > 0 && r.after === 0 ? '  eliminated' : '');
      console.log(`${r.id}  ${String(r.before).padStart(6)}  ${String(r.after).padStart(6)}  ${String(r.delta).padStart(6)}${flag}`);
    }
    console.log(`\n  total ${comparison.baselineInstances} -> ${comparison.currentInstances}`);
    console.log(`  classes eliminated: ${comparison.eliminated.length}   regressions: ${comparison.regressions.length}`);
  }
  console.log('');
}

const report = {
  schemaVersion: 1,
  tool: 'defect-census.mjs',
  corpus: opts.dir,
  classes: DETECTORS.map((d) => ({ id: d.id, title: d.title, why: d.why, rule: d.rule })),
  totals,
  forms,
  unreadable,
  comparison,
};

if (opts.json) {
  fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + '\n');
  if (!opts.quiet) console.log(`json report: ${opts.json}`);
}

if (opts.md) {
  const L = [];
  L.push('# Normalisation defect census', '');
  L.push(`Corpus: \`${opts.dir}\`  -  forms read: ${totals.formsRead}  -  unreadable: ${totals.unreadable}`, '');
  L.push('A measurement, not a gate. Produced by `defect-census.mjs`, a pure function of the form JSON - no compiler, registry, backend or browser.', '');
  L.push('## Totals', '');
  L.push('| Measure | Value |', '|---|---|');
  L.push(`| Forms with zero defects | ${totals.cleanForms} / ${totals.formsRead} |`);
  L.push(`| Defect instances | ${totals.defectInstances} |`);
  L.push(`| Components | ${totals.components} |`);
  L.push(`| Markup bytes | ${totals.markupBytes} |`);
  L.push(`| Breakpoint-block bytes | ${totals.breakpointBytes} (${totals.breakpointSharePct}% of markup) |`);
  L.push(`| Components carrying breakpoints | ${totals.componentsWithBreakpoints} |`);
  L.push(`| desktop === tablet byte-identical | ${totals.identicalDesktopTablet} |`);
  L.push(`| Real desktop/tablet leaf differences | ${totals.realLeafDiffs} |`);
  L.push('');
  L.push('## By class', '');
  L.push('| Class | Forms | Instances | Defect | Rule |', '|---|---|---|---|---|');
  for (const d of DETECTORS) {
    const t = totals.byClass[d.id];
    L.push(`| ${d.id} | ${t.forms}/${totals.formsRead} | ${t.instances} | ${d.title} | ${d.rule} |`);
  }
  L.push('');
  L.push('## Per form', '');
  L.push('| Form | Components | Depth | Markup B | BP % | Defects | Classes |', '|---|---|---|---|---|---|---|');
  for (const f of [...forms].sort((a, b) => b.instances - a.instances || a.file.localeCompare(b.file))) {
    L.push(`| \`${f.file}\` | ${f.components} | ${f.maxDepth} | ${f.markupBytes} | ${f.breakpointSharePct} | ${f.instances} | ${f.classes.join(', ') || '-'} |`);
  }
  if (unreadable.length) {
    L.push('', '## Unreadable', '');
    for (const u of unreadable) L.push(`- \`${u.file}\` - ${u.reason}`);
  }
  if (comparison) {
    L.push('', `## Versus baseline \`${comparison.baseline}\``, '');
    L.push('| Class | Before | After | Delta |', '|---|---|---|---|');
    for (const r of comparison.rows) L.push(`| ${r.id} | ${r.before} | ${r.after} | ${r.delta > 0 ? '**+' + r.delta + '**' : r.delta} |`);
    L.push('', `Total ${comparison.baselineInstances} -> ${comparison.currentInstances}. Classes eliminated: ${comparison.eliminated.length}. Regressions: ${comparison.regressions.length}.`);
  }
  fs.writeFileSync(opts.md, L.join('\n') + '\n');
  if (!opts.quiet) console.log(`markdown report: ${opts.md}`);
}

if (opts.failOnRegression && comparison && comparison.regressions.length > 0) {
  console.error(`\nFAIL: ${comparison.regressions.length} class(es) regressed against ${comparison.baseline}: ` +
    comparison.regressions.map((r) => `${r.id} +${r.delta}`).join(', '));
  process.exit(1);
}
process.exit(0);
