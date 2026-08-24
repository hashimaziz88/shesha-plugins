// WP-8b.1 §4.8 rows 4-5: matchGlob semantics (12 cases), block-form-writes decide
// (>=14 cases, first-match-wins), and the p95 <= 5ms budget over 500 non-matching
// decide calls. decide runs in-process against a temp root — no child, no cold start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.claude', 'hooks');
const { matchGlob } = await import(pathToFileURL(path.join(HOOKS, 'lib.mjs')).href);
const { decide } = await import(pathToFileURL(path.join(HOOKS, 'block-form-writes.decide.mjs')).href);
const { decide: lockDecide } = await import(pathToFileURL(path.join(HOOKS, 'enforce-screen-lock.decide.mjs')).href);
const { decide: validateDecide } = await import(pathToFileURL(path.join(HOOKS, 'validate-sfs-on-write.decide.mjs')).href);

const RUNID = '20260824-1000-r';

/** @param {{specwriterLock?:boolean, evalLock?:boolean}} [opts] */
function mkRoot(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'shesha-plugins',
    scripts: { sfs: 'node packages/sfs/bin/sfs.mjs', bless: 'node packages/sfs/tools/bless.mjs' },
  }));
  const locks = path.join(root, 'runs', RUNID, 'locks');
  if (opts.specwriterLock) { fs.mkdirSync(locks, { recursive: true }); fs.writeFileSync(path.join(locks, 'other.lock'), JSON.stringify({ lockVersion: '1.0', screen: 'other', role: 'sfs-specwriter', runId: RUNID, at: '2026-08-24T10:00:00Z', pid: 1 })); }
  if (opts.evalLock) { fs.mkdirSync(locks, { recursive: true }); fs.writeFileSync(path.join(locks, 'eval-x.lock'), JSON.stringify({ lockVersion: '1.0', screen: 'x', role: 'sfs-evaluator', runId: RUNID, at: '2026-08-24T10:00:00Z', pid: 1 })); }
  return root;
}
/** @param {string|null} root */
const ctx = (root) => ({ root, fs, activeRunId: RUNID });
/** @param {string} tool @param {any} input */
const p = (tool, input) => ({ tool_name: tool, tool_input: input });

// ---- row 4: matchGlob, 12 cases -----------------------------------------------
test('matchGlob: anchored, * never crosses /, ** does, ? throws', () => {
  assert.ok(matchGlob('screens/*.sfs.json', 'screens/x.sfs.json'));
  assert.ok(!matchGlob('screens/*.sfs.json', 'screens/nested/x.sfs.json'));
  assert.ok(matchGlob('logs/**', 'logs/a/b/c.md'));
  assert.ok(matchGlob('logs/**', 'logs/x.md'));
  assert.ok(!matchGlob('logs/**', 'other/x.md'));
  assert.ok(matchGlob('packages/sfs/corpus/**/*.json', 'packages/sfs/corpus/a/b.json'));
  assert.ok(!matchGlob('packages/sfs/corpus/**/*.json', 'packages/sfs/corpus/a/b.txt'));
  assert.ok(matchGlob('manifest.json', 'manifest.json'));
  assert.ok(!matchGlob('manifest.json', 'x/manifest.json'));
  assert.ok(matchGlob('screens/*.verdict.json', 'screens/x.verdict.json'));
  assert.ok(!matchGlob('screens/*.verdict.json', 'screens/x.sfs.json'));
  assert.throws(() => matchGlob('screens/?.json', 'screens/x.json'), /\? unsupported/);
});

// ---- row 5: block-form-writes decide, >=14 cases ------------------------------
test('a: Write a .form.json in a run -> deny HOOK-0101', () => {
  const d = decide(p('Write', { file_path: `runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot()));
  assert.equal(d.code, 'HOOK-0101'); assert.equal(d.decision, 'deny');
});
test('b: Bash redirect to a .form.json -> deny HOOK-0102', () => {
  const d = decide(p('Bash', { command: `echo x > runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot()));
  assert.equal(d.code, 'HOOK-0102');
});
test('c: npm run sfs compile writing markup -> allow (writer allowlist)', () => {
  const d = decide(p('Bash', { command: `npm run sfs -- compile --out runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('d: npm run bless -> allow', () => {
  const d = decide(p('Bash', { command: 'npm run bless' }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('e: node packages/sfs tool writing a .form.json -> allow', () => {
  const d = decide(p('Bash', { command: 'node packages/sfs/tools/normalise-legacy.mjs --in x --out .build/wp1/oracle.form.json' }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('f: node packages/sfs tool writing a non-markup json -> allow', () => {
  const d = decide(p('Bash', { command: 'node packages/sfs/tools/gen-registry.mjs --out packages/registry/data/components.json' }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('g: node scratch.mjs redirecting to markup -> deny HOOK-0102', () => {
  const d = decide(p('Bash', { command: `node scratch.mjs > runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot()));
  assert.equal(d.code, 'HOOK-0102');
});
test('h: Write an .expected.form.json fixture -> deny HOOK-0101', () => {
  const d = decide(p('Write', { file_path: 'packages/sfs/test/fixtures/clean/x.expected.form.json' }), ctx(mkRoot()));
  assert.equal(d.code, 'HOOK-0101');
});
test('i: Read markup with a specwriter lock open -> deny HOOK-0104', () => {
  const d = decide(p('Read', { file_path: `runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot({ specwriterLock: true })));
  assert.equal(d.code, 'HOOK-0104');
});
test('j: Read markup with no lock -> allow', () => {
  const d = decide(p('Read', { file_path: `runs/${RUNID}/screens/s.form.json` }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('k: Read a log with an eval lock open -> deny HOOK-0106', () => {
  const d = decide(p('Read', { file_path: `runs/${RUNID}/logs/specwriter-x-r1.md` }), ctx(mkRoot({ evalLock: true })));
  assert.equal(d.code, 'HOOK-0106');
});
test('l: Read a log with no eval lock -> allow', () => {
  const d = decide(p('Read', { file_path: `runs/${RUNID}/logs/specwriter-x-r1.md` }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('m: Write a run-dir .sfs.json -> allow', () => {
  const d = decide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});
test('n: Write a nested run-dir screen -> deny HOOK-0105', () => {
  const d = decide(p('Write', { file_path: `runs/${RUNID}/screens/nested/x.sfs.json` }), ctx(mkRoot()));
  assert.equal(d.code, 'HOOK-0105');
});
test('o: repo root not found -> deny HOOK-0001', () => {
  const d = decide(p('Write', { file_path: 'x.form.json' }), ctx(null));
  assert.equal(d.code, 'HOOK-0001');
});
test('p: Edit a source file with replace_all -> allow', () => {
  const d = decide(p('Edit', { file_path: 'packages/sfs/src/index.mjs', replace_all: true }), ctx(mkRoot()));
  assert.equal(d.decision, 'allow');
});

// ---- WP-8b.2 §4.3.6: enforce-screen-lock decide, >=6 cases --------------------
const THIRTY_MIN = 30 * 60 * 1000;
/** @param {string} root @param {string} rel @param {any} body */
function put(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body));
  return full;
}
/** @param {string} root @param {string} screen @param {string} role */
function lock(root, screen, role) {
  return put(root, `runs/${RUNID}/locks/${screen}.lock`, { lockVersion: '1.0', screen, role, runId: RUNID, at: '2026-08-24T10:00:00Z', pid: 1 });
}
const signedContract = { signedOffAt: '2026-08-24T10:00:00Z', predicates: ['a', 'b', 'c'] };

test('lock a: Write a non-run source file -> allow L0', () => {
  const d = lockDecide(p('Write', { file_path: 'packages/sfs/src/index.mjs' }), { root: mkRoot(), fs });
  assert.equal(d.decision, 'allow'); assert.equal(d.rule, 'L0');
});
test('lock b: Write plan.json without a planner lock -> deny HOOK-0401', () => {
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/plan.json` }), { root: mkRoot(), fs });
  assert.equal(d.code, 'HOOK-0401'); assert.equal(d.decision, 'deny');
});
test('lock c: Write plan.json with a planner lock -> allow', () => {
  const root = mkRoot(); lock(root, '__plan__', 'planner');
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/plan.json` }), { root, fs });
  assert.equal(d.decision, 'allow');
});
test('lock d: Write a screen with no lock -> deny HOOK-0402', () => {
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root: mkRoot(), fs });
  assert.equal(d.code, 'HOOK-0402');
});
test('lock e: Write a screen held by another author (fresh) -> deny HOOK-0403', () => {
  const root = mkRoot(); lock(root, 'y', 'sfs-specwriter');
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs });
  assert.equal(d.code, 'HOOK-0403');
});
test('lock f: Write a screen held by another author (stale) -> deny HOOK-0404', () => {
  const root = mkRoot(); lock(root, 'y', 'sfs-specwriter');
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, now: Date.now() + THIRTY_MIN + 60000 });
  assert.equal(d.code, 'HOOK-0404');
});
test('lock g: own lock but no signed contract -> deny HOOK-0405', () => {
  const root = mkRoot(); lock(root, 'x', 'sfs-specwriter');
  put(root, `runs/${RUNID}/plan.json`, { screens: [{ name: 'x' }] });
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs });
  assert.equal(d.code, 'HOOK-0405');
});
test('lock h: own lock + signed contract + round<3 -> allow L7', () => {
  const root = mkRoot(); lock(root, 'x', 'sfs-specwriter');
  put(root, `runs/${RUNID}/plan.json`, { screens: [{ name: 'x', contract: signedContract }] });
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs });
  assert.equal(d.decision, 'allow'); assert.equal(d.rule, 'L7');
});
test('lock i: own lock + contract + round>=3 + file exists -> deny HOOK-0406', () => {
  const root = mkRoot(); lock(root, 'x', 'sfs-specwriter');
  put(root, `runs/${RUNID}/plan.json`, { screens: [{ name: 'x', contract: signedContract }] });
  put(root, `runs/${RUNID}/manifest.json`, { screens: { x: { round: 3 } } });
  put(root, `runs/${RUNID}/screens/x.sfs.json`, { form: 'f', module: 'm' });
  const d = lockDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs });
  assert.equal(d.code, 'HOOK-0406');
});

// ---- WP-8b.2 §4.3.4: validate-sfs-on-write decide, >=6 cases ------------------
const spawnOk = () => ({ status: 0, stdout: '' });
/** @param {string[]} diags */
const spawnBad = (diags) => () => ({ status: 1, stdout: JSON.stringify({ ok: false, diagnostics: diags }) });
const spawnDead = () => ({ status: null });

test('val a: a non-schema file (.md) -> allow V0, no spawn', () => {
  let called = false;
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/logs/x.md` }), { root: mkRoot(), fs, spawnNode: () => { called = true; return spawnOk(); } });
  assert.equal(d.rule, 'V0'); assert.equal(d.decision, 'allow'); assert.equal(called, false);
});
test('val b: a non-handoff .json -> allow V0', () => {
  const d = validateDecide(p('Write', { file_path: 'packages/registry/data/components.json' }), { root: mkRoot(), fs, spawnNode: spawnOk });
  assert.equal(d.rule, 'V0');
});
test('val c: validator binary unavailable -> block HOOK-0002, no rename', () => {
  const root = mkRoot(); const full = put(root, `runs/${RUNID}/screens/x.sfs.json`, { form: 'f', module: 'm' });
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, spawnNode: spawnDead });
  assert.equal(d.code, 'HOOK-0002'); assert.ok(fs.existsSync(full)); assert.ok(!fs.existsSync(`${full}.rejected`));
});
test('val d: a valid sfs with no plan -> allow V2', () => {
  const root = mkRoot(); put(root, `runs/${RUNID}/screens/x.sfs.json`, { form: 'f', module: 'm' });
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, spawnNode: spawnOk });
  assert.equal(d.rule, 'V2'); assert.equal(d.decision, 'allow');
});
test('val e: an invalid sfs -> block HOOK-0201, diagnostics verbatim, renamed', () => {
  const root = mkRoot(); const full = put(root, `runs/${RUNID}/screens/x.sfs.json`, { bad: true });
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, spawnNode: spawnBad(['/ must NOT have additional properties (SFS-1002)']) });
  assert.equal(d.code, 'HOOK-0201'); assert.match(d.reason, /SFS-1002/);
  assert.ok(!fs.existsSync(full)); assert.ok(fs.existsSync(`${full}.rejected`));
});
test('val f: valid sfs whose form/module disagree with plan -> block HOOK-0203, renamed', () => {
  const root = mkRoot(); const full = put(root, `runs/${RUNID}/screens/x.sfs.json`, { form: 'B', module: 'M' });
  put(root, `runs/${RUNID}/plan.json`, { screens: [{ name: 'x', formName: 'A', module: 'M' }] });
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, spawnNode: spawnOk });
  assert.equal(d.code, 'HOOK-0203'); assert.ok(fs.existsSync(`${full}.rejected`));
});
test('val g: valid sfs whose form/module agree with plan -> allow V2', () => {
  const root = mkRoot(); put(root, `runs/${RUNID}/screens/x.sfs.json`, { form: 'A', module: 'M' });
  put(root, `runs/${RUNID}/plan.json`, { screens: [{ name: 'x', formName: 'A', module: 'M' }] });
  const d = validateDecide(p('Write', { file_path: `runs/${RUNID}/screens/x.sfs.json` }), { root, fs, spawnNode: spawnOk });
  assert.equal(d.rule, 'V2'); assert.equal(d.decision, 'allow');
});

// ---- row 5: the p95 <= 5ms budget over 500 non-matching decide calls ----------
test('p95 <= 5ms over 500 non-matching decide calls', () => {
  const root = mkRoot();
  const c = ctx(root);
  const payload = p('Read', { file_path: 'packages/sfs/src/index.mjs' });
  const times = [];
  for (let i = 0; i < 500; i += 1) {
    const t = performance.now();
    decide(payload, c);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? Infinity;
  assert.ok(p95 <= 5, `p95 ${p95.toFixed(3)}ms over the 5ms budget`);
});
