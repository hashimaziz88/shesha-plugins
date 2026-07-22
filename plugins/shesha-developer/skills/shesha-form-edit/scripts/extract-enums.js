#!/usr/bin/env node
// Extracts dropdown enum values for components-kb settings fields from the
// shesha-reactjs source the KB was parsed from (0.43 — paths match the KB).
// Output: assets/components-kb/_enums.json  { <type>: { <path>: { values, source } }, _meta }
//
// Usage: node extract-enums.js [--source <designer-components dir>] [--out <file>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');
const DEFAULT_SOURCE = 'C:/Users/Hashim/Documents/Git Repos/shesha-framework/shesha-reactjs-043/shesha-reactjs/src/designer-components';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SOURCE_DIR = argVal('--source', DEFAULT_SOURCE);
const OUT_FILE = argVal('--out', path.join(KB_DIR, '_enums.json'));

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`source dir not found: ${SOURCE_DIR}`);
  process.exit(2);
}

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));

// ---- extraction from json-markup settings forms -----------------------------

function collectDropdownsFromJson(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectDropdownsFromJson(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const prop = node.propertyName;
  if (typeof prop === 'string') {
    const rawValues = Array.isArray(node.values) ? node.values
      : Array.isArray(node.dropdownOptions) ? node.dropdownOptions
      : null;
    if (rawValues && (node.type === 'dropdown' || node.type === 'radio' || !node.type)) {
      const values = rawValues
        .map((v) => (v && typeof v === 'object' ? v.value : v))
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v));
      if (values.length && !out[prop]) out[prop] = values;
    }
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectDropdownsFromJson(v, out);
  }
}

// ---- best-effort extraction from ts settings builders ------------------------

function collectDropdownsFromTs(text, out) {
  // Chunk the file at each propertyName occurrence; scan the chunk for an
  // inline values/dropdownOptions array of {value: ...} literals.
  const re = /propertyName:\s*['"]([\w.]+)['"]/g;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ prop: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const { prop, at } = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].at : Math.min(text.length, at + 3000);
    const chunk = text.slice(at, end);
    const arrMatch = chunk.match(/(?:values|dropdownOptions):\s*\[([\s\S]*?)\]/);
    if (!arrMatch) continue;
    const values = [...arrMatch[1].matchAll(/value:\s*(?:['"]([^'"]+)['"]|(\d+)|(true|false))/g)]
      .map((v) => v[1] ?? v[2] ?? v[3]);
    if (values.length && !out[prop]) out[prop] = values;
  }
}

// ---- main --------------------------------------------------------------------

const enums = {};
let resolvedFields = 0;
let unresolvedFields = 0;
const unresolvedList = [];

const sharedStyle = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_shared-style-fields.json'), 'utf8'));
const sharedDropdownPaths = sharedStyle.fields.filter((f) => f.editorType === 'dropdown').map((f) => f.path);

for (const [type, entry] of Object.entries(index)) {
  if (type.startsWith('_')) continue;
  const kbFile = path.join(KB_DIR, entry.file || `${type}.json`);
  if (!fs.existsSync(kbFile)) continue;
  const kb = JSON.parse(fs.readFileSync(kbFile, 'utf8'));

  const found = {};
  const source = kb.settingsForm?.source;
  if (source) {
    const srcPath = path.join(SOURCE_DIR, source);
    if (fs.existsSync(srcPath)) {
      const text = fs.readFileSync(srcPath, 'utf8');
      if (srcPath.endsWith('.json')) {
        try { collectDropdownsFromJson(JSON.parse(text), found); } catch { /* unparseable */ }
      } else {
        collectDropdownsFromTs(text, found);
      }
    }
  }

  // fields we actually need enums for: dropdown settingsFields + shared style dropdowns
  const wanted = new Set([
    ...(kb.settingsFields || []).filter((f) => f.editorType === 'dropdown').map((f) => f.path),
    ...(kb.appearanceFieldPaths || []).filter((p) => sharedDropdownPaths.includes(p)),
  ]);

  const typeEnums = {};
  for (const p of wanted) {
    if (found[p]) {
      typeEnums[p] = { values: found[p], source: 'source-parsed' };
      resolvedFields++;
    } else {
      unresolvedFields++;
      unresolvedList.push(`${type}.${p}`);
    }
  }
  // keep extra discovered dropdowns too (useful for partial-KB components)
  for (const [p, values] of Object.entries(found)) {
    if (!typeEnums[p]) typeEnums[p] = { values, source: 'source-parsed' };
  }
  if (Object.keys(typeEnums).length) enums[type] = typeEnums;
}

const meta = {
  generatedAt: new Date().toISOString(),
  sourceDir: SOURCE_DIR,
  resolvedFields,
  unresolvedFields,
  unresolved: unresolvedList.sort(),
};

const sorted = {};
for (const k of Object.keys(enums).sort()) {
  sorted[k] = {};
  for (const p of Object.keys(enums[k]).sort()) sorted[k][p] = enums[k][p];
}
sorted._meta = meta;

fs.writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2) + '\n');
const pct = resolvedFields + unresolvedFields
  ? Math.round((resolvedFields / (resolvedFields + unresolvedFields)) * 100)
  : 0;
console.log(`enums: ${resolvedFields} resolved, ${unresolvedFields} unresolved (${pct}% of wanted dropdowns)`);
console.log(`components with enums: ${Object.keys(enums).length}`);
console.log(`wrote ${OUT_FILE}`);
if (unresolvedList.length) {
  console.log(`unresolved (fallback to KNOWN_ENUMS at generation time):`);
  for (const u of unresolvedList.slice(0, 40)) console.log(`  - ${u}`);
  if (unresolvedList.length > 40) console.log(`  ... +${unresolvedList.length - 40} more`);
}
