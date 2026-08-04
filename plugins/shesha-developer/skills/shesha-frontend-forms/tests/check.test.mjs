/**
 * Gate-chain contract tests (Phase 2).
 *
 * Exit criterion: catches every failing fixture from Phase 1, and passes a hand-written
 * valid form.
 *
 * The valid form is built from the DERIVED registry rather than from hand-typed version
 * numbers. Typing "version: 7" into a test would reintroduce exactly the hand-maintained
 * version table this rebuild exists to delete, and the test would then pass against a
 * stale fact.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';

import {
  gateDeadChannel,
  gateRoundTrip,
  gateStructural,
  normaliseMarkup,
  runGates,
} from '../scripts/lib/gates.mjs';

const GT_CANDIDATES = [
  process.env.SHESHA_GROUND_TRUTH,
  'C:/Users/Hashim/Downloads/boxfusion.test/.shesha/ground-truth.json',
].filter(Boolean);

let gt = null;
let ctx = {};

before(() => {
  for (const p of GT_CANDIDATES) {
    if (p && existsSync(p)) {
      gt = JSON.parse(readFileSync(p, 'utf8'));
      break;
    }
  }
  if (gt) ctx = { registry: gt.registry, formName: 'employee-capture' };
});

let seq = 0;
const nid = () => `chk${String(seq++).padStart(3, '0')}aaaabbbbccccdddd`.slice(0, 22);

/** Version straight from the derived registry — never a literal. */
function v(type) {
  assert.ok(gt.registry[type], `${type} is not in the derived registry`);
  return gt.registry[type].lastVersion;
}

/**
 * A hand-written form that should pass every gate with zero failures.
 * Deliberately exercises the traps: a coloured heading (R-052 needs contentType custom),
 * a two-item action group (R-057 needs isInline), a flex row (R-029 needs desktop.display),
 * and a required input (R-006 needs validationErrors).
 */
function validForm() {
  const rootId = nid();
  const headWrapId = nid();
  const actionRowId = nid();

  const heading = {
    id: nid(),
    type: 'text',
    parentId: headWrapId,
    version: v('text'),
    componentName: 'pageHeading',
    // R-052: a font colour renders ONLY with contentType "custom".
    contentType: 'custom',
    content: 'New employee',
    desktop: { font: { size: 24, weight: '600', color: '#1f1f1f' } },
  };

  const field = {
    id: nid(),
    type: 'textField',
    parentId: rootId,
    version: v('textField'),
    componentName: 'firstName',
    propertyName: 'firstName',
    label: 'First name',
    editMode: 'editable',
    validate: { required: true },
  };

  const errors = {
    id: nid(),
    type: 'validationErrors',
    parentId: rootId,
    version: v('validationErrors'),
    componentName: 'errors',
  };

  const buttons = {
    id: nid(),
    type: 'buttonGroup',
    parentId: actionRowId,
    version: v('buttonGroup'),
    componentName: 'formActions',
    // R-057: without isInline the whole group collapses to an overflow menu.
    isInline: true,
    items: [
      {
        id: nid(),
        itemType: 'item',
        label: 'Back',
        actionConfiguration: {
          actionName: 'Navigate',
          actionOwner: 'shesha.common',
          actionArguments: { target: '/dynamic/Test/employee-table' },
        },
      },
      {
        id: nid(),
        itemType: 'item',
        label: 'Save',
        buttonType: 'primary',
        actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form' },
      },
    ],
  };

  return {
    formSettings: {
      layout: 'vertical',
      colon: false,
      labelCol: { span: 0 },
      wrapperCol: { span: 24 },
      access: 3,
      dataLoaderType: 'gql',
      dataSubmitterType: 'gql',
      modelType: { name: 'Employee', module: 'Test' },
    },
    components: [
      {
        id: rootId,
        type: 'container',
        parentId: 'root',
        version: v('container'),
        componentName: 'pageRoot',
        // R-029: the flex model must live in the desktop block, with display declared.
        desktop: { display: 'flex', flexDirection: 'column', gap: '16' },
        stylingBox: JSON.stringify({ paddingTop: '24', paddingLeft: '32', paddingRight: '32', paddingBottom: '32' }),
        components: [
          {
            id: headWrapId,
            type: 'container',
            parentId: rootId,
            version: v('container'),
            componentName: 'headingWrap',
            components: [heading],
          },
          field,
          errors,
          {
            id: actionRowId,
            type: 'container',
            parentId: rootId,
            version: v('container'),
            componentName: 'actionRow',
            desktop: { display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: '10' },
            components: [buttons],
          },
        ],
      },
    ],
  };
}

describe('gate chain: the hand-written valid form', () => {
  it('passes with zero failures', (t) => {
    if (!gt) return t.skip('no ground-truth.json; run probe first');
    const report = runGates(validForm(), ctx, null);
    assert.deepEqual(
      report.failures.map((f) => `${f.gate}${f.ruleId ? '/' + f.ruleId : ''}: ${f.message}`),
      [],
      'the valid form produced failures'
    );
    assert.equal(report.ok, true);
  });

  it('reports its own blind spots rather than implying completeness', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const report = runGates(validForm(), ctx, null);
    assert.ok(report.notChecked.length >= 3);
    assert.ok(
      report.notChecked.some((n) => /styled/i.test(n)),
      'a passing check must say that styled-ness was NOT checked'
    );
  });

  it('degrades the round-trip gate to a warning when the framework was not consulted', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const report = runGates(validForm(), ctx, null);
    const rt = report.violations.filter((v) => v.gate === 'round-trip');
    assert.equal(rt.length, 1);
    assert.equal(rt[0].severity, 'warn');
    assert.match(rt[0].message, /skipped/);
  });
});

describe('gate chain: every Phase 1 failing fixture is still caught', () => {
  /** Break exactly one thing at a time and assert the chain notices. */
  const breakages = [
    {
      name: 'stale version (R-003)',
      mutate: (f) => {
        f.components[0].version = 1;
      },
      expect: /R-003/,
    },
    {
      name: 'PascalCase binding (R-004)',
      mutate: (f) => {
        f.components[0].components[1].propertyName = 'FirstName';
      },
      expect: /R-004/,
    },
    {
      name: 'missing validationErrors with a required input (R-006)',
      mutate: (f) => {
        f.components[0].components.splice(2, 1);
      },
      expect: /R-006/,
    },
    {
      name: 'literal-array defaultValue (R-009)',
      mutate: (f) => {
        f.components[0].components[1].defaultValue = [1, 2];
      },
      expect: /R-009/,
    },
    {
      name: 'legacy customVisibility (R-031)',
      mutate: (f) => {
        f.components[0].components[1].customVisibility = 'return true';
      },
      expect: /R-031/,
    },
    {
      name: 'buttonGroup without isInline (R-057)',
      mutate: (f) => {
        f.components[0].components[3].components[0].isInline = false;
      },
      expect: /R-057/,
    },
    {
      name: 'coloured text without contentType custom (R-052)',
      mutate: (f) => {
        delete f.components[0].components[0].components[0].contentType;
      },
      expect: /R-052/,
    },
    {
      name: 'flex intent with no display (R-029)',
      mutate: (f) => {
        delete f.components[0].desktop.display;
      },
      expect: /R-029/,
    },
    {
      name: 'unknown component type (structural)',
      mutate: (f) => {
        f.components[0].components[1].type = 'textFeild';
      },
      expect: /unknown component type/,
    },
    {
      name: 'duplicate ids (R-002)',
      mutate: (f) => {
        f.components[0].components[1].id = f.components[0].components[2].id;
      },
      expect: /duplicate component id/,
    },
    {
      name: 'Navigate with an empty target (R-008)',
      mutate: (f) => {
        f.components[0].components[3].components[0].items[0].actionConfiguration.actionArguments.target = '';
      },
      expect: /R-008/,
    },
    {
      name: 'a script that does not compile (R-013)',
      mutate: (f) => {
        f.formSettings.onAfterDataLoad = 'const a = ;';
      },
      expect: /R-013/,
    },
    {
      name: 'image positioned absolutely (R-055)',
      mutate: (f) => {
        f.components[0].components.push({
          id: nid(),
          type: 'image',
          parentId: f.components[0].id,
          version: v('image'),
          componentName: 'logo',
          desktop: { position: 'absolute' },
        });
      },
      expect: /R-055/,
    },
    {
      name: 'the Shesha columns component (R-028)',
      mutate: (f) => {
        f.components.push({
          id: nid(),
          type: 'columns',
          parentId: 'root',
          version: v('columns'),
          componentName: 'split',
          columns: [],
        });
      },
      expect: /R-028/,
    },
  ];

  for (const b of breakages) {
    it(`catches ${b.name}`, (t) => {
      if (!gt) return t.skip('no ground-truth.json');
      const f = validForm();
      b.mutate(f);
      const report = runGates(f, ctx, null);
      const all = report.violations.map((v) => `${v.ruleId || v.gate}: ${v.message}`).join('\n');
      assert.match(all, b.expect, `the chain did not catch ${b.name}`);
      assert.ok(
        report.failures.length > 0 || /R-001|R-029|R-053/.test(String(b.expect)),
        `${b.name} produced no failure-severity violation`
      );
    });
  }
});

describe('gate chain: input shapes', () => {
  it('accepts a raw {formSettings, components} document', () => {
    const { doc, error } = normaliseMarkup({ formSettings: { layout: 'vertical' }, components: [] });
    assert.equal(error, null);
    assert.ok(Array.isArray(doc.components));
  });

  it('unwraps a stringified `markup` blob, which is how UpdateMarkup carries it', () => {
    // The DTO double-encodes markup relative to the entity; forgetting that silently
    // corrupts a push, so check has to read both shapes.
    const inner = { formSettings: { layout: 'vertical' }, components: [{ id: 'x', type: 'text' }] };
    const { doc, notes, error } = normaliseMarkup({ id: 'abc', markup: JSON.stringify(inner) });
    assert.equal(error, null);
    assert.equal(doc.components.length, 1);
    assert.ok(notes.some((n) => /stringified/.test(n)));
  });

  it('unwraps an ABP {result} envelope', () => {
    const inner = { formSettings: { layout: 'vertical' }, components: [] };
    const { doc, error } = normaliseMarkup({ success: true, result: { markup: JSON.stringify(inner) } });
    assert.equal(error, null);
    assert.ok(Array.isArray(doc.components));
  });

  it('strips a BOM rather than failing on it', () => {
    const { doc, error } = normaliseMarkup('\uFEFF{"formSettings":{},"components":[]}');
    assert.equal(error, null);
    assert.ok(doc);
  });

  it('rejects something that is not a form, with a reason', () => {
    const { doc, error } = normaliseMarkup({ hello: 'world' });
    assert.equal(error, null); // shape is an object; the structural gate is what rejects it
    const report = runGates(doc, {}, null);
    assert.equal(report.ok, false);
    assert.match(report.failures.map((f) => f.message).join('\n'), /components is not an array/);
  });
});

describe('gate chain: structural gate', () => {
  it('warns when no registry is available instead of silently passing types', () => {
    const out = gateStructural({ formSettings: {}, components: [{ id: 'abcdefghijkl', type: 'text' }] }, {});
    assert.ok(out.some((v) => /no derived registry/.test(v.message)));
  });

  it('flags deprecated fields but NOT stylingBox', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const node = {
      id: 'abcdefghijklmno',
      type: 'text',
      parentId: 'root',
      version: v('text'),
      allStyles: {},
      // stylingBox is the LIVE key in 0.45 (stylingBoxJson does not exist), so it must not
      // be flagged. Flagging it would push authors onto a channel with zero occurrences in
      // both the typings and the runtime bundle.
      stylingBox: JSON.stringify({ paddingTop: '4' }),
    };
    const out = gateStructural({ formSettings: {}, components: [node] }, ctx);
    const msgs = out.map((v) => v.message).join('\n');
    assert.match(msgs, /allStyles/);
    assert.ok(!/stylingBox\b/.test(msgs.replace(/stylingBoxJson/g, '')), 'stylingBox must not be reported as deprecated');
  });
});

describe('gate chain: round-trip gate', () => {
  it('reports a dropped component', () => {
    const markup = {
      formSettings: {},
      components: [
        { id: 'aaaaaaaaaaaa', type: 'text', parentId: 'root', version: 5 },
        { id: 'bbbbbbbbbbbb', type: 'text', parentId: 'root', version: 5 },
      ],
    };
    const out = gateRoundTrip(markup, {
      tree: [markup.components[0]],
      flatIds: ['aaaaaaaaaaaa'],
      upgradeError: null,
    });
    const msgs = out.map((v) => v.message).join('\n');
    assert.match(msgs, /changed the component count from 2 to 1/);
    assert.match(msgs, /did not survive flattening/);
  });

  it('surfaces an upgradeComponents throw as a failure', () => {
    const markup = { formSettings: {}, components: [{ id: 'aaaaaaaaaaaa', type: 'text', version: 5 }] };
    const out = gateRoundTrip(markup, { tree: markup.components, flatIds: ['aaaaaaaaaaaa'], upgradeError: 'boom' });
    assert.ok(out.some((v) => v.severity === 'fail' && /upgradeComponents threw: boom/.test(v.message)));
  });

  it('suppresses field diffs for MIGRATED components but summarises them', () => {
    // A migration rewriting fields is the point of a migration. Reporting each rewrite as
    // a surprise buried the signal under 23 warnings on the shipped PBF form.
    const before = { id: 'aaaaaaaaaaaa', type: 'container', parentId: 'root', version: 5, desktop: { gap: '4' } };
    const after = { id: 'aaaaaaaaaaaa', type: 'container', parentId: 'root', version: 7, desktop: { gap: '8' } };
    const out = gateRoundTrip({ formSettings: {}, components: [before] }, { tree: [after], flatIds: ['aaaaaaaaaaaa'], upgradeError: null });
    const msgs = out.map((v) => v.message).join('\n');
    assert.match(msgs, /were migrated by the framework/);
    assert.ok(!/rewrote container .* desktop/.test(msgs), 'a migrated component must not also produce a per-field rewrite warning');
  });

  it('DOES report a rewrite when the version was already current', () => {
    const before = { id: 'aaaaaaaaaaaa', type: 'container', parentId: 'root', version: 7, desktop: { gap: '4' } };
    const after = { id: 'aaaaaaaaaaaa', type: 'container', parentId: 'root', version: 7, desktop: { gap: '8' } };
    const out = gateRoundTrip({ formSettings: {}, components: [before] }, { tree: [after], flatIds: ['aaaaaaaaaaaa'], upgradeError: null });
    assert.ok(out.some((v) => /even though its version was already current/.test(v.message)));
  });
});

describe('gate chain: dead-channel gate', () => {
  it('flags a channel the component\'s own settings form does not expose', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Verified against the derived registry: `container` exposes no font property while
    // `text` exposes font and pnlFontStyle. This is the narrow derived substitute for the
    // 586KB measured-capability-matrix the rebuild deliberately does not carry.
    assert.deepEqual(gt.registry.container.settings.propertyNames.filter((n) => /font/i.test(n)), []);
    assert.ok(gt.registry.text.settings.propertyNames.some((n) => /font/i.test(n)));

    const node = { id: 'aaaaaaaaaaaaaa', type: 'container', parentId: 'root', version: v('container'), desktop: { font: { size: 12 } } };
    const out = gateDeadChannel({ formSettings: {}, components: [node] }, ctx);
    assert.ok(out.some((v) => v.ruleId === 'R-053' && /exposes no font property/.test(v.message)));
  });

  it('does NOT flag a channel the component does expose', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const node = { id: 'aaaaaaaaaaaaaa', type: 'text', parentId: 'root', version: v('text'), contentType: 'custom', desktop: { font: { size: 12 } } };
    const out = gateDeadChannel({ formSettings: {}, components: [node] }, ctx);
    assert.deepEqual(out, []);
  });

  it('says it was skipped when there is no registry', () => {
    const out = gateDeadChannel({ formSettings: {}, components: [] }, {});
    assert.ok(out.some((v) => /skipped/.test(v.message)));
  });
});

describe('gate chain: the real shipped PBF form', () => {
  const PBF = 'C:/Users/Hashim/Downloads/PBF.MembershipManagement.application-table.json';

  it('is structurally sound but flagged for staleness and dead channels', (t) => {
    if (!gt || !existsSync(PBF)) return t.skip('PBF form or ground truth unavailable');
    const { doc } = normaliseMarkup(JSON.parse(readFileSync(PBF, 'utf8')));
    const report = runGates(doc, { registry: gt.registry, formName: 'application-table' }, null);

    // Structural soundness: it is a real, shipped, rendering form.
    assert.deepEqual(
      report.violations.filter((v) => v.gate === 'structural' && v.severity === 'fail'),
      [],
      'the shipped PBF form must pass the structural gate'
    );

    const ruleIds = new Set(report.violations.map((v) => v.ruleId).filter(Boolean));
    // Every component is behind this app's framework — confirmed by the framework's own
    // migrations moving datatable 6 -> 29.
    assert.ok(ruleIds.has('R-003'), 'expected stale versions');
    // Two text nodes author a font colour with no contentType custom, so the colour is a
    // no-op. This is acceptance-test item 2 showing up as a gate finding.
    assert.ok(ruleIds.has('R-052'), 'expected the no-op text colour finding');
    // The three glyph buttons share a container with no flex row.
    assert.ok(ruleIds.has('R-057'), 'expected the action-row finding');
    // Containers author font, which their settings form does not expose.
    assert.ok(ruleIds.has('R-053'), 'expected dead-channel findings');
  });

  it('produces no false positive on its correct slot parentIds', (t) => {
    if (!gt || !existsSync(PBF)) return t.skip('PBF form or ground truth unavailable');
    const { doc } = normaliseMarkup(JSON.parse(readFileSync(PBF, 'utf8')));
    const report = runGates(doc, { registry: gt.registry, formName: 'application-table' }, null);
    const parentIssues = report.violations.filter((v) => v.ruleId === 'R-001');
    // A slot child's parentId is the SLOT's id, not the owning component's. Getting that
    // wrong flagged the (correct) datatableContext as misparented.
    for (const p of parentIssues) {
      assert.match(p.message, /has no parentId/, `unexpected R-001 finding: ${p.message}`);
    }
  });
});
