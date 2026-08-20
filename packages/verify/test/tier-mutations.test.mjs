// The tier mutation standard (§3.5). Each tier ships one mutation per check class
// that injects a real defect into the compiled clean form and must flip the tier's
// verdict in the NAMED family. A check class with no mutation does not exist, and a
// mutation that does not flip its family is theatre. Both directions are asserted
// here; g-mutation-coverage additionally asserts the static covers[] completeness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictOf } from '@shesha/registry/coverage';
import { compile } from '../../sfs/src/compile/index.mjs';
import { t1Full, mutations as t1Muts, checks as t1Checks } from '../src/tiers/t1-schema.mjs';
import { t2Registry, mutations as t2Muts, checks as t2Checks } from '../src/tiers/t2-registry.mjs';
import { t3Semantic, mutations as t3Muts, checks as t3Checks } from '../src/tiers/t3-semantic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function baseline() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json'), 'utf8');
  const r = compile(src, { source: 'tier-mutations' });
  return { envelope: r.envelope, doc: JSON.parse(String(r.envelope.Markup)), sfs: JSON.parse(src), meta: /** @type {any} */ (r.meta) };
}

/** @param {import('@shesha/registry/coverage').Family[]} fams @param {string} name @param {string} expect */
function familyCaught(fams, name, expect) {
  const fam = fams.find((f) => f.name === name);
  if (!fam) return false;
  return expect === 'partial' ? fam.uninspectable.length > 0 : fam.failures.length > 0;
}

for (const [tier, checks, muts] of /** @type {const} */ ([['t1', t1Checks, t1Muts], ['t2', t2Checks, t2Muts], ['t3', t3Checks, t3Muts]])) {
  test(`${tier}: every non-subsumed check id is covered by a mutation`, () => {
    const covered = new Set(muts.flatMap((m) => m.covers));
    const uncovered = checks.filter((c) => !(/** @type {any} */ (c).subsumed) && !covered.has(c.id)).map((c) => c.id);
    assert.equal(uncovered.length, 0, `uncovered check(s): ${uncovered.join(', ')}`);
  });
  test(`${tier}: at least two mutations`, () => assert.ok(muts.length >= 2));
}

test('t2 baseline passes clean compiler output', () => {
  const b = baseline();
  assert.equal(verdictOf(t2Registry(b.doc, b.meta, {})), 'pass');
});

for (const m of t2Muts) {
  test(`t2 mutation "${m.name}" flips ${m.expectFamily} to ${m.expect}`, () => {
    const b = baseline();
    const ctx = { doc: structuredClone(b.doc), meta: structuredClone(b.meta) };
    m.apply(ctx);
    const fams = t2Registry(ctx.doc, ctx.meta, {});
    assert.equal(verdictOf(fams), m.expect, `verdict did not become ${m.expect}`);
    assert.ok(familyCaught(fams, m.expectFamily, m.expect), `${m.expectFamily} did not catch "${m.name}"`);
  });
}

test('t1 baseline passes clean compiler output', () => {
  const b = baseline();
  assert.equal(verdictOf(t1Full(ROOT, { envelope: b.envelope, doc: b.doc }, { sfs: b.sfs, meta: b.meta })), 'pass');
});

for (const m of t1Muts) {
  test(`t1 mutation "${m.name}" flips ${m.expectFamily} to ${m.expect}`, () => {
    const b = baseline();
    const ctx = { envelope: structuredClone(b.envelope), doc: structuredClone(b.doc), sfs: structuredClone(b.sfs), meta: structuredClone(b.meta), provenance: undefined };
    m.apply(ctx);
    const fams = t1Full(ROOT, { envelope: ctx.envelope, doc: ctx.doc }, { sfs: ctx.sfs, meta: ctx.meta, provenance: ctx.provenance });
    assert.equal(verdictOf(fams), m.expect, `verdict did not become ${m.expect}`);
    assert.ok(familyCaught(fams, m.expectFamily, m.expect), `${m.expectFamily} did not catch "${m.name}"`);
  });
}

// The recorded snapshot lets the six backend checks resolve, so the baseline is a
// pass and a backend mutation is attributable to the mutation, not to a missing source.
const t3Metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/metadata/inline-editable-table.metadata.json'), 'utf8'));

test('t3 baseline passes clean compiler output', () => {
  const b = baseline();
  assert.equal(verdictOf(t3Semantic(b.doc, b.meta, { entity: String(b.envelope.ModelType), metadata: t3Metadata })), 'pass');
});

for (const m of t3Muts) {
  test(`t3 mutation "${m.name}" flips ${m.expectFamily} to ${m.expect}`, () => {
    const b = baseline();
    const ctx = /** @type {any} */ ({ doc: structuredClone(b.doc), meta: structuredClone(b.meta), entity: String(b.envelope.ModelType), contract: undefined });
    m.apply(ctx);
    const fams = t3Semantic(ctx.doc, ctx.meta, { entity: ctx.entity, contract: ctx.contract, metadata: t3Metadata });
    assert.equal(verdictOf(fams), m.expect, `verdict did not become ${m.expect}`);
    assert.ok(familyCaught(fams, m.expectFamily, m.expect), `${m.expectFamily} did not catch "${m.name}"`);
  });
}
