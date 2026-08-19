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
async function runQ1(/** @type {string} */ root) {
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
async function runQ2(/** @type {string} */ root) {
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

const GOLDEN = 'docs/rebuild-brief/artifacts/bookings-table.revision2.json';
const CLEAN_SCREEN = 'inline-editable-table';

/** Step 1: `npm run green` as a subprocess — the whole gate + mutation suite. */
async function runGreen(/** @type {string} */ root) {
  try {
    execFileSync('npm', ['run', 'green'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    return { ok: true, lines: ['PASS — typecheck + tests + gates + mutations all exit 0'] };
  } catch {
    return { ok: false, lines: ['FAIL — npm run green exited non-zero'] };
  }
}

/** Step 2: compile the clean screen; capture markup bytes + sha. */
async function runCompile(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const src = fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean', `${CLEAN_SCREEN}.sfs.json`), 'utf8');
  const r = compile(src, { source: CLEAN_SCREEN });
  const markup = String(r.envelope.Markup);
  return { ok: true, lines: [`${CLEAN_SCREEN} markup ${Buffer.byteLength(markup, 'utf8')} bytes sha256=${sha12(markup)}`] };
}

/** Step 5 (Q3): structural escapes of the decompiled golden are zero. */
async function runQ3(/** @type {string} */ root) {
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const d = decompile(fs.readFileSync(path.join(root, GOLDEN), 'utf8'));
  const n = d.structuralEscapes;
  return { ok: n === 0, lines: [n === 0 ? 'structuralEscapes 0' : `FAIL — ${n} structural escape(s) on the golden`] };
}

/** Step 6 (Q4): T2 over compile(decompile(inline-editable-table)) passes — the
 *  legacy defects are gone once the form is round-tripped through the compiler. */
const Q4_SUBJECT = 'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json';
async function runQ4(/** @type {string} */ root) {
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const { decompile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/decompile/index.mjs')).href);
  const { t2Registry } = await import(pathToFileURL(path.join(root, 'packages/verify/src/tiers/t2-registry.mjs')).href);
  const { verdictOf } = await import(pathToFileURL(path.join(root, 'packages/registry/src/coverage.mjs')).href);
  const r = compile(JSON.stringify(decompile(fs.readFileSync(path.join(root, Q4_SUBJECT), 'utf8')).sfs));
  const v = verdictOf(t2Registry(JSON.parse(String(r.envelope.Markup)), r.meta, {}));
  return { ok: v === 'pass', lines: [v === 'pass' ? 'T2 over recompiled inline-editable-table: pass (defect classes absent)' : `FAIL — T2 verdict ${v}`] };
}

/** Step 7: verify --tiers t1,t2 on the clean screen is a pass. */
async function runTiers(/** @type {string} */ root) {
  const { runLadder } = await import(pathToFileURL(path.join(root, 'packages/verify/src/verify.mjs')).href);
  const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-prove-')), 'run');
  const { verdict, exit } = await runLadder({ root, runDir, screen: CLEAN_SCREEN, tiers: ['t1', 't2'], legacy: false, metadata: null });
  return { ok: exit === EXIT.pass && verdict.result === 'pass', lines: [`t1 ${verdict.tiers.T1.result} · t2 ${verdict.tiers.T2.result} · exit ${exit}`] };
}

/** Step 8: verify --tiers t1 on a SYNTHESISED envelope is partial, exit 3. */
async function runUninspectable(/** @type {string} */ root) {
  const { runLadder } = await import(pathToFileURL(path.join(root, 'packages/verify/src/verify.mjs')).href);
  const { compile } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/compile/index.mjs')).href);
  const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-prove-')), 'run');
  const screens = path.join(runDir, 'screens');
  fs.mkdirSync(screens, { recursive: true });
  // A synthesised screen: a real compiled envelope whose compile report declares the
  // ENVELOPE-SYNTHESISED provenance — detect.mjs's disposition, which T1.01b marks
  // uninspectable (defaults are not observed data), never a pass.
  const r = compile(fs.readFileSync(path.join(root, 'packages/sfs/test/fixtures/clean', `${CLEAN_SCREEN}.sfs.json`), 'utf8'), { source: 'synth' });
  fs.writeFileSync(path.join(screens, 'synthesised-envelope.form.json'), `${JSON.stringify(r.envelope, null, 2)}\n`);
  fs.writeFileSync(path.join(screens, 'synthesised-envelope.form.meta.json'), `${JSON.stringify(r.meta, null, 2)}\n`);
  fs.writeFileSync(path.join(screens, 'synthesised-envelope.compile.json'), `${JSON.stringify({ provenance: 'ENVELOPE-SYNTHESISED' }, null, 2)}\n`);
  const { verdict, exit } = await runLadder({ root, runDir, screen: 'synthesised-envelope', tiers: ['t1'], legacy: false, metadata: null });
  const ok = exit === EXIT.partial && verdict.result === 'partial';
  return { ok, lines: [`synthesised t1 ${verdict.result} · exit ${exit} · A partial verdict is NOT a pass`] };
}

/** Step 9: the corpus round-trip is at or above 0.90 with nothing untriaged. */
async function runRoundtrip(/** @type {string} */ root) {
  const { roundtrip } = await import(pathToFileURL(path.join(root, 'packages/sfs/src/roundtrip.mjs')).href);
  const r = roundtrip(root, 'packages/sfs/config/roundtrip-expected.json');
  const rate = /** @type {any} */ (r.report).rate;
  return { ok: r.ok && rate >= 0.90, lines: [`rate ${rate.toFixed(2)} · untriaged 0 · ${r.ok ? 'ok' : 'FAIL'}`] };
}

/** Step 10: cost-delta ratios are above their floors. */
async function runCost(/** @type {string} */ root) {
  try {
    const out = execFileSync(process.execPath, ['packages/sfs/tools/cost-delta.mjs', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const j = JSON.parse(out);
    const ok = j.emitted && j.preload && j.emitted.ratio >= j.emitted.floor && j.preload.ratio >= j.preload.floor;
    return { ok, lines: [`emitted ${j.emitted.ratio}x (floor ${j.emitted.floor}) · preload ${j.preload.ratio}x (floor ${j.preload.floor})`] };
  } catch (e) {
    return { ok: false, lines: [`FAIL — cost-delta: ${/** @type {Error} */ (e).message.split('\n')[0]}`] };
  }
}

/** The proof's ordered steps. Each names the WP that makes it runnable. */
const STEPS = [
  { id: 'green', label: 'green', needs: 'WP-0', impl: runGreen },
  { id: 'compile', label: 'compile', needs: 'WP-5.a', impl: runCompile },
  { id: 'Q1', label: 'Q1 selfconsist', needs: 'WP-1.a', impl: runQ1 },
  { id: 'Q2', label: 'Q2 oracle', needs: 'WP-1.a', impl: runQ2 },
  { id: 'Q3', label: 'Q3 escapes', needs: 'WP-5.b', impl: runQ3 },
  { id: 'Q4', label: 'Q4 defects', needs: 'WP-5.b', impl: runQ4 },
  { id: 'tiers', label: 'tiers', needs: 'WP-3a.2', impl: runTiers },
  { id: 'uninspectable', label: 'uninspectable', needs: 'WP-3a.2', impl: runUninspectable },
  { id: 'roundtrip', label: 'roundtrip', needs: 'WP-5.b', impl: runRoundtrip },
  { id: 'cost', label: 'cost delta', needs: 'WP-1.b', impl: runCost },
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

  /** @type {string[]} */
  const cap = [];
  /** @param {string} s */
  const say = (s) => { console.log(s); cap.push(s); };
  say('=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE A) ===');
  say(`scope            ${scope.join(' ')}   ${done.length}/${scope.length} complete`);

  const runnable = new Set(done);
  let failed = 0;
  for (const step of STEPS) {
    if (only && !only.includes(step.id)) continue;
    const label = step.label.padEnd(16);
    // `--only` runs an implemented step unconditionally: the acceptance command of a
    // WP necessarily runs before that WP is recorded complete.
    if (!only && !runnable.has(step.needs)) {
      say(`${label} notRun — ${step.needs} is not recorded complete in BUILD-LOG.md`);
      continue;
    }
    const result = await step.impl(root);
    for (const line of result.lines) say(`${label} ${line}`);
    if (!result.ok) failed += 1;
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

  // Every scoped WP is complete and every proof step passed. The stdout block up to
  // this point is frozen into prove.expected.txt — a drift there (a step's output
  // changing) blocks the SESSION COMPLETE line, so the proof cannot silently change
  // shape. `--bless` writes it (CONTROL §5: permitted exactly twice, WP-1 and WP-10);
  // a normal run compares, and only a byte-identical block earns the final line.
  const block = `${cap.join('\n')}\n`;
  const expPath = path.join(root, 'packages/verify/test/prove.expected.txt');
  if (bless) {
    fs.writeFileSync(expPath, block);
    console.log(`\nprove --bless: wrote packages/verify/test/prove.expected.txt (${Buffer.byteLength(block, 'utf8')} B)`);
    return EXIT.pass;
  }
  if (fs.existsSync(expPath)) {
    const exp = fs.readFileSync(expPath, 'utf8');
    if (exp !== block) {
      let i = 0; while (i < exp.length && exp[i] === block[i]) i += 1;
      console.log(`SESSION INCOMPLETE — prove output drifted from prove.expected.txt at byte ${i}`);
      console.log(`  expected …${exp.slice(Math.max(0, i - 20), i + 60)}…`);
      console.log(`  actual   …${block.slice(Math.max(0, i - 20), i + 60)}…`);
      return EXIT.fail;
    }
  } else {
    console.log('SESSION INCOMPLETE — packages/verify/test/prove.expected.txt is missing; run `npm run prove -- --bless` once to freeze it');
    return EXIT.fail;
  }

  console.log('SESSION COMPLETE — SCOPE A');
  return EXIT.pass;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
