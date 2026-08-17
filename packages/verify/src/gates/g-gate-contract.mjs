// D-007: every gate exports the full contract and declares >= 2 mutations.
//
// This is the gate that makes stub gates illegal. A no-op gate cannot satisfy a
// verdict-flipping mutation, so "register the rule now, implement it later" has
// no representation: it is a scheduled: enforcer in DECISIONS.md instead (D-045).
// A gate that warns where the docs say it fails is the T2 banned behaviour, and
// mutations flip verdicts, not warning counts.

import fs from 'node:fs';
import path from 'node:path';
import { families, readJsonGuarded } from '@shesha/registry/coverage';
import { gateFiles, loadGate } from '../lib/gate-loader.mjs';
import { rel } from '../lib/fsx.mjs';

export const id = 'g-gate-contract';
export const describe = 'every gate exports id/describe/inputPaths/run/mutations with >= 2 verdict-flipping mutations';
// This gate reads every OTHER gate's declared inputs in order to assert they exist,
// so its own input set is the union of theirs. Anything less and a staged copy makes
// every sibling's inputPaths look absent.
export const inputPaths = [
  'packages/verify/src',
  'packages/verify/test',
  'packages/verify/config',
  'packages/registry/src',
  'packages/registry/probes',
  'packages/registry/test',
  'packages/sfs',
  'packages/mcp/src/index.mjs',
  'packages',
  'plugins',
  'CLAUDE.md',
  'DECISIONS.md',
  'BACKLOG.md',
  'package.json',
  'tsconfig.json',
  'package-lock.json',
  'docs/rebuild-brief/CONTROL.md',
  '.githooks',
];

/** The verdicts a mutation may legally expect. A mutation expecting pass is a contract violation. */
const LEGAL_EXPECT = new Set(['fail', 'partial']);

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'exports', unit: 'gate' },
    { name: 'mutations', unit: 'gate' },
    { name: 'input-paths', unit: 'path' },
    { name: 'roster', unit: 'gate' },
  ]);

  const cfgFam = fams.get('roster');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/gate-ratchet.json'), cfgFam, 'gate-ratchet.json');
  const cfg = got.ok
    ? /** @type {{minGates:number, minMutationsPerGate:number, wpZeroGates:string[]}} */ (got.value)
    : { minGates: 0, minMutationsPerGate: 2, wpZeroGates: [] };

  const files = gateFiles(root);
  const exportsFam = fams.get('exports');
  const mutFam = fams.get('mutations');
  const inputFam = fams.get('input-paths');
  /** @type {string[]} */
  const seen = [];

  for (const file of files) {
    const r = rel(root, file);
    const ep = exportsFam.pointer(r);
    /** @type {Awaited<ReturnType<typeof loadGate>>|null} */
    let gate = null;
    try { gate = await loadGate(file); } catch (e) {
      const err = /** @type {Error} */ (e);
      ep.fail(`${r} failed to import: ${err.message}`);
      continue;
    }
    const problems = [];
    if (typeof gate.id !== 'string' || !gate.id) problems.push('missing `export const id`');
    if (typeof gate.describe !== 'string' || !gate.describe) problems.push('missing `export const describe`');
    if (!Array.isArray(gate.inputPaths)) problems.push('missing `export const inputPaths` array');
    if (typeof gate.run !== 'function') problems.push('missing `export async function run(ctx)`');
    if (!Array.isArray(gate.mutations)) problems.push('missing `export const mutations` array');
    const expectedId = path.basename(file, '.mjs');
    if (gate.id && gate.id !== expectedId) problems.push(`id "${gate.id}" does not match filename "${expectedId}"`);
    if (problems.length) { ep.fail(`${r}: ${problems.join('; ')}`); continue; }
    ep.check(6);
    seen.push(gate.id);

    const mp = mutFam.pointer(gate.id);
    const muts = gate.mutations;
    if (muts.length < cfg.minMutationsPerGate) {
      mp.fail(`${gate.id} declares ${muts.length} mutation(s); the contract is >= ${cfg.minMutationsPerGate}. ` +
        'A gate that cannot be shown to fail is worse than no gate.');
    } else {
      const bad = [];
      for (const m of muts) {
        if (!m || typeof m.name !== 'string' || !m.name) bad.push('a mutation has no name');
        else if (typeof m.apply !== 'function') bad.push(`mutation "${m.name}" has no apply()`);
        else if (!LEGAL_EXPECT.has(m.expect)) bad.push(`mutation "${m.name}" expects "${m.expect}"; only fail or partial are legal`);
      }
      if (bad.length) mp.fail(`${gate.id}: ${bad.join('; ')}`);
      else mp.check(muts.length);
    }

    for (const p of gate.inputPaths) {
      const ip = inputFam.pointer(`${gate.id}:${p}`);
      const abs = path.join(root, p);
      ip.assert(fs.existsSync(abs),
        `${gate.id} declares inputPath "${p}" which does not exist; g-gate-ratchet would not count this gate`);
    }
  }

  // The declared WP-0 roster must be exactly what is on disk: a gate that
  // vanishes from the directory must not vanish from the report.
  const rosterPointer = cfgFam.pointer('gate-ratchet.json#wpZeroGates');
  const expected = [...(cfg.wpZeroGates || [])].sort();
  const actual = [...seen].sort();
  rosterPointer.assert(JSON.stringify(expected) === JSON.stringify(actual),
    `the declared gate roster and the gates on disk disagree.\n      declared: ${expected.join(', ')}\n      on disk:  ${actual.join(', ')}`);

  const countPointer = cfgFam.pointer('gate-ratchet.json#minGates');
  countPointer.assert(seen.length >= cfg.minGates,
    `${seen.length} gate(s) present against a floor of ${cfg.minGates}`);

  return fams.list;
}

export const mutations = [
  {
    name: 'a gate ships with fewer than two mutations',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/gates/g-theatre.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, [
        "import { families } from '@shesha/registry/coverage';",
        "export const id = 'g-theatre';",
        "export const describe = 'a gate that cannot fail';",
        'export const inputPaths = [];',
        'export async function run() {',
        "  const f = families([{ name: 'nothing', unit: 'thing' }]);",
        "  f.get('nothing').pointer('a').check();",
        '  return f.list;',
        '}',
        'export const mutations = [];',
        '',
      ].join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a gate declares a mutation that expects pass',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/gates/g-expects-pass.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, [
        "import { families } from '@shesha/registry/coverage';",
        "export const id = 'g-expects-pass';",
        "export const describe = 'declares a mutation that expects pass';",
        'export const inputPaths = [];',
        'export async function run() {',
        "  const f = families([{ name: 'nothing', unit: 'thing' }]);",
        "  f.get('nothing').pointer('a').check();",
        '  return f.list;',
        '}',
        'export const mutations = [',
        "  { name: 'harmless', kind: 'file', apply: async () => {}, expect: 'pass' },",
        "  { name: 'also harmless', kind: 'file', apply: async () => {}, expect: 'pass' },",
        '];',
        '',
      ].join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a gate is deleted without lowering the declared roster',
    kind: 'repo',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.rmSync(path.join(tmp, 'packages/verify/src/gates/g-brief-budget.mjs'), { force: true });
    },
    expect: 'fail',
  },
];
