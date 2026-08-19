// The enforcer for D-100 (the Scope-B scope change). It proves prove-b.mjs keeps
// Scope B's proof strictly separate from Scope A's frozen one: it reads
// session-scope-b.json (never session-scope.json), never touches
// prove.expected.txt, and cannot print SESSION COMPLETE while any Scope-B WP is
// outstanding. If this file is ever satisfied by a prove-b that reaches into the
// Scope-A proof, the separation that lets Scope B exist at all has broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot, readText } from '../src/lib/fsx.mjs';
import { scopeState } from '../src/prove-b.mjs';

const ROOT = repoRoot();
const PROVE_B = path.join(ROOT, 'packages/verify/src/prove-b.mjs');

test('prove-b reads the Scope-B scope file, not the frozen Scope-A one', () => {
  const src = readText(PROVE_B) || '';
  assert.ok(src.includes('session-scope-b.json'), 'prove-b must read session-scope-b.json');
  const withoutB = src.replace(/session-scope-b\.json/g, '');
  assert.ok(!withoutB.includes('session-scope.json'),
    "prove-b must NOT read session-scope.json — that is Scope A's frozen file");
  assert.ok(!src.includes('prove.expected.txt'),
    "prove-b must NOT touch prove.expected.txt — Scope A's two --bless uses are spent (CONTROL §5)");
});

test('scopeState resolves against session-scope-b.json and reconciles', async () => {
  const { scope, done, remaining } = await scopeState({ repoRoot: ROOT });
  assert.ok(scope.length > 0, 'Scope B declares at least one WP');
  assert.equal(done.length + remaining.length, scope.length, 'done + remaining == scope');
});

test('prove-b cannot print SESSION COMPLETE while any Scope-B WP is outstanding', async () => {
  const { remaining } = await scopeState({ repoRoot: ROOT });
  if (remaining.length === 0) return; // negative-path test only applies while work is outstanding

  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [PROVE_B, '--partial'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    const err = /** @type {{status?:number, stdout?:string}} */ (e);
    code = typeof err.status === 'number' ? err.status : 1;
    out = err.stdout || '';
  }
  assert.equal(code, 3, 'with WPs outstanding, prove-b --partial exits 3 (partial), never 0');
  assert.ok(out.includes('SCOPE B'), 'the proof identifies itself as Scope B');
  assert.ok(out.includes('SESSION INCOMPLETE'), 'an incomplete scope prints SESSION INCOMPLETE');
  assert.ok(!out.includes('SESSION COMPLETE'), 'SESSION COMPLETE must not appear while work is outstanding');
});
