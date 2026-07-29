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
