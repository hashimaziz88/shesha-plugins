// walk.mjs is the one tree walker (§3.2.2). These tests prove it reaches a
// component through EVERY declared channel — the property whose absence produced
// `structure walked 3, checked 6, failures 0` on three broken nodes under
// items/columns (§1.7 T5). If a channel is dropped from slots.json or the walker,
// the synthetic-tree test loses that node and fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkComponents, rootComponents } from '../src/walk.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// One identifiable child in every channel the registry declares.
const SYNTH = {
  components: [
    { id: 'root-container', type: 'container', components: [{ id: 'c-components', type: 'x' }] },
    {
      id: 'card1', type: 'card',
      content: { components: [{ id: 'c-content', type: 'y' }] },
      header: { components: [{ id: 'c-header', type: 'z' }] },
    },
    { id: 'bg1', type: 'buttonGroup', items: [{ id: 'c-items', type: 'button' }] },
    {
      id: 'dt1', type: 'datatable',
      columns: [{
        id: 'c-columns', type: 'col',
        displayComponent: { id: 'c-display', type: 'disp' },
        editComponent: { id: 'c-edit', type: 'edit' },
        createComponent: { id: 'c-create', type: 'create' },
      }],
    },
    { id: 'tabs1', type: 'tabs', tabs: [{ id: 'c-tabs', type: 'tab' }] },
    { id: 'cp1', type: 'collapsiblePanel', panels: [{ id: 'c-panels', type: 'panel' }] },
  ],
};

const EXPECTED_IDS = [
  'root-container', 'c-components',
  'card1', 'c-content', 'c-header',
  'bg1', 'c-items',
  'dt1', 'c-columns', 'c-display', 'c-edit', 'c-create',
  'tabs1', 'c-tabs',
  'cp1', 'c-panels',
];

test('the walker reaches a component through every declared channel', () => {
  const ids = [...walkComponents(SYNTH)].map((v) => v.node.id).sort();
  assert.deepEqual(ids, [...EXPECTED_IDS].sort(),
    'a channel is missing from slots.json or walk.mjs — a node reached only through it was never visited');
});

test('each visit records the channel it was reached through', () => {
  const bySlot = new Map([...walkComponents(SYNTH)].map((v) => [v.node.id, v.slot]));
  assert.equal(bySlot.get('root-container'), 'components');
  assert.equal(bySlot.get('c-content'), 'content.components');
  assert.equal(bySlot.get('c-header'), 'header.components');
  assert.equal(bySlot.get('c-items'), 'items');
  assert.equal(bySlot.get('c-columns'), 'columns');
  assert.equal(bySlot.get('c-tabs'), 'tabs');
  assert.equal(bySlot.get('c-panels'), 'panels');
  assert.equal(bySlot.get('c-display'), 'displayComponent');
  assert.equal(bySlot.get('c-create'), 'createComponent');
});

test('parentNode and where locate every visit', () => {
  const byId = new Map([...walkComponents(SYNTH)].map((v) => [v.node.id, v]));
  /** @param {string} id @returns {{node:any, where:string, slot:string, parentNode:any}} */
  const get = (id) => { const v = byId.get(id); assert.ok(v, `no visit for ${id}`); return v; };
  assert.equal(get('root-container').parentNode, null);
  assert.equal(get('c-content').parentNode.id, 'card1');
  assert.equal(get('c-display').parentNode.id, 'c-columns');
  assert.ok(/^components\[/.test(get('c-content').where));
  assert.ok(get('c-content').where.includes('content.components['));
});

test('a cyclic tree terminates instead of spinning', () => {
  /** @type {any} */
  const a = { id: 'a', type: 'container' };
  a.components = [a]; // self-reference
  const ids = [...walkComponents({ components: [a] })].map((v) => v.node.id);
  assert.deepEqual(ids, ['a'], 'the visited-set guard must yield each node exactly once');
});

test('the walker is non-vacuous and descends on a real corpus form', () => {
  const file = path.join(ROOT, 'packages/sfs/corpus/employee-table.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const markupText = typeof raw.Markup === 'string' ? raw.Markup : JSON.stringify(raw);
  const markup = JSON.parse(markupText);
  const roots = rootComponents(markup);
  const total = [...walkComponents(markup)].length;
  assert.ok(roots.length > 0, 'the corpus form has no root components to walk');
  assert.ok(total > roots.length, 'the walker did not descend below the top level of a real nested form');
});
