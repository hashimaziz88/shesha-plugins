// The gate runner. Discovers every packages/verify/src/gates/g-*.mjs, runs it,
// prints one line per declared family, and exits with the worst verdict.
//
// g-gate-ratchet lives HERE as a structural check rather than as a gate, because
// a ratchet that is itself a gate can be deleted to lower its own floor. It counts
// only gates whose declared inputPaths[] all exist and are non-empty AND which
// declare at least one verdict-flipping mutation: a gate created early cannot
// inflate the count, and a gate that cannot fail was never in it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT, verdictOf, report, readJsonGuarded, families, runGuarded,
} from '@shesha/registry/coverage';
import { repoRoot, rel } from './lib/fsx.mjs';
import { gateFiles, loadGate, countsTowardRatchet } from './lib/gate-loader.mjs';

/**
 * @typedef {import('@shesha/registry/coverage').Family} Family
 * @typedef {import('./lib/gate-loader.mjs').Gate} Gate
 * @typedef {{id:string, verdict:'pass'|'fail'|'partial', families:Family[], counted:boolean, error:string|null}} GateResult
 */

const ROOT = repoRoot();

/**
 * @returns {Promise<{results: GateResult[], worst: 'pass'|'fail'|'partial'}>}
 */
export async function runAll() {
  /** @type {GateResult[]} */
  const results = [];
  for (const file of gateFiles(ROOT)) {
    /** @type {Gate} */
    let gate;
    try {
      gate = await loadGate(file);
    } catch (e) {
      const err = /** @type {Error} */ (e);
      results.push({ id: rel(ROOT, file), verdict: 'fail', families: [], counted: false, error: `gate failed to load: ${err.message}` });
      continue;
    }
    if (typeof gate.run !== 'function' || typeof gate.id !== 'string' || !gate.id) {
      results.push({ id: rel(ROOT, file), verdict: 'fail', families: [], counted: false, error: 'gate exports no id or no run()' });
      continue;
    }
    try {
      const fams = await gate.run({ repoRoot: ROOT });
      results.push({ id: gate.id, verdict: verdictOf(fams), families: fams, counted: countsTowardRatchet(ROOT, gate), error: null });
    } catch (e) {
      const err = /** @type {Error} */ (e);
      // A coverage contract breach produces NO verdict. It is reported as a
      // failure of the run, never silently downgraded to a gate result.
      results.push({ id: gate.id, verdict: 'fail', families: [], counted: countsTowardRatchet(ROOT, gate), error: `${err.name}: ${err.message}` });
    }
  }
  const worst = results.some((r) => r.verdict === 'fail') ? 'fail'
    : results.some((r) => r.verdict === 'partial') ? 'partial' : 'pass';
  return { results, worst };
}

/**
 * @param {string} root
 * @returns {{minGates:number}}
 */
function ratchetConfig(root) {
  const fam = families([{ name: 'config', unit: 'file' }]).get('config');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/gate-ratchet.json'), fam, 'gate-ratchet.json');
  if (!got.ok) return { minGates: 0 };
  const cfg = /** @type {{minGates?:number}} */ (got.value);
  return { minGates: typeof cfg.minGates === 'number' ? cfg.minGates : 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const { results, worst } = await runAll();

  if (args.includes('--count')) {
    console.log(String(results.filter((r) => r.counted).length));
    return EXIT.pass;
  }

  const asJson = args.includes('--json');
  if (asJson) {
    console.log(JSON.stringify({
      worst,
      gates: results.map((r) => ({
        id: r.id, verdict: r.verdict, counted: r.counted, error: r.error,
        families: r.families.map((f) => ({
          name: f.name, unit: f.unit, walked: f.walked, checked: f.checked,
          assertions: f.assertions, notApplicable: f.notApplicable.length,
          uninspectable: f.uninspectable.length, failures: f.failures,
        })),
      })),
    }, null, 2));
  } else {
    for (const r of results) {
      if (r.error) console.log(`${r.id}\n  ERROR ${r.error}`);
      else console.log(report(r.families, { title: r.id }));
      console.log('');
    }
  }

  const pass = results.filter((r) => r.verdict === 'pass').length;
  const fail = results.filter((r) => r.verdict === 'fail').length;
  const partial = results.filter((r) => r.verdict === 'partial').length;
  const counted = results.filter((r) => r.counted).length;
  const { minGates } = ratchetConfig(ROOT);

  console.log(`gates: ${results.length} run, ${pass} pass, ${fail} fail, ${partial} partial`);

  if (counted < minGates) {
    console.log(`gate ratchet: FAIL — ${counted} countable gate(s) against a floor of ${minGates}. ` +
      'Lowering the floor requires a DECISIONS.md row beginning "Gate removal:".');
    return EXIT.fail;
  }
  console.log(`gate ratchet: ${counted} countable >= floor ${minGates}`);

  // Machine record for write-evidence.mjs (D-048). Gitignored: the evidence file
  // itself is the committed artifact, and it is written from this, never by hand.
  const buildDir = path.join(ROOT, '.build');
  fs.mkdirSync(buildDir, { recursive: true });
  /** @type {Record<string, {walked:number, checked:number, uninspectable:number}>} */
  const perGateCoverage = {};
  for (const r of results) {
    perGateCoverage[r.id] = {
      walked: r.families.reduce((n, f) => n + f.walked, 0),
      checked: r.families.reduce((n, f) => n + f.checked, 0),
      uninspectable: r.families.reduce((n, f) => n + f.uninspectable.length, 0),
    };
  }
  fs.writeFileSync(path.join(buildDir, 'gates.json'), `${JSON.stringify({
    worst, run: results.length, pass, fail, partial, counted, minGates, perGateCoverage,
  }, null, 2)}\n`);

  return worst === 'pass' ? EXIT.pass : worst === 'partial' ? EXIT.partial : EXIT.fail;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(main));
}
