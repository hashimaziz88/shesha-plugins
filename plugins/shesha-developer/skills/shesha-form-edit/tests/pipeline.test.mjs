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
import { validateBlueprint, loadSchema } from '../../shesha-design-comprehension/scripts/validate-blueprint.mjs';

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
// contract between comprehension and the compiler. The logic lives in
// shesha-design-comprehension/scripts/validate-blueprint.mjs (the same validator
// compile-blueprint.js runs before it compiles); this test only pins the fixtures
// against it, plus the fixtures-stay-small bar that is a test concern only.
test('every fixture is valid blueprint IR', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));

  for (const f of BLUEPRINTS) {
    const bp = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
    const { errors, nodeCount } = validateBlueprint(bp, schema);
    assert.deepEqual(errors, [], `${f}: invalid blueprint IR —\n  ${errors.join('\n  ')}`);
    assert.ok(nodeCount >= 4 && nodeCount <= 60, `${f}: ${nodeCount} nodes — fixtures stay small`);
  }
});

// The validator has teeth: a mutated blueprint must come back with findings, or
// the assertion above is vacuous.
test('validateBlueprint rejects a bad archetype and an unknown node key', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));
  const bad = {
    screen: 'Mutant', archetype: 'not-an-archetype',
    entity: {}, form: { module: 'm' },
    layout: { kind: 'stack', bogusKey: 1, children: [{ kind: 'notAKind' }] },
  };
  const { errors } = validateBlueprint(bad, schema);
  for (const needle of [/archetype "not-an-archetype"/, /entity\.fullClassName/, /form\.module\/name/,
    /unknown node key "bogusKey"/, /kind "notAKind"/]) {
    assert.ok(errors.some((e) => needle.test(e)), `expected a finding matching ${needle}:\n${errors.join('\n')}`);
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

// ---- spacing resolves through the theme, not a hardcoded literal --------------
// A numeric-STRING spacing key is a step on the theme scale: '4' → spacing.4 → 16px.
// It used to fall through to parseInt('4') and emit 4px — while the card default's
// own comment claimed 16 — so this pins the token semantics from both directions
// (the card default, and an explicitly authored padding: "4"). The blueprint is
// written to the temp dir on purpose: the fixtures directory is snapshot territory.
test("spacing key '4' resolves through the theme scale to 16px (not 4px)", () => {
  const bp = {
    screen: 'Spacing Probe', archetype: 'record-detail',
    entity: { fullClassName: 'His.Facilities.Domain.Asset', modelType: 'His.Facilities.Domain.Asset' },
    form: { module: 'His.Facilities', name: 'spacing-probe' },
    layout: {
      kind: 'stack', name: 'page', padding: 'lg', gap: 'lg',
      children: [
        // no padding → the compiler's card default, which must land on spacing.4
        { kind: 'card', name: 'defaultPadCard', title: 'Default Padding', children: [{ kind: 'field', property: 'name' }] },
        // authored numeric-string key → the same 16px
        { kind: 'card', name: 'tokenPadCard', title: 'Token Padding', padding: '4', gap: '2', children: [{ kind: 'field', property: 'code' }] },
      ],
    },
  };
  const bpFile = path.join(WORK, 'spacing-probe.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));

  const compileTo = (out, extra = []) => {
    const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', ...extra]);
    assert.equal(r.code, 0, `compile failed:\n${r.out}`);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };
  const findCard = (doc, name) => {
    let hit = null;
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.componentName === name) hit = n;
      for (const v of Object.values(n)) walk(v);
    })(doc.components);
    assert.ok(hit, `container "${name}" not found in the compiled output`);
    return hit;
  };
  const padOf = (card) => {
    const box = JSON.parse(card.desktop.stylingBox);
    const sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => box[k]);
    assert.deepEqual(new Set(sides).size, 1, `expected uniform padding, got ${JSON.stringify(box)}`);
    return sides[0];
  };

  for (const theme of THEMES) {
    const doc = compileTo(path.join(WORK, `spacing-probe--${theme}.json`), ['--theme', theme]);
    assert.equal(padOf(findCard(doc, 'defaultPadCard')), '16',
      `${theme}: the card default padding must be spacing.4 = 16px`);
    const tokenCard = findCard(doc, 'tokenPadCard');
    assert.equal(padOf(tokenCard), '16', `${theme}: padding "4" must resolve to spacing.4 = 16px`);
    assert.equal(tokenCard.desktop.gap, '8px', `${theme}: gap "2" must resolve to spacing.2 = 8px`);
    assert.equal(tokenCard.gap, 8, `${theme}: the root-level gap duplicate must match the desktop block`);
  }

  // --no-style keeps the same neutral step values — spacing must not collapse to 4px
  const neutral = compileTo(path.join(WORK, 'spacing-probe--no-style.json'), ['--no-style']);
  assert.equal(padOf(findCard(neutral, 'defaultPadCard')), '16', 'neutral spacing.4 must still be 16px');
  assert.equal(padOf(findCard(neutral, 'tokenPadCard')), '16', 'neutral padding "4" must still be 16px');
});

// ---- --no-style: neutral tokens, no brand ------------------------------------
// R-042 says --no-style is the ONE thing that skips the default-theme pass. The
// bar is mechanical: the compiled output must carry NONE of the named theme's
// distinctive palette values, yet still be valid markup. The styled control in the
// same test proves the assertion has teeth (the brand hex IS there without the flag).
test('--no-style compiles to neutral tokens (no brand values) and still passes validate-schema', () => {
  const fixture = 'asset-capture.blueprint.json';
  const tokens = JSON.parse(fs.readFileSync(
    path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes', 'shesha.tokens.json'), 'utf8'));
  // distinctive shesha values: the brand hex plus the two surface/line values the
  // compiler actually emits (page ground + card hairline)
  const brandValues = [
    tokens.palette.brand.primary,       // #003BB2
    tokens.palette.surfaces.canvas,     // #F8F8F9  → roles.pageBg
    tokens.palette.lines.border,        // #E8EAF0  → roles.hairline
  ];

  const plain = path.join(WORK, 'no-style--asset-capture.json');
  const r = run('compile-blueprint.js', [
    '--blueprint', path.join(FIXTURES, fixture), '--out', plain, '--no-live', '--theme', 'shesha', '--no-style',
  ]);
  assert.equal(r.code, 0, `compile --no-style failed:\n${r.out}`);
  assert.match(r.out, /--no-style/, 'the compiler must say it skipped the theme pass');
  const neutral = fs.readFileSync(plain, 'utf8');
  for (const v of brandValues) {
    assert.doesNotMatch(neutral, new RegExp(v, 'i'), `--no-style output still carries the shesha value ${v}`);
  }
  const schema = run('validate-schema.js', [plain]);
  assert.equal(schema.code, 0, `--no-style output failed validate-schema:\n${schema.out}`);

  // control: the same fixture WITH the theme does carry the brand surface values
  const styled = path.join(WORK, 'styled-control--asset-capture.json');
  const r2 = run('compile-blueprint.js', [
    '--blueprint', path.join(FIXTURES, fixture), '--out', styled, '--no-live', '--theme', 'shesha',
  ]);
  assert.equal(r2.code, 0, `styled control compile failed:\n${r2.out}`);
  const brandText = fs.readFileSync(styled, 'utf8');
  assert.match(brandText, new RegExp(tokens.palette.surfaces.canvas, 'i'),
    'the styled control lost the theme page ground — the --no-style assertion above is now vacuous');
});

// ---- the compiler gates itself, and says so honestly -------------------------
// The compile step used to write --out unconditionally and hand back a three-gate
// hint. It now runs schema/guardrails/styledness on its own output in-process, so
// exit 0 is a claim about the ARTIFACT. Both halves are asserted: every fixture
// self-gates clean, and the parting hint names all four gates (resolve-bindings
// included, flagged as caller-run because it needs the live backend).
test('compile self-gates its own output and names all four gates', () => {
  for (const fixture of BLUEPRINTS) {
    const name = fixture.replace(/\.blueprint\.json$/, '');
    const out = path.join(WORK, `selfgate--${name}.json`);
    const r = run('compile-blueprint.js', [
      '--blueprint', path.join(FIXTURES, fixture), '--out', out, '--no-live', '--theme', 'shesha',
    ]);
    assert.equal(r.code, 0, `compile of ${name} did not exit 0 — its own gates rejected it:\n${r.out}`);
    assert.match(r.out, /self-gated:/, `${name}: the compiler did not report running its own gates`);
    for (const gate of ['validate-schema', 'validate-guardrails', 'resolve-bindings', 'validate-styledness']) {
      assert.match(r.out, new RegExp(gate), `${name}: the gate hint omits ${gate}`);
    }
    assert.match(r.out, /resolve-bindings \(caller-run/,
      `${name}: the hint must say resolve-bindings stays caller-run (it needs the live backend)`);
  }
});

test('compile FAILS the command when its output trips a guardrail [R-028]', () => {
  // Post-fix no blueprint can naturally emit a root-level `columns` component, so the
  // wiring itself is what gets proven: a scratch compiler that seeds an R-028
  // violation into the tree must exit non-zero — and must still leave the file on
  // disk, because self-gating fails the COMMAND, not the evidence.
  const src = fs.readFileSync(path.join(SCRIPTS, 'compile-blueprint.js'), 'utf8');
  const seeded = src.replace(
    'fs.writeFileSync(outFile, JSON.stringify(form, null, 2)',
    `form.components.push({ id: 'seeded-r028', type: 'columns', version: 1, parentId: 'root', componentName: 'seededSplit', columns: [] });\n` +
    'fs.writeFileSync(outFile, JSON.stringify(form, null, 2)');
  assert.notEqual(seeded, src, 'could not seed the scratch compiler — the write site moved');
  const scratch = path.join(SCRIPTS, '.selfgate-probe.compile-blueprint.js'); // sibling: keeps relative asset paths valid
  const out = path.join(WORK, 'selfgate-violation.json');
  try {
    fs.writeFileSync(scratch, seeded);
    const r = spawnSync(process.execPath, [
      scratch, '--blueprint', path.join(FIXTURES, BLUEPRINTS[0]), '--out', out, '--no-live', '--theme', 'shesha',
    ], { encoding: 'utf8' });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    assert.notEqual(r.status, 0, `expected a non-zero exit from the seeded violation:\n${output}`);
    assert.match(output, /validate-guardrails\.js FAILED/, `the failing gate must be named:\n${output}`);
    assert.match(output, /R-028/, `the guardrail finding must be printed:\n${output}`);
    assert.ok(fs.existsSync(out), 'the output must survive a failed self-gate — the file is the diagnosis');
  } finally {
    fs.rmSync(scratch, { force: true });
  }
});

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
