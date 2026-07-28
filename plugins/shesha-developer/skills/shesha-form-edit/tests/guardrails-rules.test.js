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

test('R-013 catches a smart quote in an embedded script', () => {
  // Valid JSON, but ‘ and ’ are not JS string delimiters — the script throws at parse time.
  const form = base();
  firstInput(form).onChangeCustom = { _mode: 'code', _code: 'return data.name === ‘Draft’' };
  const r = check(form);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /R-013/);
});

test('R-013 accepts a multi-line script — a newline is not a JSON hazard', () => {
  // JSON escapes newlines as \\n, so a multi-line script body is entirely normal. Only
  // exotic control characters (0x00-0x08 and friends) are invalid unescaped.
  const form = base();
  firstInput(form).onChangeCustom = { _mode: 'code', _code: 'const x = 1;\nreturn x + 1;' };
  assert.doesNotMatch(check(form).out, /R-013/);
});

test('R-013 does NOT flag a template literal — a backtick is valid JSON', () => {
  // The first cut flagged backticks and hit five production goldens that build endpoint
  // URLs this way. Backticks are legal inside a JSON string; the rule is about characters
  // that break the JSON envelope or the JS parse, which a backtick does not.
  const form = base();
  firstInput(form).onChangeCustom = {
    _mode: 'code',
    _code: 'return `/api/dynamic/Mod/Ent/Crud/GetAll?filter=${encodeURIComponent(f)}`;',
  };
  assert.doesNotMatch(check(form).out, /R-013/);
});

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

test('R-037 does NOT demand a reducer exist — no golden carries one', () => {
  // The first cut required onPrepareSubmitData whenever a form submitted an entity-bound
  // picker. That flagged 2 of 11 production goldens, and NONE of the corpus carries a
  // reducer — so an autocomplete bound via entitiesList already submits a plain id. The
  // registry check is "onPrepareSubmitData reduces FK objects to {id}", i.e. content when
  // present, not existence.
  const form = base();
  const n = firstInput(form);
  n.type = 'autocomplete';
  n.dataSourceType = 'entitiesList';
  delete form.formSettings.onPrepareSubmitData;
  assert.doesNotMatch(check(form).out, /R-037/);
});

test('R-037 catches a reducer that assigns an FK without reducing it to id', () => {
  const form = base();
  const n = firstInput(form);
  n.type = 'autocomplete';
  n.dataSourceType = 'entitiesList';
  form.formSettings.onPrepareSubmitData = { _mode: 'code', _code: 'data.owner = data.ownerPick;' };
  const r = check(form);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /R-037/);
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
