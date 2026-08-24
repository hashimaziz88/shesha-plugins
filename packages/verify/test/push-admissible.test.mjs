// §4.3.5 cases: one refusal per admission condition P0–P9 (plus P5a) and one fully-green
// admission. admit() is pure over the filesystem + clock, so each case builds a temp run
// dir, perturbs exactly one thing, and asserts the reason code. No hook, no child process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { admit } = await import(pathToFileURL(path.join(REPO, 'packages/verify/src/bin/push-admissible.mjs')).href);

const RUNID = '20260824-1000-r';
const SCREEN = 'items';
const SEALED = '2026-08-24T10:00:00Z';
const FRESH = Date.parse('2026-08-24T10:10:00Z'); // 10 min after sealing
const STALE = Date.parse('2026-08-24T10:40:00Z'); // 40 min after sealing
const sha256 = (/** @type {string} */ s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const tier = (/** @type {string} */ result) => ({ result, walked: 1, checked: 1, uninspectable: 0, ms: 1 });

/**
 * A fully-green run on disk. `over` mutates the four documents before they are written.
 * @param {{form?:(f:any)=>void, compile?:(c:any)=>void, verdict?:(v:any)=>void, manifest?:(m:any)=>void, noForm?:boolean}} [over]
 */
function mkRun(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'padm-'));
  const sdir = path.join(root, 'runs', RUNID, 'screens');
  fs.mkdirSync(sdir, { recursive: true });
  const form = { Name: SCREEN, Markup: JSON.stringify([{ id: '1', type: 'datatable' }]) };
  if (over.form) over.form(form);
  const formStr = `${JSON.stringify(form, null, 2)}\n`;
  const formSha = sha256(formStr);
  if (!over.noForm) fs.writeFileSync(path.join(sdir, `${SCREEN}.form.json`), formStr);

  const compile = { verdict: 'pass', markupSha256: formSha };
  if (over.compile) over.compile(compile);
  fs.writeFileSync(path.join(sdir, `${SCREEN}.compile.json`), JSON.stringify(compile));

  const verdict = {
    verdictVersion: '1.0', runId: RUNID, screen: SCREEN, round: 1, result: 'pass', sealedAt: SEALED,
    inputs: { formSha256: formSha, sfsSha256: '0'.repeat(64), compileSha256: '0'.repeat(64) },
    tiers: { T1: tier('pass'), T2: tier('pass'), T3: { ...tier('pass'), backend: null }, T4: tier('skipped'), T5: tier('skipped') },
    coverage: { placement: { required: true, walked: 5, checked: 5, uninspectable: 0 } },
    findings: [],
  };
  if (over.verdict) over.verdict(verdict);
  fs.writeFileSync(path.join(sdir, `${SCREEN}.verdict.json`), JSON.stringify(verdict));

  const manifest = { screens: { [SCREEN]: { state: 'verified' } } };
  if (over.manifest) over.manifest(manifest);
  fs.writeFileSync(path.join(root, 'runs', RUNID, 'manifest.json'), JSON.stringify(manifest));
  return root;
}
/** @param {string} root @param {any} [extra] */
const call = (root, extra = {}) => admit({ root, runId: RUNID, screen: SCREEN, now: FRESH, target: null, ...extra });

test('green: a fully-green run is admissible', () => {
  assert.deepEqual(call(mkRun()), { admissible: true, code: '', reason: '' });
});
test('P0: no screen -> HOOK-0301', () => {
  assert.equal(admit({ root: mkRun(), runId: RUNID, screen: undefined, now: FRESH }).code, 'HOOK-0301');
});
test('P1: no compiled artifact -> HOOK-0302', () => {
  assert.equal(call(mkRun({ noForm: true })).code, 'HOOK-0302');
});
test('P2: compile verdict not pass/partial -> HOOK-0303', () => {
  assert.equal(call(mkRun({ compile: (c) => { c.verdict = 'fail'; } })).code, 'HOOK-0303');
});
test('P3: artifact modified since compile -> HOOK-0304', () => {
  assert.equal(call(mkRun({ compile: (c) => { c.markupSha256 = 'd'.repeat(64); } })).code, 'HOOK-0304');
});
test('P4: verdict has no sealedAt (schema-invalid) -> HOOK-0305', () => {
  assert.equal(call(mkRun({ verdict: (v) => { delete v.sealedAt; } })).code, 'HOOK-0305');
});
test('P5: verdict does not correspond to this artifact -> HOOK-0306', () => {
  assert.equal(call(mkRun({ verdict: (v) => { v.inputs.formSha256 = 'a'.repeat(64); } })).code, 'HOOK-0306');
});
test('P5a: verdict is stale (>30 min) -> HOOK-0312', () => {
  assert.equal(call(mkRun(), { now: STALE }).code, 'HOOK-0312');
});
test('P5a: verdict backend disagrees with the push target -> HOOK-0312', () => {
  assert.equal(call(mkRun({ verdict: (v) => { v.tiers.T3.backend = 'http://other:21021'; } }), { target: 'http://localhost:21021' }).code, 'HOOK-0312');
});
test('P6: T1 not pass -> HOOK-0307', () => {
  assert.equal(call(mkRun({ verdict: (v) => { v.tiers.T1.result = 'fail'; } })).code, 'HOOK-0307');
});
test('P7: a must-finding is outstanding -> HOOK-0308', () => {
  assert.equal(call(mkRun({ verdict: (v) => { v.findings = [{ code: 'SFS-0001', severity: 'must', owner: 'specwriter', path: '/components/0', message: 'a'.repeat(40) }]; } })).code, 'HOOK-0308');
});
test('P8: zero coverage on a required family -> HOOK-0309', () => {
  assert.equal(call(mkRun({ verdict: (v) => { v.coverage.placement.walked = 0; v.coverage.placement.checked = 0; } })).code, 'HOOK-0309');
});
test('P9: state is not verified -> HOOK-0310', () => {
  assert.equal(call(mkRun({ manifest: (m) => { m.screens[SCREEN].state = 'building'; } })).code, 'HOOK-0310');
});
test('T3 partial is admissible only with --allow-partial and a backend/metadata outage', () => {
  const over = { verdict: (/** @type {any} */ v) => { v.tiers.T3.result = 'partial'; v.tiers.T3.detail = { uninspectable: [{ pointer: '/x', reason: 'backend unavailable' }] }; } };
  assert.equal(call(mkRun(over)).code, 'HOOK-0307'); // no --allow-partial
  assert.equal(call(mkRun(over), { allowPartial: true }).admissible, true); // with it
});
