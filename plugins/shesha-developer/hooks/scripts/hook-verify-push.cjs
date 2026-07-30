#!/usr/bin/env node
/**
 * Stop hook: persistence gate. Reads the session push ledger
 * (.claude/cache/shesha-form-edit/push-ledger.json, written by the skill at
 * Steps 5/7/8). If the ledger records authored forms that were never pushed,
 * or pushed forms never verified by re-fetch, block the stop and tell Claude
 * exactly what is outstanding. This mechanically kills the
 * "validated file on disk, nothing on the backend, exit 0" failure class.
 *
 * Fails open: no ledger / stale ledger (>12h) / parse errors → allow stop.
 * Honors stop_hook_active to avoid loops.
 */
const fs = require('fs');
const path = require('path');

function main() {
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fall through */ }
  if (payload.stop_hook_active) return 0;

  const ledgerPath = path.join(process.cwd(), '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json');
  if (!fs.existsSync(ledgerPath)) return 0;
  if (Date.now() - fs.statSync(ledgerPath).mtimeMs > 12 * 3600 * 1000) return 0;

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch { return 0; }
  const entries = Array.isArray(ledger) ? ledger : ledger.entries || [];
  if (!entries.length) return 0;

  const open = entries.filter((e) => e && e.status && e.status !== 'verified' && e.status !== 'abandoned');
  if (!open.length) return 0;

  const lines = open.map((e) => `- ${e.module || '?'}/${e.form || e.name || '?'} (${e.id || 'no id'}): status=${e.status}`);
  console.error(
    `[shesha hook] PERSISTENCE GATE: the push ledger shows form work that never landed (or was never verified) on the backend:\n${lines.join('\n')}\n\n` +
    `A validated local file is not a delivered form. Before finishing:\n` +
    `1. status=authored → run Step 7 (push) for each form;\n` +
    `2. status=pushed → run Step 8 (re-fetch + diff) and set status=verified;\n` +
    `3. genuinely abandoned work → set status=abandoned with a reason, and say so in the summary.\n` +
    `Ledger: ${ledgerPath}`
  );
  return 2;
}

try { process.exit(main()); } catch { process.exit(0); }
