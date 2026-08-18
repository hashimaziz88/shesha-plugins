// The compiler's acceptance test (section 2.6). Compiles every clean fixture and
// asserts the eleven normaliser rules plus the count identities over the real output.
//
// The suite also asserts POSITIVE shape, so it cannot pass vacuously on an empty tree —
// the zero-coverage lesson applied to the test itself. A predicate that returns ok on a
// form with no nodes is worse than no predicate, because it reads as evidence.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { PREDICATES, identities, allNodes } from './predicates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLEAN = path.join(HERE, 'fixtures/clean');

/** Every clean fixture, discovered rather than listed, so a new one is covered at once. */
const FIXTURES = fs.readdirSync(CLEAN).filter((f) => f.endsWith('.sfs.json')).sort();

test('the clean fixture directory is not empty', () => {
  // Zero fixtures would make every test below pass over nothing.
  assert.ok(FIXTURES.length > 0, 'no *.sfs.json under test/fixtures/clean/');
});

for (const file of FIXTURES) {
  const text = fs.readFileSync(path.join(CLEAN, file), 'utf8');
  const result = compile(text, { source: file });
  const markup = JSON.parse(result.markup);
  const counts = /** @type {Record<string, number>} */ (result.report.counts);

  test(`${file}: compiles to a non-vacuous tree`, () => {
    const nodes = allNodes(markup);
    assert.ok(nodes.length >= 8, `only ${nodes.length} node(s) emitted`);
    assert.ok(/** @type {number} */ (result.report.markupBytes) > 0);
    assert.ok(nodes.every((n) => typeof n.id === 'string' && n.id.length === 36), 'every node carries a 36-char id');
    assert.ok(nodes.every((n) => typeof n.version === 'number'), 'every node carries a version integer');
  });

  for (const [rule, predicate] of Object.entries(PREDICATES)) {
    test(`${file}: ${rule}`, () => {
      const verdict = predicate(markup);
      assert.ok(verdict.ok, `${rule} failed — ${verdict.detail}`);
    });
  }

  test(`${file}: count identities A1..A5`, () => {
    const sfsBytes = Buffer.byteLength(JSON.stringify(JSON.parse(text)), 'utf8');
    const got = identities(counts, sfsBytes, /** @type {number} */ (result.report.markupBytes));
    for (const [id, verdict] of Object.entries(got)) {
      assert.ok(verdict.ok, `${id} failed — ${verdict.detail}`);
    }
  });

  test(`${file}: A7 column captions match the source SFS, in order`, () => {
    const doc = JSON.parse(text);
    /** @type {string[]} */
    const declared = [];
    /** @param {any} region @returns {void} */
    const walk = (region) => {
      if (Array.isArray(region.columns)) for (const c of region.columns) declared.push(c.caption);
      for (const c of region.children || []) walk(c);
    };
    for (const r of doc.body) walk(r);

    /** @type {string[]} */
    const emitted = [];
    for (const n of allNodes(markup)) {
      if (n.type !== 'datatable' && n.type !== 'childTable') continue;
      for (const item of /** @type {Record<string, unknown>[]} */ (n.items || [])) {
        if (item.columnType === 'crud-operations') continue;
        emitted.push(String(item.caption));
      }
    }
    assert.deepEqual(emitted, declared);
  });

  test(`${file}: no compiler-internal key reached the output`, () => {
    // A leaked `_sfsPath` would put the author's naming into shipped markup.
    assert.ok(!result.markup.includes('"_sfsPath"'), '_sfsPath leaked into the markup');
    assert.ok(!result.markup.includes('"_ownerRefTarget"'), '_ownerRefTarget survived stamping');
    assert.ok(!/"_[a-zA-Z]+":/.test(result.markup.replace(/"_(type|mode|code)":/g, '')),
      'an underscore-prefixed key other than the framework\'s _type/_mode/_code reached the output');
  });

  test(`${file}: the 23-field envelope is exact`, () => {
    const keys = Object.keys(result.envelope);
    assert.equal(keys.length, 23, `envelope has ${keys.length} fields`);
    assert.equal(result.envelope.ItemType, 'form');
    assert.equal(result.envelope.Suppress, false);
    assert.equal(result.envelope.DateUpdated, null, 'DateUpdated is server-owned and would introduce a clock');
    assert.deepEqual(result.envelope.BaseModules, []);
    assert.equal(result.envelope.Id, result.envelope.OriginId, 'Id and OriginId are identical by construction');
    assert.equal(result.envelope.Access, markup.formSettings.access, 'Access is mirrored from formSettings.access');
  });

  test(`${file}: Q5 determinism — repeated compiles are byte-identical`, () => {
    const first = compile(text, { source: file }).markup;
    for (let i = 0; i < 12; i += 1) {
      assert.equal(compile(text, { source: file }).markup, first, `compile ${i + 2} diverged from compile 1`);
    }
  });

  test(`${file}: ids are seeded v5 and recomputable from the meta sidecar`, () => {
    const nodes = /** @type {{id:string, sfsPath:string}[]} */ (result.meta.nodes);
    assert.ok(nodes.length > 0);
    for (const n of nodes) {
      assert.match(n.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        `${n.sfsPath} -> ${n.id} is not a v5 uuid`);
    }
    assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length, 'two nodes share an id');
    assert.equal(new Set(nodes.map((n) => n.sfsPath)).size, nodes.length, 'two nodes share an sfsPath');
  });

  test(`${file}: every id resolves as a parentId or is a root`, () => {
    const nodes = allNodes(markup);
    const ids = new Set(nodes.map((n) => String(n.id)));
    // Slot ids are legitimate parents but are not components, so add them.
    for (const n of nodes) {
      for (const slot of ['content', 'header']) {
        const w = /** @type {Record<string, unknown>|undefined} */ (n[slot]);
        if (w !== undefined && w !== null && typeof w === 'object' && typeof w.id === 'string') ids.add(w.id);
      }
    }
    for (const n of nodes) {
      const p = String(n.parentId);
      assert.ok(p === 'root' || ids.has(p),
        `${String(n.componentName)} has parentId ${p}, which is neither "root" nor an id in this form`);
    }
  });
}

test('every A1 summand is exercised across the fixture SET (D-080)', () => {
  // A1's per-fixture guard covers `components` and `items`. `slots` exists only
  // where a slotted type does, so its non-vacuity is a property of the SET: at
  // least one clean fixture must stamp a slot id, or the slot arithmetic would
  // never be tested by anything.
  const totals = FIXTURES.map((file) => {
    const counts = /** @type {Record<string, number>} */ (
      compile(fs.readFileSync(path.join(CLEAN, file), 'utf8'), { source: file }).report.counts);
    return counts.slots;
  });
  const withSlots = totals.filter((n) => n > 0);
  assert.ok(withSlots.length > 0,
    `no clean fixture produces a slot, so A1's slots term is never exercised (per-fixture slots: ${totals.join(', ')})`);
});

test('the A1 items term is exercised across the fixture SET (D-091)', () => {
  // A1's per-fixture guard covers `components`. `items` exists only where a table or
  // an action group does, so its non-vacuity is a property of the SET: at least one
  // clean fixture must emit items, or the items arithmetic is never tested.
  const totals = FIXTURES.map((file) => /** @type {Record<string, number>} */ (
    compile(fs.readFileSync(path.join(CLEAN, file), 'utf8'), { source: file }).report.counts).items);
  assert.ok(totals.some((n) => n > 0),
    `no clean fixture emits items, so A1's items term is never exercised (per-fixture items: ${totals.join(', ')})`);
});
