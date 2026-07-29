import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFlow, validateFlow, requiredNodes } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'assets/archetypes');
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(
  join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));

test('loads the table-worklist manifest', () => {
  const flow = loadFlow('table-worklist', { dir: DIR });
  assert.equal(flow.archetype, 'table-worklist');
});

test('table-worklist requires the components its assertions imply', () => {
  // The failure this fixes: a blueprint declared heading/text/datatable while its
  // assertions demanded an Add action, row action, quick search and pager.
  const types = requiredNodes(loadFlow('table-worklist', { dir: DIR })).map((n) => n.type);
  for (const t of ['dataContext', 'container', 'buttonGroup', 'datatable',
                   'datatable.quickSearch', 'datatable.pager']) {
    assert.ok(types.includes(t), `flow must require ${t}`);
  }
});

test('table-worklist declares its create and detail dependencies', () => {
  const flow = loadFlow('table-worklist', { dir: DIR });
  const ids = flow.dependencies.map((d) => d.id);
  assert.ok(ids.includes('createForm'));
  assert.ok(ids.includes('detailForm'));
  for (const d of flow.dependencies) {
    assert.ok(d.archetype, `dependency ${d.id} needs an archetype`);
    assert.ok(d.naming, `dependency ${d.id} needs a naming rule`);
  }
});

test('standalone-capture requires validationErrors and a Submit/exit pair', () => {
  const nodes = requiredNodes(loadFlow('standalone-capture', { dir: DIR }));
  assert.ok(nodes.some((n) => n.type === 'validationErrors'));
  const bg = nodes.find((n) => n.type === 'buttonGroup');
  assert.ok(bg, 'needs a buttonGroup');
  assert.match(JSON.stringify(bg), /Submit/);
  assert.match(JSON.stringify(bg), /Navigate|Close Dialog|Cancel Edit/);
});

test('every shipped manifest validates against the registry and role catalogue', () => {
  for (const a of ['table-worklist', 'record-detail', 'capture-dialog', 'standalone-capture',
                   'list-card', 'hub', 'dashboard', 'wizard']) {
    const problems = validateFlow(loadFlow(a, { dir: DIR }), { registry, roles });
    assert.deepEqual(problems, [], `${a}: ${problems.join('; ')}`);
  }
});

test('list-card requires a datalist and NOT a datatable', () => {
  const types = requiredNodes(loadFlow('list-card', { dir: DIR })).map((n) => n.type);
  assert.ok(types.includes('datalist'), 'flow must require datalist');
  assert.ok(!types.includes('datatable'), 'flow must not require a grid datatable');
});

test('list-card declares its row-template, create and detail dependencies', () => {
  const flow = loadFlow('list-card', { dir: DIR });
  const ids = flow.dependencies.map((d) => d.id);
  assert.ok(ids.includes('rowTemplate'), 'needs the row-template form dependency');
  assert.ok(ids.includes('createForm'));
  assert.ok(ids.includes('detailForm'));
  for (const d of flow.dependencies) {
    assert.ok(d.archetype, `dependency ${d.id} needs an archetype`);
    assert.ok(d.naming, `dependency ${d.id} needs a naming rule`);
  }
});

test('hub requires more than one tile node', () => {
  const nodes = requiredNodes(loadFlow('hub', { dir: DIR }));
  const tiles = nodes.filter((n) => n.role === 'nav-tile');
  assert.ok(tiles.length > 1, 'flow must require more than one nav-tile node');
});

test('dashboard requires a chart type', () => {
  const CHART_TYPES = new Set(['barChart', 'lineChart', 'pieChart', 'polarAreaChart']);
  const types = requiredNodes(loadFlow('dashboard', { dir: DIR })).map((n) => n.type);
  assert.ok(types.some((t) => CHART_TYPES.has(t)), 'flow must require a chart type');
});

test('wizard requires validationErrors and the wizard component with multiple steps', () => {
  const nodes = requiredNodes(loadFlow('wizard', { dir: DIR }));
  assert.ok(nodes.some((n) => n.type === 'validationErrors'));
  const wizardNode = nodes.find((n) => n.type === 'wizard');
  assert.ok(wizardNode, 'flow must require the wizard component');
  const steps = nodes.filter((n) => n.role === 'wizard-step');
  assert.ok(steps.length > 1, 'flow must require more than one wizard-step node');
});

test('validateFlow rejects a type absent from the registry', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'notAThing' }] }, { registry, roles });
  assert.match(problems[0], /notAThing/);
});

test('validateFlow rejects a non-authorable type', () => {
  // datatableContext is "Data Context (Legacy)", isHidden — recognisable but never authored.
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'datatableContext' }] }, { registry, roles });
  assert.match(problems[0], /datatableContext.*authorable/);
});

test('validateFlow rejects a role missing from the catalogue', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'container', role: 'no-such-role' }] },
    { registry, roles });
  assert.match(problems[0], /no-such-role/);
});

test('validateFlow rejects a slot pointing at a node that does not exist', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'container', role: 'page-root', slot: 'ghost' }] },
    { registry, roles });
  assert.match(problems[0], /ghost/);
});

test('validateFlow rejects a dependsOn with no matching dependency', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'buttonGroup', dependsOn: 'missingDep' }],
      dependencies: [] }, { registry, roles });
  assert.match(problems[0], /missingDep/);
});
