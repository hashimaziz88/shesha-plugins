// §4.10 pt7 / §4.8 row 16: run dirs live at runs/<runId>/, NOT the pre-rebuild
// .claude/shesha/runs/, and runs/ is gitignored so run artifacts are never committed.
// A run written to the old path is invisible to the toolchain and to .gitignore; a
// runs/ that is not ignored commits ephemeral build output as if it were source.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-run-dir-location';
export const describe = 'no run artifacts under the pre-rebuild .claude/shesha/runs/; runs/ is gitignored';
export const inputPaths = ['.gitignore'];

const OLD = '.claude/shesha/runs';

/** @param {string} dir @returns {string[]} */
function walkFiles(dir) {
  /** @type {string[]} */ const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'old-location', unit: 'assertion' },
    { name: 'gitignore', unit: 'assertion' },
  ]);

  const oldFam = fams.get('old-location');
  const stragglers = walkFiles(path.join(root, OLD));
  oldFam.pointer(`${OLD}#empty`).assert(stragglers.length === 0,
    `${stragglers.length} file(s) at the pre-rebuild run path ${OLD}/: ${stragglers.map((f) => path.relative(root, f)).slice(0, 4).join(', ')}. Run dirs live at runs/<runId>/ (§4.10 pt7).`);

  const giFam = fams.get('gitignore');
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
  giFam.pointer('.gitignore#runs').assert(/^\/runs\/?\s*$/m.test(gi),
    '.gitignore must ignore /runs/ so a run directory is never committed as source');

  return fams.list;
}

export const mutations = [
  {
    name: 'a run artifact is written under the pre-rebuild .claude/shesha/runs/',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const d = path.join(tmp, OLD);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'manifest.json'), '{}\n');
    },
    expect: 'fail',
  },
  {
    name: 'runs/ is dropped from .gitignore, so run output would commit as source',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.gitignore');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\/runs\/?$/.test(l.trim())).join('\n'));
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
