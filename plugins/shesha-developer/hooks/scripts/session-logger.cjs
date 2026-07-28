#!/usr/bin/env node
/**
 * Session activity logger — OPT-IN, metadata-only by default.
 *
 * Disabled unless SHESHA_SESSION_LOG is set. Two levels:
 *
 *   SHESHA_SESSION_LOG=metadata   event name, tool name, file paths, timestamps.
 *                                 No prompt text. No command strings.
 *   SHESHA_SESSION_LOG=full       additionally records prompt text and shell
 *                                 commands, truncated and credential-redacted.
 *
 * Any other value (including "1"/"true") is treated as "metadata" — the safe
 * reading of an ambiguous opt-in.
 *
 * Output goes to the session workdir, resolved in this order:
 *   SHESHA_SESSION_LOG_DIR, CLAUDE_PROJECT_DIR/.claude/cache, TMPDIR/TEMP/TMP,
 *   then os.tmpdir(). It is NEVER written to process.cwd() — an earlier version
 *   did, which scattered .claude-designer-logs/ directories through the repo and
 *   any directory a script happened to run from.
 *
 * RETENTION. These logs are developer-local diagnostics, not an audit trail.
 * Nothing prunes them, so treat them as disposable: they live under a temp or
 * cache directory, one file per session per day, and may be deleted at any time.
 * At "full" they contain prompt text and command lines — request bodies, file
 * paths and argument values — so on a shared or recorded machine prefer
 * "metadata", and delete the log directory when a debugging session ends.
 * Redaction below is a safety net for accidental secrets, not a guarantee: it
 * pattern-matches known credential shapes and will not catch every secret a
 * prompt might contain.
 *
 * Never blocks — logging failures are swallowed and it always exits 0.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEVEL_OFF = 'off';
const LEVEL_METADATA = 'metadata';
const LEVEL_FULL = 'full';

function level() {
  const raw = process.env.SHESHA_SESSION_LOG;
  if (raw == null || raw === '' || /^(0|false|off|no)$/i.test(raw)) return LEVEL_OFF;
  return /^full$/i.test(raw) ? LEVEL_FULL : LEVEL_METADATA;
}

// Credential shapes that must never reach a log file. Applied to any free text
// recorded at "full" — prompts and command strings.
const REDACTIONS = [
  // bearer / authorization headers
  [/\b(authorization|proxy-authorization)\s*[:=]\s*\S+/gi, '$1: [REDACTED]'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'bearer [REDACTED]'],
  // JWTs anywhere, even unlabelled
  [/\beyJ[A-Za-z0-9._-]{10,}/g, '[REDACTED-JWT]'],
  // key=value and "key": "value" forms for secret-ish names
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|connection[_-]?string)\b(\s*[:=]\s*|"\s*:\s*")("[^"]*"|'[^']*'|\S+)/gi,
    (_m, k, sep) => `${k}${sep.includes('"') ? '"' : sep}[REDACTED]`],
  // CLI credential flags
  [/(--(?:password|token|secret|api-key|apikey)(?:=|\s+))\S+/gi, '$1[REDACTED]'],
  // basic-auth in URLs
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@'],
];

function redact(s) {
  let out = String(s);
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

function oneLine(s, max) {
  if (s == null) return '';
  const t = redact(String(s)).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// Resolve a writable directory that is never the user's project tree or cwd.
function logRoot() {
  const explicit = process.env.SHESHA_SESSION_LOG_DIR;
  if (explicit) return explicit;
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) return path.join(projectDir, '.claude', 'cache', 'shesha-session-logs');
  const tmp = process.env.TMPDIR || process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(tmp, 'shesha-session-logs');
}

function main() {
  const lvl = level();
  if (lvl === LEVEL_OFF) return 0;

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return 0; }
  let p;
  try { p = JSON.parse(raw); } catch { return 0; }

  const sid = (p.session_id || 'unknown-session').replace(/[^A-Za-z0-9._-]/g, '_');
  const event = p.hook_event_name || 'Event';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  // Metadata level: shape of the activity only — never its content.
  let detail = event;
  if (event === 'UserPromptSubmit') {
    detail = lvl === LEVEL_FULL
      ? `PROMPT: ${oneLine(p.prompt, 600)}`
      : `PROMPT (${String(p.prompt ?? '').length} chars)`;
  } else if (event === 'PostToolUse' || event === 'PreToolUse') {
    const ti = p.tool_input || {};
    detail = `TOOL ${p.tool_name || '?'}`;
    if (ti.file_path || ti.path) detail += ` ${ti.file_path || ti.path}`;
    else if (ti.skill) detail += ` skill:${ti.skill}`;
    else if (ti.command) {
      detail += lvl === LEVEL_FULL
        ? ` $ ${oneLine(ti.command, 220)}`
        : ` $ (${String(ti.command).length} chars)`;
    } else if (ti.description && lvl === LEVEL_FULL) detail += ` ${oneLine(ti.description, 120)}`;
  } else if (event === 'SessionStart') {
    detail = `SESSION START (source=${p.source || ''}, level=${lvl})`;
  } else if (event === 'Stop') {
    detail = 'SESSION STOP';
  }

  const dir = path.join(logRoot(), sid);
  const file = path.join(dir, `log.${dd}${mm}${yyyy}.txt`);
  const line = `[${now.toISOString()}] ${event.padEnd(16)} ${detail}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
  } catch { /* logging must never break the session */ }
  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
