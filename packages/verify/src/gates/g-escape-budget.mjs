// §2.1.9: the structural-escape budget over the declared scope, as a ratchet that
// only tightens. A form escapes when the intent/container grammar cannot express
// it; the budget bounds how much of the declared corpus subset may escape, and the
// ratchet forbids the cap drifting above the measured rate without being lowered in
// the same commit — so "we allow more escapes now" cannot happen silently.
//
// The measurement is the round-trip harness's own per-form escape data
// (packages/sfs/src/roundtrip.mjs; verify -> sfs is the allowed L3->L1 direction).
// The gate's mutations edit the ratchet DATA, so they are immune to the ESM module
// cache the mutation harness would otherwise serve stale.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, report, runGuarded, verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';
import { roundtrip } from '../../../sfs/src/roundtrip.mjs';

export const id = 'g-escape-budget';
export const describe = 'the structural-escape rate over the declared corpus subset stays under its ratchet cap, which only tightens';
export const inputPaths = [
  'packages/sfs/config/escape-ratchet.json',
  'packages/sfs/config/roundtrip-expected.json',
  'packages/sfs/src',
  'packages/registry/data',
  'packages/sfs/schema/sfs.schema.json',
  'packages/sfs/test/fixtures',
  'packages/sfs/corpus',
  'package.json',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'escape-budget', unit: 'check' }]);
  const fam = fams.get('escape-budget');

  const cfgPath = path.join(root, 'packages/sfs/config/escape-ratchet.json');
  if (!fs.existsSync(cfgPath)) { fam.pointer('escape-ratchet.json').fail('escape-ratchet.json is missing'); return fams.list; }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const cap = cfg.maxStructuralEscapeRate;
  const recorded = cfg.measuredRate;

  let result;
  try {
    result = roundtrip(root, 'packages/sfs/config/roundtrip-expected.json');
  } catch (e) {
    fam.pointer('roundtrip#eval').fail(`the round-trip harness failed: ${/** @type {Error} */ (e).message}`);
    return fams.list;
  }
  const escapes = /** @type {{form:string, structuralEscapes:number}[]} */ (/** @type {any} */ (result.report).escapes || []);
  fam.pointer('scope#nonempty').assert(escapes.length > 0, 'the declared subset is empty; the escape budget would be vacuous');
  const escaped = escapes.filter((e) => e.structuralEscapes > 0).length;
  const actual = escapes.length === 0 ? 0 : escaped / escapes.length;

  // The recorded measurement must match reality — a stale measuredRate is drift.
  fam.pointer('measuredRate#matches-reality').assert(Math.abs(actual - recorded) < 1e-9,
    `escape-ratchet.json records measuredRate ${recorded} but the actual rate is ${actual.toFixed(3)} (${escaped}/${escapes.length}); regenerate or fix`);
  // The cap is respected.
  fam.pointer('rate#under-cap').assert(actual <= cap + 1e-9,
    `structural-escape rate ${actual.toFixed(3)} exceeds the cap ${cap}`);
  // The ratchet: the cap tracks the measured value down; it may not sit more than
  // 0.05 above what is actually measured without being lowered in the same commit.
  fam.pointer('ratchet#down-only').assert(cap - actual <= 0.05 + 1e-9,
    `escape cap ${cap} is more than 0.05 above the measured rate ${actual.toFixed(3)} — lower the cap (the ratchet is down-only, §2.1.9)`);

  return fams.list;
}

export const mutations = [
  {
    name: 'the cap is loosened far above the measured rate (ratchet violation)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/config/escape-ratchet.json');
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      cfg.maxStructuralEscapeRate = 0.9;
      fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the recorded measuredRate no longer matches reality',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/config/escape-ratchet.json');
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      cfg.measuredRate = 0.99;
      cfg.maxStructuralEscapeRate = 1.0;
      fs.writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return verdictOf(fams) === 'pass' ? EXIT.pass : EXIT.fail;
  }));
}
