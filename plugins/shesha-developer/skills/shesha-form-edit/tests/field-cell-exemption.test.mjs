import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier3, isFieldCell } from '../scripts/lib/tier3.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const thresholds = { componentBindingRatioBudget: 2 };
const ID = () => crypto.randomUUID();

/** A field cell: container whose only child is a bound input leaf. */
const cell = (prop) => ({
  id: ID(), type: 'container', parentId: 'root', version: 7,
  desktop: { dimensions: { width: 'calc(50% - 8px)' } },
  components: [{ id: ID(), type: 'textField', version: 6, propertyName: prop }],
});

test('isFieldCell recognises a container wrapping one bound leaf', () => {
  assert.equal(isFieldCell(cell('firstName')), true);
});

test('isFieldCell rejects a container with two children', () => {
  const c = cell('a');
  c.components.push({ id: ID(), type: 'textField', version: 6, propertyName: 'b' });
  assert.equal(isFieldCell(c), false);
});

test('isFieldCell rejects a container whose child is itself a container', () => {
  const c = { id: ID(), type: 'container', version: 7, components: [cell('inner')] };
  assert.equal(isFieldCell(c), false);
});

test('isFieldCell rejects a container whose only child binds nothing', () => {
  const c = { id: ID(), type: 'container', version: 7,
    components: [{ id: ID(), type: 'text', version: 5 }] };
  assert.equal(isFieldCell(c), false);
});

test('isFieldCell tolerates malformed input', () => {
  for (const bad of [null, undefined, {}, { type: 'container' }, { type: 'textField' }]) {
    assert.doesNotThrow(() => isFieldCell(bad));
  }
});

test('normalizer-inserted field cells do not trip T3-COMPONENT-RATIO', () => {
  // The regression this guards: a 3-field form is 3 nodes / 3 bindings = 1.0
  // before normalization, and 6 nodes / 3 bindings = 2.0 after, purely because
  // each field gained the wrapper the framework requires. Counting those
  // wrappers would penalise the form for being correctly normalized, and
  // corrupt the scores used to calibrate the eval pass threshold.
  const markup = {
    components: [{
      id: ID(), type: 'container', parentId: 'root', version: 7,
      desktop: { display: 'flex', flexDirection: 'row' },
      components: [cell('firstName'), cell('lastName'), cell('email')],
    }],
  };
  const codes = tier3(markup, { registry, thresholds }).findings.map((f) => f.code);
  assert.ok(!codes.includes('T3-COMPONENT-RATIO'),
    `field cells were counted against the budget: ${codes.join(', ')}`);
});

test('genuine over-wrapping still trips T3-COMPONENT-RATIO', () => {
  // Nested bare containers around a single field are NOT field cells and must
  // still be caught — the exemption must not become a blanket amnesty.
  const deep = { id: ID(), type: 'container', parentId: 'root', version: 7,
    components: [{ id: ID(), type: 'container', version: 7,
      components: [{ id: ID(), type: 'container', version: 7,
        components: [{ id: ID(), type: 'container', version: 7,
          components: [{ id: ID(), type: 'textField', version: 6, propertyName: 'only' }] }] }] }] };
  const codes = tier3({ components: [deep] }, { registry, thresholds }).findings.map((f) => f.code);
  assert.ok(codes.includes('T3-COMPONENT-RATIO'), 'deep bare nesting should still be flagged');
});

test('field cells are not reported as orphan containers', () => {
  // The row holds TWO cells so the row itself is not a single-child wrapper —
  // otherwise the row would be flagged on its own merits and mask what this
  // test is actually about, which is that neither CELL is flagged.
  const a = cell('firstName');
  const b = cell('lastName');
  const markup = { components: [{
    id: ID(), type: 'container', parentId: 'root', version: 7,
    desktop: { display: 'flex', flexDirection: 'row' },
    components: [a, b],
  }] };
  const orphans = tier3(markup, { registry, thresholds }).findings
    .filter((f) => f.code === 'T3-ORPHAN-CONTAINER');
  assert.deepEqual(orphans, [],
    `a mandated field cell is not wrapper debt: ${JSON.stringify(orphans)}`);
});

test('a genuinely empty single-child wrapper is still an orphan', () => {
  const markup = { components: [{
    id: ID(), type: 'container', parentId: 'root', version: 7,
    components: [{ id: ID(), type: 'container', version: 7,
      components: [{ id: ID(), type: 'text', version: 5 }] }],
  }] };
  const codes = tier3(markup, { registry, thresholds }).findings.map((f) => f.code);
  assert.ok(codes.includes('T3-ORPHAN-CONTAINER'), 'real wrapper debt should still be flagged');
});
