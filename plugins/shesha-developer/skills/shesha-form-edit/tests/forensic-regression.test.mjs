/**
 * tests/forensic-regression.test.mjs — Phase 3, Task 5, deliverable 2 (+3).
 *
 * THE MONEY TEST. A user built 9 real Shesha forms with hand-written
 * blueprint->markup scripts and the create/detail pages came out visibly
 * broken. Forensics on the pushed markup (scratchpad *.pushed.json,
 * NEVER copied into this repo) traced the damage to six confirmed defects
 * (see the task brief's table). `compile-spec.mjs` exists to replace those
 * hand-written scripts. This file proves it does not reproduce any of the
 * six, using a blueprint built to the SAME structure/bindings as the real
 * flight-details form, run through the REAL compiler (no shortcuts, no
 * hand-authored markup).
 *
 * Each `defect N` test's failure message names the defect and the real,
 * observed symptom it caused — a future regression must be immediately
 * legible, not an opaque assertion failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../scripts/compile-spec.mjs';
import { flatten } from '../scripts/lib/walk.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';
import { isSplitWidthValue, BREAKPOINTS } from '../scripts/lib/expand-style.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FLOWS_DIR = join(ROOT, 'assets/archetypes');

const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const tokens = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json'), 'utf8'));
const ctx = { registry, roles, tokens };

const ARCHETYPE = 'record-detail';
const flow = loadFlow(ARCHETYPE, { dir: FLOWS_DIR });
const flows = { [ARCHETYPE]: flow };

const SCRATCHPAD_DIR = 'C:/Users/Hashim/AppData/Local/Temp/claude/C--Users-Hashim-Documents-Git-Repos-shesha-plugins--claude-worktrees-shesha-designer-fs-watcher-0550e8/6b0a2575-c6c0-4c24-bcd7-4df694a8faa0/scratchpad';

// ---------------------------------------------------------------------------
// A blueprint built to flight-details' real structure and bindings: the
// same three field tabs (service/schedule/commercial), the same field
// names/labels/types, the same header title+subtitle, the same detail-rail
// idea. Every field sits in its own wrapping container carrying the
// proportional width — the ONLY way a blueprint author can express "split
// this row 50/50" today, since leaf.mjs never reads style off a leaf node
// (see tree.mjs/leaf.mjs — a leaf's compiled output is built purely from
// its binding/content, never from bpNode.style). That asymmetry is itself
// the reason defect 1 cannot reproduce: there is no code path by which a
// proportional width ever reaches a leaf.
// ---------------------------------------------------------------------------

function halfField(wrapName, fieldName, type, label) {
  return [
    {
      node: wrapName,
      type: 'container',
      slot: undefined, // filled by caller
      style: {
        desktop: { dimensions: { width: 'calc(50% - 6px)' } },
        tablet: { dimensions: { width: 'calc(50% - 6px)' } },
        mobile: { dimensions: { width: '100%' } },
      },
      children: [fieldName],
    },
    { node: fieldName, type, slot: wrapName, content: label },
  ];
}

function thirdField(wrapName, fieldName, type, label) {
  return [
    {
      node: wrapName,
      type: 'container',
      style: {
        desktop: { dimensions: { width: 'calc(33.333% - 8px)' } },
        tablet: { dimensions: { width: 'calc(33.333% - 8px)' } },
        mobile: { dimensions: { width: '100%' } },
      },
      children: [fieldName],
    },
    { node: fieldName, type, slot: wrapName, content: label },
  ];
}

function withSlot(nodes, slot) {
  return nodes.map((n) => (n.slot === undefined ? { ...n, slot } : n));
}

function buildFlightDetailsBlueprint() {
  const rowService = withSlot([...halfField('flightNumberWrap', 'flightNumber', 'textField', 'Flight Number'),
    ...halfField('airlineWrap', 'airline', 'textField', 'Airline')], 'rowService');
  const rowOrigin = withSlot([...halfField('originCodeWrap', 'originCode', 'textField', 'Origin Code'),
    ...halfField('originCityWrap', 'originCity', 'textField', 'Origin City')], 'rowOrigin');
  const rowDest = withSlot([...halfField('destinationCodeWrap', 'destinationCode', 'textField', 'Destination Code'),
    ...halfField('destinationCityWrap', 'destinationCity', 'textField', 'Destination City')], 'rowDest');
  const rowTimes = withSlot([...halfField('departureTimeWrap', 'departureTime', 'dateField', 'Departs'),
    ...halfField('arrivalTimeWrap', 'arrivalTime', 'dateField', 'Arrives')], 'rowTimes');
  const rowOps = withSlot([...thirdField('aircraftTypeWrap', 'aircraftType', 'textField', 'Aircraft'),
    ...thirdField('terminalWrap', 'terminal', 'textField', 'Terminal'),
    ...thirdField('gateWrap', 'gate', 'textField', 'Gate')], 'rowOps');
  const rowSeats = withSlot([...halfField('economySeatsWrap', 'economySeats', 'numberField', 'Economy Seats'),
    ...halfField('businessSeatsWrap', 'businessSeats', 'numberField', 'Business Seats')], 'rowSeats');
  const rowFare = withSlot([...halfField('baseFareWrap', 'baseFare', 'numberField', 'Base Fare'),
    ...halfField('statusFieldWrap', 'statusField', 'textField', 'Flight Status')], 'rowFare');

  const nodes = [
    { node: 'dataContext', type: 'dataContext' },
    {
      node: 'page', type: 'container', role: 'page-root', children: ['pageHeader', 'validationErrors', 'body'],
    },
    {
      node: 'pageHeader', type: 'container', role: 'header-band', slot: 'page', children: ['heading', 'subtitle', 'lifecycleButtonGroup'],
    },
    // Defect 3's fix: mustache content, never `{_mode:"code", _code: "... + ..."}`.
    { node: 'heading', type: 'text', slot: 'pageHeader', content: '{{data.flightNumber}} · {{data.airline}}' },
    {
      node: 'subtitle',
      type: 'text',
      slot: 'pageHeader',
      content: '{{data.originCity}} ({{data.originCode}}) → {{data.destinationCity}} ({{data.destinationCode}})',
    },
    {
      node: 'lifecycleButtonGroup',
      type: 'buttonGroup',
      slot: 'pageHeader',
      items: [
        { label: 'Start Edit', action: { actionName: 'Start Edit', actionOwner: 'shesha.form' } },
        { label: 'Save', primary: true, action: { actionName: 'Submit', actionOwner: 'shesha.form' } },
        { label: 'Cancel Edit', action: { actionName: 'Cancel Edit', actionOwner: 'shesha.form' } },
      ],
    },
    { node: 'validationErrors', type: 'validationErrors', slot: 'page' },
    {
      node: 'body',
      type: 'container',
      slot: 'page',
      style: { desktop: { display: 'flex', flexDirection: 'row', gap: 24, dimensions: { width: '100%' } } },
      children: ['mainColumn', 'detailRail'],
    },
    {
      node: 'mainColumn',
      type: 'container',
      role: 'section-card',
      slot: 'body',
      style: { desktop: { dimensions: { width: 'calc(100% - 356px)' } } },
      children: ['detailTabs'],
    },
    {
      node: 'detailTabs',
      type: 'tabs',
      slot: 'mainColumn',
      tabs: [
        { key: 'service', title: 'Service', children: ['rowService', 'rowOrigin', 'rowDest'] },
        { key: 'schedule', title: 'Schedule', children: ['rowTimes', 'rowOps'] },
        { key: 'commercial', title: 'Capacity & fare', children: ['rowSeats', 'rowFare'] },
      ],
    },
    { node: 'rowService', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['flightNumberWrap', 'airlineWrap'] },
    { node: 'rowOrigin', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['originCodeWrap', 'originCityWrap'] },
    { node: 'rowDest', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['destinationCodeWrap', 'destinationCityWrap'] },
    { node: 'rowTimes', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['departureTimeWrap', 'arrivalTimeWrap'] },
    { node: 'rowOps', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['aircraftTypeWrap', 'terminalWrap', 'gateWrap'] },
    { node: 'rowSeats', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['economySeatsWrap', 'businessSeatsWrap'] },
    { node: 'rowFare', type: 'container', role: 'field-row', slot: 'detailTabs', children: ['baseFareWrap', 'statusFieldWrap'] },
    ...rowService, ...rowOrigin, ...rowDest, ...rowTimes, ...rowOps, ...rowSeats, ...rowFare,
    {
      node: 'detailRail', type: 'container', role: 'detail-rail', slot: 'body', children: ['railNote', 'isActive'],
    },
    // Defect 6's negative fixture: a standalone caption text node immediately
    // followed by a sibling control whose own label reads identically —
    // exactly asset-detail's "On active register" shape, transplanted here
    // to prove the mechanism can't fire regardless of which real form it
    // was first observed on.
    { node: 'railNote', type: 'text', slot: 'detailRail', content: 'Aircraft ready' },
    { node: 'isActive', type: 'checkbox', slot: 'detailRail', content: 'Aircraft ready' },
  ];

  return {
    screen: 'Flight Details',
    archetype: ARCHETYPE,
    theme: 'requirements-studio',
    viewport: '1440x900',
    entity: {
      fullClassName: 'Boxfusion.Test.Domain.Flight',
      modelType: { name: 'Flight', module: 'boxfusion.test' },
    },
    form: { module: 'boxfusion.test', name: 'flight-details', label: 'Flight' },
    nodes,
    bindings: [],
    assertions: [],
    dependencies: [],
  };
}

const blueprint = buildFlightDetailsBlueprint();
const { markup } = compileSpec(blueprint, ctx);
const entries = flatten(markup.components);
const byComponentName = new Map(entries.map(({ node }) => [node.componentName, node]).filter(([k]) => k !== undefined));
const t1 = tier1(markup, { registry });
const t2Raw = tier2(markup, { registry, roles, flows, archetype: ARCHETYPE });
const t2 = t2Raw.filter((f) => f.severity !== 'skip');

test('sanity: the flight-details forensic blueprint compiles and is itself Tier 1 + Tier 2 clean', () => {
  assert.deepStrictEqual(t1, [], `unexpected Tier 1 findings on the forensic fixture itself: ${JSON.stringify(t1, null, 2)}`);
  assert.deepStrictEqual(t2, [], `unexpected Tier 2 findings on the forensic fixture itself: ${JSON.stringify(t2, null, 2)}`);
});

// ---------------------------------------------------------------------------
// Defect 1 — proportional width stamped directly on an input leaf.
// Real symptom: 62/69 inputs across the four flight forms rendered at
// 257/285/247px instead of ~446px — antd's Form.Item chain forces the
// leaf's own wrapper to width:100% !important, so a width on the leaf never
// sizes the row track two siblings need to split.
// ---------------------------------------------------------------------------

test('defect 1: no proportional width on any input leaf — every input\'s width lives on its wrapping container (real symptom: cells rendered 257/285/247px instead of ~446px)', () => {
  const offenders = [];
  for (const { node, ctx: nodeCtx } of entries) {
    if (node.type === 'container') continue;
    for (const bp of BREAKPOINTS) {
      const w = node[bp]?.dimensions?.width;
      if (isSplitWidthValue(w)) offenders.push(`${nodeCtx.path} (${node.type} "${node.componentName}") ${bp}=${JSON.stringify(w)}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `defect 1 REPRODUCED — proportional width found directly on leaf(s): ${offenders.join('; ')}. This is exactly the mechanism that rendered flight-details' inputs at 257/285/247px instead of ~446px.`,
  );

  // And confirm the fix is genuinely present, not just "the leaf happens to
  // carry nothing": the wrapping container must carry the split width.
  const wrap = byComponentName.get('flightNumberWrap');
  assert.ok(wrap, 'flightNumberWrap container missing from compiled output');
  assert.equal(wrap.desktop.dimensions.width, 'calc(50% - 6px)');

  assert.ok(
    !t2.some((f) => f.code === 'T2-SPLIT-WIDTH-ON-LEAF'),
    'defect 1 REPRODUCED — T2-SPLIT-WIDTH-ON-LEAF fired against the compiled output',
  );
});

// ---------------------------------------------------------------------------
// Defect 2 — a card's own layout style stranded off its content/header slot.
// Real symptom: the status card rendered the literal run-together text
// "StatusFlight status"; the meta card rendered "RecordCapturedUpdated".
//
// IMPORTANT FINDING (see task-5-report.md for the full writeup): tree.mjs's
// buildNode() has NO branch for "card" (or "collapsiblePanel" — tier1.mjs's
// own DOUBLE_SLOT_TYPES) at all. A card node with children referenced via
// slot/children falls into buildLeafComponent's generic field-input branch
// (wrong shape entirely: {componentName, propertyName, label}, no
// content/header slot, no style) and those children are never invoked via
// buildNode, so compileSpec throws "defined but never reachable from a
// root" before normalize() — which DOES already contain the correct fix,
// propagateSlotStyle() — ever runs. This test asserts the CORRECT behaviour
// (compiles, and the slot carries the layout style) and is EXPECTED TO FAIL
// today: a loud, informative failure here is the honest outcome per the
// task brief, not a compiler edit to paper over the gap.
// ---------------------------------------------------------------------------

function buildStatusCardFragment() {
  return {
    screen: 'Flight Details (status card fragment)',
    archetype: ARCHETYPE,
    viewport: '1440x900',
    entity: { fullClassName: 'Boxfusion.Test.Domain.Flight', modelType: { name: 'Flight', module: 'boxfusion.test' } },
    form: { module: 'boxfusion.test', name: 'flight-details', label: 'Flight' },
    nodes: [
      { node: 'dataContext', type: 'dataContext' },
      { node: 'page', type: 'container', role: 'page-root', children: ['pageHeader', 'validationErrors', 'body'] },
      { node: 'pageHeader', type: 'container', role: 'header-band', slot: 'page', children: ['heading', 'lifecycleButtonGroup'] },
      { node: 'heading', type: 'text', slot: 'pageHeader', content: 'Flight' },
      {
        node: 'lifecycleButtonGroup',
        type: 'buttonGroup',
        slot: 'pageHeader',
        items: [{ label: 'Start Edit', action: { actionName: 'Start Edit', actionOwner: 'shesha.form' } }],
      },
      { node: 'validationErrors', type: 'validationErrors', slot: 'page' },
      {
        node: 'body',
        type: 'container',
        slot: 'page',
        style: { desktop: { display: 'flex', flexDirection: 'row', gap: 24, dimensions: { width: '100%' } } },
        children: ['mainColumn', 'detailRail'],
      },
      {
        node: 'mainColumn',
        type: 'container',
        role: 'section-card',
        slot: 'body',
        style: { desktop: { dimensions: { width: 'calc(100% - 356px)' } } },
        children: ['detailTabs'],
      },
      {
        node: 'detailTabs', type: 'tabs', slot: 'mainColumn', tabs: [{ key: 'service', title: 'Service', children: ['flightNumber'] }],
      },
      { node: 'flightNumber', type: 'textField', slot: 'detailTabs', content: 'Flight Number' },
      {
        node: 'detailRail', type: 'container', role: 'detail-rail', slot: 'body', children: ['statusPanel'],
      },
      // The exact real shape: a card whose own top-level style carries the
      // flex layout, with its two children living under its `content` slot.
      { node: 'statusPanel', type: 'card', slot: 'detailRail', children: ['statusPanelTitle', 'statusChip'] },
      { node: 'statusPanelTitle', type: 'text', slot: 'statusPanel', content: 'Status' },
      { node: 'statusChip', type: 'refListStatus', slot: 'statusPanel', content: 'Flight status' },
    ],
    bindings: [],
    assertions: [],
    dependencies: [],
  };
}

test('defect 2: a card\'s content slot carries the layout style intended for its children, never stranded on the card itself (real symptom: "StatusFlight status" / "RecordCapturedUpdated" run-together text)', () => {
  const cardBlueprint = buildStatusCardFragment();
  let cardMarkup;
  try {
    ({ markup: cardMarkup } = compileSpec(cardBlueprint, ctx));
  } catch (err) {
    assert.fail(
      'defect 2 could not even be exercised end-to-end because the compiler cannot build a "card" node with '
      + 'content/header children AT ALL today: tree.mjs\'s buildNode() has no branch for "card" (or '
      + '"collapsiblePanel" — tier1.mjs\'s DOUBLE_SLOT_TYPES), so it falls through to buildLeafComponent\'s generic '
      + 'field-input branch and its slot children are never invoked via buildNode, becoming unreachable. '
      + `compileSpec threw: ${err.message}\n`
      + 'normalize-form.mjs\'s propagateSlotStyle() (A2.1) already contains the correct fix for the ORIGINAL '
      + 'defect (mirroring a slot-hosting node\'s own layout style onto its content/header/customHeader slot when '
      + 'that slot has 2+ children and no style of its own) — but it never gets the chance to run, because '
      + 'compileSpec throws during buildTree(), before normalize() is ever called. This is a genuine compiler gap '
      + '(no DOUBLE_SLOT_TYPE builder in tree.mjs), reported here rather than patched to hide it.',
    );
    return;
  }

  const cardEntries = flatten(cardMarkup.components);
  const card = cardEntries.find(({ node }) => node.componentName === 'statusPanel')?.node;
  assert.ok(card, 'statusPanel card missing from compiled output');
  const contentChildren = Array.isArray(card.content?.components) ? card.content.components : [];
  assert.ok(contentChildren.length >= 2, 'statusPanel.content should hold both status children');

  const FLEX_PROPS = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];
  const cardHasLayoutStyle = FLEX_PROPS.some((p) => card.desktop?.[p] !== undefined);
  if (cardHasLayoutStyle) {
    const slotHasLayoutStyle = FLEX_PROPS.some((p) => card.content[p] !== undefined);
    assert.ok(
      slotHasLayoutStyle,
      'defect 2 REPRODUCED — statusPanel carries layout style on itself but its content slot (statusPanelTitle + '
      + 'statusChip) has none: the children collapse into one run-together string exactly like '
      + '"StatusFlight status" / "RecordCapturedUpdated".',
    );
  }
});

// ---------------------------------------------------------------------------
// Defect 3 — an entity-bound title/subtitle authored as `_mode:"code"`
// string concatenation. Real symptom: the header showed a literal "." (the
// heading) and a literal "() → ()" (the subtitle) — `??` fallbacks on
// unresolved `data` collapsed the whole expression to just its separators.
// ---------------------------------------------------------------------------

test('defect 3: no entity-bound title/subtitle uses _mode:"code" string concatenation — titles bind via mustache (real symptom: header showed a literal "." and a literal "() → ()")', () => {
  const heading = byComponentName.get('heading');
  const subtitle = byComponentName.get('subtitle');
  assert.ok(heading && subtitle, 'heading/subtitle missing from compiled output');

  for (const [name, node] of [['heading', heading], ['subtitle', subtitle]]) {
    assert.equal(
      typeof node.content,
      'string',
      `defect 3 REPRODUCED — "${name}".content is not a plain string (${JSON.stringify(node.content)}); the compiler `
      + 'has produced a `{_mode:"code", ...}` block, exactly the shape that collapses to bare separators when `data` is unresolved.',
    );
    assert.ok(!/_mode/.test(JSON.stringify(node.content)), `defect 3 REPRODUCED — "${name}".content contains "_mode"`);
    assert.ok(/\{\{data\./.test(node.content), `"${name}".content should bind via a mustache "{{data.*}}" token`);
  }

  assert.ok(
    !t2.some((f) => f.code === 'T2-CODEMODE-TITLE'),
    'defect 3 REPRODUCED — T2-CODEMODE-TITLE fired against the compiled output',
  );
});

// ---------------------------------------------------------------------------
// Defect 4 — formSettings.layout:"horizontal" + a global labelCol applied
// while fields sit in sub-50%-width containers. Real symptom (asset-detail):
// "Assign Employ…" truncated, "Asset Name :" crammed against a tiny input —
// a field-level labelCol override is silently ignored by the renderer, so
// the one global label column either truncates or crams once its row is
// narrower than full width.
// ---------------------------------------------------------------------------

test('defect 4: no horizontal labelCol applied to a form whose fields sit in sub-50% containers (real symptom: "Assign Employ…" truncated, "Asset Name :" crammed against a tiny input)', () => {
  // Precondition: the narrow-row shape this defect needs is genuinely
  // present in this compiled form (else the assertion below would be vacuous).
  const narrowContainerWithInput = entries.some(({ node }) => {
    if (node.type !== 'container') return false;
    const isNarrow = BREAKPOINTS.some((bp) => {
      const w = node[bp]?.dimensions?.width;
      if (typeof w !== 'string') return false;
      const m = /^calc\((\d+(?:\.\d+)?)%/.exec(w.trim());
      return m ? parseFloat(m[1]) <= 50 : false;
    });
    if (!isNarrow) return false;
    const children = Array.isArray(node.components) ? node.components : [];
    return children.some((c) => c && typeof c === 'object' && c.type && c.type !== 'container');
  });
  assert.ok(narrowContainerWithInput, 'test setup problem: no narrow (<=50%) container holding an input was found — defect 4 cannot be meaningfully exercised');

  const fs = markup.formSettings ?? {};
  assert.notEqual(
    fs.layout,
    'horizontal',
    'defect 4 REPRODUCED — formSettings.layout is "horizontal" alongside sub-50%-width field rows: a field-level labelCol override is silently ignored by the renderer, so the label column truncates/crams once its row is narrower than full width.',
  );

  assert.ok(
    !t2.some((f) => f.code === 'T2-LABELCOL-VS-NARROW-ROW'),
    'defect 4 REPRODUCED — T2-LABELCOL-VS-NARROW-ROW fired against the compiled output',
  );
});

// ---------------------------------------------------------------------------
// Defect 5 — a container holding 2+ row-containers declares no vertical
// gap. Real symptom: wildly uneven vertical gaps between field rows inside
// tabs (each row's OWN horizontal gap is 12, but row-to-row spacing falls
// back to each row's own intrinsic height).
// ---------------------------------------------------------------------------

test('defect 5: every container/tab-pane holding 2+ row-containers declares a vertical gap (real symptom: wildly uneven vertical gaps between field rows inside tabs)', () => {
  const tabsNode = entries.find(({ node }) => node.type === 'tabs' && node.componentName === 'detailTabs')?.node;
  assert.ok(tabsNode, 'detailTabs missing from compiled output');
  assert.ok(Array.isArray(tabsNode.tabs) && tabsNode.tabs.length === 3, 'expected 3 tabs (service/schedule/commercial)');

  const isRowLike = (n) => n && n.type === 'container' && n.desktop?.display === 'flex' && ['row', 'row-reverse'].includes(n.desktop?.flexDirection);
  const hasPositiveGap = (g) => (typeof g === 'number' ? g > 0 : typeof g === 'string' ? parseFloat(g) > 0 : false);

  for (const tab of tabsNode.tabs) {
    const rowChildrenDirect = (tab.components ?? []).filter(isRowLike);
    if (rowChildrenDirect.length >= 2) {
      assert.fail(
        `defect 5 REPRODUCED — tab "${tab.key}" hosts ${rowChildrenDirect.length} row-containers directly in its `
        + 'components[] with no vertical gap on the tab pane (the registry gives tab-pane objects no style props at '
        + 'all) — row-to-row spacing falls back to intrinsic content height, producing wildly uneven vertical gaps.',
      );
    }
    // The fix normalize-form.mjs actually applies: wrap the rows in one
    // child container that carries the vertical gap.
    if (tab.components.length === 1 && isRowLike(tab.components[0]) === false) {
      const wrapper = tab.components[0];
      const wrapperRows = (wrapper.components ?? []).filter(isRowLike);
      if (wrapperRows.length >= 2) {
        assert.ok(hasPositiveGap(wrapper.desktop?.gap), `tab "${tab.key}"'s row-wrapping container has no positive vertical gap`);
      }
    }
  }

  assert.ok(
    !t2.some((f) => f.code === 'T2-ROWLIST-NO-VGAP'),
    'defect 5 REPRODUCED — T2-ROWLIST-NO-VGAP fired against the compiled output',
  );
});

// ---------------------------------------------------------------------------
// Defect 6 — a standalone text node duplicates a sibling control's own
// (hidden) label. Real symptom (asset-detail): rail items unspaced, with an
// orphaned unlabelled checkbox — the caption authored twice (once as a text
// node, once as the sibling's own hidden label).
// ---------------------------------------------------------------------------

test('defect 6: no text node duplicates a sibling control\'s own label (real symptom: rail items unspaced, with an orphaned unlabelled checkbox)', () => {
  const isActive = byComponentName.get('isActive');
  assert.ok(isActive, 'isActive checkbox missing from compiled output');
  assert.notEqual(
    isActive.hideLabel,
    true,
    'defect 6 REPRODUCED — "isActive" carries hideLabel:true alongside a sibling text node with the identical caption ("Aircraft ready") — the caption is authored twice, and with flat spacing between siblings the control reads as an orphaned, unlabelled item.',
  );

  assert.ok(
    !t2.some((f) => f.code === 'T2-DUPLICATE-CAPTION'),
    'defect 6 REPRODUCED — T2-DUPLICATE-CAPTION fired against the compiled output',
  );
});

// ---------------------------------------------------------------------------
// Deliverable 3 — the compiler beats the real, broken markup. Run the SAME
// validator over the real flight-details.pushed.json (read only from the
// scratchpad; never copied into this repo) and over this compiled
// equivalent, and assert the compiled one has strictly fewer Tier 1 + Tier 2
// findings. That delta is the headline result of the whole phase.
// ---------------------------------------------------------------------------

test('the compiler beats the real, broken flight-details markup on Tier 1 + Tier 2 finding count', () => {
  const realPath = join(SCRATCHPAD_DIR, 'flight-details.pushed.json');
  const real = JSON.parse(readFileSync(realPath, 'utf8'));

  const realT1 = tier1(real, { registry });
  const realT2Raw = tier2(real, { registry, roles, flows, archetype: ARCHETYPE });
  const realT2 = realT2Raw.filter((f) => f.severity !== 'skip');
  const realTotal = realT1.length + realT2.length;
  const compiledTotal = t1.length + t2.length;

  // eslint-disable-next-line no-console
  console.log(`[forensic-regression] flight-details Tier1+Tier2 findings — real: ${realTotal} (T1:${realT1.length} T2:${realT2.length}), compiled: ${compiledTotal} (T1:${t1.length} T2:${t2.length})`);

  assert.ok(
    compiledTotal < realTotal,
    `expected the compiled equivalent to have strictly fewer Tier1+Tier2 findings than the real pushed markup — real: ${realTotal}, compiled: ${compiledTotal}`,
  );
});
