// D-050: the two recomputable cost ratios both stay above their floors.
//
// cost-delta.mjs already computes emittedBytes (floor 10x) and preloadBytes
// (floor 5x) live, and prints the honest `deferred:WP-7a` line while the skill is
// absent. That tool's own exit code passes as long as every MEASURABLE arm clears
// its floor. This gate is the full both-arms gate the tool's closing comment
// promised for WP-10: now that WP-7a shipped the skill, the preload arm is
// measurable, so an unmeasurable preload is itself a failure here — never a pass.
//
// The measurement reads from ctx.repoRoot rather than the tool's own repo, so the
// mutation harness — which stages only this gate's declared inputs into a throwaway
// tree — sees a mutated baseline and the verdict flips with it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';
import { costDelta } from '../../../sfs/tools/cost-delta.mjs';

export const id = 'g-cost-delta';
export const describe = 'both recomputable cost ratios clear their floors (D-050): emitted >= 10x, preload >= 5x, neither unmeasurable';
export const inputPaths = [
  'packages/sfs/config/cost-baseline.json',
  'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json',
  'plugins/shesha-developer/skills/shesha-spec',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'cost', unit: 'ratio' }]);
  const cost = fams.get('cost');

  let d;
  try {
    d = costDelta(root);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    cost.pointer('cost-delta').fail(`cost-delta could not be recomputed: ${err.message}`);
    return fams.list;
  }

  // The preload arm must be MEASURABLE now (the skill shipped in WP-7a). An
  // unmeasurable preload is an honest failure of this gate, never a silent pass.
  cost.pointer('preload-measurable').assert(d.preload.measurable,
    'the preload ratio is unmeasurable (the shipped skill is absent); D-050 requires both arms measured, not deferred');
  cost.pointer('emitted').assert(d.emitted.ok,
    `emitted ratio ${d.emitted.ratio.toFixed(1)}x is below its floor of ${d.emitted.floor}x`);
  cost.pointer('preload').assert(d.preload.ok,
    `preload ratio ${d.preload.ratio.toFixed(1)}x is below its floor of ${d.preload.floor}x`);
  cost.pointer('gate').assert(d.gate,
    `the cost gate is false (emitted.ok=${d.emitted.ok}, preload.ok=${d.preload.ok})`);

  return fams.list;
}

/**
 * Rewrite the staged cost baseline in place.
 * @param {string} tmp @param {(cfg:any)=>void} mutate
 */
function editBaseline(tmp, mutate) {
  const f = path.join(tmp, 'packages/sfs/config/cost-baseline.json');
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  mutate(cfg);
  fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
}

export const mutations = [
  {
    name: 'the emitted-bytes floor is raised above the measured ratio',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { editBaseline(tmp, (cfg) => { cfg.emittedBytes.floor = 999999; }); },
    expect: 'fail',
  },
  {
    name: 'the preload-bytes floor is raised above the measured ratio',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { editBaseline(tmp, (cfg) => { cfg.preloadBytes.floor = 999999; }); },
    expect: 'fail',
  },
  {
    name: 'the emitted baseline is deflated so the ratio collapses below its floor',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { editBaseline(tmp, (cfg) => { cfg.emittedBytes.value = 1; }); },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fams = await run({ repoRoot: repoRoot() });
  console.log(report(fams, { title: id }));
  process.exit(exitFor(verdictOf(fams)));
}
