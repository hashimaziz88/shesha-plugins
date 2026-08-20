// D-108, WP-3b.3c (§3.2.4): the set of checks allowed to report `uninspectable` is
// bounded, and only names real checks.
//
// A tier that cannot reach a backend disposes its backend-dependent checks
// `uninspectable` (partial), never a pass. That is honest, but an unbounded license to
// say "I couldn't look" is how a verifier quietly stops verifying. This gate holds the
// license to a declared budget: every classA key is a real check id in some tier, every
// admitting decision exists, every entry carries a reason pattern, and the set never
// grows past `max` (which ratchets down only).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';
import { parseCoverage } from './g-mutation-coverage.mjs';

export const id = 'g-uninspectable-budget';
export const describe = 'every uninspectable-budget classA key is a real tier check with a reason pattern and an existing decision, and the set is within max';
export const inputPaths = [
  'packages/verify/config/uninspectable-budget.json',
  'packages/verify/src/tiers/t1-schema.mjs',
  'packages/verify/src/tiers/t2-registry.mjs',
  'packages/verify/src/tiers/t3-semantic.mjs',
  'DECISIONS.md',
];

const BUDGET = 'packages/verify/config/uninspectable-budget.json';
const TIERS = [
  'packages/verify/src/tiers/t1-schema.mjs',
  'packages/verify/src/tiers/t2-registry.mjs',
  'packages/verify/src/tiers/t3-semantic.mjs',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'budget', unit: 'entry' }]);
  const fam = fams.get('budget');

  const got = readJsonGuarded(path.join(root, BUDGET), fam, BUDGET);
  if (!got.ok) return fams.list;
  const cfg = /** @type {{max:number, classA:Record<string, {reasonPattern?:string, decision?:string}>}} */ (got.value);
  const classA = cfg.classA || {};

  /** @type {Set<string>} */
  const checkIds = new Set();
  for (const f of TIERS) {
    const text = readText(path.join(root, f));
    if (text === null) continue;
    for (const cid of parseCoverage(text).checkIds) checkIds.add(cid);
  }
  const decisions = readText(path.join(root, 'DECISIONS.md')) || '';

  for (const [key, entry] of Object.entries(classA)) {
    const p = fam.pointer(`classA:${key}`);
    const problems = [];
    if (!checkIds.has(key)) problems.push('is not a check id exported by any tier');
    if (!entry || typeof entry.reasonPattern !== 'string' || !entry.reasonPattern) problems.push('has no reasonPattern');
    if (!entry || typeof entry.decision !== 'string' || !/^D-\d{3}$/.test(entry.decision)) problems.push('names no D-0NN decision');
    else if (!new RegExp(`^\\|\\s*${entry.decision}\\s*\\|`, 'm').test(decisions)) problems.push(`decision ${entry.decision} has no row in DECISIONS.md`);
    p.assert(problems.length === 0, `uninspectable-budget classA "${key}" ${problems.join('; ')}`);
  }

  fam.pointer('budget#max').assert(Object.keys(classA).length <= cfg.max,
    `${Object.keys(classA).length} classA entries against max ${cfg.max}; the budget ratchets down only`);

  return fams.list;
}

export const mutations = [
  {
    name: 'the budget admits a check id no tier exports',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, BUDGET);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.classA['T3.99'] = { reasonPattern: '^(backend|metadata) unavailable', decision: 'D-108' };
      j.max = Object.keys(j.classA).length;
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the classA set grows past its max',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, BUDGET);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.classA['T3.04'] = { reasonPattern: '^(backend|metadata) unavailable', decision: 'D-108' };
      // leave max unchanged so the set exceeds it
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
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
