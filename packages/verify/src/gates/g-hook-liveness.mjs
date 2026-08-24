// §4.3.9 row g-hook-liveness: for every subject run dir, hooks.jsonl has at least as
// many lines as manifest.json.events.length. A hook that stopped firing (a truncated or
// missing log) is a silent loss of the audit trail — every state transition the manifest
// records must have left a hook decision behind. Subjects: the committed fixture run and
// any runs/* on disk. runs/ is gitignored and normally empty, so the fixture guarantees
// coverage > 0; it is not declared as an inputPath for that reason.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-hook-liveness';
export const describe = 'every run dir: hooks.jsonl line count >= manifest.json events.length';
export const inputPaths = ['packages/verify/test/fixtures/run'];

const FIXTURE = 'packages/verify/test/fixtures/run';

/** Every subject run dir (the fixture plus any runs/*), repo-relative. @param {string} root @returns {string[]} */
function subjectRuns(root) {
  /** @type {string[]} */
  const out = [];
  if (fs.existsSync(path.join(root, FIXTURE, 'manifest.json'))) out.push(FIXTURE);
  const runsDir = path.join(root, 'runs');
  if (fs.existsSync(runsDir)) {
    for (const e of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(runsDir, e.name, 'manifest.json'))) out.push(`runs/${e.name}`);
    }
  }
  return out;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'liveness', unit: 'run' }]);
  const fam = fams.get('liveness');

  for (const rel of subjectRuns(root)) {
    const p = fam.pointer(rel);
    let events;
    try { events = (JSON.parse(fs.readFileSync(path.join(root, rel, 'manifest.json'), 'utf8')).events || []).length; } catch { p.fail(`${rel}/manifest.json is missing or unparseable`); continue; }
    let lines = 0;
    try { lines = fs.readFileSync(path.join(root, rel, 'hooks.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').length; } catch { p.fail(`${rel}/hooks.jsonl is missing — the hook audit trail is empty`); continue; }
    p.assert(lines >= events, `${rel}: hooks.jsonl has ${lines} line(s) but manifest records ${events} event(s); a hook stopped firing`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'hooks.jsonl is truncated, so the audit trail no longer covers the events',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { fs.writeFileSync(path.join(tmp, FIXTURE, 'hooks.jsonl'), ''); },
    expect: 'fail',
  },
  {
    name: 'an event is appended to the manifest with no matching hook line',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, FIXTURE, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      m.events.push({ at: '2026-08-24T10:04:00Z', kind: 'push', detail: 'pushed with no hook line', screen: 'items' });
      fs.writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`);
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
