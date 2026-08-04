// CONTRACT TESTS — snapshot policy (rebuild target, expected RED today).
//
// tests/pipeline.test.mjs currently does this on a snapshot miss:
//
//     if (!fs.existsSync(snapFile)) {
//       fs.mkdirSync(SNAPSHOTS, { recursive: true });
//       fs.writeFileSync(snapFile, actual);
//       console.log(`  recorded snapshot ...`);
//       return;                                   // <- and the test PASSES
//     }
//
// So a fixture whose snapshot is absent — a NEW fixture, a renamed theme, a
// deleted snapshot — cannot fail. The suite writes whatever the compiler produced
// and reports green. A snapshot that records itself proves nothing.
//
// Contract:
//   1. Snapshot comparison lives in ONE importable helper, so the policy is
//      implemented once rather than inlined per test file.
//   2. A missing snapshot FAILS by default. Recording is an explicit, opt-in act
//      (UPDATE_SNAPSHOTS=1).
//   3. A plain `npm test` never mutates a tracked file.
//
// Note on method: (1) and (2) are tested behaviourally against the target helper.
// (3) is asserted twice — at source level (the fast signal: no unguarded write path
// in pipeline.test.mjs) and by direct observation (fingerprint the snapshot directory,
// run the main suite, fingerprint again). The observation is the authority; the
// source check is what tells you WHERE when it fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..', '..');
const PIPELINE_TEST = path.join(SKILL, 'tests', 'pipeline.test.mjs');
// Target: the single snapshot helper the whole suite must go through.
const HELPER = path.join(SKILL, 'tests', 'lib', 'snapshot.mjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-policy-'));

const loadHelper = async () => {
  let mod = null;
  try { mod = await import(pathToFileURL(HELPER).href); } catch (err) {
    assert.fail(
      `tests/lib/snapshot.mjs does not exist or does not load (${err.code ?? err.message}).\n` +
      'Snapshot comparison must live in ONE importable helper — today the policy is inlined in ' +
      'pipeline.test.mjs, where "missing snapshot" is a silent auto-record.');
  }
  assert.equal(typeof mod.compareSnapshot, 'function',
    'the helper must export compareSnapshot(name, actual, { dir }) — the single entry point for snapshot policy');
  return mod;
};

test('CONTRACT: a MISSING snapshot fails when UPDATE_SNAPSHOTS is unset (no auto-record)', async () => {
  const { compareSnapshot } = await loadHelper();
  const dir = fs.mkdtempSync(path.join(WORK, 'miss-'));
  delete process.env.UPDATE_SNAPSHOTS;
  assert.throws(() => compareSnapshot('does-not-exist', '{"a":1}', { dir }),
    /snapshot/i,
    'compareSnapshot silently recorded a snapshot that did not exist. A snapshot that records itself on first ' +
    'run cannot fail, so a brand-new fixture (or a deleted snapshot) is never actually reviewed.');
  assert.equal(fs.existsSync(path.join(dir, 'does-not-exist.json')), false,
    'nothing may be written to the snapshot directory without UPDATE_SNAPSHOTS');
});

test('CONTRACT: UPDATE_SNAPSHOTS=1 is the explicit, opt-in way to record', async () => {
  const { compareSnapshot } = await loadHelper();
  const dir = fs.mkdtempSync(path.join(WORK, 'record-'));
  process.env.UPDATE_SNAPSHOTS = '1';
  try {
    compareSnapshot('fresh', '{"a":1}', { dir });
    assert.equal(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf8'), '{"a":1}',
      'with UPDATE_SNAPSHOTS=1 the helper must record the snapshot verbatim');
    // and a subsequent compare against the recorded value passes
    delete process.env.UPDATE_SNAPSHOTS;
    compareSnapshot('fresh', '{"a":1}', { dir });
  } finally {
    delete process.env.UPDATE_SNAPSHOTS;
  }
});

test('CONTRACT: pipeline.test.mjs has NO unconditional auto-record path', () => {
  // Source-level on purpose: the defect is a code path, and the cheapest honest
  // proof that it is gone is that the snapshot-miss branch is guarded by the
  // opt-in env var (or that the branch has moved into the shared helper entirely).
  const src = fs.readFileSync(PIPELINE_TEST, 'utf8');
  const missIdx = src.indexOf('!fs.existsSync(snapFile)');
  if (missIdx !== -1) {
    const branch = src.slice(missIdx, missIdx + 400);
    assert.ok(/UPDATE_SNAPSHOTS/.test(branch),
      'pipeline.test.mjs writes a snapshot inside `if (!fs.existsSync(snapFile))` with no UPDATE_SNAPSHOTS guard — ' +
      'a missing snapshot records itself and the test returns green.');
  }
  assert.ok(/UPDATE_SNAPSHOTS/.test(src) || /snapshot\.mjs/.test(src),
    'pipeline.test.mjs neither honours UPDATE_SNAPSHOTS nor delegates to tests/lib/snapshot.mjs — ' +
    'the snapshot policy is still inlined and still auto-records.');
});

test('CONTRACT: a full test run leaves tests/__snapshots__ byte-identical', () => {
  // This used to ask git: `git status --porcelain -- tests/__snapshots__` had to come
  // back empty. That conflates two different things — "the tests wrote something" and
  // "the working tree differs from HEAD" — and only the first is the contract. On any
  // branch with deliberately uncommitted snapshot work (a rebuild in progress, a
  // re-record awaiting review, an unpushed fixture) the git form fails while the policy
  // it is meant to protect is perfectly intact, so it cannot be trusted either way.
  //
  // The direct observation instead: fingerprint every file in the snapshot directory,
  // run the whole main suite, fingerprint again. Identical => the run wrote nothing.
  // Same intent, no dependence on what happens to be committed. It costs a full suite
  // run (~45s), which is the honest price of observing a side effect rather than
  // asserting about it — and the source-level check above stays as the fast signal.
  const SNAPSHOTS = path.join(SKILL, 'tests', '__snapshots__');
  const fingerprint = () => Object.fromEntries(
    fs.readdirSync(SNAPSHOTS).sort().map((f) => [
      f, createHash('sha256').update(fs.readFileSync(path.join(SNAPSHOTS, f))).digest('hex'),
    ]));

  const before = fingerprint();
  assert.ok(Object.keys(before).length > 0, 'no snapshots at all — this check would be vacuous');

  // The main suite, with UPDATE_SNAPSHOTS explicitly cleared: recording is opt-in, and a
  // stray env var in the parent shell must not be able to make this check pass.
  const env = { ...process.env };
  delete env.UPDATE_SNAPSHOTS;
  const r = spawnSync(process.execPath, ['--test', 'tests/*.test.*js'],
    { cwd: SKILL, encoding: 'utf8', env, timeout: 300_000 });
  assert.equal(r.status, 0, `the main suite must be green for this observation to mean anything:\n${r.stdout}${r.stderr}`);

  const after = fingerprint();
  assert.deepEqual(after, before,
    'a plain test run changed tests/__snapshots__. A test run must never mutate a snapshot; ' +
    're-recording is an explicit UPDATE_SNAPSHOTS=1 act whose diff is the review artifact.');
});
