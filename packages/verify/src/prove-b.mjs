// The Scope B integration proof (D-100). The Scope-B counterpart of prove.mjs.
//
// "Scope B complete" is defined as exactly this: `npm run prove-b` exits 0 and its
// final line is `SESSION COMPLETE — SCOPE B`. It reads the Scope-B scope file
// (session-scope-b.json) — never the frozen Scope-A one — and byte-compares its own
// output block against packages/verify/test/prove-b.expected.txt, blessed exactly
// once (D-100) when every Scope-B WP is complete. Scope A's proof and its frozen
// expected file are never touched here; their two --bless uses (CONTROL §5) stay
// spent.
//
// STEPS starts empty: each Scope-B WP adds exactly one deterministic step as it
// lands (compiler robustness, decompiler hygiene, IR nodes, T3, …), the same way
// prove.mjs grew its ten steps across Scope A. Until the scope is complete, only
// SESSION INCOMPLETE can print, and `--partial` is the only mode that exits 3
// rather than failing.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, readJsonGuarded, families, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from './lib/fsx.mjs';
import { completedWps } from './lib/session-state.mjs';

/** A minimal create form whose one field is `component`. @param {string} component */
const leafForm = (component) => JSON.stringify({
  sfs: '1.0', form: `robust-${component}`, module: 'boxfusion.test', kind: 'create',
  entity: 'boxfusion.test.Domain.Test.Thing', label: 'R', submits: true, page: { title: 'R' },
  body: [{ node: 'col', name: 'formBody', children: [{ node: 'field', name: 'x', bind: 'xValue', component }] }],
});

/** WP-5c: leaf input types (no registry defaults, object-shaped slots) compile, not crash. */
async function runRobustness(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const types = ['checkbox', 'switch', 'radio'];
  /** @type {string[]} */
  const failures = [];
  for (const c of types) {
    try { compile(leafForm(c)); } catch (e) { failures.push(`${c}: ${(/** @type {Error} */ (e)).message}`); }
  }
  return failures.length === 0
    ? { ok: true, lines: [`leaf input types compile: ${types.join(', ')} (was the 498-form compile-npe)`] }
    : { ok: false, lines: failures.map((f) => `FAIL ${f}`) };
}

/**
 * The proof's ordered steps. Each names the Scope-B WP that makes it runnable and
 * is added in that WP's commit.
 * @type {{id:string, label:string, needs:string, impl:(root:string)=>Promise<{ok:boolean, lines:string[]}>}[]}
 */
const STEPS = [
  { id: 'robustness', label: 'compiler robust', needs: 'WP-5c', impl: runRobustness },
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<{scope:string[], done:string[], remaining:string[]}>}
 */
export async function scopeState(ctx) {
  const fams = families([{ name: 'scope', unit: 'file' }]);
  const got = readJsonGuarded(path.join(ctx.repoRoot, 'packages/verify/config/session-scope-b.json'),
    fams.get('scope'), 'session-scope-b.json');
  if (!got.ok) return { scope: [], done: [], remaining: [] };
  const scope = /** @type {{wps:string[]}} */ (got.value).wps || [];
  const completed = completedWps(ctx.repoRoot);
  const done = scope.filter((w) => completed.has(w));
  const remaining = scope.filter((w) => !completed.has(w));
  return { scope, done, remaining };
}

async function main() {
  const root = repoRoot();
  const partial = process.argv.includes('--partial');
  const bless = process.argv.includes('--bless');

  const { scope, done, remaining } = await scopeState({ repoRoot: root });
  if (scope.length === 0) {
    console.error('prove-b: packages/verify/config/session-scope-b.json is missing or unreadable');
    return EXIT.usage;
  }

  /** @type {string[]} */
  const cap = [];
  /** @param {string} s */
  const say = (s) => { console.log(s); cap.push(s); };
  say('=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE B) ===');
  say(`scope            ${scope.join(' ')}   ${done.length}/${scope.length} complete`);

  const runnable = new Set(done);
  let failed = 0;
  for (const step of STEPS) {
    const label = step.label.padEnd(16);
    if (!runnable.has(step.needs)) {
      say(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      continue;
    }
    const result = await step.impl(root);
    for (const line of result.lines) say(`${label} ${line}`);
    if (!result.ok) failed += 1;
  }

  if (failed > 0) {
    console.log(`SESSION INCOMPLETE — ${failed} proof step(s) failed`);
    return EXIT.fail;
  }
  if (remaining.length > 0) {
    console.log(`SESSION INCOMPLETE — completed ${done.length ? done.join(',') : 'none'}; remaining ${remaining.join(',')}`);
    return partial ? EXIT.partial : EXIT.fail;
  }

  // Every scoped WP complete and every step passed. The stdout block is frozen into
  // prove-b.expected.txt; --bless writes it (D-100: permitted exactly once for Scope
  // B), a normal run byte-compares, and only an identical block earns the final line.
  const block = `${cap.join('\n')}\n`;
  const expPath = path.join(root, 'packages/verify/test/prove-b.expected.txt');
  if (bless) {
    fs.writeFileSync(expPath, block);
    console.log(`\nprove-b --bless: wrote packages/verify/test/prove-b.expected.txt (${Buffer.byteLength(block, 'utf8')} B)`);
    return EXIT.pass;
  }
  if (!fs.existsSync(expPath)) {
    console.log('SESSION INCOMPLETE — packages/verify/test/prove-b.expected.txt is missing; run `npm run prove-b -- --bless` once to freeze it');
    return EXIT.fail;
  }
  const exp = fs.readFileSync(expPath, 'utf8');
  if (exp !== block) {
    let i = 0; while (i < exp.length && exp[i] === block[i]) i += 1;
    console.log(`SESSION INCOMPLETE — prove-b output drifted from prove-b.expected.txt at byte ${i}`);
    return EXIT.fail;
  }

  console.log('SESSION COMPLETE — SCOPE B');
  return EXIT.pass;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
