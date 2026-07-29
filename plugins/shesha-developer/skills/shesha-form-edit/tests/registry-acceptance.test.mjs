import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isScaffoldingProp } from '../scripts/lib/classify.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(
  readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'),
);
const C = registry.components;

test('pinned to the framework version this plugin targets', () => {
  assert.equal(registry.frameworkVersion, '0.45.1');
});

test('carries every registered component', () => {
  assert.equal(Object.keys(C).length, 116);
});

test('the hand index phantom is gone', () => {
  // `addressInput` was in assets/groups/index.json but does not exist in the framework.
  assert.equal(C.addressInput, undefined);
});

test('includes the types the hand index omitted', () => {
  for (const t of ['datatableContext', 'passwordCombo', 'divider', 'dynamicView',
                   'queryBuilder', 'labelValueEditor', 'formAutocomplete',
                   'referenceListAutocomplete', 'list', 'paragraph', 'title', 'toolbar']) {
    assert.ok(C[t], `${t} should be present`);
  }
});

test('versions match the framework, including the high ones', () => {
  assert.equal(C.container.version, 7);
  assert.equal(C.textField.version, 6);
  assert.equal(C.columns.version, 5);
  assert.equal(C.button.version, 9);
  assert.equal(C.dropdown.version, 11);
  assert.equal(C.datatable.version, 29);
  assert.equal(C.tabs.version, 4);
});

test('prop coverage is real, not the thin hand-index surface', () => {
  // The hand index gave container ~15 props. Thresholds are the MEASURED
  // post-filter counts (raw extraction is ~8 higher per type before the
  // scaffolding denylist runs): container 63, textField 74, datatable 92,
  // columns 50, button 61, dropdown 133, tabs 96.
  assert.ok(C.container.props.length >= 60, `container had ${C.container.props.length}`);
  assert.ok(C.textField.props.length >= 70, `textField had ${C.textField.props.length}`);
  assert.ok(C.datatable.props.length >= 90, `datatable had ${C.datatable.props.length}`);
  assert.ok(C.columns.props.length >= 45);
  assert.ok(C.button.props.length >= 55);
});

test('no scaffolding survived into any prop list', () => {
  const leaked = [];
  for (const [type, c] of Object.entries(C)) {
    for (const p of c.props) if (isScaffoldingProp(p)) leaked.push(`${type}.${p}`);
  }
  assert.deepEqual(leaked, []);
});

test('legacy and dev components are recognised but not authorable', () => {
  assert.equal(C.datatableContext.authorable, false);
  assert.equal(C.datatableContext.authorableReason, 'hidden');
  assert.equal(C.paragraph.authorable, false);
  assert.equal(C.settingsInput.authorable, false);
  // But the current data wrapper IS authorable.
  assert.equal(C.dataContext.authorable, true);
});

test('customContainerNames capture child slots', () => {
  assert.deepEqual([...C.collapsiblePanel.customContainerNames].sort(),
    ['content', 'customHeader', 'header']);
});

test('a versionless component is null, never undefined-shaped', () => {
  // 21 of 116 genuinely have no migrator on their live component definition —
  // verified by instrumenting the extractor: no exception is being swallowed.
  // `dataContext` is among them: the live tableContextComponent.tsx has no
  // migrator, while a dead unimported twin (dataContextComponent/index.tsx)
  // carries an unrelated one. Do NOT merge the dead twin's version in.
  const versionless = Object.values(C).filter((c) => c.version === null);
  assert.ok(versionless.length > 0, 'expected some components to have no migrator');
  assert.ok(versionless.length <= 25, `unexpectedly many versionless: ${versionless.length}`);
  for (const c of versionless) assert.equal(c.version, null);
});

test('every entry has its type field populated', () => {
  // The raw extraction omits `type`; postprocess lifts the key in.
  for (const [key, c] of Object.entries(C)) assert.equal(c.type, key);
});

test('file is deterministically sorted so regeneration diffs cleanly', () => {
  const keys = Object.keys(C);
  assert.deepEqual(keys, [...keys].sort());
});
