// Offline eval suite for the compiler + gate chain.
//
// The pipeline's only fast feedback loop. For every blueprint fixture it compiles
// under BOTH shipped themes, runs the three offline gates, and byte-compares the
// output against a committed snapshot — so a compiler change that silently reshapes
// markup shows up as a diff in review instead of as a broken form in a browser.
//
// It also pins two boundaries:
//   * the golden corpus must not acquire NEW failing rule ids (regression bar for
//     every walker added to validate-guardrails.js), and
//   * the broken-bindings fixture must still FAIL (the gates can catch things).
//
// Snapshots: delete tests/__snapshots__/<fixture>--<theme>.json and re-run to
// re-record; the diff is the review artifact.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const SCRIPTS = path.join(SKILL, 'scripts');
const FIXTURES = path.join(HERE, 'fixtures');
const SNAPSHOTS = path.join(HERE, '__snapshots__');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'form-edit-pipeline-'));

const THEMES = ['shesha', 'requirements-studio'];
const BLUEPRINTS = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.blueprint.json')).sort();

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('there are blueprint fixtures to compile', () => {
  assert.ok(BLUEPRINTS.length >= 5, `expected ≥5 blueprint fixtures, found ${BLUEPRINTS.length}`);
});

// ---- blueprint fixtures are valid blueprint IR -------------------------------
// Structural check against shesha-design-comprehension/schemas/blueprint.schema.json
// (required keys, node `kind` enum, no unknown node keys) — the schema is the
// contract between comprehension and the compiler, and it has no runtime validator.
test('every fixture is valid blueprint IR', () => {
  const schemaPath = path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const nodeDef = schema.$defs.node;
  const kinds = new Set(nodeDef.properties.kind.enum);
  const nodeKeys = new Set(Object.keys(nodeDef.properties));
  const archetypes = new Set(schema.properties.archetype.enum);

  for (const f of BLUEPRINTS) {
    const bp = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
    for (const req of schema.required) assert.ok(bp[req] !== undefined, `${f}: missing required "${req}"`);
    assert.ok(archetypes.has(bp.archetype), `${f}: archetype "${bp.archetype}" not in the schema enum`);
    assert.ok(bp.entity.fullClassName, `${f}: entity.fullClassName missing`);
    assert.ok(bp.form.module && bp.form.name, `${f}: form.module/name missing`);
    let count = 0;
    (function walkNode(n, at) {
      count++;
      assert.ok(kinds.has(n.kind), `${f} ${at}: kind "${n.kind}" not in the schema enum`);
      for (const k of Object.keys(n)) assert.ok(nodeKeys.has(k), `${f} ${at}: unknown node key "${k}"`);
      for (const [i, c] of (n.children ?? []).entries()) walkNode(c, `${at}/${n.kind}[${i}]`);
    })(bp.layout, 'layout');
    assert.ok(count >= 4 && count <= 60, `${f}: ${count} nodes — fixtures stay small`);
  }
});

// ---- compile → gates → snapshot ---------------------------------------------
for (const fixture of BLUEPRINTS) {
  const name = fixture.replace(/\.blueprint\.json$/, '');
  for (const theme of THEMES) {
    test(`${name} @ ${theme}: compiles, passes every offline gate, matches its snapshot`, () => {
      const out = path.join(WORK, `${name}--${theme}.json`);
      const compiled = run('compile-blueprint.js', [
        '--blueprint', path.join(FIXTURES, fixture), '--out', out, '--no-live', '--theme', theme,
      ]);
      assert.equal(compiled.code, 0, `compile failed:\n${compiled.out}`);
      assert.ok(fs.existsSync(out), 'compiler wrote no output');
      // the compiler must find the theme — a missing theme silently emits neutral defaults
      assert.doesNotMatch(compiled.out, /theme ".*" not found/, `theme "${theme}" was not found`);

      for (const gate of ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js']) {
        const r = run(gate, [out]);
        assert.equal(r.code, 0, `${gate} failed for ${name}@${theme}:\n${r.out}`);
      }

      const actual = fs.readFileSync(out, 'utf8');
      const snapFile = path.join(SNAPSHOTS, `${name}--${theme}.json`);
      if (!fs.existsSync(snapFile)) {
        fs.mkdirSync(SNAPSHOTS, { recursive: true });
        fs.writeFileSync(snapFile, actual);
        console.log(`  recorded snapshot ${path.basename(snapFile)}`);
        return;
      }
      assert.equal(actual, fs.readFileSync(snapFile, 'utf8'),
        `compiled output for ${name}@${theme} no longer matches its snapshot — review the change, then delete ${path.relative(SKILL, snapFile)} and re-run to re-record`);
    });
  }
}

// ---- golden-corpus regression bar -------------------------------------------
// The 11 goldens are SEED templates, not shippable markup: they already carry
// placeholder ids ({{GEN_KEY}}), missing parentIds/versions and boolean
// defaultValues, so 8 of them fail validate-guardrails.js and always did. The
// meaningful bar is therefore "no NEW rule id fails" — this map is the pre-existing
// debt, captured from the validator as it stood before the walkers below were added
// (R-012/013/014/017/021/022/023/024/028/037/041/052/053/054/055).
//
// --legacy-corpus downgrades the two measured-channel rules (R-052 text colour
// without contentType:"custom", R-053 dead no-op channels) to WARN. The corpus
// predates the capability matrix and genuinely trips them — 33 text nodes author a
// colour that never reaches the DOM. That is real, reported debt, not a check
// weakness: the flag exists ONLY for this test, and the second case below asserts
// that R-052/R-053 are the ONLY new ids the corpus trips.
const GOLDEN_BASELINE_FAILS = {
  'auth-page--auth-login.json': ['R-006', 'R-009'],
  'capture--employee-create.json': ['R-001', 'R-003'],
  'capture-standalone--standalone-create.json': ['R-002', 'R-003'],
  'dashboard--dashboard.json': ['R-003', 'R-007'],
  'hub--rs-detail-with-header.json': ['R-002', 'R-003'],
  'inline-card--inline-editable-table.json': [],
  'list-card--entity-datalist.json': [],
  'list-card-item--entity-card.json': [],
  'modal-dialog--rs-create-dialog.json': ['R-002', 'R-003', 'R-009'],
  'record-detail--employee-detail.json': ['R-001', 'R-003'],
  'table-worklist--employee-table.json': ['R-002'],
};
const failingRuleIds = (output) => [...new Set(
  output.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.match(/\[([^\]]+)\]/)?.[1]).filter(Boolean),
)].sort();

test('the golden corpus is complete and accounted for', () => {
  const goldens = fs.readdirSync(path.join(SKILL, 'assets', 'golden'))
    .filter((f) => f.endsWith('.json') && f !== '_index.json').sort();
  assert.equal(goldens.length, 11, `expected 11 golden forms, found ${goldens.length}`);
  assert.deepEqual(goldens, Object.keys(GOLDEN_BASELINE_FAILS).sort());
});

for (const [golden, baseline] of Object.entries(GOLDEN_BASELINE_FAILS)) {
  test(`golden ${golden}: no new failing rule id`, () => {
    const file = path.join(SKILL, 'assets', 'golden', golden);
    const r = run('validate-guardrails.js', [file, '--legacy-corpus']);
    assert.deepEqual(failingRuleIds(r.out), baseline.slice().sort(),
      `the failing rule ids for ${golden} changed — a new walker regressed the corpus (or the corpus was fixed; update GOLDEN_BASELINE_FAILS)`);
    assert.equal(r.code, baseline.length ? 1 : 0, 'exit code must follow the fail count');
  });
}

test('golden corpus: R-052/R-053 are the ONLY rules the legacy-corpus flag masks', () => {
  const extra = new Set();
  for (const [golden, baseline] of Object.entries(GOLDEN_BASELINE_FAILS)) {
    const r = run('validate-guardrails.js', [path.join(SKILL, 'assets', 'golden', golden)]);
    for (const id of failingRuleIds(r.out)) if (!baseline.includes(id)) extra.add(id);
  }
  assert.deepEqual([...extra].sort(), ['R-052', 'R-053'],
    'the measured-channel debt in assets/golden changed shape — investigate before touching the flag');
});

// ---- negative case ----------------------------------------------------------
test('broken-bindings fixture FAILS the guardrail gate', () => {
  // Its defects are binding-identity defects, so they only become mechanical once
  // the entity metadata is supplied (arg 2) — exactly how resolve-bindings would
  // see them, minus the live backend. Without metadata the same file only warns.
  const fixture = path.join(FIXTURES, 'broken-bindings.json');
  const meta = path.join(FIXTURES, 'broken-bindings.metadata.json');
  const withMeta = run('validate-guardrails.js', [fixture, meta]);
  assert.notEqual(withMeta.code, 0, `expected a non-zero exit, got 0:\n${withMeta.out}`);
  assert.ok(failingRuleIds(withMeta.out).includes('R-015'),
    `expected the guessed reference-list identity to FAIL [R-015]:\n${withMeta.out}`);

  const withoutMeta = run('validate-guardrails.js', [fixture]);
  assert.equal(withoutMeta.code, 0, 'without metadata the identity check can only warn — that contract changed');
});
