// The ladder driver (§3.2.0). Runs the requested tiers in order over one screen,
// combines them into a single `result` over the lattice pass < partial < fail, and
// writes <run-dir>/screens/<screen>.verdict.json. Exit is exitFor(result), except
// that a PASS with any REQUESTED tier reporting notRun exits 3 — asking for a tier
// and not getting it is partial information about what you asked for.
//
//   node packages/verify/src/verify.mjs <run-dir> --screen <name> [--tiers t1,t2]
//        [--legacy] [--metadata <snapshot.json>] [--json]
//
// A screen is resolved to a compiled form: an existing <run-dir>/screens/<screen>.form.json
// is read as-is; otherwise the clean fixture packages/sfs/test/fixtures/clean/<screen>.sfs.json
// is compiled into the run-dir. T4 and T5 never enter `result` (D-015) and are not
// built in Scope A; requesting them yields notRun with a reason.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot, readText } from './lib/fsx.mjs';
import { t1Full, readArtifact } from './tiers/t1-schema.mjs';
import { t2Registry } from './tiers/t2-registry.mjs';

const LATTICE = /** @type {Record<string, number>} */ ({ pass: 0, partial: 1, fail: 2 });
const RESULT_TIERS = ['T1', 'T2', 'T3'];

/**
 * Read an already-compiled screen from the run-dir. Provenance comes from the
 * compile report sidecar when present (a synthesised envelope records it).
 * @param {string} runDir absolute
 * @param {string} screen
 * @returns {{art:{envelope:any,doc:any}, meta:any, sfs:undefined, provenance:string|undefined}}
 */
function readCompiledScreen(runDir, screen) {
  const screensDir = path.join(runDir, 'screens');
  const raw = readText(path.join(screensDir, `${screen}.form.json`)) || '';
  const art = readArtifact(raw);
  const metaPath = path.join(screensDir, `${screen}.form.meta.json`);
  const meta = fs.existsSync(metaPath) ? JSON.parse(readText(metaPath) || 'null') : null;
  const reportPath = path.join(screensDir, `${screen}.compile.json`);
  const report = fs.existsSync(reportPath) ? JSON.parse(readText(reportPath) || '{}') : {};
  return { art, meta, sfs: undefined, provenance: report.provenance };
}

/**
 * @param {{root:string, runDir:string, screen:string, tiers:string[], legacy:boolean, metadata:string|null}} opts
 * @returns {Promise<{verdict:any, exit:number, lines:string[]}>}
 */
export async function runLadder(opts) {
  const { root, runDir, screen, tiers, legacy } = opts;
  const screensDir = path.join(runDir, 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  // Resolve the screen to a compiled form, compiling the clean fixture if needed.
  let art; let meta = null; let sfs; let provenance;
  const formPath = path.join(screensDir, `${screen}.form.json`);
  if (fs.existsSync(formPath)) {
    ({ art, meta, sfs, provenance } = readCompiledScreen(runDir, screen));
  } else {
    const sfsPath = path.join(root, 'packages/sfs/test/fixtures/clean', `${screen}.sfs.json`);
    const sfsText = readText(sfsPath);
    if (sfsText === null) throw new Error(`no compiled form and no clean fixture for screen "${screen}"`);
    const { compile } = await import('../../sfs/src/compile/index.mjs');
    const r = compile(sfsText, { source: sfsPath });
    fs.writeFileSync(formPath, `${JSON.stringify(r.envelope, null, 2)}\n`);
    fs.writeFileSync(path.join(screensDir, `${screen}.form.meta.json`), `${JSON.stringify(r.meta, null, 2)}\n`);
    art = { envelope: r.envelope, doc: JSON.parse(String(r.envelope.Markup)) };
    meta = r.meta;
    sfs = JSON.parse(sfsText);
    provenance = /** @type {any} */ (r.report).provenance;
  }

  /** @type {Record<string, {result:string, reason?:string, detail?:any}>} */
  const tierResults = { T1: notRun('not requested'), T2: notRun('not requested'), T3: notRun('not requested'), T4: notRun('T4 is BL-005'), T5: notRun('T5 is BL-005') };
  const lines = [];

  if (tiers.includes('t1')) {
    const fams = t1Full(root, art, { sfs, meta, legacy, provenance });
    const v = verdictOf(fams);
    tierResults.T1 = { result: v, detail: detailOf(fams) };
    lines.push(tierLine('t1', fams, v));
  }
  if (tiers.includes('t2')) {
    const fams = t2Registry(art.doc, meta, { legacy });
    const v = verdictOf(fams);
    tierResults.T2 = { result: v, detail: detailOf(fams) };
    lines.push(tierLine('t2', fams, v));
  }
  if (tiers.includes('t3')) {
    tierResults.T3 = notRun('T3 semantic tier is WP-3b (BL-003)');
  }

  // result = worst(T1,T2,T3) over pass<partial<fail; a REQUESTED result-tier that
  // did not run forces fail (§3.2.0 rule 2). T4/T5 never enter result.
  let result = 'pass';
  for (const t of RESULT_TIERS) {
    const r = tierResults[t].result;
    const requested = tiers.includes(t.toLowerCase());
    if (!requested) continue;
    if (r === 'notRun') { result = 'fail'; continue; }
    if (LATTICE[r] > LATTICE[result]) result = r;
  }

  const verdict = {
    screen,
    result,
    tiers: tierResults,
    sealedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(screensDir, `${screen}.verdict.json`), `${JSON.stringify(verdict, null, 2)}\n`);

  // exit: exitFor(result), except a PASS with a requested tier notRun -> 3.
  let exit = result === 'pass' ? EXIT.pass : (result === 'partial' ? EXIT.partial : EXIT.fail);
  const requestedNotRun = tiers.some((t) => RESULT_TIERS.includes(t.toUpperCase()) && tierResults[t.toUpperCase()].result === 'notRun');
  if (result === 'pass' && requestedNotRun) exit = EXIT.partial;
  if (result !== 'pass') lines.push('A partial verdict is NOT a pass');
  lines.push(`verify ${screen}: result ${result} · tiers ${tiers.join(',')} · exit ${exit}`);
  return { verdict, exit, lines };
}

/** @param {string} reason @returns {{result:string, reason:string}} */
function notRun(reason) { return { result: 'notRun', reason }; }

/** @param {import('@shesha/registry/coverage').Family[]} fams */
function detailOf(fams) {
  return {
    uninspectable: fams.flatMap((f) => f.uninspectable.map((u) => ({ where: u.where, reason: u.reason, checkId: /** @type {any} */ (u).checkId }))),
    failures: fams.flatMap((f) => f.failures.map((x) => x.reason)),
  };
}

/** @param {string} tier @param {import('@shesha/registry/coverage').Family[]} fams @param {string} v */
function tierLine(tier, fams, v) {
  const walked = fams.reduce((n, f) => n + f.walked, 0);
  const checked = fams.reduce((n, f) => n + f.checked, 0);
  const fail = fams.reduce((n, f) => n + f.failures.length, 0);
  return `  ${tier} ${v} · families ${fams.length} · walked ${walked} · checked ${checked} · failures ${fail}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const runDirArg = args.find((a) => !a.startsWith('--'));
  const at = (/** @type {string} */ flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  if (!runDirArg || !at('--screen')) {
    console.error('usage: verify.mjs <run-dir> --screen <name> [--tiers t1,t2] [--legacy] [--json]');
    process.exit(EXIT.usage);
  }
  const root = repoRoot();
  const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.join(root, runDirArg);
  const tiers = (at('--tiers') || 't1,t2,t3').split(',').map((s) => s.trim().toLowerCase());
  const screen = /** @type {string} */ (at('--screen'));
  try {
    const { verdict, exit, lines } = await runLadder({ root, runDir, screen, tiers, legacy: args.includes('--legacy'), metadata: at('--metadata') || null });
    if (args.includes('--json')) console.log(JSON.stringify({ target: screen, result: verdict.result, tiers: verdict.tiers }, null, 2));
    else for (const l of lines) console.log(l);
    process.exit(exit);
  } catch (e) {
    console.error(`verify: ${/** @type {Error} */ (e).message}`);
    process.exit(EXIT.usage);
  }
}
