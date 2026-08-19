// WP-5e / D-101 regression: the `columns` grid lift.
//
// `columns` is the #1 IR gap in docs/rebuild-brief/corpus-intake/MINING-REPORT.md §5
// (241 forms escaping). A production `columns` grid whose flex spans are all EQUAL
// lifts to a flex `row` of equal-width `col`s and round-trips; an UNEQUAL grid stays a
// structural escape, because SFS layout widths are px-fixed/fill, not 24-grid ratios,
// so an unequal grid cannot be expressed without inventing a width the round-trip gate
// would not catch as wrong (D-101 refines D-035).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compile/index.mjs';
import { decompile } from '../src/decompile/index.mjs';

/** A two-column production `columns` grid with the given flex spans. @param {number} fa @param {number} fb */
const columnsGrid = (fa, fb) => ([{
  id: 'c1', type: 'columns', name: 'grid', parentId: null,
  columns: [
    { id: 'ca', flex: fa, offset: 0, components: [{ id: 't1', type: 'text', name: 'a', content: 'L', parentId: 'ca' }] },
    { id: 'cb', flex: fb, offset: 0, components: [{ id: 't2', type: 'text', name: 'b', content: 'R', parentId: 'cb' }] },
  ],
  components: [],
}]);

test('an equal-span columns grid lifts to a flex row of cols and round-trips', () => {
  const { sfs, structuralEscapes } = /** @type {any} */ (decompile(columnsGrid(12, 12)));
  assert.equal(sfs.body[0].node, 'row', 'the columns grid becomes a flex row');
  assert.deepEqual(sfs.body[0].children.map((/** @type {any} */ c) => c.node), ['col', 'col'], 'one col per grid column');
  assert.equal(structuralEscapes, 0, 'no structural escape for an equal-span grid');
  const m1 = compile(JSON.stringify(sfs)).envelope.Markup;
  const back = /** @type {any} */ (decompile(compile(JSON.stringify(sfs)).envelope)).sfs;
  const m2 = compile(JSON.stringify(back)).envelope.Markup;
  assert.equal(m1, m2, 'the lift round-trips: markup is stable after one compile cycle');
});

test('an unequal-span columns grid stays a structural escape', () => {
  const { sfs, structuralEscapes } = /** @type {any} */ (decompile(columnsGrid(8, 16)));
  assert.equal(sfs.body[0].node, 'raw', 'an unequal grid is not faithfully expressible, so it escapes');
  assert.equal(structuralEscapes, 1, 'the escape is counted, not hidden');
});
