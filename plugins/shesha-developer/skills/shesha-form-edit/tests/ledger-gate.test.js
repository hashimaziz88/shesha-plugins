/**
 * Ledger enforcement tests — the Stop hook must FAIL CLOSED.
 *
 * The gate exists because a validated file on disk is not a delivered form. The previous
 * version failed open on a missing/stale/unparseable ledger while the ledger itself was
 * hand-authored by the model it policed, so it could be satisfied by writing a JSON file
 * claiming success. These tests assert that is no longer possible.
 *
 * Each case runs the hook in a throwaway cwd so the real project ledger is untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, '..', '..', '..', 'hooks', 'scripts', 'hook-verify-push.cjs');

// The ledger location is derived by scripts/gym-lib/paths.cjs, never hardcoded here —
// duplicating it is what let the writer and the reader drift apart in the first place.
const require_ = (await import('node:module')).createRequire(import.meta.url);
const paths = require_('../scripts/gym-lib/paths.cjs');

/** Resolve the ledger path exactly as the writer and the hook will, for a given project. */
function ledgerFor(projectDir) {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = projectDir;
  try { return paths.ledgerPath(); } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
}

let seq = 0;
function sandbox() {
  const dir = path.join(os.tmpdir(), `shesha-ledger-${process.pid}-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  // Clear any state a previous run left for this project key.
  fs.rmSync(path.dirname(ledgerFor(dir)), { recursive: true, force: true });
  return dir;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Write an evidence bundle + its sidecar, returning what a ledger entry should say. */
function writeEvidence(dir, { status = 'verified', markupSha256 = sha256('markup') } = {}) {
  const evDir = path.join(dir, 'evidence');
  fs.mkdirSync(evDir, { recursive: true });
  const file = path.join(evDir, 'mod--form--abc.evidence.json');
  const bundle = {
    $schema: 'shesha-apply-evidence/v1',
    form: { module: 'mod', name: 'form', id: 'id-1' },
    markupSha256, status, steps: [],
  };
  const body = JSON.stringify(bundle, null, 2);
  fs.writeFileSync(file, body);
  const digest = sha256(body);
  fs.writeFileSync(`${file}.sha256`, digest);
  return { evidence: file, evidenceSha256: digest, markupSha256 };
}

function writeLedger(dir, entries) {
  const p = ledgerFor(dir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof entries === 'string' ? entries : JSON.stringify({ $schema: 'shesha-push-ledger/v2', entries }, null, 2),
  );
}

function runHook(dir, payload = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: dir, input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { status: r.status, stderr: r.stderr ?? '' };
}

const entry = (over = {}) => ({ module: 'mod', form: 'form', id: 'id-1', status: 'verified', ...over });

// ---------------------------------------------------------------- allowed

test('no ledger at all → allows the stop (nothing was claimed)', () => {
  assert.equal(runHook(sandbox()).status, 0);
});

test('an empty ledger → allows the stop', () => {
  const dir = sandbox();
  writeLedger(dir, []);
  assert.equal(runHook(dir).status, 0);
});

test('a verified entry with an intact bundle → allows the stop', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'verified' });
  writeLedger(dir, [entry(ev)]);
  const r = runHook(dir);
  assert.equal(r.status, 0, r.stderr);
});

test('an abandoned entry with an intact bundle → allows the stop', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'abandoned' });
  writeLedger(dir, [entry({ ...ev, status: 'abandoned' })]);
  assert.equal(runHook(dir).status, 0);
});

test('stop_hook_active short-circuits to avoid a loop', () => {
  const dir = sandbox();
  writeLedger(dir, [entry({ evidence: '/nope' })]);
  assert.equal(runHook(dir, { stop_hook_active: true }).status, 0);
});

// ---------------------------------------------------------------- blocked

test('an unparseable ledger BLOCKS (previously allowed)', () => {
  const dir = sandbox();
  writeLedger(dir, '{ this is not json');
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /will not parse/);
});

test('an entry with no evidence path BLOCKS — it was hand-authored', () => {
  const dir = sandbox();
  writeLedger(dir, [entry()]);            // status:verified but no evidence
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no evidence path/);
});

test('a missing evidence bundle BLOCKS', () => {
  const dir = sandbox();
  writeLedger(dir, [entry({ evidence: path.join(dir, 'evidence', 'gone.json'), evidenceSha256: 'x' })]);
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /evidence bundle missing/);
});

test('a hand-edited evidence bundle BLOCKS on the digest', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'failed' });
  // Flip the recorded status to verified, as someone covering a failure would.
  const tampered = fs.readFileSync(ev.evidence, 'utf8').replace('"failed"', '"verified"');
  fs.writeFileSync(ev.evidence, tampered);
  writeLedger(dir, [entry(ev)]);
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not match its recorded digest/);
});

test('a bundle recording a failure BLOCKS even when the ledger says verified', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'failed' });
  writeLedger(dir, [entry({ ...ev, status: 'verified' })]);
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /status="failed"/);
});

test('a bundle for different markup than the ledger claims BLOCKS', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'verified', markupSha256: sha256('one thing') });
  writeLedger(dir, [entry({ ...ev, markupSha256: sha256('a different thing') })]);
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /evidence for different markup/);
});

test('a pushed-but-unrendered bundle BLOCKS — pushed is not delivered', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'pushed-unrendered' });
  writeLedger(dir, [entry(ev)]);
  const r = runHook(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pushed-unrendered/);
});

test('the block message names the one supported push path', () => {
  const dir = sandbox();
  writeLedger(dir, [entry()]);
  assert.match(runHook(dir).stderr, /apply-form\.mjs/);
});

// ---------------------------------------------------------------- aggregate verifier
// The conductor runs this instead of believing what a dispatched agent said. It shares its
// rules with the Stop hook via gym-lib/evidence.cjs, so the two cannot drift.

const VERIFY = path.resolve(HERE, '..', 'scripts', 'verify-evidence.mjs');

function runVerify(args, cwd) {
  const r = spawnSync(process.execPath, [VERIFY, ...args], {
    cwd: cwd ?? process.cwd(), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd ?? process.cwd() },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('verify-evidence accepts a verified bundle passed by path', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'verified' });
  const r = runVerify([ev.evidence], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1\/1 screen\(s\) verified/);
});

test('verify-evidence rejects a bundle recording a failure', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'failed' });
  const r = runVerify([ev.evidence], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /status="failed"/);
});

test('verify-evidence rejects a hand-edited bundle on its sidecar digest', () => {
  // The agent returns only a path, so tampering is the obvious attack on this boundary.
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'failed' });
  fs.writeFileSync(ev.evidence, fs.readFileSync(ev.evidence, 'utf8').replace('"failed"', '"verified"'));
  const r = runVerify([ev.evidence], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sidecar digest/);
});

test('verify-evidence rejects a missing bundle', () => {
  const dir = sandbox();
  const r = runVerify([path.join(dir, 'nope.evidence.json')], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing/);
});

test('verify-evidence --ledger verifies every recorded push', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'verified' });
  writeLedger(dir, [entry(ev)]);
  const r = runVerify(['--ledger'], dir);
  assert.equal(r.status, 0, r.stderr);
});

test('verify-evidence --ledger fails when no push was recorded', () => {
  // "I built five screens" must not pass against an empty ledger.
  const r = runVerify(['--ledger'], sandbox());
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /no push ledger/);
});

test('verify-evidence --json reports per-screen status and recovers form identity', () => {
  const dir = sandbox();
  const ev = writeEvidence(dir, { status: 'verified' });
  const r = runVerify([ev.evidence, '--json'], dir);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verified, true);
  assert.equal(out.total, 1);
  assert.equal(out.screens[0].form, 'mod/form');       // read from the bundle, not the args
  assert.equal(out.screens[0].status, 'verified');
});

test('verify-evidence and the Stop hook agree on the same ledger', () => {
  // They share gym-lib/evidence.cjs precisely so they cannot disagree.
  for (const status of ['verified', 'failed', 'pushed-unrendered']) {
    const dir = sandbox();
    const ev = writeEvidence(dir, { status });
    writeLedger(dir, [entry({ ...ev, status })]);
    const v = runVerify(['--ledger'], dir).status === 0;
    const h = runHook(dir).status === 0;
    assert.equal(v, h, `verifier and hook disagree for status="${status}"`);
  }
});
