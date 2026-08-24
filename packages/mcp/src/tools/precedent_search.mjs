// precedent_search — shape-indexed retrieval over the compiled corpus (§4.7). NEVER used
// for correctness (g-rag-isolation); it returns nearest shapes, and it degrades to a
// declared method rather than throwing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexDir, search } from '../../../precedent/src/index.mjs';

export const name = 'precedent_search';
export const summary = 'Retrieve the nearest-shape precedent forms from the compiled corpus. Never a correctness lookup.';
export const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string' },
    archetype: { type: 'string' },
    componentTypes: { type: 'array', items: { type: 'string' } },
    regions: { type: 'array', items: { type: 'string' } },
    text: { type: 'string' },
    k: { type: 'integer', minimum: 1, maximum: 20 },
  },
};

function repoRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); }

/** @param {any} input @returns {any} */
export function run(input = {}) {
  const k = Number.isInteger(input.k) ? input.k : 3;
  try {
    const index = /** @type {any} */ (indexDir(path.join(repoRoot(), 'packages/sfs/corpus')));
    const query = { kind: input.kind, archetype: input.archetype, componentTypes: input.componentTypes, regions: input.regions, text: input.text, k };
    const r = /** @type {any} */ (search(query, index));
    return { method: r.method, results: r.results ?? [], indexedAt: index.indexedAt ?? null, corpusSize: r.corpusSize ?? index.size ?? 0, degraded: r.degraded ?? false };
  } catch (e) {
    return { method: 'shape', results: [], indexedAt: null, corpusSize: 0, degraded: true, reason: String(/** @type {Error} */ (e).message).split('\n')[0] };
  }
}
