#!/usr/bin/env node
/**
 * ledger.mjs — the ONLY writer of the session push ledger.
 *
 *   <root>/.claude/cache/shesha-form-edit/push-ledger.json
 *
 * The Stop-time persistence gate (hooks/scripts/hook-verify-push.cjs) reads this
 * file and blocks session end while any entry is neither `verified` nor
 * `abandoned`. That gate only has a mechanical floor if the ledger is written by
 * a script instead of hand-typed JSON — so never edit the file directly, always
 * go through this CLI.
 *
 * Subcommands
 *   record --form <module>/<name> --id <guid> --status authored|pushed [--note <s>]
 *   update --form <module>/<name> --status pushed|verified|abandoned [--id <guid>] [--note <s>]
 *   verify                       exit 0 when every entry is verified/abandoned, else 1
 *   path                         print the resolved ledger path (diagnostics/tests)
 *
 * Root resolution mirrors hooks/scripts/session-logger.cjs: the git toplevel of
 * cwd is computed ONCE and pinned via a tmpdir pointer file keyed by
 * CLAUDE_SESSION_ID, so every later call in the same session lands on the same
 * ledger regardless of which directory it ran from. With no session id, it falls
 * back to the plain git toplevel, then to cwd. The hook duplicates this logic.
 *
 * Writes are atomic (tmp file + rename) so a concurrent reader never sees a
 * half-written ledger — a truncated ledger is a BLOCK, not a shrug.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const POINTER_PREFIX = 'shesha-push-ledger-';
const RECORD_STATUSES = new Set(['authored', 'pushed']);
const UPDATE_STATUSES = new Set(['pushed', 'verified', 'abandoned']);
const CLOSED_STATUSES = new Set(['verified', 'abandoned']);

const USAGE = `Usage:
  node scripts/ledger.mjs record --form <module>/<name> --id <guid> --status authored|pushed [--note <s>]
  node scripts/ledger.mjs update --form <module>/<name> --status pushed|verified|abandoned [--id <guid>] [--note <s>]
  node scripts/ledger.mjs verify
  node scripts/ledger.mjs path`;

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

function sanitizeSid(sid) {
  return String(sid).replace(/[^A-Za-z0-9._-]/g, '_');
}

function resolveRoot(cwd = process.cwd()) {
  const rawSid = process.env.CLAUDE_SESSION_ID;
  const sid = rawSid ? sanitizeSid(rawSid) : null;
  const pointerFile = sid ? path.join(os.tmpdir(), `${POINTER_PREFIX}${sid}.root`) : null;

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

function ledgerPath() {
  return path.join(resolveRoot(), '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json');
}

function readLedger(file) {
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`push-ledger.json is not valid JSON (${e.message}).\n` +
      `It is script-owned — do not hand-edit it. Delete it and re-record:\n  ${file}`);
  }
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) {
    fail(`push-ledger.json has no entries array — it was hand-written or truncated:\n  ${file}`);
  }
  return { version: 1, entries };
}

function writeLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function fail(msg) {
  console.error(`[ledger] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`unexpected argument "${a}"\n${USAGE}`);
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`--${key} needs a value\n${USAGE}`);
    out[key] = value;
    i++;
  }
  return out;
}

function requireForm(args) {
  const form = args.form;
  if (!form) fail(`--form <module>/<name> is required\n${USAGE}`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(form)) {
    fail(`--form must be "<module>/<name>" (got "${form}")`);
  }
  return form;
}

function cmdRecord(args) {
  const form = requireForm(args);
  const id = args.id;
  const status = args.status;
  if (!id) fail(`--id <guid> is required for record (the form id returned by Create/GetByName)\n${USAGE}`);
  if (!RECORD_STATUSES.has(status)) {
    fail(`record --status must be one of: ${[...RECORD_STATUSES].join(', ')} (got "${status || ''}")`);
  }

  const file = ledgerPath();
  const ledger = readLedger(file);
  const entry = {
    form,
    id,
    status,
    ...(args.note ? { note: args.note } : {}),
    updatedAt: new Date().toISOString(),
  };
  const at = ledger.entries.findIndex((e) => e && e.form === form);
  if (at >= 0) ledger.entries[at] = { ...ledger.entries[at], ...entry };
  else ledger.entries.push(entry);

  writeLedger(file, ledger);
  console.log(`[ledger] ${form} -> ${status} (id=${id})\n[ledger] ${file}`);
  return 0;
}

function cmdUpdate(args) {
  const form = requireForm(args);
  const status = args.status;
  if (!UPDATE_STATUSES.has(status)) {
    fail(`update --status must be one of: ${[...UPDATE_STATUSES].join(', ')} (got "${status || ''}")`);
  }
  if (status === 'abandoned' && !args.note) {
    fail('--note <reason> is required when abandoning a form (it goes in the session summary too)');
  }

  const file = ledgerPath();
  const ledger = readLedger(file);
  const at = ledger.entries.findIndex((e) => e && e.form === form);
  if (at < 0) {
    fail(`no ledger entry for "${form}" — record it first:\n` +
      `  node scripts/ledger.mjs record --form ${form} --id <guid> --status pushed`);
  }

  ledger.entries[at] = {
    ...ledger.entries[at],
    status,
    ...(args.id ? { id: args.id } : {}),
    ...(args.note ? { note: args.note } : {}),
    updatedAt: new Date().toISOString(),
  };

  writeLedger(file, ledger);
  console.log(`[ledger] ${form} -> ${status}\n[ledger] ${file}`);
  return 0;
}

function cmdVerify() {
  const file = ledgerPath();
  if (!fs.existsSync(file)) {
    console.log('[ledger] no ledger for this session — no form work recorded. OK.');
    return 0;
  }
  const ledger = readLedger(file);
  const open = ledger.entries.filter((e) => !e || !CLOSED_STATUSES.has(e.status));
  if (!open.length) {
    console.log(`[ledger] ${ledger.entries.length} entr${ledger.entries.length === 1 ? 'y' : 'ies'}, all verified/abandoned. OK.`);
    return 0;
  }
  console.error('[ledger] OPEN ENTRIES — a validated file on disk is not a delivered form:');
  for (const e of open) {
    console.error(`  - ${(e && e.form) || '?'} (${(e && e.id) || 'no id'}): status=${(e && e.status) || 'missing'}`);
  }
  console.error(
    'Close each one:\n' +
    '  authored -> push it, then: node scripts/ledger.mjs update --form <m>/<n> --status pushed\n' +
    '  pushed   -> re-fetch + diff, then: node scripts/ledger.mjs update --form <m>/<n> --status verified\n' +
    '  dropped  -> node scripts/ledger.mjs update --form <m>/<n> --status abandoned --note "<reason>"'
  );
  return 1;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'record': return cmdRecord(parseArgs(rest));
    case 'update': return cmdUpdate(parseArgs(rest));
    case 'verify': return cmdVerify();
    case 'path': console.log(ledgerPath()); return 0;
    case undefined:
    case '-h':
    case '--help': console.log(USAGE); return 0;
    default: fail(`unknown subcommand "${cmd}"\n${USAGE}`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
