import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk, flatten, CHILD_KEYS } from '../scripts/lib/walk.mjs';

const tree = [
  { id: 'a', type: 'container', components: [
    { id: 'b', type: 'textField' },
    { id: 'c', type: 'card', content: { components: [{ id: 'd', type: 'text' }] } },
  ] },
  { id: 'e', type: 'tabs', tabs: [
    { key: 't1', components: [{ id: 'f', type: 'textField' }] },
    { key: 't2', components: [{ id: 'g', type: 'textField' }] },
  ] },
];

test('visits every typed node exactly once', () => {
  const seen = [];
  walk(tree, (n) => seen.push(n.id));
  assert.deepEqual(seen.sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('reports depth and parent', () => {
  const byId = {};
  walk(tree, (n, ctx) => { byId[n.id] = { depth: ctx.depth, parent: ctx.parent?.id ?? null }; });
  assert.deepEqual(byId.a, { depth: 0, parent: null });
  assert.deepEqual(byId.b, { depth: 1, parent: 'a' });
  assert.deepEqual(byId.d, { depth: 2, parent: 'c' });
  assert.deepEqual(byId.f, { depth: 1, parent: 'e' });
});

test('descends through a card content slot', () => {
  const seen = [];
  walk(tree, (n) => seen.push(n.id));
  assert.ok(seen.includes('d'), 'card content.components child was missed');
});

test('records the tab key a node sits under', () => {
  const slots = {};
  walk(tree, (n, ctx) => { slots[n.id] = ctx.slot; });
  assert.equal(slots.f, 't1');
  assert.equal(slots.g, 't2');
  assert.equal(slots.b, undefined);
});

test('descends through columns slot objects without treating them as components', () => {
  const withCols = [{ id: 'x', type: 'columns', columns: [
    { flex: 12, components: [{ id: 'y', type: 'textField' }] },
  ] }];
  const seen = [];
  walk(withCols, (n) => seen.push(n.id));
  // The slot object has no `type`, so it is traversed but not visited.
  assert.deepEqual(seen, ['x', 'y']);
});

test('produces a path usable in an error message', () => {
  const paths = {};
  walk(tree, (n, ctx) => { paths[n.id] = ctx.path; });
  assert.match(paths.b, /components/);
  assert.notEqual(paths.b, paths.g);
});

test('flatten returns one entry per node', () => {
  assert.equal(flatten(tree).length, 7);
});

test('tolerates a malformed tree without throwing', () => {
  assert.doesNotThrow(() => walk([null, undefined, { id: 'z' }, { type: 'text' }], () => {}));
});

test('CHILD_KEYS covers the framework slot names', () => {
  for (const k of ['components', 'columns', 'tabs', 'items']) assert.ok(CHILD_KEYS.includes(k));
});
