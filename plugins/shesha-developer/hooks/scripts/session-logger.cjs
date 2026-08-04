#!/usr/bin/env node
/**
 * Session activity logger (permanent feature).
 * Appends one timestamped line per hook event to:
 *   <root>/.claude-designer-logs/logs/<session_id>/log.<DDMMYYYY>.txt
 * <root> and that path both come from the ONE session-root resolver,
 * ../../skills/shesha-form-edit/scripts/lib/session-root.cjs (git toplevel of the
 * first-seen cwd, pinned per session in a tmpdir pointer file, so every later
 * event lands in the same tree no matter which directory a tool ran in). The
 * require path is relative to this file and stable inside the plugin tree.
 * Fires on SessionStart, UserPromptSubmit, PostToolUse, Stop.
 * Never blocks — logging failures are swallowed and it always exits 0.
 */
const fs = require('fs');
const path = require('path');
const { resolveSessionRoot, sessionLogDir, NS_LOGS } =
  require('../../skills/shesha-form-edit/scripts/lib/session-root.cjs');

// High-frequency, low-value tools we don't want to log on every call.
// NOTE: browser tools (playwright/chrome MCP) must NEVER be added here — the
// Stop-time BROWSER telemetry counts them off these very log lines.
const SKIP_TOOLS = new Set(['TodoWrite', 'TaskList', 'TaskGet', 'ToolSearch']);

// Browser-cost telemetry [one browser boot per verify cycle]. Counted off the
// session's own log lines, which already carry the tool name and the command.
// Matched against the TOOL NAME only. Covers the playwright MCP, the generic
// *_Browser_* tools, and the chrome-driving MCPs (whose names say "chrome", not
// "browser").
const BROWSER_TOOL_RE = /playwright|browser|chrome|puppeteer/i;
const INSTRUMENT_RE = /render-instrument/;

function oneLine(s, max) {
  if (s == null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
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

/**
 * Browser-cost telemetry for the Stop line. Reads the session's OWN log tree
 * (every log.DDMMYYYY.txt under <root>/.claude-designer-logs/logs/<sid>/) and
 * counts, off the already-written PostToolUse lines:
 *   - instrument-boots: Bash/PowerShell calls running scripts/render-instrument.js
 *     (one call = one Chromium launch, even in --forms batch mode)
 *   - mcp-calls: interactive browser/playwright MCP tool calls
 * A high mcp-calls count next to a green instrument boot is the waste this
 * measurement exists to make visible. Returns null when nothing is readable.
 */
function countBrowserActivity(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^log\.\d{8}\.txt$/.test(f));
  } catch {
    return null;
  }
  if (!files.length) return null;

  const LINE_RE = /^\[[^\]]*\]\s+(\S+)\s+TOOL\s+(\S+)(.*)$/;
  let instrumentBoots = 0;
  let mcpCalls = 0;
  let read = 0;
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    read++;
    for (const line of content.split('\n')) {
      const m = LINE_RE.exec(line);
      if (!m) continue;
      const [, prefix, toolName, rest] = m;
      if (prefix !== 'PostToolUse' && prefix !== 'TOOL-FAIL') continue;
      if (BROWSER_TOOL_RE.test(toolName)) mcpCalls++;
      else if (INSTRUMENT_RE.test(rest)) instrumentBoots++;
    }
  }
  if (!read) return null;
  return { instrumentBoots, mcpCalls };
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
    root = resolveSessionRoot({ sid, cwd: rawCwd, namespace: NS_LOGS });
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

  const dir = sessionLogDir(root, sid);
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

      const browser = countBrowserActivity(dir);
      const browserLine = browser
        ? `[${now.toISOString()}] BROWSER         ${browser.instrumentBoots} instrument-boots, ${browser.mcpCalls} mcp-calls\n`
        : `[${now.toISOString()}] BROWSER         unknown\n`;
      fs.appendFileSync(file, browserLine, 'utf8');
    }
  } catch { /* logging must never break the session */ }
  return 0;
}

try { process.exit(main()); } catch { process.exit(0); }
