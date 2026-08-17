// Stage 1's acceptance: the clean fixture validates, and every negative case is
// rejected with the SPECIFIC domain code, not merely rejected.
//
// The codes matter more than the rejection. A schema that rejects everything with
// one generic error is indistinguishable from a broken schema, and the fix hint a
// caller acts on is selected by the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, FORBIDDEN_KEYS, SFS_VERSION } from '../src/compile/s1-parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/clean/bookings-table.sfs.json');

/** @returns {any} a fresh deep copy, so one case cannot leak into the next */
function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8').replace(/^﻿/, ''));
}

test('the clean fixture parses and validates', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const { doc } = parse(text, 'bookings-table.sfs.json');
  assert.equal(doc.sfs, SFS_VERSION);
  assert.equal(doc.module, 'boxfusion.test');
  assert.equal(doc.form, 'bookings-table');
  assert.equal(doc.kind, 'list');
  assert.equal(doc.body.length, 1, 'the fixture has exactly one root region, the data context');
});

test('the fixture is not vacuous: it reaches the constructs it exists to exercise', () => {
  const doc = fixture();
  const data = doc.body[0];
  assert.equal(data.node, 'data');
  const [toolbar, table, pager] = data.children;
  assert.equal(toolbar.node, 'row');
  assert.ok(toolbar.responsive.fill && toolbar.responsive.fixed, 'the row exercises reserve arithmetic');
  assert.equal(toolbar.responsive.stack, 'at:tablet');
  assert.equal(table.node, 'table');
  assert.equal(table.columns.length, 7);
  assert.equal(table.columns[6].render.kind, 'statusBadge');
  assert.equal(table.onRowClick.do, 'navigate');
  assert.equal(pager.node, 'pager');
  const actions = toolbar.children[1].children[0];
  assert.equal(actions.items[0].do, 'openDialog');
  assert.equal(actions.items[0].onSuccess.do, 'refresh');
});

// Each row is [name, mutation, expected code]. A case that stops reproducing its
// code is a real regression: either the schema loosened or a code changed meaning.
/** @type {[string, (d:any) => void, string][]} */
const NEGATIVE = [
  ['a region names id', (d) => { d.body[0].id = 'x'; }, 'SFS-1003'],
  ['an action names actionName', (d) => { d.body[0].children[0].children[1].children[0].items[0].actionName = 'Show Dialog'; }, 'SFS-1003'],
  ['a node names componentName', (d) => { d.body[0].componentName = 'bookings'; }, 'SFS-1003'],
  ['two siblings share a name', (d) => { d.body[0].children.push({ node: 'pager', name: 'bookingsPager' }); }, 'SFS-1005'],
  ['the sfs version is not 1.0', (d) => { d.sfs = '2.0'; }, 'SFS-1001'],
  ['a literal hex reaches style.bg', (d) => { d.body[0].children[1].style.bg = '#ffffff'; }, 'SFS-1101'],
  ['a region carries an unknown key', (d) => { d.body[0].children[1].sortOrder = 3; }, 'SFS-1101'],
  ['responsive uses below: instead of at:', (d) => { d.body[0].children[0].responsive.stack = 'below:tablet'; }, 'SFS-1101'],
  ['fixed is declared with no fill to consume the reserve', (d) => { delete d.body[0].children[0].responsive.fill; }, 'SFS-1101'],
  ['a statusBadge column omits its refList', (d) => { delete d.body[0].children[1].columns[6].render.refList; }, 'SFS-1101'],
  ['a form target has no module prefix', (d) => { d.body[0].children[0].children[1].children[0].items[0].with.form = 'booking-create'; }, 'SFS-1101'],
  ['a name breaks the ident pattern', (d) => { d.body[0].name = 'Bookings'; }, 'SFS-1101'],
  ['a list kind declares no entity', (d) => { delete d.entity; }, 'SFS-1101'],
  ['a fixed width is not px', (d) => { d.body[0].children[0].responsive.fixed.addCell = '30%'; }, 'SFS-1101'],
  ['a table declares no columns', (d) => { delete d.body[0].children[1].columns; }, 'SFS-1101'],
];

for (const [name, mutate, code] of NEGATIVE) {
  test(`rejected with ${code}: ${name}`, () => {
    const doc = fixture();
    mutate(doc);
    assert.throws(() => parse(JSON.stringify(doc), 'negative'), (e) => {
      assert.equal(/** @type {{code:string}} */ (e).code, code,
        `expected ${code} but got ${/** @type {{code:string}} */ (e).code}: ${/** @type {Error} */ (e).message.slice(0, 200)}`);
      return true;
    });
  });
}

test('an args map whose key is literally "id" is data, not a forged id', () => {
  // The regression this pins: `navigate` query parameters are named by the TARGET
  // form, so `args: {id: ...}` is a parameter called id. Scanning it as an SFS key
  // made the canonical fixture unparseable.
  const doc = fixture();
  assert.equal(doc.body[0].children[1].onRowClick.with.args.id, '{{selectedRow.id}}');
  assert.doesNotThrow(() => parse(JSON.stringify(doc), 'args-id'));
});

test('every forbidden key is actually rejected somewhere reachable', () => {
  // Guards against a key sitting in the list while nothing enforces it.
  assert.equal(FORBIDDEN_KEYS.length, 6);
  for (const key of FORBIDDEN_KEYS) {
    const doc = fixture();
    doc.body[0][key] = 'planted';
    assert.throws(() => parse(JSON.stringify(doc), `forbidden-${key}`),
      (e) => /** @type {{code:string}} */ (e).code === 'SFS-1003',
      `"${key}" is in FORBIDDEN_KEYS but planting it on a region did not raise SFS-1003`);
  }
});
