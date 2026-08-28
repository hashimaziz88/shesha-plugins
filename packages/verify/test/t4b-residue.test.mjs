// T4b over the five recorded probes (§3.2.5, §3.8 rows 25-26). The clean probe is a real
// capture from a live Shesha frontend; the four defect probes are minimal subtrees of that
// same capture with one recorded geometry edit each, so every number traces to a
// measurement. The two rules that keep the tier honest — the capability dimension and the
// attribution requirement — are asserted directly, not inferred from a green run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictOf } from '@shesha/registry/coverage';
import { t4bResidue, checks } from '../src/tiers/t4b-residue.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, 'packages/sfs/test/fixtures/probe');
/** @param {string} name */
const probe = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
/** @param {any[]} fams @param {string} name */
const fam = (fams, name) => fams.find((f) => f.name === name);

test('the clean recorded capture passes every residue check', () => {
  const fams = t4bResidue(probe('login.probe'));
  assert.equal(verdictOf(fams), 'pass');
  for (const f of fams) assert.equal(f.failures.length, 0, `${f.name}: ${f.failures.map((/** @type {any} */ x) => x.reason).join('; ')}`);
});

test('every declared check id owns a family that the clean capture walked', () => {
  const fams = t4bResidue(probe('login.probe'));
  for (const c of checks) {
    const f = fam(fams, c.family);
    assert.ok(f, `check ${c.id} names family ${c.family}, which the tier does not declare`);
    assert.ok(f.walked > 0, `${c.id}: family ${c.family} walked nothing`);
  }
});

for (const [file, family, checkId] of /** @type {[string,string,string][]} */ ([
  ['login.probe.overflow', 'overflow', 'T4b.01'],
  ['login.probe.overlap', 'overlap', 'T4b.02'],
  ['login.probe.wrap', 'wrap', 'T4b.03'],
])) {
  test(`${checkId}: the ${family} probe fails in its own family and nowhere else`, () => {
    const fams = t4bResidue(probe(file));
    assert.equal(verdictOf(fams), 'fail');
    const caught = fam(fams, family);
    assert.ok(caught && caught.failures.length > 0, `${family} did not catch it`);
    assert.match(caught.failures[0].reason, new RegExp(checkId.replace('.', '\\.')));
    for (const f of fams) if (f.name !== family) assert.equal(f.failures.length, 0, `${f.name} also failed`);
  });
}

test('T4b.04: a text node wider than its box is truncation', () => {
  const p = probe('login.probe');
  const n = p.nodes.find((/** @type {any} */ x) => ['label', 'heading', 'col-header', 'link', 'button'].includes(x.role));
  n.scroll = { ...n.scroll, w: n.scroll.cw + 63 };
  const fams = t4bResidue(p);
  assert.equal(verdictOf(fams), 'fail');
  assert.match(fam(fams, 'truncation').failures[0].reason, /T4b\.04/);
});

test('a probe with no data-sha-c-name loses attribution, not measurement', () => {
  const fams = t4bResidue(probe('login.probe.no-name'));
  assert.equal(verdictOf(fams), 'partial');
  const notes = fams.flatMap((/** @type {any} */ f) => f.uninspectable);
  assert.ok(notes.length > 0);
  for (const u of notes) {
    assert.match(u.reason, /attribution unavailable/);
    assert.match(String(u.checkId), /^T4b\.0[1-4]$/);
  }
  // The geometry was still measured: a clean document stays clean, and every residue
  // family evaluated real nodes rather than being skipped for want of a name.
  assert.equal(fams.some((/** @type {any} */ f) => f.failures.length > 0), false);
  for (const name of ['overflow', 'overlap', 'wrap', 'truncation']) assert.ok(fam(fams, name).checked > 1, `${name} measured nothing`);
});

test('a real defect on an unnamed node still fails: stripping a name hides nothing', () => {
  const p = probe('login.probe');
  const byId = new Map(p.nodes.map((/** @type {any} */ n) => [n.id, n]));
  const target = p.nodes.find((/** @type {any} */ n) => n.isContainer && !n.name && n.parentId !== null);
  target.scroll = { ...target.scroll, h: target.scroll.ch + 500 };
  let c = byId.get(target.parentId);
  while (c) { if (c.name) { c.name = null; break; } c = byId.get(c.parentId); }
  assert.equal(verdictOf(t4bResidue(p)), 'fail');
});

test('two named controls in different subtrees painted together is an overlap', () => {
  const p = probe('login.probe');
  const byId = new Map(p.nodes.map((/** @type {any} */ n) => [n.id, n]));
  const chain = (/** @type {any} */ n) => { const s = new Set(); let x = byId.get(n.parentId); while (x) { s.add(x.id); x = byId.get(x.parentId); } return s; };
  const named = p.nodes.filter((/** @type {any} */ n) => n.name);
  let pair = null;
  for (let i = 0; i < named.length && !pair; i += 1) {
    for (let j = i + 1; j < named.length && !pair; j += 1) {
      const a = named[i]; const b = named[j];
      if (a.parentId === b.parentId || chain(a).has(b.id) || chain(b).has(a.id)) continue;
      pair = [a, b];
    }
  }
  assert.ok(pair, 'the recorded capture has no two named nodes in different subtrees');
  pair[1].rect = { ...pair[0].rect };
  const fams = t4bResidue(p);
  assert.equal(verdictOf(fams), 'fail');
  assert.match(fam(fams, 'overlap').failures[0].reason, /T4b\.02/);
});

test('a probe inventing a capability key cannot silence a check', () => {
  const p = probe('login.probe');
  p.nodes.find((/** @type {any} */ n) => n.isContainer && n.name).scroll.h += 400;
  p.capabilities = { ...p.capabilities, geometry: false, textMetrics: false };
  const fams = t4bResidue(p);
  assert.equal(verdictOf(fams), 'fail');
  assert.match(fam(fams, 'instrument').failures[0].reason, /capability key/);
});

test('exact abutment is not an overlap, but a tenth of a pixel of paint is', () => {
  /** @param {number} depth */
  const withDepth = (depth) => {
    const p = probe('login.probe');
    /** @type {Map<number, any[]>} */
    const kids = new Map();
    for (const n of p.nodes) { if (n.parentId === null) continue; const b = kids.get(n.parentId); if (b) b.push(n); else kids.set(n.parentId, [n]); }
    const entry = [...kids.entries()].find(([, v]) => v.length >= 2);
    assert.ok(entry, 'no parent has two children');
    const [, ks] = entry;
    const a = ks[0]; const b = ks[1];
    b.rect = { x: a.rect.x, y: a.rect.y + a.rect.h - depth, w: a.rect.w, h: b.rect.h };
    a.position = 'static'; b.position = 'static';
    return fam(t4bResidue(p), 'overlap').failures.length;
  };
  assert.equal(withDepth(0), 0, 'exact abutment was reported as a painted overlap');
  assert.ok(withDepth(0.2) > 0, 'a 0.2px double-paint across a full row was invisible');
  assert.ok(withDepth(1) > 0, 'a 1px double-paint across a full row was invisible');
});

test('only a deliberate z-index excuses an out-of-flow node covering a neighbour', () => {
  const stacked = (/** @type {string} */ zIndex) => {
    const p = probe('login.probe.overlap');
    const kids = p.nodes.filter((/** @type {any} */ n) => n.parentId !== null && n.name);
    const last = kids[kids.length - 1];
    last.position = 'absolute'; last.zIndex = zIndex;
    return fam(t4bResidue(p), 'overlap').failures.length;
  };
  assert.equal(stacked('10'), 0, 'an explicitly stacked overlay was reported as a defect');
  assert.ok(stacked('auto') > 0, 'an out-of-flow node with no stacking decision was excused');
});

test('a probe carrying no measured nodes fails rather than passing vacuously', () => {
  const fams = t4bResidue({ screen: 'empty', capabilities: {}, nodes: [] });
  assert.equal(verdictOf(fams), 'fail');
  const reasons = fams.flatMap((f) => f.failures.map((/** @type {any} */ x) => x.reason));
  assert.ok(reasons.some((r) => /carries no measured nodes/.test(r)), reasons.join('; '));
});
