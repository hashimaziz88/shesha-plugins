import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(
  join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const ARCHETYPE_DIR = join(ROOT, 'assets/archetypes');

const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const ctx = { registry, roles, flows: {} };
const codes = (m, extra) => tier2(m, { ...ctx, ...extra }).map((f) => f.code);
const ID = () => crypto.randomUUID();

// --- Brief's representative assertions (verbatim) ---

test('flags a bare input as a flex-row child', () => {
  // dimensions.width on a bare input lands inside the antd Form.Item chain,
  // which is forced width:100% !important — two such fields do NOT split 50/50.
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'row',
    components: [{ id: ID(), type: 'textField', parentId: 'p', version: 6,
      desktop: { dimensions: { width: '50%' } } }] }] };
  const c = tier2(m, ctx).map((f) => f.code);
  assert.ok(c.includes('T2-FLEXCHILD-NOT-CONTAINER'));
  assert.ok(c.includes('T2-WIDTH-ON-NONCONTAINER'));
});

test('flags gap without display:flex as inert', () => {
  // getAlignmentStyle only emits flexDirection/flexWrap when display === 'flex'.
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, gap: 16 }] };
  assert.ok(tier2(m, ctx).map((f) => f.code).includes('T2-FLEX-NO-DISPLAY'));
});

test('skips flow completeness rather than guessing an archetype', () => {
  const findings = tier2(fx('t2-clean'), { registry, roles, flows: {} });  // no archetype supplied
  assert.ok(!findings.some((f) => f.code === 'T2-FLOW-INCOMPLETE'));
  assert.ok(findings.some((f) => f.code === 'T2-SKIPPED' && /archetype/.test(f.message)));
});

// --- t2-clean: only T2-SKIPPED entries, nothing else ---

test('a clean form produces only T2-SKIPPED findings (no archetype/knownForms supplied)', () => {
  const findings = tier2(fx('t2-clean'), ctx);
  assert.ok(findings.length > 0, 'expected the two skip findings');
  for (const f of findings) {
    assert.equal(f.code, 'T2-SKIPPED', `unexpected finding on t2-clean: ${f.code} — ${f.message}`);
    assert.equal(f.tier, 2);
    assert.equal(f.severity, 'skip');
  }
});

test('T2-DANGLING-FORMREF is also skipped (with a reason) when knownForms is absent', () => {
  const findings = tier2(fx('t2-clean'), ctx);
  assert.ok(findings.some((f) => f.code === 'T2-SKIPPED' && /knownForms/.test(f.message)));
});

test('T2-FLOW-INCOMPLETE and T2-DANGLING-FORMREF run (no skip) once their inputs are supplied', () => {
  const flows = { 'standalone-capture': loadFlow('standalone-capture', { dir: ARCHETYPE_DIR }) };
  const findings = tier2(fx('t2-clean'), { registry, roles, flows, archetype: 'standalone-capture', knownForms: [] });
  assert.ok(!findings.some((f) => f.code === 'T2-SKIPPED'));
});

// --- One assertion per code, via fixtures ---

test('T2-COLUMNS-PRESENT: flags a "columns" component anywhere in the tree', () => {
  assert.ok(codes(fx('t2-columns-present')).includes('T2-COLUMNS-PRESENT'));
});

test('T2-FLEXCHILD-NOT-CONTAINER: flags a non-container direct child of a flex-row container', () => {
  assert.ok(codes(fx('t2-flexchild-not-container')).includes('T2-FLEXCHILD-NOT-CONTAINER'));
});

test('T2-WIDTH-ON-NONCONTAINER: flags dimensions.width on a textField', () => {
  assert.ok(codes(fx('t2-width-on-noncontainer')).includes('T2-WIDTH-ON-NONCONTAINER'));
});

test('T2-FLEX-NO-DISPLAY: flags flexDirection set without display:flex', () => {
  const found = tier2(fx('t2-flex-no-display'), ctx).find((f) => f.code === 'T2-FLEX-NO-DISPLAY');
  assert.ok(found);
  assert.match(found.message, /flexDirection/);
});

test('T2-NODEFAULTSTYLING-DROPS-STYLE: flags noDefaultStyling:true alongside border/dimensions', () => {
  assert.ok(codes(fx('t2-nodefaultstyling-drops-style')).includes('T2-NODEFAULTSTYLING-DROPS-STYLE'));
});

test('T2-STYLE-INCOMPLETE: flags a container missing most of the layout contract', () => {
  const found = tier2(fx('t2-style-incomplete'), ctx).find((f) => f.code === 'T2-STYLE-INCOMPLETE');
  assert.ok(found);
  assert.match(found.message, /of \d+ required layout props set/);
});

test('T2-STYLE-INCOMPLETE: the required set is derived from registry container.props, not hand-typed', () => {
  // Prove derivation: an inflated fake registry container prop list changes what's required.
  const inflatedRegistry = JSON.parse(JSON.stringify(registry));
  inflatedRegistry.components.container.props.push('dimensions.zzzNewProp');
  const m = fx('t2-clean');
  const before = tier2(m, { registry, roles, flows: {} }).filter((f) => f.code === 'T2-STYLE-INCOMPLETE');
  const after = tier2(m, { registry: inflatedRegistry, roles, flows: {} }).filter((f) => f.code === 'T2-STYLE-INCOMPLETE');
  assert.equal(before.length, 0, 't2-clean should satisfy the real registry-derived contract');
  assert.ok(after.length > 0, 'a registry that grows a new dimensions.* prop must grow the requirement too');
});

test('T2-STYLE-OFF-TOKEN: flags a hardcoded hex color with no styleOverrides record', () => {
  const found = tier2(fx('t2-style-off-token'), ctx).find((f) => f.code === 'T2-STYLE-OFF-TOKEN');
  assert.ok(found);
  assert.match(found.message, /#f4f8ff/);
});

test('T2-STYLE-OFF-TOKEN: does not flag a color covered by a styleOverrides source+evidence record', () => {
  const m = fx('t2-style-off-token');
  m.components[0].styleOverrides = {
    'desktop.background.color': { source: 'brand guideline v3', evidence: 'design-system review 2026-07-01' },
  };
  assert.ok(!codes(m).includes('T2-STYLE-OFF-TOKEN'));
});

test('T2-VALIDATIONERRORS-MISSING: flags a required field with no validationErrors component', () => {
  assert.ok(codes(fx('t2-validationerrors-missing')).includes('T2-VALIDATIONERRORS-MISSING'));
});

test('T2-SUBMIT-WIRING: flags a Save item not wired to Submit/shesha.form', () => {
  const found = tier2(fx('t2-submit-wiring'), ctx).find((f) => f.code === 'T2-SUBMIT-WIRING');
  assert.ok(found);
  assert.match(found.message, /"Save"/);
});

test('T2-EXIT-MISSING: flags a Submit action with no paired exit action', () => {
  assert.ok(codes(fx('t2-exit-missing')).includes('T2-EXIT-MISSING'));
});

test('T2-LOOSE-BUTTON: flags a standalone "button" outside any buttonGroup', () => {
  assert.ok(codes(fx('t2-loose-button')).includes('T2-LOOSE-BUTTON'));
});

test('T2-PROPERTYNAME-CASE: flags a PascalCase propertyName on a field', () => {
  const found = tier2(fx('t2-propertyname-case'), ctx).filter((f) => f.code === 'T2-PROPERTYNAME-CASE');
  assert.ok(found.some((f) => /FirstName/.test(f.message)));
});

test('T2-PROPERTYNAME-CASE: also flags a PascalCase datatable column propertyName', () => {
  const found = tier2(fx('t2-propertyname-case'), ctx).filter((f) => f.code === 'T2-PROPERTYNAME-CASE');
  assert.ok(found.some((f) => /ActionedBy/.test(f.message)));
});

test('T2-DROPDOWN-SOURCE: flags a dropdown with no dataSourceType', () => {
  assert.ok(codes(fx('t2-dropdown-source')).includes('T2-DROPDOWN-SOURCE'));
});

test('T2-DATE-COMPONENT: flags a "birthDate" property on a textField', () => {
  assert.ok(codes(fx('t2-date-component')).includes('T2-DATE-COMPONENT'));
});

test('T2-DATE-COMPONENT: does not flag "candidate" (no word-boundary "date")', () => {
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'candidate', parentId: 'root', version: 6 }] };
  assert.ok(!codes(m).includes('T2-DATE-COMPONENT'));
});

test('T2-MODELTYPE-SHAPE: flags a legacy bare-string modelType', () => {
  assert.ok(codes(fx('t2-modeltype-shape')).includes('T2-MODELTYPE-SHAPE'));
});

test('T2-EDITMODE-MISMATCH: flags "inherited" on an interactive field with no detail lifecycle', () => {
  const found = tier2(fx('t2-editmode-mismatch'), ctx).find((f) => f.code === 'T2-EDITMODE-MISMATCH');
  assert.ok(found);
  assert.equal(found.expected, 'editMode: "editable"');
});

test('T2-EDITMODE-MISMATCH: does not flag "inherited" when a Start Edit lifecycle is present', () => {
  const m = {
    components: [
      { id: ID(), type: 'textField', propertyName: 'firstName', parentId: 'root', version: 6, editMode: 'inherited' },
      { id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, items: [
        { id: ID(), itemType: 'item', itemSubType: 'button', label: 'Edit',
          actionConfiguration: { actionOwner: 'shesha.form', actionName: 'Start Edit' } },
      ] },
    ],
  };
  assert.ok(!codes(m).includes('T2-EDITMODE-MISMATCH'));
});

test('T2-DATACONTEXT-PROPS: flags a dataContext missing entityType/sourceType/etc', () => {
  const found = tier2(fx('t2-datacontext-props'), ctx).find((f) => f.code === 'T2-DATACONTEXT-PROPS');
  assert.ok(found);
  assert.match(found.message, /uniqueStateId/);
});

test('T2-FLOW-INCOMPLETE: flags a form missing required archetype nodes when an archetype IS supplied', () => {
  const flows = { 'standalone-capture': loadFlow('standalone-capture', { dir: ARCHETYPE_DIR }) };
  const found = tier2(fx('t2-flow-incomplete'), { registry, roles, flows, archetype: 'standalone-capture' })
    .find((f) => f.code === 'T2-FLOW-INCOMPLETE');
  assert.ok(found);
  assert.match(found.message, /validationErrors/);
});

test('T2-DANGLING-FORMREF: flags an actionArguments.formId naming an unknown form when knownForms IS supplied', () => {
  const found = tier2(fx('t2-dangling-formref'), { registry, roles, flows: {}, knownForms: [{ module: 'A.Test', name: 'employee-create' }] })
    .find((f) => f.code === 'T2-DANGLING-FORMREF');
  assert.ok(found);
  assert.match(found.message, /employee-create-typo/);
});

test('T2-DANGLING-FORMREF: does not flag a formId that IS in knownForms', () => {
  const knownForms = [{ module: 'A.Test', name: 'employee-create-typo' }];
  assert.ok(!codes(fx('t2-dangling-formref'), { knownForms }).includes('T2-DANGLING-FORMREF'));
});

// --- Shape / quality-bar checks ---

test('every finding carries a path and a diagnosable message', () => {
  for (const f of tier2(fx('t2-style-incomplete'), ctx)) {
    assert.ok(f.path, `${f.code} has no path`);
    assert.ok(f.message && f.message.length > 10, `${f.code} message is not diagnosable`);
    assert.equal(f.tier, 2);
  }
});

test('every non-skip finding across all fixtures is tier 2 / severity fail with a path', () => {
  const fixtures = [
    't2-columns-present', 't2-flexchild-not-container', 't2-width-on-noncontainer', 't2-flex-no-display',
    't2-nodefaultstyling-drops-style', 't2-style-incomplete', 't2-style-off-token',
    't2-validationerrors-missing', 't2-submit-wiring', 't2-exit-missing', 't2-loose-button',
    't2-propertyname-case', 't2-dropdown-source', 't2-date-component', 't2-modeltype-shape',
    't2-editmode-mismatch', 't2-datacontext-props',
  ];
  for (const name of fixtures) {
    // Every fixture here is exercised with no archetype/knownForms, so
    // T2-FLOW-INCOMPLETE/T2-DANGLING-FORMREF always contribute their
    // T2-SKIPPED findings too — filter those out to check the REAL findings.
    const findings = tier2(fx(name), ctx).filter((f) => f.code !== 'T2-SKIPPED');
    assert.ok(findings.length >= 1, `${name} produced no non-skip findings`);
    for (const f of findings) {
      assert.equal(f.tier, 2);
      assert.equal(f.severity, 'fail');
      assert.ok(f.path);
      assert.ok(f.message && f.message.length > 10);
    }
  }
});
