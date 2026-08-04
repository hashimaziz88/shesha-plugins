// CONTRACT TESTS — ONE canonical render-evidence schema (rebuild target, expected RED today).
//
// Today there are TWO evidence formats for the same geometry:
//   * shesha-form-edit/scripts/render-instrument.js writes `<slug>.verdict.json`
//     + `<slug>.layout-probe.json` — aggregate counters (controls, realButtons,
//     overflowX, rowsThatStacked) and NO per-component rectangles at all.
//   * shesha-design-comprehension/scripts/layout-probe.js emits per-node rects,
//     colIndex/rowBand and multiColumnContainers — but no console/network errors,
//     no screenshot, no health, and a different key for the timestamp.
//
// Neither can answer "is field X inside card Y" and "did the page load clean" from
// one file, so the placement layer (see placement.contract.test.mjs) has no single
// input. The contract below is the ONE schema both probes must emit.
//
// There is no browser in this test process, so the check is SOURCE-LEVEL: a
// required field counts as emitted only if the producer's source literally emits
// it as an object key (`field:`). That is a deliberately generous test — it can
// only pass by the producer actually naming the field.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');
const RENDER_INSTRUMENT = path.join(SKILLS, 'shesha-form-edit', 'scripts', 'render-instrument.js');
const LAYOUT_PROBE = path.join(SKILLS, 'shesha-design-comprehension', 'scripts', 'layout-probe.js');

/**
 * The canonical render-evidence contract. One file, one shape, both producers.
 *   top      — top-level keys of the evidence document
 *   perComp  — keys required on every entry of `components[]`
 *   rect     — keys required on every `components[].rect`
 */
export const REQUIRED_EVIDENCE_FIELDS = {
  top: [
    'form',              // form identity (<module>/<name>)
    'url',
    'timestamp',         // ISO capture time (NOT `capturedAt` — one name)
    'viewport',
    'components',        // per-component geometry, the placement substrate
    'rowBands',          // y-band grouping, computed once by the producer
    'columnClusters',    // x-band clustering per container
    'tabMembership',     // which tab a component lives in (nullable)
    'controls',          // interactive-control census
    'boundRegions',      // data-binding census
    'actionButtonHealth',// inline/collapsed/stacked verdict for action rows
    'overflow',          // horizontal/vertical overflow measurement
    'consoleErrors',
    'networkErrors',
    'settled',
    'screenshotPath',    // NOT `screenshot` — one name
    'health',            // the aggregate verdict
  ],
  perComp: ['name', 'type', 'id', 'parentId', 'rect', 'columnIndex', 'tabMembership'],
  rect: ['x', 'y', 'w', 'h'],
};

/** Does `src` emit `field` as an object key anywhere? */
const emitsKey = (src, field) => new RegExp(`(^|[^\\w$.'"])${field}\\s*:`, 'm').test(src);

/**
 * The contract checker. Returns the list of required fields the producer does
 * not emit. An empty list is the only passing answer.
 */
export function missingEvidenceFields(src) {
  const missing = [];
  for (const f of REQUIRED_EVIDENCE_FIELDS.top) if (!emitsKey(src, f)) missing.push(f);
  for (const f of REQUIRED_EVIDENCE_FIELDS.perComp) if (!emitsKey(src, f)) missing.push(`components[].${f}`);
  for (const f of REQUIRED_EVIDENCE_FIELDS.rect) if (!emitsKey(src, f)) missing.push(`components[].rect.${f}`);
  return missing;
}

test('CONTRACT: render-instrument.js emits the canonical evidence schema', () => {
  const src = fs.readFileSync(RENDER_INSTRUMENT, 'utf8');
  const missing = missingEvidenceFields(src);
  assert.deepEqual(missing, [],
    'render-instrument.js emits no canonical render evidence for:\n  ' + missing.join('\n  ') +
    '\nThe render instrument is the L5 oracle — its artifact must BE the canonical evidence file, ' +
    'not a counter summary that the placement layer cannot measure against.');
});

test('CONTRACT: comprehension layout-probe.js emits the SAME canonical evidence schema', () => {
  const src = fs.readFileSync(LAYOUT_PROBE, 'utf8');
  const missing = missingEvidenceFields(src);
  assert.deepEqual(missing, [],
    'layout-probe.js emits no canonical render evidence for:\n  ' + missing.join('\n  ') +
    '\nOne schema, two producers — comprehension and form-edit must not disagree about what a probe is.');
});

test('CONTRACT: the two producers emit the SAME field set (no second format)', () => {
  const a = new Set(missingEvidenceFields(fs.readFileSync(RENDER_INSTRUMENT, 'utf8')));
  const b = new Set(missingEvidenceFields(fs.readFileSync(LAYOUT_PROBE, 'utf8')));
  const onlyInstrument = [...b].filter((f) => !a.has(f)); // instrument has it, probe doesn't
  const onlyProbe = [...a].filter((f) => !b.has(f));
  assert.deepEqual({ onlyInstrument, onlyProbe }, { onlyInstrument: [], onlyProbe: [] },
    'the two probes emit DIFFERENT fields — there are still two evidence formats.\n' +
    `only render-instrument emits: ${onlyInstrument.join(', ') || '(none)'}\n` +
    `only layout-probe emits:      ${onlyProbe.join(', ') || '(none)'}`);
});

test('CONTRACT: a hand-built canonical evidence document satisfies the checker (the checker is honest)', () => {
  // Proof the checker is not vacuous: a document that DOES name every field passes.
  const canonical = `export const evidence = {
    form: 'm/f', url: 'u', timestamp: 't', viewport: { w: 1440, h: 900 },
    components: [{ name: 'n', type: 't', id: 'i', parentId: null,
                   rect: { x: 0, y: 0, w: 1, h: 1 }, columnIndex: 0, tabMembership: null }],
    rowBands: [], columnClusters: [], tabMembership: null,
    controls: {}, boundRegions: {}, actionButtonHealth: {}, overflow: {},
    consoleErrors: [], networkErrors: [], settled: true, screenshotPath: 'p', health: 'PASS',
  };`;
  assert.deepEqual(missingEvidenceFields(canonical), [],
    'the contract checker rejects a document that names every canonical field — the checker itself is broken');
});
