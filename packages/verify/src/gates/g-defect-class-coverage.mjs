// §3.2.0: defect-classes.json makes the ">= 90% of defect classes caught" claim
// falsifiable. Each class names the tier CHECK that catches it; a class is COVERED
// when that check has a verdict-flipping mutation (proven by tier-mutations.test).
// Scope-A's denominator is the tier t1/t2 classes; t3-only classes (WP-3b) are
// excluded and printed separately. Fails below ceil(0.9 * scopeA).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, readJsonGuarded, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';
import { parseCoverage } from './g-mutation-coverage.mjs';

export const id = 'g-defect-class-coverage';
export const describe = 'every scope-A defect class is caught by a covered tier check; coverage stays at or above ceil(0.9*N)';
export const inputPaths = [
  'packages/verify/config/defect-classes.json',
  'packages/verify/src/tiers/t1-schema.mjs',
  'packages/verify/src/tiers/t2-registry.mjs',
  'package.json',
];

/**
 * The union of check ids covered by a mutation across both tiers.
 * @param {string} root
 * @returns {Set<string>}
 */
function coveredChecks(root) {
  /** @type {Set<string>} */
  const covered = new Set();
  for (const f of ['packages/verify/src/tiers/t1-schema.mjs', 'packages/verify/src/tiers/t2-registry.mjs']) {
    const text = readText(path.join(root, f));
    if (text === null) continue;
    for (const c of parseCoverage(text).covered) covered.add(c);
  }
  return covered;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'defect-classes', unit: 'class' }]);
  const fam = fams.get('defect-classes');

  const got = readJsonGuarded(path.join(root, 'packages/verify/config/defect-classes.json'), fam, 'defect-classes.json');
  if (!got.ok) return fams.list;
  const classes = /** @type {{id:string, tier:string, check:string|null}[]} */ ((/** @type {any} */ (got.value)).classes || []);
  if (classes.length === 0) { fam.pointer('defect-classes#empty').fail('defect-classes.json lists no classes'); return fams.list; }

  const covered = coveredChecks(root);
  let scopeA = 0;
  let scopeACovered = 0;
  for (const c of classes) {
    const p = fam.pointer(`${c.id} -> ${c.check || '(t3)'}`);
    if (c.tier !== 't1' && c.tier !== 't2') { p.na(`${c.id} is ${c.tier}-only (excluded from Scope A's denominator)`); continue; }
    scopeA += 1;
    const ok = c.check !== null && covered.has(c.check);
    if (ok) scopeACovered += 1;
    p.assert(ok, `${c.id} names check ${c.check}, which has no covering mutation — the class is claimed caught but nothing proves it`);
  }
  const floor = Math.ceil(0.9 * scopeA);
  fam.pointer('defect-classes#threshold').assert(scopeACovered >= floor,
    `${scopeACovered}/${scopeA} scope-A defect classes covered, below the ceil(0.9*${scopeA}) = ${floor} floor`);
  return fams.list;
}

export const mutations = [
  {
    name: 'a defect class names a check with no covering mutation',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/defect-classes.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.classes.push({ id: 'DC-99', tier: 't2', check: 'T2.99', source: 'planted', describe: 'a class no check catches' });
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'an existing class is repointed to an uncovered check',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/defect-classes.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const c = j.classes.find((/** @type {any} */ x) => x.tier === 't2');
      if (c) c.check = 'T2.does-not-exist';
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
