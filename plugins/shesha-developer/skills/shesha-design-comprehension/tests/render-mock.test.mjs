import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMock } from '../scripts/lib/render-mock.mjs';

const blueprint = {
  screen: 'Bookings Register',
  archetype: 'table-worklist',
  viewport: '1440x900',
  nodes: [
    { node: 'page', type: 'container', role: 'page-root',
      style: { desktop: { display: 'flex', flexDirection: 'column', gap: 24,
        dimensions: { width: '100%', minHeight: 'fit-content' }, stylingBox: { padding: 24 } } },
      children: ['pageHeader', 'toolbar', 'table'] },
    { node: 'pageHeader', type: 'container', role: 'header-band', slot: 'page',
      style: { desktop: { display: 'flex', flexDirection: 'column', gap: 4,
        dimensions: { width: '100%' } } }, children: ['title'] },
    { node: 'title', type: 'text', slot: 'pageHeader', content: 'Bookings' },
    { node: 'toolbar', type: 'container', role: 'toolbar-row', slot: 'page',
      style: { desktop: { display: 'flex', flexDirection: 'row', gap: 12,
        justifyContent: 'space-between', dimensions: { width: '100%' } } }, children: [] },
    { node: 'table', type: 'datatable', role: 'grid-surface', slot: 'page',
      columns: ['bookingReference', 'passengerLastName'], addedBy: 'flow-manifest' },
  ],
};

test('renders a box for every node', () => {
  const out = renderMock(blueprint);
  for (const n of ['page', 'pageHeader', 'toolbar', 'table']) {
    assert.match(out, new RegExp(n), `${n} missing from mock`);
  }
});

test('annotates each container with its role', () => {
  const out = renderMock(blueprint);
  assert.match(out, /role: page-root/);
  assert.match(out, /role: toolbar-row/);
});

test('shows the resolved layout values, not token references', () => {
  const out = renderMock(blueprint);
  assert.match(out, /flex column/);
  assert.match(out, /gap 24/);
  assert.match(out, /flex row/);
  assert.match(out, /justify:space-between/);
});

test('shows the dimensions contract including minH', () => {
  const out = renderMock(blueprint);
  assert.match(out, /w:100%/);
  assert.match(out, /minH:fit-content/);
});

test('nests children inside their slot parent', () => {
  const out = renderMock(blueprint).split('\n');
  const pageIdx = out.findIndex((l) => l.includes('page ') || l.includes('─ page'));
  const headerIdx = out.findIndex((l) => l.includes('pageHeader'));
  assert.ok(pageIdx < headerIdx, 'pageHeader should render inside page');
  // Indentation increases with depth.
  const indent = (l) => l.length - l.trimStart().length;
  assert.ok(indent(out[headerIdx]) > indent(out[pageIdx]));
});

test('marks nodes the flow manifest added rather than the prompt', () => {
  const out = renderMock(blueprint);
  assert.match(out, /flow/i);
});

test('renders datatable columns as a header row', () => {
  const out = renderMock(blueprint);
  assert.match(out, /bookingReference|Ref/);
});

test('output uses box-drawing characters and is stable', () => {
  const a = renderMock(blueprint);
  const b = renderMock(blueprint);
  assert.equal(a, b);
  assert.match(a, /[┌└│─]/);
});

test('throws rather than rendering an empty mock for a blueprint with no nodes', () => {
  assert.throws(() => renderMock({ nodes: [] }), /no nodes/);
});

/* ─── new archetype shapes ──────────────────────────────────────────────── */

test('renders a datalist as a repeating card row, distinct from a datatable grid, with its row-template named', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['list'] },
      { node: 'list', type: 'datalist', role: 'grid-surface', slot: 'page', rowTemplate: 'entity-card' },
    ],
  };
  const out = renderMock(bp);
  assert.match(out, /repeating card row/);
  assert.match(out, /row-template → entity-card/);
  // Must NOT look like a datatable's "│ col | col │" header — no pipe-separated column row.
  assert.doesNotMatch(out, /│ .*\|.* │/);
});

test('renders a wrapping tile grid with each tile label and its navigate target', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['tileGrid'] },
      { node: 'tileGrid', type: 'container', role: 'card-grid', slot: 'page',
        style: { desktop: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 16 } },
        children: ['tile1', 'tile2'] },
      { node: 'tile1', type: 'container', role: 'nav-tile', slot: 'tileGrid', children: ['tile1Label', 'tile1Action'] },
      { node: 'tile1Label', type: 'text', slot: 'tile1', content: 'Bookings' },
      { node: 'tile1Action', type: 'buttonGroup', slot: 'tile1',
        items: [{ label: 'Navigate', action: { actionName: 'Navigate', actionOwner: 'shesha.common' }, target: 'bookings-list' }] },
      { node: 'tile2', type: 'container', role: 'nav-tile', slot: 'tileGrid', children: ['tile2Label', 'tile2Action'] },
      { node: 'tile2Label', type: 'text', slot: 'tile2', content: 'Invoices' },
      { node: 'tile2Action', type: 'buttonGroup', slot: 'tile2',
        items: [{ label: 'Navigate', action: { actionName: 'Navigate', actionOwner: 'shesha.common' }, target: 'invoices-list' }] },
    ],
  };
  const out = renderMock(bp);
  assert.match(out, /wrap/); // the grid visibly wraps
  assert.match(out, /"Bookings"/);
  assert.match(out, /→ bookings-list/);
  assert.match(out, /"Invoices"/);
  assert.match(out, /→ invoices-list/);
});

test('renders metric tile label/value slots and names the chart type on a chart surface', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['metricRow', 'chartSurface'] },
      { node: 'metricRow', type: 'container', role: 'card-grid', slot: 'page', children: ['metric1'] },
      { node: 'metric1', type: 'container', role: 'metric-tile', slot: 'metricRow', children: ['metric1Label', 'metric1Value'] },
      { node: 'metric1Label', type: 'text', slot: 'metric1', content: 'Total Bookings' },
      { node: 'metric1Value', type: 'text', slot: 'metric1', content: '128', valueBinding: { property: 'bookingCount', aggregate: 'count' } },
      { node: 'chartSurface', type: 'container', role: 'chart-surface', slot: 'page', children: ['chart'] },
      { node: 'chart', type: 'barChart', slot: 'chartSurface' },
    ],
  };
  const out = renderMock(bp);
  assert.match(out, /"Total Bookings"/);
  assert.match(out, /"128"/);
  assert.match(out, /bind: count bookingCount/);
  assert.match(out, /⟨chart: barChart⟩/);
});

test('renders wizard steps as an ordered sequence with step names', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['wizard'] },
      { node: 'wizard', type: 'wizard', role: 'wizard-shell', slot: 'page', children: ['step1', 'step2'] },
      { node: 'step1', type: 'container', role: 'wizard-step', slot: 'wizard', children: ['step1Field'] },
      { node: 'step1Field', type: 'text', slot: 'step1', content: 'Applicant details' },
      { node: 'step2', type: 'container', role: 'wizard-step', slot: 'wizard', children: ['step2Field'] },
      { node: 'step2Field', type: 'text', slot: 'step2', content: 'Documents' },
    ],
  };
  const out = renderMock(bp).split('\n');
  const step1Idx = out.findIndex((l) => l.includes('Step 1: step1'));
  const step2Idx = out.findIndex((l) => l.includes('Step 2: step2'));
  assert.ok(step1Idx !== -1, 'Step 1 label missing');
  assert.ok(step2Idx !== -1, 'Step 2 label missing');
  assert.ok(step1Idx < step2Idx, 'steps should render in order');
  // Each step's own field renders nested under its step box.
  const fieldIdx = out.findIndex((l) => l.includes('Applicant details'));
  assert.ok(fieldIdx > step1Idx && fieldIdx < step2Idx, 'step1Field should sit under step1, before step2');
});

test('renders tab keys and shows which nodes sit under each tab', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['detailTabs'] },
      { node: 'detailTabs', type: 'tabs', slot: 'page',
        tabs: [
          { key: 'general', title: 'General', children: ['generalField'] },
          { key: 'documents', title: 'Documents', children: ['documentsField'] },
        ] },
      { node: 'generalField', type: 'text', content: 'Name' },
      { node: 'documentsField', type: 'text', content: 'Attachments' },
    ],
  };
  const out = renderMock(bp);
  assert.match(out, /▤ tab: general \("General"\)/);
  assert.match(out, /▤ tab: documents \("Documents"\)/);
  const lines = out.split('\n');
  const generalTabIdx = lines.findIndex((l) => l.includes('tab: general'));
  const nameIdx = lines.findIndex((l) => l.includes('Name'));
  const documentsTabIdx = lines.findIndex((l) => l.includes('tab: documents'));
  assert.ok(generalTabIdx < nameIdx && nameIdx < documentsTabIdx, 'generalField should sit under the general tab');
});

test('renders buttonGroup items inline with the action each fires and marks the primary', () => {
  const bp = {
    nodes: [
      { node: 'page', type: 'container', role: 'page-root', children: ['actionRow'] },
      { node: 'actionRow', type: 'buttonGroup', slot: 'page',
        items: [
          { label: 'Save', primary: true, action: { actionName: 'Submit', actionOwner: 'shesha.form' } },
          { label: 'Cancel', action: { actionName: 'Navigate', actionOwner: 'shesha.common' } },
        ] },
    ],
  };
  const out = renderMock(bp);
  assert.match(out, /\[Save\]◄primary → Submit\/shesha\.form/);
  assert.match(out, /\[Cancel\] → Navigate\/shesha\.common/);
});
