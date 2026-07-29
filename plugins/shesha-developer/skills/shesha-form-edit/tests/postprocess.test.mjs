import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postprocess } from '../scripts/lib/postprocess.mjs';

const raw = {
  summary: { totalTypes: 3, settingsOk: 3, settingsFail: 0 },
  components: {
    textField: {
      name: 'Text Field', group: 'Data entry',
      isInput: true, isOutput: false, isHidden: false,
      version: 6, propsCount: 4,
      props: ['label', 'propertyName', 'pnlDimensions', 'settingsTabs'],
    },
    datatableContext: {
      name: 'Data Context (Legacy)', group: 'Tables and Lists',
      isInput: true, isOutput: true, isHidden: true,
      version: 8, propsCount: 0, props: [],
    },
    collapsiblePanel: {
      name: 'Collapsible Panel', group: 'Layout',
      isInput: false, isOutput: false, isHidden: false,
      version: undefined, propsCount: 1,
      props: ['panelHeaderText'],
      customContainerNames: ['header', 'content', 'customHeader'],
    },
  },
};

test('lifts the object key into a type field', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(registry.components.textField.type, 'textField');
  assert.equal(registry.components.datatableContext.type, 'datatableContext');
});

test('drops scaffolding props and keeps real ones', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(registry.components.textField.props, ['label', 'propertyName']);
});

test('records how many scaffolding props were dropped', () => {
  const { stats } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(stats.droppedScaffoldingProps, 2);
});

test('normalises a missing version to null rather than undefined', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(registry.components.collapsiblePanel.version, null);
  // null survives JSON.stringify; undefined would silently vanish.
  assert.ok(JSON.stringify(registry).includes('"version":null'));
});

test('marks the legacy hidden component non-authorable but keeps it', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  const e = registry.components.datatableContext;
  assert.equal(e.authorable, false);
  assert.equal(e.authorableReason, 'hidden');
});

test('preserves customContainerNames, defaulting to an empty array', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(registry.components.collapsiblePanel.customContainerNames,
    ['header', 'content', 'customHeader']);
  assert.deepEqual(registry.components.textField.customContainerNames, []);
});

test('output is deterministic: component keys and props are sorted', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  const keys = Object.keys(registry.components);
  assert.deepEqual(keys, [...keys].sort());
  for (const c of Object.values(registry.components)) {
    assert.deepEqual(c.props, [...c.props].sort());
  }
});

test('same input produces byte-identical output', () => {
  const a = JSON.stringify(postprocess(raw, { frameworkVersion: '0.45.1' }).registry);
  const b = JSON.stringify(postprocess(raw, { frameworkVersion: '0.45.1' }).registry);
  assert.equal(a, b);
});

test('stats count authorable, versionless and propless components', () => {
  const { stats } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(stats, {
    total: 3,
    authorable: 2,          // textField + collapsiblePanel
    withoutVersion: 1,      // collapsiblePanel
    withoutProps: 1,        // datatableContext
    droppedScaffoldingProps: 2,
  });
});

test('throws a specific error when the raw extraction has no components', () => {
  assert.throws(
    () => postprocess({ components: {} }, { frameworkVersion: '0.45.1' }),
    /extracted 0 components/,
  );
});
