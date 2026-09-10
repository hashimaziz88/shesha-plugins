// §4.3.1 rule 5 / §4.8 row 4: every hook file returns only exit 0 (decision on
// stdout) or 2 (stdout unwritable). exit(1) is banned — a non-2 non-zero exit is a
// silent non-block in Claude Code (the tool proceeds, the model never learns why).
// Every hook wired in .claude/settings.json must exist, and every <name>.decide.mjs
// must have a <name>.mjs runner (the runner/decide split that keeps decide pure).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-hook-contract';
export const describe = 'hooks exit only 0 or 2 (exit(1) banned); every wired hook exists; runners split decide; every tool the harness dispatches is a tool its decide module gates on';
export const inputPaths = ['.claude/hooks', '.claude/settings.json', 'packages/verify/test/fixtures/run/hooks.jsonl'];

const HOOKS = '.claude/hooks';
/** Committed subject, so tool-coverage walks > 0 on a clean checkout (live logs are gitignored). */
const LOG_FIXTURE = 'packages/verify/test/fixtures/run/hooks.jsonl';

/**
 * The tool names a decide module gates on: every string literal compared against
 * `payload.tool_name`, whether by `name === 'X'`, `name !== 'X'`, or a `[...]` set the
 * module tests with `.includes(name)`. Read off the source because the alternative is
 * trusting a comment.
 * @param {string} src @returns {Set<string>}
 */
function gatedTools(src) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of src.matchAll(/name\s*(?:===|!==)\s*'([A-Za-z0-9_]+)'/g)) if (m[1]) out.add(m[1]);
  for (const m of src.matchAll(/const\s+[A-Z_]*TOOLS[A-Z_]*\s*=\s*\[([^\]]*)\]/g)) {
    for (const q of String(m[1] ?? '').matchAll(/'([A-Za-z0-9_]+)'/g)) if (q[1]) out.add(q[1]);
  }
  return out;
}

/**
 * Tool names and dispatched roles observed per hook in a hooks.jsonl decision log.
 * @param {string} text @returns {{tools:Map<string, Set<string>>, roles:Map<string, Set<string>>}}
 */
function observedTools(text) {
  /** @type {Map<string, Set<string>>} */
  const byHook = new Map();
  /** @type {Map<string, Set<string>>} */
  const roleByHook = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    const hook = row && typeof row.hook === 'string' ? row.hook : null;
    const tool = row && typeof row.tool === 'string' ? row.tool : null;
    if (!hook) continue;
    if (typeof row.role === 'string' && row.role) {
      if (!roleByHook.has(hook)) roleByHook.set(hook, new Set());
      /** @type {Set<string>} */ (roleByHook.get(hook)).add(row.role);
    }
    if (!tool) continue;
    // SessionStart is an event, not a tool call, and gates nothing.
    if (tool === 'SessionStart') continue;
    if (!byHook.has(hook)) byHook.set(hook, new Set());
    /** @type {Set<string>} */ (byHook.get(hook)).add(tool);
  }
  return { tools: byHook, roles: roleByHook };
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'exit-codes', unit: 'file' },
    { name: 'wiring', unit: 'hook' },
    { name: 'decide-split', unit: 'file' },
    { name: 'tool-coverage', unit: 'hook' },
    { name: 'role-coverage', unit: 'hook' },
  ]);

  const dir = path.join(root, HOOKS);
  const mjs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')) : [];

  // exit-codes: no process.exit(1) / exitCode = 1 in ANY hook file.
  const exitFam = fams.get('exit-codes');
  for (const n of mjs) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8');
    exitFam.pointer(`${HOOKS}/${n}`).assert(
      !/process\.exit\(\s*1\s*\)|(?:process\.)?exitCode\s*=\s*1\b/.test(text),
      `${n} contains a banned exit(1)/exitCode=1; a non-2 non-zero exit is a silent non-block (§4.3.1 rule 5)`);
  }

  // wiring: every command "node .claude/hooks/X.mjs" in settings.json resolves.
  const wireFam = fams.get('wiring');
  const settingsPath = path.join(root, '.claude/settings.json');
  let settings = /** @type {any} */ (null);
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* handled below */ }
  if (!settings) {
    wireFam.pointer('.claude/settings.json').fail('.claude/settings.json is missing or unparseable');
  } else {
    const commands = [];
    for (const group of Object.values(settings.hooks || {})) {
      for (const entry of /** @type {any[]} */ (group) || []) {
        for (const h of entry.hooks || []) if (typeof h.command === 'string') commands.push(h.command);
      }
    }
    if (commands.length === 0) wireFam.pointer('.claude/settings.json#hooks').fail('no hooks are wired');
    for (const cmd of commands) {
      const m = /node\s+(\.claude\/hooks\/[A-Za-z0-9._-]+\.mjs)/.exec(cmd);
      const wp = wireFam.pointer(cmd.slice(0, 60));
      const hookRel = m && m[1];
      if (!hookRel) { wp.fail(`hook command is not "node .claude/hooks/<x>.mjs": ${cmd}`); continue; }
      wp.assert(fs.existsSync(path.join(root, hookRel)), `wired hook ${hookRel} does not exist`);
    }
  }

  // decide-split: every <name>.decide.mjs has a <name>.mjs runner beside it.
  const splitFam = fams.get('decide-split');
  const decides = mjs.filter((n) => n.endsWith('.decide.mjs'));
  if (decides.length === 0) splitFam.pointer(`${HOOKS}#decide`).check();
  for (const d of decides) {
    const runner = d.replace(/\.decide\.mjs$/, '.mjs');
    splitFam.pointer(`${HOOKS}/${d}`).assert(mjs.includes(runner), `${d} has no ${runner} runner (the runner/decide split)`);
  }

  // tool-coverage: a hook the harness invokes with a tool its decide module does not
  // gate on is INERT — it fires, returns its no-op rule, and enforces nothing. WP-11
  // found gate-dispatch that way. The decision log is the only ground truth for what
  // the harness actually sends, so it is the subject: the fixture guarantees coverage,
  // and any live log (gitignored, richer) is checked too.
  const toolFam = fams.get('tool-coverage');
  /** @type {string[]} */
  const logs = [LOG_FIXTURE, '.claude/hooks.jsonl'];
  /** @type {Map<string, Set<string>>} */
  const observed = new Map();
  /** @type {Map<string, Set<string>>} */
  const observedRoles = new Map();
  let sawLog = false;
  for (const rel of logs) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch {
      toolFam.pointer(rel).fail(`hook log ${rel} exists but could not be read`);
      continue;
    }
    sawLog = true;
    const seen = observedTools(text);
    for (const [hook, tools] of seen.tools) {
      if (!observed.has(hook)) observed.set(hook, new Set());
      for (const t of tools) /** @type {Set<string>} */ (observed.get(hook)).add(t);
    }
    for (const [hook, roles] of seen.roles) {
      if (!observedRoles.has(hook)) observedRoles.set(hook, new Set());
      for (const r of roles) /** @type {Set<string>} */ (observedRoles.get(hook)).add(r);
    }
  }
  if (!sawLog) {
    toolFam.pointer(LOG_FIXTURE).fail(
      `no hook decision log is readable (${logs.join(', ')}), so whether any hook is inert cannot be known`);
  }
  for (const [hook, tools] of observed) {
    const decideRel = `${HOOKS}/${hook}.decide.mjs`;
    const p = toolFam.pointer(decideRel);
    const abs = path.join(root, decideRel);
    if (!fs.existsSync(abs)) {
      p.fail(`${hook} appears in a decision log but ${decideRel} does not exist`);
      continue;
    }
    const gated = gatedTools(fs.readFileSync(abs, 'utf8'));
    const blind = [...tools].filter((t) => !gated.has(t));
    p.assert(blind.length === 0,
      `${hook} was invoked with ${blind.map((t) => `"${t}"`).join(', ')} but ${path.basename(decideRel)} gates only on ${[...gated].map((t) => `"${t}"`).join(', ') || '(nothing)'} — it fires and enforces nothing`);
  }

  // role-coverage: the same argument one level down, and behavioural rather than
  // textual. A dispatch gate handed `shesha-developer:sfs-evaluator` while its role list
  // holds the bare `sfs-evaluator` is inert, and no amount of reading its source proves
  // otherwise. So: ask the module what rule it returns for a tool it cannot know
  // (its no-op rule), then ask it again with exactly what the harness was observed to
  // send. A gate that answers the same both times is not gating.
  const roleFam = fams.get('role-coverage');
  if (observedRoles.size === 0) {
    roleFam.pointer(LOG_FIXTURE).fail(
      'no decision-log row records a dispatched subagent role, so the gated role set cannot be held against reality');
  }
  for (const [hook, roles] of observedRoles) {
    const decideRel = `${HOOKS}/${hook}.decide.mjs`;
    const p = roleFam.pointer(decideRel);
    const abs = path.join(root, decideRel);
    if (!fs.existsSync(abs)) {
      p.fail(`${hook} recorded a dispatched role but ${decideRel} does not exist`);
      continue;
    }
    /** @type {any} */
    let mod = null;
    // Keyed by content hash: the mutation harness reuses one tmp path, so importing
    // by bare URL would serve a cached instance of the file it just rewrote.
    const stamp = createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
    try { mod = await import(`${pathToFileURL(abs).href}?h=${stamp}`); } catch (e) {
      p.fail(`${decideRel} does not import: ${String(/** @type {Error} */ (e).message).slice(0, 120)}`);
      continue;
    }
    if (typeof mod.decide !== 'function') { p.fail(`${decideRel} exports no decide()`); continue; }
    const dctx = { root, fs, spawnNode: () => ({ status: 0, stdout: '{}' }) };
    /** @param {any} payload */
    const ruleOf = (payload) => { try { return String((mod.decide(payload, dctx) || {}).rule ?? ''); } catch { return '<threw>'; } };
    // The no-op rule: what it answers for a tool name it has no business gating.
    const noop = ruleOf({ tool_name: '__not_a_tool__', tool_input: {} });
    const tools = [...(observed.get(hook) || new Set(['Task']))];
    for (const role of roles) {
      for (const tool of tools) {
        const rule = ruleOf({ tool_name: tool, tool_input: { subagent_type: role, prompt: '' } });
        p.assert(rule !== noop,
          `${hook} answers rule "${rule}" for a ${tool} dispatch of "${role}" — the same rule it returns for a tool it does not gate, so every rule below it is unreachable`);
      }
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a hook returns exit(1), the silent-non-block defect',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, HOOKS, 'block-form-writes.mjs');
      // Build the banned call so this gate's own source never contains the literal
      // it forbids (g-exit-codes greps for it).
      const banned = `process.${'exit'}(${1});`;
      fs.appendFileSync(f, `\nif (false) ${banned}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'gate-dispatch stops gating the tool name the harness actually sends, going inert',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, HOOKS, 'gate-dispatch.decide.mjs');
      const src = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, src.replace("['Task', 'Agent']", "['Task']"));
    },
    expect: 'fail',
  },
  {
    name: 'gate-dispatch stops normalising a <plugin>:<role> name, going inert on every real dispatch',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, HOOKS, 'gate-dispatch.decide.mjs');
      const src = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, src.replace('return i === -1 ? t : t.slice(i + 1);', 'return t;'));
    },
    expect: 'fail',
  },
  {
    name: 'a wired hook command points at a hook that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, '.claude/settings.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.hooks.PreToolUse[0].hooks[0].command = 'node .claude/hooks/ghost.mjs';
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
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
