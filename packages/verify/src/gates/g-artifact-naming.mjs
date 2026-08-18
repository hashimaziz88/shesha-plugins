// D-044: exactly four artifact names, and `.compiled.json` is banned.
//
//   <screen>.form.json · <screen>.compile.json · <screen>.form.meta.json · <screen>.sfs.meta.json
//   blessed fixtures:   <screen>.expected.form.json
//
// Two families:
//   no-banned  — no committed path matches \.compiled(\.meta)?\.json$. Three names
//                for two artifacts were baked into command lines this session would
//                paste; the ban is the enforcer, not the prose.
//   emitted    — the ONE writer of markup (bin/sfs.mjs) produces only legal names.
//                Measured by running the CLI in a SUBPROCESS from the repo root, so
//                the mutation harness's staged-and-mutated CLI is the one under test.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { families, report, runGuarded, verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-artifact-naming';
export const describe = 'the four legal artifact names; `.compiled.json` banned; the CLI emits only legal names';
export const inputPaths = [
  'packages/sfs/bin/sfs.mjs',
  'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json',
  'packages/sfs/src',
  'packages/registry/data',
  'packages',
  'package.json',
];

/** A path is banned when it matches this (D-044). */
const BANNED = /\.compiled(\.meta)?\.json$/;
/** The legal emitted suffixes. `.sfs.meta.json` is produced by decompile, not compile. */
const LEGAL_EMITTED = /\.(form\.json|compile\.json|form\.meta\.json|sfs\.meta\.json)$/;
/** The fixture the CLI is exercised on; its own name is not an emitted artifact. */
const FIXTURE = 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json';

/** Directories a walk never descends into. */
const SKIP = new Set(['node_modules', '.git', '.build']);

/**
 * Every tracked-ish file under a root, excluding build and vendor trees.
 * @param {string} root
 * @returns {string[]} repo-relative paths
 */
function walkFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @returns {void} */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'no-banned', unit: 'file' },
    { name: 'emitted', unit: 'file' },
  ]);

  // --- no committed path uses a banned name ------------------------------------
  const banned = fams.get('no-banned');
  const files = walkFiles(root);
  // The scan must see something, or it would pass vacuously.
  banned.pointer('scan#nonempty').assert(files.length > 0, 'the file walk found nothing to scan');
  for (const rel of files) {
    if (!/\.json$/.test(rel)) continue; // only JSON artifacts can carry the banned shape
    banned.pointer(rel).assert(!BANNED.test(rel), `${rel} matches the banned \\.compiled(\\.meta)?\\.json$ shape (D-044)`);
  }

  // --- the CLI emits only legal names ------------------------------------------
  const emitted = fams.get('emitted');
  const cli = path.join(root, 'packages/sfs/bin/sfs.mjs');
  const fixtureAbs = path.join(root, FIXTURE);
  const run1 = emitted.pointer('cli#run');
  if (!fs.existsSync(cli) || !fs.existsSync(fixtureAbs)) {
    run1.fail(`${!fs.existsSync(cli) ? 'the CLI' : 'the fixture'} is missing; the emitted-name check cannot run`);
    return fams.list;
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-naming-'));
  try {
    execFileSync(process.execPath, [cli, 'compile', fixtureAbs, '--out', outDir],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run1.check();
  } catch (e) {
    // Exit 3 (partial verdict) still writes the artifacts; any other code is a real failure.
    const status = /** @type {{status?:number}} */ (e).status;
    if (status === 3) run1.check();
    else { run1.fail(`the CLI exited ${status}; artifact names could not be measured`); return fams.list; }
  }
  const produced = fs.readdirSync(outDir);
  emitted.pointer('cli#produced-any').assert(produced.length > 0, 'the CLI wrote no artifacts');
  for (const name of produced) {
    const p = emitted.pointer(`emitted:${name}`);
    p.assert(!BANNED.test(name), `the CLI emitted "${name}", which matches the banned shape (D-044)`);
    p.assert(LEGAL_EMITTED.test(name), `the CLI emitted "${name}", which is none of the four legal artifact names (D-044)`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a committed artifact uses the banned .compiled.json name',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.writeFileSync(path.join(tmp, 'packages/sfs/test/fixtures/clean/x.compiled.json'), '{}\n');
    },
    expect: 'fail',
  },
  {
    name: 'the CLI emits .compiled.json instead of .compile.json',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/bin/sfs.mjs');
      const text = fs.readFileSync(f, 'utf8');
      const needle = '`${form}.compile.json`';
      if (!text.includes(needle)) throw new Error('mutation anchor not found: the compile artifact name moved');
      fs.writeFileSync(f, text.replace(needle, '`${form}.compiled.json`'));
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
