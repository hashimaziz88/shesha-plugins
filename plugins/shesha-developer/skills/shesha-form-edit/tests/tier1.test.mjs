import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier1 } from '../scripts/lib/tier1.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const codes = (m) => tier1(m, { registry }).map((f) => f.code);

// --- Brief's representative assertions (verbatim) ---

test('a clean form produces no Tier 1 findings', () => {
  assert.deepEqual(tier1(fx('t1-clean'), { registry }), []);
});

test('flags an unknown component type', () => {
  assert.ok(codes(fx('t1-type-unknown')).includes('T1-TYPE-UNKNOWN'));
});

test('does NOT flag a non-authorable type as unknown', () => {
  // datatableContext is isHidden/legacy but appears in 9 production forms.
  // Rejecting it here would make the push hook unusable on real projects.
  const m = { components: [{ id: crypto.randomUUID(), type: 'datatableContext', parentId: 'root', version: 8 }] };
  assert.ok(!codes(m).includes('T1-TYPE-UNKNOWN'));
});

test('exempts a registry-null-version type from the version checks', () => {
  // dataContext genuinely has no migrator; demanding a version would be wrong.
  const m = { components: [{ id: crypto.randomUUID(), type: 'dataContext', parentId: 'root' }] };
  const c = codes(m);
  assert.ok(!c.includes('T1-VERSION-MISSING'));
  assert.ok(!c.includes('T1-VERSION-STALE'));
});

test('flags a versionless component whose type IS versioned', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root' }] };
  assert.ok(codes(m).includes('T1-VERSION-MISSING'));
});

test('flags a stale version', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'datatable', parentId: 'root', version: 11 }] };
  assert.ok(codes(m).includes('T1-VERSION-STALE'));  // registry says 29
});

test('flags a literal-array defaultValue', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root',
    version: 6, defaultValue: ['a', 'b'] }] };
  assert.ok(codes(m).includes('T1-DEFAULTVALUE-NONSTRING'));
});

test('accepts a mustache-string defaultValue', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root',
    version: 6, defaultValue: '{{data.name}}' }] };
  assert.ok(!codes(m).includes('T1-DEFAULTVALUE-NONSTRING'));
});

test('every finding carries a path and a diagnosable message', () => {
  for (const f of tier1(fx('t1-id-duplicate'), { registry })) {
    assert.ok(f.path, `${f.code} has no path`);
    assert.ok(f.message && f.message.length > 10, `${f.code} message is not diagnosable`);
    assert.equal(f.tier, 1);
  }
});

// --- One assertion per code, via fixtures ---

test('T1-PROP-UNKNOWN: flags an unrecognized prop key', () => {
  assert.ok(codes(fx('t1-prop-unknown')).includes('T1-PROP-UNKNOWN'));
});

test('T1-PROP-UNKNOWN: does not flag known dotted/breakpoint-nested props', () => {
  assert.ok(!codes(fx('t1-clean')).includes('T1-PROP-UNKNOWN'));
});

test('T1-ID-NOT-UUID: flags a non-UUID id', () => {
  assert.ok(codes(fx('t1-id-not-uuid')).includes('T1-ID-NOT-UUID'));
});

test('T1-ID-DUPLICATE: flags two components sharing one id', () => {
  assert.ok(codes(fx('t1-id-duplicate')).includes('T1-ID-DUPLICATE'));
});

test('T1-PARENT-MISSING: flags a parentId that does not resolve to an ancestor or "root"', () => {
  assert.ok(codes(fx('t1-parent-missing')).includes('T1-PARENT-MISSING'));
});

test('T1-EDITCOMPONENT-SHAPE: flags "[default]" on an editComponent', () => {
  const found = tier1(fx('t1-editcomponent-shape'), { registry }).filter((f) => f.code === 'T1-EDITCOMPONENT-SHAPE');
  assert.ok(found.length >= 1);
  assert.ok(found.some((f) => /editComponent/.test(f.path)));
});

test('T1-EDITCOMPONENT-SHAPE: does not flag "[not-editable]" on createComponent', () => {
  const found = tier1(fx('t1-editcomponent-shape'), { registry }).filter((f) => f.code === 'T1-EDITCOMPONENT-SHAPE');
  assert.ok(!found.some((f) => /createComponent/.test(f.path)));
});

test('T1-DOUBLE-SLOT: flags a card with children in both content.components and components', () => {
  assert.ok(codes(fx('t1-double-slot')).includes('T1-DOUBLE-SLOT'));
});

test('T1-SCRIPT-SYNTAX: flags a script string that does not parse', () => {
  assert.ok(codes(fx('t1-script-syntax')).includes('T1-SCRIPT-SYNTAX'));
});

test('T1-JSON-UNSAFE: flags a script string containing a template literal', () => {
  assert.ok(codes(fx('t1-json-unsafe')).includes('T1-JSON-UNSAFE'));
});

test('T1-JSON-UNSAFE: flags a raw newline inside a script string', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root',
    version: 6, onChangeCustom: 'const a = 1;\nconst b = 2;' }] };
  assert.ok(codes(m).includes('T1-JSON-UNSAFE'));
});

test('T1-TYPE-UNKNOWN: message names the offending type', () => {
  const f = tier1(fx('t1-type-unknown'), { registry }).find((x) => x.code === 'T1-TYPE-UNKNOWN');
  assert.ok(f.message.includes('totallyMadeUpWidget'));
});

test('T1-VERSION-STALE: message names both the actual and expected version', () => {
  const f = tier1(fx('t1-version-stale'), { registry }).find((x) => x.code === 'T1-VERSION-STALE');
  assert.ok(f.message.includes('11'));
  assert.ok(f.message.includes('29'));
  assert.equal(f.expected, 29);
  assert.equal(f.actual, 11);
});

test('every finding on every fixture is tier 1 / severity fail with a path', () => {
  const fixtures = [
    't1-type-unknown', 't1-prop-unknown', 't1-version-missing', 't1-version-stale',
    't1-id-not-uuid', 't1-id-duplicate', 't1-parent-missing', 't1-defaultvalue-nonstring',
    't1-editcomponent-shape', 't1-double-slot', 't1-script-syntax', 't1-json-unsafe',
  ];
  for (const name of fixtures) {
    const findings = tier1(fx(name), { registry });
    assert.ok(findings.length >= 1, `${name} produced no findings`);
    for (const f of findings) {
      assert.equal(f.tier, 1);
      assert.equal(f.severity, 'fail');
      assert.ok(f.path);
      assert.ok(f.message && f.message.length > 10);
    }
  }
});
