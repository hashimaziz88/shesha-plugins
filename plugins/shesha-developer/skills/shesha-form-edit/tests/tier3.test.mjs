import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier3 } from '../scripts/lib/tier3.mjs';
import { compileSpec } from '../scripts/compile-spec.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const thresholds = JSON.parse(readFileSync(join(ROOT, 'assets/thresholds.json'), 'utf8'));

const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const ctx = { registry, thresholds };
const codes = (m, extra) => tier3(m, { ...ctx, ...extra }).findings.map((f) => f.code);
const ID = () => crypto.randomUUID();

function container(overrides) {
  return Object.assign({
    id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'column', flexWrap: 'nowrap',
    gap: 0, justifyContent: 'flex-start', alignItems: 'stretch',
  }, overrides);
}

// ---------------------------------------------------------------------------
// Shape / calibration-flag basics
// ---------------------------------------------------------------------------

test('returns {score, findings, uncalibrated} and every finding is tier 3 / severity observe', () => {
  const m = { components: [container({})] };
  const result = tier3(m, ctx);
  assert.equal(typeof result.score, 'number');
  assert.ok(Array.isArray(result.findings));
  assert.equal(typeof result.uncalibrated, 'boolean');
  for (const f of result.findings) {
    assert.equal(f.tier, 3);
    assert.equal(f.severity, 'observe');
    assert.ok(f.path);
    assert.ok(f.message);
  }
});

test('uncalibrated is false now that assets/thresholds.json is calibrated (Task 5)', () => {
  assert.equal(thresholds.calibrated, true, 'assets/thresholds.json should be calibrated after Task 5 (see docs/corpus-report.md)');
  const m = { components: [container({})] };
  assert.equal(tier3(m, ctx).uncalibrated, false);
});

test('uncalibrated is true when a caller supplies thresholds with calibrated: false', () => {
  const m = { components: [container({})] };
  const uncalibrated = { ...thresholds, calibrated: false };
  assert.equal(tier3(m, { registry, thresholds: uncalibrated }).uncalibrated, true);
});

test('a clean form scores 100 with no findings', () => {
  // desktop + font are here so the ported T3-STYLE-COVERAGE/T3-STYLE-TYPOGRAPHY
  // checks stay silent too — this fixture is meant to be clean across EVERY
  // check, not just the pre-port set.
  const m = { components: [container({ componentName: 'page', desktop: { dimensions: { width: '100%' } }, font: { size: 14 } })] };
  const result = tier3(m, ctx);
  assert.equal(result.score, 100);
  assert.deepEqual(result.findings, []);
});

// ---------------------------------------------------------------------------
// One assertion per check
// ---------------------------------------------------------------------------

test('T3-LABEL-CASING: flags a Title Case label', () => {
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'firstName', label: 'First Name', parentId: 'root', version: 6 }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-LABEL-CASING');
  assert.ok(found);
  assert.match(found.message, /First Name/);
});

test('T3-LABEL-CASING: does not flag an already-sentence-case label, or an acronym in a later word', () => {
  const m = { components: [
    { id: ID(), type: 'textField', propertyName: 'firstName', label: 'First name', parentId: 'root', version: 6 },
    { id: ID(), type: 'textField', propertyName: 'vendorId', label: 'Vendor ID', parentId: 'root', version: 6 },
  ] };
  assert.ok(!codes(m).includes('T3-LABEL-CASING'));
});

test('T3-PRIMARY-COUNT: flags an action zone with two primary buttons', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [
    { itemType: 'item', itemSubType: 'button', label: 'Save', buttonType: 'primary' },
    { itemType: 'item', itemSubType: 'button', label: 'Approve', buttonType: 'primary' },
  ] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-PRIMARY-COUNT');
  assert.ok(found);
  assert.match(found.message, /2 buttonType:"primary"/);
});

test('T3-PRIMARY-COUNT: flags an action zone with zero primary buttons', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [
    { itemType: 'item', itemSubType: 'button', label: 'Save', buttonType: 'default' },
  ] }] };
  assert.ok(codes(m).includes('T3-PRIMARY-COUNT'));
});

test('T3-PRIMARY-COUNT: does not flag exactly one primary', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [
    { itemType: 'item', itemSubType: 'button', label: 'Save', buttonType: 'primary' },
    { itemType: 'item', itemSubType: 'button', label: 'Back', buttonType: 'default' },
  ] }] };
  assert.ok(!codes(m).includes('T3-PRIMARY-COUNT'));
});

test('T3-DESTRUCTIVE-PRIMARY: flags a Delete button styled as primary', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [
    { itemType: 'item', itemSubType: 'button', label: 'Save', buttonType: 'default' },
    { itemType: 'item', itemSubType: 'button', label: 'Delete', buttonType: 'primary' },
  ] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-DESTRUCTIVE-PRIMARY');
  assert.ok(found);
  assert.match(found.message, /"Delete"/);
});

test('T3-DESTRUCTIVE-PRIMARY: does not flag Delete when it is not primary', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [
    { itemType: 'item', itemSubType: 'button', label: 'Save', buttonType: 'primary' },
    { itemType: 'item', itemSubType: 'button', label: 'Delete', buttonType: 'default' },
  ] }] };
  assert.ok(!codes(m).includes('T3-DESTRUCTIVE-PRIMARY'));
});

test('T3-HEADER-FONT-INCOMPLETE: flags a heading text with no explicit font.size/font.weight', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'heading', parentId: 'root', version: 5, content: 'Widget' }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-HEADER-FONT-INCOMPLETE');
  assert.ok(found);
});

test('T3-HEADER-FONT-INCOMPLETE: does not flag a heading with both font.size and font.weight set (registry-real nested shape)', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'heading', parentId: 'root', version: 5, content: 'Widget', font: { size: 24, weight: '600' } }] };
  assert.ok(!codes(m).includes('T3-HEADER-FONT-INCOMPLETE'));
});

test('T3-HEADER-FONT-INCOMPLETE: DOES flag the old flat fontSize/fontWeight shape (not a registry prop for "text")', () => {
  // Regression guard for the original bug: "text" has no flat fontSize/fontWeight
  // props at all (see registry-0.45.1.json) — a heading using the flat spelling
  // must still be reported as incomplete, not treated as "styled".
  const m = { components: [{ id: ID(), type: 'text', componentName: 'heading', parentId: 'root', version: 5, content: 'Widget', fontSize: 24, fontWeight: '600' }] };
  assert.ok(codes(m).includes('T3-HEADER-FONT-INCOMPLETE'));
});

test('T3-HEADER-FONT-INCOMPLETE: does not flag an ordinary (non-heading) text node', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'Some body copy.' }] };
  assert.ok(!codes(m).includes('T3-HEADER-FONT-INCOMPLETE'));
});

test('T3-RAW-HEX: flags a hex color on a non-container node (broader than T2\'s container-only scope)', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x', font: { color: '#ff0000' } }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-RAW-HEX');
  assert.ok(found);
  assert.match(found.message, /#ff0000/);
});

test('T3-RAW-HEX: does not flag a color covered by an overrides[] source+evidence entry', () => {
  // Reconciled alongside tier2's T2-STYLE-OFF-TOKEN: this now reads the
  // blueprint schema's overrides[] = {prop, value, source, evidence} shape,
  // not the legacy styleOverrides[path] object.
  const m = { components: [{
    id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x', font: { color: '#ff0000' },
    overrides: [{ prop: 'font.color', value: '#ff0000', source: 'brand guideline', evidence: 'design review' }],
  }] };
  assert.ok(!codes(m).includes('T3-RAW-HEX'));
});

test('T3-RAW-HEX: DOES flag an overrides[] entry missing source or evidence (no provenance, not covered)', () => {
  const m = { components: [{
    id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x', font: { color: '#ff0000' },
    overrides: [{ prop: 'font.color', value: '#ff0000', source: '', evidence: '' }],
  }] };
  assert.ok(codes(m).includes('T3-RAW-HEX'));
});

test('T3-RAW-HEX: does NOT accept the superseded styleOverrides[path] shape as coverage anymore', () => {
  const m = { components: [{
    id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x', font: { color: '#ff0000' },
    styleOverrides: { 'font.color': { source: 'brand guideline', evidence: 'design review' } },
  }] };
  assert.ok(codes(m).includes('T3-RAW-HEX'));
});

test('T3-RAW-HEX: does NOT flag the framework-stamped default border/shadow/background colors', () => {
  // Corrected in Task 5: #d9d9d9 (border), #000/#000000 (shadow) and
  // #ffffff (background) are values the framework's own style migrator
  // stamps on every component load, never a deliberate brand choice — see
  // tier3.mjs's isFrameworkDefaultColor comment and docs/corpus-report.md.
  const m = { components: [{
    id: ID(), type: 'container', parentId: 'root', version: 7,
    desktop: {
      border: { border: { all: { color: '#d9d9d9' } } },
      background: { color: '#ffffff' },
      shadow: { color: '#000' },
    },
  }] };
  assert.ok(!codes(m).includes('T3-RAW-HEX'));
});

test('T3-RAW-HEX: still flags a hex color that only coincidentally shares a path with a default (different value)', () => {
  const m = { components: [{
    id: ID(), type: 'container', parentId: 'root', version: 7,
    desktop: { border: { border: { all: { color: '#ff00ff' } } } },
  }] };
  assert.ok(codes(m).includes('T3-RAW-HEX'));
});

test('T3-COMPONENT-RATIO: flags a form whose components/bindings ratio exceeds the budget', () => {
  const m = { components: [
    container({ componentName: 'a', components: [
      container({ componentName: 'b', components: [
        container({ componentName: 'c', components: [
          container({ componentName: 'd', components: [
            { id: ID(), type: 'textField', propertyName: 'onlyField', parentId: 'root', version: 6 },
          ] }),
        ] }),
      ] }),
    ] }),
  ] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-COMPONENT-RATIO');
  assert.ok(found, `expected a ratio finding for 5 components / 1 binding against a budget of ${thresholds.componentBindingRatioBudget}`);
});

test('T3-COMPONENT-RATIO: is skipped (no finding, no crash) when there are zero bindings', () => {
  const m = { components: [container({ componentName: 'a' })] };
  assert.ok(!codes(m).includes('T3-COMPONENT-RATIO'));
});

test('T3-COMPONENT-RATIO: is skipped when thresholds carries no budget', () => {
  const m = { components: [
    container({ componentName: 'a', components: [
      container({ componentName: 'b', components: [
        { id: ID(), type: 'textField', propertyName: 'f', parentId: 'root', version: 6 },
      ] }),
    ] }),
  ] };
  assert.ok(!codes(m, { thresholds: {} }).includes('T3-COMPONENT-RATIO'));
});

test('T3-ORPHAN-CONTAINER: flags a container with exactly one child and no styling of its own', () => {
  // The child is deliberately a NON-binding `text` node. A container whose only
  // child is a BOUND input leaf is a "field cell" — the normalizer inserts
  // exactly those so a field's geometry has a node that can hold it (a width on
  // an input leaf lands inside an antd Form.Item chain forced to
  // width:100% !important). Those are mandated structure, not wrapper debt, and
  // are exempt — see isFieldCell in tier3.mjs and tests/field-cell-exemption.test.mjs.
  const m = { components: [
    container({ componentName: 'wrapper', components: [
      { id: ID(), type: 'text', parentId: 'root', version: 5 },
    ] }),
  ] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-ORPHAN-CONTAINER');
  assert.ok(found);
  assert.match(found.message, /wrapper/);
});

test('T3-ORPHAN-CONTAINER: does NOT flag a field cell (container wrapping one bound input)', () => {
  const m = { components: [
    container({ componentName: 'fieldCell', components: [
      { id: ID(), type: 'textField', propertyName: 'f', parentId: 'root', version: 6 },
    ] }),
  ] };
  assert.ok(!codes(m).includes('T3-ORPHAN-CONTAINER'),
    'a normalizer-inserted field cell is mandated structure, not wrapper debt');
});

test('T3-ORPHAN-CONTAINER: does not flag a single-child container that carries real border/background styling', () => {
  const m = { components: [
    container({ componentName: 'wrapper', border: { borderType: 'all', border: { all: { width: 1, style: 'solid' } } }, components: [
      { id: ID(), type: 'textField', propertyName: 'f', parentId: 'root', version: 6 },
    ] }),
  ] };
  assert.ok(!codes(m).includes('T3-ORPHAN-CONTAINER'));
});

test('T3-ORPHAN-CONTAINER: does not flag a container with more than one child', () => {
  const m = { components: [
    container({ componentName: 'wrapper', components: [
      { id: ID(), type: 'textField', propertyName: 'f1', parentId: 'root', version: 6 },
      { id: ID(), type: 'textField', propertyName: 'f2', parentId: 'root', version: 6 },
    ] }),
  ] };
  assert.ok(!codes(m).includes('T3-ORPHAN-CONTAINER'));
});

test('T3-NON-AUTHORABLE-TYPE: flags a type the registry marks authorable:false', () => {
  const m = { components: [{ id: ID(), type: 'space', parentId: 'root', version: 1, componentName: 'spacer' }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-NON-AUTHORABLE-TYPE');
  assert.ok(found);
  assert.match(found.message, /authorable: false/);
});

test('T3-NON-AUTHORABLE-TYPE: does not flag an authorable type', () => {
  const m = { components: [container({ componentName: 'page' })] };
  assert.ok(!codes(m).includes('T3-NON-AUTHORABLE-TYPE'));
});

// ---------------------------------------------------------------------------
// Weighting behaviour — the load-bearing property of this module: bounded,
// legible damage per category, never a cliff to near-zero from one issue.
// ---------------------------------------------------------------------------

test('a single minor observation (one Title Case label) costs very little, nowhere near 20', () => {
  // desktop + font keep this silent on the ported T3-STYLE-COVERAGE/
  // T3-STYLE-TYPOGRAPHY checks so the assertion below isolates label-casing.
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'firstName', label: 'First Name', parentId: 'root', version: 6, desktop: { dimensions: { width: '100%' } }, font: { size: 14 } }] };
  const result = tier3(m, ctx);
  assert.equal(result.findings.length, 1);
  assert.ok(result.score >= 90, `expected a near-100 score for one label-casing observation, got ${result.score}`);
});

test('many occurrences of the same low-weight check are capped, not summed without bound', () => {
  // desktop + font on every field keep this silent on the ported
  // T3-STYLE-COVERAGE/T3-STYLE-TYPOGRAPHY checks so the capped score below
  // isolates T3-LABEL-CASING alone.
  const fields = Array.from({ length: 20 }, (_, i) => ({
    id: ID(), type: 'textField', propertyName: `field${i}`, label: `Field Number ${i}`, parentId: 'root', version: 6,
    desktop: { dimensions: { width: '100%' } }, font: { size: 14 },
  }));
  const m = { components: fields };
  const result = tier3(m, ctx);
  assert.equal(result.findings.filter((f) => f.code === 'T3-LABEL-CASING').length, 20);
  // cap is 10 points for this code, so score should be 90, never lower on this code alone.
  assert.equal(result.score, 90);
});

test('score never drops below 0 even with every category firing many times', () => {
  const items = [
    { itemType: 'item', itemSubType: 'button', label: 'Delete', buttonType: 'primary' },
    { itemType: 'item', itemSubType: 'button', label: 'Cancel', buttonType: 'primary' },
    { itemType: 'item', itemSubType: 'button', label: 'Reset', buttonType: 'primary' },
  ];
  const m = { components: [
    { id: ID(), type: 'text', componentName: 'title one', parentId: 'root', version: 5, content: 'x', font: { color: '#ff0000' } },
    { id: ID(), type: 'buttonGroup', componentName: 'actions', parentId: 'root', version: 15, items },
    { id: ID(), type: 'space', componentName: 'spacer', parentId: 'root', version: 1 },
    { id: ID(), type: 'paragraph', componentName: 'legacy para', parentId: 'root', version: 1 },
  ] };
  const result = tier3(m, ctx);
  assert.ok(result.score >= 0 && result.score <= 100);
});

test('every finding carries a diagnosable path and message', () => {
  const m = fx('t3-bad-score-clean');
  const result = tier3(m, ctx);
  assert.ok(result.findings.length > 0);
  for (const f of result.findings) {
    assert.ok(f.path && f.path.length > 0);
    assert.ok(f.message && f.message.length > 0);
  }
});

test('the shared bad-score fixture scores low (proves the CLI test fixture is meaningfully bad)', () => {
  const result = tier3(fx('t3-bad-score-clean'), ctx);
  assert.ok(result.score < 60, `expected a low score, got ${result.score}`);
});

// ---------------------------------------------------------------------------
// T3-ROW-CHILD-NOFILL — a row child at width "auto" cannot take a share of
// the track, and no blocking check sees it (T2-STYLE-INCOMPLETE only asks
// whether the width key exists, and "auto" exists).
// ---------------------------------------------------------------------------

function row(children) {
  return {
    id: ID(),
    type: 'container',
    componentName: 'row',
    parentId: 'root',
    version: 7,
    desktop: { display: 'flex', flexDirection: 'row', gap: 8 },
    components: children,
  };
}

function bpChild(name, width) {
  return {
    id: ID(),
    type: 'container',
    componentName: name,
    parentId: 'root',
    version: 7,
    desktop: { display: 'flex', flexDirection: 'column', dimensions: { width } },
    components: [],
  };
}

test('T3-ROW-CHILD-NOFILL: flags each auto-width child of a multi-child flex row', () => {
  const markup = { components: [row([bpChild('a', 'auto'), bpChild('b', 'auto')])] };
  const found = codes(markup).filter((c) => c === 'T3-ROW-CHILD-NOFILL');
  assert.equal(found.length, 2);
});

test('T3-ROW-CHILD-NOFILL: silent when the row children carry real widths', () => {
  const markup = { components: [row([bpChild('a', '50%'), bpChild('b', 'calc(100% - 348px)')])] };
  assert.ok(!codes(markup).includes('T3-ROW-CHILD-NOFILL'));
});

test('T3-ROW-CHILD-NOFILL: silent for a single-child row (nothing to share with)', () => {
  const markup = { components: [row([bpChild('only', 'auto')])] };
  assert.ok(!codes(markup).includes('T3-ROW-CHILD-NOFILL'));
});

test('T3-ROW-CHILD-NOFILL: silent under a COLUMN parent — auto stretches there', () => {
  const col = row([bpChild('a', 'auto'), bpChild('b', 'auto')]);
  col.desktop.flexDirection = 'column';
  assert.ok(!codes({ components: [col] }).includes('T3-ROW-CHILD-NOFILL'));
});

test('T3-ROW-CHILD-NOFILL: is an observation, never a blocker', () => {
  const markup = { components: [row([bpChild('a', 'auto'), bpChild('b', 'auto')])] };
  for (const f of tier3(markup, ctx).findings) {
    if (f.code !== 'T3-ROW-CHILD-NOFILL') continue;
    assert.equal(f.tier, 3);
    assert.equal(f.severity, 'observe');
  }
});

// ---------------------------------------------------------------------------
// Ported checks — see tier3.mjs's module docstring: these came from the
// retired validate-guardrails.js / validate-styledness.js toolchain and cite
// a `_rules.json` rule id. Same "one fires / one silent / one tier+severity"
// shape as the pre-existing checks above.
// ---------------------------------------------------------------------------

function navigateItem(actionArguments) {
  return {
    id: ID(), itemType: 'item', itemSubType: 'button', label: 'Go', buttonType: 'default', buttonAction: 'navigate',
    actionConfiguration: {
      actionOwner: 'shesha.common', actionName: 'Navigate', _type: 'action-config',
      ...(actionArguments ? { actionArguments } : {}),
    },
  };
}

test('T3-NAVIGATE-TARGET-MISSING: flags a buttonGroup item with a Navigate action and no target/url/formId', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [navigateItem(undefined)] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-NAVIGATE-TARGET-MISSING');
  assert.ok(found);
  assert.match(found.message, /R-008/);
});

test('T3-NAVIGATE-TARGET-MISSING: silent when actionArguments carries a non-empty url (the compiler\'s own shape)', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [navigateItem({ navigationType: 'url', url: '/dynamic/app/employee-table' })] }] };
  assert.ok(!codes(m).includes('T3-NAVIGATE-TARGET-MISSING'));
});

test('T3-NAVIGATE-TARGET-MISSING: also flags a standalone node carrying a Navigate action directly (not inside a buttonGroup)', () => {
  const m = { components: [{ id: ID(), type: 'button', parentId: 'root', version: 2, componentName: 'goBtn', buttonAction: 'navigate', actionConfiguration: { actionOwner: 'shesha.common', actionName: 'Navigate', _type: 'action-config' } }] };
  assert.ok(codes(m).includes('T3-NAVIGATE-TARGET-MISSING'));
});

test('T3-NAVIGATE-TARGET-MISSING: is tier 3 / severity observe', () => {
  const m = { components: [{ id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, componentName: 'actions', items: [navigateItem(undefined)] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-NAVIGATE-TARGET-MISSING');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

test('T3-CHECKBOXGROUP-VALUES-KEY: flags dataSourceType:"values" with a `values` array instead of `items`', () => {
  const m = { components: [{ id: ID(), type: 'checkboxGroup', propertyName: 'flags', parentId: 'root', version: 5, dataSourceType: 'values', values: [{ id: '1', label: 'A', value: 'a' }] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-CHECKBOXGROUP-VALUES-KEY');
  assert.ok(found);
  assert.match(found.message, /R-011/);
});

test('T3-CHECKBOXGROUP-VALUES-KEY: silent when the checkboxGroup correctly uses `items`', () => {
  const m = { components: [{ id: ID(), type: 'checkboxGroup', propertyName: 'flags', parentId: 'root', version: 5, dataSourceType: 'values', items: [{ label: 'A', value: 'a' }] }] };
  assert.ok(!codes(m).includes('T3-CHECKBOXGROUP-VALUES-KEY'));
});

test('T3-CHECKBOXGROUP-VALUES-KEY: silent for a dropdown using `values` (that IS the correct shape there)', () => {
  const m = { components: [{ id: ID(), type: 'dropdown', propertyName: 'flag', parentId: 'root', version: 5, dataSourceType: 'values', values: [{ id: '1', label: 'A', value: 'a' }] }] };
  assert.ok(!codes(m).includes('T3-CHECKBOXGROUP-VALUES-KEY'));
});

test('T3-CHECKBOXGROUP-VALUES-KEY: is tier 3 / severity observe', () => {
  const m = { components: [{ id: ID(), type: 'checkboxGroup', propertyName: 'flags', parentId: 'root', version: 5, dataSourceType: 'values', values: [{ id: '1', label: 'A', value: 'a' }] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-CHECKBOXGROUP-VALUES-KEY');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

function deleteRowItem(actionOwner) {
  return {
    id: ID(), itemType: 'item', columnType: 'action', icon: 'DeleteOutlined', minWidth: 35, maxWidth: 35,
    actionConfiguration: { actionName: 'Delete row', actionOwner, _type: 'action-config' },
  };
}

test('T3-DELETE-ROW-ACTION: flags actionName:"Delete row" with actionOwner:"table"', () => {
  const m = { components: [{ id: ID(), type: 'datatable', parentId: 'root', version: 3, componentName: 'grid', items: [deleteRowItem('table')] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-DELETE-ROW-ACTION');
  assert.ok(found);
  assert.match(found.message, /R-044/);
});

test('T3-DELETE-ROW-ACTION: silent when actionOwner is the enclosing dataContext id, not "table"', () => {
  const m = { components: [{ id: ID(), type: 'datatable', parentId: 'root', version: 3, componentName: 'grid', items: [deleteRowItem('dataContext1')] }] };
  assert.ok(!codes(m).includes('T3-DELETE-ROW-ACTION'));
});

test('T3-DELETE-ROW-ACTION: silent when actionOwner is "table" but the action is not "Delete row"', () => {
  const m = { components: [{ id: ID(), type: 'datatable', parentId: 'root', version: 3, componentName: 'grid', items: [{ id: ID(), itemType: 'item', columnType: 'action', actionConfiguration: { actionName: 'Execute Script', actionOwner: 'table', _type: 'action-config' } }] }] };
  assert.ok(!codes(m).includes('T3-DELETE-ROW-ACTION'));
});

test('T3-DELETE-ROW-ACTION: is tier 3 / severity observe', () => {
  const m = { components: [{ id: ID(), type: 'datatable', parentId: 'root', version: 3, componentName: 'grid', items: [deleteRowItem('table')] }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-DELETE-ROW-ACTION');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

// The denominator is STYLE_BEARING_TYPES, not the retired validator's verbatim
// VISUAL set: this architecture deliberately never styles an input leaf (the
// Form.Item chain forces width:100% !important, so T2 rejects style there) or a
// buttonGroup (colour comes from the app theme). Counting leaves scored the
// compiler's own gate-clean output 54/100. These fixtures therefore use
// containers — the things that genuinely do or don't carry the compiled theme.
const bare = (name) => ({ id: ID(), type: 'container', componentName: name, parentId: 'root', version: 7 });
const dressed = (name) => ({ ...bare(name), desktop: { dimensions: { width: '100%' } } });

test('T3-STYLE-COVERAGE: flags a form where fewer than 40% of style-bearing components carry any styling', () => {
  const m = { components: [bare('a'), bare('b'), bare('c'), dressed('d')] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-COVERAGE');
  assert.ok(found, '1/4 styled (25%) should be below the 40% bar');
  assert.match(found.message, /R-042/);
});

test('T3-STYLE-COVERAGE: silent when at least 40% of style-bearing components carry explicit styling', () => {
  const m = { components: [dressed('a'), dressed('b'), bare('c')] };
  assert.ok(!codes(m).includes('T3-STYLE-COVERAGE'), '2/3 styled (67%) is above the 40% bar');
});

test('T3-STYLE-COVERAGE: unstyled input leaves alone never trip it (they are never styled by design)', () => {
  const m = { components: [
    { id: ID(), type: 'textField', propertyName: 'a', parentId: 'root', version: 6 },
    { id: ID(), type: 'dateField', propertyName: 'b', parentId: 'root', version: 6 },
    { id: ID(), type: 'buttonGroup', componentName: 'actions', parentId: 'root', version: 5, items: [] },
    { id: ID(), type: 'validationErrors', componentName: 've', parentId: 'root', version: 3 },
  ] };
  assert.ok(!codes(m).includes('T3-STYLE-COVERAGE'), 'leaves are not the pipeline\'s styling surface');
});

test('T3-STYLE-COVERAGE: is tier 3 / severity observe', () => {
  const m = { components: [bare('a')] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-COVERAGE');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

test('T3-STYLE-TYPOGRAPHY: flags a tree with zero explicit font declarations anywhere', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x' }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-TYPOGRAPHY');
  assert.ok(found);
  assert.match(found.message, /R-042/);
});

test('T3-STYLE-TYPOGRAPHY: silent when at least one node declares font.size/font.weight', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x', font: { size: 14 } }] };
  assert.ok(!codes(m).includes('T3-STYLE-TYPOGRAPHY'));
});

test('T3-STYLE-TYPOGRAPHY: is tier 3 / severity observe', () => {
  const m = { components: [{ id: ID(), type: 'text', componentName: 'blurb', parentId: 'root', version: 5, content: 'x' }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-TYPOGRAPHY');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

test('T3-STYLE-INLINE-CONFLICT: flags a node with both a legacy inline `style` string and a structured desktop block', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, style: 'color: red;', desktop: { background: { type: 'color', color: '#ffffff' } } }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-INLINE-CONFLICT');
  assert.ok(found);
  assert.match(found.message, /R-030/);
});

test('T3-STYLE-INLINE-CONFLICT: silent when only the inline style is present (nothing structured to conflict with)', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, style: 'color: red;' }] };
  assert.ok(!codes(m).includes('T3-STYLE-INLINE-CONFLICT'));
});

test('T3-STYLE-INLINE-CONFLICT: silent when only the structured block is present (nothing legacy to conflict)', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, desktop: { background: { type: 'color', color: '#ffffff' } } }] };
  assert.ok(!codes(m).includes('T3-STYLE-INLINE-CONFLICT'));
});

test('T3-STYLE-INLINE-CONFLICT: is tier 3 / severity observe', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, style: 'color: red;', desktop: { background: { type: 'color', color: '#ffffff' } } }] };
  const found = tier3(m, ctx).findings.find((f) => f.code === 'T3-STYLE-INLINE-CONFLICT');
  assert.equal(found.tier, 3);
  assert.equal(found.severity, 'observe');
});

// ---------------------------------------------------------------------------
// Regression guard: the 8 shipped example blueprints must not start tripping
// the newly-ported correctness codes. These are the golden, hand-curated
// blueprints e2e-compile.test.mjs already proves compile clean across Tier 1
// + Tier 2 — porting new Tier 3 checks must not surface a defect in them
// (which would mean either the port is wrong, or the golden examples
// genuinely regressed) and must never change what tier1()/tier2() alone
// already decide about them.
// ---------------------------------------------------------------------------

test('the ported correctness checks do not fire on any of the 8 shipped example blueprints', () => {
  const BP_DIR = join(ROOT, '../shesha-design-comprehension/assets/blueprint-examples');
  const FLOWS_DIR = join(ROOT, 'assets/archetypes');
  const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json'), 'utf8'));
  const ARCHETYPES = [
    'standalone-capture', 'capture-dialog', 'record-detail', 'table-worklist',
    'list-card', 'hub', 'dashboard', 'wizard',
  ];
  // ALL SIX ported codes, styled-ness included. Excluding the styled-ness three
  // is what let them ship mis-firing: ported with the retired validator's
  // verbatim denominator, T3-STYLE-COVERAGE and T3-STYLE-TYPOGRAPHY scored the
  // compiler's own gate-clean output at 54 and 60 out of 100, and this guard
  // stayed green throughout. The compiler bakes the theme in [R-042], so its
  // output must not trip a styled-ness check — if it does, the check is wrong
  // about this architecture, or the compiler genuinely stopped styling.
  const NEW_CORRECTNESS_CODES = [
    'T3-NAVIGATE-TARGET-MISSING', 'T3-CHECKBOXGROUP-VALUES-KEY', 'T3-DELETE-ROW-ACTION',
    'T3-STYLE-COVERAGE', 'T3-STYLE-TYPOGRAPHY', 'T3-STYLE-INLINE-CONFLICT',
  ];

  for (const archetype of ARCHETYPES) {
    const blueprint = JSON.parse(readFileSync(join(BP_DIR, `${archetype}.blueprint.json`), 'utf8'));
    const flow = loadFlow(archetype, { dir: FLOWS_DIR });
    const { markup } = compileSpec(blueprint, { registry, roles, tokens, flows: { [archetype]: flow } });

    const result = tier3(markup, { registry, thresholds, tokens });
    for (const f of result.findings) {
      assert.equal(f.tier, 3, `${archetype}: ${f.code} is not tier 3`);
      assert.equal(f.severity, 'observe', `${archetype}: ${f.code} is not severity observe`);
    }
    const fired = result.findings.filter((f) => NEW_CORRECTNESS_CODES.includes(f.code));
    assert.deepStrictEqual(fired, [], `${archetype}: unexpected new-correctness-code finding(s): ${JSON.stringify(fired)}`);
  }
});

// ---------------------------------------------------------------------------
// Tier 3 (ported checks included) must never affect validate-form.mjs's exit
// code — enforced by validate-form.mjs's own exitCode formula
// ((t1.length===0 && t2.length===0) ? 0 : 1), not by anything in this file.
// This runs the actual CLI against the shared bad-score fixture to prove it
// end to end, mirroring tests/validate-cli.test.mjs's own equivalent check.
// ---------------------------------------------------------------------------

test('validate-form.mjs CLI: a low Tier 3 score (now including any ported-check findings) still exits 0', () => {
  const CLI = join(ROOT, 'scripts/validate-form.mjs');
  const stdout = execFileSync(process.execPath, [CLI, join(ROOT, 'tests/fixtures/t3-bad-score-clean.json'), '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.exitCode, 0, 'Tier 3 findings must never set a non-zero exitCode');
  assert.equal(parsed.tier1.length, 0);
  assert.equal(parsed.tier2.length, 0);
  assert.ok(parsed.tier3.score < 100, 'expected at least one Tier 3 finding on this fixture to make the assertion meaningful');
});
