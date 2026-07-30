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
  // `addressInput` was in the old hand-maintained groups index but does not exist in the framework.
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
  // post-filter counts. Task 10 extended the extractor to ALSO harvest
  // initModel/migrator-produced runtime keys (not just literal
  // settingsFormMarkup propertyName leaves — see gen-registry's harness
  // header comment), which recovered a large class of real-but-never-
  // surfaced-in-a-settings-form props (docs/corpus-report.md Task 9/10:
  // datatable's tableSettings.*/crud/flexibleHeight, bare hideBorder,
  // dropdown's tag.* style block, deprecated-but-real datatable fields).
  // Floors below are the Task 10 measured counts: container 99, textField
  // 101, datatable 157, columns 52, button 94, dropdown 183, tabs 98.
  assert.ok(C.container.props.length >= 95, `container had ${C.container.props.length}`);
  assert.ok(C.textField.props.length >= 95, `textField had ${C.textField.props.length}`);
  assert.ok(C.datatable.props.length >= 150, `datatable had ${C.datatable.props.length}`);
  assert.ok(C.columns.props.length >= 50, `columns had ${C.columns.props.length}`);
  assert.ok(C.button.props.length >= 90, `button had ${C.button.props.length}`);
  assert.ok(C.dropdown.props.length >= 175, `dropdown had ${C.dropdown.props.length}`);
  assert.ok(C.tabs.props.length >= 95, `tabs had ${C.tabs.props.length}`);
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

test('propTypes is a strict subset of props for every component', () => {
  // Restored per-prop type metadata (Phase 5 task: two checks were retired
  // when the hand-maintained groups index was replaced by this registry;
  // this is what makes them extractable again). Additive only — never a
  // source of keys `props` itself doesn't carry.
  for (const [type, c] of Object.entries(C)) {
    assert.ok(c.propTypes && typeof c.propTypes === 'object', `${type} has no propTypes object`);
    const propsSet = new Set(c.props);
    for (const propPath of Object.keys(c.propTypes)) {
      assert.ok(propsSet.has(propPath), `${type}.propTypes has "${propPath}" which is not in props`);
    }
  }
});

test('propTypes classifies known boolean/number/enum leaves correctly', () => {
  // Spot-checks against real settings-form controls read directly from
  // framework source (checkbox/settingsForm.ts, container/settingsForm.ts).
  assert.deepEqual(C.checkbox.propTypes['validate.required'], { type: 'boolean' });
  assert.deepEqual(C.container.propTypes['hidden'], { type: 'boolean' });
});

test('every propTypes entry uses one of the documented coarse categories', () => {
  const KNOWN = new Set(['boolean', 'number', 'string', 'enum', 'array', 'object']);
  for (const [type, c] of Object.entries(C)) {
    for (const [propPath, info] of Object.entries(c.propTypes)) {
      assert.ok(KNOWN.has(info.type), `${type}.propTypes["${propPath}"] has unknown type "${info.type}"`);
      if (info.values !== undefined) assert.ok(Array.isArray(info.values), `${type}.propTypes["${propPath}"].values should be an array`);
    }
  }
});

test('formSettings is extracted from the real form-level settings form, not invented', () => {
  // src/components/formDesigner/formSettings.ts — the same markup the
  // framework's own "Form Settings" dialog feeds into ConfigurableForm.
  assert.ok(Array.isArray(registry.formSettings?.props), 'registry.formSettings.props should be an array');
  assert.ok(registry.formSettings.props.length > 10, 'formSettings prop coverage looks too thin');
  for (const p of ['layout', 'colon', 'labelCol.span', 'wrapperCol.span', 'access', 'permissions']) {
    assert.ok(registry.formSettings.props.includes(p), `formSettings.props should include "${p}"`);
  }
  assert.deepEqual(registry.formSettings.propTypes['colon'], { type: 'boolean' });
  assert.deepEqual(registry.formSettings.propTypes['labelCol.span'], { type: 'number' });
  assert.equal(registry.formSettings.propTypes['access'].type, 'enum');
  assert.deepEqual([...registry.formSettings.propTypes['access'].values].sort(), [3, 4, 5]);
});

test('formSettings has no scaffolding leakage either', () => {
  for (const p of registry.formSettings.props) assert.equal(isScaffoldingProp(p), false, p);
});
