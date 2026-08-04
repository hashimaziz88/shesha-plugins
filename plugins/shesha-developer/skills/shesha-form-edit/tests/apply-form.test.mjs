// apply-form.mjs — the atomic publication path, driven offline.
//
// Every stage runs for real (gates spawn the real validators; the ledger spawns the
// real ledger.mjs into a throwaway git repo). Only the TRANSPORT is stubbed: a fake
// `fetch` answers the four routes GymApi touches, so the full sequence
// gates → authored → push → pushed → re-fetch → diff → verified is exercised without
// a backend. NO test performs a live push.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyForm, diffMarkup } from '../scripts/apply-form.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const LEDGER = path.join(SKILL, 'scripts', 'ledger.mjs');

const cleanups = [];
test.after(() => { for (const fn of cleanups) fn(); });

let seq = 0;
function scratchRepo() {
  const sid = `apply-form-test-${process.pid}-${Date.now()}-${seq++}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shesha-apply-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' }).status, 0);
  const pointer = path.join(os.tmpdir(), `shesha-push-ledger-${sid}.root`);
  // A cached token IS a credential: with one present, GymApi validates it against the
  // stub and never reaches resolveCredentials — so no test can be tempted to carry
  // real credentials.
  fs.writeFileSync(path.join(dir, 'access-token'), 'stub-token', 'utf8');
  cleanups.push(() => {
    try { fs.rmSync(pointer, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return { dir, sid, pointer };
}

/** Read the ledger of a scratch repo through ledger.mjs's own path resolution. */
function readLedger(repo) {
  const r = spawnSync(process.execPath, [LEDGER, 'path'], {
    cwd: repo.dir, env: { ...process.env, CLAUDE_SESSION_ID: repo.sid }, encoding: 'utf8',
  });
  const file = r.stdout.trim();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** A ledger seam that spawns the real writer into the scratch repo. */
function ledgerInto(repo) {
  return (args) => {
    const r = spawnSync(process.execPath, [LEDGER, ...args], {
      cwd: repo.dir, env: { ...process.env, CLAUDE_SESSION_ID: repo.sid }, encoding: 'utf8',
    });
    return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
  };
}

// The fixture is REAL compiler output, compiled once (offline, --no-live) from a
// checked-in blueprint. Hand-written markup would be a fixture that the gates reject,
// which would test the gates' opinion of the fixture instead of apply-form's sequence.
const FIXTURE = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shesha-apply-fixture-'));
  cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const out = path.join(dir, 'compiled.json');
  const r = spawnSync(process.execPath, [
    path.join(SKILL, 'scripts', 'compile-blueprint.js'),
    '--blueprint', path.join(HERE, 'fixtures', 'asset-hub.blueprint.json'),
    '--out', out, '--no-live',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture compile failed:\n${r.stdout}\n${r.stderr}`);
  return { path: out, archetype: 'hub' };
})();

/** Copy the gate-clean compiled fixture into a test's scratch repo. */
function writeForm(dir) {
  const file = path.join(dir, 'form.json');
  fs.copyFileSync(FIXTURE.path, file);
  return { file };
}

/**
 * Stub transport over the four routes GymApi uses. `store` is the fake backend.
 * `mutate` lets a test corrupt what the server "persists" to prove the diff bites.
 */
function stubFetch(store, { mutate = (s) => s, failPush = false } = {}) {
  const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
  store.calls = [];
  return async (url, opts = {}) => {
    store.calls.push(`${opts.method ?? 'GET'} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`);
    const u = String(url);
    if (u.includes('/api/services/app/Module/GetAll')) {
      return json({ result: { items: [{ id: 'mod-guid', name: store.module }] } });
    }
    if (u.includes('/FormConfiguration/GetByName')) {
      return json({ result: store.form ?? null });
    }
    if (u.includes('/FormConfiguration/Create')) {
      if (failPush) return json({ error: { message: 'nope' } }, false, 500);
      const markup = mutate(JSON.parse(opts.body).markup);
      store.form = { id: 'created-guid', name: store.name, module: { name: store.module }, markup };
      return json({ result: { id: 'created-guid' } });
    }
    if (u.includes('/FormConfiguration/UpdateMarkup')) {
      if (failPush) return json({ error: { message: 'nope' } }, false, 500);
      store.form.markup = mutate(JSON.parse(opts.body).markup);
      return json({ result: null });
    }
    throw new Error(`stub fetch: unexpected route ${u}`);
  };
}

const base = (repo, file) => ({
  file,
  form: 'His.Facilities/asset-hub',
  backend: 'http://stub.invalid',
  tokenFile: path.join(repo.dir, 'access-token'),
  archetype: 'hub',
  ledger: ledgerInto(repo),
  log: () => {},
});

// ------------------------------------------------------------------ happy path

test('apply-form: create → re-fetch → verified, ledger closed', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  const store = { module: 'His.Facilities', name: 'asset-hub', form: null };

  const { result, exitCode } = await applyForm({ ...base(repo, file), fetchImpl: stubFetch(store) });

  assert.equal(exitCode, 0, JSON.stringify(result, null, 2));
  assert.equal(result.status, 'verified');
  assert.equal(result.form.id, 'created-guid');
  assert.equal(result.pushed.action, 'created');
  assert.equal(result.refetchDiff.byteEqual, true);
  assert.deepEqual(result.ledger.map((l) => l.stage), ['authored', 'pushed', 'verified']);
  assert.ok(Object.values(result.gates).every((v) => v === 'pass'), JSON.stringify(result.gates));

  const saved = readLedger(repo);
  assert.equal(saved.entries.length, 1, 'authored/pushed/verified upsert ONE entry');
  assert.equal(saved.entries[0].status, 'verified');
  assert.equal(saved.entries[0].id, 'created-guid');
  // Ledger `verify` (the same check the Stop hook runs) must now pass.
  const v = spawnSync(process.execPath, [LEDGER, 'verify'], {
    cwd: repo.dir, env: { ...process.env, CLAUDE_SESSION_ID: repo.sid }, encoding: 'utf8',
  });
  assert.equal(v.status, 0, v.stderr);
});

test('apply-form: existing form takes the UpdateMarkup branch', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  const store = {
    module: 'His.Facilities', name: 'asset-hub',
    form: { id: 'existing-guid', markup: '{"components":[]}' },
  };
  const { result, exitCode } = await applyForm({ ...base(repo, file), fetchImpl: stubFetch(store) });
  assert.equal(exitCode, 0);
  assert.equal(result.pushed.action, 'updated');
  assert.equal(result.form.id, 'existing-guid');
  assert.ok(store.calls.some((c) => c.startsWith('PUT') && c.includes('UpdateMarkup')));
  assert.ok(!store.calls.some((c) => c.includes('/Create')), 'must not Create over an existing form');
});

test('apply-form: server key reordering verifies (structural, not byte)', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  const store = { module: 'His.Facilities', name: 'asset-hub', form: null };
  const reorder = (s) => {
    const t = JSON.parse(s);
    return JSON.stringify({ formSettings: t.formSettings, components: t.components });
  };
  const { result, exitCode } = await applyForm({
    ...base(repo, file), fetchImpl: stubFetch(store, { mutate: reorder }),
  });
  assert.equal(exitCode, 0);
  assert.equal(result.status, 'verified');
  assert.equal(result.refetchDiff.byteEqual, false);
  assert.equal(result.refetchDiff.structuralEqual, true);
});

// -------------------------------------------------------------- fail-closed paths

test('apply-form: failing gate stops before the backend and before the ledger', async () => {
  const repo = scratchRepo();
  const file = path.join(repo.dir, 'broken.json');
  // Structure-only, no styling anywhere: styled-ness [R-042] must fail this.
  fs.writeFileSync(file, JSON.stringify({ components: [{ id: 'a', type: 'container', name: 'a', parentId: 'root', version: 1 }] }));
  const store = { module: 'His.Facilities', name: 'asset-hub', form: null };

  const { result, exitCode } = await applyForm({ ...base(repo, file), fetchImpl: stubFetch(store) });

  assert.equal(exitCode, 1);
  assert.equal(result.status, 'failed');
  assert.ok(Object.values(result.gates).includes('fail'), JSON.stringify(result.gates));
  assert.deepEqual(result.ledger, [], 'a form that failed its gates is never recorded');
  assert.deepEqual(store.calls, [], 'nothing may reach the backend');
  assert.equal(readLedger(repo), null);
});

test('apply-form: markup drift leaves the entry `pushed` and exits 1', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  const store = { module: 'His.Facilities', name: 'asset-hub', form: null };
  const drop = (s) => {
    const t = JSON.parse(s);
    t.components[0].components = [];   // the server "loses" the title
    return JSON.stringify(t);
  };
  const { result, exitCode } = await applyForm({
    ...base(repo, file), fetchImpl: stubFetch(store, { mutate: drop }),
  });

  assert.equal(exitCode, 1);
  assert.equal(result.status, 'unverified');
  assert.equal(result.refetchDiff.structuralEqual, false);
  assert.ok(result.refetchDiff.differences.length > 0);
  assert.deepEqual(result.ledger.map((l) => l.stage), ['authored', 'pushed']);

  const saved = readLedger(repo);
  assert.equal(saved.entries[0].status, 'pushed', 'unverified work must stay open at the Stop gate');
  const v = spawnSync(process.execPath, [LEDGER, 'verify'], {
    cwd: repo.dir, env: { ...process.env, CLAUDE_SESSION_ID: repo.sid }, encoding: 'utf8',
  });
  assert.equal(v.status, 1, 'ledger verify must still fail');
});

test('apply-form: a failed push leaves the authored entry open', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  const store = { module: 'His.Facilities', name: 'asset-hub', form: null };
  const { result, exitCode } = await applyForm({
    ...base(repo, file), fetchImpl: stubFetch(store, { failPush: true }),
  });
  assert.equal(exitCode, 1);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.ledger.map((l) => l.stage), ['authored']);
  assert.equal(readLedger(repo).entries[0].status, 'authored');
});

test('apply-form: rejects a malformed --form and a missing file', async () => {
  const repo = scratchRepo();
  const { file } = writeForm(repo.dir);
  await assert.rejects(() => applyForm({ ...base(repo, file), form: 'no-slash' }), /module>\/<name/);
  await assert.rejects(() => applyForm({ ...base(repo, file), file: path.join(repo.dir, 'nope.json') }), /not found/);
});

// ------------------------------------------------------------------------ diff unit

test('diffMarkup: byte, structural and real drift', () => {
  assert.deepEqual(diffMarkup('{"a":1}', '{"a":1}'), { byteEqual: true, structuralEqual: true, differences: [] });
  const reordered = diffMarkup('{"a":1,"b":2}', '{"b":2,"a":1}');
  assert.equal(reordered.byteEqual, false);
  assert.equal(reordered.structuralEqual, true);
  const drift = diffMarkup('{"a":1}', '{"a":2}');
  assert.equal(drift.structuralEqual, false);
  assert.deepEqual(drift.differences, ['a: 1 → 2']);
  // null → absent is a documented server normalization, not drift.
  assert.equal(diffMarkup('{"a":null}', '{}').structuralEqual, true);
});
