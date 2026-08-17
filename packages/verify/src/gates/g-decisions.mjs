// D-028, D-029, D-045, D-065: every decision names an enforcer that resolves.
//
// This is invariant 2 made executable. A rule expressed only in markdown is
// deleted, not annotated; a rule whose enforcer does not exist yet is registered
// as `pending:<WP-id>` (O6) and forced to become real in the work package that
// creates its subject. A `pending:` row surviving its WP's completion is a hard
// failure, which is the ratchet: the alternative is a registry full of rules that
// were going to be enforced later.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  families, readJsonGuarded, verdictOf, report, exitFor, runGuarded,
} from '@shesha/registry/coverage';
import {
  parseDecisions, enforcerEntries, COLUMNS, STATUSES, LEGAL_HEADINGS,
  readRegistry, isArchivable, ARCHIVE_PATH, ARCHIVE_HEADINGS,
} from '@shesha/registry/decisions';
import { generate, GENERATED_PATH } from '@shesha/registry/gen-decisions';
import { readText, normalisedByteSize, repoRoot } from '../lib/fsx.mjs';
import { completedWps, backlogIds } from '../lib/session-state.mjs';

export const id = 'g-decisions';
export const describe = 'eight cells, contiguous ids, legal statuses, every enforcer resolves, no-theatre block, generated json identical';
export const inputPaths = [
  'DECISIONS.md',
  'docs/decisions-archive.md',
  'packages/verify/config/decisions-archive.json',
  'packages/verify/config/pending-budget.json',
  'packages/verify/config/wp-table.json',
  'BACKLOG.md',
  // Every path an Enforced by entry can resolve against has to be in the staged
  // copy, or the mutation harness measures a gate whose enforcers all look absent.
  'packages/verify/src/gates',
  'packages/verify/test',
  'packages/registry/probes',
  'packages/sfs/registry/decisions.json',
  'package.json',
  'packages/registry/src/coverage.mjs',
  'packages/registry/test/coverage.test.mjs',
  'packages/verify/src/lib/fsx.mjs',
  'docs/rebuild-brief/CONTROL.md',
  'packages/verify/config/session-scope.json',
  '.githooks',
];

/** The `## No theatre` block is fifteen lines and at most 1536 bytes. */
const NO_THEATRE_LINES = 15;
const NO_THEATRE_BYTES = 1536;

/** The id range §5.11 owns; CONTROL §3's acceptance names it explicitly. */
const RECONCILIATION_FIRST = 40;
const RECONCILIATION_LAST = 58;

/**
 * Resolve one `Enforced by` entry against the five legal forms (O6, D-045).
 * @param {string} entry
 * @param {{root:string, gateIds:Set<string>, pendingOwners:Set<string>, done:Set<string>, knownIds:Set<string>}} ctx
 * @returns {{ok:true, form:string} | {ok:false, form:string, reason:string}}
 */
export function resolveEnforcer(entry, ctx) {
  // Form 1: a gate id with a file under packages/verify/src/gates/.
  if (/^g-[a-z0-9-]+$/.test(entry)) {
    return ctx.gateIds.has(entry)
      ? { ok: true, form: 'gate' }
      : { ok: false, form: 'gate', reason: `no gate module exports id "${entry}" under packages/verify/src/gates/` };
  }

  // Form 2: structural:<path> or hook:<path> — the path must exist.
  const structural = /^(structural|hook):(.+)$/.exec(entry);
  if (structural) {
    const [, kind, target] = structural;
    if (!fs.existsSync(path.join(ctx.root, target))) {
      return { ok: false, form: kind, reason: `${kind}: path "${target}" does not exist` };
    }
    if (kind === 'hook' && !/^(\.claude\/hooks|\.githooks)\//.test(target)) {
      return { ok: false, form: kind, reason: `hook: "${target}" must live under .claude/hooks/ or .githooks/` };
    }
    return { ok: true, form: kind };
  }

  // Form 3: check:<tier-module>:<check-id> — the tier must export that id.
  const check = /^check:([a-z0-9-]+):([A-Za-z0-9.]+)$/.exec(entry);
  if (check) {
    const [, tier, checkId] = check;
    const tierPath = path.join(ctx.root, 'packages/verify/src/tiers', `${tier}.mjs`);
    if (!fs.existsSync(tierPath)) {
      return { ok: false, form: 'check', reason: `check: tier module "${tier}" does not exist; use pending:<WP-id> until it does` };
    }
    const text = readText(tierPath) || '';
    return text.includes(checkId)
      ? { ok: true, form: 'check' }
      : { ok: false, form: 'check', reason: `check: "${checkId}" is not in ${tier}'s exported checks[]` };
  }

  // Form 5 (O6): pending:<WP-id>, legal only while that WP has no complete block.
  const pending = /^pending:([A-Za-z0-9.-]+)$/.exec(entry);
  if (pending) {
    const owner = pending[1];
    if (!ctx.knownIds.has(owner)) {
      return { ok: false, form: 'pending', reason: `pending: "${owner}" is neither a WP in wp-table.json nor a row in BACKLOG.md` };
    }
    if (!ctx.pendingOwners.has(owner)) {
      return { ok: false, form: 'pending', reason: `pending: no owner row in pending-budget.json for ${owner}` };
    }
    if (ctx.done.has(owner)) {
      return {
        ok: false,
        form: 'pending',
        reason: `pending: ${owner} is recorded complete in BUILD-LOG.md, so this row must now name a real enforcer — rewrite it`,
      };
    }
    return { ok: true, form: 'pending' };
  }

  return { ok: false, form: 'unknown', reason: `"${entry}" matches none of the five legal Enforced by forms (O6)` };
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'rows', unit: 'row' },
    { name: 'ids', unit: 'id' },
    { name: 'statuses', unit: 'row' },
    { name: 'enforcers', unit: 'entry' },
    { name: 'confirmations', unit: 'row' },
    { name: 'no-theatre', unit: 'line' },
    { name: 'generated-json', unit: 'file' },
    { name: 'file-shape', unit: 'assertion' },
    { name: 'pending-budget', unit: 'assertion' },
    { name: 'archive', unit: 'assertion' },
  ]);

  const shapeFam = fams.get('file-shape');
  const text = readText(path.join(root, 'DECISIONS.md'));
  if (text === null) {
    shapeFam.pointer('DECISIONS.md').fail('DECISIONS.md does not exist — there is no decision registry');
    return fams.list;
  }

  // The registry is the union of the live file and the archive (D-075). Every
  // family below that reasons about the REGISTRY walks `parsed`; only the byte cap
  // and the stray-prose shape are per-file, so archiving cannot weaken a check.
  const registry = readRegistry((rel) => readText(path.join(root, rel)));
  const parsed = { ...registry.live, rows: registry.rows };

  // ---- rows: eight cells each ----------------------------------------------
  const rowFam = fams.get('rows');
  for (const [file, p] of [['DECISIONS.md', registry.live], [ARCHIVE_PATH, registry.archive]]) {
    for (const bad of /** @type {{malformed:{line:number,text:string,cellCount:number}[]}|null} */ (p)?.malformed || []) {
      rowFam.pointer(`${file}:${bad.line}`)
        .fail(`row "${bad.text}" has ${bad.cellCount} cells; all ${COLUMNS.length} columns are mandatory`);
    }
  }
  for (const r of parsed.rows) {
    const p = rowFam.pointer(r.id);
    const empty = COLUMNS.filter((c) => !String(r[/** @type {keyof typeof r} */ (c)] || '').trim());
    p.assert(empty.length === 0, `${r.id} has empty cell(s): ${empty.join(', ')}`);
  }

  // ---- ids: zero-padded, unique, contiguous, never reused -------------------
  const idFam = fams.get('ids');
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const r of parsed.rows) {
    const p = idFam.pointer(r.id);
    if (seen.has(r.id)) { p.fail(`${r.id} is duplicated (first at line ${seen.get(r.id)})`); continue; }
    seen.set(r.id, r.line);
    p.check();
  }
  const numbers = parsed.rows.map((r) => Number(r.id.slice(2))).sort((a, b) => a - b);
  const contiguity = idFam.pointer('ids#contiguous');
  /** @type {number[]} */
  const gaps = [];
  for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) {
    if (!numbers.includes(n)) gaps.push(n);
  }
  contiguity.assert(gaps.length === 0,
    `ids must be sequential with no gaps; missing ${gaps.map((n) => `D-${String(n).padStart(3, '0')}`).join(', ')}`);

  const ordered = idFam.pointer('ids#ascending');
  const asWritten = parsed.rows.map((r) => Number(r.id.slice(2)));
  ordered.assert(asWritten.every((n, i) => i === 0 || n > asWritten[i - 1]),
    'ids must appear in ascending order; the registry is append-only');

  // CONTROL §3's acceptance string: the reconciliation block must be present.
  const present = new Set(parsed.rows.map((r) => r.id));
  /** @type {string[]} */
  const missingRecon = [];
  for (let n = RECONCILIATION_FIRST; n <= RECONCILIATION_LAST; n++) {
    const wanted = `D-${String(n).padStart(3, '0')}`;
    if (!present.has(wanted)) missingRecon.push(wanted);
  }
  idFam.pointer('ids#reconciliation-block').assert(missingRecon.length === 0,
    `the thirteen brief reconciliations occupy D-040..D-058; missing ${missingRecon.join(', ')}`);

  // ---- statuses ------------------------------------------------------------
  const statusFam = fams.get('statuses');
  for (const r of parsed.rows) {
    const p = statusFam.pointer(r.id);
    const legal = STATUSES.includes(r.status) || /^superseded-by-D-\d{3}$/.test(r.status);
    if (!legal) { p.fail(`${r.id} Status "${r.status}" is outside {${STATUSES.join(', ')}, superseded-by-D-0NN}`); continue; }
    if (/^superseded-by-D-(\d{3})$/.test(r.status)) {
      const by = `D-${/^superseded-by-D-(\d{3})$/.exec(r.status)?.[1]}`;
      p.assert(present.has(by), `${r.id} is superseded by ${by}, which is not in the registry`);
      continue;
    }
    p.check();
  }

  // ---- enforcers: every entry resolves under one of the four forms ----------
  const enfFam = fams.get('enforcers');
  const gateDir = path.join(root, 'packages/verify/src/gates');
  /** @type {Set<string>} */
  const gateIds = new Set();
  if (fs.existsSync(gateDir)) {
    for (const f of fs.readdirSync(gateDir)) {
      if (f.startsWith('g-') && f.endsWith('.mjs') && !f.includes('.mutation.')) gateIds.add(path.basename(f, '.mjs'));
    }
  }

  const pendGot = readJsonGuarded(path.join(root, 'packages/verify/config/pending-budget.json'),
    fams.get('pending-budget'), 'pending-budget.json');
  /** @type {Set<string>} */
  const pendingOwners = new Set();
  let pendingMax = Number.POSITIVE_INFINITY;
  if (pendGot.ok) {
    const cfg = /** @type {{max:number, owners:{wp:string, enforcers:string[]}[]}} */ (pendGot.value);
    pendingMax = cfg.max;
    for (const row of cfg.owners || []) pendingOwners.add(row.wp);
  }

  const wpGot = readJsonGuarded(path.join(root, 'packages/verify/config/wp-table.json'),
    fams.get('pending-budget'), 'wp-table.json');
  /** @type {Set<string>} */
  const knownIds = new Set(backlogIds(root));
  if (wpGot.ok) {
    const wt = /** @type {{wps:{id:string}[]}} */ (wpGot.value);
    for (const w of wt.wps || []) knownIds.add(w.id);
  }

  const done = completedWps(root);
  const resolverCtx = { root, gateIds, pendingOwners, done, knownIds };
  /** @type {Set<string>} */
  const pendingSeen = new Set();
  for (const { id: rowId, entry } of enforcerEntries(parsed.rows)) {
    const p = enfFam.pointer(`${rowId}: ${entry}`);
    const got = resolveEnforcer(entry, resolverCtx);
    if (got.form === 'pending') pendingSeen.add(entry.slice('pending:'.length));
    p.assert(got.ok, got.ok ? '' : `${rowId} — ${got.reason}`);
  }

  // D-073: the budget counts DISTINCT OWNER IDS, not rows. A row count can never
  // reach 20 while the deferred work genuinely exists, so counting rows would make
  // the cap unreachable and the only release valve would be widening it.
  const budget = fams.get('pending-budget');
  budget.pointer('pending#budget').assert(pendingSeen.size <= pendingMax,
    `${pendingSeen.size} distinct pending owner(s) against a budget of ${pendingMax}; the budget ratchets down only`);

  // ---- confirmations -------------------------------------------------------
  const confFam = fams.get('confirmations');
  for (const r of parsed.rows) {
    const p = confFam.pointer(r.id);
    const c = r.confirmation;
    if (c === 'n/a') {
      p.assert(r.status !== 'pending-probe',
        `${r.id} is pending-probe but its Confirmation is n/a; a pending-probe row must name its probe (D-065)`);
      continue;
    }
    const probeMatch = /^(pending-probe|probe):([a-z0-9-]+)$/.exec(c);
    if (!probeMatch) { p.fail(`${r.id} Confirmation "${c}" must be n/a, pending-probe:<name>, or probe:<name>`); continue; }
    const [, kind, name] = probeMatch;
    const script = path.join(root, 'packages/registry/probes', `${name}.mjs`);
    if (!fs.existsSync(script)) {
      p.fail(`${r.id} Confirmation names probe "${name}" but packages/registry/probes/${name}.mjs does not exist (D-065)`);
      continue;
    }
    if (kind === 'pending-probe') {
      p.assert(r.status === 'pending-probe',
        `${r.id} carries a pending-probe Confirmation, so its Status must be pending-probe, not "${r.status}"`);
    } else {
      const result = path.join(root, 'packages/registry/probes/results', `${name}.json`);
      p.assert(fs.existsSync(result),
        `${r.id} claims probe:${name} but no recorded result exists at packages/registry/probes/results/${name}.json`);
    }
  }

  // ---- the no-theatre block ------------------------------------------------
  const theatreFam = fams.get('no-theatre');
  if (parsed.noTheatre.length === 0) {
    theatreFam.pointer('## No theatre').fail('the ## No theatre block is missing or empty');
  } else {
    for (const line of parsed.noTheatre) {
      const p = theatreFam.pointer(line.slice(0, 40));
      p.assert(line.includes('->'), `no-theatre line "${line.slice(0, 50)}" must name its enforcer with "->"`);
    }
    const count = theatreFam.pointer('no-theatre#count');
    count.assert(parsed.noTheatre.length === NO_THEATRE_LINES,
      `the block carries ${parsed.noTheatre.length} lines; exactly ${NO_THEATRE_LINES} banned behaviours are declared`);
    const bytes = Buffer.byteLength(parsed.noTheatre.join('\n'), 'utf8');
    theatreFam.pointer('no-theatre#bytes').assert(bytes <= NO_THEATRE_BYTES,
      `the block is ${bytes} B, over its ${NO_THEATRE_BYTES} B cap`);
  }

  // ---- file shape: no prose outside the table, and only legal headings -----
  for (const [file, p, legal] of /** @type {[string, typeof registry.live|null, string[]][]} */ ([
    ['DECISIONS.md', registry.live, LEGAL_HEADINGS],
    [ARCHIVE_PATH, registry.archive, ARCHIVE_HEADINGS],
  ])) {
    if (p === null) continue;
    for (const stray of p.strayProse) {
      shapeFam.pointer(`${file}:${stray.line}`)
        .fail(`prose outside the table: "${stray.text}". Only ${legal.join(' and ')} are legal (D-028)`);
    }
    for (const h of p.headings) {
      shapeFam.pointer(`${file} heading "${h}"`).assert(legal.includes(h),
        `heading "${h}" in ${file} is not one of ${legal.join(', ')}`);
    }
  }
  const capPointer = shapeFam.pointer('DECISIONS.md#bytes');
  const size = normalisedByteSize(path.join(root, 'DECISIONS.md'));
  capPointer.assert(size <= 24576, `DECISIONS.md is ${size} B, over its 24576 B cap`);

  // ---- archive: a move, never a rewrite, and never an open row -------------
  // The target is asserted whether or not an archive exists: an absent archive is
  // legitimate only while the live file is already under budget, so this family
  // always carries at least one real assertion and can never walk 0.
  const archFam = fams.get('archive');
  const archCfg = readJsonGuarded(path.join(root, 'packages/verify/config/decisions-archive.json'), archFam,
    'decisions-archive.json');
  if (archCfg.ok) {
    const target = /** @type {{liveTargetBytes:number}} */ (archCfg.value).liveTargetBytes;
    archFam.pointer('archive#target').assert(size <= target,
      `DECISIONS.md is ${size} B, over the ${target} B archive target — run `
      + 'node packages/registry/src/gen-decisions.mjs --archive');
  }
  const liveIds = new Set(registry.live.rows.map((r) => r.id));
  for (const r of registry.archive === null ? [] : registry.archive.rows) {
    const p = archFam.pointer(`${ARCHIVE_PATH} ${r.id}`);
    if (liveIds.has(r.id)) {
      p.fail(`${r.id} is in BOTH DECISIONS.md and ${ARCHIVE_PATH}; a row is archived by moving it, not copying it`);
      continue;
    }
    p.assert(isArchivable(r),
      `${r.id} is archived but not closed (status "${r.status}", enforced by "${r.enforcedBy}"). `
      + 'A pending-probe row is open risk and a pending: enforcer is deferred work: both must stay in DECISIONS.md');
  }

  // ---- the generated json is byte-identical --------------------------------
  const genFam = fams.get('generated-json');
  const gp = genFam.pointer(GENERATED_PATH);
  const got = generate(root);
  if (!got.ok) gp.fail(`cannot regenerate: ${got.reason}`);
  else {
    const committed = readText(path.join(root, GENERATED_PATH));
    if (committed === null) gp.fail(`${GENERATED_PATH} is not committed; run node packages/registry/src/gen-decisions.mjs`);
    else gp.assert(committed === got.json,
      `${GENERATED_PATH} differs from DECISIONS.md — regenerate it in the same commit (D-029)`);
  }

  return fams.list;
}

/**
 * A row lives in DECISIONS.md or in the archive; the mutations must not care
 * which, or archiving a row would silently disarm one of them.
 * @param {string} tmp
 * @param {string} rowId
 * @returns {{file:string, lines:string[], index:number}}
 */
function locateRow(tmp, rowId) {
  for (const rel of ['DECISIONS.md', ARCHIVE_PATH]) {
    const file = path.join(tmp, rel);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const index = lines.findIndex((l) => l.trim().startsWith(`| ${rowId} |`));
    if (index >= 0) return { file, lines, index };
  }
  throw new Error(`mutation cannot proceed: ${rowId} is in neither DECISIONS.md nor ${ARCHIVE_PATH}`);
}

export const mutations = [
  {
    name: 'a row names a gate that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      // Find a row whose Enforced by cell IS a bare gate id rather than pinning a
      // row number: pinning breaks the moment that row is archived or its enforcer
      // is rewritten, and a mutation that silently no-ops proves nothing.
      for (const rel of ['DECISIONS.md', ARCHIVE_PATH]) {
        const file = path.join(tmp, rel);
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        const i = lines.findIndex((l) => /^\| D-\d{3} \|.*\| g-[a-z-]+ \| [^|]+ \|\s*$/.test(l.trim()));
        if (i < 0) continue;
        lines[i] = lines[i].replace(/\| g-[a-z-]+ \| ([^|]+) \|(\s*)$/, '| g-does-not-exist | $1 |$2');
        fs.writeFileSync(file, lines.join('\n'));
        return;
      }
      throw new Error('mutation cannot proceed: no row names a bare gate id as its enforcer');
    },
    expect: 'fail',
  },
  {
    name: 'a row loses a cell',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const at = locateRow(tmp, 'D-002');
      at.lines[at.index] = at.lines[at.index].replace(' | n/a |', ' |');
      fs.writeFileSync(at.file, at.lines.join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'an id is removed, leaving a gap in the sequence',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const at = locateRow(tmp, 'D-025');
      at.lines.splice(at.index, 1);
      fs.writeFileSync(at.file, at.lines.join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'an archived row is copied back into DECISIONS.md instead of moved',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const at = locateRow(tmp, 'D-002');
      if (!at.file.endsWith('decisions-archive.md')) {
        throw new Error('mutation cannot proceed: D-002 is not archived, so a duplicate cannot be planted');
      }
      const live = path.join(tmp, 'DECISIONS.md');
      const lines = fs.readFileSync(live, 'utf8').split('\n');
      const last = lines.reduce((acc, l, i) => (l.trim().startsWith('| D-') ? i : acc), -1);
      lines.splice(last + 1, 0, at.lines[at.index]);
      fs.writeFileSync(live, lines.join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'an open row is archived, moving deferred work out of the prompt',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const at = locateRow(tmp, 'D-002');
      if (!at.file.endsWith('decisions-archive.md')) {
        throw new Error('mutation cannot proceed: D-002 is not archived');
      }
      at.lines[at.index] = at.lines[at.index].replace('| decided |', '| pending-probe |');
      fs.writeFileSync(at.file, at.lines.join('\n'));
    },
    expect: 'fail',
  },
  {
    name: 'a pending-probe row loses its probe script',
    kind: 'repo',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.rmSync(path.join(tmp, 'packages/registry/probes/reflist-name-format.mjs'), { force: true });
    },
    expect: 'fail',
  },
  {
    name: 'prose is added outside the table',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'DECISIONS.md');
      fs.appendFileSync(f, '\nNote: D-035 is under discussion and may be revisited later.\n');
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));

    // The summary is derived from the families the gate already produced, not
    // re-computed: a second resolution pass could disagree with the verdict.
    const byName = new Map(fams.map((f) => [f.name, f]));
    const rowsFam = byName.get('rows');
    const enfFam = byName.get('enforcers');
    const reg = readRegistry((rel) => readText(path.join(root, rel)));
    const rows = reg.rows;
    const entries = enforcerEntries(rows);
    const unresolved = enfFam ? enfFam.failures.length : entries.length;
    const pendingOwnerIds = new Set(entries.filter((e) => e.entry.startsWith('pending:')).map((e) => e.entry.slice(8)));
    void rowsFam;
    console.log(`\nrows=${rows.length} (live=${reg.live.rows.length} archived=${reg.archive ? reg.archive.rows.length : 0})`
      + ` enforcers=${entries.length - unresolved}/${entries.length} resolved · pending owners=${pendingOwnerIds.size} · unresolved=${unresolved}`);

    const ids = new Set(rows.map((r) => r.id));
    let reconciliationComplete = true;
    for (let n = RECONCILIATION_FIRST; n <= RECONCILIATION_LAST; n++) {
      if (!ids.has(`D-${String(n).padStart(3, '0')}`)) reconciliationComplete = false;
    }
    console.log(reconciliationComplete ? 'D-040..D-058 present' : 'D-040..D-058 NOT present');
    return exitFor(verdictOf(fams));
  }));
}
