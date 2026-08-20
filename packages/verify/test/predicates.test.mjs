// The placement predicate engine (WP-3b.2, D-014/D-105). These lock the value each of
// the 18 predicates returns over the compiled tree, the comparator semantics, the
// ABSENT-is-fail rule, the frozen registry, and that assertions.schema.json rejects a
// contract the engine could not evaluate. A predicate whose value drifts is a caught
// failure here, before any tier trusts it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { compile } from '../../sfs/src/compile/index.mjs';
import { buildIndex } from '../src/predicates/tree.mjs';
import { PREDICATES, PREDICATE_NAMES, ABSENT, compare, evaluate } from '../src/predicates/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const Ajv = /** @type {any} */ (/** @type {any} */ (Ajv2020).default ?? Ajv2020);

/**
 * Invoke a predicate by name. PREDICATES is a Record, so an index read is `Fn|undefined`
 * under noUncheckedIndexedAccess; the test knows the name is real and asserts it.
 * @param {string} name @param {any} args @param {import('../src/predicates/tree.mjs').TreeIndex} idx
 */
function px(name, args, idx) {
  const fn = PREDICATES[name];
  assert.ok(fn, `no such predicate "${name}"`);
  return fn(args, idx);
}

/** @param {string} name */
function meta(name) {
  const src = fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/clean', `${name}.sfs.json`), 'utf8');
  return /** @type {any} */ (compile(src, { source: name })).meta;
}

test('predicates read declared placement off the compiled sidecar', () => {
  const idx = buildIndex(meta('employees-table'));
  const v = (/** @type {string} */ pred, /** @type {any} */ args) => px(pred, args, idx);
  assert.equal(v('cellCount', { row: 'toolbar' }), 2);
  assert.equal(v('cellSizing', { node: 'searchCell' }), 'fill');
  assert.equal(v('cellSizing', { node: 'addCell' }), 'fixed');
  assert.equal(v('cellPx', { node: 'addCell' }), 200);
  assert.equal(v('cellsEqual', { row: 'toolbar' }), false);
  assert.equal(v('cellRow', { node: 'searchCell' }), 'toolbar');
  // fill = 1440 - 200 (fixed) - 216 (reserve) = 1024; ratio to the 200px fixed cell.
  assert.equal(v('ratio', { a: 'searchCell', b: 'addCell' }), 1024 / 200);
  assert.equal(v('region', { node: 'pageShell' }), 'page');
  assert.equal(v('componentType', { node: 'pageShell' }), 'card');
  assert.equal(v('count', { type: 'datatable' }), 1);
  assert.equal(v('depth', { node: 'pageShell' }), 0);
  assert.equal(v('parent', { node: 'pageShell' }), 'root');
  assert.equal(v('tab', { node: 'pageShell' }), null);
  assert.ok(Array.isArray(v('ancestors', { node: 'searchCell' })));
  assert.ok(v('ancestors', { node: 'searchCell' }).includes('toolbar'));
});

test('a predicate on an absent node returns ABSENT, which never satisfies a comparator', () => {
  const m = meta('employees-table');
  assert.equal(px('cellSizing', { node: 'noSuchNode' }, buildIndex(m)), ABSENT);
  assert.equal(evaluate({ predicate: 'cellSizing', args: { node: 'noSuchNode' }, expect: { eq: 'fill' } }, m).pass, false);
  assert.equal(evaluate({ predicate: 'region', args: { node: 'noSuchNode' }, expect: { eq: 'body' } }, m).pass, false);
});

test('row-group predicates read orientation: a col of 2-cell rows sizes [2,2], a col stacks alone', () => {
  // A synthetic sidecar: detailsCard (col) has two `row` children, each with two cells;
  // rail (col) stacks two standalone panels.
  const n = (/** @type {any} */ over) => /** @type {any} */ ({
    id: over.id, name: over.name, sfsPath: `/${over.name}`, type: over.type || 'container',
    parent: over.parent, depth: 0, region: 'body', tabKey: null,
    cell: { row: over.row || null, index: over.index || 0, count: 1, sizing: 'auto', px: null, reservePx: null },
    rowGroup: { row: null, index: 0, members: [] }, align: 'start', orientation: over.orientation ?? null,
  });
  const nodes = [
    n({ id: 'dc', name: 'detailsCard', parent: 'root', orientation: 'col' }),
    n({ id: 'r1', name: 'row1', parent: 'dc', orientation: 'row', row: 'detailsCard', index: 0 }),
    n({ id: 'r1a', name: 'r1a', parent: 'r1', row: 'row1', index: 0 }),
    n({ id: 'r1b', name: 'r1b', parent: 'r1', row: 'row1', index: 1 }),
    n({ id: 'r2', name: 'row2', parent: 'dc', orientation: 'row', row: 'detailsCard', index: 1 }),
    n({ id: 'r2a', name: 'r2a', parent: 'r2', row: 'row2', index: 0 }),
    n({ id: 'r2b', name: 'r2b', parent: 'r2', row: 'row2', index: 1 }),
    n({ id: 'rail', name: 'rail', parent: 'root', orientation: 'col' }),
    n({ id: 'pay', name: 'paymentsPanel', parent: 'rail', row: 'rail', index: 0 }),
    n({ id: 'not', name: 'notesPanel', parent: 'rail', row: 'rail', index: 1 }),
  ];
  const idx = buildIndex({ nodes });
  assert.deepEqual(px('rowGroupSizes', { container: 'detailsCard' }, idx), [2, 2]);
  assert.deepEqual(px('rowGroupSizes', { container: 'rail' }, idx), [1, 1]);
  // In the rail (a col), notesPanel stands alone — its members are just itself.
  assert.deepEqual(px('rowGroupMembers', { node: 'notesPanel' }, idx), ['notesPanel']);
  // In row1 (a row), r1a shares its row with r1b.
  assert.deepEqual(px('rowGroupMembers', { node: 'r1a' }, idx), ['r1a', 'r1b']);
  assert.equal(px('nextSibling', { node: 'paymentsPanel' }, idx), 'notesPanel');
  assert.equal(px('nextSibling', { node: 'notesPanel' }, idx), null);
});

test('every comparator matches its spec', () => {
  assert.equal(compare(3, { eq: 3 }).ok, true);
  assert.equal(compare(3, { neq: 4 }).ok, true);
  assert.equal(compare(3, { gte: 3 }).ok, true);
  assert.equal(compare(3, { lte: 2 }).ok, false);
  assert.equal(compare(332, { within: [292, 372] }).ok, true);
  assert.equal(compare('fill', { oneOf: ['fill', 'fixed'] }).ok, true);
  assert.equal(compare(['a', 'b'], { includes: 'a' }).ok, true);
  assert.equal(compare(['a', 'b'], { includesAll: ['a', 'b'] }).ok, true);
  assert.equal(compare([2, 2], { everyEq: 2 }).ok, true);
  assert.equal(compare([2, 3], { everyEq: 2 }).ok, false);
  assert.equal(compare(null, { isNull: true }).ok, true);
  assert.equal(compare('x', { notNull: true }).ok, true);
  assert.equal(compare(3, { eq: 3, neq: 4 }).ok, false, 'two comparators in one expect is a contract error');
});

test('the exported PREDICATES are exactly the frozen registry', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/verify/config/predicates.json'), 'utf8'));
  const registry = cfg.predicates.map((/** @type {any} */ p) => p.name).sort();
  assert.deepEqual(PREDICATE_NAMES, registry, 'index.mjs PREDICATES and predicates.json disagree');
  assert.equal(PREDICATE_NAMES.length, 18);
});

test('assertions.schema.json accepts a legal contract and rejects an unknown predicate or a two-comparator expect', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/verify/schema/assertions.schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate([{ id: 'A1', tier: 't3', predicate: 'cellCount', args: { row: 'toolbar' }, expect: { eq: 2 } }]), true);
  assert.equal(validate([{ id: 'A2', tier: 't3', predicate: 'notAPredicate', args: {}, expect: { eq: 1 } }]), false);
  assert.equal(validate([{ id: 'A3', tier: 't3', predicate: 'cellCount', args: { row: 'x' }, expect: { eq: 2, neq: 3 } }]), false);
});
