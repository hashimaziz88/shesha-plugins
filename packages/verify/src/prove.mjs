// The integration proof (§5.3). One command ends the session.
//
// "Session complete" is defined as exactly this: `npm run prove` exits 0 and its
// final line is `SESSION COMPLETE — SCOPE A`. A green `npm test`, a satisfied
// to-do list and a confident summary paragraph are explicitly insufficient — that
// combination is the state the pre-rebuild repository was already in.
//
// No path prints SESSION COMPLETE from an incomplete scope. Scope completion is
// read from BUILD-LOG.md, which records a WP complete only when its acceptance
// command exited 0, so this program cannot be satisfied by an author's assertion.
//
// Q1 and Q2 are implemented here and are runnable two ways: `--only Q1,Q2` runs
// them unconditionally (that IS WP-1.a's acceptance command, which necessarily
// runs before the WP is recorded complete), and the full run requires WP-1.a to
// be recorded first. The remaining steps arrive with their subjects in WP-5,
// WP-3a and WP-10; until then they report notRun and `--partial` is the only
// mode that can succeed at all.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EXIT, families, readJsonGuarded, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from './lib/fsx.mjs';
import { completedWps } from './lib/session-state.mjs';

/** The two Q2 subjects (O1): the real revision-2 envelope plus one corpus form. */
const Q2_SUBJECTS = [
  'docs/rebuild-brief/artifacts/bookings-table.revision2.json',
  'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
];

/** @param {string} s @returns {string} */
const sha12 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

/**
 * @param {string} root
 * @returns {Promise<{ok:boolean, lines:string[]}>}
 */
async function runQ1(root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const cleanDir = path.join(root, 'packages/sfs/test/fixtures/clean');
  const fixtures = fs.existsSync(cleanDir) ? fs.readdirSync(cleanDir).filter((f) => f.endsWith('.sfs.json')) : [];
  if (fixtures.length === 0) return { ok: false, lines: ['Q1 FAIL — zero clean fixtures; an empty subject is never a pass'] };
  /** @type {string[]} */
  const lines = [];
  for (const fixture of fixtures) {
    const first = compile(fs.readFileSync(path.join(cleanDir, fixture), 'utf8'));
    const second = compile(JSON.stringify(decompile(first.envelope).sfs));
    if (first.markup !== second.markup) {
      let i = 0;
      while (first.markup[i] === second.markup[i]) i += 1;
      lines.push(`Q1 FAIL ${fixture} — diverges at byte ${i}: `
        + `…${first.markup.slice(Math.max(0, i - 30), i + 90)}… vs …${second.markup.slice(Math.max(0, i - 30), i + 90)}…`);
      return { ok: false, lines };
    }
    lines.push(`Q1 BYTE-EQUAL ${fixture} ${Buffer.byteLength(first.markup, 'utf8')} bytes sha256=${sha12(first.markup)}`);
  }
  return { ok: true, lines };
}

/**
 * @param {string} root
 * @returns {Promise<{ok:boolean, lines:string[]}>}
 */
async function runQ2(root) {
  const oracle = path.join(root, 'packages/sfs/tools/normalise-legacy.mjs');
  if (!fs.existsSync(oracle)) return { ok: false, lines: ['Q2 FAIL — tools/normalise-legacy.mjs is missing; one arm proves nothing'] };
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const { normalForm } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/lib/normalForm.mjs')).href);
  /** @type {string[]} */
  const lines = [];
  for (const subject of Q2_SUBJECTS) {
    const abs = path.join(root, subject);
    if (!fs.existsSync(abs)) return { ok: false, lines: [`Q2 FAIL — subject missing: ${subject}`] };
    const arm1 = normalForm(compile(JSON.stringify(decompile(fs.readFileSync(abs, 'utf8')).sfs)).markup);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-prove-')), 'oracle.form.json');
    execFileSync(process.execPath, [oracle, abs, '--out', out], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const arm2 = normalForm(fs.readFileSync(out, 'utf8'));
    if (arm1 !== arm2) {
      let i = 0;
      while (arm1[i] === arm2[i]) i += 1;
      lines.push(`Q2 FAIL ${path.basename(subject)} — normal forms diverge at byte ${i}: `
        + `…${arm1.slice(Math.max(0, i - 40), i + 100)}… vs …${arm2.slice(Math.max(0, i - 40), i + 100)}…`);
      return { ok: false, lines };
    }
    lines.push(`Q2 BYTE-EQUAL ${path.basename(subject)} ${Buffer.byteLength(arm1, 'utf8')} bytes sha256=${sha12(arm1)}`);
  }
  return { ok: true, lines };
}

/** The proof's ordered steps. Each names the WP that makes it runnable, and the
 *  implemented ones carry their runner. */
const STEPS = [
  { id: 'green', label: 'green', needs: 'WP-0', impl: null },
  { id: 'compile', label: 'compile', needs: 'WP-5', impl: null },
  { id: 'Q1', label: 'Q1 selfconsist', needs: 'WP-1.a', impl: runQ1 },
  { id: 'Q2', label: 'Q2 oracle', needs: 'WP-1.a', impl: runQ2 },
  { id: 'Q3', label: 'Q3 escapes', needs: 'WP-5', impl: null },
  { id: 'Q4', label: 'Q4 defects', needs: 'WP-5', impl: null },
  { id: 'tiers', label: 'tiers', needs: 'WP-3a', impl: null },
  { id: 'uninspectable', label: 'uninspectable', needs: 'WP-3a', impl: null },
  { id: 'roundtrip', label: 'roundtrip', needs: 'WP-5', impl: null },
  { id: 'cost', label: 'cost delta', needs: 'WP-10', impl: null },
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<{scope:string[], done:string[], remaining:string[]}>}
 */
export async function scopeState(ctx) {
  const fams = families([{ name: 'scope', unit: 'file' }]);
  const got = readJsonGuarded(path.join(ctx.repoRoot, 'packages/verify/config/session-scope.json'),
    fams.get('scope'), 'session-scope.json');
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
  const only = (() => {
    const i = process.argv.indexOf('--only');
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : null;
  })();

  const { scope, done, remaining } = await scopeState({ repoRoot: root });
  if (scope.length === 0) {
    console.error('prove: packages/verify/config/session-scope.json is missing or unreadable');
    return EXIT.usage;
  }

  console.log('=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE A) ===');
  console.log(`scope            ${scope.join(' ')}   ${done.length}/${scope.length} complete`);

  const runnable = new Set(done);
  let failed = 0;
  for (const step of STEPS) {
    if (only && !only.includes(step.id)) continue;
    const label = step.label.padEnd(16);
    if (step.impl === null) {
      if (!runnable.has(step.needs)) {
        console.log(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      } else {
        // A step whose WP is complete but whose implementation is absent is a
        // defect, not a pass: it is reported notRun with that distinction stated.
        console.log(`${label} notRun — ${step.needs} is complete but this step ships in a later work package`);
      }
      continue;
    }
    // `--only` runs an implemented step unconditionally: the acceptance command of
    // a WP necessarily runs before that WP is recorded complete.
    if (!only && !runnable.has(step.needs)) {
      console.log(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      continue;
    }
    const result = await step.impl(root);
    for (const line of result.lines) console.log(`${label} ${line}`);
    if (!result.ok) failed += 1;
  }

  if (bless) {
    console.error('\nprove --bless: refused. Blessing an expected-output file is permitted only once');
    console.error('WP-1 has produced Q1/Q2 output to freeze, and once in WP-10. Neither has run.');
    return EXIT.usage;
  }

  if (only) {
    // The step results ARE the verdict in only-mode; scope completion is the full
    // run's business. Nothing here prints SESSION COMPLETE.
    return failed === 0 ? EXIT.pass : EXIT.fail;
  }

  if (failed > 0) {
    console.log(`SESSION INCOMPLETE — ${failed} proof step(s) failed`);
    return EXIT.fail;
  }
  if (remaining.length > 0) {
    console.log(`SESSION INCOMPLETE — completed ${done.length ? done.join(',') : 'none'}; remaining ${remaining.join(',')}`);
    return partial ? EXIT.partial : EXIT.fail;
  }

  // Reaching here means every scoped WP is recorded complete. The proof's own
  // remaining steps still have to pass before the final line may be printed, and
  // they do not exist yet, so this path deliberately refuses to print SESSION
  // COMPLETE.
  console.log('SESSION INCOMPLETE — every scoped WP is recorded complete but the proof steps are not implemented');
  return partial ? EXIT.partial : EXIT.fail;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
