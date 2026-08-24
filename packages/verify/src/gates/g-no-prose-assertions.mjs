// D-105, WP-3b.2: placement is executable predicates, not prose a model judges (D-014).
//
// Two ways that rule rots, both caught here. First, a ```assertions fenced block in a
// skill doc smuggles English "assertions" back into the prompt where an agent, not a
// program, decides if they hold — the exact thing D-014 deletes; this gate fails on any
// such block under plugins/**. Second, the predicate table drifts: the engine, the
// frozen registry config, and the contract schema's enum must name the identical 18
// predicates, or a contract could pass the schema and hit a predicate the engine does
// not implement (or vice versa). The gate reconciles all three.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot, listFiles, rel } from '../lib/fsx.mjs';
import { PREDICATE_NAMES } from '../predicates/index.mjs';

export const id = 'g-no-prose-assertions';
export const describe = 'no ```assertions prose block under plugins/**, and the predicate registry (config, engine, schema) agree on the frozen 18';
export const inputPaths = [
  'packages/verify/config/predicates.json',
  'packages/verify/schema/assertions.schema.json',
  'packages/verify/src/predicates',
  'plugins',
];

const CONFIG = 'packages/verify/config/predicates.json';
const SCHEMA = 'packages/verify/schema/assertions.schema.json';
const ASSERTIONS_FENCE = /^```assertions\b/m;

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'registry', unit: 'predicate' },
    { name: 'prose', unit: 'md-file' },
  ]);
  const regFam = fams.get('registry');
  const proseFam = fams.get('prose');

  // ---- the frozen registry: config == engine == schema enum -----------------
  const cfgGot = readJsonGuarded(path.join(root, CONFIG), regFam, CONFIG);
  const schGot = readJsonGuarded(path.join(root, SCHEMA), regFam, SCHEMA);
  if (cfgGot.ok && schGot.ok) {
    const configNames = ((/** @type {any} */ (cfgGot.value).predicates) || []).map((/** @type {any} */ p) => p.name);
    const configSet = new Set(configNames);
    const engineSet = new Set(PREDICATE_NAMES);
    // The schema enum lives at $defs.row.properties.predicate.enum.
    const schemaEnum = (((/** @type {any} */ (schGot.value).$defs || {}).row || {}).properties || {}).predicate || {};
    const schemaSet = new Set(schemaEnum.enum || []);

    for (const name of configNames) {
      const p = regFam.pointer(`registry:${name}`);
      const problems = [];
      if (!engineSet.has(name)) problems.push('not implemented in predicates/index.mjs PREDICATES');
      if (!schemaSet.has(name)) problems.push('not in assertions.schema.json predicate enum');
      p.assert(problems.length === 0, `predicate "${name}" ${problems.join(' and ')}`);
    }
    // No name may exist in the engine or the schema without a config row (the config
    // is the single source), and the count is frozen at 18.
    const extraEngine = [...engineSet].filter((n) => !configSet.has(n));
    const extraSchema = [...schemaSet].filter((n) => !configSet.has(n));
    regFam.pointer('registry#no-extras').assert(extraEngine.length === 0 && extraSchema.length === 0,
      `predicate(s) exist outside the frozen config: engine ${extraEngine.join(', ') || 'none'}; schema ${extraSchema.join(', ') || 'none'}`);
    regFam.pointer('registry#count').assert(configSet.size === 18,
      `the frozen registry declares ${configSet.size} predicates, expected 18`);
  }

  // ---- no ```assertions prose under plugins/** -------------------------------
  const pluginsDir = path.join(root, 'plugins');
  const mds = fs.existsSync(pluginsDir) ? listFiles(pluginsDir, { ext: ['.md'] }) : [];
  if (mds.length === 0) {
    proseFam.pointer('plugins#empty').fail('no .md under plugins/**; a prose-assertions gate over nothing is not a pass');
  } else {
    for (const f of mds) {
      const r = rel(root, f);
      const p = proseFam.pointer(r);
      const text = readText(f);
      if (text === null) { p.fail(`${r} is unreadable`); continue; }
      p.assert(!ASSERTIONS_FENCE.test(text),
        `${r} carries a \`\`\`assertions prose block; placement is executable predicates (D-014), not English a model judges`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a skill doc smuggles a ```assertions prose block',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-spec/SKILL.md');
      fs.appendFileSync(f, '\n```assertions\nbody is a 2-column split; the rail is on the right\n```\n');
    },
    expect: 'fail',
  },
  {
    name: 'the predicate registry loses a name the engine still implements',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, CONFIG);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.predicates = j.predicates.filter((/** @type {any} */ p) => p.name !== 'ratio');
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
