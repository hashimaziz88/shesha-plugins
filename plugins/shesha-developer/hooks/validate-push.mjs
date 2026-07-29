#!/usr/bin/env node
/**
 * validate-push.mjs — the Phase 2 Task 6 form-push gate.
 *
 * PreToolUse hook on Bash/PowerShell: when the command pushes a form
 * (UpdateMarkup / ImportJson), normalize the markup then validate it, and
 * deny the tool call on a Group A finding, or a Group B finding that
 * SURVIVED normalization (see gate-policy.json for what those groups are
 * and why — a blanket "any Tier 1/2 finding blocks" gate was measured
 * against a 935-form corpus and rejected; see
 * skills/shesha-form-edit/docs/corpus-report.md).
 *
 * Stop hook: if a push this session ended in a still-denied finding with no
 * later passing validation for that same form, block the stop. Conservative
 * by design — any ambiguity (missing log, unreadable entry, unknown session)
 * allows.
 *
 * THE MOST IMPORTANT RULE IN THIS FILE: whenever the markup path or its
 * content cannot be determined, ALLOW and log. A hook that blocks what it
 * cannot parse halts all legitimate work. Every fallible step below
 * (regex miss, file read, JSON.parse, normalize()) fails open.
 *
 * Every exported function here is a pure function of its inputs so the
 * test suite (tests/validate-push.test.mjs) can drive it as "a pure
 * function of its stdin payload" without spawning a child process.
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tier1 } from '../skills/shesha-form-edit/scripts/lib/tier1.mjs';
import { tier2 } from '../skills/shesha-form-edit/scripts/lib/tier2.mjs';
import { normalize } from '../skills/shesha-form-edit/scripts/normalize-form.mjs';

// ---------------------------------------------------------------------------
// Default asset locations — always resolved from THIS FILE via
// ${CLAUDE_PLUGIN_ROOT} at runtime, never a machine-specific absolute path.
// ---------------------------------------------------------------------------

export const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
const FORM_EDIT_ROOT = join(HOOKS_DIR, '../skills/shesha-form-edit');
const DESIGN_SYSTEM_ROOT = join(HOOKS_DIR, '../skills/shesha-design-system');

export const DEFAULT_REGISTRY_PATH = join(FORM_EDIT_ROOT, 'assets/registry/registry-0.45.1.json');
export const DEFAULT_ROLES_PATH = join(DESIGN_SYSTEM_ROOT, 'assets/roles.styles.json');
export const DEFAULT_TOKENS_PATH = join(DESIGN_SYSTEM_ROOT, 'assets/themes/shesha.tokens.json');
export const DEFAULT_POLICY_PATH = join(HOOKS_DIR, 'gate-policy.json');

const MAX_REASON_CHARS = 10000;

function readJson(path, readFn) {
  return JSON.parse(readFn(path, 'utf8'));
}

export function loadDefaultContext(readFn = readFileSync) {
  return {
    registry: readJson(DEFAULT_REGISTRY_PATH, readFn),
    roles: existsSync(DEFAULT_ROLES_PATH) ? readJson(DEFAULT_ROLES_PATH, readFn) : {},
    tokens: existsSync(DEFAULT_TOKENS_PATH) ? readJson(DEFAULT_TOKENS_PATH, readFn) : {},
    policy: readJson(DEFAULT_POLICY_PATH, readFn),
  };
}

// ---------------------------------------------------------------------------
// Step 1 — is this even a form-push command, and if so, which file holds
// the markup?
//
// UpdateMarkup ships the markup wrapped in a DTO string: `curl ... -d
// @body.json` where body.json is `{ id, markup: "<stringified tree>" }`
// (see references/api.md §5) — so the referenced file is NOT the tree
// itself, it must be unwrapped one level.
//
// ImportJson uploads the tree directly as a multipart file field named
// `file`: `curl ... -F "file=@form.json"` (references/api.md §6) — the
// referenced file IS the tree (or a JSON string of it).
// ---------------------------------------------------------------------------

// Quote-aware on purpose: a real path (this worktree's own path included —
// "Documents/Git Repos/...") can contain spaces on Windows. When the path is
// quoted, capture everything up to the matching quote (or, for the -F case,
// up to the ";type=..." suffix curl accepts inside that same quote) so a
// space in the path never truncates the match. The unquoted alternative
// (no spaces possible) is kept as a fallback for simpler commands.
const WRAPPED_FILE_RE = /(?:-d|--data|--data-raw|--data-binary)\s+(?:"@([^"]+)"|'@([^']+)'|@(\S+))/i;
const RAW_FILE_RE = /-F\s+(?:"file=@([^";]+)|'file=@([^';]+)|file=@(\S+))/i;
const INFILE_RE = /-InFile\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;

function firstGroup(match) {
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * @param {string} command
 * @returns {null|{kind:'unknown'}|{kind:'wrapped'|'raw', path:string}}
 *   `null` — not a form-push command at all (no UpdateMarkup/ImportJson keyword).
 *   `{kind:'unknown'}` — a push command, but no file reference could be parsed out of it.
 *   `{kind, path}` — a file reference was found; `kind` says how to unwrap it.
 */
export function extractMarkupRef(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const isUpdateMarkup = /UpdateMarkup/.test(command);
  const isImportJson = /ImportJson/.test(command);
  if (!isUpdateMarkup && !isImportJson) return null;

  if (isImportJson) {
    const path = firstGroup(command.match(RAW_FILE_RE)) ?? firstGroup(command.match(INFILE_RE));
    if (path) return { kind: 'raw', path };
  }
  if (isUpdateMarkup) {
    const path = firstGroup(command.match(WRAPPED_FILE_RE)) ?? firstGroup(command.match(INFILE_RE));
    if (path) return { kind: 'wrapped', path };
  }
  return { kind: 'unknown' };
}

// ---------------------------------------------------------------------------
// Path bug fix (task 8): a Bash/PowerShell command's file reference and cwd
// come from whatever SHELL issued it, not from win32 Node. On this machine
// (and most dev machines running Git Bash as the primary shell), `pwd`
// emits POSIX-style drive paths — "/c/Users/Hashim/..." — and a script that
// derives its markup path from `$(pwd)` inherits that shape. win32 Node's
// own path functions do NOT understand it as the Windows path it actually
// names: `fs.existsSync("/c/Users/...")` resolves the leading "/" against
// the CURRENT drive (producing something like "C:\c\Users\..." — a bogus
// path with a spurious "c" segment) and returns false, while the very same
// location spelled "C:/Users/..." resolves and returns true. Before this
// fix, EVERY push whose path or cwd took this shape silently hit
// loadMarkupTree's error path and fell through to fail-open "skip" — the
// gate was a no-op for the most common case on this machine.
//
// Fix: translate a POSIX-style drive path to its Windows equivalent before
// any path resolution happens. Two shapes are recognised — Git Bash's own
// "/c/..." and WSL's "/mnt/c/..." (which Node on native Windows would
// mis-resolve exactly the same way if it ever saw one). Anything else is
// left untouched: this is a targeted translation, not a general path
// rewriter, and a genuinely unresolvable path must still fall through to
// the existing fail-open behaviour (see loadMarkupTree's own doc comment)
// — that decision is correct and this fix does not change it.
//
// Gated to win32 only: on a real POSIX platform "/c/Users/..." could
// (in principle) be a real absolute path, and this translation would
// corrupt it. The bug this fixes is specific to win32 Node's own path
// resolution, so the fix is scoped the same way.
const GITBASH_DRIVE_RE = /^\/([a-zA-Z])\/(.*)$/;
const WSL_DRIVE_RE = /^\/mnt\/([a-zA-Z])\/(.*)$/;

export function translatePosixDrivePath(p, { platform = process.platform } = {}) {
  if (typeof p !== 'string' || platform !== 'win32') return p;
  const wsl = WSL_DRIVE_RE.exec(p);
  if (wsl) return `${wsl[1].toUpperCase()}:/${wsl[2]}`;
  const gitBash = GITBASH_DRIVE_RE.exec(p);
  if (gitBash) return `${gitBash[1].toUpperCase()}:/${gitBash[2]}`;
  return p;
}

/**
 * Reads and unwraps the markup tree from the referenced file. Every failure
 * mode returns `{ error }` rather than throwing — the caller's job is to
 * treat any `{ error }` result as "cannot determine", which means ALLOW.
 */
export function loadMarkupTree(ref, { cwd = process.cwd(), readFileSync: readFn = readFileSync, platform } = {}) {
  const path = translatePosixDrivePath(ref.path, { platform });
  const resolvedCwd = translatePosixDrivePath(cwd, { platform });
  const abs = isAbsolute(path) ? path : resolve(resolvedCwd, path);
  let raw;
  try {
    raw = readFn(abs, 'utf8');
  } catch (err) {
    return { error: `could not read markup file "${abs}": ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `could not parse "${abs}" as JSON: ${err.message}` };
  }

  if (ref.kind === 'wrapped' && parsed && typeof parsed === 'object' && typeof parsed.markup === 'string') {
    try {
      parsed = JSON.parse(parsed.markup);
    } catch (err) {
      return { error: `could not parse the wrapped "markup" field in "${abs}" as JSON: ${err.message}` };
    }
  } else if (typeof parsed === 'string') {
    // File content was itself a JSON-encoded string (double-encoded) — unwrap once more.
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      return { error: `could not parse double-encoded markup in "${abs}": ${err.message}` };
    }
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.components)) {
    return { error: `"${abs}" does not look like form markup (no components[] array found)` };
  }
  return { tree: parsed, absPath: abs };
}

// ---------------------------------------------------------------------------
// Step 2 — classify findings against the gate policy.
// ---------------------------------------------------------------------------

export function resolveGateMode(env = process.env) {
  const raw = String(env.SHESHA_FORM_GATE ?? 'full').toLowerCase();
  if (raw === 'off' || raw === 'groupa') return raw;
  return 'full'; // default AND explicit "full" AND anything unrecognised
}

function codesInGroup(policy, key) {
  return new Set(Object.keys(policy?.groups?.[key]?.codes ?? {}));
}

/**
 * @returns {{blocking: Finding[], reported: Finding[]}}
 */
export function classifyFindings(findings, policy, gateMode) {
  const groupA = codesInGroup(policy, 'A');
  const groupB = codesInGroup(policy, 'B');
  const blockCodes = gateMode === 'off' ? new Set()
    : gateMode === 'groupa' ? groupA
      : new Set([...groupA, ...groupB]);
  const blocking = findings.filter((f) => blockCodes.has(f.code));
  const reported = findings.filter((f) => !blockCodes.has(f.code));
  return { blocking, reported };
}

// ---------------------------------------------------------------------------
// Step 3 — build the (truncated) reason text and the hook output envelope.
// ---------------------------------------------------------------------------

export function buildReason(blockingFindings, { max = MAX_REASON_CHARS } = {}) {
  const total = blockingFindings.length;
  const header = `${total} blocking form-validation finding(s) (Group A, or Group B that survived normalization):\n`;
  const lines = [];
  let used = header.length;
  let shown = 0;
  for (const f of blockingFindings) {
    const line = `${shown + 1}. [${f.code}] ${f.path} — ${f.message}\n`;
    if (used + line.length > max - 150) break; // leave room for the trailer below
    lines.push(line);
    used += line.length;
    shown += 1;
  }
  let out = header + lines.join('');
  if (shown < total) {
    out += `... and ${total - shown} more finding(s) omitted. Full list in \${CLAUDE_PLUGIN_DATA}/validation-log.jsonl.\n`;
  }
  if (out.length > max) out = `${out.slice(0, max - 3)}...`;
  return out;
}

export function buildOutput(hookEventName, permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision,
      permissionDecisionReason: reason,
      additionalContext: reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Step 4 — logging. Every decision (allow, deny, skip, bypass) is appended.
// "ignore" (not a push command at all) is NOT logged — logging every Bash
// call in every session would make the log useless.
// ---------------------------------------------------------------------------

export function resolveLogPath(env = process.env) {
  const dir = env.CLAUDE_PLUGIN_DATA;
  if (!dir) return null;
  return join(dir, 'validation-log.jsonl');
}

export function appendLog(entry, { env = process.env, appendFn = appendFileSync, mkdirFn = mkdirSync } = {}) {
  const logPath = resolveLogPath(env);
  if (!logPath) return; // no writable data dir known — never let logging block the decision
  try {
    mkdirFn(dirname(logPath), { recursive: true });
    appendFn(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Logging must never be the reason a legitimate push gets blocked or crashes the hook.
  }
}

function baseLogEntry(payload, extra) {
  return {
    ts: new Date().toISOString(),
    sessionId: payload?.session_id ?? null,
    toolName: payload?.tool_name ?? null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — the PreToolUse evaluator. Pure function of (payload, ctx).
// ---------------------------------------------------------------------------

/**
 * @param {object} payload - the PreToolUse stdin payload (session_id, tool_name, tool_input, cwd, ...).
 * @param {object} ctx - { env, readFileSync, cwd, platform, registry, roles, tokens, policy }
 * @returns {{decision: 'ignore'|'bypass'|'skip'|'allow'|'deny', output?: object, logEntry?: object}}
 */
export function evaluatePreToolUse(payload, ctx = {}) {
  const {
    env = process.env,
    readFileSync: readFn = readFileSync,
    cwd = payload?.cwd || process.cwd(),
    platform = process.platform,
    registry,
    roles,
    tokens,
    policy,
  } = ctx;

  const toolName = payload?.tool_name;
  if (toolName !== 'Bash' && toolName !== 'PowerShell') {
    return { decision: 'ignore' };
  }

  const command = payload?.tool_input?.command;

  if (env.SHESHA_SKIP_FORM_VALIDATION === '1') {
    const reason = 'SHESHA_SKIP_FORM_VALIDATION=1 — form-push validation bypassed for this call.';
    return {
      decision: 'bypass',
      output: buildOutput('PreToolUse', 'allow', reason),
      logEntry: baseLogEntry(payload, { decision: 'bypass', command }),
    };
  }

  const ref = extractMarkupRef(command);
  if (!ref) return { decision: 'ignore' }; // not a form-push command at all

  if (ref.kind === 'unknown') {
    return skipResult(payload, command, 'could not determine the markup file path from the command');
  }

  const loaded = loadMarkupTree(ref, { cwd, readFileSync: readFn, platform });
  if (loaded.error) {
    return skipResult(payload, command, loaded.error, ref.path);
  }

  const gateMode = resolveGateMode(env);

  let normalized;
  try {
    normalized = normalize(loaded.tree, { registry, roles, tokens });
  } catch (err) {
    // The normalizer itself throwing is exactly the "cannot determine" case
    // too — we cannot safely validate what we cannot normalize.
    return skipResult(payload, command, `normalizer threw: ${err.message}`, loaded.absPath);
  }

  let t1;
  let t2;
  try {
    t1 = tier1(normalized, { registry });
    const t2Raw = tier2(normalized, { registry, roles });
    t2 = t2Raw.filter((f) => f.severity !== 'skip');
  } catch (err) {
    return skipResult(payload, command, `validator threw: ${err.message}`, loaded.absPath);
  }

  const all = [...t1, ...t2];
  const { blocking, reported } = classifyFindings(all, policy, gateMode);

  if (blocking.length > 0) {
    const reason = buildReason(blocking);
    return {
      decision: 'deny',
      output: buildOutput('PreToolUse', 'deny', reason),
      logEntry: baseLogEntry(payload, {
        decision: 'deny',
        command,
        formPath: loaded.absPath,
        gateMode,
        blockingCount: blocking.length,
        blockingCodes: [...new Set(blocking.map((f) => f.code))],
        reportedCount: reported.length,
      }),
    };
  }

  const reason = `Form-push validation passed (Group A/B gate). ${reported.length} non-blocking finding(s) reported, never block — see the log.`;
  return {
    decision: 'allow',
    output: buildOutput('PreToolUse', 'allow', reason),
    logEntry: baseLogEntry(payload, {
      decision: 'allow',
      command,
      formPath: loaded.absPath,
      gateMode,
      reportedCount: reported.length,
      reportedCodes: [...new Set(reported.map((f) => f.code))],
    }),
  };
}

function skipResult(payload, command, reasonMsg, path) {
  const reason = `Form-push validation skipped: ${reasonMsg}. Allowing (fail-open — an unparseable command must never block legitimate work).`;
  return {
    decision: 'skip',
    output: buildOutput('PreToolUse', 'allow', reason),
    logEntry: baseLogEntry(payload, { decision: 'skip', command, reason: reasonMsg, path: path ?? null }),
  };
}

// ---------------------------------------------------------------------------
// Step 6 — the Stop evaluator. Conservative: any ambiguity allows.
// ---------------------------------------------------------------------------

export function evaluateStop(payload, ctx = {}) {
  const { env = process.env, readFileSync: readFn = readFileSync } = ctx;
  try {
    const logPath = resolveLogPath(env);
    if (!logPath || !existsSync(logPath)) return { decision: 'allow' };

    const lines = readFn(logPath, 'utf8').split('\n').filter((l) => l.trim());
    const lastByForm = new Map();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // an unreadable log line must never make the Stop hook block
      }
      if (entry.sessionId !== payload?.session_id) continue;
      if (!entry.formPath) continue;
      lastByForm.set(entry.formPath, entry); // later lines overwrite earlier ones (chronological order)
    }

    const stillDenied = [...lastByForm.values()].filter((e) => e.decision === 'deny');
    if (stillDenied.length === 0) return { decision: 'allow' };

    const names = stillDenied.map((e) => e.formPath).join(', ');
    const reason = `Form-push validation failed this session with no later passing push for: ${names}. See \${CLAUDE_PLUGIN_DATA}/validation-log.jsonl.`;
    return {
      decision: 'block',
      output: {
        decision: 'block',
        reason: reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 3)}...` : reason,
      },
    };
  } catch {
    return { decision: 'allow' }; // any error here is exactly the "if in doubt, allow" case
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — reads the hook payload from stdin, dispatches on
// hook_event_name, writes the hook JSON to stdout (if any), appends the log
// entry (if any), and always exits 0. A crash in this file must never block
// a tool call — that would be worse than shipping no gate at all.
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let payload;
  try {
    const raw = readStdin();
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.exit(0); // unparseable stdin — say nothing, defer to normal flow
  }

  let result;
  try {
    const ctx = loadDefaultContext();
    if (payload.hook_event_name === 'Stop') {
      result = evaluateStop(payload, { env: process.env });
    } else {
      result = evaluatePreToolUse(payload, { env: process.env, ...ctx });
    }
  } catch {
    process.exit(0); // never let an internal error become a block
  }

  if (result?.logEntry) appendLog(result.logEntry);
  if (result?.output) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  process.exit(0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
