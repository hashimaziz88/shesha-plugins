// artDirection — a DATA CONTRACT, and nothing more.
//
// Art direction is a JUDGMENT input: the compiler does not interpret it, it PASSES IT THROUGH
// so the design critic can hold the deliverable to it and the conductor can pick a theme that
// expresses it. Two things therefore need pinning, and only two:
//
//   * the shape is validated (typed fields, additionalProperties:false) and the tokens-only
//     rule reaches into it — a hex colour or a px literal in a stated intent is a finding,
//     because a literal cannot be re-branded and skips the theme entirely;
//   * adding it changes NO markup. A blueprint compiles byte-identically with and without it.
//     If art direction ever moves a pixel by itself, it has stopped being a judgment input.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBlueprint, loadSchema, readBlueprint } from '../../shesha-design-comprehension/scripts/validate-blueprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const COMPILER = path.join(SKILL, 'scripts', 'compile-blueprint.js');
const FIXTURE = path.join(HERE, 'fixtures', 'asset-capture.blueprint.json');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'art-direction-'));

const schema = loadSchema();
const base = readBlueprint(FIXTURE);
const withAD = (artDirection) => ({ ...base, ...(artDirection === undefined ? {} : { artDirection }) });
const rules = (bp) => validateBlueprint(bp, schema).findings.map((f) => f.rule);

const GOOD = {
  character: 'calm institutional record-keeping — a register, not a dashboard',
  density: 'workmanlike: every field earns its row, nothing floats',
  typeVoice: 'one clear step between a section heading and the values under it; weight, not size, carries emphasis',
  paletteStrategy: 'brand reserved strictly for interactive affordances; status tone is the only other colour on the page',
  surfaceStrategy: 'border-forward — hairlines separate, elevation is reserved for things that genuinely float',
  hierarchyStrategy: 'position first, then containment, then weight; colour never ranks anything',
  antiDefaults: ['no full-width hero band', 'no card around a single field', 'no icon on every label'],
  intentionalDeviations: ['the rail sits left of the main column, against the archetype, because the source app measures that way'],
};

// ---- the shape is real ---------------------------------------------------------
test('a fully populated artDirection validates clean', () => {
  assert.deepEqual(validateBlueprint(withAD(GOOD), schema).findings, []);
});

test('artDirection is OPTIONAL — its absence is not a defect', () => {
  assert.deepEqual(validateBlueprint(withAD(undefined), schema).findings, []);
  assert.ok(!('artDirection' in withAD(undefined)));
});

test('every field is independently optional', () => {
  for (const key of Object.keys(GOOD)) {
    assert.deepEqual(validateBlueprint(withAD({ [key]: GOOD[key] }), schema).findings, [],
      `artDirection with only ${key} must validate`);
  }
});

test('an unknown artDirection field is rejected — the vocabulary is closed', () => {
  assert.ok(rules(withAD({ ...GOOD, moodBoard: 'https://example.com' })).includes('unknown-property'),
    'additionalProperties:false must reject an invented field');
});

test('the field types are enforced', () => {
  assert.ok(rules(withAD({ character: 42 })).includes('wrong-type'), 'a non-string character must be rejected');
  assert.ok(rules(withAD({ antiDefaults: 'no hero band' })).includes('wrong-type'), 'antiDefaults must be an array');
  assert.ok(rules(withAD({ antiDefaults: [7] })).includes('wrong-type'), 'antiDefaults items must be strings');
  assert.ok(rules(withAD({ character: '' })).includes('empty-string'), 'an empty intent says nothing');
});

// ---- the tokens-only rule reaches into it -------------------------------------
test('a hex colour in a stated intent is a finding, naming the literal', () => {
  const f = validateBlueprint(withAD({ paletteStrategy: 'primary actions in #0d685a, nothing else coloured' }), schema).findings;
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].rule, 'art-direction-names-a-literal');
  assert.equal(f[0].path, 'artDirection.paletteStrategy');
  assert.equal(f[0].actual, '#0d685a');
});

test('a px literal in a stated intent is a finding', () => {
  const f = validateBlueprint(withAD({ typeVoice: 'headings at 24px over 14px body' }), schema).findings;
  assert.equal(f[0].rule, 'art-direction-names-a-literal');
  assert.match(f[0].actual, /24\s?px/);
});

test('the rule reaches into the ARRAY fields too, pathed to the element', () => {
  const f = validateBlueprint(withAD({ antiDefaults: ['no hero band', 'never #ffffff on #ffffff'] }), schema).findings;
  assert.ok(f.some((x) => x.path === 'artDirection.antiDefaults[1]'),
    `an array element must be pathed by index: ${JSON.stringify(f)}`);
});

test('prose that merely mentions colour or size WITHOUT a literal is fine', () => {
  assert.deepEqual(validateBlueprint(withAD({
    paletteStrategy: 'a single deep brand colour on interactive affordances only',
    typeVoice: 'headings step clear of body copy by one scale step, no more',
    antiDefaults: ['no pixel-perfect chasing of the source', 'no colour-only status'],
  }), schema).findings, []);
});

// ---- it changes NO markup -----------------------------------------------------
const compile = (bp, tag) => {
  const bpFile = path.join(WORK, `${tag}.blueprint.json`);
  const out = path.join(WORK, `${tag}.form.json`);
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));
  const r = spawnSync(process.execPath, [COMPILER, '--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha'],
    { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, markup: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
};

test('artDirection is a JUDGMENT input: the compiled markup is byte-identical with and without it', () => {
  const without = compile(withAD(undefined), 'without');
  const with_ = compile(withAD(GOOD), 'with');
  assert.equal(without.code, 0, without.out);
  assert.equal(with_.code, 0, with_.out);
  assert.equal(with_.markup, without.markup,
    'artDirection moved the markup — it is a judgment input for the critic and the theme choice, '
    + 'never a mechanical compiler lever. Nothing generative may be derived from it.');
});

test('the entry PASSES artDirection THROUGH in its structured result, verbatim', () => {
  const r = compile(withAD(GOOD), 'passthrough');
  const result = JSON.parse(r.out.slice(r.out.lastIndexOf('{\n  "form"')).match(/^{[\s\S]*?\n}/)[0]);
  assert.deepEqual(result.artDirection, GOOD, 'the downstream stages receive art direction unchanged');
  const bare = compile(withAD(undefined), 'passthrough-bare');
  const bareResult = JSON.parse(bare.out.slice(bare.out.lastIndexOf('{\n  "form"')).match(/^{[\s\S]*?\n}/)[0]);
  assert.ok(!('artDirection' in bareResult), 'absent art direction must not be invented as an empty object');
});

// ---- the authority order is documented in exactly ONE place -------------------
test('the authority order lives in the schema, once, and nowhere else', () => {
  const comment = schema.$defs.artDirection.$comment;
  for (const rank of [/measured/i, /explicit art direction/i, /archetype default/i, /runtime constraint/i]) {
    assert.match(comment, rank, 'the $comment must state all four ranks of the authority order');
  }
  assert.match(comment, /report/i, 'a runtime fallback must be REPORTED, never silent');
  // and no second copy of it in the compiler — the entry only points at the schema
  const entry = fs.readFileSync(path.join(SKILL, 'scripts', 'compile-blueprint.js'), 'utf8');
  assert.doesNotMatch(entry, /archetype defaults/i,
    'the compiler must not restate the authority order — it names the schema as the one place it lives');
});
