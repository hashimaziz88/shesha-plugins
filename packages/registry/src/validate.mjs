// The registry completeness check (§2.8.4). CONTROL §3's WP-2 acceptance program.
//
// Reads the GENERATED components.json and the ratchet, computes the coverage
// numbers from the data (never from a typed-in literal), asserts every demand and
// every ratchet direction, and prints one line. Exit 0 only when all hold.
//
// `full` completeness for a priority type needs the framework TypeScript at the
// pinned commit; it is reported, and `priorityAtLeast: value-typed` is the demand
// (§2.8.4). With the framework clone present the priority set reaches full, which
// is printed but never a demand this program can fake without the source.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure, PRIORITY } from '../tools/gen-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const DATA = 'packages/registry/data/0.45.1';

/**
 * @returns {{ok:boolean, lines:string[], m:Record<string, number>}}
 */
export function validate() {
  const comps = /** @type {{components:Record<string, any>, _itemSchemas:Record<string, unknown>}} */ (
    JSON.parse(fs.readFileSync(path.join(ROOT, `${DATA}/components.json`), 'utf8')));
  const ratchet = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/registry/config/registry-ratchet.json'), 'utf8'));
  const components = comps.components;
  const m = measure(components);
  /** @type {string[]} */
  const problems = [];

  // ---- absolute demands ------------------------------------------------------
  const d = ratchet.demands;
  if (m.records !== d.records) problems.push(`records ${m.records} != demanded ${d.records}`);
  if (m.namesOnlyOrBetter !== d.namesOnlyOrBetter) {
    const none = Object.values(components).filter((r) => r.propsCompleteness === 'none' && r.authorable !== false).map((r) => r.type);
    problems.push(`namesOnlyOrBetter ${m.namesOnlyOrBetter} != ${d.namesOnlyOrBetter}; still 'none' and authorable: ${none.join(', ') || '(?)'}`);
  }
  if (Object.keys(comps._itemSchemas || {}).length !== d.itemSchemas) {
    problems.push(`itemSchemas ${Object.keys(comps._itemSchemas || {}).length} != ${d.itemSchemas}`);
  }

  // authorable ⇒ version !== null
  if (d.authorableImpliesVersion) {
    const bad = Object.values(components).filter((r) => r.authorable === true && (r.version === null || r.version === undefined)).map((r) => r.type);
    if (bad.length) problems.push(`authorable with null version (must be 0): ${bad.join(', ')}`);
  }

  // every priority type at least value-typed
  const belowFloor = PRIORITY.filter((t) => !components[t] || !['value-typed', 'full'].includes(components[t].propsCompleteness));
  if (belowFloor.length) problems.push(`priority types below ${d.priorityAtLeast}: ${belowFloor.map((t) => `${t}(${components[t] ? components[t].propsCompleteness : 'absent'})`).join(', ')}`);

  // no priority prop left with valueType null
  let priorityNullTypes = 0;
  for (const t of PRIORITY) {
    const r = components[t];
    if (!r) continue;
    for (const p of Object.values(r.props || {})) if (/** @type {any} */ (p).valueType === null) priorityNullTypes += 1;
  }
  if (priorityNullTypes !== d.priorityValueTypeUnknown) problems.push(`priority props with unknown valueType ${priorityNullTypes} != ${d.priorityValueTypeUnknown}`);

  // every authorable:false record carries a reason; a non-designer-internal one carries a decision
  for (const r of Object.values(components)) {
    if (r.authorable === false) {
      if (!r.reason) problems.push(`${r.type} is authorable:false with no reason`);
      else if (r.reason !== 'designer-internal' && !r.decision) problems.push(`${r.type} is authorable:false (${r.reason}) with no decision id`);
    }
  }

  // ---- ratchet directions ----------------------------------------------------
  for (const [key, dir] of Object.entries(ratchet.direction)) {
    const floor = ratchet.measured[key];
    const now = m[key];
    if (dir === 'up' && now < floor) problems.push(`${key} ${now} fell below its ratchet floor ${floor}`);
    if (dir === 'down' && now > floor) problems.push(`${key} ${now} rose above its ratchet ceiling ${floor}`);
  }

  // ---- provenance honesty: no source-parsed without the framework ------------
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `${DATA}/_meta.json`), 'utf8'));
  if (meta.frameworkPresent !== true) {
    const claimed = Object.values(components).filter((r) => r.provenance && r.provenance.confidence === 'source-parsed').map((r) => r.type);
    if (claimed.length) problems.push(`frameworkPresent false but source-parsed claimed on: ${claimed.join(', ')}`);
  }

  const lines = [
    `registry records=${m.records} authorable=${m.authorable} namesOnlyOrBetter=${m.namesOnlyOrBetter} valueTyped=${m.valueTyped} deferredAuthorable=${m.deferredAuthorable} priorityValueTyped=${m.priorityValueTyped}/13`,
    `names-only ${m.namesOnlyOrBetter}/121 · priority full ${m.priorityFull}/13 (value-typed ${m.priorityValueTyped}/13) · frameworkPresent ${meta.frameworkPresent}`,
  ];
  return { ok: problems.length === 0, lines: problems.length ? [...lines, ...problems.map((p) => `  FAIL ${p}`)] : lines, m };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = validate();
  for (const l of r.lines) console.log(l);
  process.exit(r.ok ? 0 : 1);
}
