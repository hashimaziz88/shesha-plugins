// §3.5.1: a check class with no mutation does not exist as far as the repo is
// concerned. Every id in a tier's exported `checks[]` must appear in the union of
// that tier's `mutations[].covers` — unless the check is explicitly `subsumed`
// (enforced elsewhere, e.g. T2.17 by TOK-2010, BL-023). The tier-mutation test
// PROVES each mutation flips; this gate is the static completeness ledger, read
// from source so a staged edit that drops a `covers` entry is seen.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-mutation-coverage';
export const describe = "every tier check id is covered by a mutation's covers[], or is explicitly subsumed";
export const inputPaths = [
  'packages/verify/src/tiers/t1-schema.mjs',
  'packages/verify/src/tiers/t2-registry.mjs',
  'package.json',
];

const TIERS = [
  { tier: 't1', file: 'packages/verify/src/tiers/t1-schema.mjs' },
  { tier: 't2', file: 'packages/verify/src/tiers/t2-registry.mjs' },
];

/**
 * Parse a tier module's check registry and mutation covers from source.
 * @param {string} text
 * @returns {{checkIds:string[], subsumed:Set<string>, covered:Set<string>}}
 */
export function parseCoverage(text) {
  const checksBlock = /export const checks = \[([\s\S]*?)\n\];/.exec(text);
  const mutBlock = /export const mutations = \[([\s\S]*?)\n\];/.exec(text);
  /** @type {string[]} */
  const checkIds = [];
  /** @type {Set<string>} */
  const subsumed = new Set();
  if (checksBlock) {
    // Group 1 is mandatory in each pattern, so it is defined whenever the match succeeds.
    for (const line of (/** @type {string} */ (checksBlock[1])).split('\n')) {
      const idm = /\bid: '(T\d[\w.]*)'/.exec(line);
      if (!idm) continue;
      const id = /** @type {string} */ (idm[1]);
      checkIds.push(id);
      if (/\bsubsumed:/.test(line)) subsumed.add(id);
    }
  }
  /** @type {Set<string>} */
  const covered = new Set();
  if (mutBlock) {
    // Group 1 is mandatory in each pattern, so it is defined whenever the match succeeds.
    for (const m of (/** @type {string} */ (mutBlock[1])).matchAll(/covers: \[([^\]]*)\]/g)) {
      for (const c of (/** @type {string} */ (m[1])).matchAll(/'(T\d[\w.]*)'/g)) covered.add(/** @type {string} */ (c[1]));
    }
  }
  return { checkIds, subsumed, covered };
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'coverage', unit: 'check' }]);
  const fam = fams.get('coverage');

  for (const { tier, file } of TIERS) {
    const text = readText(path.join(root, file));
    if (text === null) { fam.pointer(`${tier}#file`).fail(`${file} is unreadable`); continue; }
    const { checkIds, subsumed, covered } = parseCoverage(text);
    if (checkIds.length === 0) { fam.pointer(`${tier}#checks`).fail(`${file} exports no checks[]`); continue; }
    for (const cid of checkIds) {
      const p = fam.pointer(`${tier}:${cid}`);
      if (subsumed.has(cid)) { p.na(`${cid} is subsumed (enforced elsewhere)`); continue; }
      p.assert(covered.has(cid), `${cid} has no covering mutation in ${file} — a check with no mutation does not exist (§3.5.1)`);
    }
  }
  return fams.list;
}

export const mutations = [
  {
    name: 'a tier check loses its covering mutation',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/tiers/t2-registry.mjs');
      const text = fs.readFileSync(f, 'utf8');
      // Drop T2.01 from its mutation's covers[], leaving the check uncovered.
      fs.writeFileSync(f, text.replace("covers: ['T2.01']", 'covers: []'));
    },
    expect: 'fail',
  },
  {
    name: 'a new check is added with no mutation',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/tiers/t1-schema.mjs');
      const text = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, text.replace('export const checks = [',
        "export const checks = [\n  { id: 'T1.99', family: 'structure', describe: 'planted uncovered check' },"));
    },
    expect: 'fail',
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
