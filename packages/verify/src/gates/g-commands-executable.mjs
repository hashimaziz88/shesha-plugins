// D-012: no documented command in this repository is unexecutable.
//
// The named defect: a `summarize.js` that died at line 15 on every call, invoked
// from two documented places, for as long as it existed. Nothing noticed, because
// nothing ever ran it. This gate runs the resolution that a reader would have to
// perform by hand, over every command form in every instruction file.
//
// It resolves `node <path>` with the interpreter ALREADY RUNNING this gate
// (process.execPath) rather than a bare `node`, so a machine where node is
// installed but not on PATH — this one, via fnm — cannot make the gate silently
// vacuous.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  families, readJsonGuarded, verdictOf, report, exitFor, runGuarded,
} from '@shesha/registry/coverage';
import { ARCHIVE_PATH } from '@shesha/registry/decisions';
import { listFiles, readText, rel, repoRoot } from '../lib/fsx.mjs';
import { completedWps } from '../lib/session-state.mjs';

export const id = 'g-commands-executable';
export const describe = 'every documented node/npm-run/mcp command resolves to something that exists and parses';
export const inputPaths = [
  'packages/verify/config/command-floor.json',
  'CLAUDE.md',
  'BACKLOG.md',
  'DECISIONS.md',
  'docs/decisions-archive.md',
  'package.json',
  'plugins',
  // Targets that documented commands resolve against.
  'packages/verify/src',
  'packages/verify/test',
  'packages/registry/src',
  'packages/sfs/bin',
  'packages/mcp/src/index.mjs',
];

/**
 * The files that are prompt payload. `docs/**` is explicitly outside scope
 * (D-043): the brief is not instruction payload and its command examples are
 * illustrative.
 *
 * `docs/decisions-archive.md` is the one exception, and it is not an exception to
 * D-043 at all: it is the decision registry's other half (D-075), not the brief.
 * Archiving a row moves it out of the prompt, so it must not also move that row's
 * acceptance command out of this gate's reach — that would let the floor drain by
 * archiving rather than by deleting a command.
 * @param {string} root
 * @returns {string[]} repo-relative paths
 */
function scanSet(root) {
  /** @type {string[]} */
  const out = [];
  for (const name of ['CLAUDE.md', 'DECISIONS.md', 'BACKLOG.md', ARCHIVE_PATH]) {
    if (fs.existsSync(path.join(root, name))) out.push(name);
  }
  const plugins = path.join(root, 'plugins');
  if (fs.existsSync(plugins)) {
    for (const f of listFiles(plugins, { ext: ['.md'] })) {
      const r = rel(root, f);
      if (r.includes('/shesha-developer-0-43/')) continue; // frozen; gates skip it
      out.push(r);
    }
  }
  return out;
}

/**
 * A placeholder is a documented variable, not a path: `<SKILL_ROOT>/x.mjs`,
 * `SKILL_ROOT/x.mjs`, `$RUN_DIR/x`, `.../x`. Those are unresolvable BY DESIGN and
 * are counted separately rather than failed — but a placeholder standing in for a
 * file that no longer exists anywhere is still a dead command, so the gate
 * requires the basename to exist somewhere in the repo.
 * @param {string} p
 * @returns {boolean}
 */
function hasPlaceholder(p) {
  return /<[^>]+>|\$[A-Z_]+|\.\.\.|\{[^}]+\}/.test(p) || /^[A-Z_]+\//.test(p);
}

/**
 * @param {string} root
 * @param {string} base
 * @returns {boolean} whether any file with this basename exists in the repo
 */
function basenameExistsSomewhere(root, base) {
  for (const dir of ['packages', 'plugins', 'quarantine', '.claude', '.githooks']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    if (listFiles(abs).some((f) => path.basename(f) === base)) return true;
  }
  return fs.existsSync(path.join(root, base));
}

/**
 * `node --check` through the running interpreter.
 * @param {string} file
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
function nodeChecks(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (e) {
    const err = /** @type {{stderr?:Buffer}} */ (e);
    const stderr = err.stderr ? err.stderr.toString().split('\n')[0] : 'unknown parse error';
    return { ok: false, reason: stderr };
  }
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'node-commands', unit: 'command' },
    { name: 'npm-commands', unit: 'command' },
    { name: 'mcp-tools', unit: 'reference' },
    { name: 'floor', unit: 'assertion' },
    { name: 'waiver-expiry', unit: 'waiver' },
  ]);

  const nodeFam = fams.get('node-commands');
  const npmFam = fams.get('npm-commands');
  const mcpFam = fams.get('mcp-tools');
  const floorFam = fams.get('floor');

  // Root scripts, for resolving `npm run <script>`.
  const pkgGot = readJsonGuarded(path.join(root, 'package.json'), floorFam, 'package.json');
  /** @type {Record<string,string>} */
  const scripts = pkgGot.ok
    ? (/** @type {{scripts?:Record<string,string>}} */ (pkgGot.value).scripts || {})
    : {};

  // The MCP tool surface, for resolving `mcp__<server>__<tool>`.
  /** @type {Set<string>} */
  const mcpTools = new Set();
  const toolsPath = path.join(root, 'packages/mcp/src/index.mjs');
  if (fs.existsSync(toolsPath)) {
    const text = readText(toolsPath) || '';
    for (const m of text.matchAll(/'([a-z_][a-z0-9_]*)'/g)) mcpTools.add(m[1]);
  }

  // Carried debt: a documented command that is dead for a reason this session did
  // not create. Each is dated to the WP or BL id that removes it (D-063). This is
  // not a skip list — the list is published, and `waiver-expiry` fails once the
  // owning id is recorded complete while the command is still dead.
  const floorCfgText = readText(path.join(root, 'packages/verify/config/command-floor.json'));
  /** @type {{path:string, command:string, until:string, decision:string}[]} */
  let commandWaivers = [];
  /** @type {string[]} */
  let externalServers = [];
  try {
    const parsedFloor = JSON.parse(floorCfgText || '{}');
    commandWaivers = parsedFloor.waivers || [];
    externalServers = parsedFloor.externalMcpServers || [];
  } catch { commandWaivers = []; }
  /**
   * @param {string} relPath
   * @param {string} command
   * @returns {{until:string, decision:string}|null}
   */
  const waivedCommand = (relPath, command) => {
    const hit = commandWaivers.find((w) => w.path === relPath && command.includes(w.command));
    return hit ? { until: hit.until, decision: hit.decision } : null;
  };

  let nodeCount = 0;
  let npmCount = 0;
  let mcpCount = 0;

  for (const relPath of scanSet(root)) {
    const text = readText(path.join(root, relPath));
    if (text === null) continue;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const where = `${relPath}:${i + 1}`;

      // A BACKLOG row's Acceptance cell is the DEFINITION OF DONE for work that
      // has not happened, so its target does not exist yet by construction. Those
      // commands are disposed notApplicable naming the row id — they still print,
      // and they become live the moment the row leaves BACKLOG.md.
      const backlogRow = relPath === 'BACKLOG.md' ? /^\|\s*((?:BL|GAP|PROM)-[0-9a-z]{3})\s*\|/.exec(line) : null;

      // ---- form 1: node <path> --------------------------------------------
      for (const m of line.matchAll(/\bnode\s+([^\s`'"]+\.(?:mjs|js|cjs))/g)) {
        const target = m[1];
        const p = nodeFam.pointer(`${where} node ${target}`);
        nodeCount++;
        if (backlogRow) {
          p.na(`acceptance command for ${backlogRow[1]}, which is out of scope now (D-051)`);
          continue;
        }
        const waived = waivedCommand(relPath, `node ${target}`);
        if (waived) {
          p.na(`carried dead command, removed by ${waived.until} under ${waived.decision}`);
          continue;
        }
        if (hasPlaceholder(target)) {
          const base = path.basename(target);
          p.assert(basenameExistsSomewhere(root, base),
            `documents "node ${target}", whose target "${base}" exists nowhere in the repo — a dead command (D-012)`);
          continue;
        }
        const abs = path.join(root, target);
        if (!fs.existsSync(abs)) {
          p.fail(`documents "node ${target}" but that path does not exist (D-012)`);
          continue;
        }
        const checked = nodeChecks(abs);
        p.assert(checked.ok, checked.ok ? '' : `"node ${target}" does not parse: ${checked.reason}`);
      }

      // ---- form 2: npm run <script> ---------------------------------------
      for (const m of line.matchAll(/\bnpm\s+run\s+([a-z][a-z0-9:_-]*)/g)) {
        const script = m[1];
        const p = npmFam.pointer(`${where} npm run ${script}`);
        npmCount++;
        if (backlogRow) {
          p.na(`acceptance command for ${backlogRow[1]}, which is out of scope now (D-051)`);
          continue;
        }
        if (!(script in scripts)) {
          // A skill instructs work inside the DEVELOPER'S Shesha project as well as
          // in this repo, and `npm run dev` there is not this repo's script. The
          // distinction is undecidable from the text, so a plugins/** script that is
          // not ours is disposed notApplicable with that reason rather than failed.
          // `node <path>` stays strict everywhere — that is the summarize.js class.
          if (relPath.startsWith('plugins/')) {
            p.na(`"npm run ${script}" is not a script of this repo; a skill may be instructing the developer's own project`);
          } else {
            p.fail(`documents "npm run ${script}" but package.json declares no such script (D-012)`);
          }
          continue;
        }
        // The script's target file must exist and parse, or the script is a
        // documented command that dies on invocation.
        const target = /(?:^|\s)(packages\/[^\s"']+\.mjs)/.exec(scripts[script]);
        if (!target) { p.check(); continue; }
        const abs = path.join(root, target[1]);
        if (!fs.existsSync(abs)) {
          p.fail(`"npm run ${script}" runs ${target[1]}, which does not exist`);
          continue;
        }
        const checked = nodeChecks(abs);
        p.assert(checked.ok, checked.ok ? '' : `"npm run ${script}" runs ${target[1]}, which does not parse: ${checked.reason}`);
      }

      // ---- form 3: mcp__<server>__<tool> ----------------------------------
      for (const m of line.matchAll(/\bmcp__([a-z0-9-]+)__([a-z0-9_]+)/g)) {
        const [, server, tool] = m;
        const p = mcpFam.pointer(`${where} mcp__${server}__${tool}`);
        mcpCount++;
        if (backlogRow) {
          p.na(`acceptance command for ${backlogRow[1]}, which is out of scope now (D-051)`);
          continue;
        }
        // Only THIS repo's server can be resolved against its own tool list. A
        // third-party server's tool surface is not defined here, so claiming to
        // check it would present an unmeasurable as measured. What IS checkable is
        // that the server is one the repo declares it depends on — that catches a
        // typo'd or invented server name, and it keeps the family evaluating
        // something rather than disposing its whole population as not-applicable.
        if (!/^shesha/.test(server)) {
          p.assert(externalServers.includes(server),
            `references mcp__${server}__${tool}, but "${server}" is not in externalMcpServers in command-floor.json. ` +
            'Its tool surface cannot be verified here; the server name can.');
          continue;
        }
        const mcpWaived = waivedCommand(relPath, `mcp__${server}__${tool}`);
        if (mcpWaived) {
          p.na(`carried dead reference, removed by ${mcpWaived.until} under ${mcpWaived.decision}`);
          continue;
        }
        p.assert(mcpTools.has(tool),
          `references mcp__${server}__${tool}, which is not in packages/mcp's exported tool list (BL-008 ships the server)`);
      }
    }
  }

  // ---- the floor: the family must stay populated ----------------------------
  const floorGot = readJsonGuarded(path.join(root, 'packages/verify/config/command-floor.json'), floorFam, 'command-floor.json');
  const total = nodeCount + npmCount + mcpCount;
  if (floorGot.ok) {
    const cfg = /** @type {{floor:number}} */ (floorGot.value);
    floorFam.pointer('command-floor').assert(total >= cfg.floor,
      `${total} documented command(s) against a floor of ${cfg.floor}. ` +
      'The floor ratchets up: a gate whose population drains to zero reports pass over nothing.');
  }

  // ---- waiver expiry: carried debt cannot outlive its owning WP -------------
  const wFam = fams.get('waiver-expiry');
  const done = completedWps(root);
  if (commandWaivers.length === 0) {
    wFam.pointer('command-waivers#none').check();
  } else {
    for (const w of commandWaivers) {
      const p = wFam.pointer(`${w.path}: ${w.command}`);
      const problems = [];
      if (!/^(WP|BL)-[0-9a-z]{1,3}$/.test(w.until || '')) problems.push('has no WP or BL id in `until`');
      if (!/^D-\d{3}$/.test(w.decision || '')) problems.push('has no D-0NN decision authorising it');
      if (w.until && done.has(w.until) && fs.existsSync(path.join(root, w.path))) {
        problems.push(`${w.until} is recorded complete in BUILD-LOG.md but ${w.path} still carries the dead command`);
      }
      if (problems.length) p.fail(`waiver for ${w.command}: ${problems.join('; ')}`);
      else p.check(3);
    }
  }

  // Every family must walk something, or the gate is vacuous. An empty MCP or
  // node population is declared not-applicable with its reason, never skipped.
  if (nodeCount === 0) nodeFam.pointer('node-commands#none').na('no `node <path>` command is documented anywhere in the scan set');
  if (npmCount === 0) npmFam.pointer('npm-commands#none').na('no `npm run <script>` command is documented anywhere in the scan set');
  if (mcpCount === 0) mcpFam.pointer('mcp-tools#none').na('no mcp__ tool reference exists in the scan set (BL-008 introduces them)');

  return fams.list;
}

/**
 * Write the measured floor. Ratchets UP only.
 * @param {string} root
 * @returns {Promise<number>}
 */
async function baseline(root) {
  const fams = await run({ repoRoot: root });
  const byName = new Map(fams.map((f) => [f.name, f]));
  const counts = {
    node: byName.get('node-commands')?.walked ?? 0,
    npm: byName.get('npm-commands')?.walked ?? 0,
    mcp: byName.get('mcp-tools')?.walked ?? 0,
  };
  const file = path.join(root, 'packages/verify/config/command-floor.json');
  const existing = JSON.parse(readText(file) || '{"floor":0}');
  const total = counts.node + counts.npm + counts.mcp;
  if (total < (existing.floor || 0)) {
    console.error(`g-commands-executable --baseline: REFUSED to lower the floor from ${existing.floor} to ${total}. ` +
      'A shrinking command population needs a DECISIONS row, not a quieter gate.');
    return 1;
  }
  // Preserve the carried-debt list: --baseline measures the floor, it does not
  // adjudicate waivers. Dropping them here silently un-waived them and turned
  // three declared, dated debts back into failures.
  fs.writeFileSync(file, `${JSON.stringify({
    _comment: existing._comment,
    floor: total,
    measuredAt: 'WP-0',
    byForm: counts,
    externalMcpServers: existing.externalMcpServers || [],
    waivers: existing.waivers || [],
  }, null, 2)}\n`);
  console.log(`g-commands-executable --baseline: floor ${total} (node ${counts.node} · npm ${counts.npm} · mcp ${counts.mcp})`);
  return 0;
}

export const mutations = [
  {
    name: 'a documented node command points at a path that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.appendFileSync(path.join(tmp, 'BACKLOG.md'),
        '\nRun `node packages/verify/src/does-not-exist.mjs` to check.\n');
    },
    expect: 'fail',
  },
  {
    name: 'a documented npm script is not declared in package.json',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      fs.appendFileSync(path.join(tmp, 'BACKLOG.md'), '\nRun `npm run summarize` first.\n');
    },
    expect: 'fail',
  },
  {
    name: 'a documented node command points at a file that does not parse',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const broken = path.join(tmp, 'packages/verify/src/broken.mjs');
      fs.mkdirSync(path.dirname(broken), { recursive: true });
      fs.writeFileSync(broken, 'export function oops( {\n');
      fs.appendFileSync(path.join(tmp, 'BACKLOG.md'), '\nRun `node packages/verify/src/broken.mjs`.\n');
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  if (process.argv.includes('--baseline')) process.exit(await baseline(root));
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    const byName = new Map(fams.map((f) => [f.name, f]));
    const a = byName.get('node-commands')?.walked ?? 0;
    const b = byName.get('npm-commands')?.walked ?? 0;
    const c = byName.get('mcp-tools')?.walked ?? 0;
    const unresolvable = fams.reduce((n, f) => n + f.failures.length, 0);
    console.log(`\nnode ${a} · npm ${b} · mcp ${c} · unresolvable ${unresolvable} · floor ${a + b + c}`);
    return exitFor(verdictOf(fams));
  }));
}
