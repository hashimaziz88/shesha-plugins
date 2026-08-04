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
 * <root>, and the ledger path inside it, come from the ONE session-root resolver
 * (../../skills/shesha-form-edit/scripts/lib/session-root.cjs), the same call
 * ledger.mjs makes — so the file this gate reads is provably the file the writer
 * wrote. It is `.cjs` precisely so this hook can require it.
 *
 * Semantics (only ONE fail-open remains):
 *   - no ledger file            -> scan this session's activity log for evidence
 *                                  of form-publishing work (see LOG_EVIDENCE).
 *                                  Evidence without a ledger -> BLOCK; a session
 *                                  must not escape the gate merely by never
 *                                  recording. No evidence (or no log) -> exit 0.
 *   - stale (>12h)              -> BLOCK. A ledger left over from an old session
 *                                  is not evidence that this one delivered.
 *   - malformed / no entries    -> BLOCK. The file is script-owned; a broken one
 *                                  means it was hand-edited or truncated.
 *   - any entry not verified/abandoned -> BLOCK.
 * Honors stop_hook_active to avoid loops. Blocks by exit code 2 + stderr.
 */
const fs = require('fs');
const path = require('path');
const { resolveSessionRoot, ledgerPathFor, sessionLogDir, NS_LEDGER, NS_LOGS } =
  require('../../skills/shesha-form-edit/scripts/lib/session-root.cjs');

const STALE_MS = 12 * 3600 * 1000;
const CLOSED = new Set(['verified', 'abandoned']);

/**
 * Form-publishing evidence in the session activity log (session-logger.cjs writes
 * one line per PostToolUse, command text included). Deliberately narrow: each
 * pattern matches an actual MUTATION, not a mention.
 *   - a real apply-form.mjs publish always carries both --form and --backend;
 *   - the three FormConfiguration write routes.
 */
const LOG_EVIDENCE = [
  [/apply-form\.mjs(?=[^\n]*--form\b)(?=[^\n]*--backend\b)/, 'apply-form.mjs publish'],
  [/FormConfiguration\/(?:Create|UpdateMarkup|ImportJson)/, 'FormConfiguration write call'],
];
/**
 * A command that merely SEARCHES for those strings is not a push. Without this
 * exclusion the gate would block any session that grepped the codebase for the
 * endpoint names — a false BLOCK is as corrosive to the gate as a fail-open.
 */
const LOG_NOT_A_PUSH = /\b(?:grep|rg|ripgrep|Select-String|findstr|ack)\b|--help\b|\bnode --test\b/;

/** First line of evidence, or null. Never throws — an unreadable log is no evidence. */
function scanLogForFormWork(root, sid) {
  if (!sid) return null;
  const dir = sessionLogDir(root, sid);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^log\.\d{8}\.txt$/.test(f));
  } catch {
    return null;
  }
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line || LOG_NOT_A_PUSH.test(line)) continue;
      for (const [re, what] of LOG_EVIDENCE) {
        if (re.test(line)) return { what, line: line.trim().slice(0, 300), file: path.join(dir, f) };
      }
    }
  }
  return null;
}

const HOWTO =
  'Publish through the one atomic path — it records the ledger for you:\n' +
  '      node scripts/apply-form.mjs --file <compiled.json> --form <module>/<name> --backend <url>\n' +
  '  (gates -> record authored -> push -> record pushed -> re-fetch diff -> verified)\n' +
  'To close entries by hand-holding the same steps — never hand-edit push-ledger.json:\n' +
  '  authored -> push it, then:\n' +
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
  const cwd = payload.cwd || process.cwd();
  const root = resolveSessionRoot({ sid, cwd, namespace: NS_LEDGER });
  const ledgerPath = ledgerPathFor(root);

  // No ledger file is not automatically innocence. A session that published a form
  // and skipped the recording would otherwise walk out through the fail-open, so
  // look for the work itself in this session's activity log.
  if (!fs.existsSync(ledgerPath)) {
    const logRoot = resolveSessionRoot({ sid, cwd, namespace: NS_LOGS });
    const evidence = scanLogForFormWork(logRoot, sid);
    if (!evidence) return 0; // no ledger AND no logged form work — nothing to gate.
    return block(
      'this session published form work but never recorded it in the push ledger.',
      `Evidence (${evidence.what}) in ${evidence.file}:\n  ${evidence.line}\n\n` +
      'Re-publish through scripts/apply-form.mjs (it records and verifies in one path), or record ' +
      'and close the form by hand, then confirm with: node scripts/ledger.mjs verify',
      ledgerPath
    );
  }

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
