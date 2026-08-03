#!/usr/bin/env node
/**
 * Stop hook: persistence gate. Reads the session push ledger
 *   <root>/.claude/cache/shesha-form-edit/push-ledger.json
 * written EXCLUSIVELY by skills/shesha-form-edit/scripts/ledger.mjs. If the
 * ledger records authored forms that were never pushed, or pushed forms never
 * verified by re-fetch, block the stop and tell Claude exactly what to run. This
 * mechanically kills the "validated file on disk, nothing on the backend,
 * exit 0" failure class.
 *
 * <root> is resolved with the same pinned-pointer logic as ledger.mjs and
 * session-logger.cjs (git toplevel of cwd, pinned in a tmpdir pointer file keyed
 * by session id) — duplicated here on purpose: hooks stay dependency-free, and
 * ledger.mjs is ESM.
 *
 * Semantics (only ONE fail-open remains):
 *   - no ledger file            -> exit 0. The session did no form work.
 *   - stale (>12h)              -> BLOCK. A ledger left over from an old session
 *                                  is not evidence that this one delivered.
 *   - malformed / no entries    -> BLOCK. The file is script-owned; a broken one
 *                                  means it was hand-edited or truncated.
 *   - any entry not verified/abandoned -> BLOCK.
 * Honors stop_hook_active to avoid loops. Blocks by exit code 2 + stderr.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const POINTER_PREFIX = 'shesha-push-ledger-';
const STALE_MS = 12 * 3600 * 1000;
const CLOSED = new Set(['verified', 'abandoned']);

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

// Mirror of ledger.mjs resolveRoot(): pointer file only when a session id exists.
function resolveRoot(sid, cwd) {
  const pointerFile = sid
    ? path.join(os.tmpdir(), `${POINTER_PREFIX}${String(sid).replace(/[^A-Za-z0-9._-]/g, '_')}.root`)
    : null;
  if (pointerFile) {
    try {
      const existing = fs.readFileSync(pointerFile, 'utf8').trim();
      if (existing) return existing;
    } catch { /* no pointer yet */ }
  }
  const root = gitToplevel(cwd) || cwd || process.cwd();
  if (pointerFile) {
    try { fs.writeFileSync(pointerFile, root, 'utf8'); } catch { /* best effort */ }
  }
  return root;
}

const HOWTO =
  'Close every entry through the script — never hand-edit push-ledger.json:\n' +
  '  authored -> push it (Create/UpdateMarkup), then:\n' +
  '      node scripts/ledger.mjs update --form <module>/<name> --status pushed\n' +
  '  pushed   -> re-fetch + diff the markup, then:\n' +
  '      node scripts/ledger.mjs update --form <module>/<name> --status verified\n' +
  '  genuinely dropped ->\n' +
  '      node scripts/ledger.mjs update --form <module>/<name> --status abandoned --note "<reason>"\n' +
  '  (run from the shesha-form-edit skill dir; confirm with: node scripts/ledger.mjs verify)';

function block(headline, detail, ledgerPath) {
  console.error(
    `[shesha hook] PERSISTENCE GATE: ${headline}\n${detail ? `${detail}\n` : ''}\n` +
    `A validated local file is not a delivered form.\n${HOWTO}\nLedger: ${ledgerPath}`
  );
  return 2;
}

function main() {
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fall through */ }
  if (payload.stop_hook_active) return 0;

  const sid = process.env.CLAUDE_SESSION_ID || payload.session_id || null;
  const root = resolveRoot(sid, payload.cwd || process.cwd());
  const ledgerPath = path.join(root, '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json');

  // The ONE remaining fail-open: no ledger at all means this session recorded no
  // form work, so there is nothing to gate.
  if (!fs.existsSync(ledgerPath)) return 0;

  if (Date.now() - fs.statSync(ledgerPath).mtimeMs > STALE_MS) {
    return block(
      'the push ledger is stale (>12h old) — it cannot vouch for this session.',
      'Re-verify each form still listed in it (re-fetch + diff) and close the entries, or abandon them with a reason.',
      ledgerPath
    );
  }

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    return block(
      `the push ledger is not valid JSON (${e.message}).`,
      'It is written only by scripts/ledger.mjs — a broken file means it was hand-edited or truncated. Delete it and re-record the forms this session actually pushed.',
      ledgerPath
    );
  }

  const entries = Array.isArray(ledger) ? ledger : ledger && ledger.entries;
  if (!Array.isArray(entries)) {
    return block('the push ledger has no entries array (hand-written or truncated).',
      'Delete it and re-record via scripts/ledger.mjs.', ledgerPath);
  }
  if (!entries.length) {
    return block('the push ledger exists but records no entries.',
      'scripts/ledger.mjs never writes an empty ledger — this file was hand-made. Delete it and record each form you pushed.',
      ledgerPath);
  }

  const open = entries.filter((e) => !e || typeof e !== 'object' || !CLOSED.has(e.status));
  if (!open.length) return 0;

  const lines = open.map((e) => {
    const form = (e && (e.form || e.name)) || '?';
    const id = (e && e.id) || 'no id';
    const status = (e && e.status) || 'missing';
    const note = e && e.note ? ` — ${e.note}` : '';
    return `- ${form} (${id}): status=${status}${note}`;
  });
  return block('the push ledger shows form work that never landed (or was never verified) on the backend:',
    lines.join('\n'), ledgerPath);
}

// Top-level guard for I/O unrelated to ledger CONTENT (e.g. git unavailable, so no
// root can be resolved). Ledger-content problems block inside main() and are not
// swallowed here.
let code;
try { code = main(); } catch { code = 0; }
process.exit(code);
