import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, sentenceCaseLabel } from '../scripts/normalize-form.mjs';
import { flatten } from '../scripts/lib/walk.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const tokens = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json'), 'utf8'));

const ctx = { registry, roles, tokens };
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));

const t1codes = (m) => tier1(m, { registry }).map((f) => f.code);
const t2codes = (m) => tier2(m, { registry, roles, flows: {} }).map((f) => f.code);

// The real 100-form corpus dump lives outside the repo (scratchpad, never
// committed — see the task brief). Idempotence is the single most important
// property in this phase, so if the file is missing we still run the
// property, just over the bundled fixtures instead of skipping it.
const CORPUS_PATH = 'C:/Users/Hashim/AppData/Local/Temp/claude/C--Users-Hashim-Documents-Git-Repos-shesha-plugins--claude-worktrees-shesha-designer-fs-watcher-0550e8/6b0a2575-c6c0-4c24-bcd7-4df694a8faa0/scratchpad/forms-rs.jsonl';

// ---------------------------------------------------------------------------
// 1. Idempotence — the single most important test in the phase.
// ---------------------------------------------------------------------------

test('normalize(normalize(f)) deep-equals normalize(f) across the corpus (or the fixture fallback)', () => {
  let records;
  let source;

  if (existsSync(CORPUS_PATH)) {
    const lines = readFileSync(CORPUS_PATH, 'utf8').trim().split('\n').filter(Boolean);
    records = lines.map((line) => {
      const rec = JSON.parse(line);
      return { name: rec.form ?? '(unnamed)', markup: JSON.parse(rec.markup) };
    });
    source = `corpus (${CORPUS_PATH})`;
  } else {
    // Fallback: every bundled tier1/tier2 fixture plus our own clean fixture.
    const names = [
      't1-clean', 't2-clean', 't1-id-empty', 't1-id-duplicate', 't1-parent-missing',
      't1-version-missing', 't2-columns-present', 't2-flexchild-not-container',
      't2-width-on-noncontainer', 't2-flex-no-display', 't2-style-incomplete',
    ];
    records = names.map((n) => ({ name: n, markup: fx(n) }));
    source = 'fixture fallback (corpus file not present)';
  }

  assert.ok(records.length > 0, 'no forms available to test idempotence against');

  let tested = 0;
  for (const { name, markup } of records) {
    const once = normalize(markup, ctx);
    const twice = normalize(once, ctx);
    assert.deepStrictEqual(twice, once, `non-idempotent on form "${name}"`);
    tested += 1;
  }

  // Surfaced so the report can quote an exact count without re-running.
  console.log(`[normalize idempotence] verified ${tested} forms via ${source}`);
});

// ---------------------------------------------------------------------------
// 2. Determinism — same input, byte-identical output.
// ---------------------------------------------------------------------------

test('determinism: normalizing the same input twice (independently) yields byte-identical JSON', () => {
  const m = fx('t1-id-empty');
  const a = JSON.stringify(normalize(m, ctx));
  const b = JSON.stringify(normalize(m, ctx));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// 3. Preservation — component count, ids, propertyNames survive.
// ---------------------------------------------------------------------------

test('preservation: component count and already-valid ids survive when no count-changing transform fires', () => {
  const before = fx('t2-clean');
  const beforeEntries = flatten(before.components);
  const after = normalize(before, ctx);
  const afterEntries = flatten(after.components);

  assert.equal(afterEntries.length, beforeEntries.length, 'component count should be unchanged');

  const beforeIds = beforeEntries.map(({ node }) => node.id).sort();
  const afterIds = afterEntries.map(({ node }) => node.id).sort();
  assert.deepStrictEqual(afterIds, beforeIds, 'already-valid unique ids must not be re-minted');

  const beforePropNames = beforeEntries.map(({ node }) => node.propertyName).filter(Boolean).sort();
  const afterPropNames = afterEntries.map(({ node }) => node.propertyName).filter(Boolean).sort();
  assert.deepStrictEqual(afterPropNames, beforePropNames, 'propertyNames must survive untouched');
});

// ---------------------------------------------------------------------------
// 4. Per-code clearance — one assertion per code the normalizer claims to fix.
// ---------------------------------------------------------------------------

test('clears T1-VERSION-MISSING', () => {
  const before = fx('t1-version-missing');
  assert.ok(t1codes(before).includes('T1-VERSION-MISSING'));
  assert.ok(!t1codes(normalize(before, ctx)).includes('T1-VERSION-MISSING'));
});

test('clears T1-ID-EMPTY', () => {
  const before = fx('t1-id-empty');
  assert.ok(t1codes(before).includes('T1-ID-EMPTY'));
  assert.ok(!t1codes(normalize(before, ctx)).includes('T1-ID-EMPTY'));
});

test('clears T1-ID-DUPLICATE', () => {
  const before = fx('t1-id-duplicate');
  assert.ok(t1codes(before).includes('T1-ID-DUPLICATE'));
  assert.ok(!t1codes(normalize(before, ctx)).includes('T1-ID-DUPLICATE'));
});

test('clears T1-PARENT-MISSING', () => {
  const before = fx('t1-parent-missing');
  assert.ok(t1codes(before).includes('T1-PARENT-MISSING'));
  assert.ok(!t1codes(normalize(before, ctx)).includes('T1-PARENT-MISSING'));
});

test('clears T2-COLUMNS-PRESENT', () => {
  const before = fx('t2-columns-present');
  assert.ok(t2codes(before).includes('T2-COLUMNS-PRESENT'));
  assert.ok(!t2codes(normalize(before, ctx)).includes('T2-COLUMNS-PRESENT'));
});

test('clears T2-FLEX-NO-DISPLAY', () => {
  const before = fx('t2-flex-no-display');
  assert.ok(t2codes(before).includes('T2-FLEX-NO-DISPLAY'));
  assert.ok(!t2codes(normalize(before, ctx)).includes('T2-FLEX-NO-DISPLAY'));
});

test('clears T2-WIDTH-ON-NONCONTAINER', () => {
  const before = fx('t2-width-on-noncontainer');
  assert.ok(t2codes(before).includes('T2-WIDTH-ON-NONCONTAINER'));
  assert.ok(!t2codes(normalize(before, ctx)).includes('T2-WIDTH-ON-NONCONTAINER'));
});

test('clears T2-FLEXCHILD-NOT-CONTAINER', () => {
  const before = fx('t2-flexchild-not-container');
  assert.ok(t2codes(before).includes('T2-FLEXCHILD-NOT-CONTAINER'));
  assert.ok(!t2codes(normalize(before, ctx)).includes('T2-FLEXCHILD-NOT-CONTAINER'));
});

test('clears T2-STYLE-INCOMPLETE (role-declared container)', () => {
  // The tier2 fixture for this code has no `role` (it exercises the CHECK,
  // not the fix) — role expansion only fires when a node declares a role, so
  // this uses a purpose-built fixture that actually triggers our transform.
  const before = {
    components: [{
      id: 'not-a-real-id',
      type: 'container',
      componentName: 'roleSection',
      parentId: 'root',
      role: 'section-card',
    }],
  };
  assert.ok(t2codes(before).includes('T2-STYLE-INCOMPLETE'));
  const after = normalize(before, ctx);
  assert.ok(!t2codes(after).includes('T2-STYLE-INCOMPLETE'));
  assert.equal(after.components[0].role, undefined, 'role is consumed/removed once expanded');
});

// ---------------------------------------------------------------------------
// 5. `columns` -> flex conversion preserves child order and total width.
// ---------------------------------------------------------------------------

test('columns -> flex conversion preserves child order and total width', () => {
  const before = {
    components: [{
      id: 'z1111111-1111-4111-8111-111111111111',
      type: 'columns',
      componentName: 'split',
      parentId: 'root',
      version: 5,
      columns: [
        { id: 'slotA', flex: 12, components: [{ id: 'fA', type: 'textField', propertyName: 'colA', parentId: 'x', version: 6 }] },
        { id: 'slotB', flex: 6, components: [{ id: 'fB', type: 'textField', propertyName: 'colB', parentId: 'x', version: 6 }] },
        { id: 'slotC', flex: 6, components: [{ id: 'fC', type: 'textField', propertyName: 'colC', parentId: 'x', version: 6 }] },
      ],
    }],
  };

  const after = normalize(before, ctx);
  const row = after.components[0];

  assert.equal(row.type, 'container');
  assert.equal(row.components.length, 3);

  // Order preserved: colA, colB, colC, each still one level down inside its column.
  const propNames = row.components.map((col) => col.components[0].propertyName);
  assert.deepStrictEqual(propNames, ['colA', 'colB', 'colC']);

  // Width derived from flex/24, in original proportion.
  const widths = row.components.map((col) => col.desktop.dimensions.width);
  assert.deepStrictEqual(widths, ['50%', '25%', '25%']);

  // Total width preserved (12+6+6 = 24 -> 50+25+25 = 100).
  const total = widths.reduce((sum, w) => sum + parseFloat(w), 0);
  assert.equal(total, 100);

  // No "columns" type survives anywhere in the tree.
  assert.ok(!flatten(after.components).some(({ node }) => node.type === 'columns'));

  // Re-running normalize is a no-op (idempotence for this specific transform).
  assert.deepStrictEqual(normalize(after, ctx), after);
});

// ---------------------------------------------------------------------------
// 6. Sentence-case label rule.
// ---------------------------------------------------------------------------

test('sentence-case: "First Name" -> "First name"', () => {
  assert.equal(sentenceCaseLabel('First Name'), 'First name');
});

test('sentence-case: acronyms survive ("ID", "URL")', () => {
  assert.equal(sentenceCaseLabel('ID'), 'ID');
  assert.equal(sentenceCaseLabel('URL'), 'URL');
  assert.equal(sentenceCaseLabel('DevOps WI URL'), 'DevOps WI URL');
});

test('sentence-case: proper nouns survive ("South Africa")', () => {
  assert.equal(sentenceCaseLabel('South Africa'), 'South Africa');
});

test('sentence-case is idempotent', () => {
  const labels = ['First Name', 'South Africa', 'HTTP Action', 'ID', 'DevOps WI URL', 'Container7fc8d8'];
  for (const l of labels) {
    const once = sentenceCaseLabel(l);
    assert.equal(sentenceCaseLabel(once), once, `not idempotent for "${l}"`);
  }
});

// ---------------------------------------------------------------------------
// 7. Flex-child wrap moves dimensions.width onto the new wrapper.
// ---------------------------------------------------------------------------

test('wraps a bare flex-row child in a container, moving dimensions.width onto the wrapper', () => {
  const before = fx('t2-flexchild-not-container');
  const after = normalize(before, ctx);
  const row = after.components[0];
  const wrapper = row.components[0];
  assert.equal(wrapper.type, 'container');
  assert.equal(wrapper.components[0].type, 'text'); // original child preserved one level down
});

test('wraps a BARE, NO-WIDTH child of a flex-row container whose flex style lives ONLY under desktop (no top-level mirror)', () => {
  // The reported normalizer gap (docs/corpus-report.md Task 9, dashboard.json):
  // real corpus containers carry display/flexDirection ONLY nested under
  // desktop/tablet/mobile, never mirrored at the top level. The old
  // top-level-only isFlexRowNode() never recognised such a container as a
  // flex row at all, so A3 never ran on its children — regardless of
  // whether a child carried a width. This child carries no width whatsoever.
  const before = {
    components: [{
      id: 'b4444444-4444-4444-8444-444444444441',
      type: 'container',
      componentName: 'row',
      parentId: 'root',
      version: 7,
      desktop: { display: 'flex', flexDirection: 'row', gap: 8 },
      components: [{
        id: 'b4444444-4444-4444-8444-444444444442',
        type: 'textField',
        propertyName: 'bareField',
        parentId: 'b4444444-4444-4444-8444-444444444441',
        version: 6,
      }],
    }],
  };
  const after = normalize(before, ctx);
  const row = after.components[0];
  const wrapper = row.components[0];
  assert.equal(wrapper.type, 'container', 'the bare child must be wrapped even with no width and no top-level flex mirror');
  const leaf = wrapper.components[0];
  assert.equal(leaf.type, 'textField');
  assert.equal(leaf.dimensions?.width, '100%', 'the universal container rule: the leaf is explicitly set to width 100%, not left absent');
  assert.equal(t2codes(after).includes('T2-FLEXCHILD-NOT-CONTAINER'), false);

  // Idempotence for this exact fixture, in addition to the corpus-wide check
  // above — a wrapper-inserting transform is the easiest possible way to
  // break this.
  assert.deepStrictEqual(normalize(after, ctx), after);
});

test('a width-less flex-row child is wrapped at width 100%, never "auto" (the row must actually split)', () => {
  // `auto` resolves flex-basis to content size and flex-grow is 0, so each
  // wrapper would hug its own content and the row would never split — the
  // defect that renders two fields as two narrow stubs with an empty track
  // beside them. T2-STYLE-INCOMPLETE cannot catch it: it only asks whether the
  // `width` key is present, and "auto" is present.
  const rowId = 'c5555555-5555-4555-8555-555555555551';
  const before = {
    components: [{
      id: rowId,
      type: 'container',
      componentName: 'row',
      parentId: 'root',
      version: 7,
      desktop: { display: 'flex', flexDirection: 'row', gap: 8 },
      components: [
        { id: 'c5555555-5555-4555-8555-555555555552', type: 'textField', propertyName: 'firstName', parentId: rowId, version: 6 },
        { id: 'c5555555-5555-4555-8555-555555555553', type: 'textField', propertyName: 'lastName', parentId: rowId, version: 6 },
      ],
    }],
  };
  const after = normalize(before, ctx);
  const row = after.components[0];
  assert.equal(row.components.length, 2);
  for (const wrapper of row.components) {
    assert.equal(wrapper.type, 'container');
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      assert.equal(
        wrapper[bp].dimensions.width,
        '100%',
        `${bp}: a width-less row child must get an equal-share basis, not "auto"`,
      );
    }
    // minWidth 0 is what lets the equal bases shrink to (track - gaps) / N.
    assert.equal(wrapper.desktop.dimensions.minWidth, '0');
  }
  assert.deepStrictEqual(normalize(after, ctx), after);
});

test('a flex-row child that DECLARED a width keeps it — the fill default never overrides a real value', () => {
  const rowId = 'c6666666-6666-4666-8666-666666666661';
  const before = {
    components: [{
      id: rowId,
      type: 'container',
      componentName: 'row',
      parentId: 'root',
      version: 7,
      desktop: { display: 'flex', flexDirection: 'row', gap: 16 },
      components: [
        {
          id: 'c6666666-6666-4666-8666-666666666662',
          type: 'textField',
          propertyName: 'mainField',
          parentId: rowId,
          version: 6,
          desktop: { dimensions: { width: 'calc(100% - 348px)' } },
        },
        { id: 'c6666666-6666-4666-8666-666666666663', type: 'textField', propertyName: 'railField', parentId: rowId, version: 6 },
      ],
    }],
  };
  const after = normalize(before, ctx);
  const [mainWrap, railWrap] = after.components[0].components;
  assert.equal(mainWrap.desktop.dimensions.width, 'calc(100% - 348px)', 'a declared width is relocated verbatim');
  assert.equal(railWrap.desktop.dimensions.width, '100%', 'only the width-less sibling takes the fill default');
  assert.deepStrictEqual(normalize(after, ctx), after);
});

test('strips customStyle and remaining dimensions.width from non-containers', () => {
  const before = {
    components: [{
      id: 'y1111111-1111-4111-8111-111111111111',
      type: 'textField',
      propertyName: 'orphanWidth',
      parentId: 'root',
      version: 6,
      customStyle: 'color: red;',
      desktop: { dimensions: { width: '50%' } },
    }],
  };
  const after = normalize(before, ctx);
  const node = after.components[0];
  assert.equal('customStyle' in node, false);
  assert.equal(node.desktop?.dimensions?.width, undefined);
});
