/**
 * Phase 4 contract tests — the compiler.
 *
 * Exit criterion: JSX -> JSON that `check` passes and that the framework's own round-trip
 * leaves unchanged, with a golden snapshot committed.
 *
 * The golden snapshots in tests/golden/ are committed test fixtures, not generated data
 * assets: they are small, diffable, and exist so a compiler change that alters output is
 * visible in review rather than discovered in a rendered form.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { camelCasePath, chooseType, compileSpec, nanoid, stableId } from '../scripts/lib/compile.mjs';
import { runGates } from '../scripts/lib/gates.mjs';
import { generateKit } from '../scripts/gen-kit.mjs';
import { allComponents } from '../scripts/lib/walk.mjs';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(SKILL_ROOT, 'tests', 'fixtures', 'asset-worklist.spec.jsx');
const APP = 'C:/Users/Hashim/Downloads/boxfusion.test';

let gt = null;
let nodeModulesDir = null;

before(() => {
  const p = process.env.SHESHA_GROUND_TRUTH || join(APP, '.shesha', 'ground-truth.json');
  if (existsSync(p)) {
    gt = JSON.parse(readFileSync(p, 'utf8'));
    nodeModulesDir = join(gt.app.adminportal, 'node_modules');
  }
});

async function compile(themeName = 'shesha', formName = 'astronaut-worklist') {
  const kitDir = join(SKILL_ROOT, '.tmp', `kit-compile-${themeName}`);
  generateKit({ groundTruthPath: join(APP, '.shesha', 'ground-truth.json'), outDir: kitDir, themeName });
  return compileSpec({
    specPath: SPEC,
    kitDir,
    nodeModulesDir,
    groundTruth: gt,
    themeName,
    formName,
    tmpDir: join(SKILL_ROOT, '.tmp', `compile-${themeName}-${formName}`),
  });
}

// =====================================================================================
describe('id generation', () => {
  it('produces nanoid(30)-shaped ids', () => {
    const id = nanoid(30);
    assert.equal(id.length, 30);
    assert.match(id, /^[A-Za-z0-9_-]{30}$/);
  });

  it('is deterministic per form so a snapshot is diffable and a re-push preserves ids', () => {
    // A compile that emits fresh random ids can never be snapshot-compared, and re-pushing
    // it orphans every reference to the old ids [R-025].
    assert.equal(stableId('formA', 'r/0'), stableId('formA', 'r/0'));
    assert.equal(stableId('formA', 'r/0').length, 30);
  });

  it('never collides across forms or across paths', () => {
    assert.notEqual(stableId('formA', 'r/0'), stableId('formB', 'r/0'));
    assert.notEqual(stableId('formA', 'r/0'), stableId('formA', 'r/1'));
  });
});

describe('camelCase bindings [R-004]', () => {
  it('lowercases the first character of every dotted segment', () => {
    // Metadata returns PascalCase paths. Shesha camelCases the QUERY, so a PascalCase
    // column fetches rows and a correct pager count, then renders every cell blank.
    assert.equal(camelCasePath('FullName'), 'fullName');
    assert.equal(camelCasePath('applicant.FullName'), 'applicant.fullName');
    assert.equal(camelCasePath('alreadyCamel'), 'alreadyCamel');
    assert.equal(camelCasePath('A.B.C'), 'a.b.c');
  });
});

describe('the kit DECLARES the type; the framework VALIDATES it', () => {
  /**
   * This is the corrected design. An earlier version tried to SELECT a control from
   * dataTypeSupported and the results were absurd: ranking by narrowness picks `slider` for
   * every int32, and ranking the other way picks `radio` over `dropdown` for every reference
   * list. dataTypeSupported is a compatibility filter, not a preference order, and the
   * signal that would settle it — the toolbox group — is not derivable.
   */
  const PAIRS = [
    ['textField', { dataType: 'string', dataFormat: 'singleline' }],
    ['textArea', { dataType: 'string', dataFormat: 'multiline' }],
    ['numberField', { dataType: 'number', dataFormat: 'int32' }],
    ['dropdown', { dataType: 'reference-list-item', dataFormat: null }],
    ['dateField', { dataType: 'date-time', dataFormat: null }],
    ['checkbox', { dataType: 'boolean', dataFormat: null }],
    ['autocomplete', { dataType: 'entity', dataFormat: null }],
  ];

  it('accepts every declared type the framework says can bind its property', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    for (const [declared, prop] of PAIRS) {
      const r = chooseType(prop, gt.registry, { preferred: declared });
      assert.equal(r.type, declared, `${declared} <- ${prop.dataType}:${prop.dataFormat}`);
      assert.match(r.why, /validated against dataTypeSupported/);
    }
  });

  it('makes a declared/property mismatch a compile error naming both sides', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const r = chooseType({ dataType: 'string', dataFormat: 'singleline' }, gt.registry, { preferred: 'checkbox' });
    assert.equal(r.type, null, 'a checkbox must not silently accept a string');
    assert.equal(r.incompatible, true);
    assert.match(r.why, /compiles to "checkbox"/);
    assert.match(r.why, /cannot bind string:singleline/);
  });

  it('labels an inferred choice as a heuristic rather than a derivation', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Inference survives only as a last resort, and must admit what it is.
    const r = chooseType({ dataType: 'string', dataFormat: 'multiline' }, gt.registry);
    assert.equal(r.inferred, true);
    assert.match(r.why, /^INFERRED/);
  });

  it('excludes components with no settings form, which are designer plumbing', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Both textField and dataContextSelector declare string:singleline, but only textField
    // has a settings form. Without that filter every single-line string became a
    // "DataContext selector".
    const r = chooseType({ dataType: 'string', dataFormat: 'singleline' }, gt.registry);
    assert.equal(r.type, 'textField');
    assert.ok((r.excluded || []).includes('dataContextSelector'), `excluded: ${JSON.stringify(r.excluded)}`);
  });

  it('says so plainly when nothing can bind a type', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const r = chooseType({ dataType: 'no-such-datatype' }, gt.registry);
    assert.equal(r.type, null);
    assert.match(r.why, /no registered component declares support/);
  });

  it('has a complete truth table, not one limited to what this app happens to have', (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    // Sampling only the app's live pairs left textArea's support list EMPTY, because no
    // property in boxfusion.test is string:multiline. The grid is now the union of live
    // pairs and a standing grid.
    assert.ok(gt.registry.textArea.dataTypeSupported.includes('string:multiline'));
    assert.ok(gt.registry.numberField.dataTypeSupported.length > 2);
  });
});

// =====================================================================================
describe('the compiled table-worklist', () => {
  it('passes every offline gate with zero failures AND zero warnings', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const ctx = {
      registry: gt.registry,
      formName: 'astronaut-worklist',
      referenceLists: gt.backend.referenceLists,
      modelTypeName: 'boxfusion.test.Domain.Domain.Astronauts.Astronaut',
      modelProperties: gt.backend.metadata['boxfusion.test.Domain.Domain.Astronauts.Astronaut'].properties,
    };
    const report = runGates(markup, ctx, { skipReason: 'round-trip covered by its own test' });
    assert.deepEqual(report.failures.map((f) => `${f.ruleId || f.gate}: ${f.message}`), []);
    // A compiler over a closed vocabulary should not even produce warnings about its own
    // output; a warning here means the compiler is emitting something questionable.
    const realWarnings = report.warnings.filter((w) => w.gate !== 'round-trip');
    assert.deepEqual(realWarnings.map((w) => `${w.ruleId || w.gate}: ${w.message}`), []);
  });

  it('stamps every version from the derived migrator map', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    for (const { node } of allComponents(markup)) {
      const def = gt.registry[node.type];
      assert.ok(def, `emitted an unregistered type: ${node.type}`);
      if (def.lastVersion === null) {
        assert.equal(node.version, undefined, `${node.type} has no migrator, so it should carry no version`);
      } else {
        assert.equal(node.version, def.lastVersion, `${node.type} version`);
      }
    }
  });

  it('resolves modelType to the {name, module} object, not the class-name string [R-016]', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    assert.deepEqual(markup.formSettings.modelType, { name: 'Astronaut', module: 'boxfusion.test' });
  });

  it('wraps the datatable in a dataContext carrying an explicit entityType [R-005]', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const ctx = allComponents(markup).find((h) => h.node.type === 'datatableContext');
    assert.ok(ctx, 'no datatableContext was emitted');
    assert.equal(typeof ctx.node.entityType, 'string');
    assert.equal(ctx.node.entityType, 'boxfusion.test.Domain.Domain.Astronauts.Astronaut');
    assert.equal(ctx.node.sourceType, 'Entity');
    // The table must be INSIDE it, not a sibling.
    assert.ok((ctx.node.components || []).some((c) => c.type === 'datatable'));
  });

  it('camelCases every datatable column propertyName [R-004]', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const table = allComponents(markup).find((h) => h.node.type === 'datatable');
    assert.ok(table.node.items.length >= 5);
    for (const col of table.node.items) {
      assert.match(col.propertyName, /^[a-z]/, `column ${col.caption} is not camelCase`);
    }
    // The spec wrote PascalCase, exactly as metadata reports it.
    const names = table.node.items.map((c) => c.propertyName);
    assert.ok(names.includes('fullName'), `expected fullName, got ${names.join(',')}`);
    assert.ok(names.includes('specialisationRole'));
  });

  it('pins column widths, because unpinned columns read as uniform grey', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const table = allComponents(markup).find((h) => h.node.type === 'datatable');
    const pinned = table.node.items.filter((c) => c.minWidth !== null);
    assert.ok(pinned.length >= 4, `only ${pinned.length} columns pinned`);
    for (const c of pinned) assert.equal(c.minWidth, c.maxWidth);
  });

  it('forces isInline on the buttonGroup [R-057]', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const bg = allComponents(markup).find((h) => h.node.type === 'buttonGroup');
    assert.ok(bg, 'no buttonGroup emitted');
    assert.equal(bg.node.isInline, true);
    assert.equal(bg.node.items.length, 2);
    assert.equal(bg.node.items.filter((i) => i.buttonType === 'primary').length, 1, 'exactly one primary');
  });

  it('forces contentType "custom" on every text node [R-052]', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const texts = allComponents(markup).filter((h) => h.node.type === 'text');
    assert.ok(texts.length > 5);
    for (const { node } of texts) {
      // A font colour renders ONLY with contentType custom; otherwise antd presets win and
      // the colour is a pure no-op that is invisible in the markup.
      assert.equal(node.contentType, 'custom', `${node.componentName} has no contentType custom`);
    }
  });

  it('fills the card header band, which the shipped PBF form leaves empty', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const cards = allComponents(markup).filter((h) => h.node.type === 'card' && h.node.componentName.startsWith('card'));
    assert.ok(cards.length >= 1);
    const card = cards[0].node;
    assert.ok(card.header && card.header.components.length > 0, 'the card header band is empty');
    const title = card.header.components[0];
    assert.equal(title.desktop.font.color, '#0d685a', 'the band title should carry the brand primary');
  });

  it('emits at least one uppercase micro-label, of which the corpus has 153 and Shesha zero', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const micro = allComponents(markup).filter(
      (h) => h.node.type === 'text' && h.node.desktop && h.node.desktop.font && h.node.desktop.font.size === 11
    );
    assert.ok(micro.length >= 1, 'no 11px micro-label was emitted');
  });

  it('uses borderType "custom" for the stat cards left accent', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const stats = allComponents(markup).filter((h) => h.node.componentName && h.node.componentName.startsWith('stat') && h.node.type === 'card');
    assert.equal(stats.length, 4, 'expected four stat cards');
    for (const { node } of stats) {
      const b = node.desktop.border;
      // borderType "custom" is REQUIRED for a per-side border; without it the accent is
      // dropped and the card reads as a plain white box.
      assert.equal(b.borderType, 'custom');
      assert.ok(b.border.left, 'no left accent');
      assert.equal(b.border.left.width, 3);
    }
    // ...and the four accents differ, because emphasis differs.
    const colours = new Set(stats.map((h) => h.node.desktop.border.border.left.color));
    assert.ok(colours.size >= 3, `expected distinct accents, got ${[...colours].join(',')}`);
  });

  it('writes stylingBox as a STRINGIFIED string, since stylingBoxJson does not exist in 0.45', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const withBox = allComponents(markup).filter((h) => h.node.stylingBox !== undefined);
    assert.ok(withBox.length > 0, 'nothing carried a stylingBox');
    for (const { node } of withBox) {
      assert.equal(typeof node.stylingBox, 'string', `${node.componentName} stylingBox must be a string`);
      const parsed = JSON.parse(node.stylingBox);
      for (const v of Object.values(parsed)) {
        assert.equal(typeof v, 'string', 'stylingBox inner values are strings in 0.45');
      }
    }
    assert.ok(!JSON.stringify(markup).includes('stylingBoxJson'), 'stylingBoxJson does not exist in 0.45');
  });

  it('emits no deprecated field', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { markup } = await compile();
    const json = JSON.stringify(markup);
    for (const dead of ['customVisibility', 'customEnabled', 'allStyles', 'stylingBoxJson']) {
      assert.ok(!json.includes(`"${dead}"`), `emitted deprecated field ${dead}`);
    }
  });

  it('declares what it deferred rather than dropping it silently', async (t) => {
    if (!gt) return t.skip('no ground-truth.json');
    const { report } = await compile();
    // Status pills are out of v1.0 by scope. The spec asks for one, so the compiler must
    // SAY it did not build it — silently dropping it leaves the author believing otherwise.
    assert.ok(report.deferred && report.deferred.length > 0, 'the deferred StatusPill was not reported');
    assert.equal(report.deferred[0].feature, 'StatusPill');
    assert.equal(report.deferred[0].plannedFor, 'v1.1');
    assert.ok(report.warnings.some((w) => /StatusPill/.test(w) && /R-036/.test(w)));
  });
});

// =====================================================================================
describe('golden snapshots', () => {
  for (const themeName of ['shesha', 'wcg']) {
    it(`matches the committed golden for --theme ${themeName}`, async (t) => {
      if (!gt) return t.skip('no ground-truth.json');
      const goldenPath = join(SKILL_ROOT, 'tests', 'golden', `table-worklist.${themeName}.json`);
      if (!existsSync(goldenPath)) return t.skip(`no golden at ${goldenPath}`);
      const { markup } = await compile(themeName);
      const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
      assert.deepEqual(
        markup,
        golden,
        `compiler output drifted from the committed golden for ${themeName}. If the change is intended, regenerate:\n` +
          `  node scripts/shesha.mjs compile --spec tests/fixtures/asset-worklist.spec.jsx --app <app> --form boxfusion.test/astronaut-worklist --theme ${themeName} --out tests/golden/table-worklist.${themeName}.json`
      );
    });
  }

  it('differs between the two goldens only in resolved values, never in structure', () => {
    const shape = (m) => {
      const walk = (arr, out = []) => {
        for (const n of arr || []) {
          out.push(n.type);
          if (n.components) walk(n.components, out);
          for (const s of ['header', 'content']) if (n[s] && n[s].components) walk(n[s].components, out);
        }
        return out;
      };
      return walk(m.components);
    };
    const a = JSON.parse(readFileSync(join(SKILL_ROOT, 'tests', 'golden', 'table-worklist.shesha.json'), 'utf8'));
    const b = JSON.parse(readFileSync(join(SKILL_ROOT, 'tests', 'golden', 'table-worklist.wcg.json'), 'utf8'));
    assert.deepEqual(shape(b), shape(a), 'the two themes produced different component trees');
    assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'the two themes produced identical output — the theme is not applied');
  });
});
