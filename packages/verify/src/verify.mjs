// The ladder driver (§3.2.0). Runs the requested tiers in order over one screen,
// combines them into a single `result` over the lattice pass < partial < fail, and
// writes <run-dir>/screens/<screen>.verdict.json. Exit is exitFor(result), except
// that a PASS with any REQUESTED tier reporting notRun exits 3 — asking for a tier
// and not getting it is partial information about what you asked for.
//
//   node packages/verify/src/verify.mjs <run-dir> --screen <name> [--tiers t1,t2]
//        [--legacy] [--metadata <snapshot.json>] [--base-url <url>] [--smoke <rec.json>]
//        [--probe <probe.json>] [--json]
//
// A screen is resolved to a compiled form: an existing <run-dir>/screens/<screen>.form.json
// is read as-is; otherwise the clean fixture packages/sfs/test/fixtures/clean/<screen>.sfs.json
// is compiled into the run-dir. T4 and T5 never enter `result` (D-015). T4b reports inside
// T4's tier entry: the verdict envelope's `tiers` object is additionalProperties:false over
// T1..T5, so there is no legal T4b key (§4.2.4).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot, readText } from './lib/fsx.mjs';
import { t1Full, readArtifact } from './tiers/t1-schema.mjs';
import { t2Registry } from './tiers/t2-registry.mjs';
import { t3Semantic } from './tiers/t3-semantic.mjs';
import { t4Smoke, t4Available, hasPlaywright, capture as t4Capture } from './tiers/t4-smoke.mjs';
import { t4bResidue } from './tiers/t4b-residue.mjs';
import { t5Visual } from './tiers/t5-visual.mjs';

const LATTICE = /** @type {Record<string, number>} */ ({ pass: 0, partial: 1, fail: 2 });
const RESULT_TIERS = ['T1', 'T2', 'T3'];
/**
 * The tier names the driver understands. An unrecognised name used to be silently
 * ignored, and because `result` starts at `pass` and is only ever raised, asking for a
 * tier that does not exist produced a sealed verdict claiming `pass` over nothing run.
 * `t4b` names the residue half of T4 and runs it alone.
 */
export const KNOWN_TIERS = Object.freeze(['t1', 't2', 't3', 't4', 't4b', 't5']);

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
 * @param {{root:string, runDir:string, screen:string, tiers:string[], legacy:boolean, metadata:string|null,
 *          baseUrl?:string|null, smoke?:string|null, probe?:string|null, judge?:string|null}} opts
 * @returns {Promise<{verdict:any, exit:number, lines:string[]}>}
 */
export async function runLadder(opts) {
  const { root, runDir, screen, tiers, legacy } = opts;
  const unknown = tiers.filter((t) => !KNOWN_TIERS.includes(t));
  if (unknown.length > 0) {
    throw new Error(`unknown tier(s) ${JSON.stringify(unknown)}; known tiers are ${KNOWN_TIERS.join(', ')}. A tier the driver does not recognise runs nothing, and a verdict over nothing is not a pass`);
  }
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
  const tierResults = { T1: notRun('not requested'), T2: notRun('not requested'), T3: notRun('not requested'), T4: notRun('not requested'), T5: notRun('not requested') };
  const lines = [];
  /** Section 4's advisory slot. `result` is never a function of it (D-015). */
  let advisory;

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
    const entity = (art.envelope && art.envelope.ModelType) || (sfs && sfs.entity) || null;
    const contract = loadContract(root, runDir, screen);
    const metadata = loadMetadata(root, runDir, screen, opts.metadata);
    const fams = t3Semantic(art.doc, meta, { legacy, entity, contract, metadata });
    const v = verdictOf(fams);
    tierResults.T3 = { result: v, detail: detailOf(fams) };
    lines.push(tierLine('t3', fams, v));
  }
  // T4 carries both the live smoke tier and T4b's DOM residue. Each half runs only from
  // its own substrate — a recorded smoke run or a live host for T4, a recorded probe for
  // T4b — and with neither the whole tier is notRun with the reason, never a pass.
  if (tiers.includes('t4') || tiers.includes('t4b')) {
    const wantSmoke = tiers.includes('t4');
    const smokeRec = wantSmoke && opts.smoke ? readJsonAt(root, opts.smoke) : null;
    const probe = opts.probe ? readJsonAt(root, opts.probe) : null;
    // A probe of a different screen is not evidence about this one. Silently accepting
    // it would let one clean recording satisfy every screen's T4.
    if (probe && typeof probe.screen === 'string' && probe.screen !== screen) {
      throw new Error(`--probe was recorded from screen "${probe.screen}", not "${screen}"; a probe of another screen is not evidence about this one`);
    }
    const avail = t4Available({ baseUrl: opts.baseUrl || null, playwright: await hasPlaywright() });
    /** @type {import('@shesha/registry/coverage').Family[]} */
    let fams = [];
    const ran = [];
    if (smokeRec) { fams = fams.concat(await t4Smoke(smokeRec, {})); ran.push('smoke:recorded'); }
    else if (wantSmoke && avail.ok) { fams = fams.concat(await t4Smoke(await t4Capture({ baseUrl: String(opts.baseUrl), screen }), {})); ran.push('smoke:live'); }
    if (probe) { fams = fams.concat(t4bResidue(probe)); ran.push('residue:recorded'); }
    if (fams.length === 0) {
      const reason = avail.reason || 'no --smoke record, no --probe and no --base-url given';
      tierResults.T4 = notRun(reason);
      lines.push(`  t4 notRun · ${reason}`);
    } else {
      const v = verdictOf(fams);
      tierResults.T4 = { result: v, reason: ran.join(' + '), detail: detailOf(fams) };
      lines.push(tierLine('t4', fams, v));
      // T4 is advisory (D-015), so a T4 failure leaves `result` and the exit code alone.
      // Saying so on the line below it is the difference between advisory and ignored.
      if (v !== 'pass') lines.push(`  t4 reported ${v} and it is ADVISORY: it does not change result or the exit code (D-015). Read its findings.`);
    }
  }
  // T5 is a ranking signal, never a gate (T5-R8). It runs from a recorded judge verdict;
  // with none it reports notRun, and either way `result` above is untouched — a property
  // g-t5-advisory proves from the other side.
  if (tiers.includes('t5')) {
    const t5in = opts.judge ? readJsonAt(root, opts.judge) : null;
    if (!t5in) {
      tierResults.T5 = notRun('no --judge record given; T5 runs from a recorded judge ranking (BL-034)');
      lines.push(`  t5 notRun · ${tierResults.T5.reason}`);
    } else {
      const r = t5Visual({ screen, runDir, ...t5in });
      const v = verdictOf(r.families);
      tierResults.T5 = { result: v, reason: r.message || undefined, detail: { ...detailOf(r.families), advisory: r.advisory } };
      advisory = r.advisory ? { t5: r.advisory } : undefined;
      fs.writeFileSync(path.join(screensDir, `${screen}.t5.json`), `${JSON.stringify(r.t5, null, 2)}\n`);
      lines.push(tierLine('t5', r.families, v));
      lines.push(`  t5 is ADVISORY: its rank never changes result (D-015)`);
    }
  }

  // result = worst(T1,T2,T3) over pass<partial<fail; a REQUESTED result-tier that
  // did not run forces fail (§3.2.0 rule 2). T4/T5 never enter result.
  let result = 'pass';
  for (const t of RESULT_TIERS) {
    // tierResults is seeded with every tier key, so the lookup is defined.
    const tr = tierResults[t];
    if (tr === undefined) continue;
    const r = tr.result;
    const requested = tiers.includes(t.toLowerCase());
    if (!requested) continue;
    if (r === 'notRun') { result = 'fail'; continue; }
    // r and result are verdicts in the LATTICE (notRun handled above), so both map.
    if (/** @type {number} */ (LATTICE[r]) > /** @type {number} */ (LATTICE[result])) result = r;
  }

  const verdict = {
    screen,
    result,
    tiers: tierResults,
    ...(advisory ? { advisory } : {}),
    sealedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(screensDir, `${screen}.verdict.json`), `${JSON.stringify(verdict, null, 2)}\n`);

  // exit: exitFor(result), except a PASS with ANY requested tier notRun -> 3 (§3.2.0
  // rule 4). Asking for T4 and not getting it is partial information about what you
  // asked for; not asking for it is not.
  let exit = result === 'pass' ? EXIT.pass : (result === 'partial' ? EXIT.partial : EXIT.fail);
  const requestedNotRun = tiers.some((t) => {
    const tr = tierResults[t.toUpperCase()];
    return tr !== undefined && tr.result === 'notRun';
  });
  if (result === 'pass' && requestedNotRun) exit = EXIT.partial;
  if (result !== 'pass') lines.push('A partial verdict is NOT a pass');
  lines.push(`verify ${screen}: result ${result} · tiers ${tiers.join(',')} · exit ${exit}`);
  return { verdict, exit, lines };
}

/** @param {string} reason @returns {{result:string, reason:string}} */
function notRun(reason) { return { result: 'notRun', reason }; }

/**
 * A recorded T4/T4b substrate named on the command line. A malformed file is an error,
 * not an empty recording that would quietly narrow the tier to nothing.
 * @param {string} root @param {string} file @returns {any}
 */
function readJsonAt(root, file) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const raw = readText(abs);
  if (raw === null) throw new Error(`no such recording: ${file}`);
  return JSON.parse(raw);
}

/**
 * The placement contract for a screen: a run-dir override, else the committed clean
 * fixture, else undefined (the T3 contract families then walk nothing). A malformed
 * contract file is surfaced as no-contract rather than crashing the ladder.
 * @param {string} root @param {string} runDir @param {string} screen
 * @returns {{acceptance?:any[], columns?:Record<string, string[]>}|undefined}
 */
function loadContract(root, runDir, screen) {
  const candidates = [
    path.join(runDir, 'screens', `${screen}.contract.json`),
    path.join(root, 'packages/sfs/test/fixtures/contracts', `${screen}.contract.json`),
  ];
  for (const c of candidates) {
    const raw = readText(c);
    if (raw === null) continue;
    try { return JSON.parse(raw); } catch { return undefined; }
  }
  return undefined;
}

/**
 * The recorded metadata snapshot for a screen (§3.2.4). An explicit --metadata path
 * wins; otherwise a run-dir copy, then the committed per-screen fixture. Absent, the T3
 * backend checks stay uninspectable — there is no auto-pass. A malformed file is
 * surfaced as absent rather than crashing the ladder.
 * @param {string} root @param {string} runDir @param {string} screen @param {string|null} explicit
 * @returns {any|null}
 */
function loadMetadata(root, runDir, screen, explicit) {
  const candidates = [
    explicit ? (path.isAbsolute(explicit) ? explicit : path.join(root, explicit)) : null,
    path.join(runDir, 'screens', `${screen}.metadata.json`),
    path.join(root, 'packages/sfs/test/fixtures/metadata', `${screen}.metadata.json`),
  ].filter(Boolean);
  for (const c of /** @type {string[]} */ (candidates)) {
    const raw = readText(c);
    if (raw === null) continue;
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

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
    console.error('usage: verify.mjs <run-dir> --screen <name> [--tiers t1,t2,t3,t4] [--metadata <f>] [--base-url <url>] [--smoke <f>] [--probe <f>] [--legacy] [--json]');
    process.exit(EXIT.usage);
  }
  const root = repoRoot();
  const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.join(root, runDirArg);
  const tiers = (at('--tiers') || 't1,t2,t3').split(',').map((s) => s.trim().toLowerCase());
  const screen = /** @type {string} */ (at('--screen'));
  try {
    const { verdict, exit, lines } = await runLadder({
      root, runDir, screen, tiers, legacy: args.includes('--legacy'), metadata: at('--metadata') || null,
      baseUrl: at('--base-url') || null, smoke: at('--smoke') || null, probe: at('--probe') || null,
      judge: at('--judge') || null,
    });
    if (args.includes('--json')) console.log(JSON.stringify({ target: screen, result: verdict.result, tiers: verdict.tiers }, null, 2));
    else for (const l of lines) console.log(l);
    process.exit(exit);
  } catch (e) {
    console.error(`verify: ${/** @type {Error} */ (e).message}`);
    process.exit(EXIT.usage);
  }
}
