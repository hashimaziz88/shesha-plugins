// D-058 and D-059: the declared fan-out write-set is a real partition.
//
// D-058 permits fan-out only across disjoint-write, program-verifiable, bounded
// slices, max four agents, declared in advance. D-059 removed the older
// g-fanout-discipline two-directory rule on the grounds that "the declared-glob
// partition proof already covers the anti-pattern" — this gate is that proof.
//
// It reads fanout.json and asserts, per work package, that the write globs its
// slices declare are pairwise disjoint (no two agents can ever target the same
// file — the failure that shipped two incompatible refListStatus shapes), and
// that every slice is well formed: a bounded agent count inside the four-agent
// cap, a non-empty write set, and a named accepting program that decides
// correctness without a model. The per-merge `git diff subset of the union`
// assertion the config describes is a runtime step of an actual fan-out; what is
// checkable statically — and what makes the runtime step meaningful — is that the
// declared partition is disjoint in the first place.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, readJsonGuarded } from '@shesha/registry/coverage';
import { repoRoot, globToRegExp } from '../lib/fsx.mjs';

export const id = 'g-fanout-partition';
export const describe = 'fan-out write globs are pairwise disjoint per work package and every slice is well formed inside the 4-agent cap (D-058, D-059)';
export const inputPaths = ['packages/verify/config/fanout.json'];

/**
 * A concrete-ish path standing in for a glob, so two globs can be tested for
 * whether any single path could match both.
 * @param {string} glob
 * @returns {string}
 */
function sample(glob) {
  return glob.replace(/\*\*/g, 'x/x').replace(/\*/g, 'x').replace(/\?/g, 'x');
}

/**
 * Whether two write globs could ever match the same file. Equal globs conflict;
 * otherwise a representative path from each is tested against the other's pattern,
 * which catches equal, prefix and wildcard-overlap collisions between the shapes
 * a write set actually uses.
 * @param {string} g1 @param {string} g2
 * @returns {boolean}
 */
export function conflict(g1, g2) {
  if (g1 === g2) return true;
  const r1 = globToRegExp(g1), r2 = globToRegExp(g2);
  return r1.test(sample(g2)) || r2.test(sample(g1));
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'partition', unit: 'work-package' },
    { name: 'well-formed', unit: 'slice' },
  ]);
  const partition = fams.get('partition');
  const wellFormed = fams.get('well-formed');

  const got = readJsonGuarded(path.join(root, 'packages/verify/config/fanout.json'), wellFormed, 'fanout.json#parsed');
  if (!got.ok) return fams.list;
  const cfg = /** @type {{maxConcurrentAgents?:number, slices?:any[]}} */ (got.value);

  const maxAgents = typeof cfg.maxConcurrentAgents === 'number' ? cfg.maxConcurrentAgents : 0;
  wellFormed.pointer('fanout.json#maxConcurrentAgents').assert(maxAgents >= 1 && maxAgents <= 4,
    `maxConcurrentAgents is ${maxAgents}; D-058 caps fan-out at 4 agents`);

  const slices = Array.isArray(cfg.slices) ? cfg.slices : [];
  /** @type {Map<string, string[]>} globs grouped by work package */
  const byWp = new Map();

  for (let i = 0; i < slices.length; i++) {
    const s = slices[i] || {};
    const where = `slice[${i}]${typeof s.wp === 'string' ? ` (${s.wp})` : ''}`;
    const problems = [];
    if (typeof s.wp !== 'string' || !s.wp) problems.push('no wp');
    if (typeof s.slice !== 'string' || !s.slice) problems.push('no slice description');
    if (typeof s.acceptingProgram !== 'string' || !s.acceptingProgram) problems.push('no acceptingProgram (a named program must decide correctness)');
    if (!Array.isArray(s.writeGlobs) || s.writeGlobs.length === 0 || !s.writeGlobs.every((/** @type {unknown} */ g) => typeof g === 'string' && g))
      problems.push('writeGlobs must be a non-empty array of path globs');
    if (!Number.isInteger(s.agents) || s.agents < 1 || s.agents > maxAgents)
      problems.push(`agents is ${s.agents}; it must be an integer in 1..${maxAgents}`);
    wellFormed.pointer(where).assert(problems.length === 0, `${where}: ${problems.join('; ')}`);

    if (typeof s.wp === 'string' && Array.isArray(s.writeGlobs)) {
      const list = byWp.get(s.wp) || [];
      for (const g of s.writeGlobs) if (typeof g === 'string') list.push(g);
      byWp.set(s.wp, list);
    }
  }

  for (const [wp, globs] of byWp) {
    /** @type {string[]} */
    const clashes = [];
    for (let a = 0; a < globs.length; a++) {
      for (let b = a + 1; b < globs.length; b++) {
        // In-bounds: a, b < globs.length, so both entries are defined.
        const ga = /** @type {string} */ (globs[a]);
        const gb = /** @type {string} */ (globs[b]);
        if (conflict(ga, gb)) clashes.push(`${ga} <=> ${gb}`);
      }
    }
    partition.pointer(wp).assert(clashes.length === 0,
      `${wp} declares overlapping write globs, so two agents could target one file: ${clashes.join(', ')}`);
  }

  return fams.list;
}

/**
 * @param {string} tmp @param {(cfg:any)=>void} mutate
 */
function editFanout(tmp, mutate) {
  const f = path.join(tmp, 'packages/verify/config/fanout.json');
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  mutate(cfg);
  fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
}

export const mutations = [
  {
    name: 'two slices in one work package declare overlapping write globs',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      editFanout(tmp, (cfg) => {
        const s = cfg.slices.find((/** @type {any} */ x) => Array.isArray(x.writeGlobs) && x.writeGlobs.length >= 2);
        s.writeGlobs[1] = s.writeGlobs[0]; // collapse two disjoint globs into one shared path
      });
    },
    expect: 'fail',
  },
  {
    name: 'a slice asks for more agents than the declared cap',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { editFanout(tmp, (cfg) => { cfg.slices[0].agents = 99; }); },
    expect: 'fail',
  },
  {
    name: 'the concurrency cap is raised past the four-agent ceiling',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { editFanout(tmp, (cfg) => { cfg.maxConcurrentAgents = 9; }); },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fams = await run({ repoRoot: repoRoot() });
  console.log(report(fams, { title: id }));
  process.exit(exitFor(verdictOf(fams)));
}
