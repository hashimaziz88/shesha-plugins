// CONTRACT TESTS — blueprint validation (rebuild target, expected RED today).
//
// These tests are not a description of the current validator. They are the
// CONTRACT the rebuilt validator must satisfy:
//
//   1. The validator is a real JSON-Schema validation of blueprint.schema.json,
//      not a hand-rolled sample of five checks. Every typed property, every
//      `additionalProperties: false`, every nested `items` shape is enforced.
//   2. A finding is STRUCTURED DATA, not a sentence. It carries
//      { path, rule, actual, expected, message } so a caller can route a fix by
//      `path` and count regressions by `rule` — which is exactly what the
//      placement/critic layers need and cannot do with a bare string.
//
// Today's validator (shesha-design-comprehension/scripts/validate-blueprint.mjs)
// returns `{ errors: string[] }` from ~12 bespoke checks, so these fail on both
// counts. That is the point.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlueprint, loadSchema } from '../../../shesha-design-comprehension/scripts/validate-blueprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, '..', '..', '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json');
const schema = loadSchema(SCHEMA_PATH);

/** The target finding shape. A finding must be routable and countable. */
export const FINDING_KEYS = ['path', 'rule', 'actual', 'expected', 'message'];

/** Accept either the target `findings` key or today's `errors` key — the SHAPE is what is under test. */
const findingsOf = (bp) => {
  const result = validateBlueprint(bp, schema);
  return result.findings ?? result.errors ?? [];
};

/**
 * Contract: every finding is an object carrying all five keys. Bare strings
 * fail here by design — a caller cannot route a fix by substring-matching prose.
 */
function assertStructured(findings, label) {
  assert.ok(findings.length > 0, `${label}: the validator reported NOTHING — the defect is not detected at all`);
  for (const [i, f] of findings.entries()) {
    assert.equal(typeof f, 'object',
      `${label}: finding[${i}] is a ${typeof f} (${JSON.stringify(f)}) — a finding must be structured data { ${FINDING_KEYS.join(', ')} }, not prose`);
    assert.ok(f !== null && !Array.isArray(f), `${label}: finding[${i}] must be a plain object`);
    for (const k of FINDING_KEYS) {
      assert.ok(k in f, `${label}: finding[${i}] is missing "${k}" — the finding contract is { ${FINDING_KEYS.join(', ')} }`);
    }
    assert.equal(typeof f.path, 'string', `${label}: finding[${i}].path must be a JSON path string so a fix can be routed`);
    assert.equal(typeof f.rule, 'string', `${label}: finding[${i}].rule must be a stable rule id so regressions can be counted`);
  }
  return findings;
}

/** Assert some finding's `path` matches — the routable half of the contract. */
function assertPath(findings, re, what) {
  assert.ok(findings.some((f) => typeof f?.path === 'string' && re.test(f.path)),
    `no finding with a path matching ${re} — ${what} is not reported at a routable path.\n` +
    `findings: ${JSON.stringify(findings, null, 2)}`);
}

// The single blueprint that violates seven independent parts of the schema at once.
const MALFORMED = {
  screen: 42,                                                   // not a string
  entity: { fullClassName: 'X', modelType: { name: 1 } },        // modelType.name not a string
  form: { module: 'M', name: 'N', extra: true },                 // unexpected property
  archetype: 'capture',
  layout: { kind: 'field' },                                     // kind=field with no `property`
  bindings: 'not-array',                                         // wrong type
  assertions: [{ id: 'A1' }],                                    // missing predicate/statement
  viewport: 99,                                                  // ill-typed top-level key
};

test('CONTRACT: findings are structured { path, rule, actual, expected, message }', () => {
  assertStructured(findingsOf(MALFORMED), 'the seven-defect blueprint');
});

test('CONTRACT: the seven-defect blueprint yields >=7 findings at >=7 DISTINCT paths', () => {
  const findings = assertStructured(findingsOf(MALFORMED), 'the seven-defect blueprint');
  assert.ok(findings.length >= 7,
    `expected >=7 findings, got ${findings.length} — the validator only samples the schema instead of enforcing it`);
  const paths = new Set(findings.map((f) => f.path));
  assert.ok(paths.size >= 7,
    `expected >=7 DISTINCT paths, got ${paths.size} (${[...paths].join(', ')}) — findings must be per-defect, not per-blueprint`);
});

test('CONTRACT: every one of the seven defects is reported at its own path', () => {
  const findings = assertStructured(findingsOf(MALFORMED), 'the seven-defect blueprint');
  assertPath(findings, /^screen$/, 'screen: 42 is not a string');
  assertPath(findings, /^entity\.modelType(\.name)?$/, 'entity.modelType.name: 1 is not a string');
  assertPath(findings, /^form\.extra$/, 'form.extra: unexpected property (additionalProperties)');
  assertPath(findings, /^bindings$/, 'bindings: "not-array" is not an array');
  assertPath(findings, /^assertions\[0\]/, 'assertions[0]: no predicate/statement');
  // If `viewport` is not typed in today's schema, the contract is still that an
  // unknown or ill-typed TOP-LEVEL key is a finding — a blueprint may not carry
  // silent keys the compiler will ignore.
  assertPath(findings, /^viewport$/, 'viewport: 99 is ill-typed (or unknown, which is equally a finding)');
  assertPath(findings, /^layout$/, 'layout: kind="field" carries no `property`');
});

test('CONTRACT: a datatable with non-array `columns` is a finding', () => {
  const findings = findingsOf({
    ...MALFORMED, screen: 'S', viewport: '1440x900', bindings: [], assertions: [],
    form: { module: 'M', name: 'N' },
    layout: { kind: 'stack', children: [{ kind: 'datatable', name: 'grid', columns: 'nope' }] },
  });
  assertStructured(findings, 'datatable columns: "nope"');
  assertPath(findings, /columns/, 'datatable.columns must be a string[] of bound properties');
});

test('CONTRACT: a grid with column count 0 is a finding', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [{ kind: 'grid', name: 'g', columns: 0 }] },
  });
  assertStructured(findings, 'grid columns: 0');
  assertPath(findings, /columns/, 'a grid of zero columns cannot be compiled (minimum 1)');
});

test('CONTRACT: a `tab` node outside a `tabs` container is a finding', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [{ kind: 'tab', title: 'Orphan', children: [] }] },
  });
  assertStructured(findings, 'orphan tab node');
  assertPath(findings, /^layout/, 'a tab may only be a child of a tabs container — parent context is part of the schema contract');
});

test('CONTRACT: malformed `actions` (object, not array/node) is a finding', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [] }, actions: { foo: 1 },
  });
  assertStructured(findings, 'actions: {foo:1}');
  assertPath(findings, /^actions/, 'a top-level `actions` block must be typed (or rejected as unknown)');
});

test('CONTRACT: an invalid semantic intent role is a finding', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [{ kind: 'text', content: 'x', intent: { role: 'sparkly' } }] },
  });
  assertStructured(findings, 'intent.role: "sparkly"');
  assertPath(findings, /intent/, '"sparkly" is not a semantic role in the schema enum');
});

test('CONTRACT: an unknown TOP-LEVEL property is a finding at that property path', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [] }, totallyUnknownKey: true,
  });
  assertStructured(findings, 'unknown top-level property');
  assertPath(findings, /^totallyUnknownKey$/, 'a top-level key the compiler will silently ignore must be rejected');
});

test('CONTRACT: malformed nested children (children: [42]) is a finding at the child path', () => {
  const findings = findingsOf({
    screen: 'S', entity: { fullClassName: 'X' }, form: { module: 'M', name: 'N' }, archetype: 'capture',
    layout: { kind: 'stack', children: [42] },
  });
  assertStructured(findings, 'children: [42]');
  assertPath(findings, /^layout\.children\[0\]|^layout\/.*\[0\]/, 'a non-object child must be reported at its index');
});
