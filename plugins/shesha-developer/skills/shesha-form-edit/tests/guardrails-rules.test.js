/**
 * Guardrail tests for the rules that had NO validator before this change.
 *
 * Each of these fails silently at runtime — a code prop stored as a string is stripped on
 * save, a hazardous script string breaks the outer JSON in the browser, a single-brace
 * mustache renders empty, an anonymous form posting at raw CRUD is a security hole, and a
 * nested FK is rejected by dynamic CRUD Update. Nothing surfaces an error for any of them,
 * which is exactly why they need a validator rather than prose.
 *
 * Every test asserts BOTH directions: the defect is caught, and the correct shape is not
 * flagged. A validator that only ever fires is as useless as one that never does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const GUARDRAILS = path.join(SKILL, 'scripts', 'validate-guardrails.js');
const GOLDEN = path.join(HERE, 'golden');

let seq = 0;
const tmp = () => path.join(os.tmpdir(), `shesha-gr-${process.pid}-${seq++}.json`);

/** Run the guardrails on a form object; return { status, out }. */
function check(form) {
  const p = tmp();
  fs.writeFileSync(p, JSON.stringify(form, null, 2));
  const r = spawnSync(process.execPath, [GUARDRAILS, p], { encoding: 'utf8', cwd: SKILL });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** A clean baseline that passes today — mutate a copy per test. */
const base = () => JSON.parse(fs.readFileSync(path.join(GOLDEN, 'asset-capture.expected.json'), 'utf8'));

/** First input-ish component, for attaching a defect to something realistic. */
function firstInput(form) {
  let found = null;
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type && n.propertyName) { found = n; return; }
    Object.values(n).forEach(walk);
  };
  walk(form.components);
  return found;
}

test('baseline golden is clean — the rules below are not firing on correct markup', () => {
  const r = check(base());
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 fail/);
});

// ---------------------------------------------------------------- R-012 code-mode props

test('R-012 catches a code-carrying prop stored as a plain string', () => {
  const form = base();
  firstInput(form).customVisibility = 'return data?.status === 1';
  const r = check(form);
  assert.equal(r.status, 1);
  assert.match(r.out, /R-012/);
  assert.match(r.out, /silently stripped on save/);
});

test('R-012 accepts the same code wrapped in the code-mode object', () => {
  const form = base();
  firstInput(form).customVisibility = { _mode: 'code', _code: 'return data?.status === 1' };
  assert.doesNotMatch(check(form).out, /R-012/);
});

test('R-012 does not flag a literal string value on a code-capable prop', () => {
  // `defaultValue: "Draft"` is a literal, not code — flagging it would be noise.
  const form = base();
  firstInput(form).defaultValue = 'Draft';
  assert.doesNotMatch(check(form).out, /R-012/);
});

// ---------------------------------------------------------------- R-013 script safety

for (const [label, snippet] of [
  ['a template literal', 'return `${data.name}`'],
  ['a smart quote', 'return data.name === ‘Draft’'],
]) {
  test(`R-013 catches ${label} in an embedded script`, () => {
    const form = base();
    firstInput(form).onChangeCustom = { _mode: 'code', _code: snippet };
    const r = check(form);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /R-013/);
  });
}

test('R-013 accepts a JSON-safe script', () => {
  const form = base();
  firstInput(form).onChangeCustom = { _mode: 'code', _code: 'return data.name + "-x";' };
  assert.doesNotMatch(check(form).out, /R-013/);
});

// ---------------------------------------------------------------- R-014 mustache bracing

test('R-014 catches a single-brace mustache expression', () => {
  const form = base();
  firstInput(form).label = 'Owner: {data.ownerName}';
  const r = check(form);
  assert.equal(r.status, 1);
  assert.match(r.out, /R-014/);
  assert.match(r.out, /double braces/);
});

test('R-014 accepts double braces', () => {
  const form = base();
  firstInput(form).label = 'Owner: {{data.ownerName}}';
  assert.doesNotMatch(check(form).out, /R-014/);
});

test('R-014 does not flag JS or JSON braces', () => {
  // stylingBox is a JSON string; code props carry braces legitimately.
  const form = base();
  const n = firstInput(form);
  n.onChangeCustom = { _mode: 'code', _code: 'if (data) { return 1; } return 0;' };
  n.desktop = { ...(n.desktop ?? {}), stylingBox: '{"paddingLeft":"8"}' };
  assert.doesNotMatch(check(form).out, /R-014/);
});

// ---------------------------------------------------------------- R-022 / R-041 anonymous

test('R-022 catches a public-looking form that is not marked anonymous', () => {
  const form = base();
  form.formSettings.name = 'auth-login';
  form.formSettings.access = 3;
  const r = check(form);
  assert.equal(r.status, 1);
  assert.match(r.out, /R-022/);
});

test('R-022 accepts a public form marked access 5', () => {
  const form = base();
  form.formSettings.name = 'auth-login';
  form.formSettings.access = 5;
  assert.doesNotMatch(check(form).out, /R-022/);
});

test('R-041 catches an anonymous form submitting straight at raw entity CRUD', () => {
  const form = base();                 // the capture golden has a Submit action
  form.formSettings.access = 5;
  const r = check(form);
  assert.equal(r.status, 1);
  assert.match(r.out, /R-041/);
  assert.match(r.out, /AbpAllowAnonymous/);
});

test('R-041 does not fire on an ordinary authenticated form', () => {
  assert.doesNotMatch(check(base()).out, /R-041/);
});

// ---------------------------------------------------------------- R-037 FK reducer

test('R-037 catches entity-bound fields submitted without an FK reducer', () => {
  const form = base();
  const n = firstInput(form);
  n.type = 'autocomplete';
  n.dataSourceType = 'entitiesList';
  delete form.formSettings.onPrepareSubmitData;
  const r = check(form);
  assert.equal(r.status, 1);
  assert.match(r.out, /R-037/);
  assert.match(r.out, /not allowed to be updated/);
});

test('R-037 is satisfied by an onPrepareSubmitData that reduces to id', () => {
  const form = base();
  const n = firstInput(form);
  n.type = 'autocomplete';
  n.dataSourceType = 'entitiesList';
  form.formSettings.onPrepareSubmitData = {
    _mode: 'code',
    _code: 'data.owner = data.owner ? { id: data.owner.id } : null; return data;',
  };
  assert.doesNotMatch(check(form).out, /R-037/);
});

// ---------------------------------------------------------------- registry agreement

test('every rule asserted here carries a validator in the registry', () => {
  // The doc-lint requires this, and it is what makes the citations honest.
  const rules = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', '_rules.json'), 'utf8')).rules;
  for (const id of ['R-012', 'R-013', 'R-014', 'R-022', 'R-037', 'R-041']) {
    const r = rules.find((x) => x.id === id);
    assert.ok(r, `${id} missing from the registry`);
    assert.ok(r.validator, `${id} is enforced by validate-guardrails.js but the registry still says unenforced`);
  }
});
