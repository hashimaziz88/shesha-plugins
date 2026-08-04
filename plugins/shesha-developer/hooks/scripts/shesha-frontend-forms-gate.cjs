#!/usr/bin/env node
/**
 * Hooks for the shesha-frontend-forms skill. One script, two events.
 *
 *   PostToolUse (Write|Edit)  a form-markup file was written -> run the offline gates
 *   Stop                      a session is ending -> run the ledger gate, FAIL CLOSED
 *
 * SCOPING MATTERS MORE THAN THE GATES DO. This plugin is shared with the older designer
 * skills, so a hook that fires broadly would block sessions that never touched a form. Both
 * paths therefore start by proving the session is in scope, and pass silently when it is not:
 *
 *   PostToolUse only acts on a file that PARSES as Shesha form markup.
 *   Stop only acts when a session pointer exists, which push writes at `authored` — before
 *   any write, so a session killed mid-push is still detectable.
 *
 * FAIL CLOSED means the Stop gate blocks on open work, on a terminal claim whose artefact has
 * vanished, on a malformed ledger, and on an absent ledger when the pointer says forms were
 * authored. The previous stack's version failed OPEN on every one of those — a missing
 * ledger, a stale one, and a parse error all allowed the stop — which is the same as having
 * no gate.
 *
 * DELIBERATELY ABSENT: any capture of user prompts or command lines. The old session logger
 * wrote 600 characters of every prompt and 220 of every shell command, unredacted, on by
 * default, into the working directory — and one of those files still contains a SQL Server
 * connection string with a plaintext password. Nothing here logs input.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const SKILL_DIR = join(__dirname, '..', '..', 'skills', 'shesha-frontend-forms');
const CLI = join(SKILL_DIR, 'scripts', 'shesha.mjs');

/**
 * Hook input arrives as JSON on stdin.
 *
 * An unparseable payload is reported as such rather than becoming `{}`. Returning an empty
 * object made the dispatcher see no event name and pass silently — an inability to read the
 * input presenting as an all-clear, which is the exact opposite of fail-closed.
 */
function readInput() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return { __unreadable: 'stdin could not be read' };
  }
  if (!raw.trim()) return { __unreadable: 'stdin was empty' };
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { __unreadable: `stdin was not valid JSON: ${(e && e.message) || e}` };
  }
}

/** Allow the session to continue, saying nothing. */
function pass() {
  process.exit(0);
}

/**
 * Block, with the reason and the exact command to resolve it.
 * Exit code 2 is what tells the harness to surface this to the model.
 */
function block(lines) {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(2);
}

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout || '',
      stderr: e.stderr || (e.message || ''),
    };
  }
}

/** Does this file look like a Shesha form markup document? Parse it; never guess by name. */
function isFormMarkup(path) {
  if (!path || !/\.json$/i.test(path) || !existsSync(path)) return false;
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.length > 4 * 1024 * 1024) return false;
    const j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    const doc = typeof j.markup === 'string' ? JSON.parse(j.markup) : j.markup && typeof j.markup === 'object' ? j.markup : j;
    return !!doc && Array.isArray(doc.components) && !!doc.formSettings;
  } catch {
    return false;
  }
}

function onPostToolUse(input) {
  const p = input.tool_input || {};
  const path = p.file_path || p.filePath || p.path;
  if (!isFormMarkup(path)) pass();

  // No --app, so this is the fast offline pass: structural, rules, bindings, dead-channel.
  // The round-trip gate needs the app's framework and runs in `check`/`push` proper.
  const r = runCli(['check', '--file', path, '--fast']);
  if (r.code === 0) pass();

  block([
    `[shesha-frontend-forms] the form markup written to ${path} FAILED the offline gates.`,
    '',
    r.stdout.trim() || r.stderr.trim(),
    '',
    'Fix the markup, or run the full chain for the round-trip gate too:',
    `  node "${CLI}" check --file "${path}" --app <path-to-shesha-app>`,
  ]);
}

function onStop(input) {
  /**
   * Look for the pointer in every plausible working directory.
   *
   * `input.cwd` cannot be trusted to be resolvable: a POSIX-style path from a bash harness
   * does not exist as far as Windows `existsSync` is concerned, and taking it verbatim made
   * this gate conclude "this session published nothing" when it simply could not find the
   * file. Fail-closed means an inability to tell must never present as an all-clear.
   */
  const candidates = [];
  for (const c of [input.cwd, process.cwd()]) {
    if (typeof c === 'string' && c && !candidates.includes(c)) candidates.push(c);
  }
  let pointer = null;
  for (const c of candidates) {
    const p = join(c, '.shesha-active-apps.json');
    if (existsSync(p)) {
      pointer = p;
      break;
    }
  }
  if (!pointer) pass(); // no pointer in any candidate directory: this session published nothing

  let apps = [];
  try {
    apps = JSON.parse(readFileSync(pointer, 'utf8')).apps || [];
  } catch {
    block([
      '[shesha-frontend-forms] the session pointer is unreadable, so it cannot be proven that',
      'authored forms were verified. Fail closed.',
      `  delete ${pointer} if this session genuinely published nothing.`,
    ]);
  }
  if (apps.length === 0) pass();

  const problems = [];
  for (const app of apps) {
    const r = runCli(['ledger', 'gate', '--app', app, '--authored-evidence']);
    if (r.code !== 0) problems.push((r.stderr || r.stdout).trim());
  }
  if (problems.length === 0) pass();

  block([
    '[shesha-frontend-forms] this session authored forms that are NOT verified.',
    '',
    ...problems,
    '',
    'A validated file on disk is not a delivered form [R-046], and a 200 proves nothing',
    '[R-047] — verification is a re-fetch and diff. Either finish the push, or record why',
    'the work was abandoned:',
    ...apps.map((a) => `  node "${CLI}" ledger status --app "${a}"`),
    ...apps.map((a) => `  node "${CLI}" ledger reset  --app "${a}" --reason "<why>"`),
  ]);
}

const input = readInput();
const event = input.hook_event_name || input.hookEventName || '';

if (input.__unreadable) {
  /**
   * The event is unknown, so the only safe assumption is the dangerous one: if this session
   * has a publish pointer, treat it as a Stop and check the ledger. An unreadable payload
   * must not be able to wave outstanding work through.
   */
  process.stderr.write(`[shesha-frontend-forms] hook input unreadable (${input.__unreadable}); checking the ledger anyway.\n`);
  onStop({ cwd: process.cwd() });
} else if (event === 'Stop') {
  onStop(input);
} else if (event === 'PostToolUse') {
  onPostToolUse(input);
} else {
  pass();
}
