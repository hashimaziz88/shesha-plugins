#!/usr/bin/env node
/**
 * verify.mjs — the single gate for this plugin. One command, exit 0 or fail.
 *
 * Chains, in cheapest-first order:
 *   1. doc claims lint      — no MUST/enforced/measured claim without enforcement
 *   2. JS syntax check      — every script parses
 *   3. JSON parse check     — every committed JSON asset parses
 *   4. block JSON validation — assets/blocks/* against the measured matrix
 *   5. blueprint fixtures   — every tests/fixtures/*.blueprint.json against the schema
 *   6. unit tests           — npm ci && npm test in shesha-form-edit
 *
 * Wire this into CI as `npm --prefix plugins/shesha-developer run verify`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORM_EDIT = path.join(ROOT, 'skills/shesha-form-edit');
const isWin = process.platform === 'win32';

const results = [];
let failed = false;

function step(name, fn) {
  process.stdout.write(`\n── ${name}\n`);
  let ok = false;
  let note = '';
  try { ({ ok, note } = fn() ?? { ok: true }); } catch (e) { ok = false; note = e.message; }
  results.push({ name, ok, note });
  if (!ok) failed = true;
  process.stdout.write(`   ${ok ? 'PASS' : 'FAIL'}${note ? ` — ${note}` : ''}\n`);
}

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
  return r.status === 0;
}

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const SCOPE = [
  'skills/shesha-claude-designer',
  'skills/shesha-design-comprehension',
  'skills/shesha-form-edit',
  'skills/shesha-design-system',
  'scripts',
  'hooks',
];

step('doc claims lint', () => ({ ok: run('node', ['scripts/lint-claims.mjs']) }));

step('JS syntax', () => {
  const files = SCOPE.flatMap((s) => ['.js', '.mjs', '.cjs'].flatMap((x) => walk(path.join(ROOT, s), x)));
  const bad = [];
  for (const f of files) {
    const args = f.endsWith('.cjs') ? ['--check', f] : ['--input-type=module', '--check'];
    const r = f.endsWith('.cjs')
      ? spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
      : spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${path.relative(ROOT, f)}: ${(r.stderr || '').split('\n')[0]}`);
  }
  if (bad.length) { console.error(bad.join('\n')); return { ok: false, note: `${bad.length} file(s) fail to parse` }; }
  return { ok: true, note: `${files.length} scripts parse` };
});

step('JSON parses', () => {
  const files = SCOPE.flatMap((s) => walk(path.join(ROOT, s), '.json'))
    .concat(walk(path.join(ROOT, '.claude-plugin'), '.json'));
  const bad = [];
  for (const f of files) {
    try { JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); }
    catch (e) { bad.push(`${path.relative(ROOT, f)}: ${e.message.split('\n')[0]}`); }
  }
  if (bad.length) { console.error(bad.join('\n')); return { ok: false, note: `${bad.length} invalid` }; }
  return { ok: true, note: `${files.length} JSON files parse` };
});

step('block JSON validation', () => {
  if (!fs.existsSync(path.join(FORM_EDIT, 'scripts/validate-blocks.js'))) return { ok: true, note: 'no validator' };
  return { ok: run('node', ['scripts/validate-blocks.js'], FORM_EDIT) };
});

step('blueprint fixtures match schema', () => {
  const script = path.join(FORM_EDIT, 'scripts/validate-blueprint.mjs');
  if (!fs.existsSync(script)) return { ok: true, note: 'validator not present yet (Phase 5)' };
  const fixtures = walk(path.join(FORM_EDIT, 'tests/fixtures'), '.blueprint.json');
  if (!fixtures.length) return { ok: true, note: 'no fixtures' };
  const bad = fixtures.filter((f) => !run('node', [script, f], FORM_EDIT));
  return bad.length
    ? { ok: false, note: `${bad.length}/${fixtures.length} fixtures invalid` }
    : { ok: true, note: `${fixtures.length} fixtures valid` };
});

step('unit tests (shesha-form-edit)', () => {
  const lock = path.join(FORM_EDIT, 'package-lock.json');
  const install = fs.existsSync(lock) ? ['ci'] : ['install'];
  if (!run('npm', [...install, '--no-audit', '--no-fund'], FORM_EDIT)) return { ok: false, note: 'npm install failed' };
  return { ok: run('npm', ['test'], FORM_EDIT) };
});

console.log('\n' + '═'.repeat(60));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` — ${r.note}` : ''}`);
console.log('═'.repeat(60));
console.log(failed ? 'verify: FAILED' : 'verify: OK');
process.exit(failed ? 1 : 0);
