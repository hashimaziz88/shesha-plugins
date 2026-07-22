#!/usr/bin/env node
/**
 * Session activity logger (permanent feature).
 * Appends one timestamped line per hook event to:
 *   <cwd>/.claude-designer-logs/logs/<session_id>/log.<DDMMYYYY>.txt
 * Fires on SessionStart, UserPromptSubmit, PostToolUse, Stop.
 * Never blocks — logging failures are swallowed and it always exits 0.
 */
const fs = require('fs');
const path = require('path');

function oneLine(s, max) {
  if (s == null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return 0; }
  let p;
  try { p = JSON.parse(raw); } catch { return 0; }

  const cwd = p.cwd || process.cwd();
  const sid = (p.session_id || 'unknown-session').replace(/[^A-Za-z0-9._-]/g, '_');
  const event = p.hook_event_name || 'Event';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  let detail = event;
  if (event === 'UserPromptSubmit') {
    detail = `PROMPT: ${oneLine(p.prompt, 600)}`;
  } else if (event === 'PostToolUse' || event === 'PreToolUse') {
    const ti = p.tool_input || {};
    detail = `TOOL ${p.tool_name || '?'}`;
    if (ti.file_path || ti.path) detail += ` ${ti.file_path || ti.path}`;
    else if (ti.command) detail += ` $ ${oneLine(ti.command, 220)}`;
    else if (ti.skill) detail += ` skill:${ti.skill}`;
    else if (ti.description) detail += ` ${oneLine(ti.description, 120)}`;
  } else if (event === 'SessionStart') {
    detail = `SESSION START (source=${p.source || ''}, cwd=${cwd})`;
  } else if (event === 'Stop') {
    detail = 'SESSION STOP';
  }

  const dir = path.join(cwd, '.claude-designer-logs', 'logs', sid);
  const file = path.join(dir, `log.${dd}${mm}${yyyy}.txt`);
  const line = `[${now.toISOString()}] ${event.padEnd(16)} ${detail}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
  } catch { /* logging must never break the session */ }
  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
