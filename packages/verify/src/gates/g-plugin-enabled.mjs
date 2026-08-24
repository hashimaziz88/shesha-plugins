// §4.10: enabledPlugins is NOT {}. An empty map means plugins/shesha-developer/agents/*
// is not registered and Task(subagent_type:"sfs-specwriter") resolves to nothing — the
// whole run harness is inert. This gate asserts .claude/settings.json parses and
// enabledPlugins has >=1 key containing "shesha-developer" whose value is true. The tool
// is the authority on the exact key format; WP-11 step 0 rewrites it on restart if wrong.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-plugin-enabled';
export const describe = '.claude/settings.json enabledPlugins has a shesha-developer key set to true';
export const inputPaths = ['.claude/settings.json'];

const SETTINGS = '.claude/settings.json';

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'enabled', unit: 'assertion' }]);
  const fam = fams.get('enabled');

  let settings = /** @type {any} */ (null);
  try { settings = JSON.parse(fs.readFileSync(path.join(root, SETTINGS), 'utf8')); } catch { /* handled below */ }
  if (!settings) {
    fam.pointer(`${SETTINGS}#parse`).fail(`${SETTINGS} is missing or unparseable`);
    return fams.list;
  }
  const enabled = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' ? settings.enabledPlugins : {};
  const hit = Object.entries(enabled).find(([k, v]) => k.includes('shesha-developer') && v === true);
  fam.pointer(`${SETTINGS}#enabledPlugins`).assert(!!hit,
    'enabledPlugins must have a key containing "shesha-developer" set to true; an empty map leaves the agents unregistered (Task(subagent_type) resolves to nothing)');

  return fams.list;
}

export const mutations = [
  {
    name: 'enabledPlugins is emptied, unregistering the agents',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, SETTINGS);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.enabledPlugins = {};
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the shesha-developer key is present but false',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, SETTINGS);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.enabledPlugins = { 'shesha-developer@shesha-plugins': false };
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
