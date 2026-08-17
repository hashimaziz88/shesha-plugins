// O7, D-001, D-011: disposition is data, not prose.
//
// Three failures, and the middle one is the interesting one: a delete row whose
// path is already gone while its work package is NOT yet complete means something
// was deleted off-plan. Without that check, "disposition" degenerates into a record
// written after the fact to match whatever happened.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  families, readJsonGuarded, verdictOf, report, exitFor, runGuarded,
} from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';
import { completedWps } from '../lib/session-state.mjs';

export const id = 'g-disposition';
export const describe = 'every deletion and move is declared, executed only in its own WP, and leaves nothing dangling';
// Both sides of every row have to be staged: the gate asks whether each declared
// path is absent and each move destination present, so a copy carrying only the
// config would report every completed move as having failed to land.
export const inputPaths = [
  'packages/verify/config/disposition.json',
  'packages/verify/config/wp-table.json',
  'BUILD-LOG.md',
  'quarantine',
  'plugins',
  'packages',
];

/**
 * @typedef {{path:string, action:'delete'|'move', to?:string, wp:string, reason:string}} Row
 */

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'row-shape', unit: 'row' },
    { name: 'due-now', unit: 'row' },
    { name: 'early-deletions', unit: 'row' },
    { name: 'move-targets', unit: 'row' },
  ]);

  const shapeFam = fams.get('row-shape');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/disposition.json'),
    shapeFam, 'disposition.json');
  if (!got.ok) return fams.list;
  const rows = /** @type {{rows:Row[]}} */ (got.value).rows || [];
  if (rows.length === 0) {
    shapeFam.pointer('disposition.json#rows').fail('no disposition rows; every deletion in this repo must be declared');
    return fams.list;
  }

  const done = completedWps(root);

  for (const r of rows) {
    const sp = shapeFam.pointer(r.path || '(no path)');
    const problems = [];
    if (!r.path) problems.push('has no path');
    if (r.action !== 'delete' && r.action !== 'move') problems.push(`action "${r.action}" is neither delete nor move`);
    if (!r.wp) problems.push('names no work package');
    if (!r.reason) problems.push('gives no reason');
    if (r.action === 'move' && !r.to) problems.push('is a move with no destination');
    if (problems.length) { sp.fail(`${r.path}: ${problems.join('; ')}`); continue; }
    sp.check(4);

    const exists = fs.existsSync(path.join(root, r.path));
    const complete = done.has(r.wp);

    if (r.action === 'delete') {
      // Due now: its WP is complete, so the path must be gone.
      const dp = fams.get('due-now').pointer(`${r.wp}: delete ${r.path}`);
      if (complete) {
        dp.assert(!exists, `${r.wp} is recorded complete but ${r.path} still exists; the declared deletion never happened`);
      } else {
        dp.na(`${r.wp} is not yet complete, so this deletion is not due`);
      }

      // Off-plan: gone before its WP ran.
      const ep = fams.get('early-deletions').pointer(`${r.wp}: ${r.path}`);
      ep.assert(complete || exists,
        `${r.path} is already absent but ${r.wp} is not recorded complete — deleted off-plan, outside the package that owns it`);
    } else {
      const mp = fams.get('move-targets').pointer(`${r.wp}: ${r.path} -> ${r.to}`);
      const landed = r.to ? fs.existsSync(path.join(root, r.to)) : false;
      if (complete) {
        mp.assert(landed && !exists,
          `${r.wp} is complete, so ${r.to} must exist and ${r.path} must not; landed=${landed} source-still-present=${exists}`);
      } else {
        mp.na(`${r.wp} is not yet complete, so this move is not due`);
      }
    }
  }

  // Every family must evaluate something, or a report of "all not-due" reads as success.
  const anyChecked = fams.list.some((f) => f.checked > 0);
  fams.get('row-shape').pointer('disposition#evaluated').assert(anyChecked,
    'no disposition row was evaluated; the gate would be reporting over an inert file');

  return fams.list;
}

export const mutations = [
  {
    name: 'a completed WP declares a deletion that never happened',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/disposition.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      d.rows.push({
        path: 'packages/verify/config/wp-table.json',
        action: 'delete',
        wp: 'WP-0',
        reason: 'planted: this path exists, so a completed WP claiming to have deleted it must fail',
      });
      fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a completed move points at a destination that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/disposition.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const move = d.rows.find((/** @type {Row} */ r) => r.action === 'move' && r.wp === 'WP-0');
      if (move) move.to = 'packages/verify/nowhere/absent.mjs';
      fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a row loses its work package',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/config/disposition.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      delete d.rows[0].wp;
      fs.writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
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
