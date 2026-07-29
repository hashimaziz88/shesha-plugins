import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScaffoldingProp, classifyAuthorability } from '../scripts/lib/classify.mjs';

test('drops settings-form scaffolding node names', () => {
  for (const p of [
    'settingsTabs', 'propertyRouter1', 'propertyRouter',
    'pnlDimensions', 'pnlBorderStyle', 'pnlFontStyle', 'pnlShadowStyle',
    'pnlBackgroundStyle', 'pnlAxisLabelFont', 'pnlQuickView', 'pnlOnSuccess',
    'bordericon', 'advancedPanel', 'displayPanel', 'optionsPanel',
    'toolbarPanel', 'containerCustomStylePanel',
  ]) {
    assert.equal(isScaffoldingProp(p), true, `${p} should be scaffolding`);
  }
});

test('keeps real model props, including dotted style paths', () => {
  for (const p of [
    'propertyName', 'label', 'hideLabel', 'editMode', 'validate.required',
    'desktop.dimensions.width', 'border.border.all.color', 'background.gradient.colors',
    'actionConfiguration', 'dataSourceType', 'referenceListId', 'items',
  ]) {
    assert.equal(isScaffoldingProp(p), false, `${p} should be kept`);
  }
});

test('does not treat a legitimate prop ending in Panel-like text as scaffolding', () => {
  // `panelId` is a real prop on collapsiblePanel-adjacent components; only
  // exact scaffolding node names and the pnl*/propertyRouter* prefixes are dropped.
  assert.equal(isScaffoldingProp('panelId'), false);
  assert.equal(isScaffoldingProp('panelHeaderText'), false);
});

test('marks hidden components non-authorable', () => {
  assert.deepEqual(
    classifyAuthorability({ group: 'Tables and Lists', isHidden: true, propsCount: 0 }),
    { authorable: false, reason: 'hidden' },
  );
});

test('marks Legacy and Dev groups non-authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Legacy', propsCount: 3 }),
    { authorable: false, reason: 'legacy' });
  assert.deepEqual(classifyAuthorability({ group: 'Dev', propsCount: 0 }),
    { authorable: false, reason: 'dev' });
});

test('marks a component with no settings form non-authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Data Access', propsCount: 0 }),
    { authorable: false, reason: 'no-settings-form' });
});

test('ordinary components are authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Data entry', isHidden: false, propsCount: 82 }),
    { authorable: true, reason: null });
});

test('hidden takes precedence over group', () => {
  assert.equal(classifyAuthorability({ group: 'Legacy', isHidden: true, propsCount: 0 }).reason, 'hidden');
});
