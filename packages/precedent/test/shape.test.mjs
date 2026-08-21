// @shesha/precedent — the shape function and its similarity (WP-9, §4.7.2). Shape is
// deterministic (same form → same shape, across machines), self-similarity is 1, and a
// full brute-force scan of a 5000-row synthetic corpus completes well inside the 120 ms
// wall-clock budget (D-112) — proof a vector extension is unnecessary at this corpus size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, similarity } from '../src/shape.mjs';
import { buildIndex, search } from '../src/index.mjs';

/** @param {string} kind @param {string[]} types */
const form = (kind, types) => ({
  formSettings: { dataSubmitterType: kind === 'create' ? 'gql' : 'none', modelType: 'boxfusion.test.Domain.X' },
  components: types.map((t, i) => ({ type: t, id: `c${i}` })),
});

test('shapeOf is deterministic and total', () => {
  const f = form('list', ['dataContext', 'datatable', 'pager']);
  assert.deepEqual(shapeOf(f), shapeOf(f));
  assert.deepEqual(shapeOf({}), shapeOf({})); // a malformed form yields a shape, not a throw
  const s = shapeOf(f);
  assert.equal(s.kind, 'list');
  assert.equal(s.entityDepth, 4);
  assert.equal(s.nodeMultiset.datatable, 1);
  assert.ok(s.regionTopology.includes('dataContext'));
});

test('similarity is 1 for identical shapes and lower for different ones', () => {
  const a = shapeOf(form('list', ['dataContext', 'datatable', 'pager']));
  const b = shapeOf(form('list', ['dataContext', 'datatable', 'pager']));
  const c = shapeOf(form('create', ['card', 'textField', 'numberField', 'buttonGroup']));
  assert.equal(similarity(a, b), 1);
  assert.ok(similarity(a, c) < similarity(a, b));
  assert.ok(similarity(a, c) >= 0);
});

test('regionTopology captures nesting depth-first', () => {
  const nested = { components: [{ type: 'card', id: 'x', content: { components: [{ type: 'datatable', id: 'y' }] } }] };
  assert.equal(shapeOf(nested).regionTopology, 'card(datatable)');
});

test('a full scan of a 5000-row synthetic corpus completes in <= 120 ms', () => {
  const TYPES = ['dataContext', 'datatable', 'pager', 'card', 'textField', 'numberField', 'buttonGroup', 'container', 'text', 'dropdown'];
  /** @type {{sfsPath:string, form:any}[]} */
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    const n = 3 + (i % 8);
    const types = Array.from({ length: n }, (_, j) => TYPES[(i + j) % TYPES.length]);
    entries.push({ sfsPath: `synthetic/${i}.json`, form: form(i % 2 ? 'create' : 'list', /** @type {string[]} */ (types)) });
  }
  const index = buildIndex(entries);
  assert.equal(index.length, 5000);
  const query = { form: form('list', ['dataContext', 'datatable', 'pager', 'card']), k: 3 };
  const started = performance.now();
  const r = search(query, index);
  const ms = performance.now() - started;
  assert.equal(r.results.length, 3);
  // Budget is 120ms, not the ~40ms the scan costs in isolation: the suite runs test
  // FILES in parallel, so this wall-clock reading absorbs scheduler/GC noise from
  // co-running workers and reads 50-70ms under load (D-112). 120ms still fails hard on
  // the real regression this guards — an O(n^2) edit distance would be seconds.
  assert.ok(ms <= 120, `full 5000-row scan took ${ms.toFixed(1)}ms, over the 120ms budget`);
});
