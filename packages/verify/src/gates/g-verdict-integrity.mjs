// D-107, WP-3b.3b: a placement contract's verdict is recomputed, never asserted.
//
// The T3 tier reports each contract predicate's pass/fail. This gate proves those
// results are (a) real — every committed contract is actually satisfied by its
// freshly-compiled screen, so a contract that drifted from its form is caught, not
// trusted — and (b) deterministic — evaluating the same contract twice gives the same
// answer. No agent authors or alters a predicate result; the evaluator is the one in
// packages/verify/src/predicates, run here independently and compared.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';
import { evaluate } from '../predicates/index.mjs';

export const id = 'g-verdict-integrity';
export const describe = 'every committed placement contract is satisfied by its freshly-compiled screen, and evaluation is deterministic';
export const inputPaths = [
  'packages/sfs/test/fixtures/contracts',
  'packages/sfs/test/fixtures/clean',
  'packages/sfs/src',
  'packages/verify/src/predicates',
];

const CONTRACTS = 'packages/sfs/test/fixtures/contracts';
const CLEAN = 'packages/sfs/test/fixtures/clean';

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'contracts', unit: 'contract' },
    { name: 'determinism', unit: 'contract' },
  ]);
  const cFam = fams.get('contracts');
  const dFam = fams.get('determinism');

  const dir = path.join(root, CONTRACTS);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.contract.json')).sort() : [];
  if (files.length === 0) {
    cFam.pointer(`${CONTRACTS}#empty`).fail(`no *.contract.json under ${CONTRACTS}; a verdict-integrity gate over nothing is not a pass`);
    return fams.list;
  }

  const { compile } = await import('../../../sfs/src/compile/index.mjs');

  for (const f of files) {
    const rel = `${CONTRACTS}/${f}`;
    const screen = f.replace(/\.contract\.json$/, '');
    const cp = cFam.pointer(rel);
    const raw = readText(path.join(dir, f));
    /** @type {any} */
    let contract;
    try { contract = JSON.parse(raw || ''); } catch (e) { cp.fail(`${rel} is not valid JSON: ${/** @type {Error} */ (e).message}`); continue; }
    const src = readText(path.join(root, CLEAN, `${screen}.sfs.json`));
    if (src === null) { cp.fail(`${rel} names screen "${screen}" but ${CLEAN}/${screen}.sfs.json does not exist`); continue; }

    /** @type {any} */
    let meta;
    try { meta = compile(src, { source: rel }).meta; } catch (e) { cp.fail(`${rel}: screen ${screen} does not compile: ${/** @type {Error} */ (e).message.split('\n')[0]}`); continue; }

    const rows = Array.isArray(contract.acceptance) ? contract.acceptance : [];
    const results = rows.map((/** @type {any} */ r) => ({ id: r.id, res: evaluate(r, meta) }));
    const failed = results.filter((/** @type {any} */ x) => !x.res.pass);
    cp.assert(failed.length === 0,
      `${rel}: ${failed.length} contract row(s) are NOT satisfied by the compiled ${screen} — the contract has drifted: ${failed.map((/** @type {any} */ x) => `${x.id} (${x.res.reason})`).join('; ')}`);

    // Determinism: a second evaluation must agree with the first, row for row.
    const second = rows.map((/** @type {any} */ r) => evaluate(r, meta).pass);
    const drift = results.filter((/** @type {any} */ x, /** @type {number} */ i) => x.res.pass !== second[i]);
    dFam.pointer(`${rel}#deterministic`).assert(drift.length === 0,
      `${rel}: evaluation is non-deterministic on ${drift.length} row(s)`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a committed contract row drifts from its screen',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, CONTRACTS, 'employees-table.contract.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const row = j.acceptance.find((/** @type {any} */ r) => r.id === 'P5');
      if (row) row.expect = { eq: 'body' }; // pageShell region is "page", not "body"
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a contract declares a column set that does not match its screen',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, CONTRACTS, 'employees-table.contract.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const row = j.acceptance.find((/** @type {any} */ r) => r.id === 'P1');
      if (row) row.expect = { eq: 99 }; // cellCount(toolbar) is 2, not 99
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
