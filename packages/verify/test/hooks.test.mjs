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
