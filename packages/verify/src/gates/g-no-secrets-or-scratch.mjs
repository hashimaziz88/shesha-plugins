// O7: the ignore rules that matter are present, and no scratch file has been left
// inside the toolchain.
//
// The rules are asserted against .gitignore's CONTENT rather than against git's
// index, so the gate means the same thing in a staged copy as in a working tree.
// The tracked-but-ignored question is git's, and is asked only where git can answer.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, listFiles, rel, git, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-no-secrets-or-scratch';
export const describe = 'required ignore rules present, no scratch or backup files under the toolchain, no tracked ignored path';
export const inputPaths = ['.gitignore', 'packages', 'plugins'];

/** Ignoring these is what keeps a credential or a run artifact out of a commit. */
const REQUIRED_IGNORES = [
  '.claude/settings.local.json',
  'node_modules/',
  '/.build/',
  '/runs/',
  '*.tmp',
];

/**
 * Names that mean "left behind", not "shipped". Deliberately narrow: `debug` and
 * `temp` are ordinary words in a documentation filename, and a rule that fires on
 * `references/debug.md` is a rule that gets waived wholesale.
 */
const SCRATCH = /(^|\/)(scratch|diag|untitled)[^/]*\.(mjs|js|cjs|json)$|\.(bak|orig|rej|swp|tmp)$/i;

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'ignore-rules', unit: 'rule' },
    { name: 'scratch-files', unit: 'file' },
    { name: 'tracked-ignored', unit: 'path', required: false },
  ]);

  const ruleFam = fams.get('ignore-rules');
  const ignore = readText(path.join(root, '.gitignore'));
  if (ignore === null) {
    ruleFam.pointer('.gitignore').fail('.gitignore does not exist, so every rule this gate enforces is absent');
  } else {
    const lines = ignore.split('\n').map((l) => l.trim());
    for (const rule of REQUIRED_IGNORES) {
      ruleFam.pointer(rule).assert(lines.includes(rule),
        `.gitignore is missing "${rule}"; without it that path can be committed by accident`);
    }
  }

  const scratchFam = fams.get('scratch-files');
  for (const dir of ['packages', 'plugins']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    // The family walks even when the tree is clean, or it reports pass over nothing.
    scratchFam.pointer(`${dir}#scanned`).check();
    for (const f of listFiles(abs)) {
      const r = rel(root, f);
      if (r.includes('/test/fixtures/')) continue; // fixtures may legitimately be named oddly
      if (!SCRATCH.test(r)) continue;
      scratchFam.pointer(r).fail(`${r} looks like a scratch or backup file left inside the toolchain`);
    }
  }

  const out = git(['ls-files', '-i', '-c', '--exclude-standard'], root);
  if (out !== null) {
    const offenders = out.split('\n').map((l) => l.trim()).filter(Boolean);
    fams.get('tracked-ignored').pointer('git ls-files -i -c').assert(offenders.length === 0,
      `${offenders.length} tracked path(s) match an ignore rule: ${offenders.slice(0, 5).join(', ')}`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the settings.local.json ignore rule is removed',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.gitignore');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n')
        .filter((l) => l.trim() !== '.claude/settings.local.json').join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a scratch module is left inside the toolchain',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/scratch-probe.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'export const leftBehind = true;\n');
    },
    expect: 'fail',
  },
  {
    name: 'a backup copy is left beside a gate',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, 'packages/verify/src/gates/g-decisions.mjs.orig'), 'stale copy\n');
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
