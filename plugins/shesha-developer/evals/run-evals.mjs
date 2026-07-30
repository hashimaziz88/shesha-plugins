#!/usr/bin/env node
/**
 * evals/run-evals.mjs — the evals harness runner.
 *
 * WHAT THIS MEASURES (read this before trusting a green run): an eval case
 * supplies a *blueprint* (../skills/shesha-design-comprehension/assets/
 * blueprint-examples/*.blueprint.json, or a fixture under evals/fixtures/).
 * The harness composes the SAME tooling a real build uses —
 * compileSpec() (../skills/shesha-form-edit/scripts/compile-spec.mjs) then
 * tier1/tier2/tier3 (../skills/shesha-form-edit/scripts/lib/tier{1,2,3}.mjs,
 * the exact functions validate-form.mjs's CLI calls) — and asserts the
 * validator's OWN verdict: zero Tier 1 + Tier 2 findings, and a Tier 3 score
 * at or above the case's own threshold. No model ever grades its own work
 * here; the assertion is mechanical and reproducible by construction.
 *
 * WHAT THIS DOES NOT MEASURE: compileSpec() is a pure function over its
 * blueprint input, so compiling the same blueprint N times is byte-identical
 * — stddev over identical runs is correctly, expectedly 0. That is NOT
 * evidence a real agent (which authors the blueprint, or the markup, from a
 * prompt) is consistent — it only proves the deterministic compiler/validator
 * chain downstream of a blueprint has zero variance of its own. Measuring
 * *model* variance would mean driving a real agent per run and grading N
 * independently-authored blueprints/forms; this harness deliberately does not
 * do that (see README.md). Today it establishes the objective floor: given
 * an already-fixed blueprint, does the tooling reproduce a clean, scored
 * build every time.
 *
 * `runEvals({cases, runs}) => {results, summary}` is also directly
 * importable (see evals/tests/run-evals.test.mjs).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../skills/shesha-form-edit/scripts/compile-spec.mjs';
import { tier1 } from '../skills/shesha-form-edit/scripts/lib/tier1.mjs';
import { tier2 } from '../skills/shesha-form-edit/scripts/lib/tier2.mjs';
import { tier3 } from '../skills/shesha-form-edit/scripts/lib/tier3.mjs';
import { loadFlow } from '../skills/shesha-form-edit/scripts/lib/flow.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EVALS_ROOT = HERE;

const DEFAULT_EVALS_INDEX = join(HERE, 'evals.json');
const DEFAULT_REGISTRY_PATH = join(HERE, '../skills/shesha-form-edit/assets/registry/registry-0.45.1.json');
const DEFAULT_ROLES_PATH = join(HERE, '../skills/shesha-design-system/assets/roles.styles.json');
const DEFAULT_TOKENS_PATH = join(HERE, '../skills/shesha-design-system/assets/themes/shesha.tokens.json');
const DEFAULT_THRESHOLDS_PATH = join(HERE, '../skills/shesha-form-edit/assets/thresholds.json');
const DEFAULT_FLOWS_DIR = join(HERE, '../skills/shesha-form-edit/assets/archetypes');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Everything the compile+validate pipeline needs, loaded once and shared
 * across every case/run — loading these is deterministic and identical for
 * every case, so re-reading them per run would only add noise, never signal.
 */
export function loadSharedAssets(opts = {}) {
  return {
    registry: opts.registry ?? readJson(DEFAULT_REGISTRY_PATH),
    roles: opts.roles ?? readJson(DEFAULT_ROLES_PATH),
    tokens: opts.tokens ?? readJson(DEFAULT_TOKENS_PATH),
    thresholds: opts.thresholds ?? (existsSync(DEFAULT_THRESHOLDS_PATH) ? readJson(DEFAULT_THRESHOLDS_PATH) : { calibrated: false }),
    flowsDir: opts.flowsDir ?? DEFAULT_FLOWS_DIR,
  };
}

/**
 * Loads evals.json (the case index) and resolves each entry to its full
 * case definition from evals/cases/*.json. Every path inside a case
 * definition (blueprint) is resolved relative to EVALS_ROOT (this
 * directory), never the caller's cwd — same discipline as
 * validate-form.mjs's own default asset paths.
 */
export function loadCasesFromIndex(indexPath = DEFAULT_EVALS_INDEX) {
  if (!existsSync(indexPath)) {
    throw new Error(`evals index not found: "${indexPath}".`);
  }
  const index = readJson(indexPath);
  const entries = Array.isArray(index.cases) ? index.cases : [];
  return entries.map((entry) => {
    const caseFile = join(HERE, entry);
    if (!existsSync(caseFile)) {
      throw new Error(`evals.json references a case file that does not exist: "${entry}" (resolved: "${caseFile}").`);
    }
    const def = readJson(caseFile);
    return { ...def, _caseFile: entry };
  });
}

/**
 * Runs ONE case exactly once through the real pipeline: load blueprint ->
 * compileSpec -> tier1/tier2/tier3. Never throws — any failure (missing
 * blueprint file, malformed JSON, a schema-invalid blueprint, an archetype
 * with no flow manifest) is captured into the returned record's `error`
 * field with a message naming exactly what went wrong, so a broken case
 * fails loudly in the report rather than silently vanishing from it.
 */
function runCaseOnce(kase, assets, runIndex) {
  const record = { run: runIndex, pass: false, score: null, tier1Count: null, tier2Count: null, tier1: [], tier2: [], error: null };

  const blueprintRel = kase.blueprint;
  if (!blueprintRel) {
    record.error = `case "${kase.id}" has no "blueprint" field.`;
    return record;
  }
  const blueprintPath = join(HERE, blueprintRel);
  if (!existsSync(blueprintPath)) {
    record.error = `blueprint not found for case "${kase.id}": "${blueprintRel}" (resolved: "${blueprintPath}"). Fix the case's "blueprint" path.`;
    return record;
  }

  let blueprint;
  try {
    blueprint = readJson(blueprintPath);
  } catch (err) {
    record.error = `blueprint at "${blueprintRel}" for case "${kase.id}" is not valid JSON — ${err.message}`;
    return record;
  }

  if (kase.archetype && blueprint.archetype && kase.archetype !== blueprint.archetype) {
    record.error = `case "${kase.id}" declares archetype "${kase.archetype}" but its blueprint "${blueprintRel}" declares "${blueprint.archetype}" — fix whichever one is stale.`;
    return record;
  }
  const archetype = kase.archetype ?? blueprint.archetype;

  let flow = null;
  try {
    if (archetype && existsSync(join(assets.flowsDir, `${archetype}.flow.json`))) {
      flow = loadFlow(archetype, { dir: assets.flowsDir });
    }
  } catch (err) {
    record.error = `could not load flow manifest for archetype "${archetype}" (case "${kase.id}") — ${err.message}`;
    return record;
  }
  const flows = flow ? { [archetype]: flow } : {};

  let markup;
  try {
    ({ markup } = compileSpec(blueprint, { registry: assets.registry, roles: assets.roles, tokens: assets.tokens }));
  } catch (err) {
    record.error = `compileSpec failed for case "${kase.id}" (blueprint "${blueprintRel}") — ${err.message}`;
    return record;
  }

  const t1 = tier1(markup, { registry: assets.registry });
  const t2Raw = tier2(markup, { registry: assets.registry, roles: assets.roles, flows, archetype });
  const t2 = t2Raw.filter((f) => f.severity !== 'skip');
  const t3 = tier3(markup, { registry: assets.registry, thresholds: assets.thresholds });

  const threshold = typeof kase.threshold === 'number' ? kase.threshold : 0;
  record.score = t3.score;
  record.tier1Count = t1.length;
  record.tier2Count = t2.length;
  record.tier1 = t1;
  record.tier2 = t2;
  record.pass = t1.length === 0 && t2.length === 0 && t3.score >= threshold;
  return record;
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums) {
  if (!nums.length) return null;
  const m = mean(nums);
  const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * @param {{cases: object[], runs?: number}} opts - `cases` are fully-resolved
 *   case definitions (as returned by loadCasesFromIndex), `runs` is how many
 *   times EACH case is independently compiled+validated (default 3).
 * @returns {{results: object[], summary: object}}
 */
export function runEvals({ cases, runs = 3 } = {}) {
  if (!Array.isArray(cases)) {
    throw new Error('runEvals({cases, runs}) requires cases: an array of case definitions.');
  }
  const n = Number.isInteger(runs) && runs > 0 ? runs : 3;
  const assets = loadSharedAssets();

  const results = cases.map((kase) => {
    const perRun = [];
    for (let i = 1; i <= n; i++) {
      perRun.push(runCaseOnce(kase, assets, i));
    }
    const scores = perRun.filter((r) => typeof r.score === 'number').map((r) => r.score);
    const passCount = perRun.filter((r) => r.pass).length;
    const passRate = perRun.length ? passCount / perRun.length : 0;
    const passed = passRate === 1;
    const firstError = perRun.find((r) => r.error)?.error ?? null;

    // A case marked `expectFail` is a canary: it exists to prove the harness
    // can fail at all. Its FAILING is the correct outcome, so `asExpected` —
    // not `passed` — is what decides the exit code. Without this the harness
    // would always exit 1 and could never be wired into CI, which would make
    // the canary self-defeating. The inverse matters just as much: if an
    // expectFail case ever PASSES, the harness has lost its teeth and that
    // must be a hard failure, not a quiet success.
    const expectFail = kase.expectFail === true;
    const asExpected = expectFail ? !passed : passed;

    return {
      id: kase.id,
      description: kase.description ?? null,
      archetype: kase.archetype ?? null,
      blueprint: kase.blueprint,
      threshold: typeof kase.threshold === 'number' ? kase.threshold : 0,
      runs: n,
      perRun,
      scores,
      meanScore: mean(scores),
      stddev: stddev(scores),
      passRate,
      passed,
      expectFail,
      asExpected,
      error: firstError,
    };
  });

  const totalCases = results.length;
  const casesPassed = results.filter((r) => r.passed).length;
  const casesAsExpected = results.filter((r) => r.asExpected).length;
  const casesFailed = totalCases - casesAsExpected;
  const failedCaseIds = results.filter((r) => !r.asExpected).map((r) => r.id);
  const allStddevs = results.map((r) => r.stddev).filter((v) => typeof v === 'number');
  const meanStddev = allStddevs.length ? mean(allStddevs) : null;

  const summary = {
    totalCases,
    casesPassed,
    casesAsExpected,
    casesFailed,
    failedCaseIds,
    overallPassRate: totalCases ? casesPassed / totalCases : 0,
    meanStddev,
    runs: n,
    exitCode: casesFailed === 0 && totalCases > 0 ? 0 : 1,
  };

  return { results, summary };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { runs: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') opts.case = argv[++i];
    else if (a === '--runs') opts.runs = parseInt(argv[++i], 10);
    else if (a === '--json') opts.json = true;
  }
  return opts;
}

function printHuman({ results, summary }) {
  console.log(`Evals harness — ${summary.runs} run(s) per case, ${summary.totalCases} case(s)\n`);
  for (const r of results) {
    // Four states, not two: an expectFail case that fails is XFAIL (correct),
    // and one that passes is XPASS (the canary died — a hard failure).
    let verdict;
    if (r.expectFail) verdict = r.passed ? 'XPASS' : 'XFAIL';
    else verdict = r.passed ? 'PASS' : 'FAIL';

    const scoreStr = r.scores.length ? `score ${r.meanScore.toFixed(1)} (stddev ${r.stddev.toFixed(2)})` : 'score n/a';
    console.log(`[${verdict}] ${r.id} — passRate ${(r.passRate * 100).toFixed(0)}% — ${scoreStr} — threshold ${r.threshold}`);
    if (r.description) console.log(`    ${r.description}`);
    if (verdict === 'XPASS') {
      console.log('    THE CANARY DIED: this case is marked expectFail and was supposed to fail. '
        + 'It now passes, which means the harness has lost its teeth — investigate before trusting any green run.');
    }
    if (!r.passed) {
      if (r.error) {
        console.log(`    ERROR: ${r.error}`);
      } else {
        const bad = r.perRun.find((run) => !run.pass);
        if (bad) {
          console.log(`    run ${bad.run}: Tier1 ${bad.tier1Count} finding(s), Tier2 ${bad.tier2Count} finding(s), Tier3 score ${bad.score} (threshold ${r.threshold})`);
          for (const f of [...bad.tier1, ...bad.tier2]) {
            console.log(`      [${f.code}] ${f.path} — ${f.message}`);
          }
        }
      }
    }
    console.log();
  }
  const xfail = results.filter((r) => r.expectFail).length;
  console.log('--- summary ---');
  console.log(`cases behaving as expected: ${summary.casesAsExpected}/${summary.totalCases}`
    + (xfail ? `  (of which ${xfail} expected-to-fail)` : ''));
  if (summary.failedCaseIds.length) console.log(`unexpected: ${summary.failedCaseIds.join(', ')}`);
  console.log(`mean stddev across cases: ${summary.meanStddev === null ? 'n/a' : summary.meanStddev.toFixed(3)}`);
  console.log(
    summary.exitCode === 0
      ? `RESULT: PASS (exit 0) — all ${summary.totalCases} case(s) behaved as expected across ${summary.runs} run(s).`
      : `RESULT: FAIL (exit 1) — ${summary.casesFailed} of ${summary.totalCases} case(s) did not behave as expected.`,
  );
}

function runCli(argv) {
  const opts = parseArgs(argv.slice(2));
  let cases = loadCasesFromIndex();
  if (opts.case) {
    cases = cases.filter((c) => c.id === opts.case);
    if (!cases.length) {
      console.error(`Error: no case with id "${opts.case}" found in evals.json.`);
      process.exit(1);
    }
  }
  const { results, summary } = runEvals({ cases, runs: opts.runs });

  if (opts.json) {
    console.log(JSON.stringify({ results, summary }, null, 2));
  } else {
    printHuman({ results, summary });
  }
  process.exit(summary.exitCode);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv);
}
