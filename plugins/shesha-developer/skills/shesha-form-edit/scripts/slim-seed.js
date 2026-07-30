#!/usr/bin/env node
/**
 * slim-seed.js — deterministically slim a canonical seed form for shipping.
 *
 * Big seeds are shape references, not data specs: agents copy one exemplar of a
 * shape and swap entity/property names. Shipping 40 near-identical label/value
 * rows costs tokens on every grep; 2 exemplars carry the same information.
 *
 * What it does:
 *   1. Within every sibling array (components / tabs panes / datatable columns),
 *      groups nodes by shape-signature and keeps the first 2 exemplars per
 *      signature (3 for datatable data columns). Order preserved.
 *   2. NEVER drops: script-carrying nodes (any `_code`/`return `/`await ` string),
 *      validationErrors, buttonGroup, datatable/datalist/dataContext/
 *      datatableContext/tabs/wizard nodes, action & crud-operations columns,
 *      sole-instance signatures, or any ancestor of a kept node.
 *   3. Re-prints at indent 1 (line-per-prop stays greppable with -A/-B).
 *   4. formSettings passes through byte-identical (same object, same key order).
 *
 * Coverage assertions (hard-fail — the slim is aborted if any set changes):
 *   component-type set · columnType set · display/edit/createComponent type
 *   shapes · (actionName, actionOwner) pairs · referenceListId identities.
 *
 * Usage:
 *   node scripts/slim-seed.js <seed.json> [--dry]     # in-place unless --dry
 *   node scripts/slim-seed.js --all [--dry]           # the 7 known big seeds
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BIG_SEEDS = [
  'rs-detail-with-header.json',
  'employee-detail-with-child-tables.json',
  'employee-detail-without-child-tables.json',
  'employee-create.json',
  'rs-create-dialog.json',
  'rs-table.json',
  'employee-table.json',
];

const PROTECTED_TYPES = new Set([
  'validationErrors', 'buttonGroup', 'datatable', 'datalist',
  'dataContext', 'datatableContext', 'tabs', 'wizard',
  'datatable.pager', 'datatable.quickSearch', 'tableViewSelector',
]);

const SLOT_KEYS = ['components', 'columns', 'tabs'];

function hasScript(node) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      if (/\b(return |await |http\.)/.test(n)) return true;
      continue;
    }
    if (typeof n !== 'object') continue;
    if (n._mode === 'code' || n._code) return true;
    for (const [k, v] of Object.entries(n)) {
      if (SLOT_KEYS.includes(k)) continue; // children judged separately
      stack.push(v);
    }
  }
  return false;
}

function isColumnItem(n) { return n && typeof n === 'object' && n.columnType !== undefined; }

function signature(n) {
  if (isColumnItem(n)) {
    return ['col', n.columnType,
      n.displayComponent && n.displayComponent.type,
      n.editComponent && n.editComponent.type,
      n.createComponent && n.createComponent.type].join('|');
  }
  const keys = Object.keys(n).filter(k => !SLOT_KEYS.includes(k)).sort().join(',');
  // Include descendant-type composition so only true shape-repeats collapse —
  // a row holding a checkbox is a different shape than a row holding a textField.
  const desc = [];
  const w = x => {
    if (Array.isArray(x)) return x.forEach(w);
    if (!x || typeof x !== 'object') return;
    if (x.type) desc.push(x.type);
    if (x.referenceListId && x.referenceListId.name) desc.push('rl:' + x.referenceListId.name);
    if (x.referenceListName) desc.push('rl:' + x.referenceListName);
    for (const k of SLOT_KEYS) if (Array.isArray(x[k])) w(x[k]);
    if (x.content) w(x.content);
    if (x.header) w(x.header);
  };
  for (const k of SLOT_KEYS) if (Array.isArray(n[k])) w(n[k]);
  if (n.content) w(n.content);
  if (n.header) w(n.header);
  return ['cmp', n.type || '(slot)', keys, desc.sort().join('+')].join('|');
}

// --- coverage sets ---------------------------------------------------------
function collectSets(root) {
  const sets = { types: new Set(), columnTypes: new Set(), cellShapes: new Set(), actions: new Set(), reflists: new Set() };
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.type) sets.types.add(n.type);
    if (n.columnType !== undefined) {
      sets.columnTypes.add(n.columnType);
      for (const slot of ['displayComponent', 'editComponent', 'createComponent'])
        if (n[slot]) sets.cellShapes.add(slot + ':' + (n[slot].type || '?') + ':' + (n[slot].settings ? 'settings' : 'flat'));
    }
    const ac = n.actionConfiguration;
    if (ac && ac.actionName) sets.actions.add(ac.actionName + '@' + (ac.actionOwner || ''));
    const rl = n.referenceListId;
    if (rl && rl.name) sets.reflists.add((rl.module || '') + '.' + rl.name);
    if (n.referenceListName) sets.reflists.add((n.module || n.referenceListModule || '') + '.' + n.referenceListName);
    for (const [k, v] of Object.entries(n)) if (v && typeof v === 'object') walk(v);
  })(root);
  return sets;
}

function diffSets(a, b) {
  const out = [];
  for (const key of Object.keys(a)) {
    for (const v of a[key]) if (!b[key].has(v)) out.push(`${key}: lost "${v}"`);
  }
  return out;
}

// --- pruning ---------------------------------------------------------------
function mustKeep(n) {
  if (!n || typeof n !== 'object') return true;
  if (n.type && PROTECTED_TYPES.has(n.type)) return true;
  if (isColumnItem(n) && n.columnType !== 'data') return true; // action / crud-operations / etc.
  if (hasScript(n)) return true;
  // any protected descendant?
  for (const k of SLOT_KEYS) if (Array.isArray(n[k]) && n[k].some(mustKeep)) return true;
  for (const slot of ['content', 'header']) if (n[slot] && typeof n[slot] === 'object' && mustKeep(n[slot])) return true;
  return false;
}

function pruneArray(arr, isDatatableColumns) {
  const perSig = new Map();
  const kept = [];
  for (const n of arr) {
    const sig = signature(n);
    const count = perSig.get(sig) || 0;
    const cap = isDatatableColumns && isColumnItem(n) && n.columnType === 'data' ? 3 : 2;
    if (count < cap || mustKeep(n)) {
      perSig.set(sig, count + 1);
      kept.push(n);
    }
  }
  return kept;
}

function pruneTree(n, parentKey) {
  if (Array.isArray(n)) return n.map(x => pruneTree(x, parentKey));
  if (!n || typeof n !== 'object') return n;
  const out = { ...n };
  for (const k of SLOT_KEYS) {
    if (!Array.isArray(out[k])) continue;
    const isDtCols = k === 'columns' && out.type === 'datatable';
    const pruned = pruneArray(out[k], isDtCols);
    out[k] = pruned.map(x => pruneTree(x, k));
  }
  for (const slot of ['content', 'header']) {
    if (out[slot] && typeof out[slot] === 'object') out[slot] = pruneTree(out[slot], slot);
  }
  return out;
}

// --- main ------------------------------------------------------------------
function slimFile(file, dry) {
  const raw = fs.readFileSync(file, 'utf8');
  const seed = JSON.parse(raw);
  if (!Array.isArray(seed.components)) { console.error(`SKIP ${file}: no components[]`); return; }

  const before = collectSets(seed.components);
  const slimComponents = pruneTree(seed.components, 'components');
  const after = collectSets(slimComponents);

  const lost = diffSets(before, after);
  if (lost.length) {
    console.error(`ABORT ${path.basename(file)} — coverage lost:\n  ` + lost.join('\n  '));
    process.exitCode = 1;
    return;
  }
  // formSettings byte-identical: re-emit the exact parsed object untouched.
  const out = { components: slimComponents, formSettings: seed.formSettings };
  for (const k of Object.keys(seed)) if (!(k in out)) out[k] = seed[k]; // preserve any extra top-level keys
  const text = JSON.stringify(out, null, 1) + '\n';
  const countNodes = s => { let c = 0; (function w(x){ if(Array.isArray(x)) return x.forEach(w); if(x&&typeof x==='object'){ if(x.type)c++; for(const k of SLOT_KEYS) if(Array.isArray(x[k])) w(x[k]); if(x.content)w(x.content); if(x.header)w(x.header);} })(s); return c; };
  console.log(`${path.basename(file).padEnd(46)} ${String(raw.length).padStart(8)} -> ${String(text.length).padStart(8)} bytes  (${countNodes(seed.components)} -> ${countNodes(slimComponents)} nodes)`);
  if (!dry) fs.writeFileSync(file, text);
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const targets = args.includes('--all')
  ? BIG_SEEDS.map(f => path.join(__dirname, '..', 'assets', 'examples', f))
  : args.filter(a => a !== '--dry');
if (!targets.length) { console.error('usage: node slim-seed.js <seed.json>|--all [--dry]'); process.exit(1); }
targets.forEach(f => slimFile(f, dry));
