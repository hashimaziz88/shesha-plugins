/**
 * session-root.cjs — THE session-root resolver. One implementation, three callers.
 *
 * `git rev-parse --show-toplevel` appears exactly ONCE in this plugin, here. Three
 * independent copies (ledger.mjs, hook-verify-push.cjs, session-logger.cjs) meant
 * three possible answers the day a worktree, submodule or an unusual cwd is
 * involved — and the ledger the hook reads must be the ledger the writer wrote.
 *
 * CommonJS on purpose: the two hooks are `.cjs` run standalone by the hook harness
 * and cannot `import` an `.mjs`, while ESM callers (`ledger.mjs`) reach a `.cjs`
 * through `createRequire`. The hooks resolve it by a path relative to their own
 * file (`hooks/scripts` → `../../skills/shesha-form-edit/scripts/lib/`), which is
 * stable because both ship inside the same plugin directory and Node resolves
 * `require` against the requiring file, never against cwd.
 *
 * Root resolution: a per-session pointer file in the OS tmpdir pins the answer, so
 * every later call in the same session lands on the same root regardless of which
 * directory the tool happened to run in. Namespaces keep the ledger pointer and the
 * log pointer independent (they were introduced separately and are keyed
 * differently); without a session id there is no pointer and the plain git toplevel
 * (then cwd) is used.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

/** Pointer namespaces — one per consumer, so neither can clobber the other. */
const NS_LEDGER = 'shesha-push-ledger';
const NS_LOGS = 'claude-designer-logs';

/** Ledger location, derived from a root. Both the writer and the Stop hook use this. */
const LEDGER_RELPATH = ['.claude', 'cache', 'shesha-form-edit', 'push-ledger.json'];
/** Session activity log tree, derived from a root + sanitized session id. */
const LOG_RELPATH = ['.claude-designer-logs', 'logs'];

function gitToplevel(cwd) {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const t = String(out).trim();
    return t || null;
  } catch {
    return null;
  }
}

function sanitizeSessionId(sid) {
  return String(sid).replace(/[^A-Za-z0-9._-]/g, '_');
}

function pointerFile(namespace, sid) {
  return path.join(os.tmpdir(), `${namespace}-${sanitizeSessionId(sid)}.root`);
}

/**
 * @param {{sid?: string|null, cwd?: string, namespace?: string}} [opts]
 * @returns {string} absolute session root
 */
function resolveSessionRoot(opts = {}) {
  const { sid = null, cwd = process.cwd(), namespace = NS_LEDGER } = opts;
  const pointer = sid ? pointerFile(namespace, sid) : null;

  if (pointer) {
    try {
      const existing = fs.readFileSync(pointer, 'utf8').trim();
      if (existing) return existing;
    } catch { /* no pointer yet */ }
  }

  const root = gitToplevel(cwd) || cwd || process.cwd();
  if (pointer) {
    try { fs.writeFileSync(pointer, root, 'utf8'); } catch { /* best effort */ }
  }
  return root;
}

/** The push ledger for a root — the single definition of where it lives. */
function ledgerPathFor(root) {
  return path.join(root, ...LEDGER_RELPATH);
}

/** The session activity log directory for a root + session id. */
function sessionLogDir(root, sid) {
  return path.join(root, ...LOG_RELPATH, sanitizeSessionId(sid));
}

module.exports = {
  NS_LEDGER,
  NS_LOGS,
  gitToplevel,
  sanitizeSessionId,
  pointerFile,
  resolveSessionRoot,
  ledgerPathFor,
  sessionLogDir,
};
