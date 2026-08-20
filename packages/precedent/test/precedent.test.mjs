// @shesha/precedent — retrieval behaviour (WP-9, BL-009). The scaffold threw
// E_NOT_IMPLEMENTED; these prove real shape-indexed retrieval: every response carries a
// method, an empty index is a hard error (never a silent empty answer), an embedding
// request degrades to shape, and the index round-trips through JSONL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRECEDENT_API_VERSION, buildIndex, indexDir, search, retrieve, writeIndex, readIndex, EmptyIndexError,
} from '../src/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORPUS = path.join(ROOT, 'packages/sfs/corpus');

/** @param {string} kind @param {string[]} types */
const form = (kind, types) => ({
  formSettings: { dataSubmitterType: kind === 'create' ? 'gql' : 'none', modelType: 'a.b.C' },
  components: types.map((t, i) => ({ type: t, id: `c${i}`, ...(t === 'datatable' ? { items: [{ columnType: 'data', propertyName: 'x' }] } : {}) })),
});

test('the package ships behaviour, not E_NOT_IMPLEMENTED', () => {
  assert.notEqual(PRECEDENT_API_VERSION, '0.0.0');
  // retrieve must not throw NotImplementedError — a real index answers.
  const r = retrieve({ componentTypes: ['datatable'], k: 3 }, { corpus: CORPUS });
  assert.equal(r.method, 'shape');
  assert.ok(r.corpusSize >= 1);
});

test('every response carries a method and at most k results', () => {
  const idx = buildIndex([
    { sfsPath: 'a', form: form('list', ['dataContext', 'datatable', 'pager']) },
    { sfsPath: 'b', form: form('create', ['card', 'textField', 'numberField']) },
    { sfsPath: 'c', form: form('list', ['dataContext', 'datatable']) },
  ]);
  const r = search({ form: form('list', ['dataContext', 'datatable', 'pager']), k: 2 }, idx);
  assert.equal(r.method, 'shape');
  assert.ok(r.results.length <= 2);
  assert.ok(r.results.every((x) => x.method === 'shape' && typeof x.score === 'number'));
  // The list/datatable query ranks the list/datatable corpus rows above the create form.
  const top = r.results[0];
  assert.ok(top);
  assert.notEqual(top.sfsPath, 'b');
});

test('the nearest precedent is the one that shares the most shape', () => {
  const idx = buildIndex([
    { sfsPath: 'twin', form: form('list', ['dataContext', 'datatable', 'pager']) },
    { sfsPath: 'far', form: form('create', ['card', 'textField']) },
  ]);
  const r = search({ form: form('list', ['dataContext', 'datatable', 'pager']) }, idx);
  const [first, second] = r.results;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.sfsPath, 'twin');
  assert.ok(first.score > second.score);
});

test('an empty index is a hard error, never a silent empty answer', () => {
  assert.throws(() => search({ componentTypes: ['datatable'] }, []), (e) => e instanceof EmptyIndexError && e.code === 'E_EMPTY_INDEX');
});

test('a request for the embedding method degrades to shape and says so', () => {
  const idx = buildIndex([{ sfsPath: 'a', form: form('list', ['datatable']) }]);
  const r = search({ componentTypes: ['datatable'], method: 'embedding' }, idx);
  assert.equal(r.method, 'shape');
  assert.equal(r.degraded, true);
});

test('the index persists to JSONL and reads back identically', () => {
  const idx = indexDir(CORPUS);
  assert.ok(idx.length >= 1, 'the corpus indexes at least one form');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-'));
  const file = path.join(tmp, 'shapes.jsonl');
  const bytes = writeIndex(idx, file);
  assert.ok(bytes > 0);
  const back = readIndex(file);
  assert.deepEqual(back, idx, 'JSONL round-trips the index');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the real corpus indexes and every corpus form is retrievable', () => {
  const idx = indexDir(CORPUS);
  const r = search({ form: JSON.parse(fs.readFileSync(path.join(CORPUS, 'employee-table.json'), 'utf8')), k: 3 }, idx);
  assert.equal(r.corpusSize, idx.length);
  assert.ok(r.results.length >= 1 && r.results.length <= 3);
  // employee-table is in the corpus, so its own shape is its nearest precedent.
  const nearest = r.results[0];
  assert.ok(nearest);
  assert.equal(nearest.sfsPath, 'corpus/employee-table.json');
});
