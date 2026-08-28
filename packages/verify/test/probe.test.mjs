// The probe contract (§3.2.5, §3.8 row 28). The instrument is proved against a RECORDED
// capture from a live Shesha frontend, so these are assertions about real measurements
// rather than about a hand-written sample. Six changes were required of the port; the
// three a fixture can witness are witnessed here, and the CLI proves the fourth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS, CAPABILITY_KEYS, SUMMARY_MAX_BYTES, SUMMARY_MAX_ROWS, PROBE_FN, summarise } from '../src/probe/layout-probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLEAN = path.join(ROOT, 'packages/sfs/test/fixtures/probe/login.probe.json');
const probe = JSON.parse(fs.readFileSync(CLEAN, 'utf8'));

test('change 4: colSpan24 is deleted from the emitted fields, not merely unwritten', () => {
  assert.equal('colSpan24' in FIELDS, false);
  assert.equal(probe.nodes.some((/** @type {any} */ n) => 'colSpan24' in n), false);
});

test('change 1: identity is data-sha-c-name, and the recorded capture carries it', () => {
  const named = probe.nodes.filter((/** @type {any} */ n) => n.name !== null);
  const valid = named.filter((/** @type {any} */ n) => typeof n.name === 'string' && n.name.length > 0);
  assert.ok(named.length > 0, 'the recorded capture found no data-sha-c-name at all');
  assert.equal(valid.length, named.length);
  // The line §3.8 row 28 requires this test to print.
  const summary = summarise(probe);
  const bytes = Buffer.byteLength(JSON.stringify(summary));
  const parentRelative = probe.nodes.some((/** @type {any} */ n) => n.rowBand === 0 && n.rect.y > 0);
  console.log(`data-sha-c-name captured on ${valid.length}/${named.length} named nodes · summary bytes ${bytes} <= ${SUMMARY_MAX_BYTES} · rowBand parent-relative ${parentRelative}`);
  assert.ok(bytes <= SUMMARY_MAX_BYTES);
  assert.ok(parentRelative, 'no node sits at band 0 with a non-zero viewport y, so bands may still be absolute');
});

test('change 2: --summary is bounded to 200 rows and 8 KB', () => {
  const wide = { ...probe, nodes: Array.from({ length: 4000 }, (_, i) => ({ id: i, parentId: null, depth: 0, role: 'container', name: `component-with-a-long-name-${i}`, rect: { x: 0, y: i, w: 100, h: 20 }, rowBand: 0, isContainer: true })) };
  const s = summarise(wide);
  assert.ok(s.rows.length <= SUMMARY_MAX_ROWS, `${s.rows.length} rows`);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= SUMMARY_MAX_BYTES);
});

test('change 3: tabKey is emitted as null with a stated reason, never omitted', () => {
  assert.ok(probe.nodes.every((/** @type {any} */ n) => 'tabKey' in n && n.tabKey === null));
  assert.match(probe.capabilityReasons.tabAssignment, /display:none/);
});

test('change 5: row bands are parent-relative, so a first child is always band 0', () => {
  const byId = new Map(probe.nodes.map((/** @type {any} */ n) => [n.id, n]));
  /** @type {Map<number, any[]>} */
  const kids = new Map();
  for (const n of probe.nodes) {
    if (n.parentId === null) continue;
    const b = kids.get(n.parentId);
    if (b) b.push(n); else kids.set(n.parentId, [n]);
  }
  let checked = 0;
  for (const [pid, ks] of kids) {
    assert.ok(byId.has(pid));
    assert.equal(Math.min(...ks.map((k) => k.rowBand)), 0, `children of ${pid} have no band-0 member`);
    checked += 1;
  }
  assert.ok(checked > 0);
});

test('change 6: the capabilities block names exactly what the instrument cannot see', () => {
  assert.deepEqual(Object.keys(probe.capabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.ok(Object.values(probe.capabilities).every((v) => v === false));
  for (const k of CAPABILITY_KEYS) assert.ok(String(probe.capabilityReasons[k]).length > 20, `${k} has no stated reason`);
});

test('the in-page function serialises without closing over module scope', () => {
  const src = PROBE_FN.toString();
  assert.match(src, /data-sha-c-name/);
  assert.equal(/\bFIELDS\b|\bSUMMARY_MAX_BYTES\b|\bCAPABILITY_KEYS\b/.test(src), false,
    'the probe body references a module-scope binding and would throw inside the page');
});
