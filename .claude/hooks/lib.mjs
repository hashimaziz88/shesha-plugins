// Shared hook primitives (§4.3.1). Hooks import only node:*, this file, and their
// own <hook>.decide.mjs — zero external deps, so a hook cannot fail because npm ci
// was skipped. decide(payload, ctx) is pure over an injected ctx, so hooks.test runs
// it in-process against a temp root with no child process and no Node cold start.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Walk up from `start` for a package.json whose name is "shesha-plugins". Fail
 * closed: not found returns null and the caller denies HOOK-0001.
 * @param {string} [start]
 * @returns {string|null}
 */
export function findRepoRoot(start) {
  let dir = start || process.cwd();
  for (let i = 0; i < 64; i += 1) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (j && j.name === 'shesha-plugins') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Anchored glob match. Paths are normalised to `/`; `*` matches [^/]* and never
 * crosses `/`; `**` matches anything including `/`; `?` is unsupported and throws.
 * @param {string} pattern @param {string} p @returns {boolean}
 */
export function matchGlob(pattern, p) {
  if (pattern.includes('?')) throw new Error('matchGlob: ? unsupported');
  const norm = String(p).replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern.charAt(i);
    if (c === '*') {
      if (pattern.charAt(i + 1) === '*') { re += '.*'; i += 1; } else re += '[^/]*';
    } else if ('.+^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`).test(norm);
}

/**
 * Every path-shaped token in a Bash command (§4.3.3), plus redirect targets.
 * @param {string} command @returns {string[]}
 */
export function bashPaths(command) {
  const cmd = String(command || '');
  /** @type {string[]} */
  const out = [];
  for (const m of cmd.matchAll(/[A-Za-z0-9_./\\-]+\.(?:json|mjs|js|md|png)\b/g)) out.push(m[0]);
  for (const m of cmd.matchAll(/(?:>>?|\btee)\s+([A-Za-z0-9_./\\-]+)/g)) if (m[1]) out.push(m[1]);
  return out;
}

/**
 * The paths a payload touches, by tool_name (§4.3.3 extraction table).
 * @param {{tool_name?:string, tool_input?:any}} payload @returns {string[]}
 */
export function payloadPaths(payload) {
  const name = payload.tool_name;
  const input = payload.tool_input || {};
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit' || name === 'Read') {
    return typeof input.file_path === 'string' ? [input.file_path] : [];
  }
  if (name === 'Bash') return bashPaths(input.command);
  return [];
}

/** The active run id (§4.10 pt12), or null. @param {string} root @returns {string|null} */
export function activeRunId(root) {
  const p = path.join(root, '.build/active-run');
  try { const s = fs.readFileSync(p, 'utf8').trim(); return s || null; } catch { return null; }
}

/**
 * Open lock files for a run, parsed. Never throws.
 * @param {string} root @param {string|null} runId
 * @returns {{screen:string, role:string, at?:string, path:string, mtimeMs:number}[]}
 */
export function openLocks(root, runId) {
  if (!runId) return [];
  const dir = path.join(root, 'runs', runId, 'locks');
  /** @type {{screen:string, role:string, at?:string, path:string, mtimeMs:number}[]} */
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.lock')) continue;
    const full = path.join(dir, n);
    try {
      const j = JSON.parse(fs.readFileSync(full, 'utf8'));
      const st = fs.statSync(full);
      out.push({ screen: j.screen, role: j.role, at: j.at, path: full, mtimeMs: st.mtimeMs });
    } catch { /* a malformed lock is ignored, not a crash */ }
  }
  return out;
}

/** Run a repo bin as a child process (validation etc.). @param {string} root @param {string[]} argv @param {any} [opts] */
export function spawnNode(root, argv, opts = {}) {
  return spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', shell: false, timeout: 30000, ...opts });
}

/** PreToolUse allow/deny envelope (§4.3.3). @param {'allow'|'deny'} decision @param {string} code @param {string} reason */
export function preToolUse(decision, code, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision === 'deny' ? 'deny' : 'allow',
      permissionDecisionReason: `${code} ${reason}`.trim(),
    },
  };
}

/**
 * Append one decision to hooks.jsonl; a logging failure never changes the decision.
 * @param {string} root @param {string|null} runId @param {Record<string, unknown>} entry
 */
export function logDecision(root, runId, entry) {
  const target = runId ? path.join(root, 'runs', runId, 'hooks.jsonl') : path.join(root, '.claude/hooks.jsonl');
  try { fs.appendFileSync(target, `${JSON.stringify(entry)}\n`); } catch { /* never blocks */ }
}

/**
 * Read one PreToolUse/PostToolUse payload from stdin (a runner helper).
 * @returns {Promise<any>}
 */
export function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    process.stdin.on('error', () => resolve({}));
  });
}

/**
 * Print the hook output and exit 0; if stdout is unwritable, write the reason to
 * stderr and exit 2. exit(1) is banned in every hook (§4.3.1 rule 5).
 * @param {any} out @param {string} [reasonForStderr]
 */
export function emit(out, reasonForStderr) {
  try {
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(0);
  } catch {
    try { process.stderr.write(`${reasonForStderr || 'hook stdout unwritable'}\n`); } catch { /* nothing left to do */ }
    process.exit(2);
  }
}
