// D-107, WP-3b.3b: every placement-contract fixture is well-formed and points at a
// real screen. A contract that fails assertions.schema.json, names a predicate the
// engine does not implement, targets a screen with no clean fixture, or exceeds its
// byte cap is caught here — so g-verdict-integrity only ever recomputes contracts that
// are structurally sound, and a fixture cannot smuggle in an unevaluatable row.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot, normalisedByteSize } from '../lib/fsx.mjs';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);

export const id = 'g-fixture-manifest';
export const describe = 'every placement-contract fixture is schema-valid, names known predicates, targets a real screen, and is within its byte cap';
export const inputPaths = [
  'packages/sfs/test/fixtures/contracts',
  'packages/sfs/test/fixtures/clean',
  'packages/verify/schema/assertions.schema.json',
  'packages/verify/config/predicates.json',
];

const CONTRACTS = 'packages/sfs/test/fixtures/contracts';
const CLEAN = 'packages/sfs/test/fixtures/clean';
const SCHEMA = 'packages/verify/schema/assertions.schema.json';
const PREDICATES = 'packages/verify/config/predicates.json';
const BYTES_CAP = 32768;

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'manifest', unit: 'contract-file' }]);
  const fam = fams.get('manifest');

  const schemaGot = readJsonGuarded(path.join(root, SCHEMA), fam, SCHEMA);
  const predGot = readJsonGuarded(path.join(root, PREDICATES), fam, PREDICATES);
  if (!schemaGot.ok || !predGot.ok) return fams.list;
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schemaGot.value);
  const known = new Set(((/** @type {any} */ (predGot.value).predicates) || []).map((/** @type {any} */ p) => p.name));

  const dir = path.join(root, CONTRACTS);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.contract.json')).sort() : [];
  if (files.length === 0) {
    fam.pointer(`${CONTRACTS}#empty`).fail(`no *.contract.json under ${CONTRACTS}; a fixture-manifest gate over nothing is not a pass`);
    return fams.list;
  }

  for (const f of files) {
    const rel = `${CONTRACTS}/${f}`;
    const p = fam.pointer(rel);
    const raw = readText(path.join(dir, f));
    /** @type {any} */
    let contract;
    try { contract = JSON.parse(raw || ''); } catch (e) { p.fail(`${rel} is not valid JSON: ${/** @type {Error} */ (e).message}`); continue; }

    const problems = [];
    const acceptance = Array.isArray(contract.acceptance) ? contract.acceptance : null;
    if (acceptance === null) problems.push('has no acceptance[] array');
    else if (!validate(acceptance)) problems.push(`acceptance fails assertions.schema.json: ${(validate.errors || []).slice(0, 2).map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
    else {
      const unknown = acceptance.map((/** @type {any} */ r) => r.predicate).filter((/** @type {any} */ n) => !known.has(n));
      if (unknown.length) problems.push(`names predicate(s) not in the frozen registry: ${[...new Set(unknown)].join(', ')}`);
    }

    const screen = f.replace(/\.contract\.json$/, '');
    if (!fs.existsSync(path.join(root, CLEAN, `${screen}.sfs.json`))) problems.push(`targets screen "${screen}" but ${CLEAN}/${screen}.sfs.json does not exist`);

    const bytes = normalisedByteSize(path.join(dir, f));
    if (bytes > BYTES_CAP) problems.push(`is ${bytes} B, over the ${BYTES_CAP} B cap`);

    p.assert(problems.length === 0, `${rel}: ${problems.join('; ')}`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a contract names a predicate the engine does not implement',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, CONTRACTS, 'employees-table.contract.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.acceptance.push({ id: 'X', tier: 't3', predicate: 'notARealPredicate', args: {}, expect: { eq: 1 } });
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a contract targets a screen with no clean fixture',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, CONTRACTS, 'ghost-screen.contract.json');
      fs.writeFileSync(f, `${JSON.stringify({ screen: 'ghost-screen', acceptance: [{ id: 'G', tier: 't3', predicate: 'count', args: { type: 'datatable' }, expect: { eq: 1 } }] }, null, 2)}\n`);
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
