// Unit tests for the ONE canonical probe module + the placement oracle.
//
// Two things are proven here that the contract tests (tests/contract/) only
// pin at source level:
//   1. the Node-side normalizer (computeHealth / finalizeEvidence /
//      buildEvidence) over a SYNTHETIC DOM-shaped probe payload — there is no
//      browser in this process, so the page-context `PROBE_FN` itself is
//      verified only for parse-validity + serialisability (UNVERIFIED-live),
//   2. verify-placement.mjs's resolution rule, every assertion kind, and the
//      four outcomes, both in-process and through the CLI.
//
// The probe module lives in shesha-design-comprehension; these tests live here
// because this is the package with the test harness (`npm test`).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { buildEvidence, EMPTY_EVIDENCE } from '../scripts/render-instrument.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPREHENSION = path.join(HERE, '..', '..', 'shesha-design-comprehension', 'scripts');
const VERIFY_PLACEMENT = path.join(COMPREHENSION, 'verify-placement.mjs');
const require_ = createRequire(import.meta.url);
const probeModule = require_(path.join(COMPREHENSION, 'layout-probe.js'));
const { PROBE_FN, computeHealth, validateEvidence, finalizeEvidence, EVIDENCE_REQUIRED } = probeModule;
const { evaluateAssertions, resolveComponent, TOLERANCES } = await import(`file://${VERIFY_PLACEMENT.replace(/\\/g, '/')}`);

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-placement-unit-'));
const writeJson = (name, obj) => {
  const f = path.join(WORK, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
};

/* ── fixtures ─────────────────────────────────────────────────────────────── */
const comp = (over) => ({
  name: 'x', type: 'container', id: 'x1', parentId: 'root',
  rect: { x: 0, y: 0, w: 100, h: 40 }, columnIndex: 0, tabMembership: null, ...over,
});

const ROOT = comp({ name: 'page', id: 'root', parentId: null, rect: { x: 0, y: 0, w: 1440, h: 900 } });
const CARD = comp({ name: 'detailsCard', id: 'c1', parentId: 'root', rect: { x: 40, y: 100, w: 800, h: 300 } });
const RAIL = comp({ name: 'railCard', id: 'c2', parentId: 'root', rect: { x: 880, y: 100, w: 400, h: 300 } });
const NAME = comp({ name: 'nameField', type: 'textField', id: 'f1', parentId: 'c1', propertyName: 'name', rect: { x: 60, y: 140, w: 300, h: 40 } });
const SERIAL = comp({ name: 'serialField', type: 'textField', id: 'f2', parentId: 'c1', propertyName: 'serialNumber', rect: { x: 400, y: 140, w: 300, h: 40 } });
const TABBED = comp({ name: 'endpointTable', type: 'datatable', id: 't1', parentId: 'c1', tabMembership: 'Endpoints', rect: { x: 60, y: 220, w: 700, h: 120 } });

const evidence = (components, over = {}) => ({
  form: 'His.Facilities/asset-detail',
  url: 'http://localhost:3000/dynamic/His.Facilities/asset-detail',
  timestamp: '2026-01-01T00:00:00.000Z',
  viewport: { w: 1440, h: 900 },
  components,
  rowBands: [{ y: 140, componentIds: components.filter((c) => c.rect?.y === 140).map((c) => c.id) }],
  columnClusters: [{ parentId: 'c1', edges: [60, 400], columnCount: 2, childIds: ['f1', 'f2'] }],
  tabMembership: 'Endpoints',
  controls: { total: 2, tiny: 0 },
  boundRegions: { total: 2, nonEmpty: 2 },
  actionButtonHealth: { groups: 0, collapsed: 0, stacked: 0, realButtons: 0, stackedContainers: [] },
  overflow: { x: 0, y: 0 },
  consoleErrors: [],
  networkErrors: [],
  settled: true,
  screenshotPath: null,
  health: { verdict: 'PASS', issues: [] },
  ...over,
});

const FULL = evidence([ROOT, CARD, RAIL, NAME, SERIAL, TABBED]);
const one = (a, ev = FULL) => evaluateAssertions({ assertions: [a] }, ev).results[0];

/* ── 1. the page-context probe: parse-valid + serialisable ────────────────── */
// UNVERIFIED-live: no browser in this process. This proves the source the
// instrument injects is at least syntactically whole after String() round-trip.

test('PROBE_FN is a function whose serialised source re-parses (injection-safe)', () => {
  assert.equal(typeof PROBE_FN, 'function');
  const src = PROBE_FN.toString();
  assert.ok(src.length > 500, 'the probe source looks truncated');
  assert.doesNotThrow(() => new Function(`return (${src});`), 'the serialised probe does not re-parse');
  // it must not close over Node scope — no require/import/process inside
  assert.doesNotMatch(src, /\brequire\s*\(|\bprocess\.|\bimport\s*\(/, 'the page probe reaches into Node scope');
});

test('the probe module is the SINGLE source of the evidence schema', () => {
  assert.deepEqual(EVIDENCE_REQUIRED.perComponent, ['name', 'type', 'id', 'parentId', 'rect', 'columnIndex', 'tabMembership']);
  assert.deepEqual(EVIDENCE_REQUIRED.rect, ['x', 'y', 'w', 'h']);
  assert.ok(EVIDENCE_REQUIRED.top.includes('screenshotPath') && !EVIDENCE_REQUIRED.top.includes('screenshot'));
  assert.ok(EVIDENCE_REQUIRED.top.includes('timestamp') && !EVIDENCE_REQUIRED.top.includes('capturedAt'));
});

/* ── 2. the Node-side normalizer, over a synthetic DOM-shaped payload ─────── */
// This is exactly the shape PROBE_FN returns from a page; building it by hand
// makes the whole normalizer testable without a browser.
const rawProbe = {
  screen: 'His.Facilities/asset-detail',
  url: 'http://localhost:3000/dynamic/His.Facilities/asset-detail',
  viewport: { w: 1440, h: 900 },
  capturedVia: 'sha-markers',
  components: [
    { ...CARD, tag: 'div', role: 'container', depth: 1, isContainer: true, colSpan24: 13 },
    { ...NAME, tag: 'div', role: 'box', depth: 2, isContainer: false, colSpan24: 9 },
  ],
  rowBands: [{ y: 100, componentIds: ['c1'] }, { y: 140, componentIds: ['f1'] }],
  columnClusters: [{ parentId: 'c1', edges: [60], columnCount: 1, childIds: ['f1'] }],
  multiColumnContainers: [],
  tabMembership: null,
  controls: { total: 6, tiny: 4 },
  boundRegions: { total: 2, nonEmpty: 1 },
  actionButtonHealth: { groups: 1, collapsed: 2, stacked: 1, realButtons: 0, stackedContainers: ['actionRow'] },
  overflow: { x: 120, y: 0 },
  rowSplits: { expectedSideBySide: 2, stacked: ['mainSplit'] },
  spinning: false,
  errorToast: false,
  bodySample: 'Asset detail',
};

test('computeHealth migrates every layout metric the instrument used to own', () => {
  const h = computeHealth(rawProbe);
  assert.equal(h.componentCount, 2);
  assert.deepEqual(h.stackedSplits, ['mainSplit']);
  assert.equal(h.rowsExpectedSideBySide, 2);
  assert.equal(h.tinyControls, 4);
  assert.equal(h.tinyControlRatio, 0.67);
  assert.deepEqual(h.stackedActionRows, ['actionRow']);
  assert.equal(h.collapsedActions, 2);
  assert.equal(h.overflowX, 120);
  assert.equal(h.verdict, 'FAIL');
  // one issue per detector that fired: stacked split, tiny controls, overflow,
  // collapsed "…", buttonGroup with no real button, stacked action row
  assert.equal(h.issues.length, 6, `unexpected issues: ${h.issues.join(' | ')}`);
  assert.ok(h.issues.some((i) => /R-029/.test(i)));
  assert.ok(h.issues.some((i) => /R-057/.test(i)));
});

test('computeHealth is clean on a sound page (and does not fire on <3 controls)', () => {
  const h = computeHealth({
    components: [CARD], controls: { total: 2, tiny: 2 }, rowSplits: { expectedSideBySide: 1, stacked: [] },
    actionButtonHealth: { groups: 1, collapsed: 0, stacked: 0, realButtons: 2, stackedContainers: [] },
    overflow: { x: 8, y: 0 },
  });
  assert.deepEqual(h.issues, []);
  assert.equal(h.verdict, 'PASS');
  assert.equal(h.tinyControlRatio, 0, '<3 controls is too small a sample to judge');
});

test('computeHealth survives an empty payload (a probe that measured nothing)', () => {
  const h = computeHealth({});
  assert.equal(h.componentCount, 0);
  assert.equal(h.verdict, 'PASS');
  assert.deepEqual(h.issues, []);
});

test('buildEvidence projects the raw payload onto the canonical document', () => {
  const { doc, problems } = buildEvidence(rawProbe, {
    form: 'His.Facilities/asset-detail',
    url: rawProbe.url,
    timestamp: '2026-01-01T00:00:00.000Z',
    consoleErrors: ['boom'],
    networkErrors: ['500 /api/x'],
    settled: true,
    screenshotPath: 'C:/tmp/shot.png',
  });
  assert.deepEqual(problems, [], `evidence should be canonical: ${problems.join('; ')}`);
  for (const f of EVIDENCE_REQUIRED.top) assert.ok(f in doc, `missing ${f}`);
  assert.deepEqual(Object.keys(doc).slice(0, EVIDENCE_REQUIRED.top.length), EVIDENCE_REQUIRED.top,
    'the canonical fields must come first, in the schema order');
  assert.equal(doc.screenshotPath, 'C:/tmp/shot.png');
  assert.equal(doc.capturedBy, 'render-instrument');
  assert.equal(doc.health.verdict, 'FAIL');
  assert.deepEqual(doc.components[0].rect, { x: 40, y: 100, w: 800, h: 300 });
  assert.equal(doc.components[0].columnIndex, 0);
  assert.equal(doc.components[1].propertyName, 'name');
});

test('buildEvidence on a probe that returned nothing yields an EMPTY-but-valid document', () => {
  const { doc, problems } = buildEvidence(undefined, { form: 'm/f', url: 'u', timestamp: 't' });
  assert.deepEqual(problems, []);
  assert.deepEqual(doc.components, []);
  assert.deepEqual(doc.overflow, EMPTY_EVIDENCE.overflow);
  assert.equal(doc.settled, false);
});

test('validateEvidence names every missing field, and unmeasurable rects', () => {
  assert.deepEqual(validateEvidence(FULL), []);
  const { form, ...noForm } = FULL;
  assert.ok(validateEvidence(noForm).includes('missing required field: form'));
  const noRects = { ...FULL, components: FULL.components.map((c) => ({ ...c, rect: undefined })) };
  const problems = validateEvidence(noRects);
  assert.ok(problems.some((p) => /no component carries a measurable rect/.test(p)));
});

test('finalizeEvidence THROWS on a non-canonical document unless lenient', () => {
  assert.throws(() => finalizeEvidence({ components: [] }), /evidence is not canonical/);
  const { problems } = finalizeEvidence({ components: [] }, { lenient: true });
  assert.ok(problems.length, 'lenient mode must still report the problems');
});

/* ── 3. resolution — ONE documented rule ─────────────────────────────────── */

test('resolution: exact name wins', () => {
  assert.equal(resolveComponent(FULL.components, 'nameField').component.id, 'f1');
});

test('resolution: case-insensitive name is step 2', () => {
  assert.equal(resolveComponent(FULL.components, 'NAMEFIELD').component.id, 'f1');
});

test('resolution: propertyName is step 3', () => {
  assert.equal(resolveComponent(FULL.components, 'serialNumber').component.id, 'f2');
});

test('resolution: a UNIQUE type match is step 4 ("the datatable")', () => {
  assert.equal(resolveComponent(FULL.components, 'datatable').component.id, 't1');
});

test('resolution: an ambiguous type match resolves to nothing, and says so', () => {
  const r = resolveComponent(FULL.components, 'textField');
  assert.equal(r.component, null);
  assert.match(r.reason, /AMBIGUOUS/);
});

test('resolution: an absent name resolves to nothing, and says so', () => {
  const r = resolveComponent(FULL.components, 'ghostCard');
  assert.equal(r.component, null);
  assert.match(r.reason, /ABSENT/);
  assert.match(r.reason, /ghostCard/);
});

/* ── 4. every assertion kind ─────────────────────────────────────────────── */

test('exists / visible', () => {
  assert.equal(one({ id: 'A', kind: 'exists', subject: 'detailsCard' }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'exists', subject: 'ghost' }).outcome, 'unverifiable');
  assert.equal(one({ id: 'A', kind: 'visible', subject: 'nameField' }).outcome, 'pass');
  const hidden = evidence([ROOT, comp({ name: 'zero', id: 'z', rect: { x: 0, y: 0, w: 0, h: 0 } })]);
  assert.equal(one({ id: 'A', kind: 'visible', subject: 'zero' }, hidden).outcome, 'mismatch');
});

test('parent', () => {
  assert.equal(one({ id: 'A', kind: 'parent', subject: 'nameField', target: 'detailsCard' }).outcome, 'pass');
  const r = one({ id: 'A', kind: 'parent', subject: 'nameField', target: 'railCard' });
  assert.equal(r.outcome, 'mismatch');
  assert.match(r.measured, /detailsCard/);
});

test('contains — geometry, with the documented 2px slack', () => {
  assert.equal(one({ id: 'A', kind: 'contains', subject: 'detailsCard', target: 'nameField' }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'contains', subject: 'railCard', target: 'nameField' }).outcome, 'mismatch');
  // 2px outside the left edge still counts as contained
  const nudged = evidence([ROOT, CARD, comp({ name: 'edge', id: 'e1', parentId: 'c1', rect: { x: 38, y: 140, w: 100, h: 20 } })]);
  assert.equal(one({ id: 'A', kind: 'contains', subject: 'detailsCard', target: 'edge' }, nudged).outcome, 'pass');
  assert.equal(TOLERANCES.CONTAIN_TOL, 2);
});

test('child-count', () => {
  assert.equal(one({ id: 'A', kind: 'child-count', subject: 'detailsCard', count: 3 }).outcome, 'pass');
  const r = one({ id: 'A', kind: 'child-count', subject: 'detailsCard', count: 7 });
  assert.equal(r.outcome, 'mismatch');
  assert.match(String(r.measured), /3 children/);
  assert.equal(one({ id: 'A', kind: 'child-count', subject: 'detailsCard' }).outcome, 'unverifiable');
});

test('order — reading order, y then x', () => {
  assert.equal(one({ id: 'A', kind: 'order', subject: 'nameField', target: 'endpointTable' }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'order', subject: 'endpointTable', target: 'nameField' }).outcome, 'mismatch');
  // same line → x decides
  assert.equal(one({ id: 'A', kind: 'order', subject: 'nameField', target: 'serialField' }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'order', subject: 'serialField', target: 'nameField' }).outcome, 'mismatch');
});

test('same-row — rowBand first, vertical centre as the fallback', () => {
  assert.equal(one({ id: 'A', kind: 'same-row', subject: 'nameField', target: 'serialField' }).outcome, 'pass');
  const r = one({ id: 'A', kind: 'same-row', subject: 'nameField', target: 'endpointTable' });
  assert.equal(r.outcome, 'mismatch');
  assert.match(String(r.measured), /rowBand/);
  // no rowBands at all → the geometric fallback still decides
  const noBands = evidence([ROOT, NAME, SERIAL], { rowBands: [] });
  assert.equal(one({ id: 'A', kind: 'same-row', subject: 'nameField', target: 'serialField' }, noBands).outcome, 'pass');
});

test('same-column', () => {
  const stacked = evidence([ROOT, CARD,
    comp({ name: 'a', id: 'a1', parentId: 'c1', columnIndex: 0, rect: { x: 60, y: 140, w: 200, h: 40 } }),
    comp({ name: 'b', id: 'b1', parentId: 'c1', columnIndex: 0, rect: { x: 62, y: 200, w: 200, h: 40 } }),
    comp({ name: 'c', id: 'd1', parentId: 'c1', columnIndex: 1, rect: { x: 500, y: 140, w: 200, h: 40 } })]);
  assert.equal(one({ id: 'A', kind: 'same-column', subject: 'a', target: 'b' }, stacked).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'same-column', subject: 'a', target: 'c' }, stacked).outcome, 'mismatch');
});

test('tab-membership — and "no tabs measured" is unverifiable, not a mismatch', () => {
  assert.equal(one({ id: 'A', kind: 'tab-membership', subject: 'endpointTable', target: 'Endpoints' }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'tab-membership', subject: 'nameField', target: 'Endpoints' }).outcome, 'mismatch');
  const noTabs = evidence([ROOT, CARD, NAME], { tabMembership: null });
  assert.equal(one({ id: 'A', kind: 'tab-membership', subject: 'nameField', target: 'Details' }, noTabs).outcome, 'unverifiable');
});

test('relative-width — fraction of the parent, ±0.08', () => {
  // nameField 300px inside detailsCard 800px = 0.375
  assert.equal(one({ id: 'A', kind: 'relative-width', subject: 'nameField', ratio: 0.375 }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'relative-width', subject: 'nameField', ratio: 0.42 }).outcome, 'pass', 'within ±0.08');
  assert.equal(one({ id: 'A', kind: 'relative-width', subject: 'nameField', ratio: 0.66 }).outcome, 'mismatch');
  assert.equal(one({ id: 'A', kind: 'relative-width', subject: 'nameField' }).outcome, 'unverifiable');
  assert.equal(TOLERANCES.FRACTION_TOL, 0.08);
});

test('width-ratio — subject:target, ±15% relative', () => {
  // detailsCard 800 : railCard 400 = 2
  assert.equal(one({ id: 'A', kind: 'width-ratio', subject: 'detailsCard', target: 'railCard', ratio: 2 }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'width-ratio', subject: 'detailsCard', target: 'railCard', ratio: 2.2 }).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'width-ratio', subject: 'detailsCard', target: 'railCard', ratio: 4 }).outcome, 'mismatch');
});

test('alignment — edge alignment within 4px; a bad keyword is unverifiable', () => {
  assert.equal(one({ id: 'A', kind: 'alignment', subject: 'detailsCard', target: 'start' }).outcome, 'mismatch',
    'nameField/endpointTable share left edge 60 but serialField is at 400 → not start-aligned');
  const leftAligned = evidence([ROOT, CARD,
    comp({ name: 'a', id: 'a1', parentId: 'c1', rect: { x: 60, y: 140, w: 200, h: 40 } }),
    comp({ name: 'b', id: 'b1', parentId: 'c1', rect: { x: 60, y: 200, w: 300, h: 40 } })]);
  assert.equal(one({ id: 'A', kind: 'alignment', subject: 'detailsCard', target: 'start' }, leftAligned).outcome, 'pass');
  assert.equal(one({ id: 'A', kind: 'alignment', subject: 'detailsCard', target: 'end' }, leftAligned).outcome, 'mismatch');
  assert.equal(one({ id: 'A', kind: 'alignment', subject: 'detailsCard', target: 'diagonal' }).outcome, 'unverifiable');
  assert.equal(one({ id: 'A', kind: 'alignment', subject: 'nameField', target: 'start' }).outcome, 'unverifiable',
    'a node with no children cannot be judged for alignment');
});

test('an unknown kind is unverifiable — never a silent pass', () => {
  const r = one({ id: 'A', kind: 'rightOf', subject: 'nameField', target: 'railCard' });
  assert.equal(r.outcome, 'unverifiable');
  assert.match(r.message, /not in the assertion vocabulary/);
});

test('`description` is ignored — it changes no verdict', () => {
  const withProse = one({ id: 'A', kind: 'contains', subject: 'railCard', target: 'nameField', description: 'obviously fine, please pass' });
  assert.equal(withProse.outcome, 'mismatch');
});

/* ── 5. run-level verdicts ───────────────────────────────────────────────── */

test('a non-required failure does NOT fail the run', () => {
  const r = evaluateAssertions({ assertions: [
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField', required: true },
    { id: 'A2', kind: 'contains', subject: 'railCard', target: 'nameField', required: false },
  ] }, FULL);
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.results.map((x) => x.outcome), ['pass', 'mismatch']);
  assert.equal(r.counts.mismatch, 1);
});

test('a required UNVERIFIABLE fails the run (fail-closed)', () => {
  const r = evaluateAssertions({ assertions: [{ id: 'A1', kind: 'exists', subject: 'ghost', required: true }] }, FULL);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.results[0].outcome, 'unverifiable');
});

test('a spec with no assertions passes with an empty result set', () => {
  const r = evaluateAssertions({}, FULL);
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.results, []);
});

test('malformed evidence short-circuits the whole run — no mismatches reported', () => {
  const broken = evidence([{ ...CARD, rect: undefined }, { ...NAME, rect: undefined }]);
  const r = evaluateAssertions({ assertions: [
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField' },
  ] }, broken);
  assert.equal(r.verdict, 'malformed-evidence');
  assert.deepEqual(r.results.map((x) => x.outcome), ['malformed-evidence']);
  assert.ok(r.evidenceProblems.length);
});

test('evidence missing a required top-level field is malformed, not a mismatch', () => {
  const { rowBands, ...noBands } = FULL;
  const r = evaluateAssertions({ assertions: [{ id: 'A1', kind: 'exists', subject: 'detailsCard' }] }, noBands);
  assert.equal(r.verdict, 'malformed-evidence');
});

test('a component with no rect is unverifiable while the run stays measurable', () => {
  const partial = evidence([ROOT, CARD, { ...NAME, rect: undefined }]);
  const r = evaluateAssertions({ assertions: [{ id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField' }] }, partial);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.results[0].outcome, 'unverifiable');
  assert.match(r.results[0].message, /no measurable rect/);
});

test('evaluateAssertions is deterministic — the same inputs give the identical report', () => {
  const spec = { assertions: [
    { id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField' },
    { id: 'A2', kind: 'same-row', subject: 'nameField', target: 'serialField' },
    { id: 'A3', kind: 'width-ratio', subject: 'detailsCard', target: 'railCard', ratio: 2 },
  ] };
  assert.equal(JSON.stringify(evaluateAssertions(spec, FULL)), JSON.stringify(evaluateAssertions(spec, FULL)));
});

/* ── 6. the CLI (spawned by absolute path) ───────────────────────────────── */
const runCli = (specFile, evidenceFile, extra = []) => {
  const r = spawnSync(process.execPath, [VERIFY_PLACEMENT, '--spec', specFile, '--evidence', evidenceFile, ...extra], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
  return { code: r.status, json, out: `${r.stdout}${r.stderr}` };
};

test('CLI: all required assertions pass → exit 0, and --out writes the same verdict', () => {
  const s = writeJson('cli-pass.spec.json', { assertions: [{ id: 'A1', kind: 'contains', subject: 'detailsCard', target: 'nameField' }] });
  const e = writeJson('cli-pass.evidence.json', FULL);
  const outFile = path.join(WORK, 'cli-pass.verdict.json');
  const { code, json, out } = runCli(s, e, ['--out', outFile]);
  assert.ok(json, `expected JSON on stdout, got: ${out}`);
  assert.equal(code, 0);
  assert.equal(json.verdict, 'pass');
  assert.equal(json.form, 'His.Facilities/asset-detail');
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')), json, '--out must be byte-identical to stdout');
});

test('CLI: a required mismatch → exit 1', () => {
  const s = writeJson('cli-fail.spec.json', { assertions: [{ id: 'A1', kind: 'contains', subject: 'railCard', target: 'nameField' }] });
  const e = writeJson('cli-fail.evidence.json', FULL);
  const { code, json } = runCli(s, e);
  assert.equal(code, 1);
  assert.equal(json.results[0].outcome, 'mismatch');
});

test('CLI: malformed evidence → exit 3, distinct from a mismatch', () => {
  const s = writeJson('cli-bad.spec.json', { assertions: [{ id: 'A1', kind: 'exists', subject: 'detailsCard' }] });
  const e = writeJson('cli-bad.evidence.json', evidence([{ ...CARD, rect: undefined }]));
  const { code, json } = runCli(s, e);
  assert.equal(code, 3, 'a probe that measured nothing must not share an exit code with a placement mismatch');
  assert.equal(json.verdict, 'malformed-evidence');
});

test('CLI: missing arguments / unreadable spec → exit 2 with JSON usage', () => {
  const r = spawnSync(process.execPath, [VERIFY_PLACEMENT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(JSON.parse(r.stdout).error, /--spec/);
  const e = writeJson('cli-usage.evidence.json', FULL);
  const bad = path.join(WORK, 'not-json.spec.json');
  fs.writeFileSync(bad, '{ nope');
  const r2 = runCli(bad, e);
  assert.equal(r2.code, 2);
  assert.match(r2.json.error, /not valid JSON/);
});

test('CLI: the report states the tolerances it used', () => {
  const s = writeJson('cli-tol.spec.json', { assertions: [] });
  const e = writeJson('cli-tol.evidence.json', FULL);
  const { json } = runCli(s, e);
  assert.deepEqual(json.tolerances, TOLERANCES);
});
