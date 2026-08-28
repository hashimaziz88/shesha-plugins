// T5 (§3.6) with NO model. Every path runs against an injected judge function, so the
// anchor protocol, the rubric binding, the independence whitelist, the round cap and the
// unblended vector are all executable here rather than described.
//
// The builder self-report token is assembled at runtime in this file too: a test that
// carries the contiguous literal would itself be the leak the isolation gate looks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verdictOf, EXIT } from '@shesha/registry/coverage';
import { runLadder } from '../src/verify.mjs';
import {
  t5Visual, placeAnchor, stubJudge, selftestContext, checks, mutations,
} from '../src/tiers/t5-visual.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TIER = path.join(ROOT, 'packages/verify/src/tiers/t5-visual.mjs');
const LEAK = `__SAA${'_RESULT__'}`;

/** @param {any[]} fams @param {string} name */
const fam = (fams, name) => fams.find((f) => f.name === name);
/** @param {any} ctx */
const run = (ctx) => t5Visual(ctx.input, ctx);
/** @param {any} ctx @param {number[]} vector @param {any} [extra] */
function judgeWith(ctx, vector, extra = {}) {
  const { anchorName } = placeAnchor(ctx.input, ctx.rng);
  const axisIds = ctx.rubric.axes.map((/** @type {any} */ a) => String(a.id));
  return stubJudge({ anchorName, vector, axisIds, ...extra });
}
/** Every numeric value anywhere in `v`. @param {any} v @returns {number[]} */
function numbersIn(v) {
  /** @type {number[]} */
  const out = [];
  /** @param {any} x */
  const rec = (x) => {
    if (typeof x === 'number') { out.push(x); return; }
    if (Array.isArray(x)) { for (const y of x) rec(y); return; }
    if (x && typeof x === 'object') for (const k of Object.keys(x)) rec(x[k]);
  };
  rec(v);
  return out;
}
/** Every key name anywhere in `v`. @param {any} v @returns {string[]} */
function keysIn(v) {
  /** @type {string[]} */
  const out = [];
  /** @param {any} x */
  const rec = (x) => {
    if (Array.isArray(x)) { for (const y of x) rec(y); return; }
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) { out.push(k); rec(x[k]); }
  };
  rec(v);
  return out;
}

test('the clean self-test context passes every check', () => {
  const out = run(selftestContext('excellent'));
  assert.equal(verdictOf(out.families), 'pass');
  assert.equal(out.t5.result, 'pass');
  assert.equal(out.t5.rank, 'excellent');
  assert.equal(out.exit, EXIT.pass);
  for (const c of checks) {
    const f = fam(out.families, c.family);
    assert.ok(f, `check ${c.id} names family ${c.family}, which the tier does not declare`);
    assert.ok(f.walked > 0 && f.checked > 0, `${c.id}: family ${c.family} walked ${f.walked} and checked ${f.checked}`);
  }
});

test('a judge that ranks the anchor second is disqualified and T5 reports notRun', () => {
  const ctx = selftestContext('excellent');
  ctx.judge = judgeWith(ctx, [5, 5, 4, 5, 4], { anchorFirst: false });
  const out = run(ctx);

  assert.equal(out.t5.result, 'notRun');
  assert.equal(out.t5.reason, `judge ${ctx.input.model} anchor accuracy 0.00 < 0.9`);
  assert.match(out.t5.reason, /^judge .+ anchor accuracy [0-9]\.[0-9]{2} < 0\.9$/);
  assert.equal(out.t5.anchorRankedFirst, false);
  assert.equal(out.t5.rank, null, 'a disqualified judge must produce no rank at all');
  assert.equal(out.advisory.rank, undefined);
  // Every axis is discarded unread, not scored and then ignored.
  assert.deepEqual(out.t5.vector, [null, null, null, null, null]);
  const rubricFam = fam(out.families, 'rubric');
  assert.equal(rubricFam.uninspectable.length, 10);
  for (const u of rubricFam.uninspectable) assert.match(String(u.checkId), /^T5\.0[34]$/);
  const qual = fam(out.families, 'qualification');
  assert.ok(qual.failures.some((/** @type {any} */ x) => /^T5\.01/.test(x.reason)));
  assert.equal(out.exit, EXIT.pass, 'disqualification is still not a gate (D-015)');
});

test('anchor position is randomised and carries no provenance in the prompt', () => {
  const ctx = selftestContext('excellent');
  const positions = new Set();
  for (const draw of [0.0, 0.3, 0.6, 0.99]) {
    const p = placeAnchor(ctx.input, () => draw);
    positions.add(p.position);
    assert.equal(p.staging.length, 4, 'the anchor protocol shows exactly K = 4 candidates');
    assert.equal(p.anchorName, `candidate-${p.position + 1}`);
  }
  assert.equal(positions.size, 4, 'the anchor must be able to land in any of the four slots');

  for (const draw of [0.0, 0.3, 0.6, 0.99]) {
    const out = t5Visual(ctx.input, { ...ctx, rng: () => draw, judge: judgeWith({ ...ctx, rng: () => draw }, [5, 5, 4, 5, 4]) });
    const text = JSON.stringify(out.prompt);
    // Identical naming, identical metadata, no source path, no role word.
    assert.deepEqual(out.prompt.candidates.map((/** @type {any} */ c) => c.name), ['candidate-1', 'candidate-2', 'candidate-3', 'candidate-4']);
    for (const c of out.prompt.candidates) assert.deepEqual(Object.keys(c), ['name', 'image']);
    for (const s of out.placement.staging) assert.equal(text.includes(s.from), false, `the prompt names the source ${s.from}`);
    assert.equal(text.includes('anchor'), false, 'the word anchor appears in the prompt');
    assert.equal(text.includes('distractor'), false);
    assert.equal(fam(out.families, 'independence').failures.length, 0);
  }
});

test('an axis score with empty evidence is discarded as uninspectable', () => {
  const ctx = selftestContext('excellent');
  const inner = judgeWith(ctx, [5, 5, 4, 5, 4]);
  ctx.judge = (/** @type {any} */ prompt) => {
    const v = inner(prompt);
    for (const n of Object.keys(v.scores)) v.scores[n].alignment.evidence = '   ';
    return v;
  };
  const out = run(ctx);

  assert.equal(verdictOf(out.families), 'partial', 'a discarded axis is partial, never a pass');
  const rubricFam = fam(out.families, 'rubric');
  assert.equal(rubricFam.failures.length, 0);
  assert.equal(rubricFam.uninspectable.length, 1);
  assert.equal(rubricFam.uninspectable[0].checkId, 'T5.04');
  assert.match(rubricFam.uninspectable[0].reason, /cites no evidence/);
  // The score itself is gone from the vector, not merely annotated.
  const alignment = out.t5.axes.find((/** @type {any} */ a) => a.axis === 'alignment');
  assert.equal(alignment.retained, false);
  assert.equal(alignment.score, null);
  assert.equal(out.t5.vector[2], null);
  assert.equal(out.t5.vector.filter((/** @type {any} */ v) => v !== null).length, 4);
});

test('the judge prompt never contains the builder self-report even when the run dir has one', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 't5-runcheck-'));
  try {
    fs.mkdirSync(path.join(runDir, 'screens'), { recursive: true });
    const report = path.join(runDir, 'screens', 'selftest.builder.json');
    fs.writeFileSync(report, JSON.stringify({ [LEAK]: { claim: 'all green', selfVerification: true, builderClaim: 'shipped' } }, null, 2));
    assert.equal(fs.readFileSync(report, 'utf8').includes(LEAK), true, 'the fixture must actually contain the token');

    const ctx = selftestContext('excellent');
    // A careless caller hands the tier the run dir AND the self-report inline.
    ctx.input.runDir = runDir;
    /** @type {any} */ (ctx.input).selfReport = { [LEAK]: 'all green', builderClaim: 'shipped' };
    /** @type {any} */ (ctx.input).selfVerification = true;
    const out = run(ctx);

    const text = JSON.stringify(out.prompt);
    assert.equal(text.includes(LEAK), false);
    assert.equal(text.includes('selfVerification'), false);
    assert.equal(text.includes('builderClaim'), false);
    assert.equal(text.includes('self-report'), false);
    assert.equal(text.includes(runDir), false, 'the prompt names the run dir');
    assert.equal(text.includes(report), false);
    // The whitelist is the mechanism: nothing else survives the copy.
    assert.deepEqual(Object.keys(out.prompt), ['screen', 'rubric', 'candidates', 'targetDesign']);
    const ind = fam(out.families, 'independence');
    assert.equal(ind.failures.length, 0);
    assert.ok(ind.checked > 0);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('a fourth round exits 2', () => {
  const ctx = selftestContext('excellent');
  ctx.input.round = 4;
  const out = run(ctx);
  assert.equal(out.exit, EXIT.usage);
  assert.equal(out.exit, 2);
  assert.equal(out.message, 'round cap 3 exceeded');
  assert.equal(out.t5.result, 'notRun');
  assert.equal(out.t5.reason, 'round cap 3 exceeded');
  assert.ok(fam(out.families, 'rounds').failures.some((/** @type {any} */ x) => /round cap 3 exceeded/.test(x.reason)));

  // The third round is still admitted, so the cap is a cap and not an off-by-one.
  const third = selftestContext('excellent');
  third.input.round = 3;
  third.judge = judgeWith(third, [5, 5, 4, 5, 4]);
  assert.equal(run(third).exit, EXIT.pass);

  // And the real process exits 2, not just the function.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't5-round-'));
  try {
    const file = path.join(dir, 'input.json');
    const seed = selftestContext('excellent');
    fs.writeFileSync(file, JSON.stringify({ ...seed.input, round: 4, judgeVerdict: { ranking: [], scores: {} } }, null, 2));
    let status = 0;
    try {
      execFileSync(process.execPath, [TIER, file], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      status = Number(/** @type {any} */ (e).status);
    }
    assert.equal(status, 2, 'the fourth invocation must exit 2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no blended total appears anywhere in t5.json', () => {
  const ctx = selftestContext('excellent');
  // Five distinct scores, so a sum (15) or a mean would be unmistakable if either existed.
  ctx.judge = judgeWith(ctx, [5, 4, 3, 2, 1]);
  const out = run(ctx);

  assert.deepEqual(out.t5.vector, [5, 4, 3, 2, 1]);
  assert.equal(out.t5.rank, 'broken', 'the rank is the worst axis, so a strong axis buys nothing');

  const banned = /^(total|totals|totalscore|overall|overallscore|composite|compositescore|blend|blended|weighted|weightedtotal|weightedscore|aggregate|average|avg|mean|sum|finalscore)$/i;
  const offending = keysIn(out.t5).filter((k) => banned.test(k));
  assert.deepEqual(offending, [], `t5.json carries blended key(s): ${offending.join(', ')}`);
  assert.equal(numbersIn(out.t5).includes(15), false, 'the sum of the vector appears as a value in t5.json');
  // The advisory that reaches verdict.advisory.t5 is equally unblended.
  assert.deepEqual(keysIn(out.advisory).filter((k) => banned.test(k)), []);
  assert.ok(out.advisory.notes.length <= 600);
});

test('t5 exits 0 on a fail-grade score', () => {
  for (const grade of ['excellent', 'acceptable', 'generic', 'broken']) {
    const ctx = selftestContext(grade);
    const out = run(ctx);
    assert.equal(out.exit, EXIT.pass, `${grade} must still exit 0`);
    assert.equal(out.exit, 0);
  }
  const worst = run(selftestContext('broken'));
  assert.equal(worst.t5.rank, 'broken');
  assert.equal(worst.exit, 0);

  // The CLI honours the same rule across every grade it exercises, including the worst.
  const raw = execFileSync(process.execPath, [TIER, '--selftest', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.exit, 0);
  assert.equal(parsed.grades.length, 5);
  assert.ok(parsed.grades.some((/** @type {any} */ g) => g.grade === 'broken' && g.rank === 'broken' && g.exit === 0));
  assert.ok(parsed.grades.some((/** @type {any} */ g) => g.grade === 'disqualified' && g.result === 'notRun' && g.exit === 0));
});

test('verdict.result is byte-identical whether t5 reports the best or the worst possible score vector', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 't5-ladder-'));
  try {
    const { verdict } = await runLadder({
      root: ROOT, runDir, screen: 'inline-editable-table', tiers: ['t1', 't2', 't3'], legacy: false, metadata: null,
    });

    // The result reduction verify.mjs performs: T1..T3 only, over pass < partial < fail.
    // T4 and T5 are not in RESULT_TIERS, which is the whole of D-015.
    const RESULT_TIERS = ['T1', 'T2', 'T3'];
    const LATTICE = /** @type {Record<string, number>} */ ({ pass: 0, partial: 1, fail: 2 });
    /** @param {Record<string, any>} tiers */
    const resultOf = (tiers) => {
      let result = 'pass';
      for (const t of RESULT_TIERS) {
        const r = tiers[t] && tiers[t].result;
        if (r === 'notRun') { result = 'fail'; continue; }
        if (Number(LATTICE[r]) > Number(LATTICE[result])) result = r;
      }
      return result;
    };

    const best = run({ ...selftestContext('excellent'), judge: judgeWith(selftestContext('excellent'), [5, 5, 5, 5, 5]) });
    const worstCtx = selftestContext('broken');
    const worst = run({ ...worstCtx, judge: judgeWith(worstCtx, [1, 1, 1, 1, 1]) });
    assert.equal(best.t5.rank, 'excellent');
    assert.equal(worst.t5.rank, 'broken');
    assert.notDeepEqual(best.t5.vector, worst.t5.vector, 'the two runs must actually differ');

    /** @param {any} t5 @param {any} advisory */
    const withT5 = (t5, advisory) => ({
      ...verdict,
      tiers: { ...verdict.tiers, T5: { result: t5.result, detail: { advisory } } },
      advisory: { t5: advisory },
    });
    const a = withT5(best.t5, best.advisory);
    const b = withT5(worst.t5, worst.advisory);

    assert.equal(JSON.stringify(resultOf(a.tiers)), JSON.stringify(resultOf(b.tiers)));
    assert.equal(JSON.stringify(resultOf(a.tiers)), JSON.stringify(verdict.result));
    assert.notEqual(JSON.stringify(a.advisory), JSON.stringify(b.advisory), 'the advisory must differ while the result does not');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('every check id is covered by a mutation, and every mutation flips its own family', () => {
  const covered = new Set(mutations.flatMap((m) => m.covers));
  assert.deepEqual(checks.filter((c) => !covered.has(c.id)).map((c) => c.id), []);
  assert.ok(mutations.length >= 2);

  for (const m of mutations) {
    const ctx = selftestContext('excellent');
    ctx.judge = judgeWith(ctx, [5, 5, 4, 5, 4]);
    m.apply(ctx);
    const out = run(ctx);
    const f = fam(out.families, m.expectFamily);
    assert.ok(f, `${m.name}: family ${m.expectFamily} is not declared`);
    const caught = m.expect === 'partial' ? f.uninspectable.length > 0 : f.failures.length > 0;
    assert.ok(caught, `mutation "${m.name}" was not caught by ${m.expectFamily}`);
    if (m.expect === 'fail') assert.equal(verdictOf(out.families), 'fail', `"${m.name}" did not flip the tier verdict`);
    assert.ok(out.exit === EXIT.pass || out.exit === EXIT.usage);
  }
});
