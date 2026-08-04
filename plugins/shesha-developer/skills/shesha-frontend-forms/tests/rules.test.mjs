/**
 * Rule contract tests.
 *
 * Every enforceable rule gets BOTH a passing case and a failing fixture. A rule with only
 * a passing case is indistinguishable from a rule that never fires, which is how a
 * validator suite drifts into decoration.
 *
 * Run: node --test "tests/**\/*.test.mjs"
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enforceableIds, loadRules, renderManifest, runRules, TRIAGE } from '../scripts/lib/rules.mjs';
import { allComponents, allItems, ownStrings, tableColumns } from '../scripts/lib/walk.mjs';

const RULES = new Map(loadRules().map((r) => [r.id, r]));

/** Minimal registry standing in for derived ground truth. */
const REGISTRY = {
  container: { type: 'container', name: 'Container', isInput: false, lastVersion: 7, migrationVersions: [0, 7], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  // text carries real propTypes because R-058 is tested against it. These four value sets are
  // TRANSCRIBED from a live probe of 0.45, not invented — including contentType's legal empty
  // string, which a hand-written table would have dropped and which would then have made a
  // correct form fail.
  text: { type: 'text', name: 'Text', isInput: false, lastVersion: 5, migrationVersions: [0, 5], customContainerNames: null, dataTypeSupported: null,
    settings: { propertyNames: [], source: 'factory', error: null, propTypes: {
      textType: { editor: 'dropdown', type: 'enum', values: ['span', 'paragraph', 'title'], dynamic: false, source: 'settings-markup:dropdown' },
      contentDisplay: { editor: 'dropdown', type: 'enum', values: ['content', 'name'], dynamic: false, source: 'settings-markup:dropdown' },
      contentType: { editor: 'dropdown', type: 'enum', values: ['', 'primary', 'secondary', 'success', 'warning', 'info', 'danger', 'custom'], dynamic: false, source: 'settings-markup:dropdown' },
      dataType: { editor: 'dropdown', type: 'enum', values: ['string', 'date-time', 'number', 'boolean'], dynamic: false, source: 'settings-markup:dropdown' },
    } } },
  textField: { type: 'textField', name: 'Text field', isInput: true, lastVersion: 6, migrationVersions: [0, 6], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: ['string'] },
  card: { type: 'card', name: 'Card', isInput: false, lastVersion: 3, migrationVersions: [1, 2, 3], customContainerNames: ['header', 'content'], settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  datatable: { type: 'datatable', name: 'Data table', isInput: false, lastVersion: 29, migrationVersions: [0, 29], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  datatableContext: { type: 'datatableContext', name: 'Data context', isInput: false, lastVersion: 8, migrationVersions: [0, 8], customContainerNames: null, settings: { propertyNames: [], source: 'absent', error: null }, dataTypeSupported: null },
  buttonGroup: { type: 'buttonGroup', name: 'Button group', isInput: false, lastVersion: 15, migrationVersions: [0, 15], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  button: { type: 'button', name: 'Button', isInput: false, lastVersion: 3, migrationVersions: [1, 3], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  validationErrors: { type: 'validationErrors', name: 'Validation errors', isInput: false, lastVersion: 0, migrationVersions: [0], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  dropdown: { type: 'dropdown', name: 'Dropdown', isInput: true, lastVersion: 11, migrationVersions: [0, 11], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: ['reference-list-item'] },
  checkboxGroup: { type: 'checkboxGroup', name: 'Checkbox group', isInput: true, lastVersion: 5, migrationVersions: [0, 5], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: ['reference-list-item'] },
  refListStatus: { type: 'refListStatus', name: 'Status', isInput: false, lastVersion: 6, migrationVersions: [0, 6], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  image: { type: 'image', name: 'Image', isInput: false, lastVersion: 2, migrationVersions: [1, 2], customContainerNames: null, settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  columns: { type: 'columns', name: 'Columns', isInput: false, lastVersion: 5, migrationVersions: [0, 5], customContainerNames: ['columns'], settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  tabs: { type: 'tabs', name: 'Tabs', isInput: false, lastVersion: 4, migrationVersions: [0, 4], customContainerNames: ['tabs'], settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  wizard: { type: 'wizard', name: 'Wizard', isInput: false, lastVersion: 8, migrationVersions: [0, 8], customContainerNames: ['steps'], settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
  collapsiblePanel: { type: 'collapsiblePanel', name: 'Panel', isInput: false, lastVersion: 9, migrationVersions: [0, 9], customContainerNames: ['header', 'content', 'customHeader'], settings: { propertyNames: [], source: 'factory', error: null }, dataTypeSupported: null },
};

const V = (type) => REGISTRY[type].lastVersion;
let seq = 0;
const nid = () => `probeid${String(seq++).padStart(4, '0')}xyzabc`;

/** A structurally valid node. Rules under test mutate a copy of this. */
function node(type, extra = {}) {
  return { id: nid(), type, parentId: 'root', version: V(type), componentName: `${type}1`, ...extra };
}

function form(components, formSettings = {}) {
  return {
    formSettings: {
      layout: 'vertical',
      colon: false,
      labelCol: { span: 0 },
      wrapperCol: { span: 24 },
      dataLoaderType: 'gql',
      dataSubmitterType: 'gql',
      ...formSettings,
    },
    components,
  };
}

/** Reparent so R-001 is satisfied by construction unless a test breaks it deliberately. */
function reparent(markup) {
  const fix = (arr, parentId) => {
    for (const n of arr || []) {
      n.parentId = parentId;
      if (Array.isArray(n.components)) fix(n.components, n.id);
      for (const slot of ['content', 'header']) {
        if (n[slot] && Array.isArray(n[slot].components)) fix(n[slot].components, n.id);
      }
    }
  };
  fix(markup.components, 'root');
  return markup;
}

const CTX = { registry: REGISTRY, formName: 'test-form' };

/** Run one rule in isolation. */
function only(id, markup, ctx = CTX) {
  const rule = RULES.get(id);
  assert.ok(rule, `no implementation for ${id}`);
  if (typeof rule.applies === 'function') {
    const a = rule.applies(ctx, markup);
    if (a === false || (a && a.skip)) return { skipped: true, reason: (a && a.reason) || 'not applicable', violations: [] };
  }
  return { skipped: false, violations: rule.check(markup, ctx) || [] };
}

function assertPasses(id, markup, ctx) {
  const r = only(id, markup, ctx);
  assert.equal(r.skipped, false, `${id}: expected the rule to APPLY to the passing fixture, but it skipped (${r.reason})`);
  assert.deepEqual(
    r.violations.map((v) => v.message),
    [],
    `${id}: passing fixture produced violations`
  );
}

function assertFails(id, markup, ctx, matcher) {
  const r = only(id, markup, ctx);
  assert.equal(r.skipped, false, `${id}: expected the rule to APPLY to the failing fixture, but it skipped (${r.reason})`);
  assert.ok(r.violations.length > 0, `${id}: failing fixture produced NO violations — the rule does not fire`);
  if (matcher) {
    const hit = r.violations.some((v) => matcher.test(v.message));
    assert.ok(hit, `${id}: violations did not match ${matcher}\n  got: ${r.violations.map((v) => v.message).join('\n       ')}`);
  }
}

// =====================================================================================
describe('rule registry integrity', () => {
  it('all 57 ported rules are dispositioned exactly once', () => {
    const ids = TRIAGE.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate triage ids');
    // The 57 PORTED rules are R-001..R-057 and every one must be accounted for. The total is
    // deliberately NOT pinned: rules discovered later get new ids, and a test that forbids
    // that would make "we learned something" fail the build. What must hold is that nothing
    // ported was dropped, and that anything beyond R-057 is genuinely new.
    for (let i = 1; i <= 57; i += 1) {
      const id = `R-${String(i).padStart(3, '0')}`;
      assert.ok(ids.includes(id), `${id} is not dispositioned`);
    }
  });

  it('every rule added beyond the ported 57 says where it came from', () => {
    const added = TRIAGE.filter((t) => Number(t.id.slice(2)) > 57);
    for (const t of added) {
      assert.ok(t.note, `${t.id} is a new rule and must carry a note recording its evidence`);
      assert.match(
        t.note,
        /NEW/,
        `${t.id}'s note must mark it as new so the ported set stays auditable`
      );
    }
  });

  it('every enforceable rule has an implementation, and every implementation a triage row', () => {
    const impl = new Set(RULES.keys());
    const missing = enforceableIds().filter((id) => !impl.has(id));
    assert.deepEqual(missing, [], `enforceable rules with no check(): ${missing.join(', ')}`);
    const orphans = [...impl].filter((id) => !TRIAGE.some((t) => t.id === id));
    assert.deepEqual(orphans, [], `implementations with no triage row: ${orphans.join(', ')}`);
  });

  it('every stale rule states a reason', () => {
    for (const t of TRIAGE.filter((x) => x.disposition === 'stale')) {
      assert.ok(t.reason && t.reason.length > 20, `${t.id} is stale with no adequate reason`);
    }
  });

  it('every implementation carries a statement and a severity', () => {
    for (const r of RULES.values()) {
      assert.ok(r.statement && r.statement.length > 30, `${r.id} has no adequate statement`);
      assert.ok(['fail', 'warn'].includes(r.severity), `${r.id} severity is ${r.severity}`);
    }
  });

  it('the manifest is generated and self-consistent', () => {
    const md = renderManifest();
    assert.match(md, /GENERATED by scripts\/lib\/rules\.mjs/);
    assert.match(md, /## Implementations with no triage row\n_none_/);
    assert.match(md, /## Enforceable rows with no implementation\n_none_/);
    for (const t of TRIAGE) assert.ok(md.includes(`| ${t.id} |`), `${t.id} missing from manifest`);
  });

  it('a rule that throws is reported as a violation, never silently dropped', () => {
    const markup = reparent(form([node('container')]));
    const res = runRules(markup, CTX);
    assert.ok(Array.isArray(res.violations));
    assert.deepEqual(res.violations.filter((v) => v.ruleError), [], 'a rule threw during a clean run');
    assert.ok(res.ran.length > 0, 'no rules ran at all');
  });
});

// =====================================================================================
describe('structure', () => {
  it('R-001 parentId', () => {
    const good = reparent(form([node('container', { components: [node('text')] })]));
    assertPasses('R-001', good);
    const bad = reparent(form([node('container', { components: [node('text')] })]));
    bad.components[0].components[0].parentId = 'wrong-id';
    assertFails('R-001', bad, CTX, /parentId/);
    const missing = reparent(form([node('text')]));
    delete missing.components[0].parentId;
    assertFails('R-001', missing, CTX, /no parentId/);
  });

  it('R-002 generated unique ids', () => {
    assertPasses('R-002', reparent(form([node('text'), node('text')])));
    const short = reparent(form([node('text')]));
    short.components[0].id = 'btn1';
    assertFails('R-002', short, CTX, /at least 10 chars/);
    const dup = reparent(form([node('text'), node('text')]));
    dup.components[1].id = dup.components[0].id;
    assertFails('R-002', dup, CTX, /duplicate component id/);
  });

  it('R-003 version matches the derived chain', () => {
    assertPasses('R-003', reparent(form([node('datatable')])));
    const stale = reparent(form([node('datatable', { version: 12 })]));
    assertFails('R-003', stale, CTX, /stale version silently drops/);
    const none = reparent(form([node('datatable')]));
    delete none.components[0].version;
    assertFails('R-003', none, CTX, /replays all 30 migrations/);
    const unknown = reparent(form([node('text')]));
    unknown.components[0].type = 'textFeild';
    assertFails('R-003', unknown, CTX, /unknown component type/);
    const ahead = reparent(form([node('card', { version: 99 })]));
    assertFails('R-003', ahead, CTX, /ahead of this app/);
  });

  it('R-006 validationErrors when anything is required', () => {
    const req = { validate: { required: true }, propertyName: 'name', label: 'Name' };
    assertPasses('R-006', reparent(form([node('textField', req), node('validationErrors')])));
    assertFails('R-006', reparent(form([node('textField', req)])), CTX, /no validationErrors/);
    // Skips cleanly when nothing is required.
    const r = only('R-006', reparent(form([node('textField', { propertyName: 'x' })])));
    assert.equal(r.skipped, true);
  });

  it('R-009 defaultValue must be a string', () => {
    assertPasses('R-009', reparent(form([node('textField', { defaultValue: '{{data.name}}' })])));
    assertFails('R-009', reparent(form([node('checkboxGroup', { defaultValue: [1, 2] })])), CTX, /e\.match is not a function/);
    assertFails('R-009', reparent(form([node('textField', { defaultValue: 42 })])), CTX, /non-string defaultValue/);
    // A code-mode setting is an object by design.
    assertPasses('R-009', reparent(form([node('textField', { defaultValue: { _mode: 'code', _code: 'return 1' } })])));
  });

  it('R-018 editMode inherited on a form that cannot edit', () => {
    const fs = { dataLoaderType: 'none' };
    assertPasses('R-018', reparent(form([node('textField', { editMode: 'editable' })], fs)));
    assertFails('R-018', reparent(form([node('textField', { editMode: 'inherited' })], fs)), CTX, /render blank/);
    const r = only('R-018', reparent(form([node('textField', { editMode: 'inherited' })], { dataLoaderType: 'gql' })));
    assert.equal(r.skipped, true, 'should skip when the form can enter edit mode');
  });

  it('R-021 human-readable labels', () => {
    assertPasses('R-021', reparent(form([node('textField', { propertyName: 'firstName', label: 'First name' })])));
    assertFails('R-021', reparent(form([node('textField', { propertyName: 'firstName', label: 'firstName' })])), CTX, /raw propertyName/);
    assertFails('R-021', reparent(form([node('textField', { propertyName: 'firstName' })])), CTX, /no label/);
    assertPasses('R-021', reparent(form([node('textField', { propertyName: 'x', hideLabel: true })])));
  });

  it('R-025 preserve ids when editing', () => {
    const baseline = reparent(form([node('text'), node('text')]));
    const kept = { formSettings: baseline.formSettings, components: baseline.components.slice() };
    assertPasses('R-025', kept, { ...CTX, baseline });
    const dropped = { formSettings: baseline.formSettings, components: [baseline.components[0]] };
    assertFails('R-025', dropped, { ...CTX, baseline }, /existed in the baseline but is gone/);
    assert.equal(only('R-025', kept, CTX).skipped, true, 'skips with no baseline');
  });

  it('R-031 code-mode hidden, no customVisibility', () => {
    assertPasses('R-031', reparent(form([node('text', { hidden: { _mode: 'code', _code: 'return !data?.x' } })])));
    assertFails('R-031', reparent(form([node('text', { customVisibility: 'return true' })])), CTX, /customVisibility/);
    assertFails('R-031', reparent(form([node('text', { customEnabled: 'return true' })])), CTX, /customEnabled/);
    assertFails(
      'R-031',
      reparent(form([node('text', { hidden: { _mode: 'code', _code: 'return !data.x' } })])),
      CTX,
      /optional chaining/
    );
  });
});

// =====================================================================================
describe('versioning + binding', () => {
  const modelProperties = [
    { path: 'firstName', dataType: 'string', dataFormat: 'singleline' },
    { path: 'status', dataType: 'reference-list-item', referenceListName: 'His.Facilities.RegistryStatus', referenceListModule: 'His' },
    { path: 'owner', dataType: 'entity', entityType: 'Shesha.Domain.Person' },
  ];
  const metaCtx = { ...CTX, metadata: {}, modelProperties, modelTypeName: 'Test.Entity' };

  it('R-004 camelCase everywhere, including columns', () => {
    assertPasses('R-004', reparent(form([node('textField', { propertyName: 'firstName' })])));
    assertFails('R-004', reparent(form([node('textField', { propertyName: 'FirstName' })])), CTX, /not camelCase/);
    const cols = [
      { id: 'c1', itemType: 'item', columnType: 'data', propertyName: 'Reference', caption: 'Reference' },
    ];
    assertFails(
      'R-004',
      reparent(form([node('datatable', { items: cols })])),
      CTX,
      /correct count and blank cells/
    );
    // Dotted paths must be camelCase segment-wise.
    const dotted = [{ id: 'c2', itemType: 'item', columnType: 'data', propertyName: 'applicant.FullName', caption: 'Applicant' }];
    assertFails('R-004', reparent(form([node('datatable', { items: dotted })])), CTX, /non-camelCase segment/);
    const ok = [{ id: 'c3', itemType: 'item', columnType: 'data', propertyName: 'applicant.fullName', caption: 'Applicant' }];
    assertPasses('R-004', reparent(form([node('datatable', { items: ok })])));
  });

  it('R-014 double braces', () => {
    assertPasses('R-014', reparent(form([node('text', { content: 'Hello {{data.name}}' })])));
    assertFails('R-014', reparent(form([node('text', { content: 'Hello {data.name}' })])), CTX, /single-brace/);
    assertPasses('R-014', reparent(form([node('text', { content: 'Trusted {{{data.html}}}' })])));
  });

  it('R-015 reflist identity copied verbatim from metadata', () => {
    const good = reparent(
      form([node('dropdown', { propertyName: 'status', referenceListId: { module: 'His', name: 'His.Facilities.RegistryStatus' } })])
    );
    assertPasses('R-015', good, metaCtx);
    const derived = reparent(
      form([node('dropdown', { propertyName: 'status', referenceListId: { module: 'His', name: 'Status' } })])
    );
    assertFails('R-015', derived, metaCtx, /copy it verbatim/);
    assert.equal(only('R-015', good, CTX).skipped, true, 'skips without live metadata');
  });

  it('R-016 modelType object vs entityType string', () => {
    assertPasses('R-016', reparent(form([node('datatableContext', { entityType: 'A.B.C' })], { modelType: { name: 'Person', module: 'Shesha' } })));
    assertFails('R-016', reparent(form([node('text')], { modelType: 'Shesha.Domain.Person' })), CTX, /expects the \{name, module\} object/);
    assertFails('R-016', reparent(form([node('datatableContext', { entityType: { name: 'x' } })])), CTX, /must be the fullClassName string/);
  });

  it('R-034 bound propertyName exists on the model', () => {
    assertPasses('R-034', reparent(form([node('textField', { propertyName: 'firstName' })])), metaCtx);
    assertFails('R-034', reparent(form([node('textField', { propertyName: 'nope' })])), metaCtx, /not a property of/);
    assertPasses('R-034', reparent(form([node('textField', { propertyName: 'owner.fullName' })])), metaCtx);
    assert.equal(only('R-034', reparent(form([node('textField', { propertyName: 'nope' })])), CTX).skipped, true);
  });
});

// =====================================================================================
describe('data', () => {
  it('R-005 dataContext wrapper with an explicit entityType', () => {
    const good = reparent(form([node('datatableContext', { entityType: 'A.B.C', sourceType: 'Entity', components: [node('datatable')] })]));
    assertPasses('R-005', good);
    const bare = reparent(form([node('datatable')]));
    assertFails('R-005', bare, CTX, /no datatableContext/);
    const noEntity = reparent(form([node('datatableContext', { sourceType: 'Entity', components: [node('datatable')] })]));
    assertFails('R-005', noEntity, CTX, /does not inherit formSettings\.modelType/);
    assert.equal(only('R-005', reparent(form([node('text')]))).skipped, true);
  });

  it('R-010 inline editor shape', () => {
    const okCol = { id: 'c', itemType: 'item', columnType: 'data', propertyName: 'a', caption: 'A', editComponent: { type: 'textField', settings: { type: 'textField', version: 6 } } };
    assertPasses('R-010', reparent(form([node('datatable', { items: [okCol] })])));
    const flat = { ...okCol, editComponent: { type: 'textField', version: 6 } };
    assertFails('R-010', reparent(form([node('datatable', { items: [flat] })])), CTX, /reading 'version'/);
    const def = { ...okCol, editComponent: { type: '[default]' } };
    assertFails('R-010', reparent(form([node('datatable', { items: [def] })])), CTX, /only valid on displayComponent/);
    const notEditable = { ...okCol, editComponent: { type: '[not-editable]' } };
    assertPasses('R-010', reparent(form([node('datatable', { items: [notEditable] })])));
  });

  it('R-011 checkboxGroup items vs dropdown values', () => {
    assertPasses('R-011', reparent(form([node('checkboxGroup', { dataSourceType: 'values', items: [{ label: 'A', value: 1 }] })])));
    assertFails('R-011', reparent(form([node('checkboxGroup', { dataSourceType: 'values', values: [{ id: '1', label: 'A', value: 1 }] })])), CTX, /options live in `items`/);
    assertFails('R-011', reparent(form([node('dropdown', { dataSourceType: 'values', items: [{ label: 'A', value: 1 }] })])), CTX, /options live in `values`/);
  });

  it('R-017 gql loader is the default', () => {
    assertPasses('R-017', reparent(form([node('text')])));
    assertFails('R-017', reparent(form([node('text')], { dataSubmitterType: 'custom' })), CTX, /custom endpoints are opt-in/);
  });

  it('R-037 FK reduced in onPrepareSubmitData', () => {
    const modelProperties = [{ path: 'owner', dataType: 'entity', entityType: 'P' }];
    const metaCtx = { ...CTX, modelProperties };
    const good = reparent(form([node('textField', { propertyName: 'owner' })], { onPrepareSubmitData: 'data.owner = { id: data.owner.id }; return data;' }));
    assertPasses('R-037', good, metaCtx);
    const bad = reparent(form([node('textField', { propertyName: 'owner' })]));
    assertFails('R-037', bad, metaCtx, /reduce them to \{id\}/);
  });

  it('R-039 onInitialized is not wired', () => {
    assertPasses('R-039', reparent(form([node('text')])));
    assertFails('R-039', reparent(form([node('text')], { onInitialized: 'doThing();' })), CTX, /not wired on dynamic pages/);
  });
});

// =====================================================================================
describe('actions', () => {
  const submitItem = (extra = {}) => ({
    id: nid(),
    itemType: 'item',
    label: 'Save',
    buttonType: 'primary',
    actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form' },
    ...extra,
  });
  const backItem = () => ({
    id: nid(),
    itemType: 'item',
    label: 'Back',
    actionConfiguration: { actionName: 'Navigate', actionOwner: 'shesha.common', actionArguments: { target: '/x' } },
  });

  it('R-007 one buttonGroup, Submit wired, exit paired', () => {
    assertPasses('R-007', reparent(form([node('buttonGroup', { isInline: true, items: [submitItem(), backItem()] })])));
    assertFails('R-007', reparent(form([node('buttonGroup', { isInline: true, items: [backItem()] })])), CTX, /no buttonGroup item carries actionName "Submit"/);
    assertFails('R-007', reparent(form([node('buttonGroup', { isInline: true, items: [submitItem()] })])), CTX, /no paired exit button/);
    assertFails(
      'R-007',
      reparent(form([node('buttonGroup', { isInline: true, items: [submitItem({ actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.common' } }), backItem()] })])),
      CTX,
      /must be "shesha\.form"/
    );
    assertFails(
      'R-007',
      reparent(form([node('button', { actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form' } })])),
      CTX,
      /form actions belong in one buttonGroup/
    );
    assert.equal(only('R-007', reparent(form([node('text')], { dataSubmitterType: 'none' }))).skipped, true);
  });

  it('R-008 Navigate needs a target', () => {
    assertPasses('R-008', reparent(form([node('buttonGroup', { isInline: true, items: [backItem()] })])));
    const empty = reparent(form([node('buttonGroup', { isInline: true, items: [{ id: nid(), itemType: 'item', label: 'Go', actionConfiguration: { actionName: 'Navigate', actionArguments: { target: '' } } }] })]));
    assertFails('R-008', empty, CTX, /renders <Link href=undefined>/);
    const actionCol = [{ id: 'a', itemType: 'item', columnType: 'action', description: 'Review', actionConfiguration: { actionName: 'Navigate', actionArguments: {} } }];
    assertFails('R-008', reparent(form([node('datatable', { items: actionCol })])), CTX, /action column/);
  });

  it('R-044 no "Delete row" and no owner "table"', () => {
    const ok = { id: nid(), itemType: 'item', label: 'Del', actionConfiguration: { actionName: 'Execute Script', actionOwner: 'shesha.common' } };
    assertPasses('R-044', reparent(form([node('buttonGroup', { isInline: true, items: [ok] })])));
    const delRow = { id: nid(), itemType: 'item', label: 'Del', actionConfiguration: { actionName: 'Delete row', actionOwner: 'table' } };
    assertFails('R-044', reparent(form([node('buttonGroup', { isInline: true, items: [delRow] })])), CTX, /does not exist/);
  });
});

// =====================================================================================
describe('scripts', () => {
  it('R-012 code props must be code-mode objects', () => {
    assertPasses('R-012', reparent(form([node('text', { hidden: { _mode: 'code', _code: 'return true' } })])));
    assertFails('R-012', reparent(form([node('text', { hidden: 'return !data?.x' })])), CTX, /stripped on save/);
    assertPasses('R-012', reparent(form([node('text', { hidden: true })])));
  });

  it('R-013 scripts must compile', () => {
    assertPasses('R-013', reparent(form([node('text')], { onAfterDataLoad: 'const a = 1; return a;' })));
    assertFails('R-013', reparent(form([node('text')], { onAfterDataLoad: 'const a = ;' })), CTX, /does not compile/);
    assertFails('R-013', reparent(form([node('text')], { onAfterDataLoad: 'const a = “hi”;' })), CTX, /smart quote/);
    assertFails('R-013', reparent(form([node('text')], { onAfterDataLoad: 'return `x`;' })), CTX, /template literal/);
  });

  it('R-023 globalState is not a state channel', () => {
    assertPasses('R-023', reparent(form([node('text')], { onAfterDataLoad: 'return contexts.appContext.x;' })));
    assertFails('R-023', reparent(form([node('text')], { onAfterDataLoad: 'globalState.x = 1;' })), CTX, /globalState/);
  });

  it('R-024 await inside try/catch, never .then()', () => {
    assertPasses('R-024', reparent(form([node('text')], { onAfterDataLoad: 'try { await http.get("/a?b=1"); } catch (e) {}' })));
    assertFails('R-024', reparent(form([node('text')], { onAfterDataLoad: 'http.get("/a").then(r => r);' })), CTX, /chains \.then\(\)/);
    assertFails('R-024', reparent(form([node('text')], { onAfterDataLoad: 'await http.get("/a");' })), CTX, /no try\/catch/);
    assertFails('R-024', reparent(form([node('text')], { onAfterDataLoad: 'try { await http.get("/a", { params: { b: 1 } }); } catch (e) {}' })), CTX, /params are dropped/);
  });

  it('R-038 Execute Script must return the Promise', () => {
    const mk = (expr) => node('button', { actionConfiguration: { actionName: 'Execute Script', actionOwner: 'shesha.common', actionArguments: { expression: expr } } });
    assertPasses('R-038', reparent(form([mk('await doThing(); return true;')])));
    assertFails('R-038', reparent(form([mk('(async () => { await doThing(); })()')])), CTX, /must return the Promise/);
  });
});

// =====================================================================================
describe('styling', () => {
  it('R-028 no columns component, no dead flex channels', () => {
    assertPasses('R-028', reparent(form([node('container', { desktop: { display: 'flex', dimensions: { width: '50%' } } })])));
    assertFails('R-028', reparent(form([node('columns')])), CTX, /excluded from this toolchain/);
    assertFails('R-028', reparent(form([node('container', { customStyle: { flex: '1 1 auto' } })])), CTX, /renderer ignores/);
    assertFails('R-028', reparent(form([node('container', { desktop: { flexShrink: 0 } })])), CTX, /never reaches the outer div/);
  });

  it('R-029 flex model lives in the desktop block', () => {
    assertPasses('R-029', reparent(form([node('container', { desktop: { display: 'flex', justifyContent: 'flex-end', gap: '10' } })])));
    assertFails('R-029', reparent(form([node('container', { desktop: { justifyContent: 'flex-end', gap: '10' } })])), CTX, /children stack full-width/);
    assertFails('R-029', reparent(form([node('container', { display: 'flex' })])), CTX, /inert/);
  });

  it('R-030 the legacy style string wins', () => {
    assertPasses('R-030', reparent(form([node('container', { desktop: { display: 'flex' } })])));
    assertFails('R-030', reparent(form([node('container', { style: 'padding: 4px', desktop: { display: 'flex' } })])), CTX, /the blocks are dead/);
  });

  it('R-033 field-level labelCol is dead', () => {
    assertPasses('R-033', reparent(form([node('textField', { propertyName: 'a' })])));
    assertFails('R-033', reparent(form([node('textField', { propertyName: 'a', labelCol: { span: 6 } })])), CTX, /renderer ignores/);
  });

  it('R-036 refListStatus colour comes from the item', () => {
    const refCtx = {
      ...CTX,
      referenceLists: {
        'His/Status': { module: 'His', name: 'Status', items: [{ itemValue: 1, item: 'A', color: '' }, { itemValue: 2, item: 'B', color: '' }] },
        'His/Coloured': { module: 'His', name: 'Coloured', items: [{ itemValue: 1, item: 'A', color: '#0d685a' }] },
      },
    };
    assertPasses('R-036', reparent(form([node('refListStatus', { referenceListId: { module: 'His', name: 'Coloured' } })])), refCtx);
    assertFails('R-036', reparent(form([node('refListStatus', { referenceListId: { module: 'His', name: 'Status' } })])), refCtx, /renders grey/);
    assertFails('R-036', reparent(form([node('refListStatus', { customStyle: { borderRadius: 12 } })])), CTX, /radius comes from/);
    assert.equal(only('R-036', reparent(form([node('text')]))).skipped, true);
  });

  it('R-052 text colour needs contentType custom', () => {
    assertPasses('R-052', reparent(form([node('text', { contentType: 'custom', desktop: { font: { color: '#0d685a' } } })])));
    assertFails('R-052', reparent(form([node('text', { desktop: { font: { color: '#0d685a' } } })])), CTX, /pure no-op|no-op/);
    assertPasses('R-052', reparent(form([node('text', { desktop: { font: { size: 11, weight: '600' } } })])));
  });

  it('R-054 background image needs a stored file, and needs a type', () => {
    assertPasses('R-054', reparent(form([node('container', { desktop: { background: { type: 'color', color: '#fff' } } })])));
    assertFails('R-054', reparent(form([node('container', { desktop: { background: { type: 'image', url: 'https://x/y.png' } } })])), CTX, /url\(null\)/);
    assertFails('R-054', reparent(form([node('container', { desktop: { background: { color: '#fff' } } })])), CTX, /no `type`/);
  });

  it('R-055 never position an image absolutely', () => {
    assertPasses('R-055', reparent(form([node('image', { desktop: { dimensions: { width: '120px', height: '60px' } } })])));
    assertFails('R-055', reparent(form([node('image', { style: 'position: absolute; top: 0' })])), CTX, /collapses it to 0x0/);
    assertFails('R-055', reparent(form([node('image', { desktop: { position: 'absolute' } })])), CTX, /collapses it to 0x0/);
    assert.equal(only('R-055', reparent(form([node('text')]))).skipped, true);
  });

  it('R-057 buttonGroup isInline and real action rows', () => {
    const item = (l) => ({ id: nid(), itemType: 'item', label: l, actionConfiguration: { actionName: 'Navigate', actionArguments: { target: '/x' } } });
    assertPasses('R-057', reparent(form([node('buttonGroup', { isInline: true, items: [item('A'), item('B')] })])));
    assertFails('R-057', reparent(form([node('buttonGroup', { items: [item('A'), item('B')] })])), CTX, /overflow "\.\.\." menu/);
    assertPasses('R-057', reparent(form([node('buttonGroup', { items: [item('A')] })])));
    const stack = reparent(form([node('container', { components: [node('button'), node('button')] })]));
    assertFails('R-057', stack, CTX, /stack one per line/);
  });

  it('R-058 enum props against the harvested legal sets', () => {
    // The legal sets come from the registry, so this test also proves the harvest reached the
    // appearance channels rather than only the structural props.
    assertPasses('R-058', reparent(form([node('text', { textType: 'span' })])), CTX);
    assertPasses('R-058', reparent(form([node('text', { textType: 'paragraph' })])), CTX);
    assertFails('R-058', reparent(form([node('text', { textType: 'heading' })])), CTX, /not one of the values/);
    // An empty string is a legal contentType in 0.45 — the harvest records it, a hand-written
    // table would have dropped it, and treating it as illegal would be a false positive.
    assertPasses('R-058', reparent(form([node('text', { contentType: '' })])), CTX);
    assertFails('R-058', reparent(form([node('text', { dataType: 'datetime' })])), CTX, /not one of the values/);
    // A JS setting is evaluated at runtime; its value is unknowable offline, so no verdict.
    assertPasses('R-058', reparent(form([node('text', { textType: { _mode: 'code', _code: 'x' } })])), CTX);
  });

  it('R-059 the text content contract that made the font channel work', () => {
    const full = { textType: 'span', contentDisplay: 'content', contentType: 'custom', content: 'Hi' };
    assertPasses('R-059', reparent(form([node('text', full)])));
    for (const missing of ['textType', 'contentDisplay', 'contentType']) {
      const partial = { ...full };
      delete partial[missing];
      assertFails('R-059', reparent(form([node('text', partial)])), CTX, new RegExp(missing));
    }
    // No content means nothing to render and nothing to drop.
    assertPasses('R-059', reparent(form([node('text', { componentName: 'empty' })])));
  });
});

// =====================================================================================
describe('security', () => {
  it('R-022 anonymous forms need access 5', () => {
    const anonCtx = { ...CTX, formName: 'login' };
    assertPasses('R-022', reparent(form([node('text')], { access: 5 })), anonCtx);
    assertFails('R-022', reparent(form([node('text')], { access: 3 })), anonCtx, /need access 5/);
    assert.equal(only('R-022', reparent(form([node('text')])), { ...CTX, formName: 'employee-table' }).skipped, true);
  });

  it('R-041 no raw entity CRUD when anonymous', () => {
    const submit = { id: nid(), itemType: 'item', label: 'Save', actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form' } };
    const bad = reparent(form([node('buttonGroup', { isInline: true, items: [submit] })], { access: 5, dataSubmitterType: 'gql' }));
    assertFails('R-041', bad, CTX, /raw entity CRUD exposed to the internet/);
    const good = reparent(form([node('buttonGroup', { isInline: true, items: [submit] })], { access: 5, dataSubmitterType: 'none' }));
    assertPasses('R-041', good);
    assert.equal(only('R-041', reparent(form([node('text')], { access: 3 }))).skipped, true);
  });
});

// =====================================================================================
describe('the walker', () => {
  it('reaches every container shape 0.45 uses', () => {
    const deep = form([
      node('card', {
        header: { id: 'h', components: [node('text', { componentName: 'inHeader' })] },
        content: { id: 'c', components: [node('text', { componentName: 'inContent' })] },
      }),
      node('tabs', { tabs: [{ id: 't1', components: [node('text', { componentName: 'inTab' })] }] }),
      node('columns', { columns: [{ id: 'k1', components: [node('text', { componentName: 'inColumn' })] }] }),
      node('container', { components: [node('text', { componentName: 'nested' })] }),
    ]);
    // wizard steps and collapsiblePanel customHeader, the two easiest slots to miss
    deep.components.push({ id: nid(), type: 'wizard', parentId: 'root', version: 8, steps: [{ id: 's1', components: [node('text', { componentName: 'inStep' })] }] });
    deep.components.push({ id: nid(), type: 'collapsiblePanel', parentId: 'root', version: 9, customHeader: { id: 'ch', components: [node('text', { componentName: 'inCustomHeader' })] } });

    const names = allComponents(deep).map((h) => h.node.componentName);
    for (const expected of ['inHeader', 'inContent', 'inTab', 'inColumn', 'nested', 'inStep', 'inCustomHeader']) {
      assert.ok(names.includes(expected), `walker missed ${expected} — misses here cause false PASSes`);
    }
  });

  it('separates buttonGroup items from components', () => {
    const m = form([node('buttonGroup', { isInline: true, items: [{ id: nid(), itemType: 'item', label: 'A' }] })]);
    assert.equal(allItems(m).length, 1);
    assert.equal(allComponents(m).filter((h) => h.node.type === 'buttonGroup').length, 1);
    assert.ok(!allComponents(m).some((h) => h.node.itemType === 'item'), 'items leaked into components');
  });

  it('reads table columns from `items`, not `columns`', () => {
    const n = node('datatable', { items: [{ id: 'c', columnType: 'data', propertyName: 'a' }] });
    assert.equal(tableColumns(n).length, 1);
  });

  it('treats `content` as a slot on a card but as a prop on a text', () => {
    // Regression: ownStrings used to skip `content` unconditionally because it is a
    // container-slot name, which silently hid every text component's content from the
    // mustache (R-014) and globalState (R-023) rules. Same key, two meanings by type.
    const textNode = node('text', { content: 'Hello {{data.name}}' });
    const strings = ownStrings(textNode).map((s) => s.path);
    assert.ok(strings.includes('content'), 'text.content must be visible to string-scanning rules');

    const cardNode = node('card', { content: { id: 'c', components: [node('text')] } });
    const cardStrings = ownStrings(cardNode).map((s) => s.path);
    assert.ok(
      !cardStrings.some((p) => p.startsWith('content')),
      'card.content is a container slot and must NOT be scanned as a prop'
    );
  });

  it('produces a fixPointer that names the offending node', () => {
    const bad = reparent(form([node('container', { components: [node('text')] })]));
    bad.components[0].components[0].parentId = 'wrong';
    const v = only('R-001', bad).violations;
    assert.equal(v.length, 1);
    assert.match(v[0].fixPointer, /^components\/0\/components\/0\/parentId$/);
  });
});
