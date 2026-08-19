// T2 must ACCEPT clean compiler output and REJECT real registry defects. A tier
// that only ever passes proves nothing; a tier that fails everything is no better.
// These assert both directions on real compiled markup, so a regression in either
// the tier or the registry it reads flips a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictOf } from '@shesha/registry/coverage';
import { compile } from '../../sfs/src/compile/index.mjs';
import { t2Registry } from '../src/tiers/t2-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @returns {{doc:any, meta:any}} */
function compiledClean() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json'), 'utf8');
  const r = compile(src, { source: 'test' });
  return { doc: JSON.parse(String(r.envelope.Markup)), meta: /** @type {any} */ (r.meta || null) };
}

test('T2 passes clean compiler output (registry conformance)', () => {
  const { doc, meta } = compiledClean();
  assert.equal(verdictOf(t2Registry(doc, meta, {})), 'pass',
    'clean compiled output must satisfy every T2 check — a fail here is a registry gap or a compiler defect, not a passing tier');
});

test('T2.01 fails an unknown component type', () => {
  const { doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  clone.components[0].type = 'ghostField';
  assert.equal(verdictOf(t2Registry(clone, meta, {})), 'fail');
});

test('T2.03 fails a version that is a string, not an integer', () => {
  const { doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  clone.components[0].version = '3';
  assert.equal(verdictOf(t2Registry(clone, meta, {})), 'fail');
});

test('T2.02 fails a version that is not the registry current version', () => {
  const { doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  clone.components[0].version = 9999;
  assert.equal(verdictOf(t2Registry(clone, meta, {})), 'fail');
});

test('T2.20 fails a list form carrying an active submit pipeline', () => {
  const { doc, meta } = compiledClean();
  const clone = JSON.parse(JSON.stringify(doc));
  clone.formSettings = { ...clone.formSettings, dataSubmitterType: 'gql' };
  // strip the inline-edit signal so the exemption does not apply
  /** @param {any} n */
  const strip = (n) => { if (!n || typeof n !== 'object') return; if (n.canEditInline) n.canEditInline = 'no'; for (const k of ['components', 'items', 'columns']) if (Array.isArray(n[k])) n[k].forEach(strip); if (n.content && n.content.components) n.content.components.forEach(strip); };
  clone.components.forEach(strip);
  assert.equal(verdictOf(t2Registry(clone, meta, {})), 'fail');
});
