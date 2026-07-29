import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'scripts/validate-form.mjs');
const fixture = (n) => join(ROOT, `tests/fixtures/${n}.json`);

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    // execFileSync throws on non-zero exit; the useful bits are still on the error.
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// Exit codes — the one rule that matters most
// ---------------------------------------------------------------------------

test('exits 1 on a Tier 1 fixture', () => {
  const { status } = run([fixture('t1-type-unknown')]);
  assert.equal(status, 1);
});

test('exits 1 on a Tier 2 fixture', () => {
  const { status } = run([fixture('t2-loose-button')]);
  assert.equal(status, 1);
});

test('exits 0 on a fixture with no Tier 1 or Tier 2 findings', () => {
  // NOTE: t1-clean.json (the fixture named in this task's brief) does NOT
  // exit 0 through the full CLI — verified directly: it has zero Tier 1
  // findings (that's what it was built to prove, before Tier 2 existed) but
  // six real, unrelated Tier 2 findings (T2-MODELTYPE-SHAPE,
  // T2-STYLE-INCOMPLETE, T2-FLEX-NO-DISPLAY, T2-WIDTH-ON-NONCONTAINER,
  // T2-EDITMODE-MISMATCH, T2-VALIDATIONERRORS-MISSING) because it predates
  // Tier 2's full layout/modelType/editMode contract and was never a target
  // for those checks. Symmetrically, t2-clean.json is not Tier 1-clean
  // either (its header text's flat fontSize/fontWeight aren't registry
  // props for "text", so T1-PROP-UNKNOWN fires twice). Neither existing
  // "-clean" fixture is clean across BOTH tiers at once, so this test uses
  // a new fixture (t3-cli-clean.json) built to satisfy both, and the next
  // test below asserts the real, current behaviour of t1-clean.json instead
  // of a false expectation.
  const { status } = run([fixture('t3-cli-clean')]);
  assert.equal(status, 0);
});

test('t1-clean.json exits 1 through the full CLI (pre-existing Tier 2 gaps, not a Tier 3/CLI regression)', () => {
  const { status, stdout } = run([fixture('t1-clean'), '--json']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tier1.length, 0, 't1-clean.json should still be Tier-1 clean');
  assert.ok(parsed.tier2.length > 0, 't1-clean.json is not Tier-2 clean (see comment above)');
  assert.equal(status, 1);
});

test('exits 0 on a form with a low Tier 3 score and no Tier 1/2 findings (Tier 3 never blocks)', () => {
  const { status, stdout } = run([fixture('t3-bad-score-clean'), '--json']);
  assert.equal(status, 0, `expected exit 0 regardless of Tier 3 score; stdout was: ${stdout}`);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tier1.length, 0);
  assert.equal(parsed.tier2.length, 0);
  assert.ok(parsed.tier3.score < 60, `expected a low Tier 3 score to prove this fixture is meaningfully bad, got ${parsed.tier3.score}`);
});

test('exits 1 with a clear message (no stack trace) on a nonexistent file', () => {
  const { status, stderr } = run(['tests/fixtures/does-not-exist.json']);
  assert.equal(status, 1);
  assert.match(stderr, /not found/i);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(stderr), `stderr should not contain a stack trace, got: ${stderr}`);
});

test('exits 1 with a clear message (no stack trace) on an unparseable input file', () => {
  const { status, stderr } = run([fixture('t3-malformed')]);
  assert.equal(status, 1);
  assert.match(stderr, /pars/i);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(stderr), `stderr should not contain a stack trace, got: ${stderr}`);
});

test('exits 1 with a clear message (no stack trace) when an overridden asset path does not exist', () => {
  const { status, stderr } = run([fixture('t1-clean'), '--registry', 'tests/fixtures/does-not-exist.json']);
  assert.equal(status, 1);
  assert.match(stderr, /registry/i);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(stderr), `stderr should not contain a stack trace, got: ${stderr}`);
});

// ---------------------------------------------------------------------------
// --json shape
// ---------------------------------------------------------------------------

test('--json output parses and carries the documented keys', () => {
  const { status, stdout } = run([fixture('t3-cli-clean'), '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.exitCode, 0);
  assert.ok(Array.isArray(parsed.tier1));
  assert.ok(Array.isArray(parsed.tier2));
  assert.ok(Array.isArray(parsed.skipped));
  assert.equal(typeof parsed.tier3, 'object');
  assert.equal(typeof parsed.tier3.score, 'number');
  assert.ok(Array.isArray(parsed.tier3.findings));
  assert.equal(typeof parsed.tier3.uncalibrated, 'boolean');
});

test('--json on a Tier 1 fixture reports exitCode 1 and a non-empty tier1 array', () => {
  const { stdout } = run([fixture('t1-type-unknown'), '--json']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.exitCode, 1);
  assert.ok(parsed.tier1.length > 0);
  assert.ok(parsed.tier1.every((f) => f.tier === 1 && f.severity === 'fail'));
});

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

test('human output groups findings by tier and prints a one-line verdict', () => {
  const { stdout } = run([fixture('t1-type-unknown')]);
  assert.match(stdout, /Tier 1/);
  assert.match(stdout, /Tier 2/);
  assert.match(stdout, /Tier 3/);
  assert.match(stdout, /FAIL/);
});

test('human output on a passing form says PASS', () => {
  const { stdout } = run([fixture('t3-cli-clean')]);
  assert.match(stdout, /PASS/);
});
