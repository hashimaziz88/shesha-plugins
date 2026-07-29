import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlueprint } from '../scripts/lib/validate-blueprint.mjs';
import { renderMock } from '../scripts/lib/render-mock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(here, '../assets/blueprint.schema.json'), 'utf8'));
const fixturesDir = path.join(here, '../assets/blueprint-examples');

const ARCHETYPES = [
  'table-worklist',
  'record-detail',
  'capture-dialog',
  'standalone-capture',
  'list-card',
  'hub',
  'dashboard',
  'wizard',
];

test('a fixture ships for every one of the eight archetypes', () => {
  for (const archetype of ARCHETYPES) {
    const file = path.join(fixturesDir, `${archetype}.blueprint.json`);
    assert.ok(fs.existsSync(file), `missing fixture for ${archetype}: ${file}`);
  }
});

for (const archetype of ARCHETYPES) {
  test(`${archetype} fixture validates against blueprint.schema.json`, () => {
    const file = path.join(fixturesDir, `${archetype}.blueprint.json`);
    const blueprint = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validateBlueprint(blueprint, schema);
    assert.deepEqual(errors, [], `${archetype} fixture failed schema validation:\n${errors.join('\n')}`);
  });

  test(`${archetype} fixture renders without throwing`, () => {
    const file = path.join(fixturesDir, `${archetype}.blueprint.json`);
    const blueprint = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.doesNotThrow(() => renderMock(blueprint));
  });
}

test('the validator actually catches a missing required field', () => {
  const file = path.join(fixturesDir, 'table-worklist.blueprint.json');
  const blueprint = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete blueprint.archetype; // required at the root
  const errors = validateBlueprint(blueprint, schema);
  assert.ok(errors.some((e) => e.includes('missing required property "archetype"')), errors.join('\n'));
});

test('the validator actually catches a wrong-typed field', () => {
  const file = path.join(fixturesDir, 'table-worklist.blueprint.json');
  const blueprint = JSON.parse(fs.readFileSync(file, 'utf8'));
  blueprint.nodes = 'not-an-array'; // schema requires nodes: array
  const errors = validateBlueprint(blueprint, schema);
  assert.ok(errors.some((e) => e.includes('$.nodes') && e.includes('expected type array')), errors.join('\n'));
});

test('the validator rejects a role outside the fifteen-role enum', () => {
  const blueprint = {
    screen: 'Bad Role', archetype: 'table-worklist',
    nodes: [{ node: 'page', type: 'container', role: 'not-a-real-role' }],
  };
  const errors = validateBlueprint(blueprint, schema);
  assert.ok(errors.some((e) => e.includes('not one of')), errors.join('\n'));
});

test('the validator rejects a buttonGroup item missing its action', () => {
  const blueprint = {
    screen: 'Bad Item', archetype: 'standalone-capture',
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['btn'] },
      { node: 'btn', type: 'buttonGroup', slot: 'page', items: [{ label: 'Save' }] },
    ],
  };
  const errors = validateBlueprint(blueprint, schema);
  assert.ok(errors.some((e) => e.includes('missing required property "action"')), errors.join('\n'));
});

test('the validator rejects an override missing source/evidence', () => {
  const blueprint = {
    screen: 'Bad Override', archetype: 'record-detail',
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', overrides: [{ prop: 'gap', value: 8 }] },
    ],
  };
  const errors = validateBlueprint(blueprint, schema);
  assert.ok(errors.some((e) => e.includes('missing required property "source"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('missing required property "evidence"')), errors.join('\n'));
});
