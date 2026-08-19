// T1 must ACCEPT clean compiler output and REJECT structural defects an artifact
// cannot render with: a missing id, a duplicate id, a v4-shaped id, an orphan
// parentId, zero components. Both directions on real compiled markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictOf } from '@shesha/registry/coverage';
import { compile } from '../../sfs/src/compile/index.mjs';
import { t1Full, t1Schema, readArtifact } from '../src/tiers/t1-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @returns {{envelope:any, doc:any, meta:any}} */
function compiledClean() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json'), 'utf8');
  const r = compile(src, { source: 'test' });
  return { envelope: r.envelope, doc: JSON.parse(String(r.envelope.Markup)), meta: /** @type {any} */ (r.meta || null) };
}

test('T1 passes clean compiler output', () => {
  const { envelope, doc, meta } = compiledClean();
  assert.equal(verdictOf(t1Full(ROOT, { envelope, doc }, { meta })), 'pass');
});

test('T1.04 fails a component with no id', () => {
  const { envelope, doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  delete clone.components[0].id;
  assert.equal(verdictOf(t1Full(ROOT, { envelope, doc: clone }, { meta })), 'fail');
});

test('T1.06 fails a duplicated id', () => {
  const { envelope, doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  const first = clone.components[0];
  const child = (first.content && first.content.components && first.content.components[0]) || null;
  if (child) child.id = first.id; // force a duplicate
  assert.equal(verdictOf(t1Full(ROOT, { envelope, doc: clone }, { meta })), 'fail');
});

test('T1.08 fails a v4-shaped id under non-legacy', () => {
  const { envelope, doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  clone.components[0].id = '11111111-2222-4333-8444-555555555555'; // version nibble 4, not 5
  assert.equal(verdictOf(t1Full(ROOT, { envelope, doc: clone }, { meta })), 'fail');
});

test('T1.09 fails a form with zero components', () => {
  const { envelope, meta } = compiledClean();
  assert.equal(verdictOf(t1Full(ROOT, { envelope, doc: { components: [] } }, { meta })), 'fail');
});

test('T1 dir-mode still validates the clean fixtures (WP-4)', () => {
  const fams = t1Schema(ROOT, 'packages/sfs/test/fixtures/clean');
  assert.equal(verdictOf(fams), 'pass');
});

test('readArtifact unwraps an envelope to its component tree', () => {
  const { envelope } = compiledClean();
  const art = readArtifact(JSON.stringify(envelope));
  assert.ok(Array.isArray(art.doc.components) && art.doc.components.length > 0);
  assert.ok(art.envelope && art.envelope.Id === art.envelope.OriginId);
});
