// §4.1.1 / §4.3.9: a spec author writes the IR, never the markup, and never reads the
// markup — so a specwriter run log must be free of the six markup fingerprints. A log that
// quotes compiled markup is evidence the author was reading the artifact instead of the IR.
// The gate scans every logs/specwriter-*.md under the committed fixture run and runs/**;
// run-dirty is the negative control the mutation harness points it at.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-specwriter-purity';
export const describe = 'every specwriter run log is free of the six markup fingerprints (§4.1.1)';
export const inputPaths = ['packages/verify/test/fixtures/run', 'packages/verify/test/fixtures/run-dirty'];

const FIXTURE = 'packages/verify/test/fixtures/run';

/** The six markup fingerprints. `check(text)` returns the first that matches, or null. */
const FINGERPRINTS = [
  { name: 'parentId', re: /parentId/ },
  { name: 'componentName', re: /componentName/ },
  { name: '"desktop":', re: /"desktop"\s*:/ },
  { name: 'stylingBox', re: /stylingBox/ },
  { name: '_type":"action-config', re: /_type"\s*:\s*"action-config/ },
  { name: 'version near type', re: /type"?\s*:[\s\S]{0,40}version"?\s*:\s*\d|version"?\s*:\s*\d[\s\S]{0,40}type"?\s*:/ },
];

/** Every logs/specwriter-*.md under a run dir, repo-relative. @param {string} root @param {string} rel @param {string[]} out */
function collectLogs(root, rel, out) {
  const dir = path.join(root, rel, 'logs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) if (/^specwriter-.*\.md$/.test(n)) out.push(`${rel}/logs/${n}`);
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'specwriter-purity', unit: 'log' }]);
  const fam = fams.get('specwriter-purity');

  /** @type {string[]} */
  const logs = [];
  collectLogs(root, FIXTURE, logs);
  const runsDir = path.join(root, 'runs');
  try {
    for (const e of fs.readdirSync(runsDir, { withFileTypes: true })) if (e.isDirectory()) collectLogs(root, `runs/${e.name}`, logs);
  } catch { /* runs/ is gitignored and usually absent */ }

  for (const rel of logs) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const hit = FINGERPRINTS.find((fp) => fp.re.test(text));
    fam.pointer(rel).assert(!hit, hit ? `${rel} leaks the markup fingerprint "${hit.name}" — a spec author reads the IR, never the markup (§4.1.1)` : '');
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the gate is pointed at the run-dirty log, which carries every fingerprint',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const dirty = fs.readFileSync(path.join(tmp, 'packages/verify/test/fixtures/run-dirty/logs/specwriter-employees-r1.md'), 'utf8');
      fs.writeFileSync(path.join(tmp, FIXTURE, 'logs/specwriter-employees-r1.md'), dirty);
    },
    expect: 'fail',
  },
  {
    name: 'a "desktop": block is pasted into a clean log',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, FIXTURE, 'logs/specwriter-employees-r1.md');
      fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8')}\n\n"desktop": { "stylingBox": "{}" }\n`);
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
