// §4.3.1 rule 5 / §4.8 row 4: every hook file returns only exit 0 (decision on
// stdout) or 2 (stdout unwritable). exit(1) is banned — a non-2 non-zero exit is a
// silent non-block in Claude Code (the tool proceeds, the model never learns why).
// Every hook wired in .claude/settings.json must exist, and every <name>.decide.mjs
// must have a <name>.mjs runner (the runner/decide split that keeps decide pure).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-hook-contract';
export const describe = 'hooks exit only 0 or 2 (exit(1) banned); every wired hook exists; runners split decide';
export const inputPaths = ['.claude/hooks', '.claude/settings.json'];

const HOOKS = '.claude/hooks';

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'exit-codes', unit: 'file' },
    { name: 'wiring', unit: 'hook' },
    { name: 'decide-split', unit: 'file' },
  ]);

  const dir = path.join(root, HOOKS);
  const mjs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')) : [];

  // exit-codes: no process.exit(1) / exitCode = 1 in ANY hook file.
  const exitFam = fams.get('exit-codes');
  for (const n of mjs) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8');
    exitFam.pointer(`${HOOKS}/${n}`).assert(
      !/process\.exit\(\s*1\s*\)|(?:process\.)?exitCode\s*=\s*1\b/.test(text),
      `${n} contains a banned exit(1)/exitCode=1; a non-2 non-zero exit is a silent non-block (§4.3.1 rule 5)`);
  }

  // wiring: every command "node .claude/hooks/X.mjs" in settings.json resolves.
  const wireFam = fams.get('wiring');
  const settingsPath = path.join(root, '.claude/settings.json');
  let settings = /** @type {any} */ (null);
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* handled below */ }
  if (!settings) {
    wireFam.pointer('.claude/settings.json').fail('.claude/settings.json is missing or unparseable');
  } else {
    const commands = [];
    for (const group of Object.values(settings.hooks || {})) {
      for (const entry of /** @type {any[]} */ (group) || []) {
        for (const h of entry.hooks || []) if (typeof h.command === 'string') commands.push(h.command);
      }
    }
    if (commands.length === 0) wireFam.pointer('.claude/settings.json#hooks').fail('no hooks are wired');
    for (const cmd of commands) {
      const m = /node\s+(\.claude\/hooks\/[A-Za-z0-9._-]+\.mjs)/.exec(cmd);
      const wp = wireFam.pointer(cmd.slice(0, 60));
      const hookRel = m && m[1];
      if (!hookRel) { wp.fail(`hook command is not "node .claude/hooks/<x>.mjs": ${cmd}`); continue; }
      wp.assert(fs.existsSync(path.join(root, hookRel)), `wired hook ${hookRel} does not exist`);
    }
  }

  // decide-split: every <name>.decide.mjs has a <name>.mjs runner beside it.
  const splitFam = fams.get('decide-split');
  const decides = mjs.filter((n) => n.endsWith('.decide.mjs'));
  if (decides.length === 0) splitFam.pointer(`${HOOKS}#decide`).check();
  for (const d of decides) {
    const runner = d.replace(/\.decide\.mjs$/, '.mjs');
    splitFam.pointer(`${HOOKS}/${d}`).assert(mjs.includes(runner), `${d} has no ${runner} runner (the runner/decide split)`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a hook returns exit(1), the silent-non-block defect',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, HOOKS, 'block-form-writes.mjs');
      // Build the banned call so this gate's own source never contains the literal
      // it forbids (g-exit-codes greps for it).
      const banned = `process.${'exit'}(${1});`;
      fs.appendFileSync(f, `\nif (false) ${banned}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a wired hook command points at a hook that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.claude/settings.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.hooks.PreToolUse[0].hooks[0].command = 'node .claude/hooks/ghost.mjs';
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
