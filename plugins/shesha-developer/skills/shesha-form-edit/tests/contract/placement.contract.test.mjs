// CONTRACT TESTS — the placement oracle (rebuild target, expected RED today).
//
// Layer 3 ("placement diff") is documented in shesha-claude-designer/SKILL.md and
// shesha-design-comprehension/references/verification-loop.md as a real gate, but
// NO executable owns it: there is no script that takes a blueprint's `assertions`
// plus a probe artifact and returns a verdict. The gate is therefore performed by
// a model reading a screenshot, which is why it never fails the same way twice.
//
// Target: shesha-design-comprehension/scripts/verify-placement.mjs
//   node verify-placement.mjs --spec <spec.json> --evidence <evidence.json>
//   stdout: JSON { verdict: 'pass'|'fail', results: [ { id, kind, outcome, ... } ] }
//   exit:   0 = every required assertion passed · 1 = a required assertion did not
//           · 2 = usage / malformed input
//
// `outcome` is a CLOSED set, and the three failure modes must stay distinguishable:
//   'pass' · 'mismatch' (measured, and wrong) · 'unverifiable' (subject not in the
//   evidence at all) · 'malformed-evidence' (the evidence cannot be measured).
// Collapsing 'unverifiable' into 'mismatch' is the bug this file exists to prevent:
// "the card is missing" and "the card is in the wrong place" route to different fixes.
//
// The script does not exist yet, so every test here fails with MODULE_NOT_FOUND.
// That is the correct failure — a missing oracle is a failing oracle.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_PLACEMENT = path.join(HERE, '..', '..', '..', 'shesha-design-comprehension', 'scripts', 'verify-placement.mjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'placement-contract-'));

const writeJson = (name, obj) => {
  const f = path.join(WORK, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
};

/** Spawn the placement oracle and parse its JSON verdict. */
function runPlacement(specFile, evidenceFile) {
  const r = spawnSync(process.execPath, [VERIFY_PLACEMENT, '--spec', specFile, '--evidence', evidenceFile],
    { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  assert.notEqual(r.status, null, `verify-placement.mjs did not run at all:\n${out}`);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* asserted below */ }
  assert.ok(json, `verify-placement.mjs must print a JSON verdict on stdout. It printed:\n${out || '(nothing)'}`);
  return { code: r.status, json, out };
}

// ---- fixtures ---------------------------------------------------------------
// A typed assertion: machine-checkable subject/target/kind, never a prose statement.
const spec = (assertions) => ({
  screen: 'Asset Detail',
  entity: { fullClassName: 'His.Facilities.Domain.Asset' },
  form: { module: 'His.Facilities', name: 'asset-detail' },
  archetype: 'record-detail',
  assertions,
});

/** Canonical render evidence (see probe-contract.contract.test.mjs). */
const evidence = (components) => ({
  form: 'His.Facilities/asset-detail',
  url: 'http://localhost:3000/dynamic/His.Facilities/asset-detail',
  timestamp: '2026-01-01T00:00:00.000Z',
  viewport: { w: 1440, h: 900 },
  components,
  rowBands: [{ y: 100, componentIds: components.map((c) => c.id) }],
  columnClusters: [{ parentId: 'root', edges: [0] }],
  tabMembership: null,
  controls: { total: 1, tiny: 0 },
  boundRegions: { total: 1, nonEmpty: 1 },
  actionButtonHealth: { groups: 0, collapsed: 0, stacked: 0 },
  overflow: { x: 0, y: 0 },
  consoleErrors: [],
  networkErrors: [],
  settled: true,
  screenshotPath: path.join(WORK, 'shot.png'),
  health: 'PASS',
});

const CARD = {
  name: 'detailsCard', type: 'container', id: 'c1', parentId: 'root',
  rect: { x: 40, y: 100, w: 800, h: 300 }, columnIndex: 0, tabMembership: null,
};
const FIELD_INSIDE = {
  name: 'nameField', type: 'textField', id: 'f1', parentId: 'c1',
  rect: { x: 60, y: 140, w: 300, h: 40 }, columnIndex: 0, tabMembership: null,
};
const FIELD_OUTSIDE = {
  ...FIELD_INSIDE, parentId: 'root', rect: { x: 60, y: 900, w: 300, h: 40 },
};

// ---- the four outcomes -----------------------------------------------------

test('CONTRACT: a satisfied required assertion returns verdict "pass" and exit 0', () => {
  const s = writeJson('pass.spec.json', spec([
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
  ]));
  const e = writeJson('pass.evidence.json', evidence([CARD, FIELD_INSIDE]));
  const { code, json } = runPlacement(s, e);
  assert.equal(json.verdict, 'pass', 'nameField IS inside detailsCard — the oracle must say pass');
  assert.equal(code, 0, 'a passing placement verdict must exit 0');
  assert.equal(json.results?.[0]?.outcome, 'pass');
  assert.equal(json.results?.[0]?.id, 'A1', 'each result must carry the assertion id it answers');
});

test('CONTRACT: a failing required assertion returns "mismatch" WITH expected + measured facts', () => {
  const s = writeJson('fail.spec.json', spec([
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
  ]));
  const e = writeJson('fail.evidence.json', evidence([CARD, FIELD_OUTSIDE]));
  const { code, json } = runPlacement(s, e);
  assert.equal(json.verdict, 'fail', 'nameField sits outside detailsCard — the oracle must fail');
  assert.equal(code, 1, 'a failed required assertion must exit non-zero (1)');
  const r = json.results?.[0];
  assert.equal(r?.outcome, 'mismatch', 'a measured-and-wrong assertion is a MISMATCH');
  assert.ok(r?.expected !== undefined, 'a mismatch must state what was EXPECTED — a fix cannot be routed from "fail"');
  assert.ok(r?.measured !== undefined, 'a mismatch must state what was MEASURED — the number is the evidence');
});

test('CONTRACT: an unverifiable required assertion is DISTINCT from a mismatch', () => {
  // detailsCard is not in the evidence at all: nothing was measured, so nothing
  // mismatched. Reporting this as a mismatch sends the fix to the wrong place.
  const s = writeJson('unverifiable.spec.json', spec([
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
  ]));
  const e = writeJson('unverifiable.evidence.json', evidence([FIELD_INSIDE]));
  const { code, json } = runPlacement(s, e);
  assert.equal(json.verdict, 'fail', 'an unverifiable REQUIRED assertion fails the gate (fail-closed)');
  assert.equal(code, 1);
  const r = json.results?.[0];
  assert.equal(r?.outcome, 'unverifiable',
    `subject "detailsCard" is absent from the evidence — outcome must be "unverifiable", got "${r?.outcome}". ` +
    '"missing" and "misplaced" route to different fixes and must never share an outcome.');
  assert.match(String(r?.message ?? ''), /detailsCard/,
    'the unverifiable finding must name the subject it could not find');
});

test('CONTRACT: malformed evidence is a "malformed-evidence" outcome, never a mismatch', () => {
  // Components with no rects cannot be measured. Silently treating unmeasurable
  // geometry as a placement mismatch is how a broken probe becomes a "design bug".
  const s = writeJson('malformed.spec.json', spec([
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
  ]));
  const broken = evidence([{ ...CARD, rect: undefined }, { ...FIELD_INSIDE, rect: undefined }]);
  const e = writeJson('malformed.evidence.json', broken);
  const { code, json } = runPlacement(s, e);
  assert.notEqual(code, 0, 'unmeasurable evidence must not exit 0');
  const outcomes = (json.results ?? []).map((r) => r.outcome);
  assert.ok(json.verdict === 'malformed-evidence' || outcomes.includes('malformed-evidence'),
    `expected a "malformed-evidence" outcome, got verdict="${json.verdict}" outcomes=[${outcomes.join(', ')}] — ` +
    'a probe that measured nothing is an infrastructure failure, not a placement mismatch');
  assert.ok(!outcomes.includes('mismatch'),
    'malformed evidence must NOT be reported as a placement mismatch');
});

test('CONTRACT: `outcome` is a closed set across every result', () => {
  const OUTCOMES = new Set(['pass', 'mismatch', 'unverifiable', 'malformed-evidence']);
  const s = writeJson('closed.spec.json', spec([
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
    { id: 'A2', kind: 'rightOf', subject: 'nameField', target: 'detailsCard', required: false },
    { id: 'A3', kind: 'contains', subject: 'ghostCard', target: 'nameField', required: false },
  ]));
  const e = writeJson('closed.evidence.json', evidence([CARD, FIELD_INSIDE]));
  const { json } = runPlacement(s, e);
  assert.equal(json.results?.length, 3, 'one result per assertion, required or not');
  for (const r of json.results ?? []) {
    assert.ok(OUTCOMES.has(r.outcome),
      `outcome "${r.outcome}" (assertion ${r.id}) is outside the closed set {${[...OUTCOMES].join(', ')}}`);
  }
});
