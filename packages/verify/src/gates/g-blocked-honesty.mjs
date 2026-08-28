// BLOCKED.md is a program's input, not a promise (invariant 2).
//
// The file's own header states a MUST-strength rule — "every blocked or degraded path
// has a row", "every row must name a tier or gate" — and named `g-blocked-honesty` as
// its enforcer while shipping no such program. A prose rule with no program is exactly
// the thing the rebuild deletes or implements; this is the implementation.
//
// Two families, both over the single pipe table:
//   rows        — every row is structurally complete: a `B<n>` id, an owning WP, an
//                 Evidence cell carrying the command and what it printed, a Degraded
//                 state, an Unblock action, and an ISO Recorded date. A row missing any
//                 of those is a block that cannot be audited or retired.
//   degradation — the Degraded-state cell NAMES something real: a live tier module, a
//                 live gate id, or a config file under packages/verify/config/. A row
//                 pointing at a tier or gate that does not exist is a degradation nobody
//                 can go and look at, which is indistinguishable from an invented one.
//
// The vocabulary is read from disk every run, so deleting or renaming a gate that a row
// depends on fails here rather than leaving the row quietly stale.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot, readText, listFiles, rel } from '../lib/fsx.mjs';

export const id = 'g-blocked-honesty';
export const describe = 'every BLOCKED.md row is structurally complete and its degraded state names a live tier, gate or config file';
export const inputPaths = [
  'BLOCKED.md',
  'packages/verify/src/gates',
  'packages/verify/src/tiers',
  'packages/verify/config',
];

const BLOCKED = 'BLOCKED.md';
const GATES_DIR = 'packages/verify/src/gates';
const TIERS_DIR = 'packages/verify/src/tiers';
const CONFIG_DIR = 'packages/verify/config';

/** The seven columns, in order. Index positions are used by name below. */
const COL = Object.freeze({ id: 0, wp: 1, what: 2, evidence: 3, degraded: 4, unblock: 5, recorded: 6 });
const COLUMNS = 7;

const ROW_ID = /^B\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `export const id = '...'` as written by every gate and tier module. */
const EXPORTED_ID = /^export const id = '([^']+)'/m;

/**
 * @typedef {{line:number, cells:string[]}} BlockedRow
 */

/**
 * Cells of one pipe-table row. A row opens and closes with a pipe, so the outer
 * fragments are empty and are dropped.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  const parts = line.split('|');
  return parts.slice(1, Math.max(1, parts.length - 1)).map((c) => c.trim());
}

/**
 * The one BLOCKED.md table: the contiguous run of pipe rows beneath the `ID` header.
 * Anything outside that run is prose and is not a row.
 * @param {string} text
 * @returns {{found:boolean, rows:BlockedRow[]}}
 */
export function parseTable(text) {
  const lines = text.split('\n');
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('|')) continue;
    if ((splitRow(line)[0] ?? '') === 'ID') { header = i; break; }
  }
  if (header < 0) return { found: false, rows: [] };

  /** @type {BlockedRow[]} */
  const rows = [];
  for (let i = header + 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('|')) break;
    const cells = splitRow(line);
    if (cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // alignment row
    rows.push({ line: i + 1, cells });
  }
  return { found: true, rows };
}

/**
 * Everything a Degraded-state cell is allowed to point at: live tier modules (by
 * basename and by exported id), live gate ids, and config files that exist.
 * @param {string} root
 * @returns {string[]}
 */
export function liveVocabulary(root) {
  /** @type {Set<string>} */
  const names = new Set();

  for (const abs of listFiles(path.join(root, TIERS_DIR), { ext: ['.mjs'] })) {
    names.add(path.basename(abs, '.mjs'));
    const m = EXPORTED_ID.exec(readText(abs) || '');
    if (m && m[1]) names.add(m[1]);
  }
  for (const abs of listFiles(path.join(root, GATES_DIR), { ext: ['.mjs'] })) {
    const base = path.basename(abs, '.mjs');
    if (!base.startsWith('g-') || abs.includes('.mutation.')) continue;
    names.add(base);
    const m = EXPORTED_ID.exec(readText(abs) || '');
    if (m && m[1]) names.add(m[1]);
  }
  for (const abs of listFiles(path.join(root, CONFIG_DIR))) {
    names.add(path.basename(abs));
    names.add(rel(root, abs));
  }
  return [...names].sort();
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'rows', unit: 'blocked-row' },
    { name: 'degradation', unit: 'degraded-state' },
  ]);
  const rowFam = fams.get('rows');
  const degFam = fams.get('degradation');

  const vocabulary = liveVocabulary(root);
  degFam.pointer('vocabulary').assert(vocabulary.length > 0,
    `no tier module, gate or config file was found under ${TIERS_DIR}, ${GATES_DIR} or ${CONFIG_DIR} — ` +
    'with an empty vocabulary every degraded state would trivially name nothing real');

  const text = readText(path.join(root, BLOCKED));
  const tablePointer = rowFam.pointer(`${BLOCKED}#table`);
  if (text === null) {
    tablePointer.fail(`${BLOCKED} is missing; a blocked-honesty rule with no ledger is a rule with no subject`);
    return fams.list;
  }
  const { found, rows } = parseTable(text);
  if (!found) {
    tablePointer.fail(`${BLOCKED} has no table whose first column is "ID"`);
    return fams.list;
  }
  // A blocked-honesty gate over nothing is not a pass: the ledger records real
  // degradations and B13-class environment facts, so an empty one means the rows
  // were deleted rather than unblocked.
  tablePointer.assert(rows.length > 0,
    `${BLOCKED} declares a table with 0 rows — an empty ledger is a claim that nothing is degraded, which must be earned by deleting the rule, not the rows`);

  for (const row of rows) {
    const cells = row.cells;
    const rowId = cells[COL.id] ?? '';
    const where = `${BLOCKED}:${row.line} ${rowId || '(no id)'}`;
    const p = rowFam.pointer(where);

    if (cells.length !== COLUMNS) {
      p.fail(`${where} has ${cells.length} cells, expected ${COLUMNS} (ID | WP | What is blocked | Evidence | Degraded state | Unblock action | Recorded)`);
      degFam.pointer(where).fail(`${where} is malformed, so its degraded state cannot be resolved`);
      continue;
    }

    /** @type {string[]} */
    const problems = [];
    if (!ROW_ID.test(rowId)) problems.push(`id "${rowId}" is not a B<n> id`);
    if ((cells[COL.wp] ?? '') === '') problems.push('names no owning WP');
    if ((cells[COL.what] ?? '') === '') problems.push('says nothing about what is blocked');
    if ((cells[COL.evidence] ?? '') === '') problems.push('carries no Evidence (command + observed output)');
    if ((cells[COL.degraded] ?? '') === '') problems.push('carries no Degraded state');
    if ((cells[COL.unblock] ?? '') === '') problems.push('carries no Unblock action — a block with no exit is a permanent one recorded as temporary');
    if (!ISO_DATE.test(cells[COL.recorded] ?? '')) problems.push(`Recorded "${cells[COL.recorded] ?? ''}" is not a YYYY-MM-DD date`);
    p.assert(problems.length === 0, `${where} ${problems.join('; ')}`);

    const degraded = cells[COL.degraded] ?? '';
    const dp = degFam.pointer(where);
    if (degraded === '') {
      dp.fail(`${where} has an empty Degraded state, so it names no tier, gate or config`);
      continue;
    }
    // The name has to be CITED, in a code span, not merely mentioned somewhere in the
    // sentence: a plain substring test passes on a row whose degraded state reads
    // "Nothing degrades; unrelated to g-decisions", which names nothing at all.
    const cited = [...degraded.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    dp.assert(cited.some((c) => vocabulary.includes(c)),
      `${where} degraded state cites no live tier, gate id or ${CONFIG_DIR} file in a code span; it cites ${JSON.stringify(cited)} in ${JSON.stringify(degraded.slice(0, 120))}`);
  }

  return fams.list;
}

/**
 * Line index (0-based) of the last row in the BLOCKED.md table, for the mutations.
 * @param {string[]} lines
 * @returns {{header:number, last:number}}
 */
function tableSpan(lines) {
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim().startsWith('| ID |')) { header = i; break; }
  }
  let last = header;
  for (let i = header + 1; i < lines.length; i++) {
    if (!(lines[i] ?? '').trim().startsWith('|')) break;
    last = i;
  }
  return { header, last };
}

export const mutations = [
  {
    name: 'a row degrades to a gate that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, BLOCKED);
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      const { last } = tableSpan(lines);
      const row = '| B99 | WP-0 | A fabricated block | `node nothing.mjs` -> `nothing` ' +
        '| `g-does-not-exist` reports notRun | Delete this row | 2026-08-28 |';
      lines.splice(last + 1, 0, row);
      fs.writeFileSync(f, lines.join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a row loses its unblock action and its recorded date',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, BLOCKED);
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      const { header, last } = tableSpan(lines);
      for (let i = header + 1; i <= last; i++) {
        const line = lines[i] ?? '';
        if (!/^\|\s*B\d+\s*\|/.test(line.trim())) continue;
        const parts = line.trim().split('|');
        const cells = parts.slice(1, Math.max(1, parts.length - 1));
        if (cells.length !== COLUMNS) continue;
        cells[COL.unblock] = ' ';
        cells[COL.recorded] = ' ';
        lines[i] = `|${cells.join('|')}|`;
        break;
      }
      fs.writeFileSync(f, lines.join('\n'));
    },
    expect: 'fail',
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
