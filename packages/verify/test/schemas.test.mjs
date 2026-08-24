// WP-8a §4.8 rows 2-3: the seven handoff schemas compile under ajv {strict:true}
// (a (?i) inline flag or a missing type throws at compile(), not at validate()), and
// the plan schema makes five defect classes structurally impossible (§4.2.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import addFormatsMod from 'ajv-formats';

// ajv/dist/2020.js and ajv-formats are CJS; Node unwraps default to the callable.
const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);
const addFormats = /** @type {any} */ (/** @type {any} */ (addFormatsMod).default ?? addFormatsMod);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEMA_DIR = path.join(ROOT, 'packages/sfs/schema');
const SEVEN = ['plan', 'manifest', 'verdict', 'dispatch', 'sfs-meta', 'lock', 'blueprint'];

/** @param {string} name */
function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8').replace(/^﻿/, ''));
}
function strictAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}

// ---- row 2: seven ajv-strict-compile cases -------------------------------------
for (const name of SEVEN) {
  test(`ajv-strict compiles ${name}.schema.json`, () => {
    assert.doesNotThrow(() => strictAjv().compile(loadSchema(name)),
      `${name}.schema.json must compile under {strict:true}`);
  });
}

test('all seven declare draft 2020-12, the $id convention, and additionalProperties:false at the root', () => {
  for (const name of SEVEN) {
    const s = loadSchema(name);
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', `${name} $schema`);
    assert.equal(s.$id, `https://boxfusion.io/shesha/sfs/${name}.schema.json`, `${name} $id`);
    assert.equal(s.additionalProperties, false, `${name} root additionalProperties`);
  }
});

// ---- row 3: the plan schema's five structural impossibilities -------------------
function validPlan() {
  return {
    planVersion: '1.0',
    runId: '20260824-0931-demo',
    briefSha256: 'a'.repeat(64),
    brand: 'shesha',
    backend: { mode: 'none' },
    repairPolicy: { maxRounds: 3 },
    fanout: { maxConcurrentScreens: 1, withinScreen: 1 },
    screens: [{
      name: 'bookings-table', module: 'boxfusion.test', formName: 'bookings-table', kind: 'list', buildOrder: 1,
      contract: {
        signedOffAt: null,
        predicates: [
          { id: 'T1', tier: 'T1', predicate: 'schemaValid', args: {}, expect: true, severity: 'must' },
          { id: 'T2', tier: 'T2', predicate: 'registryConformant', args: {}, expect: true, severity: 'must' },
          { id: 'T3', tier: 'T3', predicate: 'widthRatio', args: { a: 'main', b: 'rail' }, expect: { min: 2.5 }, severity: 'must' },
        ],
      },
    }],
  };
}

test('a valid plan is accepted', () => {
  const validate = strictAjv().compile(loadSchema('plan'));
  assert.ok(validate(validPlan()), `valid plan must pass: ${JSON.stringify(validate.errors)}`);
});

/** @param {(p:any)=>void} mutate */
function planRejects(mutate) {
  const validate = strictAjv().compile(loadSchema('plan'));
  const p = validPlan();
  mutate(p);
  return validate(p) === false;
}

test('plan rejects: no contract', () => {
  assert.ok(planRejects((p) => { delete p.screens[0].contract; }), 'a screen with no acceptance contract must be rejected');
});
test('plan rejects: 2 predicates', () => {
  assert.ok(planRejects((p) => { p.screens[0].contract.predicates = p.screens[0].contract.predicates.slice(0, 2); }), 'a contract with < 3 predicates must be rejected');
});
test('plan rejects: no T3 predicate', () => {
  assert.ok(planRejects((p) => { for (const pr of p.screens[0].contract.predicates) pr.tier = 'T1'; }), 'an entirely non-T3 contract (no compiled-tree predicate) must be rejected');
});
test('plan rejects: maxRounds: 5', () => {
  assert.ok(planRejects((p) => { p.repairPolicy.maxRounds = 5; }), 'a repair loop above 3 rounds must be rejected');
});
test('plan rejects: withinScreen: 2', () => {
  assert.ok(planRejects((p) => { p.fanout.withinScreen = 2; }), 'two authors on one form must be rejected');
});
