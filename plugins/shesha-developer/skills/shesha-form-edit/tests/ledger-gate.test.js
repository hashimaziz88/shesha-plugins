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

let seq = 0;
function sandbox() {
  const dir = path.join(os.tmpdir(), `shesha-ledger-${process.pid}-${seq++}`);
  fs.mkdirSync(path.join(dir, '.claude', 'cache', 'shesha-form-edit'), { recursive: true });
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
  fs.writeFileSync(
    path.join(dir, '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json'),
    typeof entries === 'string' ? entries : JSON.stringify({ $schema: 'shesha-push-ledger/v2', entries }, null, 2),
  );
}

function runHook(dir, payload = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: dir, input: JSON.stringify(payload), encoding: 'utf8',
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
