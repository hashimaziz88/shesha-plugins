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

test('T1-PROP-UNKNOWN: does not flag the common style-schema props on a type the registry under-declares them for', () => {
  // Corpus grading (Task 5) found border.hideBorder/background.gradient.
  // direction/font.*/shadow.*/direction/overflow/shadowStyle/
  // enableStyleOnReadonly/menuItemShadow.* firing T1-PROP-UNKNOWN across
  // 20-28 DISTINCT component types each — evidence of a registry-scraper
  // gap in a shared style-editor sub-schema, not 24k corpus typos (see
  // docs/corpus-report.md). "container" is used here as the exercising
  // type since its own registry entry does not declare "font".
  const m = {
    components: [{
      id: crypto.randomUUID(), type: 'container', parentId: 'root', version: 7,
      direction: 'vertical', overflow: 'visible', shadowStyle: 'none', enableStyleOnReadonly: true,
      desktop: {
        border: { hideBorder: false },
        background: { gradient: { direction: 'to right' } },
        font: { align: 'left', weight: '400', color: '#000', size: '14px', type: 'Arial' },
        menuItemShadow: { offsetX: 0, offsetY: 0, color: '#000', blurRadius: 0, spreadRadius: 0 },
      },
    }],
  };
  assert.ok(!codes(m).includes('T1-PROP-UNKNOWN'));
});

test('T1-PROP-UNKNOWN: still flags a genuinely unrecognized prop outside the common style-schema allowance', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'container', parentId: 'root', version: 7,
    totallyBogusSettingNoOneWrote: true }] };
  assert.ok(codes(m).includes('T1-PROP-UNKNOWN'));
});

test('T1-PROP-UNKNOWN: does not flag an overrides[] entry (the project\'s sanctioned style-provenance contract)', () => {
  // overrides[] = {prop, value, source, evidence} (see
  // ../shesha-design-comprehension/assets/blueprint.schema.json) is already
  // exempted by T2-STYLE-OFF-TOKEN (tier2.mjs) and T3-RAW-HEX (tier3.mjs) as
  // covered provenance for a hardcoded style value. Before this fix, adding
  // an overrides[] entry to satisfy those two checks mechanically created a
  // brand-new T1-PROP-UNKNOWN finding for overrides/overrides[].prop/.value/
  // .source/.evidence — exactly backwards.
  const m = {
    components: [{
      id: crypto.randomUUID(), type: 'container', parentId: 'root', version: 7,
      overrides: [
        { prop: 'background.color', value: '#123456', source: 'vendor-seed-capture', evidence: 'captured from live render' },
      ],
    }],
  };
  assert.ok(!codes(m).includes('T1-PROP-UNKNOWN'));
});

test('T1-ID-EMPTY: flags a blank id', () => {
  assert.ok(codes(fx('t1-id-empty')).includes('T1-ID-EMPTY'));
});

test('T1-ID-EMPTY: does NOT flag a non-UUID-shaped but non-empty id', () => {
  // The framework's own designer mints nanoid(30) ids (not RFC4122 UUIDs),
  // and dashless-hex / semantic-string ids are common in real production
  // markup (see docs/corpus-report.md) — only a missing/blank/non-string id
  // is a genuine renderability risk (T1-ID-EMPTY), never the SHAPE of a
  // non-empty string.
  const m = { components: [{ id: 'sc-root-container', type: 'textField', parentId: 'root', version: 6 }] };
  assert.ok(!codes(m).includes('T1-ID-EMPTY'));
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

test('T1-TYPE-UNKNOWN: does NOT flag a datatable column-kind "type" (columnType collides with component type)', () => {
  // Corpus grading (Task 5): datatable column definitions carry their OWN
  // `type` field meaning "column kind" ("data"/"action"/"item"/"group"),
  // which collides with the walk's generic "has a type => it's a component"
  // heuristic. On the 100-form RS cohort, 100% of T1-TYPE-UNKNOWN findings
  // were this leak, not a genuine unregistered component type.
  const m = { components: [{
    id: crypto.randomUUID(), type: 'datatable', parentId: 'root', version: 29,
    items: [{ id: crypto.randomUUID(), itemType: 'item', columnType: 'action', type: 'action', caption: '', width: 50 }],
  }] };
  assert.ok(!codes(m).includes('T1-TYPE-UNKNOWN'));
});

test('T1-PARENT-MISSING: does NOT flag a datatable column item (not a real tree node, never has parentId)', () => {
  const m = { components: [{
    id: crypto.randomUUID(), type: 'datatable', parentId: 'root', version: 29,
    items: [{ id: crypto.randomUUID(), itemType: 'item', columnType: 'data', type: 'data', propertyName: 'name' }],
  }] };
  assert.ok(!codes(m).includes('T1-PARENT-MISSING'));
});

test('T1-PARENT-MISSING: still flags a real component whose parentId does not resolve', () => {
  const m = { components: [{
    id: crypto.randomUUID(), type: 'container', parentId: 'root', version: 7,
    components: [{ id: crypto.randomUUID(), type: 'textField', version: 6, parentId: 'some-other-id' }],
  }] };
  assert.ok(codes(m).includes('T1-PARENT-MISSING'));
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
    't1-id-empty', 't1-id-duplicate', 't1-parent-missing', 't1-defaultvalue-nonstring',
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
