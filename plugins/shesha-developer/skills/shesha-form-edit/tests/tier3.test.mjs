import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier3 } from '../scripts/lib/tier3.mjs';

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
  const m = { components: [container({ componentName: 'page' })] };
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
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'firstName', label: 'First Name', parentId: 'root', version: 6 }] };
  const result = tier3(m, ctx);
  assert.equal(result.findings.length, 1);
  assert.ok(result.score >= 90, `expected a near-100 score for one label-casing observation, got ${result.score}`);
});

test('many occurrences of the same low-weight check are capped, not summed without bound', () => {
  const fields = Array.from({ length: 20 }, (_, i) => ({
    id: ID(), type: 'textField', propertyName: `field${i}`, label: `Field Number ${i}`, parentId: 'root', version: 6,
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
