// cost-delta (§5.2, D-050). Two recomputable byte ratios, each above a floor.
//
// The emitted ratio is measured live: compile the clean inline-editable fixture and
// divide the baseline production markup by the SFS bytes the author wrote. The
// preload ratio divides the strategy's measured preload mass by the one skill this
// session ships. Neither number is a step count, a token count or a tool-call
// ratio — those are unmeasurable from inside this session and are BL-001, so `prove`
// prints `token cost: unmeasured in this session` rather than a fabricated figure
// (§1.7 T15).
//
//   node packages/sfs/tools/cost-delta.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '../src/compile/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** The one skill this session ships; its bytes are the preload numerator's denominator. */
const SHIPPED_SKILL = 'plugins/shesha-developer/skills/shesha-spec';

/**
 * Sum the bytes of every SKILL.md under a directory tree.
 * @param {string} dir
 * @returns {number}
 */
function skillBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += skillBytes(abs);
    else if (entry.name === 'SKILL.md') total += fs.statSync(abs).size;
  }
  return total;
}

/**
 * @returns {{emitted:{baseline:number, sfs:number, ratio:number, floor:number, ok:boolean},
 *            preload:{baseline:number, shipped:number, ratio:number, floor:number, ok:boolean, measurable:boolean, deferredTo:string|null},
 *            gate:boolean}}
 */
export function costDelta() {
  const baselineCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/sfs/config/cost-baseline.json'), 'utf8'));
  const emittedBaseline = baselineCfg.emittedBytes.value;
  const preloadBaseline = baselineCfg.preloadBytes.value;

  // Emitted: the SFS the author writes vs the markup a production form of the same
  // shape carries. Measured live from the clean fixture.
  const fixture = path.join(ROOT, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json');
  const sfsText = fs.readFileSync(fixture, 'utf8');
  const sfsBytes = Buffer.byteLength(JSON.stringify(JSON.parse(sfsText)), 'utf8');
  compile(sfsText); // proves the fixture still compiles; the ratio is baseline/authored
  const emittedRatio = emittedBaseline / sfsBytes;

  // Preload: the strategy's measured preload mass vs the one skill shipped. When the
  // skill does not exist yet (before WP-7a) the ratio is not measurable, and an
  // unmeasurable ratio is reported as such, never as a pass.
  const shipped = skillBytes(path.join(ROOT, SHIPPED_SKILL));
  const preloadMeasurable = shipped > 0;
  const preloadRatio = preloadMeasurable ? preloadBaseline / shipped : 0;

  const emittedOk = emittedRatio >= baselineCfg.emittedBytes.floor;
  const preloadOk = preloadMeasurable && preloadRatio >= baselineCfg.preloadBytes.floor;
  // The preload arm is UNINSPECTABLE until WP-7a ships the skill — an explicit
  // deferral, never a silent pass. The gate passes when every arm that can be
  // measured is above its floor; a measurable-but-below-floor preload still fails.
  const preloadDeferred = !preloadMeasurable;
  return {
    emitted: { baseline: emittedBaseline, sfs: sfsBytes, ratio: emittedRatio, floor: baselineCfg.emittedBytes.floor, ok: emittedOk },
    preload: { baseline: preloadBaseline, shipped, ratio: preloadRatio, floor: baselineCfg.preloadBytes.floor, ok: preloadOk, measurable: preloadMeasurable, deferredTo: preloadDeferred ? 'WP-7a' : null },
    gate: emittedOk && (preloadOk || preloadDeferred),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d = costDelta();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(d, null, 2));
  } else {
    const p = d.preload.measurable
      ? `preload ${d.preload.baseline} -> ${d.preload.shipped} B (${d.preload.ratio.toFixed(1)}x, floor ${d.preload.floor})`
      : `preload deferred:WP-7a (skill not yet shipped, uninspectable — never a pass)`;
    console.log(`emitted ${d.emitted.baseline} -> ${d.emitted.sfs} B (${d.emitted.ratio.toFixed(1)}x, floor ${d.emitted.floor}) · ${p} · ${d.gate ? 'GATE PASS' : 'GATE FAIL'}`);
  }
  // The gate passes when every MEASURABLE arm is above its floor; the preload arm
  // is uninspectable until WP-7a and is reported as deferred, never as a pass. The
  // full both-arms gate is g-cost-delta in WP-10.
  process.exit(d.gate ? 0 : 1);
}
