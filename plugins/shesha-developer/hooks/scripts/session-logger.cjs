#!/usr/bin/env node
/**
 * Session activity logger (permanent feature).
 * Appends one timestamped line per hook event to:
 *   <root>/.claude-designer-logs/logs/<session_id>/log.<DDMMYYYY>.txt
 * where <root> is resolved ONCE per session (git toplevel of the first-seen
 * cwd, falling back to that cwd, falling back to process.cwd()) and then
 * pinned via a pointer file in the OS tmpdir so every later event in the
 * same session — regardless of which directory a tool happened to run in —
 * lands in the same log tree.
 * Fires on SessionStart, UserPromptSubmit, PostToolUse, Stop.
 * Never blocks — logging failures are swallowed and it always exits 0.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// High-frequency, low-value tools we don't want to log on every call.
const SKIP_TOOLS = new Set(['TodoWrite', 'TaskList', 'TaskGet', 'ToolSearch']);

function oneLine(s, max) {
  if (s == null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

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

function resolveRoot(sid, cwd) {
  const pointerFile = path.join(os.tmpdir(), `claude-designer-logs-${sid}.root`);
  try {
    const existing = fs.readFileSync(pointerFile, 'utf8').trim();
    if (existing) return existing;
  } catch { /* no pointer yet */ }

  let root = gitToplevel(cwd) || cwd || process.cwd();
  try {
    fs.writeFileSync(pointerFile, root, 'utf8');
  } catch { /* best effort — fall through and still use computed root */ }
  return root;
}

// Defensively pull an error/failure signal out of a tool_response payload.
function extractToolFailure(p) {
  const tr = p.tool_response;
  if (tr == null) return null;

  // Common shapes: { error: "..." }, { is_error: true, ... }
  if (typeof tr === 'object') {
    if (tr.is_error === true || tr.isError === true) {
      return oneLine(tr.error || tr.message || JSON.stringify(tr), 200);
    }
    if (tr.error) {
      return oneLine(tr.error, 200);
    }
    // Bash-like tools: exitCode / exit_code non-zero.
    const exitCode = tr.exitCode ?? tr.exit_code;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return oneLine(tr.stderr || tr.message || `exitCode=${exitCode}`, 200);
    }
  }

  // Top-level fallbacks some hook payloads may use.
  if (p.is_error === true || p.isError === true) {
    return oneLine(p.error || 'tool reported an error', 200);
  }

  return null;
}

// Defensively pull whatever usage/cost fields exist off a Stop payload.
function extractUsage(p) {
  const out = {};
  if (p.usage != null) out.usage = p.usage;
  if (p.cost_usd != null) out.cost_usd = p.cost_usd;
  if (p.total_cost_usd != null) out.total_cost_usd = p.total_cost_usd;
  if (p.tokens != null) out.tokens = p.tokens;
  if (p.total_tokens != null) out.total_tokens = p.total_tokens;
  if (p.duration_ms != null) out.duration_ms = p.duration_ms;
  if (p.num_turns != null) out.num_turns = p.num_turns;
  return Object.keys(out).length ? out : null;
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return 0; }
  let p;
  try { p = JSON.parse(raw); } catch { return 0; }

  const event = p.hook_event_name || 'Event';
  const toolName = p.tool_name || '';

  // Fast exit for high-frequency, low-value PostToolUse events.
  if (event === 'PostToolUse' && SKIP_TOOLS.has(toolName)) {
    return 0;
  }

  const rawCwd = p.cwd || process.cwd();
  const sid = (p.session_id || 'unknown-session').replace(/[^A-Za-z0-9._-]/g, '_');
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  let root;
  try {
    root = resolveRoot(sid, rawCwd);
  } catch {
    root = rawCwd;
  }

  let prefix = event;
  let detail = event;

  if (event === 'UserPromptSubmit') {
    detail = `PROMPT: ${oneLine(p.prompt, 600)}`;
  } else if (event === 'PostToolUse' || event === 'PreToolUse') {
    const ti = p.tool_input || {};
    const failure = event === 'PostToolUse' ? extractToolFailure(p) : null;
    detail = `TOOL ${toolName || '?'}`;
    if (ti.file_path || ti.path) detail += ` ${ti.file_path || ti.path}`;
    else if (ti.command) detail += ` $ ${oneLine(ti.command, 220)}`;
    else if (ti.skill) detail += ` skill:${ti.skill}`;
    else if (ti.description) detail += ` ${oneLine(ti.description, 120)}`;

    if (failure) {
      prefix = 'TOOL-FAIL';
      detail += ` ERROR: ${failure}`;
    }
  } else if (event === 'SessionStart') {
    detail = `SESSION START (source=${p.source || ''}, cwd=${rawCwd})`;
  } else if (event === 'Stop') {
    detail = 'SESSION STOP';
  }

  const dir = path.join(root, '.claude-designer-logs', 'logs', sid);
  const file = path.join(dir, `log.${dd}${mm}${yyyy}.txt`);
  const line = `[${now.toISOString()}] ${prefix.padEnd(16)} ${detail}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, line, 'utf8');

    if (event === 'Stop') {
      const usage = extractUsage(p);
      const usageLine = usage
        ? `[${now.toISOString()}] USAGE           ${JSON.stringify(usage)}\n`
        : `[${now.toISOString()}] USAGE           none-reported\n`;
      fs.appendFileSync(file, usageLine, 'utf8');
    }
  } catch { /* logging must never break the session */ }
  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
