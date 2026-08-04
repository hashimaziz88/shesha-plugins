/**
 * Phase 0 contract tests.
 *
 * These assert the SHAPE of derived ground truth and pin five versions that were
 * hand-verified against the framework source. The pins are the only place in this
 * toolchain where a Shesha fact is written down by a human, and they exist precisely
 * so that a regression in the derivation is caught rather than absorbed.
 *
 * Run:  node --test tests/
 *
 * Requires a ground-truth.json produced by:
 *   node scripts/shesha.mjs probe --app <shesha-app> [--no-backend]
 * Point at one explicitly with SHESHA_GROUND_TRUTH=<path>. Without it the suite skips
 * rather than inventing a fixture — a test that passes against a stub proves nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const CANDIDATES = [
  process.env.SHESHA_GROUND_TRUTH,
  'C:/Users/Hashim/Downloads/boxfusion.test/.shesha/ground-truth.json',
].filter(Boolean);

/**
 * Hand-verified against shesha-framework @ releases/0.45 migrator chains.
 * Each value is max(.add(n)) in the named source file.
 */
const PINNED_VERSIONS = {
  // src/designer-components/dataTable/table/tableComponent.tsx — .add(0)….add(29)
  datatable: 29,
  // src/designer-components/container/containerComponent.tsx — …5,6,7
  container: 7,
  // src/designer-components/text/index.tsx — …3,4,5
  text: 5,
  // src/designer-components/card/index.tsx — 1,2,3
  card: 3,
  // src/designer-components/collapsiblePanel/collapsiblePanelComponent.tsx — .add(0)….add(9)
  collapsiblePanel: 9,
};

/**
 * Container slots, hand-verified from source. Non-uniform by design: 0.45 has no generic
 * `children`, so a compiler must read these per type.
 * collapsiblePanelComponent.tsx:164 — ['header', 'content', 'customHeader']
 */
const PINNED_CONTAINERS = {
  card: ['header', 'content'],
  collapsiblePanel: ['header', 'content', 'customHeader'],
  tabs: ['tabs'],
  wizard: ['steps'],
  columns: ['columns'],
};

/** The measured production working set. A probe that loses any of these is broken. */
const WORKING_SET = [
  'text',
  'container',
  'textField',
  'buttonGroup',
  'autocomplete',
  'card',
  'validationErrors',
  'dropdown',
  'datatableContext',
  'datatable',
  'numberField',
  'refListStatus',
  'alert',
  'checkbox',
  'dateField',
  'collapsiblePanel',
  'tabs',
  'entityPicker',
  'datalist',
  'subForm',
];

let gt = null;
let source = null;

before(() => {
  for (const p of CANDIDATES) {
    if (p && existsSync(p)) {
      gt = JSON.parse(readFileSync(p, 'utf8'));
      source = p;
      break;
    }
  }
});

after(() => {
  if (!gt) {
    process.stderr.write(
      '\n  NOTE: no ground-truth.json found; shape tests were skipped.\n' +
        '        Generate one:  node scripts/shesha.mjs probe --app <shesha-app> --no-backend\n' +
        '        Or set SHESHA_GROUND_TRUTH=<path>.\n\n'
    );
  }
});

describe('ground truth: artefact', () => {
  it('exists and parses', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.equal(typeof gt, 'object');
    assert.equal(gt.$schema, 'shesha-frontend-forms/ground-truth/1');
    assert.ok(gt.generatedAt, 'generatedAt is stamped');
  });

  it('targets Shesha 0.45 and records a drift guard', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.equal(gt.framework.generation, '0.45');
    assert.match(gt.framework.version, /^0\.45\./);
    // Everything downstream is derived from one specific build of one specific bundle.
    assert.match(gt.framework.driftGuard.moduleSha256, /^[0-9a-f]{64}$/);
  });

  it('records the React version it rendered against', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.match(gt.react, /^18\./);
  });

  it('derived cleanly — no console errors, no page errors', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.deepEqual(gt.diagnostics.consoleErrors, [], 'in-page console errors');
    assert.deepEqual(gt.diagnostics.pageErrors, [], 'in-page exceptions');
  });

  it('records split bundle/render timing and the cache key', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Phase 3's `preview` shares the bundle path under a sub-10s budget, so the two
    // costs must be separable — a single elapsedMs cannot tell you whether a regression
    // is in bundling (cacheable) or rendering (not).
    assert.ok(Number.isFinite(gt.timing.bundleMs), 'bundleMs missing');
    assert.ok(Number.isFinite(gt.timing.renderMs), 'renderMs missing');
    assert.equal(typeof gt.timing.cacheHit, 'boolean');
    assert.match(gt.timing.cacheKey, /^[0-9a-f]{16}$/);
    // Measured: cold bundle ~4300ms, warm ~70-120ms. A warm build above 1s means the
    // cache key is churning and Phase 3's budget is at risk.
    if (gt.timing.cacheHit) {
      assert.ok(gt.timing.bundleMs < 1000, `warm bundle took ${gt.timing.bundleMs}ms — cache key churning?`);
    }
  });
});

describe('ground truth: registry', () => {
  it('is non-empty', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.ok(Object.keys(gt.registry).length > 50, `only ${Object.keys(gt.registry).length} types`);
  });

  it('every entry has type, name, and an integer-or-explicit-null lastVersion', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    for (const [key, d] of Object.entries(gt.registry)) {
      assert.equal(d.type, key, `${key}: type mismatch`);
      assert.equal(typeof d.name, 'string', `${key}: name is not a string`);
      assert.ok(d.name.length > 0, `${key}: name is empty`);
      const v = d.lastVersion;
      assert.ok(
        v === null || (Number.isInteger(v) && v >= 0),
        `${key}: lastVersion must be a non-negative integer or explicit null, got ${JSON.stringify(v)}`
      );
      // A null must be because there is no migrator, never because derivation failed.
      if (v === null) {
        assert.equal(d.migratorPresent, false, `${key}: null lastVersion but a migrator is present`);
      }
      assert.equal(d.migratorError, null, `${key}: migrator threw: ${d.migratorError}`);
    }
  });

  it('derives no version by accident — every non-null has a recorded chain', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    for (const [key, d] of Object.entries(gt.registry)) {
      if (d.lastVersion === null) continue;
      assert.ok(
        Array.isArray(d.migrationVersions) && d.migrationVersions.length > 0,
        `${key}: lastVersion ${d.lastVersion} with no recorded migration chain`
      );
      assert.equal(
        d.lastVersion,
        Math.max(...d.migrationVersions),
        `${key}: lastVersion is not max(chain)`
      );
    }
  });

  it('contains the measured production working set', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const missing = WORKING_SET.filter((x) => !gt.registry[x]);
    assert.deepEqual(missing, [], `missing from registry: ${missing.join(', ')}`);
  });

  it('contains `columns` so the kit can exclude it explicitly, not silently miss it', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // R-028: never use the Shesha columns component. Excluding a type you cannot see is
    // indistinguishable from a broken probe, so the registry must carry it.
    assert.ok(gt.registry.columns, '`columns` absent from the registry');
    assert.deepEqual(gt.registry.columns.customContainerNames, ['columns']);
  });

  it('pins five hand-verified versions', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    for (const [type, expected] of Object.entries(PINNED_VERSIONS)) {
      assert.ok(gt.registry[type], `${type} missing from registry`);
      assert.equal(
        gt.registry[type].lastVersion,
        expected,
        `${type}: derived ${gt.registry[type].lastVersion}, source says ${expected}`
      );
    }
  });

  it('pins container slots — 0.45 has no generic children', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    for (const [type, expected] of Object.entries(PINNED_CONTAINERS)) {
      assert.ok(gt.registry[type], `${type} missing from registry`);
      assert.deepEqual(
        gt.registry[type].customContainerNames,
        expected,
        `${type}: container slots drifted`
      );
    }
  });

  it('records a settings property surface for the working set', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Phase 3 generates mirror-kit props from this. An empty surface on a real input
    // component means the settings-markup walk failed.
    const inputs = ['textField', 'dropdown', 'numberField', 'checkbox', 'autocomplete'];
    for (const type of inputs) {
      const s = gt.registry[type].settings;
      assert.equal(s.error, null, `${type}: settings walk errored: ${s.error}`);
      assert.ok(s.propertyNames.length > 5, `${type}: only ${s.propertyNames.length} settings props`);
    }
  });
});

describe('ground truth: honesty', () => {
  it('declares what it could not derive', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.ok(Array.isArray(gt.gaps));
    const ids = gt.gaps.map((g) => g.id);
    // Both are real 0.45 limitations, verified: getDefaultStyles() does not exist and
    // defaultStyles is not on IToolboxComponent; migrateFormSettings is not exported.
    assert.ok(ids.includes('defaultStyles'), 'defaultStyles gap not declared');
    assert.ok(ids.includes('formSettingsVersion'), 'formSettingsVersion gap not declared');
    for (const g of gt.gaps) {
      assert.ok(g.why && g.why.length > 20, `gap ${g.id} has no reason`);
      assert.ok(g.blocks, `gap ${g.id} does not say what it blocks`);
    }
  });

  it('records the backend outcome explicitly rather than implying success', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    assert.equal(typeof gt.backend.reachable, 'boolean');
    if (!gt.backend.reachable) {
      assert.ok(
        gt.backend.error !== undefined,
        'unreachable backend must record why, so an empty live half is never mistaken for an empty app'
      );
    }
  });
});

describe('ground truth: live half (when present)', () => {
  it('resolved entities and a dataType grid', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    if (!gt.backend.reachable) return t.skip('backend was not reachable for this probe');
    assert.ok(gt.backend.entities.length > 0, 'no entities');
    for (const e of gt.backend.entities) {
      assert.equal(typeof e.fullClassName, 'string');
      assert.ok(e.fullClassName.includes('.'), `${e.fullClassName} does not look like a full class name`);
    }
    // The grid must come from real metadata, not the fallback, when the backend answered.
    assert.ok(gt.backend.dataTypeGrid.length > 0, 'empty dataType grid');
  });

  it('reference-list items carry their own colour where set', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    if (!gt.backend.reachable) return t.skip('backend was not reachable for this probe');
    const lists = Object.values(gt.backend.referenceLists);
    if (lists.length === 0) return t.skip('this app has no reference lists');
    for (const l of lists) {
      for (const item of l.items) {
        // R-036: refListStatus fill comes ONLY from the item's own colour, so the field
        // must be captured even when null — a missing key is indistinguishable from grey.
        assert.ok('color' in item, `${l.name}: item has no color key`);
      }
    }
  });
});

/**
 * The harvested prop TYPES, added Phase 8.
 *
 * Two bugs made this worth pinning. The walker did not recurse into `inputs`, which is
 * settingsInputRow's child array and where most 0.45 settings fields actually live — so the
 * harvest silently returned 34 enums instead of 700 and every appearance channel on `text` was
 * missing. And the editor type was read from `type`, which is the generic wrapper
 * ("settingsInput", 490 times), not from `inputType` where the real editor is.
 *
 * Both failures were SILENT: a smaller-but-plausible result, no error. So the numbers are
 * asserted with floors, not just "is non-empty".
 */
describe('harvested prop types', () => {
  it('reaches the appearance channels on text, with their real value sets', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const pt = gt.registry.text.settings.propTypes;
    assert.ok(pt, 'text has no harvested propTypes');
    assert.deepEqual(pt.textType.values, ['span', 'paragraph', 'title']);
    assert.deepEqual(pt.contentDisplay.values, ['content', 'name']);
    // The empty string IS a legal contentType. Recording it matters: treat it as illegal and a
    // correct form fails R-058.
    assert.ok(pt.contentType.values.includes(''), 'contentType must include the legal empty value');
    assert.equal(pt.textType.source, 'settings-markup:dropdown');
  });

  it('harvests the whole surface, not a plausible-looking fraction of it', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    let typed = 0;
    let enums = 0;
    let withValues = 0;
    for (const def of Object.values(gt.registry)) {
      const pt = (def.settings && def.settings.propTypes) || {};
      for (const spec of Object.values(pt)) {
        typed += 1;
        if (spec.type === 'enum') {
          enums += 1;
          if (Array.isArray(spec.values) && spec.values.length) withValues += 1;
        }
      }
    }
    // Measured on 0.45.0: 4188 typed props, 700 enums, 697 with static values. The floors sit
    // well under those so a framework upgrade does not fail the build, but far above the broken
    // run's 34 enums so a lost recursion does.
    assert.ok(typed > 2000, `only ${typed} typed props — the walker is probably missing a container key`);
    assert.ok(enums > 400, `only ${enums} enum props — expected ~700; check inputType and the \`inputs\` recursion`);
    assert.ok(withValues / enums > 0.9, `only ${withValues}/${enums} enums carry values — check dropdownOptions/buttonGroupOptions`);
  });
});
