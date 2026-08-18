// §2.8.4: the registry meets its completeness demands and its ratchet only moves
// the right way. The standing enforcer behind CONTROL §3's validate.mjs acceptance.
//
// One family, `completeness`, driven by packages/registry/src/validate.mjs run as a
// SUBPROCESS: the mutation harness stages-and-mutates the registry data, and a
// subprocess re-reads it fresh instead of serving this process's cached module.
// validate.mjs owns the demands (records=121, authorable⇒version, priority ≥
// value-typed, itemSchemas=5, ratchet directions, no source-parsed without the
// framework); the gate turns its exit code into a coverage verdict with pointers.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { families, report, runGuarded, verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-registry-completeness';
export const describe = 'the registry meets §2.8.4 demands; the ratchet only tightens; provenance never claims source it lacks';
export const inputPaths = [
  'packages/registry/data/0.45.1/components.json',
  'packages/registry/data/0.45.1/_meta.json',
  'packages/registry/config/registry-ratchet.json',
  'packages/registry/src/validate.mjs',
  'packages/registry/tools/gen-registry.mjs',
  'packages/registry/src/coverage.mjs',
  'packages/registry/data/0.45.1/_authored.json',
  'package.json',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'completeness', unit: 'check' }]);
  const fam = fams.get('completeness');
  const p = fam.pointer('validate.mjs');

  const validatePath = path.join(root, 'packages/registry/src/validate.mjs');
  if (!fs.existsSync(validatePath)) { p.fail('validate.mjs is missing'); return fams.list; }

  let out = '';
  let ok = true;
  try {
    out = execFileSync(process.execPath, [validatePath], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ok = false;
    out = `${/** @type {any} */ (e).stdout || ''}${/** @type {any} */ (e).stderr || ''}`;
  }
  // The FAIL lines validate.mjs prints are the diagnosis; surface the first few.
  const failLines = out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 6);
  p.assert(ok, `packages/registry/src/validate.mjs exited non-zero:\n      ${failLines.join('\n      ') || out.trim().slice(0, 300)}`);

  return fams.list;
}

export const mutations = [
  {
    name: 'a priority type is knocked below value-typed (a prop loses its valueType)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/registry/data/0.45.1/components.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const props = j.components.dropdown.props;
      const first = Object.keys(props)[0];
      if (first === undefined) throw new Error('mutation anchor not found: dropdown has no props');
      props[first].valueType = null;
      props[first].valueTypeSource = 'unknown';
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'an authorable record loses its version, breaking authorable⇒version',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/registry/data/0.45.1/components.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.components.datatable.version = null;
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'source-parsed is claimed while the framework is absent',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const meta = path.join(tmp, 'packages/registry/data/0.45.1/_meta.json');
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      m.frameworkPresent = false;
      fs.writeFileSync(meta, `${JSON.stringify(m, null, 2)}\n`);
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
