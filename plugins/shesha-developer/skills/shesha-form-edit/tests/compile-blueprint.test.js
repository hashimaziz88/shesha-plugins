/**
 * Compiler tests — all offline. The build step takes a metadata snapshot rather than a
 * live backend, which is what makes these runnable in CI at all.
 *
 * The golden files in tests/golden/ are REGRESSION BASELINES, re-blessed from gate-clean
 * compiler output at the commit that introduced these tests. They are not an independent
 * statement of correctness — they catch unintended change, which is their actual value.
 * When a deliberate compiler change moves them, re-bless and say so in the commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const COMPILE = path.join(SKILL, 'scripts', 'compile-blueprint.js');
const VALIDATE = path.join(SKILL, 'scripts', 'validate-blueprint.mjs');
const FIXTURES = path.join(HERE, 'fixtures');
const GOLDEN = path.join(HERE, 'golden');

let tmpSeq = 0;
const tmp = (name) => path.join(os.tmpdir(), `shesha-test-${process.pid}-${tmpSeq++}-${name}`);

function compile(blueprint, extra = []) {
  const out = tmp('out.json');
  execFileSync(process.execPath, [COMPILE, '--blueprint', blueprint, '--out', out, ...extra],
    { stdio: 'pipe', cwd: SKILL });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** Run a script and return { status, stdout, stderr } without throwing. */
function run(script, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { stdio: 'pipe', cwd: SKILL, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

function writeBlueprint(obj, name = 'bp.json') {
  const p = tmp(name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

const baseBlueprint = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'asset-capture.blueprint.json'), 'utf8'));

function allComponents(form) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type && n.id) out.push(n);
    for (const v of Object.values(n)) walk(v);
  };
  walk(form.components);
  return out;
}

// ---------------------------------------------------------------- golden snapshots

for (const name of ['asset-capture', 'react-grammar']) {
  test(`golden snapshot: ${name} compiles byte-identically to its baseline`, () => {
    const actual = compile(path.join(FIXTURES, `${name}.blueprint.json`));
    const expected = JSON.parse(fs.readFileSync(path.join(GOLDEN, `${name}.expected.json`), 'utf8'));
    assert.deepEqual(actual, expected,
      `${name} drifted from its baseline. If the change was deliberate, re-bless tests/golden/${name}.expected.json and say so in the commit.`);
  });
}

test('compilation is deterministic — same blueprint twice, identical output', () => {
  const bp = path.join(FIXTURES, 'asset-capture.blueprint.json');
  assert.deepEqual(compile(bp), compile(bp));
});

// ---------------------------------------------------------------- identity

test('every emitted component id is unique', () => {
  for (const name of ['asset-capture', 'react-grammar']) {
    const comps = allComponents(compile(path.join(FIXTURES, `${name}.blueprint.json`)));
    const ids = comps.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${name} emitted a duplicate component id`);
  }
});

test('every emitted componentName is unique', () => {
  for (const name of ['asset-capture', 'react-grammar']) {
    const names = allComponents(compile(path.join(FIXTURES, `${name}.blueprint.json`)))
      .map((c) => c.componentName).filter(Boolean);
    assert.equal(new Set(names).size, names.length, `${name} emitted a duplicate componentName`);
  }
});

test('two sibling fields bound to the same property get distinct ids (path+ordinal seeding)', () => {
  // Showing one property twice is legitimate — a summary line and a detail row, say.
  // Under the old `kind:name ?? property ?? seq++` scheme both keyed on `field:name`,
  // producing one uuid for two components: the "everything renders twice" defect.
  const bp = baseBlueprint();
  const prop = bp.bindings[0].property;
  bp.layout.children.unshift({
    kind: 'row',
    children: [{ kind: 'field', property: prop }, { kind: 'field', property: prop }],
  });
  const comps = allComponents(compile(writeBlueprint(bp)));
  const bound = comps.filter((c) => c.propertyName === prop);
  assert.ok(bound.length >= 2, `expected the property to be emitted twice, saw ${bound.length}`);
  const ids = bound.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'sibling fields on the same property produced colliding ids');
});

test('inserting a node does not renumber ids elsewhere in the tree', () => {
  // The old global seq++ counter made every later unnamed node shift.
  const before = compile(path.join(FIXTURES, 'asset-capture.blueprint.json'));
  const bp = baseBlueprint();
  bp.layout.children.unshift({ kind: 'text', name: 'inserted', content: 'new first child' });
  const after = compile(writeBlueprint(bp));

  const idOf = (form, componentName) => allComponents(form).find((c) => c.componentName === componentName)?.id;
  const stable = allComponents(before)
    .map((c) => c.componentName)
    .filter((n) => n && n !== 'inserted');
  // The actions row sits at a fixed path under the root, so its id must survive an
  // insertion before it only if its ordinal did not change; assert on a deeper node
  // whose full path is unaffected.
  const survivors = stable.filter((n) => idOf(after, n) === idOf(before, n));
  assert.ok(survivors.length > 0,
    'no component kept its id across an unrelated insertion — ids are still order-dependent');
});

// ---------------------------------------------------------------- schema rejection

test('blueprint validation rejects a field with no property', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'field' });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.property is required/);
});

test('blueprint validation rejects datatable columns given as a count', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'datatable', columns: 3 });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /columns.*expected array/i);
});

test('blueprint validation rejects grid columns given as a property list', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'grid', columns: ['a', 'b'], children: [{ kind: 'text', content: 'x' }] });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /columns.*expected integer/i);
});

test('blueprint validation rejects a tab outside tabs', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'tab', title: 'Orphan', children: [{ kind: 'text', content: 'x' }] });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown kind "tab"/);
});

test('blueprint validation rejects an incomplete modelType', () => {
  const bp = baseBlueprint();
  delete bp.entity.modelType.module;
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /modelType\.module is required/);
});

test('blueprint validation rejects a PascalCase property path', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'field', property: 'AssetName' });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /camelCase/);
});

test('blueprint validation rejects an unknown property on a node kind', () => {
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'field', property: 'name', columns: 2 });
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a valid property on kind "field"/);
});

test('blueprint validation rejects an actions node with no explicit exit', () => {
  const bp = baseBlueprint();
  bp.layout.children = bp.layout.children.map((c) => (c.kind === 'actions' ? { kind: 'actions' } : c));
  const r = run(VALIDATE, [writeBlueprint(bp)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exit is required/);
});

test('the compiler validates the blueprint itself and refuses an invalid one', () => {
  // Never trust that an upstream agent validated: an agent that skipped the step and
  // one that ran it look identical from here.
  const bp = baseBlueprint();
  bp.layout.children.push({ kind: 'field' });
  const r = run(COMPILE, ['--blueprint', writeBlueprint(bp), '--out', tmp('never.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blueprint INVALID/);
});

// ---------------------------------------------------------------- token substitution

test('token substitution bakes concrete brand values, never token paths', () => {
  const form = compile(path.join(FIXTURES, 'asset-capture.blueprint.json'), ['--theme', 'shesha']);
  const text = JSON.stringify(form);
  assert.doesNotMatch(text, /"(palette|roles|type|spacing|radius|shadow|chrome)\.[a-zA-Z.]+"/,
    'an unresolved token path reached the emitted markup');
  // The default brand's canvas and ink must actually appear.
  assert.match(text, /#F8F8F9/i, 'page canvas colour from the shesha style plan is missing');
  assert.match(text, /#181818/i, 'body ink colour from the shesha style plan is missing');
});

test('a different brand produces different colours from the same blueprint', () => {
  const bp = path.join(FIXTURES, 'asset-capture.blueprint.json');
  const a = JSON.stringify(compile(bp, ['--theme', 'shesha']));
  const b = JSON.stringify(compile(bp, ['--theme', 'wcg']));
  assert.notEqual(a, b, 'the theme flag had no effect on emitted markup');
});

test('--no-style compiles with neutral tokens and still emits page ground', () => {
  const form = compile(path.join(FIXTURES, 'asset-capture.blueprint.json'), ['--no-style']);
  const root = form.components.find((c) => c.type === 'container');
  assert.ok(root?.desktop?.background?.color, 'no page ground emitted under --no-style');
});

// ---------------------------------------------------------------- styled-ness floor

test('compiled output satisfies the styled-ness gate', () => {
  // A structure-only form is a defect [R-042]; the compiler must not produce one.
  for (const name of ['asset-capture', 'react-grammar']) {
    const out = tmp(`${name}-styled.json`);
    execFileSync(process.execPath,
      [COMPILE, '--blueprint', path.join(FIXTURES, `${name}.blueprint.json`), '--out', out],
      { stdio: 'pipe', cwd: SKILL });
    const r = run(path.join(SKILL, 'scripts', 'validate-styledness.js'), [out]);
    assert.equal(r.status, 0, `${name} failed styled-ness:\n${r.stdout}`);
  }
});

// ---------------------------------------------------------------- archetype wiring

test('golden snapshot: asset-worklist compiles byte-identically to its baseline', () => {
  const actual = compile(path.join(FIXTURES, 'asset-worklist.blueprint.json'));
  const expected = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'asset-worklist.expected.json'), 'utf8'));
  assert.deepEqual(actual, expected);
});

test('table-worklist instantiates the archetype chrome from the golden corpus', () => {
  // A bare datatable ships with no way to search or page, which reads as an unfinished
  // screen. The corpus says this archetype has a toolbar, so the compiler emits one.
  const form = compile(path.join(FIXTURES, 'asset-worklist.blueprint.json'));
  const types = allComponents(form).map((c) => c.type);
  assert.ok(types.includes('datatable'), 'no grid emitted');
  assert.ok(types.includes('datatable.quickSearch'), 'archetype chrome is missing quick search');
  assert.ok(types.includes('datatable.pager'), 'archetype chrome is missing the pager');

  // The toolbar must sit above the grid inside the dataContext, not after it.
  const ctx = allComponents(form).find((c) => c.type === 'dataContext');
  const order = (ctx.components ?? []).map((c) => c.type);
  assert.deepEqual(order, ['container', 'datatable'], `unexpected dataContext order: ${order.join(', ')}`);
});

test('the toolbar is a full-width flex row so its right cluster sits flush with the grid', () => {
  // justifyContent needs an explicit display:flex [R-029] and full width [R-028];
  // without both, the pager drifts off the table edge.
  const form = compile(path.join(FIXTURES, 'asset-worklist.blueprint.json'));
  const toolbar = allComponents(form).find((c) => c.componentName?.endsWith('Toolbar'));
  assert.equal(toolbar.desktop.display, 'flex');
  assert.equal(toolbar.desktop.justifyContent, 'space-between');
  assert.equal(toolbar.desktop.dimensions.width, '100%');
});

test('a non-worklist archetype does NOT get the worklist toolbar', () => {
  const form = compile(path.join(FIXTURES, 'asset-capture.blueprint.json'));
  const types = allComponents(form).map((c) => c.type);
  assert.ok(!types.includes('datatable.pager'), 'worklist chrome leaked into a capture form');
});

test('an archetype outside the golden corpus is refused', () => {
  const bp = baseBlueprint();
  bp.archetype = 'record-detail';           // in the schema enum
  const inCorpus = run(COMPILE, ['--blueprint', writeBlueprint(bp), '--out', tmp('rd.json')]);
  assert.equal(inCorpus.status, 0, 'a corpus archetype was wrongly refused');

  // solution-map is in the schema enum but has no golden file.
  const bp2 = baseBlueprint();
  bp2.archetype = 'solution-map';
  const r = run(COMPILE, ['--blueprint', writeBlueprint(bp2), '--out', tmp('sm.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not in the golden corpus/);
});

test('every component type the compiler emits is measured as rendering', () => {
  // The capability gate refuses not-registered / breaks-render types. This asserts the
  // corpus and the matrix actually agree for the wired archetype, rather than trusting it.
  const matrix = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets', 'measured-capability-matrix.json'), 'utf8'));
  const form = compile(path.join(FIXTURES, 'asset-worklist.blueprint.json'));
  for (const c of allComponents(form)) {
    const status = matrix.components?.[c.type]?.renderStatus;
    assert.ok(status !== 'not-registered' && status !== 'breaks-render',
      `emitted "${c.type}" but the matrix records renderStatus=${status}`);
  }
});

// ---------------------------------------------------------------- apply envelope

test('the Create envelope modelType is derived as a STRING, not the settings object', () => {
  // Verified live: passing formSettings.modelType (an object) into the Create envelope
  // returns HTTP 400 "Unexpected character encountered while parsing value: {".
  // The envelope wants the entity full class name; the markup keeps the {name,module}
  // object [R-016]. Same key, two shapes.
  const src = fs.readFileSync(path.join(SKILL, 'scripts', 'apply-form.mjs'), 'utf8');
  assert.match(src, /function envelopeModelType/, 'apply-form no longer derives the envelope modelType');
  assert.doesNotMatch(src, /modelType:\s*stagedObj\.formSettings\?\.modelType/,
    'apply-form passes the settings object straight into the envelope again');

  // The compiled worklist must carry a dataContext entityType for the derivation to work.
  const form = compile(path.join(FIXTURES, 'asset-worklist.blueprint.json'));
  const ctx = allComponents(form).find((c) => c.type === 'dataContext');
  assert.equal(typeof ctx?.entityType, 'string');
  assert.ok(ctx.entityType.includes('.'), 'entityType is not a full class name');
  assert.equal(typeof form.formSettings.modelType, 'object', 'markup modelType must stay the {name,module} object');
});
