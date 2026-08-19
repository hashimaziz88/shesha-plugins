/*
 * Tests for the single coverage-accounting implementation (D-041, D-042).
 *
 * Every test below corresponds to a rule the pre-rebuild repository either
 * violated or had no rule for. The named cases are the specification; the
 * count is ratcheted by g-gate-contract's sibling test-count rule.
 *
 * Run: node --test packages/registry/test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EXIT, RESULTS, families, verdictOf, reconcile, zeroCoverageReasons,
  report, exitFor, readJsonGuarded, runGuarded,
  CoverageArithmeticError, UndeclaredFamilyError,
} from '../src/coverage.mjs';

/** @param {string} name @param {Record<string, unknown>} [extra] */
function oneFamily(name = 'things', extra = {}) {
  return families([{ name, unit: 'thing', ...extra }]);
}

test('a required family that walked nothing is fail, not pass', () => {
  const f = oneFamily();
  assert.equal(verdictOf(f.list), 'fail');
  assert.match(/** @type {import('../src/coverage.mjs').Note} */ (zeroCoverageReasons(f.list)[0]).reason, /zero coverage is a hard fail/);
});

test('a family that walked pointers and checked none is fail', () => {
  const f = oneFamily();
  f.get('things').pointer('a').na('not relevant here');
  // walked 1, checked 0, n/a 1 — reconciles, but nothing was ever evaluated.
  assert.equal(verdictOf(f.list), 'fail');
});

test('an optional family that walked nothing does not fail the run', () => {
  const f = families([
    { name: 'optional', unit: 'thing', required: false },
    { name: 'real', unit: 'thing' },
  ]);
  f.get('real').pointer('a').check();
  assert.equal(verdictOf(f.list), 'pass');
  assert.match(report(f.list, { title: 't' }), /optional/); // still printed
});

test('requesting an undeclared family throws UndeclaredFamilyError', () => {
  const f = oneFamily();
  assert.throws(() => f.get('typo'), UndeclaredFamilyError);
});

test('a declared family that matches nothing still appears in the report', () => {
  const f = families([
    { name: 'populated', unit: 'thing' },
    { name: 'empty-but-declared', unit: 'thing', required: false },
  ]);
  f.get('populated').pointer('a').check();
  const out = report(f.list, { title: 't' });
  assert.match(out, /empty-but-declared\s+walked\s+0/);
});

test('families() rejects a family declared without a unit', () => {
  // Deliberately malformed input: the unit is required at the type level too, so
  // the cast is what lets the runtime guard be tested rather than silenced.
  const noUnit = /** @type {import('../src/coverage.mjs').FamilyDecl[]} */ (
    /** @type {unknown} */ ([{ name: 'no-unit' }]));
  assert.throws(() => families(noUnit), UndeclaredFamilyError);
  assert.throws(() => families([]), UndeclaredFamilyError);
});

test('walked minus dispositions is a CoverageArithmeticError, not a verdict', () => {
  const f = oneFamily();
  f.get('things').pointer('disposed').check();
  f.get('things').pointer('left-open');
  assert.throws(() => verdictOf(f.list), CoverageArithmeticError);
});

test('an undisposed pointer throws naming the location', () => {
  const f = oneFamily();
  f.get('things').pointer('components[3].propertyName');
  try {
    reconcile(f.list);
    assert.fail('expected reconcile to throw');
  } catch (e) {
    assert.ok(e instanceof CoverageArithmeticError);
    assert.match(e.message, /components\[3\]\.propertyName/);
  }
});

test('disposing one pointer twice throws', () => {
  const f = oneFamily();
  const p = f.get('things').pointer('a');
  p.check();
  assert.throws(() => p.na('changed my mind'), CoverageArithmeticError);
});

test('failing a pointer already marked notApplicable throws', () => {
  const f = oneFamily();
  const p = f.get('things').pointer('a');
  p.na('not applicable');
  assert.throws(() => p.fail('but actually broken'), CoverageArithmeticError);
});

test('seven role tokens across two themes reconcile as walked 7 checked 7 assertions 14', () => {
  const f = oneFamily('roles', { unit: 'token' });
  const roles = f.get('roles');
  for (const token of ['primary', 'surface', 'border', 'danger', 'muted', 'accent', 'success']) {
    const p = roles.pointer(token);
    p.check(); // light theme
    p.check(); // dark theme
  }
  assert.equal(roles.walked, 7);
  assert.equal(roles.checked, 7);
  assert.equal(roles.assertions, 14);
  assert.equal(verdictOf(f.list), 'pass');
});

test('two failures on one pointer still reconcile', () => {
  const f = oneFamily();
  const p = f.get('things').pointer('a');
  p.fail('first reason');
  p.fail('second reason');
  assert.equal(f.get('things').walked, 1);
  assert.equal(f.get('things').checked, 1);
  assert.equal(f.get('things').failures.length, 2);
  assert.equal(verdictOf(f.list), 'fail');
});

test('uninspectable alone yields partial and exit 3', () => {
  // "Alone" means uninspectable is the only problem present, not the only pointer
  // walked: a family whose sole pointer is uninspectable has checked 0 and is
  // caught by R1 rule 3 first. Test 15 asserts that ordering deliberately.
  const f = oneFamily();
  f.get('things').pointer('checked-one').check();
  f.get('things').pointer('a').cannot('no backend reachable', 'T2.07');
  assert.equal(verdictOf(f.list), 'partial');
  assert.equal(exitFor('partial'), 3);
  assert.equal(EXIT.partial, 3);
  assert.match(report(f.list, { title: 't' }), /A partial verdict is NOT a pass/);

  // Pin the ordering the construction above depends on: a family that walked
  // only uninspectable pointers evaluated nothing, and that is a fail.
  const lone = oneFamily();
  lone.get('things').pointer('a').cannot('no backend reachable', 'T2.07');
  assert.equal(verdictOf(lone.list), 'fail');
});

test('failures outrank uninspectable', () => {
  const f = oneFamily();
  f.get('things').pointer('a').fail('broken');
  f.get('things').pointer('b').cannot('no backend', 'T2.07');
  assert.equal(verdictOf(f.list), 'fail');
});

test('zero coverage outranks uninspectable', () => {
  const f = families([
    { name: 'walked-none', unit: 'thing' },
    { name: 'partial-one', unit: 'thing' },
  ]);
  f.get('partial-one').pointer('a').cannot('no backend', 'T2.07');
  assert.equal(verdictOf(f.list), 'fail');
});

test('readJsonGuarded turns a malformed JSON file into one named failure and no throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-json-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ "unterminated": ');
  const f = oneFamily('data', { unit: 'file' });
  const got = readJsonGuarded(bad, f.get('data'), 'bad.json');
  assert.equal(got.ok, false);
  assert.equal(f.get('data').failures.length, 1);
  assert.match(/** @type {import('../src/coverage.mjs').Note} */ (f.get('data').failures[0]).reason, /is not valid JSON/);
  assert.equal(verdictOf(f.list), 'fail');

  const missing = oneFamily('data2', { unit: 'file' });
  const gone = readJsonGuarded(path.join(dir, 'nope.json'), missing.get('data2'), 'nope.json');
  assert.equal(gone.ok, false);
  assert.match(/** @type {import('../src/coverage.mjs').Note} */ (missing.get('data2').failures[0]).reason, /does not exist/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJsonGuarded strips a BOM', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-bom-'));
  const file = path.join(dir, 'bom.json');
  fs.writeFileSync(file, '﻿{"ok":true}', 'utf8');
  const f = oneFamily('data', { unit: 'file' });
  const got = readJsonGuarded(file, f.get('data'), 'bom.json');
  assert.equal(got.ok, true);
  assert.deepEqual(got.ok === true ? got.value : null, { ok: true });
  assert.equal(verdictOf(f.list), 'pass');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGuarded converts a CoverageArithmeticError into exit 2 with no verdict line', async () => {
  const original = console.error;
  /** @type {string[]} */
  const captured = [];
  console.error = (/** @type {unknown[]} */ ...args) => { captured.push(args.join(' ')); };
  try {
    const code = await runGuarded(async () => {
      const f = oneFamily();
      f.get('things').pointer('never-disposed');
      return exitFor(verdictOf(f.list));
    });
    assert.equal(code, EXIT.usage);
    assert.equal(code, 2);
    assert.match(captured.join('\n'), /COVERAGE CONTRACT BREACH — no verdict was produced/);
    assert.ok(!captured.join('\n').includes('result:'));
  } finally {
    console.error = original;
  }
});

test('an expectEmpty family with walked 0 passes and still prints its decision id', () => {
  const f = families([
    { name: 'overlays', unit: 'overlay', expectEmpty: true, decision: 'D-010' },
    { name: 'real', unit: 'thing' },
  ]);
  f.get('real').pointer('a').check();
  assert.equal(verdictOf(f.list), 'pass');
  assert.match(report(f.list, { title: 't' }), /overlays.*expectEmpty D-010/);
});

test('an expectEmpty family with walked 1 fails naming the decision that deleted the population', () => {
  const f = families([{ name: 'overlays', unit: 'overlay', expectEmpty: true, decision: 'D-010' }]);
  f.get('overlays').pointer('baked-overlay.json').check();
  assert.equal(verdictOf(f.list), 'fail');
  assert.match(/** @type {import('../src/coverage.mjs').Note} */ (zeroCoverageReasons(f.list)[0]).reason, /deleted by D-010 — it has returned/);
});

test('families() rejects expectEmpty without a D-0NN decision id, and cannot() without a checkId', () => {
  assert.throws(() => families([{ name: 'x', unit: 'y', expectEmpty: true }]), UndeclaredFamilyError);
  assert.throws(() => families([{ name: 'x', unit: 'y', expectEmpty: true, decision: 'nope' }]), UndeclaredFamilyError);
  const f = oneFamily();
  const p = f.get('things').pointer('a');
  assert.throws(() => p.cannot('no backend', ''), CoverageArithmeticError);
  assert.throws(() => p.cannot('no backend', 'not-a-check-id'), CoverageArithmeticError);
});

test('the result union is exactly {pass,fail,partial,notRun} and carries no warn', () => {
  assert.deepEqual([...RESULTS], ['pass', 'fail', 'partial', 'notRun']);
  assert.ok(!RESULTS.includes('warn'));
  assert.deepEqual(EXIT, { pass: 0, fail: 1, usage: 2, partial: 3 });
});

test('report --json emits the frozen shape the MCP surface and mutation harness parse', () => {
  const f = oneFamily();
  f.get('things').pointer('a').check();
  const parsed = JSON.parse(report(f.list, { json: true, title: 'target-name' }));
  assert.equal(parsed.target, 'target-name');
  assert.equal(parsed.result, 'pass');
  assert.equal(parsed.families.length, 1);
  for (const key of ['name', 'unit', 'required', 'expectEmpty', 'decision',
    'walked', 'checked', 'assertions', 'failures', 'uninspectable', 'notApplicable']) {
    assert.ok(key in parsed.families[0], `missing key ${key}`);
  }
});
