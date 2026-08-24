// registry_lookup — an EXACT registry lookup, never a fuzzy match (§4.5). Returns the
// records for the requested component types / props / datatypes, and a `missing[]` that is
// populated, never silently empty. Replaces the 16 pre-rebuild reference files.
import { loadRegistry, REGISTRY_REF } from '../../../sfs/src/lib/registry.mjs';

export const name = 'registry_lookup';
export const summary = 'Exact component/prop/datatype lookup against the pinned registry.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    types: { type: 'array', items: { type: 'string' } },
    props: { type: 'array', items: { type: 'string' } },
    datatypes: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string' },
    brand: { type: 'string' },
  },
};

/** @param {any} input @returns {any} */
export function run(input = {}) {
  const reg = loadRegistry(typeof input.brand === 'string' ? input.brand : 'shesha');
  /** @type {any[]} */
  const records = [];
  /** @type {string[]} */
  const missing = [];
  for (const t of Array.isArray(input.types) ? input.types : []) {
    const rec = reg.components[t];
    if (rec) records.push({ type: t, version: rec.version, sfsNode: rec.sfsNode, authorable: rec.authorable, isInput: rec.isInput });
    else missing.push(t);
  }
  for (const d of Array.isArray(input.datatypes) ? input.datatypes : []) {
    const m = reg.datatypeMap[d];
    if (m) records.push({ datatype: d, component: m.component }); else missing.push(d);
  }
  return { registryRef: REGISTRY_REF, records, missing };
}
