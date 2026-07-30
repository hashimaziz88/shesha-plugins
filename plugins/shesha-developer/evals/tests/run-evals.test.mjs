import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEvals, loadCasesFromIndex, EVALS_ROOT } from '../run-evals.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNNER = join(ROOT, 'run-evals.mjs');

function loadAllCases() {
  return loadCasesFromIndex();
}

function findCase(id) {
  const kase = loadAllCases().find((c) => c.id === id);
  assert.ok(kase, `expected evals.json to include a case with id "${id}"`);
  return kase;
}

// ---------------------------------------------------------------------------
// evals.json / case index
// ---------------------------------------------------------------------------

test('evals.json indexes at least one case per archetype (8), the flight-details forensic case, and one deliberately-broken case', () => {
  const cases = loadAllCases();
  const ids = cases.map((c) => c.id);

  const archetypeCases = ids.filter((id) => id.startsWith('archetype-'));
  assert.ok(archetypeCases.length >= 8, `expected >=8 archetype cases, found ${archetypeCases.length}: ${archetypeCases.join(', ')}`);

  assert.ok(ids.includes('flight-details-forensic'), 'expected a "flight-details-forensic" case');
  assert.ok(ids.includes('broken-dropdown-missing-source'), 'expected a deliberately-broken case');

  // Every case must declare a threshold and a blueprint path.
  for (const c of cases) {
    assert.equal(typeof c.threshold, 'number', `case "${c.id}" must declare a numeric threshold`);
    assert.equal(typeof c.blueprint, 'string', `case "${c.id}" must declare a blueprint path`);
  }
});

test('the 8 archetype cases reference the committed shesha-design-comprehension blueprint fixtures BY REFERENCE, not by duplicating their content', () => {
  const cases = loadAllCases().filter((c) => c.id.startsWith('archetype-'));
  for (const c of cases) {
    assert.match(
      c.blueprint,
      /^\.\.\/skills\/shesha-design-comprehension\/assets\/blueprint-examples\/.+\.blueprint\.json$/,
      `case "${c.id}" should point at a committed shesha-design-comprehension blueprint fixture, got "${c.blueprint}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Per-case passRate / stddev reporting
// ---------------------------------------------------------------------------

test('runEvals reports a per-case passRate and stddev, plus an overall roll-up', () => {
  const cases = [findCase('archetype-hub')];
  const { results, summary } = runEvals({ cases, runs: 3 });

  assert.equal(results.length, 1);
  const [r] = results;
  assert.equal(typeof r.passRate, 'number');
  assert.equal(typeof r.stddev, 'number');
  assert.equal(r.passRate, 1, 'a known-clean archetype fixture should pass every run');
  assert.equal(r.stddev, 0, 'compileSpec is pure — identical inputs must produce byte-identical (stddev 0) scores');

  assert.equal(typeof summary.overallPassRate, 'number');
  assert.equal(typeof summary.casesPassed, 'number');
  assert.equal(typeof summary.casesFailed, 'number');
  assert.equal(typeof summary.totalCases, 'number');
  assert.equal(summary.totalCases, 1);
});

// ---------------------------------------------------------------------------
// The deliberately-broken case MUST fail
// ---------------------------------------------------------------------------

test('the deliberately-broken case (a dropdown with no dataSourceType) fails — zero passRate, a real T2-DROPDOWN-SOURCE finding', () => {
  const kase = findCase('broken-dropdown-missing-source');
  const { results, summary } = runEvals({ cases: [kase], runs: 2 });
  const [r] = results;

  assert.equal(r.passed, false, 'the broken case must not be reported as passed');
  assert.equal(r.passRate, 0, 'every run of the broken case must fail — it is deliberately, deterministically broken');
  assert.ok(
    r.perRun.every((run) => run.tier2.some((f) => f.code === 'T2-DROPDOWN-SOURCE')),
    'expected every run to carry a genuine T2-DROPDOWN-SOURCE finding, not an unrelated/contrived error',
  );
  // NOTE: this assertion changed when `expectFail` was introduced. The case
  // still FAILS (asserted above — that is the point of it), but because it is
  // marked expectFail its failure is the EXPECTED outcome, so it no longer
  // drags the exit code to 1. Otherwise the harness could never be wired into
  // CI, which would make the canary self-defeating. `asExpected` is what the
  // exit code keys off now; see the expectFail tests at the end of this file.
  assert.equal(summary.casesFailed, 0, 'an expected failure is not an unexpected one');
  assert.equal(summary.casesAsExpected, 1);
  assert.equal(summary.exitCode, 0, 'the canary failing as designed must not fail the run');
});

test('CLI: the full suite exits 0, reporting the broken case as XFAIL', () => {
  // Changed with `expectFail`: the suite used to exit 1 because it contains a
  // deliberately-broken case. That made the exit code useless for CI — it
  // could never be green. The broken case is now reported as XFAIL and the
  // suite exits 0, so a non-zero exit means something genuinely unexpected.
  let exitCode = 0;
  let stdout = '';
  try {
    stdout = execFileSync('node', [RUNNER, '--runs', '1'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    exitCode = err.status;
    stdout = err.stdout ?? '';
  }
  assert.equal(exitCode, 0, `the full suite should be green with its canary XFAILing; stdout:\n${stdout}`);
  assert.match(stdout, /\[XFAIL\] broken-dropdown-missing-source/);
  assert.match(stdout, /RESULT: PASS \(exit 0\)/);
  // The canary must still be visibly failing, not quietly reclassified.
  assert.match(stdout, /T2-DROPDOWN-SOURCE/);
});

test('CLI: running only the passing cases (--case filters out the broken one) exits 0', () => {
  const stdout = execFileSync('node', [RUNNER, '--case', 'flight-details-forensic', '--runs', '1'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(stdout, /RESULT: PASS \(exit 0\)/);
});

// ---------------------------------------------------------------------------
// --runs N genuinely runs N times and aggregates
// ---------------------------------------------------------------------------

test('--runs N actually performs N independent compile+validate cycles, not one cached result', () => {
  const cases = [findCase('archetype-wizard')];

  const single = runEvals({ cases, runs: 1 });
  const five = runEvals({ cases, runs: 5 });

  assert.equal(single.results[0].perRun.length, 1, 'runs:1 should produce exactly 1 per-run record');
  assert.equal(five.results[0].perRun.length, 5, 'runs:5 should produce exactly 5 per-run records, not 1');
  assert.equal(five.results[0].scores.length, 5);
  // Every one of the 5 independently-executed runs must itself be a genuine
  // pass (each run re-invokes compileSpec/tier1/tier2/tier3 from scratch).
  assert.ok(five.results[0].perRun.every((r) => r.pass === true));
  assert.equal(five.summary.runs, 5);
});

test('runEvals defaults to 3 runs when `runs` is omitted', () => {
  const cases = [findCase('archetype-list-card')];
  const { results } = runEvals({ cases });
  assert.equal(results[0].perRun.length, 3);
});

// ---------------------------------------------------------------------------
// A case referencing a missing blueprint fails loudly, not silently
// ---------------------------------------------------------------------------

test('a case referencing a missing blueprint fails loudly with a clear, specific message', () => {
  const badCase = {
    id: 'test-missing-blueprint',
    description: 'synthetic case for the missing-blueprint-file test',
    archetype: 'hub',
    blueprint: 'fixtures/this-file-does-not-exist.blueprint.json',
    threshold: 80,
  };
  const { results, summary } = runEvals({ cases: [badCase], runs: 1 });
  const [r] = results;

  assert.equal(r.passed, false, 'a case whose blueprint file does not exist must never be reported as passed');
  assert.ok(r.error, 'expected a non-null, human-readable error message');
  assert.match(r.error, /blueprint not found/i);
  assert.match(r.error, /this-file-does-not-exist\.blueprint\.json/);
  assert.match(r.error, /test-missing-blueprint/);
  assert.equal(summary.exitCode, 1);

  // And it must not silently report a score/pass as if nothing were wrong.
  assert.equal(r.perRun[0].score, null);
  assert.equal(r.perRun[0].pass, false);
});

test('loadCasesFromIndex itself throws loudly when evals.json references a case file that does not exist', () => {
  // Point the loader at a throwaway index that references a nonexistent case
  // file, proving the failure mode is a clear thrown Error, not a silent
  // empty/partial case list.
  // `require` is not defined in an ES module — these are imported at the top
  // of this file alongside the other node: builtins.
  const tmpDir = mkdtempSync(join(tmpdir(), 'evals-missing-index-'));
  const indexPath = join(tmpDir, 'evals.json');
  writeFileSync(indexPath, JSON.stringify({ cases: ['cases/does-not-exist.json'] }), 'utf8');

  assert.throws(
    () => loadCasesFromIndex(indexPath),
    /does not exist/,
  );
});

// ---------------------------------------------------------------------------
// --json output parses and carries the documented keys
// ---------------------------------------------------------------------------

test('--json output parses as JSON and carries the documented {results, summary} keys', () => {
  const stdout = execFileSync('node', [RUNNER, '--case', 'archetype-dashboard', '--runs', '2', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(stdout);

  assert.ok(Array.isArray(parsed.results));
  assert.equal(parsed.results.length, 1);
  const [r] = parsed.results;
  assert.equal(typeof r.passRate, 'number');
  assert.equal(typeof r.stddev, 'number');
  assert.ok(Array.isArray(r.perRun));
  assert.equal(r.perRun.length, 2);

  const { summary } = parsed;
  assert.equal(typeof summary.totalCases, 'number');
  assert.equal(typeof summary.casesPassed, 'number');
  assert.equal(typeof summary.casesFailed, 'number');
  assert.equal(typeof summary.overallPassRate, 'number');
  assert.equal(typeof summary.exitCode, 'number');
});

// ---------------------------------------------------------------------------
// Exit 0 when everything passes
// ---------------------------------------------------------------------------

test('runEvals over every non-broken case exits 0 (summary.exitCode === 0)', () => {
  const cases = loadAllCases().filter((c) => c.id !== 'broken-dropdown-missing-source');
  const { summary } = runEvals({ cases, runs: 1 });
  assert.equal(summary.casesFailed, 0, `expected no failures among: ${summary.failedCaseIds.join(', ')}`);
  assert.equal(summary.exitCode, 0);
});

test('EVALS_ROOT points at this evals/ directory (case/blueprint paths resolve relative to it, not the caller cwd)', () => {
  assert.equal(EVALS_ROOT.replaceAll('\\', '/').split('/').pop(), 'evals');
});

// ---------------------------------------------------------------------------
// expectFail — the canary flag
//
// A case marked `expectFail` exists to prove the harness can fail at all.
// Its FAILING is the correct outcome, so it must not drag the exit code to 1
// (otherwise the harness could never be wired into CI, which would make the
// canary self-defeating). Equally, if it ever PASSES, the harness has lost
// its teeth and that must be a hard failure.
// ---------------------------------------------------------------------------

test('an expectFail case that fails is asExpected and does NOT fail the run', () => {
  const broken = loadAllCases().find((c) => c.expectFail === true);
  assert.ok(broken, 'no expectFail case is shipped — the harness has no canary');

  const { results, summary } = runEvals({ cases: [broken], runs: 1 });
  const r = results[0];
  assert.equal(r.passed, false, 'the canary must actually fail');
  assert.equal(r.expectFail, true);
  assert.equal(r.asExpected, true, 'a failing canary is the expected outcome');
  assert.equal(summary.exitCode, 0, 'an expected failure must not fail the run');
});

test('an expectFail case that PASSES fails the run (the canary died)', () => {
  // Invert a known-good case: mark a clean archetype expectFail. It will pass,
  // which for an expectFail case is wrong, so the run must go red.
  const clean = loadAllCases().find((c) => !c.expectFail);
  assert.ok(clean, 'no ordinary case to invert');

  const { results, summary } = runEvals({ cases: [{ ...clean, expectFail: true }], runs: 1 });
  const r = results[0];
  assert.equal(r.passed, true);
  assert.equal(r.asExpected, false, 'a passing canary is NOT the expected outcome');
  assert.equal(summary.exitCode, 1, 'a dead canary must fail the run');
});

test('the shipped suite as a whole exits 0 with its canary failing', () => {
  const { summary } = runEvals({ cases: loadAllCases(), runs: 1 });
  assert.equal(summary.casesAsExpected, summary.totalCases,
    `unexpected cases: ${summary.failedCaseIds.join(', ')}`);
  assert.equal(summary.exitCode, 0);
  assert.ok(summary.casesPassed < summary.totalCases,
    'every case passed — the canary is not failing, so the harness is not proving anything');
});
