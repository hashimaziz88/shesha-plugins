import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAssertion, evaluate } from '../scripts/lib/assertions.mjs';
import { buildMultiColumnContainers } from '../scripts/lib/cluster.mjs';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var CLI = path.join(__dirname, '..', 'scripts', 'verify-placement.mjs');

/* ── parseAssertion ────────────────────────────────────────────────────── */

test('parseAssertion accepts all five predicate forms', () => {
  assert.deepEqual(parseAssertion('same-cluster(mainColumn, detailRail)'),
    { predicate: 'same-cluster', args: { a: 'mainColumn', b: 'detailRail' }, raw: 'same-cluster(mainColumn, detailRail)' });
  assert.deepEqual(parseAssertion('parent-of(toolbar, addButtonGroup)'),
    { predicate: 'parent-of', args: { a: 'toolbar', b: 'addButtonGroup' }, raw: 'parent-of(toolbar, addButtonGroup)' });
  assert.deepEqual(parseAssertion('ratio(mainColumn, detailRail, 2.5, 10)'),
    { predicate: 'ratio', args: { a: 'mainColumn', b: 'detailRail', min: 2.5, max: 10 }, raw: 'ratio(mainColumn, detailRail, 2.5, 10)' });
  assert.deepEqual(parseAssertion('same-rowband(addButtonGroup, quickSearch)'),
    { predicate: 'same-rowband', args: { a: 'addButtonGroup', b: 'quickSearch' }, raw: 'same-rowband(addButtonGroup, quickSearch)' });
  assert.deepEqual(parseAssertion('tab(passengerName, general)'),
    { predicate: 'tab', args: { a: 'passengerName', key: 'general' }, raw: 'tab(passengerName, general)' });
});

test('parseAssertion tolerates whitespace around commas/parens', () => {
  var parsed = parseAssertion('ratio( a , b ,  1.5 , 4 )');
  assert.equal(parsed.predicate, 'ratio');
  assert.equal(parsed.args.min, 1.5);
  assert.equal(parsed.args.max, 4);
});

test('parseAssertion rejects an English assertion with a message naming the valid forms', () => {
  assert.throws(
    () => parseAssertion('left ≥ 2.5× right; rail ≈ 332px ± 40'),
    /Unparseable assertion.*Valid forms:.*same-cluster\(a, b\).*parent-of\(a, b\).*ratio\(a, b, min, max\).*same-rowband\(a, b\).*tab\(a, key\)/s
  );
});

test('parseAssertion rejects a near-miss (wrong arg count, unknown predicate)', () => {
  assert.throws(() => parseAssertion('same-cluster(a)'), /Unparseable assertion/);
  assert.throws(() => parseAssertion('left-of(a, b)'), /Unparseable assertion/);
  assert.throws(() => parseAssertion('ratio(a, b, 2.5)'), /Unparseable assertion/);
});

/* ── shared synthetic probe fixture ───────────────────────────────────────
 * body (id=1)
 *   mainColumn (id=2, x=40,  y=0, w=840, h=600)  -- fill
 *   detailRail (id=3, x=900, y=0, w=332, h=600)  -- fixed rail
 *     relatedInvoices (id=4, parent=3, tabKey: none)
 *   detailTabs (id=5, parent=2)
 *     passengerName (id=6, parent=5, tabKey='general')
 *     attachments   (id=7, parent=5, tabKey='documents')
 * toolbar (id=10)
 *   addButtonGroup (id=11, x=0,   y=0, w=100, h=30)
 *   quickSearch    (id=12, x=140, y=0, w=200, h=30)
 * ── */
function buildProbe() {
  var nodes = [
    { id: 1, parentId: null, name: 'body', label: 'body', rect: { x: 0, y: 0, w: 1272, h: 600 } },
    { id: 2, parentId: 1, name: 'mainColumn', label: 'mainColumn', rect: { x: 40, y: 0, w: 840, h: 600 } },
    { id: 3, parentId: 1, name: 'detailRail', label: 'detailRail', rect: { x: 900, y: 0, w: 332, h: 600 } },
    { id: 4, parentId: 3, name: 'relatedInvoices', label: 'relatedInvoices', rect: { x: 900, y: 40, w: 300, h: 400 } },
    { id: 5, parentId: 2, name: 'detailTabs', label: 'detailTabs', rect: { x: 40, y: 40, w: 800, h: 500 } },
    { id: 6, parentId: 5, name: 'passengerName', label: 'passengerName', tabKey: 'general', rect: { x: 60, y: 80, w: 300, h: 30 } },
    { id: 7, parentId: 5, name: 'attachments', label: 'attachments', tabKey: 'documents', rect: { x: 60, y: 400, w: 300, h: 30 } },
    { id: 10, parentId: null, name: 'toolbar', label: 'toolbar', rect: { x: 0, y: 700, w: 1272, h: 40 } },
    { id: 11, parentId: 10, name: 'addButtonGroup', label: 'addButtonGroup', rect: { x: 0, y: 700, w: 100, h: 30 } },
    { id: 12, parentId: 10, name: 'quickSearch', label: 'quickSearch', rect: { x: 140, y: 700, w: 200, h: 30 } }
  ];
  var containers = buildMultiColumnContainers(nodes, { xTolerance: 16, yTolerance: 14 });
  return { nodes: nodes, multiColumnContainers: containers };
}

/* ── same-cluster ──────────────────────────────────────────────────────── */

test('same-cluster passes for two nodes sharing a split column', () => {
  var probe = buildProbe();
  var results = evaluate(['same-cluster(addButtonGroup, quickSearch)'], probe);
  // addButtonGroup and quickSearch are in DIFFERENT columns of the same row —
  // same-cluster should therefore FAIL, proving it distinguishes column
  // membership rather than just "same parent".
  assert.equal(results[0].pass, false);
});

test('same-cluster passes when both nodes truly share a column (two stacked panels in the rail)', () => {
  var probe = buildProbe();
  // relatedInvoices is the sole child of detailRail — same-cluster against
  // itself trivially shares a column; more usefully, add a sibling in the
  // same column to prove positive detection.
  probe.nodes.push({ id: 8, parentId: 3, name: 'invoiceNotes', label: 'invoiceNotes', rect: { x: 900, y: 460, w: 300, h: 100 } });
  buildMultiColumnContainers(probe.nodes, { xTolerance: 16, yTolerance: 14 });
  var results = evaluate(['same-cluster(relatedInvoices, invoiceNotes)'], probe);
  assert.equal(results[0].pass, true);
});

test('same-cluster fails for nodes in different columns and names both operands', () => {
  var probe = buildProbe();
  var results = evaluate(['same-cluster(mainColumn, detailRail)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /mainColumn/);
  assert.match(results[0].message, /detailRail/);
});

/* ── parent-of ─────────────────────────────────────────────────────────── */

test('parent-of passes for an actual ancestor at any depth', () => {
  var probe = buildProbe();
  var results = evaluate(['parent-of(mainColumn, passengerName)'], probe); // mainColumn -> detailTabs -> passengerName
  assert.equal(results[0].pass, true);
});

test('parent-of fails when b is not a descendant of a, naming both operands', () => {
  var probe = buildProbe();
  var results = evaluate(['parent-of(detailRail, passengerName)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /detailRail/);
  assert.match(results[0].message, /passengerName/);
});

/* ── same-rowband ──────────────────────────────────────────────────────── */

test('same-rowband passes for siblings in one visual row', () => {
  var probe = buildProbe();
  var results = evaluate(['same-rowband(addButtonGroup, quickSearch)'], probe);
  assert.equal(results[0].pass, true);
});

test('same-rowband fails for nodes in different rows/parents', () => {
  var probe = buildProbe();
  var results = evaluate(['same-rowband(passengerName, attachments)'], probe);
  assert.equal(results[0].pass, false);
});

/* ── tab ───────────────────────────────────────────────────────────────── */

test('tab passes when the node sits under the asserted tab key', () => {
  var probe = buildProbe();
  var results = evaluate(['tab(passengerName, general)'], probe);
  assert.equal(results[0].pass, true);
});

test('tab fails when the node sits under a different tab key', () => {
  var probe = buildProbe();
  var results = evaluate(['tab(attachments, general)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /attachments/);
  assert.match(results[0].message, /general/);
});

/* ── ratio (against real childWidths from Task 2's cluster.mjs) ──────────── */

test('ratio passes against real childWidths produced by buildMultiColumnContainers', () => {
  var probe = buildProbe();
  var container = probe.multiColumnContainers.find(function (c) { return c.parentId === 1; });
  assert.ok(container, 'expected a multi-column container for the body row');
  assert.deepEqual(container.childWidths, [840, 332]);
  // 840 / 332 ≈ 2.53
  var results = evaluate(['ratio(mainColumn, detailRail, 2, 3)'], probe);
  assert.equal(results[0].pass, true);
  assert.match(results[0].actual, /840/);
  assert.match(results[0].actual, /332/);
});

test('ratio fails outside range and names both operands and the measured value', () => {
  var probe = buildProbe();
  var results = evaluate(['ratio(mainColumn, detailRail, 10, 20)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /mainColumn/);
  assert.match(results[0].message, /detailRail/);
  assert.match(results[0].message, /2\.53/); // measured ratio ~2.531
});

test('ratio fails when the two nodes are not split-children of the same container', () => {
  var probe = buildProbe();
  var results = evaluate(['ratio(passengerName, attachments, 0, 100)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /not both split-children/);
});

/* ── evaluate() with an unparseable assertion mixed in ───────────────────── */

test('evaluate reports an unparseable assertion as a failing result instead of throwing', () => {
  var probe = buildProbe();
  var results = evaluate(['tab(passengerName, general)', 'left ≥ 2.5× right'], probe);
  assert.equal(results.length, 2);
  assert.equal(results[0].pass, true);
  assert.equal(results[1].pass, false);
  assert.match(results[1].message, /Unparseable assertion/);
});

/* ── CLI exit codes ───────────────────────────────────────────────────────── */

function withTempDir(fn) {
  var dir = mkdtempSync(path.join(tmpdir(), 'verify-placement-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verify-placement.mjs exits 0 when every assertion passes', () => {
  withTempDir((dir) => {
    var probe = buildProbe();
    var blueprintPath = path.join(dir, 'b.json');
    var probePath = path.join(dir, 'p.json');
    writeFileSync(blueprintPath, JSON.stringify({ assertions: ['tab(passengerName, general)', 'ratio(mainColumn, detailRail, 2, 3)'] }));
    writeFileSync(probePath, JSON.stringify(probe));
    var result = execFileSync(process.execPath, [CLI, blueprintPath, probePath], { encoding: 'utf8' });
    assert.match(result, /2\/2 assertions passed/);
  });
});

test('verify-placement.mjs exits 1 when an assertion fails', () => {
  withTempDir((dir) => {
    var probe = buildProbe();
    var blueprintPath = path.join(dir, 'b.json');
    var probePath = path.join(dir, 'p.json');
    writeFileSync(blueprintPath, JSON.stringify({ assertions: ['tab(attachments, general)'] }));
    writeFileSync(probePath, JSON.stringify(probe));
    assert.throws(() => {
      execFileSync(process.execPath, [CLI, blueprintPath, probePath], { encoding: 'utf8' });
    }, (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stdout, /0\/1 assertions passed/);
      return true;
    });
  });
});

test('verify-placement.mjs exits 2 on missing arguments', () => {
  assert.throws(() => {
    execFileSync(process.execPath, [CLI], { encoding: 'utf8' });
  }, (err) => {
    assert.equal(err.status, 2);
    return true;
  });
});

/* ── fixture migration: every assertion in every fixture parses ─────────── */

test('every assertion in every one of the 8 blueprint fixtures parses under the typed grammar', () => {
  var fixturesDir = path.join(__dirname, '..', 'assets', 'blueprint-examples');
  var files = readdirSync(fixturesDir).filter((f) => f.endsWith('.blueprint.json'));
  assert.equal(files.length, 8, 'expected all 8 archetype fixtures');
  files.forEach((file) => {
    var blueprint = JSON.parse(readFileSync(path.join(fixturesDir, file), 'utf8'));
    (blueprint.assertions || []).forEach((raw) => {
      assert.doesNotThrow(() => parseAssertion(raw), file + ': "' + raw + '" failed to parse');
    });
  });
});

test('verify-placement.mjs accepts an optional --design probe without affecting the result', () => {
  withTempDir((dir) => {
    var probe = buildProbe();
    var blueprintPath = path.join(dir, 'b.json');
    var probePath = path.join(dir, 'p.json');
    var designPath = path.join(dir, 'd.json');
    writeFileSync(blueprintPath, JSON.stringify({ assertions: ['tab(passengerName, general)'] }));
    writeFileSync(probePath, JSON.stringify(probe));
    writeFileSync(designPath, JSON.stringify(probe));
    var result = execFileSync(process.execPath, [CLI, blueprintPath, probePath, '--design', designPath], { encoding: 'utf8' });
    assert.match(result, /1\/1 assertions passed/);
  });
});
