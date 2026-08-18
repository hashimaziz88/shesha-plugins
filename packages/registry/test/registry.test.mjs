// D-115: the registry is the ONLY version authority. No file outside
// packages/registry/data/** may carry a component-name -> integer version map.
//
// The `matrix.versions` map disagreed with the registry (`dataContext: 7` there,
// `8` in the KB and in the production form that renders). A note explaining which
// one wins would drift again the first time someone edited the wrong one; this
// test is what makes the second map unrepresentable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** Known component types; a JSON object with >= 5 of these as keys is a version map. */
const KNOWN_TYPES = new Set([
  'container', 'text', 'textField', 'numberField', 'dateField', 'dropdown',
  'autocomplete', 'checkbox', 'card', 'datalist', 'dataContext', 'refListStatus',
  'buttonGroup', 'datatable', 'alert', 'validationErrors', 'progress', 'radio',
  'section', 'tabs', 'collapsiblePanel', 'button', 'checkboxGroup', 'timePicker',
]);

/** The one tree allowed to hold version maps. */
const AUTHORITY = 'packages/registry/data';
const SKIP = new Set(['node_modules', '.git', '.build']);

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {void}
 */
function collectJson(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJson(abs, out);
    else if (entry.name.endsWith('.json')) out.push(abs);
  }
}

/**
 * Every object anywhere in a JSON value that looks like a component->version map:
 * >= 5 keys that are known component types, all mapping to small integers.
 * @param {unknown} value
 * @returns {number} count of version-map objects found
 */
function versionMapsIn(value) {
  let found = 0;
  /** @param {unknown} v @returns {void} */
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const obj = /** @type {Record<string, unknown>} */ (v);
    const typeKeys = Object.keys(obj).filter((k) => KNOWN_TYPES.has(k)
      && typeof obj[k] === 'number' && Number.isInteger(obj[k]) && /** @type {number} */ (obj[k]) < 100);
    if (typeKeys.length >= 5) found += 1;
    for (const child of Object.values(obj)) walk(child);
  };
  walk(value);
  return found;
}

test('no file outside packages/registry/data carries a component->version map (D-115)', () => {
  /** @type {string[]} */
  const files = [];
  collectJson(path.join(ROOT, 'plugins'), files);
  collectJson(path.join(ROOT, 'packages'), files);
  assert.ok(files.length > 0, 'no JSON files scanned; the guard would be vacuous');

  /** @type {string[]} */
  const offenders = [];
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel.startsWith(AUTHORITY)) continue; // the authority is allowed to hold versions
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    if (versionMapsIn(parsed) > 0) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    `these files carry a component->version map that competes with the registry: ${offenders.join(', ')}`);
});

import { execFileSync } from 'node:child_process';

test('components.json is byte-identical to a fresh generation (gen-registry --check)', () => {
  // §2.8.3: registry drift is a failing test, not silent skew. --check regenerates
  // into memory and byte-compares; a hand-edit to the generated data fails here.
  let ok = true;
  let out = '';
  try {
    out = execFileSync(process.execPath,
      [path.join(ROOT, 'packages/registry/tools/gen-registry.mjs'), '--check',
       '--commit', '3418e292f4422c1b515b78a16d67f20a4bae7db3'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { ok = false; const ex = /** @type {{stdout?:string, stderr?:string}} */ (e); out = `${ex.stdout || ''}${ex.stderr || ''}`; }
  assert.ok(ok, `gen-registry --check failed — components.json is stale, run the generator: ${out.trim()}`);
});
