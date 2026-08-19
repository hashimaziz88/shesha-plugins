// O7, D-069: the hooks exist, are executable, and are wired to the right file.
//
// commit-msg is the only hook git passes the message file to, so the format gate
// lives there. A hook reading .git/COMMIT_EDITMSG at pre-commit time would validate
// the PREVIOUS message and pass, so mentioning that file under .githooks/ is itself
// a failure.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, git, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-githook-contract';
export const describe = 'both hooks present and shell-safe, commit-msg forwards $1, no COMMIT_EDITMSG reference, LF pinned';
export const inputPaths = ['.githooks', '.gitattributes'];

const HOOKS = ['.githooks/pre-commit', '.githooks/commit-msg'];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'hook-files', unit: 'hook' },
    { name: 'message-file-wiring', unit: 'assertion' },
    { name: 'editmsg-references', unit: 'file' },
    { name: 'line-endings', unit: 'assertion' },
    { name: 'hooks-path', unit: 'assertion', required: false },
  ]);

  const fileFam = fams.get('hook-files');
  for (const h of HOOKS) {
    const p = fileFam.pointer(h);
    const text = readText(path.join(root, h));
    if (text === null) { p.fail(`${h} does not exist; the hook enforces nothing`); continue; }
    const shebang = /^#!\/usr\/bin\/env bash/.test(text);
    const strict = text.includes('set -euo pipefail');
    p.assert(shebang && strict,
      `${h} needs a bash shebang and "set -euo pipefail", or a failing step is skipped silently`);
  }

  // commit-msg must forward git's argument, or it validates nothing.
  const cm = readText(path.join(root, '.githooks/commit-msg')) || '';
  fams.get('message-file-wiring').pointer('commit-msg#forwards-$1').assert(
    cm.includes('--message-file "$1"'),
    'commit-msg must invoke the format gate with --message-file "$1"; git passes the message path as $1 and nothing else');

  const editFam = fams.get('editmsg-references');
  for (const h of HOOKS) {
    const p = editFam.pointer(h);
    const text = readText(path.join(root, h)) || '';
    p.assert(!text.includes('COMMIT_EDITMSG'),
      `${h} mentions COMMIT_EDITMSG, which at pre-commit time still holds the PREVIOUS message`);
  }

  // A CRLF hook does not execute at all under a bash shebang.
  const attrs = readText(path.join(root, '.gitattributes')) || '';
  fams.get('line-endings').pointer('.gitattributes#githooks-eol-lf').assert(
    /\.githooks\/\*\*\s+text\s+eol=lf/.test(attrs),
    '.gitattributes must pin .githooks/** to eol=lf; core.autocrlf=true otherwise hands a fresh clone CRLF hooks that cannot run');

  // Repository wiring is only answerable in a real working tree.
  const configured = (git(['config', 'core.hooksPath'], root) || '').trim();
  if (configured !== '') {
    fams.get('hooks-path').pointer('core.hooksPath').assert(configured === '.githooks',
      `core.hooksPath is "${configured}", not ".githooks"; the hooks exist but are not installed`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'commit-msg stops forwarding the message file',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.githooks/commit-msg');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('--message-file "$1"', ''));
    },
    expect: 'fail',
  },
  {
    name: 'a hook reaches for COMMIT_EDITMSG',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.appendFileSync(path.join(tmp, '.githooks/pre-commit'), '\nhead -1 .git/COMMIT_EDITMSG\n');
    },
    expect: 'fail',
  },
  {
    name: 'the LF pin is dropped from .gitattributes',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.gitattributes');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('.githooks')).join('\n'));
    },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
