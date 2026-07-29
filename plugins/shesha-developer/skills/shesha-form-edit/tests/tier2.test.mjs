import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(
  join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const ARCHETYPE_DIR = join(ROOT, 'assets/archetypes');
const FIXTURES_DIR = join(ROOT, 'tests/fixtures');

const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const ctx = { registry, roles, flows: {} };
const codes = (m, extra) => tier2(m, { ...ctx, ...extra }).map((f) => f.code);
const ID = () => crypto.randomUUID();

// Every fixture whose name contains "clean" (t1-clean, t2-clean,
// t3-bad-score-clean, ...) claims to be free of Tier 1/Tier 2 findings —
// each was historically authored to be clean for only ITS OWN tier, which
// is a trap for anyone later writing a cross-tier test (see the task-4b
// report: a previous agent hit exactly this and had to build a third
// "genuinely clean" fixture, t3-cli-clean.json, just to get a real exit-0
// CLI proof). t1-clean.json and t2-clean.json were corrected to be clean
// across BOTH tiers, making t3-cli-clean.json redundant (deleted; see
// tests/validate-cli.test.mjs). This test guards against the trap
// recurring for any current or future "*clean*" fixture.
function cleanFixtureFiles() {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json') && name.includes('clean'))
    .map((name) => join(FIXTURES_DIR, name));
}

function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('every *-clean fixture is clean against BOTH tier1 and tier2', () => {
  for (const file of cleanFixtureFiles()) {
    const m = load(file);
    assert.deepEqual(tier1(m, { registry }), [], `${file} has tier1 findings`);
    const t2 = tier2(m, ctx).filter((f) => f.code !== 'T2-SKIPPED');
    assert.deepEqual(t2, [], `${file} has tier2 findings`);
  }
});

// --- Brief's representative assertions (verbatim) ---

test('flags a bare input as a flex-row child', () => {
  // dimensions.width on a bare input lands inside the antd Form.Item chain,
  // which is forced width:100% !important — two such fields do NOT split 50/50.
  // A PROPORTIONAL width ("50%") is T2-SPLIT-WIDTH-ON-LEAF's exclusive
  // territory (task 8) — T2-WIDTH-ON-NONCONTAINER was narrowed to exclude it.
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'row',
    components: [{ id: ID(), type: 'textField', parentId: 'p', version: 6,
      desktop: { dimensions: { width: '50%' } } }] }] };
  const c = tier2(m, ctx).map((f) => f.code);
  assert.ok(c.includes('T2-FLEXCHILD-NOT-CONTAINER'));
  assert.ok(c.includes('T2-SPLIT-WIDTH-ON-LEAF'));
  assert.ok(!c.includes('T2-WIDTH-ON-NONCONTAINER'));
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

test('T2-STYLE-OFF-TOKEN: does not flag a color covered by an overrides[] source+evidence entry', () => {
  // Reconciled in task 7: this check now reads the blueprint schema's
  // overrides[] = {prop, value, source, evidence} shape, not the legacy
  // styleOverrides[path] object (see tier2.mjs's checkStyleOffToken comment).
  const m = fx('t2-style-off-token');
  m.components[0].overrides = [
    { prop: 'desktop.background.color', value: '#f4f8ff', source: 'brand guideline v3', evidence: 'design-system review 2026-07-01' },
  ];
  assert.ok(!codes(m).includes('T2-STYLE-OFF-TOKEN'));
});

test('T2-STYLE-OFF-TOKEN: does not flag the framework-stamped default border/shadow/background colors', () => {
  // Corrected in Task 5: #d9d9d9 (border), #000/#000000 (shadow) and
  // #ffffff (background) are values the framework's own style migrator
  // stamps on every component load (containerComponent.tsx's v7 migrator,
  // _common-migrations/migrateStyles.ts) — never a deliberate brand choice,
  // so no overrides[] provenance should be demanded for them.
  const m = {
    components: [{
      id: crypto.randomUUID(), type: 'container', parentId: 'root', version: 7,
      desktop: {
        border: { border: { all: { color: '#d9d9d9' } } },
        background: { color: '#ffffff' },
        shadow: { color: '#000000' },
      },
    }],
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

test('T2-PROPERTYNAME-CASE: does NOT flag a dotted nested-entity propertyName whose segments are each camelCase', () => {
  // "usedModule.name" / "baseProject.status" is the sanctioned Shesha
  // convention for reaching a related entity's property — present in this
  // skill's own bundled seeds (rs-detail-with-header.json, rs-table.json).
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'baseProject.name', parentId: 'root', version: 6 }] };
  assert.ok(!codes(m).includes('T2-PROPERTYNAME-CASE'));
});

test('T2-PROPERTYNAME-CASE: still flags a dotted propertyName with a non-camelCase segment', () => {
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'BaseProject.name', parentId: 'root', version: 6 }] };
  assert.ok(codes(m).includes('T2-PROPERTYNAME-CASE'));
});

test('T2-DROPDOWN-SOURCE: flags a dropdown with no dataSourceType', () => {
  assert.ok(codes(fx('t2-dropdown-source')).includes('T2-DROPDOWN-SOURCE'));
});

test('T2-DROPDOWN-SOURCE: does NOT flag entitiesList entityType given as a bare class-name string', () => {
  // entityPicker's `entityType` is typed `string | IEntityTypeIdentifier` and
  // normalized via the same isEntityTypeIdentifier/getEntityTypeIdentifier
  // path as formSettings.modelType — both shapes resolve identically.
  const m = { components: [{ id: ID(), type: 'autocomplete', parentId: 'root', version: 6,
    dataSourceType: 'entitiesList', entityType: 'Shesha.Domain.Person' }] };
  assert.ok(!codes(m).includes('T2-DROPDOWN-SOURCE'));
});

test('T2-DATE-COMPONENT: flags a "birthDate" property on a textField', () => {
  assert.ok(codes(fx('t2-date-component')).includes('T2-DATE-COMPONENT'));
});

test('T2-DATE-COMPONENT: does not flag "candidate" (no word-boundary "date")', () => {
  const m = { components: [{ id: ID(), type: 'textField', propertyName: 'candidate', parentId: 'root', version: 6 }] };
  assert.ok(!codes(m).includes('T2-DATE-COMPONENT'));
});

test('T2-MODELTYPE-SHAPE: flags a missing modelType', () => {
  assert.ok(codes(fx('t2-modeltype-shape')).includes('T2-MODELTYPE-SHAPE'));
});

test('T2-MODELTYPE-SHAPE: does NOT flag a bare full-class-name string', () => {
  // Both { name, module } and a bare string resolve identically at runtime
  // (isEntityTypeIdentifier/getEntityTypeIdentifier normalize either shape) —
  // 90/100 real production forms use the string form. Only a genuinely
  // absent/empty/malformed modelType is a defect.
  const m = { formSettings: { modelType: 'Shesha.Domain.Person' }, components: [] };
  assert.ok(!codes(m).includes('T2-MODELTYPE-SHAPE'));
});

test('T2-EDITMODE-MISMATCH: flags "inherited" on an interactive field with no detail lifecycle', () => {
  const found = tier2(fx('t2-editmode-mismatch'), ctx).find((f) => f.code === 'T2-EDITMODE-MISMATCH');
  assert.ok(found);
  assert.equal(found.expected, 'editMode: "editable"');
});

test('T2-EDITMODE-MISMATCH: does NOT flag editMode "readOnly" on either form type', () => {
  // references/components/edit-mode.md documents 'readOnly' as a third,
  // always-wins state (a deliberate permanent read-only field, e.g. a
  // computed/audit value) distinct from the editable/inherited pair this
  // check is meant to police — it is legitimate regardless of whether a
  // detail lifecycle is present.
  const noDetailForm = { components: [{ id: ID(), type: 'textField', propertyName: 'createdBy', parentId: 'root', version: 6, editMode: 'readOnly' }] };
  assert.ok(!codes(noDetailForm).includes('T2-EDITMODE-MISMATCH'));

  const detailForm = {
    components: [
      { id: ID(), type: 'textField', propertyName: 'createdBy', parentId: 'root', version: 6, editMode: 'readOnly' },
      { id: ID(), type: 'buttonGroup', parentId: 'root', version: 15, items: [
        { id: ID(), itemType: 'item', itemSubType: 'button', label: 'Edit',
          actionConfiguration: { actionOwner: 'shesha.form', actionName: 'Start Edit' } },
      ] },
    ],
  };
  assert.ok(!codes(detailForm).includes('T2-EDITMODE-MISMATCH'));
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
  assert.match(found.message, /entityType/);
});

test('T2-DATACONTEXT-PROPS: does NOT require uniqueStateId', () => {
  // uniqueStateId was never a property of the dataContext component
  // (IDataContextComponentProps has no such field) — it's a legacy property
  // of unrelated components (table/dataSource/entityPicker/...), tolerantly
  // migrated to `name` there. Every other required prop present + no
  // uniqueStateId must be clean.
  const m = { components: [{ id: ID(), type: 'dataContext', propertyName: 'ctx', parentId: 'root', version: 8,
    entityType: 'Shesha.Domain.Person', sourceType: 'Entity', dataFetchingMode: 'paging', defaultPageSize: 10 }] };
  assert.ok(!codes(m).includes('T2-DATACONTEXT-PROPS'));
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

// --- Task 8: forensic-analysis checks (derived from real flight-*/asset-*
// pushed markup — see docs/corpus-report.md's task-8 section) ---

test('T2-SPLIT-WIDTH-ON-LEAF: flags a proportional width on a bare flex-row child (flight-details rowService/flightNumber pattern)', () => {
  const found = tier2(fx('t2-split-width-on-leaf'), ctx).filter((f) => f.code === 'T2-SPLIT-WIDTH-ON-LEAF');
  assert.equal(found.length, 4); // flightNumber + airline, each flagged on BOTH desktop and tablet
});

test('T2-SPLIT-WIDTH-ON-LEAF: does NOT flag a fixed px width on a leaf (the benign "190px toolbar filter" case)', () => {
  assert.ok(!codes(fx('t2-width-on-noncontainer')).includes('T2-SPLIT-WIDTH-ON-LEAF'));
});

test('T2-SPLIT-WIDTH-ON-LEAF: does NOT flag a container that legitimately carries a proportional width', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'row',
    desktop: { dimensions: { width: 'calc(50% - 6px)' } },
    components: [] }] };
  assert.ok(!codes(m).includes('T2-SPLIT-WIDTH-ON-LEAF'));
});

test('T2-SPLIT-WIDTH-ON-LEAF and T2-WIDTH-ON-NONCONTAINER never both fire on the same node (scoped apart, not overlapping)', () => {
  const found = tier2(fx('t2-split-width-on-leaf'), ctx);
  const paths = new Set(found.filter((f) => f.code === 'T2-WIDTH-ON-NONCONTAINER').map((f) => f.path));
  const splitPaths = new Set(found.filter((f) => f.code === 'T2-SPLIT-WIDTH-ON-LEAF').map((f) => f.path));
  for (const p of splitPaths) assert.ok(!paths.has(p), `${p} double-reported under both codes`);
});

test('T2-SLOT-STYLE-MISMATCH: flags a card whose content slot has no style while the card itself does (flight-details statusPanel)', () => {
  const found = tier2(fx('t2-slot-style-mismatch'), ctx).find((f) => f.code === 'T2-SLOT-STYLE-MISMATCH');
  assert.ok(found);
  assert.equal(found.path, 'components[0].content');
});

test('T2-SLOT-STYLE-MISMATCH: does NOT flag a slot with fewer than 2 children (nothing to collide)', () => {
  const m = { components: [{ id: ID(), type: 'card', parentId: 'root', version: 3,
    desktop: { display: 'flex', flexDirection: 'column', gap: 16 },
    header: { id: ID(), components: [{ id: ID(), type: 'text', parentId: 'p', version: 5, content: 'Title' }] },
    content: { id: ID(), components: [] } }] };
  assert.ok(!codes(m).includes('T2-SLOT-STYLE-MISMATCH'));
});

test('T2-ROWLIST-NO-VGAP: flags a tab pane hosting 2+ row-containers with no vertical gap (flight-details service tab)', () => {
  const found = tier2(fx('t2-rowlist-no-vgap'), ctx).find((f) => f.code === 'T2-ROWLIST-NO-VGAP');
  assert.ok(found);
  assert.equal(found.path, 'components[0].tabs[0]');
});

test('T2-ROWLIST-NO-VGAP: flags a plain container hosting 2+ row-containers with no vertical gap', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'column', desktop: { display: 'flex', flexDirection: 'column' },
    components: [
      { id: ID(), type: 'container', parentId: 'p', version: 7, display: 'flex', flexDirection: 'row',
        desktop: { display: 'flex', flexDirection: 'row', gap: 12 }, components: [] },
      { id: ID(), type: 'container', parentId: 'p', version: 7, display: 'flex', flexDirection: 'row',
        desktop: { display: 'flex', flexDirection: 'row', gap: 12 }, components: [] },
    ] }] };
  assert.ok(codes(m).includes('T2-ROWLIST-NO-VGAP'));
});

test('T2-ROWLIST-NO-VGAP: does NOT flag when the host already declares a positive vertical gap', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'column', gap: 16, desktop: { display: 'flex', flexDirection: 'column', gap: 16 },
    components: [
      { id: ID(), type: 'container', parentId: 'p', version: 7, display: 'flex', flexDirection: 'row',
        desktop: { display: 'flex', flexDirection: 'row', gap: 12 }, components: [] },
      { id: ID(), type: 'container', parentId: 'p', version: 7, display: 'flex', flexDirection: 'row',
        desktop: { display: 'flex', flexDirection: 'row', gap: 12 }, components: [] },
    ] }] };
  assert.ok(!codes(m).includes('T2-ROWLIST-NO-VGAP'));
});

test('T2-CODEMODE-TITLE: flags a text node whose content._mode:"code" string-concatenates data fields (flight-details heading)', () => {
  const found = tier2(fx('t2-codemode-title'), ctx).find((f) => f.code === 'T2-CODEMODE-TITLE');
  assert.ok(found);
  assert.match(found.message, /flightNumber/);
});

test('T2-CODEMODE-TITLE: does NOT flag a plain mustache/string content, or code with no data-field concatenation', () => {
  const m = { components: [
    { id: ID(), type: 'text', parentId: 'root', version: 5, content: '{{data.flightNumber}} · {{data.airline}}' },
    { id: ID(), type: 'text', parentId: 'root', version: 5, content: { _mode: 'code', _code: "return form.formMode === 'edit';" } },
  ] };
  assert.ok(!codes(m).includes('T2-CODEMODE-TITLE'));
});

test('T2-DUPLICATE-CAPTION: flags a text node duplicating a hideLabel sibling\'s label (asset-detail railStatusPanel)', () => {
  const found = tier2(fx('t2-duplicate-caption'), ctx).find((f) => f.code === 'T2-DUPLICATE-CAPTION');
  assert.ok(found);
  assert.match(found.message, /On active register/);
});

test('T2-DUPLICATE-CAPTION: does NOT flag a caption whose sibling shows its OWN visible label (hideLabel false)', () => {
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, components: [
    { id: ID(), type: 'text', parentId: 'p', version: 5, content: 'On active register' },
    { id: ID(), type: 'checkbox', parentId: 'p', version: 5, propertyName: 'isActive', label: 'On active register', hideLabel: false },
  ] }] };
  assert.ok(!codes(m).includes('T2-DUPLICATE-CAPTION'));
});

test('T2-LABELCOL-VS-NARROW-ROW: flags horizontal layout + labelCol.span with an input inside a sub-50%-width container (asset-detail)', () => {
  const found = tier2(fx('t2-labelcol-vs-narrow-row'), ctx).find((f) => f.code === 'T2-LABELCOL-VS-NARROW-ROW');
  assert.ok(found);
});

test('T2-LABELCOL-VS-NARROW-ROW: does NOT flag vertical layout regardless of narrow containers (the flight-* forms\' own pattern)', () => {
  const m = {
    formSettings: { layout: 'vertical' },
    components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
      desktop: { dimensions: { width: 'calc(50% - 6px)' } },
      components: [{ id: ID(), type: 'textField', parentId: 'p', version: 6, propertyName: 'flightNumber' }] }],
  };
  assert.ok(!codes(m).includes('T2-LABELCOL-VS-NARROW-ROW'));
});

test('T2-LABELCOL-VS-NARROW-ROW: does NOT flag horizontal layout with no narrow container', () => {
  const m = {
    formSettings: { layout: 'horizontal', labelCol: { span: 6 }, wrapperCol: { span: 18 } },
    components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
      desktop: { dimensions: { width: '100%' } },
      components: [{ id: ID(), type: 'textField', parentId: 'p', version: 6, propertyName: 'assetName' }] }],
  };
  assert.ok(!codes(m).includes('T2-LABELCOL-VS-NARROW-ROW'));
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
    't2-split-width-on-leaf', 't2-slot-style-mismatch', 't2-rowlist-no-vgap',
    't2-codemode-title', 't2-duplicate-caption', 't2-labelcol-vs-narrow-row',
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
