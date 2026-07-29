import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  extractMarkupRef,
  loadMarkupTree,
  classifyFindings,
  buildReason,
  buildOutput,
  resolveGateMode,
  evaluatePreToolUse,
  loadDefaultContext,
  translatePosixDrivePath,
  DEFAULT_POLICY_PATH,
} from '../validate-push.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM_EDIT_FIXTURES = join(HERE, '../../skills/shesha-form-edit/tests/fixtures');

const ctx = loadDefaultContext();

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'shesha-push-hook-'));
}

function fixturePath(name) {
  return join(FORM_EDIT_FIXTURES, name);
}

function importJsonCommand(path) {
  return `curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/ImportJson" -H "Authorization: Bearer $ACCESS_TOKEN" -F "ItemId=$FORM_ID" -F "file=@${path};type=application/json"`;
}

function payloadFor(command, overrides = {}) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd: process.cwd(),
    ...overrides,
  };
}

function evaluate(command, envOverrides = {}, payloadOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  delete env.SHESHA_SKIP_FORM_VALIDATION;
  delete env.SHESHA_FORM_GATE;
  Object.assign(env, envOverrides);
  return evaluatePreToolUse(payloadFor(command, payloadOverrides), { env, ...ctx });
}

// ---------------------------------------------------------------------------
// Policy sanity — every code in gate-policy.json's Group A/B actually maps
// onto a real tier1/tier2 code (typo-guard for the data file the report
// leans on).
// ---------------------------------------------------------------------------

test('gate-policy.json loads and has all three groups', () => {
  const policy = JSON.parse(readFileSync(DEFAULT_POLICY_PATH, 'utf8'));
  assert.ok(policy.groups.A.codes['T1-JSON-UNSAFE']);
  assert.ok(policy.groups.B.codes['T1-ID-DUPLICATE']);
  assert.ok(policy.groups.C.codes['T1-PROP-UNKNOWN']);
});

test('gate-policy.json: task 8\'s six new codes are placed in their measured groups, none accidentally left ungated or in Group C', () => {
  const policy = JSON.parse(readFileSync(DEFAULT_POLICY_PATH, 'utf8'));
  // Mechanically fixed by the normalizer -> Group B (block only if it
  // survives normalization).
  for (const code of ['T2-SPLIT-WIDTH-ON-LEAF', 'T2-SLOT-STYLE-MISMATCH', 'T2-ROWLIST-NO-VGAP']) {
    assert.ok(policy.groups.B.codes[code], `${code} missing from Group B`);
    assert.ok(!policy.groups.A.codes[code] && !policy.groups.C.codes[code], `${code} duplicated across groups`);
  }
  // Not mechanically fixable, low measured rate -> Group A (block).
  for (const code of ['T2-CODEMODE-TITLE', 'T2-DUPLICATE-CAPTION', 'T2-LABELCOL-VS-NARROW-ROW']) {
    assert.ok(policy.groups.A.codes[code], `${code} missing from Group A`);
    assert.ok(!policy.groups.B.codes[code] && !policy.groups.C.codes[code], `${code} duplicated across groups`);
  }
});

// ---------------------------------------------------------------------------
// extractMarkupRef — command parsing
// ---------------------------------------------------------------------------

test('extractMarkupRef finds the ImportJson file reference', () => {
  const ref = extractMarkupRef(importJsonCommand('/tmp/form.json'));
  assert.deepEqual(ref, { kind: 'raw', path: '/tmp/form.json' });
});

test('extractMarkupRef finds the UpdateMarkup -d @file reference', () => {
  const ref = extractMarkupRef('curl -X PUT "$BASE/UpdateMarkup" -d @/tmp/update-markup-body.json');
  assert.deepEqual(ref, { kind: 'wrapped', path: '/tmp/update-markup-body.json' });
});

test('extractMarkupRef returns null for a command with neither keyword', () => {
  assert.equal(extractMarkupRef('git status'), null);
  assert.equal(extractMarkupRef('npm test'), null);
});

test('extractMarkupRef returns {kind:"unknown"} when the keyword is present but no file ref parses', () => {
  const ref = extractMarkupRef('curl -X PUT "$BASE/UpdateMarkup" -d \'{"id":"abc"}\'');
  assert.deepEqual(ref, { kind: 'unknown' });
});

// ---------------------------------------------------------------------------
// Required case: a Group A finding denies.
// ---------------------------------------------------------------------------

test('a Group A finding (T1-JSON-UNSAFE) denies the push', () => {
  const result = evaluate(importJsonCommand(fixturePath('t1-json-unsafe.json')));
  assert.equal(result.decision, 'deny');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /T1-JSON-UNSAFE/);
  assert.ok(result.logEntry.blockingCodes.includes('T1-JSON-UNSAFE'));
});

// ---------------------------------------------------------------------------
// Required case: a Group C-only finding allows.
// ---------------------------------------------------------------------------

test('a Group C-only finding (T1-PROP-UNKNOWN) allows the push', () => {
  const result = evaluate(importJsonCommand(fixturePath('t1-prop-unknown.json')));
  assert.equal(result.decision, 'allow');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'allow');
  // The Group C finding is still reported, just not blocking.
  assert.ok(result.logEntry.reportedCodes.includes('T1-PROP-UNKNOWN'));
  assert.equal(result.logEntry.blockingCodes, undefined);
});

// ---------------------------------------------------------------------------
// Required case: a Group B finding the normalizer fixes allows.
// ---------------------------------------------------------------------------

test('a Group B finding (T1-ID-DUPLICATE) fixed by the normalizer allows the push', () => {
  // Sanity-check the premise directly: post-normalize, tier1 no longer
  // reports T1-ID-DUPLICATE for this fixture (the normalizer's fixId phase
  // mints a deterministic replacement id for the duplicate).
  const result = evaluate(importJsonCommand(fixturePath('t1-id-duplicate.json')));
  assert.equal(result.decision, 'allow');
  assert.ok(
    !result.logEntry.reportedCodes?.includes('T1-ID-DUPLICATE'),
    'T1-ID-DUPLICATE should have been fully resolved by normalization, not merely downgraded to reported'
  );
});

// ---------------------------------------------------------------------------
// Required case: an unparseable command allows-and-logs.
// ---------------------------------------------------------------------------

test('an unparseable command (push keyword present, no file ref) allows and logs a skip', () => {
  const result = evaluate('curl -X PUT "$BASE/UpdateMarkup" -d \'{"id":"abc"}\'');
  assert.equal(result.decision, 'skip');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /could not determine/);
  assert.equal(result.logEntry.decision, 'skip');
});

test('a push command referencing a file that does not exist allows-and-logs (fail open on read error)', () => {
  const result = evaluate(importJsonCommand('/definitely/does/not/exist-12345.json'));
  assert.equal(result.decision, 'skip');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(result.logEntry.decision, 'skip');
});

test('a push command referencing a file with malformed JSON allows-and-logs', () => {
  const dir = tmpDir();
  const path = join(dir, 'bad.json');
  writeFileSync(path, '{ not valid json', 'utf8');
  try {
    const result = evaluate(importJsonCommand(path));
    assert.equal(result.decision, 'skip');
    assert.equal(result.output.hookSpecificOutput.permissionDecision, 'allow');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// UpdateMarkup wrapped-DTO unwrap path.
// ---------------------------------------------------------------------------

test('UpdateMarkup wrapped DTO is unwrapped before validation (Group A finding still denies)', () => {
  const dir = tmpDir();
  const tree = JSON.parse(readFileSync(fixturePath('t1-json-unsafe.json'), 'utf8'));
  const dtoPath = join(dir, 'update-markup-body.json');
  writeFileSync(dtoPath, JSON.stringify({ id: randomUUID(), markup: JSON.stringify(tree) }), 'utf8');
  try {
    const result = evaluate(`curl -X PUT "$BASE/UpdateMarkup" -d @${dtoPath}`);
    assert.equal(result.decision, 'deny');
    assert.ok(result.logEntry.blockingCodes.includes('T1-JSON-UNSAFE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Required case: the env-var bypass.
// ---------------------------------------------------------------------------

test('SHESHA_SKIP_FORM_VALIDATION=1 bypasses validation even for a denying form', () => {
  const result = evaluate(importJsonCommand(fixturePath('t1-json-unsafe.json')), {
    SHESHA_SKIP_FORM_VALIDATION: '1',
  });
  assert.equal(result.decision, 'bypass');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(result.logEntry.decision, 'bypass');
});

// ---------------------------------------------------------------------------
// Required case: a non-push command is ignored.
// ---------------------------------------------------------------------------

test('a non-push Bash command is ignored (no output, no log entry)', () => {
  const result = evaluate('git status');
  assert.equal(result.decision, 'ignore');
  assert.equal(result.output, undefined);
  assert.equal(result.logEntry, undefined);
});

test('a non-Bash/PowerShell tool call is ignored regardless of command content', () => {
  const payload = payloadFor(importJsonCommand(fixturePath('t1-json-unsafe.json')), { tool_name: 'Write' });
  const result = evaluatePreToolUse(payload, { env: process.env, ...ctx });
  assert.equal(result.decision, 'ignore');
});

// ---------------------------------------------------------------------------
// Required case: the reason is truncated below 10,000 chars.
// ---------------------------------------------------------------------------

test('a large number of blocking findings is truncated below 10,000 chars', () => {
  const components = [];
  for (let i = 0; i < 400; i++) {
    components.push({
      id: randomUUID(),
      type: 'textField',
      propertyName: `field${i}`,
      componentName: `field${i}`,
      onChangeCustom: 'const msg = `unsafe ${i}`;',
    });
  }
  const dir = tmpDir();
  const path = join(dir, 'big.json');
  writeFileSync(path, JSON.stringify({ components }), 'utf8');
  try {
    const result = evaluate(importJsonCommand(path));
    assert.equal(result.decision, 'deny');
    assert.equal(result.logEntry.blockingCount, 400);
    const reason = result.output.hookSpecificOutput.permissionDecisionReason;
    assert.ok(reason.length <= 10000, `reason was ${reason.length} chars, expected <= 10000`);
    assert.match(reason, /^400 blocking form-validation finding/);
    assert.match(reason, /more finding\(s\) omitted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReason never exceeds the requested cap even with pathologically long messages', () => {
  const findings = Array.from({ length: 50 }, (_, i) => ({
    code: 'T1-JSON-UNSAFE',
    path: `components[${i}]`,
    message: 'x'.repeat(500),
  }));
  const reason = buildReason(findings, { max: 2000 });
  assert.ok(reason.length <= 2000);
});

// ---------------------------------------------------------------------------
// SHESHA_FORM_GATE narrowing/widening.
// ---------------------------------------------------------------------------

test('SHESHA_FORM_GATE=off never denies, even on a Group A finding', () => {
  const result = evaluate(importJsonCommand(fixturePath('t1-json-unsafe.json')), { SHESHA_FORM_GATE: 'off' });
  assert.equal(result.decision, 'allow');
});

test('SHESHA_FORM_GATE=groupA still denies on Group A but not on a surviving Group B finding', () => {
  const groupAResult = evaluate(importJsonCommand(fixturePath('t1-json-unsafe.json')), { SHESHA_FORM_GATE: 'groupA' });
  assert.equal(groupAResult.decision, 'deny');
});

test('resolveGateMode defaults to "full" and normalizes case/unknown values', () => {
  assert.equal(resolveGateMode({}), 'full');
  assert.equal(resolveGateMode({ SHESHA_FORM_GATE: 'OFF' }), 'off');
  assert.equal(resolveGateMode({ SHESHA_FORM_GATE: 'GroupA' }), 'groupa');
  assert.equal(resolveGateMode({ SHESHA_FORM_GATE: 'bogus' }), 'full');
});

// ---------------------------------------------------------------------------
// classifyFindings — direct unit tests against a small synthetic policy.
// ---------------------------------------------------------------------------

test('classifyFindings splits blocking vs reported per gate mode', () => {
  const policy = { groups: { A: { codes: { 'A-1': {} } }, B: { codes: { 'B-1': {} } } } };
  const findings = [
    { code: 'A-1', path: 'p1', message: 'm1' },
    { code: 'B-1', path: 'p2', message: 'm2' },
    { code: 'C-1', path: 'p3', message: 'm3' },
  ];
  const full = classifyFindings(findings, policy, 'full');
  assert.equal(full.blocking.length, 2);
  assert.equal(full.reported.length, 1);

  const groupA = classifyFindings(findings, policy, 'groupa');
  assert.equal(groupA.blocking.length, 1);
  assert.equal(groupA.reported.length, 2);

  const off = classifyFindings(findings, policy, 'off');
  assert.equal(off.blocking.length, 0);
  assert.equal(off.reported.length, 3);
});

// ---------------------------------------------------------------------------
// buildOutput shape — matches the confirmed hook contract.
// ---------------------------------------------------------------------------

test('buildOutput produces the documented hookSpecificOutput shape', () => {
  const out = buildOutput('PreToolUse', 'deny', 'because reasons');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, 'because reasons');
  assert.equal(out.hookSpecificOutput.additionalContext, 'because reasons');
});

// ---------------------------------------------------------------------------
// loadMarkupTree — direct unit coverage of the wrapped/raw/double-encoded paths.
// ---------------------------------------------------------------------------

test('loadMarkupTree reads a raw tree file directly', () => {
  const loaded = loadMarkupTree({ kind: 'raw', path: fixturePath('t1-clean.json') });
  assert.ok(Array.isArray(loaded.tree.components));
});

test('loadMarkupTree errors (does not throw) when components[] is missing', () => {
  const dir = tmpDir();
  const path = join(dir, 'no-components.json');
  writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf8');
  try {
    const loaded = loadMarkupTree({ kind: 'raw', path });
    assert.ok(loaded.error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path bug fix (task 8): Git Bash / WSL emit POSIX-style drive paths that
// win32 Node's own fs functions mis-resolve. Before the fix, a push command
// whose file reference or cwd took this shape hit loadMarkupTree's error
// path and fell through to fail-open "skip" — see validate-push.mjs's own
// header comment on translatePosixDrivePath for the full mechanism.
// ---------------------------------------------------------------------------

// A real absolute Windows path (this repo's own fixtures dir) rewritten as
// Git Bash / WSL would emit it, so the test proves the ACTUAL translation
// this machine needs, not a synthetic example.
function toGitBashPath(winPath) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(winPath);
  assert.ok(m, `not an absolute Windows path: ${winPath}`);
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

function toWslPath(winPath) {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(winPath);
  assert.ok(m, `not an absolute Windows path: ${winPath}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

test('translatePosixDrivePath: converts a Git-Bash-style "/c/..." path to "C:/..." on win32', () => {
  assert.equal(
    translatePosixDrivePath('/c/Users/Hashim/form.json', { platform: 'win32' }),
    'C:/Users/Hashim/form.json',
  );
});

test('translatePosixDrivePath: converts a WSL-style "/mnt/c/..." path to "C:/..." on win32', () => {
  assert.equal(
    translatePosixDrivePath('/mnt/c/Users/Hashim/form.json', { platform: 'win32' }),
    'C:/Users/Hashim/form.json',
  );
});

test('translatePosixDrivePath: leaves a path untouched on a non-win32 platform', () => {
  assert.equal(
    translatePosixDrivePath('/c/Users/Hashim/form.json', { platform: 'linux' }),
    '/c/Users/Hashim/form.json',
  );
});

test('translatePosixDrivePath: leaves an already-Windows path, and a genuinely unrelated POSIX path, untouched', () => {
  assert.equal(translatePosixDrivePath('C:/Users/Hashim/form.json', { platform: 'win32' }), 'C:/Users/Hashim/form.json');
  assert.equal(translatePosixDrivePath('/home/hashim/form.json', { platform: 'win32' }), '/home/hashim/form.json');
});

test('loadMarkupTree: a Git-Bash-style absolute path now resolves and loads (was unresolvable before this fix)', () => {
  const winPath = fixturePath('t1-clean.json');
  const gitBashPath = toGitBashPath(winPath);
  const loaded = loadMarkupTree({ kind: 'raw', path: gitBashPath }, { platform: 'win32' });
  assert.ok(!loaded.error, `expected no error, got: ${loaded.error}`);
  assert.ok(Array.isArray(loaded.tree.components));
});

test('loadMarkupTree: a WSL-style absolute path also resolves and loads', () => {
  const winPath = fixturePath('t1-clean.json');
  const wslPath = toWslPath(winPath);
  const loaded = loadMarkupTree({ kind: 'raw', path: wslPath }, { platform: 'win32' });
  assert.ok(!loaded.error, `expected no error, got: ${loaded.error}`);
  assert.ok(Array.isArray(loaded.tree.components));
});

test('loadMarkupTree: a Git-Bash-style cwd + relative path also resolves (the $(pwd)-derived case from the brief)', () => {
  const dir = tmpDir();
  const path = join(dir, 'form.json');
  writeFileSync(path, readFileSync(fixturePath('t1-clean.json'), 'utf8'), 'utf8');
  try {
    const gitBashCwd = toGitBashPath(dir);
    const loaded = loadMarkupTree({ kind: 'raw', path: 'form.json' }, { cwd: gitBashCwd, platform: 'win32' });
    assert.ok(!loaded.error, `expected no error, got: ${loaded.error}`);
    assert.ok(Array.isArray(loaded.tree.components));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluatePreToolUse: a Git-Bash-style path end-to-end actually GATES (denies a Group A finding), not just resolves', () => {
  const winPath = fixturePath('t1-json-unsafe.json');
  const gitBashPath = toGitBashPath(winPath);
  const command = importJsonCommand(gitBashPath);
  const payload = payloadFor(command, { cwd: toGitBashPath(process.cwd()) });
  const env = { ...process.env };
  delete env.SHESHA_SKIP_FORM_VALIDATION;
  delete env.SHESHA_FORM_GATE;
  const result = evaluatePreToolUse(payload, { env, ...ctx, platform: 'win32' });
  assert.equal(result.decision, 'deny');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'deny');
});
