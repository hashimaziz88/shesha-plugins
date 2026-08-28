// T4 with no browser and no live Shesha (§3.8 rows 24, 27). The assertions run against a
// recorded smoke run plus the stub HTTP backend; the transport is BL-033. The two
// properties that matter most are asserted directly: T4 never exits 0 without having run,
// and a recording that exercised nothing is a zero-coverage failure, not a quiet pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictOf } from '@shesha/registry/coverage';
import { t4Smoke, t4Available, selftestRecord, checks } from '../src/tiers/t4-smoke.mjs';
import { withStubBackend } from './helpers/stub-backend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** @param {any[]} fams @param {string} name */
const fam = (fams, name) => fams.find((f) => f.name === name);
/** @param {(r:any)=>void} [edit] */
const run = (edit) => withStubBackend(async (origin, backendGet) => {
  const rec = selftestRecord(origin);
  if (edit) edit(rec);
  return t4Smoke(rec, { backendGet });
});

test('the selftest record exercises every declared check', async () => {
  const fams = await run();
  assert.equal(verdictOf(fams), 'pass');
  for (const c of checks) {
    const f = fam(fams, c.family);
    assert.ok(f && f.walked > 0, `${c.id}: family ${c.family} walked nothing`);
  }
});

test('a consequence is read from the backend, so a wrong value fails', async () => {
  const fams = await run((r) => { r.actionSites[0].consequence.expect = { reference: 'BK-9999' }; });
  assert.equal(verdictOf(fams), 'fail');
  assert.match(fam(fams, 'consequences').failures[0].reason, /T4\.04.*is not in the backend/);
});

test('a toast is not evidence: a consequence with no backend URL is uninspectable', async () => {
  const fams = await run((r) => { delete r.actionSites[0].consequence.verifyUrl; });
  assert.equal(verdictOf(fams), 'partial');
  assert.match(fam(fams, 'consequences').uninspectable[0].reason, /a toast is not evidence/);
});

test('a record the backend refuses is uninspectable, never a pass', async () => {
  const fams = await run((r) => { r.actionSites[0].consequence.verifyUrl = '/denied'; });
  assert.equal(verdictOf(fams), 'partial');
  assert.match(fam(fams, 'consequences').uninspectable[0].reason, /backend unavailable: 403/);
});

test('an ABP result:null for an unknown record is a failure, not an empty pass', async () => {
  const fams = await run((r) => { r.actionSites[0].consequence.verifyUrl = '/api/services/app/Booking/Get?id=404'; });
  assert.equal(verdictOf(fams), 'fail');
});

test('console warnings are counted but never scored; an error fails', async () => {
  const warned = await run((r) => { r.console.push({ level: 'warning', text: 'another antd warning' }); });
  assert.equal(verdictOf(warned), 'pass');
  const errored = await run((r) => { r.console.push({ level: 'error', text: 'Cannot read properties of undefined' }); });
  assert.equal(verdictOf(errored), 'fail');
  assert.match(fam(errored, 'console').failures[0].reason, /T4\.02/);
});

test('a screen reached by a pasted ?id= is not a real render', async () => {
  const fams = await run((r) => { r.navigation.how = 'pasted-id'; });
  assert.equal(verdictOf(fams), 'fail');
  assert.match(fam(fams, 'render').failures[0].reason, /pasted \?id=/);
});

test('an unreachable action site is uninspectable, never silently skipped', async () => {
  const fams = await run((r) => { r.actionSites[2] = { name: 'btnPrint', unreachable: 'behind a role the smoke account does not hold' }; });
  assert.equal(verdictOf(fams), 'partial');
  const actions = fam(fams, 'actions');
  assert.equal(actions.walked, 3);
  assert.equal(actions.checked + actions.uninspectable.length, 3);
});

test('the recorded live capture clicked nothing, so it is a zero-coverage failure', async () => {
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/smoke/login.smoke.json'), 'utf8'));
  const fams = await t4Smoke(rec, {});
  assert.equal(verdictOf(fams), 'fail');
  assert.equal(fam(fams, 'render').failures.length, 0);
  assert.equal(fam(fams, 'console').failures.length, 0, 'the live login screen logged a console error');
  const actions = fam(fams, 'actions');
  assert.ok(actions.walked > 0 && actions.checked === 0, 'a passive recording must not report action coverage');
});

test('T4 states what is missing before it runs, and never claims an installed package is absent', () => {
  assert.deepEqual(t4Available({ baseUrl: null, playwright: false }),
    { ok: false, reason: 'playwright not installed; no --base-url given' });
  assert.deepEqual(t4Available({ baseUrl: null, playwright: true }), { ok: false, reason: 'no --base-url given' });
  assert.deepEqual(t4Available({ baseUrl: 'http://localhost:3000', playwright: false }), { ok: false, reason: 'playwright not installed' });
  assert.equal(t4Available({ baseUrl: 'http://localhost:3000', playwright: true }).ok, true);
});
