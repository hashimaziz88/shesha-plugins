// Pins the push-ledger mechanics end to end: scripts/ledger.mjs is the only
// writer, and the Stop hook (hooks/scripts/hook-verify-push.cjs) has exactly ONE
// fail-open left (no ledger file at all). Stale / malformed / unverified all BLOCK.
//
// Every case runs in its own throwaway git repo under os.tmpdir() with a unique
// CLAUDE_SESSION_ID, so the tmpdir root-pointer files never cross-talk; pointers
// are removed in cleanup.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const LEDGER = path.join(SKILL, 'scripts', 'ledger.mjs');
const HOOK = path.join(SKILL, '..', '..', 'hooks', 'scripts', 'hook-verify-push.cjs');

let seq = 0;
const cleanups = [];

function scratchRepo() {
  const sid = `ledger-test-${process.pid}-${Date.now()}-${seq++}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shesha-ledger-'));
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  const pointer = path.join(os.tmpdir(), `shesha-push-ledger-${sid}.root`);
  const logPointer = path.join(os.tmpdir(), `claude-designer-logs-${sid}.root`);
  cleanups.push(() => {
    try { fs.rmSync(pointer, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(logPointer, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return { dir, sid, pointer, logPointer, env: { ...process.env, CLAUDE_SESSION_ID: sid } };
}

test.after(() => { for (const fn of cleanups) fn(); });

function ledger(repo, args) {
  return spawnSync(process.execPath, [LEDGER, ...args], { cwd: repo.dir, env: repo.env, encoding: 'utf8' });
}

function hook(repo, payload = {}) {
  return spawnSync(process.execPath, [HOOK], {
    cwd: repo.dir,
    env: repo.env,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: repo.sid, cwd: repo.dir, ...payload }),
  });
}

function ledgerFile(repo) {
  const r = ledger(repo, ['path']);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function writeRawLedger(repo, contents) {
  const file = ledgerFile(repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

// ---------------------------------------------------------------- ledger.mjs

test('ledger.mjs resolves its path inside the git toplevel', () => {
  const repo = scratchRepo();
  const file = ledgerFile(repo);
  assert.match(file.split(path.sep).join('/'), /\.claude\/cache\/shesha-form-edit\/push-ledger\.json$/);
  assert.equal(fs.existsSync(repo.pointer), true, 'session pointer file should be pinned');
});

test('record -> update -> verify round-trip', () => {
  const repo = scratchRepo();

  // verify with no ledger at all is a pass (no form work recorded).
  assert.equal(ledger(repo, ['verify']).status, 0);

  const rec = ledger(repo, ['record', '--form', 'His.Facilities/facility-table', '--id', 'guid-1', '--status', 'authored']);
  assert.equal(rec.status, 0, rec.stderr);

  const file = ledgerFile(repo);
  let saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.entries.length, 1);
  assert.deepEqual(
    { form: saved.entries[0].form, id: saved.entries[0].id, status: saved.entries[0].status },
    { form: 'His.Facilities/facility-table', id: 'guid-1', status: 'authored' }
  );
  assert.match(saved.entries[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  // An authored-but-unverified entry fails verify.
  const openVerify = ledger(repo, ['verify']);
  assert.equal(openVerify.status, 1);
  assert.match(openVerify.stderr, /facility-table/);

  // record on the same form upserts rather than duplicating.
  assert.equal(ledger(repo, ['record', '--form', 'His.Facilities/facility-table', '--id', 'guid-1', '--status', 'pushed']).status, 0);
  saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].status, 'pushed');

  assert.equal(ledger(repo, ['update', '--form', 'His.Facilities/facility-table', '--status', 'verified']).status, 0);
  const done = ledger(repo, ['verify']);
  assert.equal(done.status, 0, done.stderr);

  // A second form, abandoned with a note, also counts as closed.
  assert.equal(ledger(repo, ['record', '--form', 'His.Facilities/facility-details', '--id', 'guid-2', '--status', 'authored']).status, 0);
  assert.equal(ledger(repo, ['verify']).status, 1);
  assert.equal(
    ledger(repo, ['update', '--form', 'His.Facilities/facility-details', '--status', 'abandoned', '--note', 'entity not registered']).status,
    0
  );
  assert.equal(ledger(repo, ['verify']).status, 0);
  saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.entries.length, 2);
  assert.equal(saved.entries[1].note, 'entity not registered');
});

test('ledger.mjs rejects bad input', () => {
  const repo = scratchRepo();
  assert.equal(ledger(repo, ['record', '--form', 'no-slash', '--id', 'g', '--status', 'authored']).status, 1);
  assert.equal(ledger(repo, ['record', '--form', 'm/n', '--status', 'authored']).status, 1, 'missing --id');
  assert.equal(ledger(repo, ['record', '--form', 'm/n', '--id', 'g', '--status', 'verified']).status, 1, 'record cannot claim verified');
  assert.equal(ledger(repo, ['update', '--form', 'm/n', '--status', 'verified']).status, 1, 'cannot update an unrecorded form');
  assert.equal(ledger(repo, ['record', '--form', 'm/n', '--id', 'g', '--status', 'pushed']).status, 0);
  assert.equal(ledger(repo, ['update', '--form', 'm/n', '--status', 'abandoned']).status, 1, 'abandon needs a note');
  assert.equal(ledger(repo, ['bogus']).status, 1);
});

// ------------------------------------------------------- hook-verify-push.cjs

test('hook: no ledger file and no logged form work -> exit 0 (the one fail-open)', () => {
  const repo = scratchRepo();
  const r = hook(repo);
  assert.equal(r.status, 0, r.stderr);
});

// ---- the no-ledger escape, closed by the session log ------------------------
// session-logger.cjs logs every PostToolUse with the command text, so a session that
// published a form and never recorded it still left a trace. These cases stub that log.

/** Write session-logger-shaped lines into the session's own log tree. */
function writeSessionLog(repo, lines) {
  const dir = path.join(repo.dir, '.claude-designer-logs', 'logs', repo.sid);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'log.01012026.txt');
  fs.writeFileSync(file, lines.map((l) => `[2026-01-01T00:00:00.000Z] ${'PostToolUse'.padEnd(16)} ${l}\n`).join(''), 'utf8');
  return file;
}

test('hook: no ledger but a logged apply-form publish -> BLOCK', () => {
  const repo = scratchRepo();
  writeSessionLog(repo, [
    'TOOL Read C:/x/blueprint.json',
    'TOOL Bash $ node scripts/apply-form.mjs --file out.json --form His.Facilities/asset-hub --backend http://localhost:21021',
  ]);
  const r = hook(repo);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /never recorded it in the push ledger/);
  assert.match(r.stderr, /apply-form\.mjs publish/);
});

test('hook: no ledger but a logged FormConfiguration write -> BLOCK', () => {
  const repo = scratchRepo();
  writeSessionLog(repo, [
    `TOOL PowerShell $ Invoke-RestMethod -Method Put -Uri "$BASE/api/services/Shesha/FormConfiguration/${'Update'}Markup"`,
  ]);
  const r = hook(repo);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /FormConfiguration write call/);
});

test('hook: a session that only SEARCHED for those strings is not blocked', () => {
  const repo = scratchRepo();
  writeSessionLog(repo, [
    `TOOL Bash $ grep -rn "FormConfiguration/${'Update'}Markup" references/`,
    'TOOL Bash $ node --test tests/apply-form.test.mjs',
    'TOOL Bash $ node scripts/apply-form.mjs --help',
  ]);
  const r = hook(repo);
  assert.equal(r.status, 0, r.stderr);
});

test('hook: logged form work WITH a closed ledger -> exit 0 (the ledger is the authority)', () => {
  const repo = scratchRepo();
  writeSessionLog(repo, [
    'TOOL Bash $ node scripts/apply-form.mjs --file out.json --form m/a --backend http://localhost:21021',
  ]);
  ledger(repo, ['record', '--form', 'm/a', '--id', 'g1', '--status', 'pushed']);
  ledger(repo, ['update', '--form', 'm/a', '--status', 'verified']);
  const r = hook(repo);
  assert.equal(r.status, 0, r.stderr);
});

test('hook: all entries verified/abandoned -> exit 0', () => {
  const repo = scratchRepo();
  ledger(repo, ['record', '--form', 'm/a', '--id', 'g1', '--status', 'pushed']);
  ledger(repo, ['update', '--form', 'm/a', '--status', 'verified']);
  ledger(repo, ['record', '--form', 'm/b', '--id', 'g2', '--status', 'authored']);
  ledger(repo, ['update', '--form', 'm/b', '--status', 'abandoned', '--note', 'superseded']);
  const r = hook(repo);
  assert.equal(r.status, 0, r.stderr);
});

test('hook: unverified entry -> BLOCK with the exact command to run', () => {
  const repo = scratchRepo();
  ledger(repo, ['record', '--form', 'His.Facilities/facility-table', '--id', 'g1', '--status', 'pushed']);
  const r = hook(repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PERSISTENCE GATE/);
  assert.match(r.stderr, /His\.Facilities\/facility-table \(g1\): status=pushed/);
  assert.match(r.stderr, /ledger\.mjs update --form <module>\/<name> --status verified/);
});

test('hook: stale ledger (>12h) -> BLOCK', () => {
  const repo = scratchRepo();
  ledger(repo, ['record', '--form', 'm/a', '--id', 'g1', '--status', 'pushed']);
  ledger(repo, ['update', '--form', 'm/a', '--status', 'verified']);
  const file = ledgerFile(repo);
  const old = (Date.now() - 13 * 3600 * 1000) / 1000;
  fs.utimesSync(file, old, old);
  const r = hook(repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /stale/);
});

test('hook: malformed ledger -> BLOCK', () => {
  const repo = scratchRepo();
  writeRawLedger(repo, '{ "entries": [ {oops');
  const r = hook(repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test('hook: present but empty ledger -> BLOCK', () => {
  const repo = scratchRepo();
  writeRawLedger(repo, '{ "entries": [] }');
  const r = hook(repo);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no entries/);
});

test('hook: stop_hook_active short-circuits to exit 0', () => {
  const repo = scratchRepo();
  ledger(repo, ['record', '--form', 'm/a', '--id', 'g1', '--status', 'authored']);
  const r = hook(repo, { stop_hook_active: true });
  assert.equal(r.status, 0, r.stderr);
});
