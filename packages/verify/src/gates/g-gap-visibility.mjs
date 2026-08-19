// D-027: a compiler gap is a visible failing fixture, never a silent skip.
//
// `test.todo(` (and it/describe.todo) is legal ONLY under
// packages/sfs/test/fixtures/gaps/ or in a *.gap.test.mjs file, and every such
// todo must carry a GAP-0NN id that is present in BACKLOG.md. A todo anywhere else
// is a green test that quietly asserts nothing — exactly the disappeared-coverage
// the rebuild exists to make impossible. This gate walks every test module and
// holds each to that rule, so the denominator is every test file, not just the
// ones that happen to contain a todo today.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor } from '@shesha/registry/coverage';
import { repoRoot, readText, listFiles, rel } from '../lib/fsx.mjs';

export const id = 'g-gap-visibility';
export const describe = 'every .todo() is fenced to a gap fixture (packages/sfs/test/fixtures/gaps/ or *.gap.test.mjs) and carries a BACKLOG GAP-0NN id (D-027)';
export const inputPaths = [
  'packages/verify/test',
  'packages/sfs/test',
  'packages/registry/test',
  'BACKLOG.md',
];

/** The directories whose test modules this gate walks. */
const TEST_DIRS = ['packages/verify/test', 'packages/sfs/test', 'packages/registry/test'];

/** A .todo() call, assembled from parts so this gate's own source never self-matches a scan. */
const TODO = new RegExp(`\\b(?:test|it|describe)\\.${'to' + 'do'}\\s*\\(`);
const GAP_ID = /GAP-0\d\d/g;

/**
 * Strip comments so a todo named in a comment is not mistaken for a todo call.
 * @param {string} t @returns {string}
 */
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'todo-fenced', unit: 'file' }]);
  const fam = fams.get('todo-fenced');
  const backlog = readText(path.join(root, 'BACKLOG.md')) || '';

  /** @type {string[]} */
  const files = [];
  for (const d of TEST_DIRS) files.push(...listFiles(path.join(root, d), { ext: ['.mjs'] }));

  for (const abs of files) {
    const relPath = rel(root, abs);
    const p = fam.pointer(relPath);
    const code = stripComments(readText(abs) || '');
    if (!TODO.test(code)) { p.check(); continue; }

    const isGap = /(^|\/)fixtures\/gaps\//.test(relPath) || /\.gap\.test\.mjs$/.test(relPath);
    if (!isGap) {
      p.fail(`${relPath} uses a .todo() outside a gap fixture; D-027 fences todos to packages/sfs/test/fixtures/gaps/ or *.gap.test.mjs`);
      continue;
    }
    const ids = [...code.matchAll(GAP_ID)].map((m) => m[0]);
    if (ids.length === 0) {
      p.fail(`${relPath} declares a todo with no GAP-0NN id; a gap must be visible in BACKLOG.md`);
      continue;
    }
    const missing = ids.filter((gid) => !backlog.includes(gid));
    p.assert(missing.length === 0,
      `${relPath} references ${missing.join(', ')}, absent from BACKLOG.md — a gap that is not registered is not visible`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a normal test file gains a .todo() outside any gap fixture',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/test/g-gap-visibility.mutation.test.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, [
        "import { test } from 'node:test';",
        // assembled at write time so the string here is not itself a scannable literal
        `test.${'to' + 'do'}('not yet', () => {});`,
        '',
      ].join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a gap fixture declares a todo whose GAP id is not in BACKLOG',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/test/unregistered.gap.test.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, [
        "import { test } from 'node:test';",
        `test.${'to' + 'do'}('GAP-099 unimplemented recipe', () => {});`,
        '',
      ].join('\n'));
    },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fams = await run({ repoRoot: repoRoot() });
  console.log(report(fams, { title: id }));
  process.exit(exitFor(verdictOf(fams)));
}
