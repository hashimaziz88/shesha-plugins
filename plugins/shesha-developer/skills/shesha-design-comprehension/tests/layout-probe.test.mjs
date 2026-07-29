import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterContainerChildren,
  buildMultiColumnContainers,
  groupByRowBand,
  clusterXBands,
  overlap1d
} from '../scripts/lib/cluster.mjs';
import layoutProbeModule from '../scripts/layout-probe.js';

var X_TOL = 16;
var Y_TOL = 14;

function kid(id, x, y, w, h) {
  return { id: id, parentId: 1, rect: { x: x, y: y, w: w, h: h } };
}

/* ── the five acceptance scenarios from the task brief ───────────────────── */

test('a genuine 2-column row clusters to columnCount 2', () => {
  var kids = [kid(2, 40, 100, 400, 40), kid(3, 460, 100, 400, 40)];
  var result = clusterContainerChildren(kids, { xTolerance: X_TOL, yTolerance: Y_TOL });
  assert.equal(result.columnCount, 2);
});

test('a vertically-stacked indented pair clusters to columnCount 1 (not 2)', () => {
  // Same left-edge-distinctness trap the outer/inner div nesting produces:
  // two children at DIFFERENT x, but stacked (non-overlapping y ranges) —
  // the old "distinct left edges" logic would have called this 2 columns.
  var kids = [kid(2, 40, 0, 300, 40), kid(3, 64, 60, 300, 40)];
  var result = clusterContainerChildren(kids, { xTolerance: X_TOL, yTolerance: Y_TOL });
  assert.equal(result.columnCount, 1);
});

test('a fixed rail + fill main reports native px widths [332, N]', () => {
  var nodes = [
    { id: 1, parentId: null, rect: { x: 0, y: 0, w: 1440, h: 900 }, label: 'body' },
    kid(2, 40, 0, 840, 600),   // fill main
    kid(3, 900, 0, 332, 600)  // fixed rail
  ];
  var containers = buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });
  assert.equal(containers.length, 1);
  var c = containers[0];
  assert.equal(c.columnCount, 2);
  assert.deepEqual(c.childIds, [2, 3]);
  assert.deepEqual(c.childWidths, [840, 332]);
  // the brief's shape is [332, N] — rail at a fixed width, fill at whatever N is
  assert.ok(c.childWidths.includes(332));
});

test('a 6-equal-cell strip clusters to columnCount 6', () => {
  var kids = [];
  for (var i = 0; i < 6; i++) kids.push(kid(10 + i, i * 150, 0, 140, 40));
  var result = clusterContainerChildren(kids, { xTolerance: X_TOL, yTolerance: Y_TOL });
  assert.equal(result.columnCount, 6);
});

test('an empty container produces no multiColumnContainer entry', () => {
  var nodes = [{ id: 1, parentId: null, rect: { x: 0, y: 0, w: 400, h: 200 }, label: 'empty' }];
  var containers = buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });
  assert.deepEqual(containers, []);
});

/* ── defect #1: childWidths is emitted, index-aligned with childIds ──────── */

test('childWidths is index-aligned with childIds for a multi-cell row', () => {
  var nodes = [
    { id: 1, parentId: null, rect: { x: 0, y: 0, w: 900, h: 200 }, label: 'row' },
    kid(2, 0, 0, 100, 40),
    kid(3, 116, 0, 250, 40),
    kid(4, 382, 0, 60, 40)
  ];
  var containers = buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });
  var c = containers[0];
  c.childIds.forEach(function (id, idx) {
    var node = nodes.find(function (n) { return n.id === id; });
    assert.equal(c.childWidths[idx], node.rect.w);
  });
});

/* ── defect #2: colSpan24 (24-unit grid normalisation) is gone ───────────── */

test('no node produced by buildMultiColumnContainers carries a colSpan24 field', () => {
  var nodes = [
    { id: 1, parentId: null, rect: { x: 0, y: 0, w: 900, h: 200 }, label: 'row' },
    kid(2, 0, 0, 300, 40),
    kid(3, 316, 0, 300, 40)
  ];
  buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });
  nodes.forEach(function (n) { assert.equal('colSpan24' in n, false); });
});

/* ── per-child rowBand/colIndex assignment (used by the assertion grammar) ─ */

test('siblings sharing a row band get the same rowBand and distinct colIndex', () => {
  var nodes = [
    { id: 1, parentId: null, rect: { x: 0, y: 0, w: 900, h: 200 }, label: 'row' },
    kid(2, 0, 0, 300, 40),
    kid(3, 316, 0, 300, 40)
  ];
  buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });
  var a = nodes.find(function (n) { return n.id === 2; });
  var b = nodes.find(function (n) { return n.id === 3; });
  assert.equal(a.rowBand, b.rowBand);
  assert.notEqual(a.colIndex, b.colIndex);
});

/* ── clustering primitives ────────────────────────────────────────────────── */

test('overlap1d is positive for overlapping ranges, non-positive otherwise', () => {
  assert.ok(overlap1d(0, 40, 20, 60) > 0);
  assert.ok(overlap1d(0, 40, 100, 140) <= 0);
});

test('groupByRowBand is transitive across a chain of overlaps', () => {
  var children = [kid(2, 0, 0, 100, 50), kid(3, 0, 30, 100, 50), kid(4, 0, 70, 100, 50)];
  var groups = groupByRowBand(children, Y_TOL);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test('clusterXBands returns one band per distinct, non-overlapping left edge', () => {
  var group = [kid(2, 0, 0, 100, 40), kid(3, 200, 0, 100, 40)];
  var bands = clusterXBands(group, X_TOL);
  assert.equal(bands.length, 2);
});

/* ── the probe splices cluster.mjs into a self-contained PROBE_FN ─────────── */

test('layout-probe.js exports a self-contained PROBE_FN with the fixes applied', () => {
  var PROBE_FN = layoutProbeModule.PROBE_FN;
  assert.equal(typeof PROBE_FN, 'function');
  var src = PROBE_FN.toString();
  assert.ok(src.includes('childWidths'), 'PROBE_FN must emit childWidths');
  assert.ok(src.includes('buildMultiColumnContainers'), 'PROBE_FN must use the row-band-aware clustering');
  assert.equal(/colSpan24\s*=/.test(src), false, 'PROBE_FN must not normalise to a 24-unit grid');
  assert.equal(/(^|\n)\s*export\s+function/.test(src), false, 'the spliced module must not leave ESM export syntax in the browser payload');
});
