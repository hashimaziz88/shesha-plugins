// Offline eval suite for the compiler + gate chain.
//
// The pipeline's only fast feedback loop. For every blueprint fixture it compiles
// under BOTH shipped themes and runs the three offline gates — so a compiler change
// that breaks markup shows up here instead of in a browser.
//
// WHAT IT ASSERTS, and how:
//
//   * COMPILE + GATE, every fixture, every theme. Unchanged: this is behaviour
//     coverage and the most valuable thing in the file.
//   * SEMANTIC PROJECTIONS for the facts under test — hierarchy, component census,
//     binding wiring, action wiring, page anatomy, theme-role resolution, id
//     determinism. Via tests/lib/project.mjs; see "semantic projections" below.
//   * FULL SERIALIZATION for the FOUR cases where complete output is genuinely the
//     behaviour under test (FULL_SNAPSHOTS). Via tests/lib/snapshot.mjs.
//
// Why only four snapshots. The file used to hold a full serialization of all 13
// fixtures under both shipped themes: 27 files, 17k lines. That is a terrible way to
// ask "is there still exactly one action group?" — a one-token theme change re-records
// thousands of lines and buries the one fact that actually regressed, and reviewers
// stop reading the diff. Worse, the structural facts were theme-INVARIANT (proved
// below), so half the bulk was a byte-for-byte duplicate carrying only colour. The
// projections ask each question directly and name it when it fails.
//
// Snapshot policy lives in tests/lib/snapshot.mjs and is opt-in:
//   UPDATE_SNAPSHOTS=1 npm test    — records/updates, and reports every file it wrote
// A plain run NEVER writes, and a MISSING snapshot FAILS.
//
// It also pins two boundaries:
//   * the golden corpus must not acquire NEW failing rule ids (regression bar for
//     every walker added to validate-guardrails.js), and
//   * the broken-bindings fixture must still FAIL (the gates can catch things).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBlueprint, loadSchema } from '../../shesha-design-comprehension/scripts/validate-blueprint.mjs';
import { loadTheme } from '../scripts/compile/resolve-theme.mjs';
import { compareSnapshot } from './lib/snapshot.mjs';
import { project } from './lib/project.mjs';

// A shipped theme file may be an OVERRIDE (`extends` + only the keys that differ), so every
// assertion about theme CONTENT reads the RESOLVED theme — the same thing the compiler sees.
const themeOf = (t) => loadTheme(t).tokens;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const SCRIPTS = path.join(SKILL, 'scripts');
const FIXTURES = path.join(HERE, 'fixtures');
const SNAPSHOTS = path.join(HERE, '__snapshots__');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'form-edit-pipeline-'));

const THEMES = ['shesha', 'requirements-studio'];
// shesha-bold is the third shipped theme. It rides the compile matrix for ONE fixture
// only — enough to pin that a third theme resolves DIFFERENTLY (its page-header band is
// brand-tinted, not white) without tripling the work on every compiler change.
const EXTRA_THEMES = { 'table-worklist': ['shesha-bold'] };
const BLUEPRINTS = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.blueprint.json')).sort();
const NAMES = BLUEPRINTS.map((f) => f.replace(/\.blueprint\.json$/, ''));
const themesFor = (name) => [...THEMES, ...(EXTRA_THEMES[name] ?? [])];
/** every (fixture, theme) pair the suite compiles — the corpus the projections read */
const CORPUS = NAMES.flatMap((name) => themesFor(name).map((theme) => ({ name, theme, key: `${name}--${theme}` })));

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// ---- the compiled corpus, compiled ONCE ---------------------------------------
// Every test below that needs compiled output reads it from here, memoized per
// (fixture, theme). Previously they read the committed snapshot files, which is why
// deleting a snapshot silently deleted a dozen assertions with it: the assertions were
// parasitic on the snapshot corpus rather than on the compiler. Now they run against
// what the compiler produces on THIS run — which is both stricter and independent of
// which four serializations happen to be committed.
const COMPILED = new Map();
const compiled = (name, theme = 'shesha') => {
  const key = `${name}--${theme}`;
  if (!COMPILED.has(key)) {
    const out = path.join(WORK, `${key}.json`);
    const r = run('compile-blueprint.js', [
      '--blueprint', path.join(FIXTURES, `${name}.blueprint.json`), '--out', out, '--no-live', '--theme', theme,
    ]);
    const text = r.code === 0 && fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    COMPILED.set(key, { ...r, key, name, theme, file: out, text });
  }
  return COMPILED.get(key);
};
/** the parsed compiled document; fails loudly rather than returning a half-thing */
const docOf = (name, theme = 'shesha') => {
  const c = compiled(name, theme);
  assert.ok(c.text, `compile of ${name}@${theme} failed, so this test cannot run:\n${c.out}`);
  return JSON.parse(c.text);
};
/** the semantic projection of that document */
const projectionOf = (name, theme = 'shesha') => project(docOf(name, theme));

// The FOUR cases where COMPLETE serialization is the behaviour under test:
//   table-worklist--shesha        the page archetype end to end: chrome, dataContext,
//                                 datatable presentation, action row — the reference page
//   table-worklist--shesha-bold   the same page under a third theme; its diff against
//                                 the line above IS the proof that a theme diverges
//   asset-capture--shesha         the capture floor: no page chrome, right-aligned footer
//   intent-showcase--shesha       presentation IR: recipe/role/tone/surface intent mapping
// Everything else is asserted by projection.
const FULL_SNAPSHOTS = new Set([
  'table-worklist--shesha',
  'table-worklist--shesha-bold',
  'asset-capture--shesha',
  'intent-showcase--shesha',
]);

test('there are blueprint fixtures to compile', () => {
  assert.ok(BLUEPRINTS.length >= 5, `expected ≥5 blueprint fixtures, found ${BLUEPRINTS.length}`);
});

// ---- blueprint fixtures are valid blueprint IR -------------------------------
// Full JSON-Schema validation against shesha-design-comprehension/schemas/blueprint.schema.json
// — the schema is the contract between comprehension and the compiler. The logic lives in
// shesha-design-comprehension/scripts/validate-blueprint.mjs (the same validator
// compile-blueprint.js runs before it compiles); this test only pins the fixtures
// against it, plus the fixtures-stay-small bar that is a test concern only.
const describeFinding = (f) => `[${f.rule}] ${f.path || '(root)'} — ${f.message}`;

test('every fixture is valid blueprint IR', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));

  for (const f of BLUEPRINTS) {
    const bp = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
    const { findings, nodeCount } = validateBlueprint(bp, schema);
    assert.deepEqual(findings, [], `${f}: invalid blueprint IR —\n  ${findings.map(describeFinding).join('\n  ')}`);
    assert.ok(nodeCount >= 4 && nodeCount <= 60, `${f}: ${nodeCount} nodes — fixtures stay small`);
  }
});

// The validator has teeth: a mutated blueprint must come back with findings, at
// ROUTABLE paths, or the assertion above is vacuous.
test('validateBlueprint rejects a bad archetype and an unknown node key', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));
  const bad = {
    screen: 'Mutant', archetype: 'not-an-archetype',
    entity: {}, form: { module: 'm' },
    layout: { kind: 'stack', bogusKey: 1, children: [{ kind: 'notAKind' }] },
  };
  const { findings } = validateBlueprint(bad, schema);
  const at = (p) => findings.filter((f) => f.path === p);
  for (const [p, rule] of [
    ['archetype', 'not-in-enum'],
    ['entity', 'missing-property'],
    ['form', 'missing-property'],
    ['layout.bogusKey', 'unknown-property'],
    ['layout.children[0].kind', 'not-in-enum'],
  ]) {
    assert.ok(at(p).some((f) => f.rule === rule),
      `expected a "${rule}" finding at path "${p}":\n${findings.map(describeFinding).join('\n')}`);
  }
});

// ---- compile → gates (every fixture, every theme) -----------------------------
// This loop is the behaviour bar and it covers the WHOLE matrix — every fixture
// compiles and clears all three offline gates under every theme it is compiled for.
// Only the snapshot comparison is selective.
for (const { name, theme, key } of CORPUS) {
  const archetype = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.blueprint.json`), 'utf8')).archetype;
  test(`${name} @ ${theme}: compiles and passes every offline gate`, () => {
    const c = compiled(name, theme);
    assert.equal(c.code, 0, `compile failed:\n${c.out}`);
    assert.ok(c.text, 'compiler wrote no output');
    // the compiler must find the theme — a missing theme silently emits neutral defaults
    assert.doesNotMatch(c.out, /theme ".*" not found/, `theme "${theme}" was not found`);

    for (const gate of ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js']) {
      // styledness needs the archetype — its page-anatomy floor only applies to page
      // archetypes, and an archetype is a blueprint fact, not a component.
      const r = run(gate, [c.file, ...(gate === 'validate-styledness.js' ? ['--archetype', archetype] : [])]);
      assert.equal(r.code, 0, `${gate} failed for ${key}:\n${r.out}`);
    }
  });
}

for (const key of [...FULL_SNAPSHOTS].sort()) {
  const [name, theme] = key.split('--');
  test(`${key}: full serialization matches its committed snapshot`, () => {
    assert.ok(NAMES.includes(name), `FULL_SNAPSHOTS names "${name}", which is not a fixture`);
    compareSnapshot(key, compiled(name, theme).text, {
      dir: SNAPSHOTS,
      hint: `${key} is one of the ${FULL_SNAPSHOTS.size} cases where COMPLETE output is the behaviour under test; ` +
        'everything else in this suite is asserted by semantic projection.',
    });
  });
}

// A snapshot nobody compares is worse than no snapshot: it looks like coverage, it
// shows up in review diffs, and it rots. The directory must hold EXACTLY the keep-set.
test('the snapshot directory holds exactly the full-serialization keep-set', () => {
  const onDisk = fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(onDisk, [...FULL_SNAPSHOTS].map((k) => `${k}.json`).sort(),
    'tests/__snapshots__ has drifted from FULL_SNAPSHOTS. An orphan snapshot is compared by nothing — ' +
    'delete it, or add its key to FULL_SNAPSHOTS so it is actually asserted.');
});

// ---- ACTION WIRING projection: inline, one primary, one group [R-007/020/057] --
// EVERY buttonGroup the compiler emits must carry isInline:true — without it the whole
// group folds into an overflow "…" menu, which is invisible in the markup and only shows
// up in a browser. This used to read the committed snapshots (so it only covered fixtures
// that happened to have one); it now reads the whole compiled corpus. On capture
// archetypes the group additionally sits in a right-aligned flex row — its own
// dimensions/stylingBox are measured no-ops, so the container is the only alignment lever.
const CAPTURE_FIXTURES = new Set(['asset-capture', 'react-grammar']);

test('every buttonGroup the compiler emits is inline, with one primary [R-007/R-020/R-057]', () => {
  let seen = 0;
  for (const { name, theme, key } of CORPUS) {
    const { groups } = projectionOf(name, theme);
    assert.ok(groups.length <= 1, `${key}: ${groups.length} action groups — a screen has ONE [R-020]`);
    for (const g of groups) {
      seen++;
      assert.equal(g.isInline, true,
        `${key}: buttonGroup "${g.name}" is not isInline:true — it renders as an overflow "…" menu [R-057]`);
      assert.ok(g.labels.length >= 2, `${key}: buttonGroup "${g.name}" lost its Save/exit pair [R-007]`);
      assert.equal(g.primaries, 1,
        `${key}: buttonGroup "${g.name}" has ${g.primaries} primary buttons — exactly one action is primary [R-007]`);
      assert.equal(g.buttonTypes[0], 'primary', `${key}: the primary must lead the group [R-007]`);
      assert.ok(g.actions.every(Boolean), `${key}: buttonGroup "${g.name}" has an unwired button: ${JSON.stringify(g.actions)}`);
      if (CAPTURE_FIXTURES.has(name)) {
        assert.equal(g.parentDesktop?.display, 'flex',
          `${key}: the capture footer holding "${g.name}" is not a flex box [R-057]`);
        assert.equal(g.parentDesktop?.flexDirection, 'row',
          `${key}: the capture footer holding "${g.name}" is a ${g.parentDesktop?.flexDirection} stack, not a row [R-057]`);
        assert.equal(g.parentDesktop?.justifyContent, 'flex-end',
          `${key}: a capture footer right-aligns its actions [R-057]`);
      }
    }
  }
  assert.ok(seen >= 4, `expected buttonGroups across the compiled corpus, found ${seen}`);
});

// ---- the structural facts are THEME-INVARIANT ---------------------------------
// The load-bearing justification for holding ONE snapshot per fixture instead of one
// per (fixture, theme): a theme may change appearance only. If a theme ever reshapes
// the tree, changes the census, rewires a binding or shifts an id, that is a compiler
// bug AND it invalidates the reduction — so it is asserted directly rather than left
// implicit in a pile of near-duplicate serializations.
test('a theme changes appearance only — tree, census, bindings and ids are theme-invariant', () => {
  for (const name of NAMES) {
    const base = projectionOf(name, 'shesha');
    for (const theme of themesFor(name).filter((t) => t !== 'shesha')) {
      const other = projectionOf(name, theme);
      assert.equal(other.tree, base.tree, `${name}: theme "${theme}" reshaped the component tree`);
      assert.deepEqual(other.census, base.census, `${name}: theme "${theme}" changed the component census`);
      assert.deepEqual(other.bindings, base.bindings, `${name}: theme "${theme}" rewired a binding`);
      assert.deepEqual(other.ids, base.ids, `${name}: theme "${theme}" changed component ids — ids must derive from the blueprint, never the theme`);
    }
  }
});

// The floor pair is a FLOOR, not a ceiling: a blueprint that names its own buttons
// gets those. children[] is the button channel the blueprint schema allows today
// (node.items/node.buttons are honoured too, for when it grows a richer shape).
test('a blueprint that names its own action buttons gets those, not Save/Back [R-057]', () => {
  const bp = {
    screen: 'Own Buttons', archetype: 'capture',
    entity: { fullClassName: 'His.Facilities.Domain.Asset', modelType: { name: 'Asset', module: 'His.Facilities' } },
    form: { module: 'His.Facilities', name: 'own-buttons' },
    layout: {
      kind: 'stack', name: 'page', gap: 'lg',
      children: [
        { kind: 'heading', level: 1, content: 'Register Asset' },
        { kind: 'field', property: 'name' },
        { kind: 'actions', name: 'assetActions', children: [
          { kind: 'chip', name: 'btnSubmitAsset', title: 'Submit for Approval' },
          { kind: 'chip', name: 'btnSaveDraft', title: 'Save Draft' },
          { kind: 'chip', name: 'btnCancel', title: 'Cancel' },
        ] },
      ],
    },
  };
  const bpFile = path.join(WORK, 'own-buttons.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));
  const out = path.join(WORK, 'own-buttons.json');
  const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, `compile failed (its own gates rejected it):\n${r.out}`);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));

  const groups = [];
  (function walk(n, parent) {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, parent));
    if (!n || typeof n !== 'object') return;
    if (n.type === 'buttonGroup') groups.push({ group: n, parent });
    const next = typeof n.type === 'string' && n.id ? n : parent;
    for (const v of Object.values(n)) walk(v, next);
  })(doc.components, null);

  assert.equal(groups.length, 1, `expected exactly ONE action group, found ${groups.length} [R-020]`);
  const { group, parent } = groups[0];
  assert.equal(group.isInline, true, 'an authored action group is still inline [R-057]');
  assert.deepEqual(group.items.map((i) => i.label), ['Submit for Approval', 'Save Draft', 'Cancel'],
    'the blueprint-specified buttons were clobbered by the Save/Back floor');
  // one primary, on the first submit-shaped button [R-007]
  assert.deepEqual(group.items.map((i) => i.buttonType), ['primary', 'default', 'default']);
  assert.equal(group.items[0].actionConfiguration.actionName, 'Submit');
  assert.equal(group.items[2].actionConfiguration.actionName, 'Navigate');
  // deterministic ids: same blueprint, same ids
  const rerun = path.join(WORK, 'own-buttons-rerun.json');
  assert.equal(run('compile-blueprint.js', ['--blueprint', bpFile, '--out', rerun, '--no-live', '--theme', 'shesha']).code, 0);
  assert.equal(fs.readFileSync(rerun, 'utf8'), fs.readFileSync(out, 'utf8'), 'recompiling the same blueprint changed the output');
  // capture footer: right-aligned flex row around the group
  assert.equal(parent.desktop.flexDirection, 'row', 'the footer must be a flex row [R-057]');
  assert.equal(parent.desktop.justifyContent, 'flex-end', 'a capture footer right-aligns its actions [R-057]');
});

// ---- page anatomy: NORMALIZATION, not a post-compile pass ---------------------
// The compiler used to bake the neutral floor and nothing else, so a compiled page was
// technically-styled and visually vanilla — no page anatomy. compile/normalize-archetype.mjs
// now adds the band / meta strip / metric tiles / capture floor / page ground as ORDINARY
// layout nodes BEFORE anything compiles, so the generic node compiler emits them like any
// author-written container. These tests read freshly compiled output, so they hold whether
// or not the fixture in question keeps a full snapshot.

/** first-child-of-page-root walk, mirroring validate-styledness' structural detection */
const bandOf = (doc) => {
  const root = doc.components[0];
  return (root.components ?? [])[0] ?? null;
};
const findByName = (node, cname) => {
  let hit = null;
  (function w(n) {
    if (hit || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(w);
    if (n.componentName === cname) { hit = n; return; }
    for (const v of Object.values(n)) w(v);
  })(node);
  return hit;
};
const collectTypes = (node) => {
  const out = [];
  (function w(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(w);
    if (typeof n.type === 'string') out.push(n.type);
    for (const v of Object.values(n)) w(v);
  })(node);
  return out;
};
test('a compiled table-worklist opens with a page-header band (structural)', () => {
  const band = bandOf(docOf('table-worklist'));
  assert.ok(band, 'the page root has no first child at all');
  assert.equal(band.type, 'container', `the band must be a container, got ${band.type}`);
  assert.equal(band.componentName, 'pageHeaderBand');
  // a band is a SURFACE with a title: background + a bottom hairline + title-scale text
  assert.ok(band.desktop?.background?.color, 'the band carries no background colour');
  assert.ok(band.desktop?.border?.border?.bottom?.color, 'the band carries no bottom hairline');
  assert.equal(band.desktop.display, 'flex', 'the band must read its flex model from desktop.* [R-029]');
  const title = findByName(band, 'titleText');
  assert.ok(title, 'the band has no title text node');
  assert.equal(title.content, 'Assets', 'the band title comes from the blueprint heading it consumed');
  assert.ok(title.desktop.font.size >= 18, `the title is ${title.desktop.font.size}px — not title scale`);
  assert.equal(title.contentType, 'custom', 'a text colour without contentType:"custom" is a no-op [R-052]');
  // the consumed h1 must NOT also survive in the body — one page title, not two
  const bodyTitles = collectTypes(docOf('table-worklist').components[0].components.slice(1))
    .filter((t) => t === 'text').length;
  const dup = JSON.stringify(docOf('table-worklist').components[0].components.slice(1)).match(/"content":\s*"Assets"/g);
  assert.equal(dup, null, `the blueprint h1 was duplicated below the band (${bodyTitles} body text nodes)`);
});

test('a status-bearing record-detail compiles a refListStatus chip into its band, never plain text', () => {
  const doc = docOf('record-detail-status');
  const band = bandOf(doc);
  assert.equal(band.componentName, 'pageHeaderBand');
  const chip = findByName(band, 'statusChip');
  assert.ok(chip, 'the band has no status chip');
  assert.equal(chip.type, 'refListStatus', `a status is a chip, not a ${chip.type}`);
  assert.equal(chip.propertyName, 'status');
  // identity copied verbatim from the blueprint binding — never guessed [R-015]
  assert.deepEqual(chip.referenceListId, { module: 'boxfusion.test', name: 'AssetStatus' });
  // refListStatus' desktop.font/background/shadow are all measured no-ops, so the chip
  // must carry NO breakpoint block at all [R-053]; nor customStyle, which the 0.45
  // renderer ignores outright [R-028].
  for (const bpk of ['desktop', 'tablet', 'mobile']) {
    assert.ok(!chip[bpk] || !Object.keys(chip[bpk]).length,
      `the chip authors ${bpk}.* — every appearance channel on refListStatus is a measured no-op [R-053]`);
  }
  assert.equal(chip.customStyle, undefined, 'customStyle never reaches the 0.45 renderer [R-028]');
  // the subtitle rides the band's caption node as a literal — the compiler KNOWS the
  // trail, so it emits the string rather than JS that reaches into `data`
  const crumb = findByName(band, 'breadcrumbTrail');
  assert.ok(crumb, 'the band dropped its subtitle carrier');
  assert.match(crumb.content, /Register {2}\/ {2}Assets/);
  assert.equal(crumb.contentType, 'custom', 'caption ink without contentType:"custom" is a no-op [R-052]');
  assert.ok(crumb.desktop.font.size <= 13, `the caption is ${crumb.desktop.font.size}px — not micro scale`);
  // and a native KeyInformationBar carries the meta strip, one cell per non-status binding
  const strip = doc.components[0].components[1];
  assert.equal(strip.type, 'KeyInformationBar', `expected the native meta-strip carrier, got ${strip.type}`);
  assert.equal(strip.columns.length, 3);
  assert.deepEqual(strip.columns.map((c) => c.components[0].content), ['ASSET NAME', 'SERIAL NUMBER', 'LOCATION']);
  assert.deepEqual(strip.columns.map((c) => c.components[1].content),
    ['{{data.name}}', '{{data.serialNumber}}', '{{data.location}}']);
});

test('a compiled dashboard gets a stat-tile row of native statistic components', () => {
  const doc = docOf('asset-dashboard');
  assert.equal(bandOf(doc).componentName, 'pageHeaderBand');
  const row = doc.components[0].components[1];
  assert.equal(row.componentName, 'statTileRow');
  assert.equal(row.desktop.flexDirection, 'row', 'a stat-tile row is a row [R-029]');
  // the row is normalized as a `grid`, so each tile sits in the ONE width-carrying column
  // mechanism the compiler has (no second calc() for stat tiles) [R-028]
  assert.equal(row.components.length, 2, 'one column per data region in the blueprint');
  const tiles = row.components.map((col) => {
    assert.equal(col.type, 'container');
    assert.ok(col.desktop.dimensions.width.startsWith('calc('), 'grid columns are sized by desktop.dimensions.width [R-028]');
    assert.equal(col.components.length, 1);
    return col.components[0];
  });
  assert.deepEqual(tiles.map((t) => t.type), ['statistic', 'statistic']);
  assert.deepEqual(tiles.map((t) => t.title), ['Recently registered', 'Awaiting verification']);
  for (const tile of tiles) {
    assert.equal(tile.desktop.dimensions.width, '100%', 'a tile fills its column');
    assert.ok(tile.valueFont.size >= 18, 'the tile value carries the display type step');
  }
});

test('capture / modal-dialog / auth-page / card archetypes get NO page chrome', () => {
  for (const name of NAMES.filter((n) => !PAGE_ARCHETYPES.has(ANATOMY[n].archetype))) {
    const doc = docOf(name);
    assert.doesNotMatch(JSON.stringify(doc), /pageHeaderBand|statTileRow/,
      `${name} is a "${ANATOMY[name].archetype}" — a dialog/capture/card screen has no page anatomy, ` +
      'so it must carry no band or stat row');
  }
});

test('a blueprint can opt out of chrome with `chrome: false`', () => {
  const src = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'table-worklist.blueprint.json'), 'utf8'));
  const bpFile = path.join(WORK, 'no-chrome.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify({ ...src, chrome: false, form: { ...src.form, name: 'no-chrome' } }, null, 2));
  const out = path.join(WORK, 'no-chrome.json');
  // chrome:false means the page-anatomy floor does not apply either, so the compiler's own
  // styledness self-gate must still pass — the two have to agree or every compile breaks.
  const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, `an opted-out compile must still self-gate clean:\n${r.out}`);
  assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /pageHeaderBand/, 'chrome:false still emitted a band');
  // the h1 the band would have consumed stays in the body
  assert.match(fs.readFileSync(out, 'utf8'), /"content": "Assets"/);
});

// =============================================================================
// SEMANTIC PROJECTIONS
// =============================================================================
// One table, one row per fixture, holding the facts that a full serialization used to
// carry implicitly. This is the replacement for the 23 deleted snapshots: the same
// regressions are caught, but each one now fails with the name of the fact that broke
// ("asset-hub lost its refListStatus") instead of a 831-line byte diff.
//
// Adding a fixture means adding a row — deliberately. The completeness test below
// FAILS on an unaccounted fixture, so a new blueprint cannot slip in with the anatomy
// of nothing in particular asserted about it.
//
//   archetype   the blueprint's own archetype, restated here so the table is readable
//               and so a fixture that silently changes archetype is caught
//   band/meta/  page-anatomy counts the normalizer must produce (band count 1 is also
//   tiles       the "no duplicate chrome" bar — two bands is the bug this pins)
//   groups      action groups: exactly one, or none [R-020]
//   types       distinct component types — the census. A component type disappearing
//               (a datalist quietly compiled as a container) is invisible in prose but
//               loud here.
//   bindings    propertyName → component type, sorted. The wiring: which entity
//               property is rendered by which component.
const PAGE_ARCHETYPES = new Set(['table-worklist', 'record-detail', 'dashboard', 'hub']);
const ANATOMY = {
  'asset-capture': {
    archetype: 'capture', band: 0, metaStrip: 0, statTileRow: 0, groups: 1,
    types: ['buttonGroup', 'container', 'dropdown', 'text', 'textField', 'validationErrors'],
    bindings: ['assignedEmployee:textField', 'category:textField', 'formActions:buttonGroup', 'location:textField', 'name:textField', 'purchaseDate:textField', 'serialNumber:textField', 'status:dropdown'],
  },
  'asset-card-list': {
    archetype: 'list-card', band: 0, metaStrip: 0, statTileRow: 0, groups: 0,
    types: ['container', 'dataContext', 'datalist', 'text'],
    bindings: ['assetCards:dataContext', 'assetCardsList:datalist'],
  },
  'asset-create-dialog': {
    archetype: 'modal-dialog', band: 0, metaStrip: 0, statTileRow: 0, groups: 1,
    types: ['buttonGroup', 'container', 'text', 'textField', 'validationErrors'],
    bindings: ['category:textField', 'formActions:buttonGroup', 'location:textField', 'name:textField', 'serialNumber:textField'],
  },
  'asset-dashboard': {
    archetype: 'dashboard', band: 1, metaStrip: 0, statTileRow: 1, groups: 0,
    types: ['container', 'dataContext', 'datatable', 'statistic', 'text'],
    bindings: ['recentAssets:dataContext', 'recentAssetsGrid:datatable', 'statTile1:statistic', 'statTile2:statistic', 'unverifiedAssets:dataContext', 'unverifiedAssetsGrid:datatable'],
  },
  'asset-hub': {
    archetype: 'hub', band: 1, metaStrip: 1, statTileRow: 0, groups: 0,
    types: ['KeyInformationBar', 'container', 'dataContext', 'datalist', 'datatable', 'refListStatus', 'text'],
    bindings: ['maintenanceLog:dataContext', 'maintenanceLogGrid:datatable', 'metaLabel_1:text', 'metaLabel_2:text', 'metaLabel_3:text', 'metaStrip:KeyInformationBar', 'metaValue_1:text', 'metaValue_2:text', 'metaValue_3:text', 'relatedAssets:dataContext', 'relatedAssetsList:datalist', 'status:refListStatus'],
  },
  'asset-inline-card': {
    archetype: 'inline-card', band: 0, metaStrip: 0, statTileRow: 0, groups: 0,
    types: ['container', 'dropdown', 'text', 'textField'],
    bindings: ['location:textField', 'serialNumber:textField', 'status:dropdown'],
  },
  'asset-portal-entry': {
    archetype: 'auth-page', band: 0, metaStrip: 0, statTileRow: 0, groups: 1,
    types: ['buttonGroup', 'container', 'text', 'textField'],
    bindings: ['emailAddress:textField', 'entryActions:buttonGroup', 'userName:textField'],
  },
  'intent-showcase': {
    // TWO KeyInformationBars on purpose: the chrome meta strip the normalizer adds, plus
    // an author-declared identity strip in the body. That is the presentation-IR case.
    archetype: 'record-detail', band: 1, metaStrip: 2, statTileRow: 0, groups: 0,
    types: ['KeyInformationBar', 'container', 'refListStatus', 'statistic', 'text', 'textField'],
    bindings: ['identityMeta:KeyInformationBar', 'metaLabel_1:text', 'metaLabel_1:text', 'metaLabel_2:text', 'metaLabel_2:text', 'metaStrip:KeyInformationBar', 'metaValue_1:text', 'metaValue_1:text', 'metaValue_2:text', 'metaValue_2:text', 'name:textField', 'serialNumber:textField', 'status:refListStatus', 'status:refListStatus', 'uptimeMetric:statistic'],
  },
  'react-grammar': {
    // the JSX-derived grammar must land on the SAME wiring as the hand-written capture
    // blueprint — that equivalence is the whole point of the fixture
    archetype: 'capture', band: 0, metaStrip: 0, statTileRow: 0, groups: 1,
    types: ['buttonGroup', 'container', 'dropdown', 'text', 'textField', 'validationErrors'],
    bindings: ['assignedEmployee:textField', 'category:textField', 'formActions:buttonGroup', 'location:textField', 'name:textField', 'purchaseDate:textField', 'serialNumber:textField', 'status:dropdown'],
  },
  'record-detail-children': {
    archetype: 'record-detail', band: 1, metaStrip: 1, statTileRow: 0, groups: 1,
    types: ['KeyInformationBar', 'buttonGroup', 'container', 'dataContext', 'datalist', 'datatable', 'tabs', 'text', 'textField'],
    bindings: ['category:textField', 'documents:dataContext', 'documentsList:datalist', 'headerActions:buttonGroup', 'location:textField', 'metaLabel_1:text', 'metaLabel_2:text', 'metaLabel_3:text', 'metaStrip:KeyInformationBar', 'metaValue_1:text', 'metaValue_2:text', 'metaValue_3:text', 'movements:dataContext', 'movementsGrid:datatable', 'name:textField', 'purchaseDate:textField', 'serialNumber:textField'],
  },
  'record-detail-status': {
    archetype: 'record-detail', band: 1, metaStrip: 1, statTileRow: 0, groups: 1,
    types: ['KeyInformationBar', 'buttonGroup', 'container', 'dropdown', 'refListStatus', 'text', 'textField'],
    bindings: ['headerActions:buttonGroup', 'location:textField', 'metaLabel_1:text', 'metaLabel_2:text', 'metaLabel_3:text', 'metaStrip:KeyInformationBar', 'metaValue_1:text', 'metaValue_2:text', 'metaValue_3:text', 'name:textField', 'serialNumber:textField', 'status:dropdown', 'status:refListStatus'],
  },
  'table-worklist': {
    archetype: 'table-worklist', band: 1, metaStrip: 0, statTileRow: 0, groups: 1,
    types: ['buttonGroup', 'container', 'dataContext', 'datatable', 'text'],
    bindings: ['assets:dataContext', 'assetsGrid:datatable', 'formActions:buttonGroup'],
  },
  'text-showcase': {
    archetype: 'record-detail', band: 1, metaStrip: 1, statTileRow: 0, groups: 0,
    types: ['KeyInformationBar', 'container', 'text', 'textField'],
    bindings: ['author:textField', 'isbn:textField', 'metaLabel_1:text', 'metaLabel_2:text', 'metaLabel_3:text', 'metaStrip:KeyInformationBar', 'metaValue_1:text', 'metaValue_2:text', 'metaValue_3:text', 'releaseYear:textField', 'title:textField'],
  },
};

test('the projection table accounts for every fixture, and only for fixtures', () => {
  assert.deepEqual(Object.keys(ANATOMY).sort(), NAMES.slice().sort(),
    'ANATOMY has drifted from tests/fixtures/*.blueprint.json. Every fixture needs a row — a fixture ' +
    'with no row compiles and gates but has none of its anatomy, census or wiring asserted.');
  // and every archetype named in the table is one validate-styledness recognises
  for (const [name, row] of Object.entries(ANATOMY)) {
    const bp = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.blueprint.json`), 'utf8'));
    assert.equal(row.archetype, bp.archetype,
      `${name}: the table says "${row.archetype}", the blueprint says "${bp.archetype}"`);
  }
});

// PROJECTION: required page anatomy per archetype, and NO duplicate chrome.
// A page archetype opens with exactly ONE band. "Exactly one" is not pedantry: the
// failure mode this replaces was a normalizer that added a band to a tree that already
// had one, producing two stacked headers — a bug that a full snapshot records
// faithfully and silently.
for (const [name, row] of Object.entries(ANATOMY)) {
  test(`${name}: page anatomy — band×${row.band}, metaStrip×${row.metaStrip}, statTiles×${row.statTileRow}`, () => {
    for (const theme of themesFor(name)) {
      const { chrome } = projectionOf(name, theme);
      const at = `${name}@${theme}`;
      assert.equal(chrome.band, row.band,
        `${at}: ${chrome.band} page-header bands, expected ${row.band}` +
        (chrome.band > row.band ? ' — DUPLICATE CHROME: the page renders stacked headers' : ''));
      assert.equal(chrome.metaStrip, row.metaStrip, `${at}: ${chrome.metaStrip} KeyInformationBars, expected ${row.metaStrip}`);
      assert.equal(chrome.statTileRow, row.statTileRow, `${at}: ${chrome.statTileRow} stat-tile rows, expected ${row.statTileRow}`);
      assert.equal(chrome.pageGround, 'pageRoot', `${at}: the tree must be rooted in the pageRoot ground, got "${chrome.pageGround}"`);
      // a page archetype has a band; a dialog/card archetype must not
      assert.equal(row.band > 0, PAGE_ARCHETYPES.has(row.archetype),
        `${at}: the table contradicts itself — "${row.archetype}" is ${PAGE_ARCHETYPES.has(row.archetype) ? '' : 'not '}a page archetype`);
    }
  });
}

// PROJECTION: the component census, and the binding wiring.
test('every fixture compiles to its expected component census and binding wiring', () => {
  for (const [name, row] of Object.entries(ANATOMY)) {
    const p = projectionOf(name);
    assert.deepEqual(p.types, row.types,
      `${name}: the component census changed. A type that vanished here is a component the ` +
      'compiler stopped emitting (or emitted as a plain container instead).');
    assert.deepEqual(p.bindings, row.bindings,
      `${name}: the binding wiring changed — an entity property is now rendered by a different component type`);
  }
});

// PROJECTION: the hierarchy. Parent→child containment, not just a flat census: a
// meta strip that floats to the page root instead of sitting inside the band is a
// census-identical, hierarchy-different bug.
test('page chrome sits INSIDE the page ground, in band → strip → body order', () => {
  for (const [name, row] of Object.entries(ANATOMY)) {
    if (!row.band) continue;
    const root = docOf(name).components[0];
    assert.equal(root.componentName, 'pageRoot');
    assert.equal(root.components[0].componentName, 'pageHeaderBand',
      `${name}: the band is not the FIRST child of the page ground — the page opens with something else`);
    if (row.statTileRow) {
      assert.equal(root.components[1].componentName, 'statTileRow',
        `${name}: the stat-tile row must follow the band directly`);
    }
    // every projected row has a parent except the page ground itself
    const p = projectionOf(name);
    const orphans = p.rows.filter((r) => r.depth > 0 && !r.parent);
    assert.deepEqual(orphans, [], `${name}: projected nodes with no parent — the tree is not connected`);
    assert.equal(p.rows.filter((r) => r.depth === 0).length, 1,
      `${name}: more than one root component — a form has ONE page ground`);
  }
});

// PROJECTION: measured no-op channels are NOT emitted [R-028/R-052/R-053].
// The capability matrix says refListStatus ignores font/background/shadow entirely and
// that customStyle never reaches the 0.45 renderer. Authoring them is not harmless —
// it is markup that claims an appearance the DOM never gets, and it is exactly what a
// reviewer skims past in a 900-line snapshot.
test('the compiler emits no measured-no-op appearance channels [R-028/R-053]', () => {
  let chips = 0;
  for (const { key, name, theme } of CORPUS) {
    const p = projectionOf(name, theme);
    for (const chip of p.ofType('refListStatus')) {
      chips++;
      for (const bpk of ['desktop', 'tablet', 'mobile']) {
        assert.ok(!chip[bpk] || !Object.keys(chip[bpk]).length,
          `${key}: refListStatus "${chip.componentName}" authors ${bpk}.* — every appearance channel on it is a measured no-op [R-053]`);
      }
    }
    for (const r of p.rows) {
      assert.equal(r.node.customStyle, undefined,
        `${key}: ${r.type} "${r.name}" carries customStyle, which the 0.45 renderer ignores outright [R-028]`);
    }
  }
  assert.ok(chips >= 3, `expected refListStatus chips across the corpus, found ${chips}`);
});

// PROJECTION: theme-role resolution. Instead of a second full serialization per theme,
// spot-check the resolved VALUES the chrome reads from the active theme — which is the
// only thing the second snapshot ever proved.
// A role is a token PATH ("palette.surfaces.surface"), so the assertion has to walk it —
// the same tk() indirection the compiler's chrome does. Comparing against the path string
// would pass for a compiler that emitted the literal path into the markup.
const roleValue = (theme, role) => {
  const tokens = themeOf(theme);
  const p = tokens.roles[role];
  assert.ok(typeof p === 'string', `theme "${theme}" has no roles.${role}`);
  const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), tokens);
  assert.ok(typeof v === 'string' && v, `theme "${theme}": roles.${role} → "${p}" resolves to nothing`);
  return v;
};

test('page chrome resolves its colours from the ACTIVE theme, per theme', () => {
  const seenBandBg = new Set();
  for (const { key, name, theme } of CORPUS) {
    if (!ANATOMY[name].band) continue;
    const band = bandOf(docOf(name, theme));
    const bandBg = roleValue(theme, 'bandBg');
    seenBandBg.add(`${theme}=${bandBg}`);
    assert.equal(band.desktop.background.color, bandBg, `${key}: band background is not roles.bandBg`);
    assert.equal(band.desktop.border.border.bottom.color, roleValue(theme, 'bandBorder'),
      `${key}: band hairline is not roles.bandBorder`);
    const title = findByName(band, 'titleText');
    assert.equal(title.desktop.font.color, roleValue(theme, 'bandText'), `${key}: band title ink is not roles.bandText`);
    for (const grid of projectionOf(name, theme).ofType('datatable')) {
      assert.equal(grid.headerBackgroundColor, roleValue(theme, 'tableHeaderBg'),
        `${key}: datatable "${grid.componentName}" header is not roles.tableHeaderBg`);
    }
  }
  // and the roles genuinely DIVERGE across the shipped themes — otherwise the whole
  // per-theme check above is satisfied by a compiler that ignores the theme
  assert.equal(new Set([...seenBandBg].map((s) => s.split('=')[1])).size >= 2, true,
    `every shipped theme resolves the SAME band background (${[...seenBandBg].join(', ')}) — theming is a no-op`);
});

// PROJECTION: deterministic identity. Ids must be a pure function of the blueprint, so
// a recompile is byte-identical — otherwise every push rewrites every component id and
// the backend sees a brand-new form each time.
test('recompiling any fixture reproduces byte-identical output (deterministic ids)', () => {
  for (const name of NAMES) {
    const again = path.join(WORK, `determinism--${name}.json`);
    const r = run('compile-blueprint.js', [
      '--blueprint', path.join(FIXTURES, `${name}.blueprint.json`), '--out', again, '--no-live', '--theme', 'shesha',
    ]);
    assert.equal(r.code, 0, `recompile of ${name} failed:\n${r.out}`);
    assert.equal(fs.readFileSync(again, 'utf8'), compiled(name, 'shesha').text,
      `${name}: recompiling the same blueprint produced different output — ids or ordering are not deterministic`);
    // and every id is unique within the form
    const ids = projectionOf(name).ids;
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate component ids in one form`);
    assert.ok(ids.every((id) => typeof id === 'string' && id.length >= 8), `${name}: a component has no usable id`);
  }
});

// PROJECTION: archetype normalization output SHAPE. normalize-archetype.mjs is the one
// pass that turns a blueprint into a chrome-bearing layout; this pins the shape of what
// it produces per archetype family, which is the fact the deleted snapshots encoded.
test('archetype normalization produces one shape per archetype family', () => {
  const shapeOf = (name) => {
    const { chrome, groups } = projectionOf(name);
    return { band: chrome.band, metaStrip: Math.min(chrome.metaStrip, 1), statTileRow: chrome.statTileRow, groups: groups.length };
  };
  const byArchetype = {};
  for (const [name, row] of Object.entries(ANATOMY)) (byArchetype[row.archetype] ??= []).push(name);
  // two capture fixtures (hand-written + JSX-derived) must normalize IDENTICALLY
  assert.deepEqual(shapeOf('react-grammar'), shapeOf('asset-capture'),
    'the JSX-derived capture blueprint normalizes to a different shape than the hand-written one');
  // every page archetype gets a band; no non-page archetype does
  for (const [archetype, names] of Object.entries(byArchetype)) {
    for (const name of names) {
      assert.equal(shapeOf(name).band, PAGE_ARCHETYPES.has(archetype) ? 1 : 0,
        `${name}: a "${archetype}" ${PAGE_ARCHETYPES.has(archetype) ? 'must' : 'must not'} open with a band`);
    }
  }
  // 9 of the 11 shipped archetypes are exercised (solution-map and wizard have no fixture)
  assert.deepEqual(Object.keys(byArchetype).sort(),
    ['auth-page', 'capture', 'dashboard', 'hub', 'inline-card', 'list-card', 'modal-dialog', 'record-detail', 'table-worklist'],
    'the fixture set no longer covers 9 of the 11 archetypes');
});

// ---- one presentation system, not two ----------------------------------------
// Page anatomy was once appended to the COMPILED tree by a block-instantiating second
// pass: "$binding:x"/"$slot:y"/"$role:t" placeholder schemes, chromeBand/chromeMetaStrip/
// chromeStatRow alongside metaBar/metricTile, and a literal that leaked into markup
// rendered as that literal text on the page. Normalization replaced the whole mechanism,
// so the bar is now structural: the pipeline must not contain it at all.
test('the compiler pipeline carries no block-instantiation machinery', () => {
  const pipeline = ['compile-blueprint.js', 'compile/normalize-archetype.mjs', 'compile/compile-node.mjs',
    'compile/resolve-theme.mjs', 'compile/resolve-bindings-offline.mjs', 'compile/validate-output.mjs'];
  for (const file of pipeline) {
    const src = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
    for (const dead of ['instantiateBlock', 'chromeMetaStrip', 'chromeStatRow', 'stampPageChrome', '$binding:', '$slot:', '$role:']) {
      assert.ok(!src.includes(dead), `${file} still references "${dead}" — the second presentation system is back`);
    }
  }
  for (const { key, name, theme } of CORPUS) {
    assert.doesNotMatch(compiled(name, theme).text, /\$binding:|\$slot:|\$role:/,
      `${key} carries an unresolved placeholder literal`);
  }
});

// ---- the third theme resolves differently ------------------------------------
test('shesha-bold resolves a brand-tinted header band where shesha resolves a white one', () => {
  const bandBg = (theme) => bandOf(docOf('table-worklist', theme)).desktop.background.color;
  for (const t of ['shesha', 'requirements-studio', 'shesha-bold']) {
    const roles = themeOf(t).roles;
    for (const role of ['bandBg', 'bandText', 'bandSubtext', 'bandBorder', 'tableHeaderBg', 'statTileBg', 'statTileValue']) {
      assert.ok(roles[role], `theme "${t}" is missing roles.${role} — chrome tk() lookups would silently fall back`);
    }
    assert.ok(themeOf(t).chrome.tableRowHeight, `theme "${t}" is missing chrome.tableRowHeight (datatable density)`);
  }
  const bold = themeOf('shesha-bold');
  assert.equal(bandBg('shesha'), '#FFFFFF', 'the default band is a white surface');
  assert.equal(bandBg('shesha-bold'), bold.palette.brand.tint, 'shesha-bold tints its band with the brand');
  assert.notEqual(bandBg('shesha'), bandBg('shesha-bold'), 'the third theme must resolve DIFFERENTLY, or it is not a theme');
  assert.equal(bold.palette.brand.primary, '#0047FF');
  // same structural system: identical spacing + radius scales, identical key names
  const base = themeOf('shesha');
  assert.deepEqual(bold.spacing, base.spacing, 'shesha-bold must keep the shesha spacing scale');
  assert.deepEqual(bold.radius, base.radius, 'shesha-bold must keep the shesha radius scale');
  assert.deepEqual(Object.keys(bold.roles).sort(), Object.keys(base.roles).sort(),
    'shesha-bold must keep every shesha role key so recipes and block overlays resolve unchanged');
});

// ---- the styledness floor has teeth -----------------------------------------
test('a chrome-less page archetype FAILS validate-styledness, and page-anatomy is the only failure', () => {
  const fixture = path.join(FIXTURES, 'vanilla-page.json');
  const r = run('validate-styledness.js', [fixture, '--archetype', 'table-worklist']);
  assert.notEqual(r.code, 0, `a vanilla page archetype must FAIL:\n${r.out}`);
  const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(/\s+/)[1]);
  assert.deepEqual(fails, ['page-anatomy'],
    `everything but the band passes in this fixture, so page-anatomy must be the lone failure:\n${r.out}`);
  assert.match(r.out, /must open with a page-header band/);

  // the same markup as a NON-page archetype passes — dialogs carry no page chrome
  for (const dialog of ['capture', 'modal-dialog', 'auth-page']) {
    const ok = run('validate-styledness.js', [fixture, '--archetype', dialog]);
    assert.equal(ok.code, 0, `${dialog} must not be held to the page-band floor:\n${ok.out}`);
  }
  // with no --archetype the check WARNs rather than passing silently
  const unknown = run('validate-styledness.js', [fixture]);
  assert.equal(unknown.code, 0);
  assert.match(unknown.out, /WARN page-anatomy — archetype unknown/);
});

test('validate-styledness FAILS a status rendered as prose and a default-AntD grid', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'vanilla-page.json'), 'utf8'));
  const card = doc.components[0].components[0];
  const grid = card.components[1].components[0];
  // (a) status as prose
  card.components.push({
    id: '8f2c1a44-7777-4aaa-8bbb-0123456789ab', parentId: card.id, type: 'textField', version: 4,
    componentName: 'statusField', propertyName: 'status', label: 'Status',
    desktop: { dimensions: { width: '100%' } },
  });
  // (b) a grid with neither density nor header/body contrast
  delete grid.rowDimensions; delete grid.headerBackgroundColor; delete grid.desktop;
  const probe = path.join(WORK, 'styledness-teeth.json');
  fs.writeFileSync(probe, JSON.stringify(doc, null, 2));
  const r = run('validate-styledness.js', [probe, '--archetype', 'record-detail']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /FAIL status-as-text — textField "status"/);
  assert.match(r.out, /FAIL datatable-presentation — datatable "assetsGrid"/);
  assert.match(r.out, /rowDimensions\.height \(row density\)/);
  // and it says WHY hover/stripe intent does not count as evidence
  assert.match(r.out, /rowHoverBackgroundColor \/ striped \/ rowDividers .*"not-measured"/);
});

test('every compiled datatable carries the measured grid presentation channels', () => {
  let seen = 0;
  for (const { key, name, theme } of CORPUS) {
    const tokens = themeOf(theme);
    for (const n of projectionOf(name, theme).ofType('datatable')) {
      seen++;
      assert.equal(n.rowDimensions?.height, tokens.chrome.tableRowHeight,
        `${key}: datatable "${n.componentName}" row density must come from the theme`);
      assert.ok(n.headerBackgroundColor, `${key}: datatable "${n.componentName}" has no header contrast`);
      assert.ok(n.desktop?.font?.size, `${key}: datatable "${n.componentName}" has no body type`);
    }
  }
  assert.ok(seen >= 6, `expected datatables across the compiled corpus, found ${seen}`);
});

// ---- status COLUMNS are chips, and a row can open its record ------------------
// Two gaps closed together on the flagship worklist: (1) a reference-list column left on
// `[default]` renders the raw enum NUMBER — the same lifecycle loss as a status compiled to
// text, one level deeper, and it used to pass every gate; (2) "click a row to open the record"
// had no vocabulary at all, so it was hand-patched into compiled output.
test('a reference-list column compiles to a refListStatus display cell, never [default]', () => {
  for (const theme of themesFor('table-worklist')) {
    const grid = projectionOf('table-worklist', theme).ofType('datatable')[0];
    const byProp = Object.fromEntries(grid.items.map((it) => [it.propertyName, it]));
    const status = byProp.status;
    assert.ok(status, 'the fixture lost its status column');
    assert.equal(status.displayComponent.type, 'refListStatus',
      `a reference-list column must render the chip cell, got ${status.displayComponent.type} — [default] shows the raw enum number`);
    // the identity is COPIED from the blueprint binding, never guessed [R-015]
    assert.deepEqual(status.displayComponent.settings.referenceListId,
      { module: 'boxfusion.test', name: 'AssetStatus' });
    // and a plain column is untouched — the chip cell is not applied to everything
    assert.equal(byProp.name.displayComponent.type, '[default]');
    assert.equal(byProp.purchaseDate.displayComponent.type, '[default]');
    // the chip cell is a CELL: it must not also become a page-level band chip on a collection
    // page, where a bound chip has no single record to read
    assert.equal(projectionOf('table-worklist', theme).ofType('refListStatus').length, 0,
      'a table-worklist is a collection page — a status binding there is a COLUMN, not page chrome');
  }
});

// UNVERIFIED CHANNEL. datatable.onRowClick is `not-measured` in
// assets/measured-capability-matrix.json (a configurableActionConfigurator the gym cannot
// measure visually). This test pins the SHAPE the compiler authors — it does not and cannot
// claim the row-open fires; one live click test is the only proof, and no gate asserts it.
test('rowAction "open-record" compiles to a Navigate on the row-activation channel (shape only)', () => {
  const grid = projectionOf('table-worklist').ofType('datatable')[0];
  const cfg = grid.onRowClick;
  assert.ok(cfg, 'rowAction did not reach the datatable — the row-open channel is unwired');
  assert.equal(cfg._type, 'action-config');
  assert.equal(cfg.actionName, 'Navigate', 'row-open must reuse the ONE Navigate builder');
  assert.equal(cfg.actionOwner, 'shesha.common');
  assert.equal(cfg.actionArguments.navigationType, 'form');
  // the default target is DERIVED from the blueprint's entity, not hardcoded: Asset → asset-details
  assert.deepEqual(cfg.actionArguments.formId, { name: 'asset-details', module: 'boxfusion.test' });
  assert.deepEqual(cfg.actionArguments.queryParameters, [{ key: 'id', value: '{{selectedRow.id}}' }]);
  // a table with no rowAction authors NO row-activation channel — an unmeasured channel is
  // never emitted speculatively
  for (const other of ['asset-dashboard', 'record-detail-children']) {
    for (const g of projectionOf(other).ofType('datatable')) {
      assert.equal(g.onRowClick, undefined,
        `${other}: datatable "${g.componentName}" authors onRowClick without a blueprint rowAction`);
    }
  }
});

test('an explicit rowAction target wins, and rowAction is a datatable-only affordance', () => {
  const src = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'table-worklist.blueprint.json'), 'utf8'));
  const table = src.layout.children.find((c) => c.kind === 'datatable');

  // (a) an authored target replaces the convention
  const bpFile = path.join(WORK, 'row-action-target.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify({
    ...src,
    form: { ...src.form, name: 'row-action-target' },
    layout: {
      ...src.layout,
      children: src.layout.children.map((c) => (c === table
        ? { ...c, rowAction: { kind: 'open-record', target: 'asset-register-detail' } } : c)),
    },
  }, null, 2));
  const out = path.join(WORK, 'row-action-target.json');
  const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, `compile failed:\n${r.out}`);
  const grid = project(JSON.parse(fs.readFileSync(out, 'utf8'))).ofType('datatable')[0];
  assert.equal(grid.onRowClick.actionArguments.formId.name, 'asset-register-detail');

  // (b) the schema refuses rowAction anywhere but a datatable — the blueprint says what
  // activating a ROW means, and only a datatable has rows
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));
  const misplaced = {
    ...src,
    layout: { ...src.layout, children: [...src.layout.children, { kind: 'card', name: 'oops', rowAction: { kind: 'open-record' } }] },
  };
  const { findings } = validateBlueprint(misplaced, schema);
  assert.ok(findings.some((f) => f.path.startsWith('layout.children') && f.rule === 'wrong-const'),
    `expected the schema to reject rowAction on a card:\n${findings.map(describeFinding).join('\n')}`);
  // and the blueprint may not name the renderer channel itself
  const named = { ...src, layout: { ...src.layout, children: src.layout.children.map((c) => (c === table ? { ...c, onRowClick: {} } : c)) } };
  assert.ok(validateBlueprint(named, schema).findings.some((f) => f.rule === 'unknown-property'),
    'a blueprint must not be able to name `onRowClick` — the IR stays semantic');
});

// ---- the status-as-text floor sees INSIDE a datatable -------------------------
// The hole this closes: check 6 only ever looked at status-BOUND components, so a status column
// rendering the raw enum number passed silently. Severity follows knowability — FAIL when the
// reference-list identity was available, WARN when nothing could have known it [R-015].
test('validate-styledness sees a status COLUMN, and its severity follows knowability', () => {
  const base = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'vanilla-page.json'), 'utf8'));
  const grid = base.components[0].components[0].components[1].components[0];
  assert.equal(grid.type, 'datatable', 'the vanilla-page fixture moved — this test reads its grid');
  const statusColumn = (displayComponent) => ({
    id: 'c0111111-2222-4333-8444-555555555555', parentId: grid.id,
    itemType: 'item', sortOrder: 9, columnType: 'data', propertyName: 'status',
    caption: 'Status', isVisible: true, allowSorting: true, displayComponent,
    editComponent: { type: '[not-editable]' }, createComponent: { type: '[not-editable]' },
  });
  const probe = (name, mutate) => {
    const doc = JSON.parse(JSON.stringify(base));
    mutate(doc, doc.components[0].components[0].components[1].components[0]);
    const file = path.join(WORK, `status-column--${name}.json`);
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    return file;
  };

  // (a) UNKNOWN identity — nothing in the form or on the command line says `status` is a
  // reference list, so the compiler could not have emitted a chip: WARN, exit 0.
  const unknown = probe('unknown', (_d, g) => g.items.push(statusColumn({ type: '[default]' })));
  const rUnknown = run('validate-styledness.js', [unknown, '--archetype', 'capture']);
  assert.equal(rUnknown.code, 0, `an unknowable identity must WARN, not FAIL:\n${rUnknown.out}`);
  assert.match(rUnknown.out, /WARN status-as-text — datatable "assetsGrid" column "status"/);
  assert.match(rUnknown.out, /raw enum NUMBER/);
  assert.match(rUnknown.out, /R-015/, 'the WARN must say WHY it is not a FAIL');

  // (b) KNOWN via the form itself — another component here already names that reference list,
  // so a chip cell was possible and was not emitted: FAIL.
  const knownInForm = probe('known-in-form', (doc, g) => {
    g.items.push(statusColumn({ type: '[default]' }));
    doc.components[0].components[0].components.push({
      id: 'c0222222-2222-4333-8444-555555555555', parentId: doc.components[0].components[0].id,
      type: 'refListStatus', version: 6, componentName: 'statusChip', propertyName: 'status',
      referenceListId: { module: 'boxfusion.test', name: 'AssetStatus' },
    });
  });
  const rInForm = run('validate-styledness.js', [knownInForm, '--archetype', 'capture']);
  assert.notEqual(rInForm.code, 0, `a knowable identity must FAIL:\n${rInForm.out}`);
  assert.match(rInForm.out, /FAIL status-as-text — datatable "assetsGrid" column "status"/);
  assert.match(rInForm.out, /a chip was possible/);

  // (c) KNOWN via supplied entity metadata — the live-backend case, offline
  const metaFile = path.join(WORK, 'status-column.metadata.json');
  fs.writeFileSync(metaFile, JSON.stringify({ result: [{ path: 'status', dataType: 'reference-list-item', referenceListName: 'boxfusion.test.AssetStatus' }] }, null, 2));
  const rMeta = run('validate-styledness.js', [unknown, '--archetype', 'capture', '--metadata', metaFile]);
  assert.notEqual(rMeta.code, 0, `--metadata declaring a reference list must FAIL:\n${rMeta.out}`);
  assert.match(rMeta.out, /FAIL status-as-text — datatable "assetsGrid" column "status"/);

  // (d) the chip cell PASSES — and it is the shape the compiler emits
  const chipped = probe('chipped', (_d, g) => g.items.push(statusColumn({
    type: 'refListStatus', settings: { referenceListId: { module: 'boxfusion.test', name: 'AssetStatus' } },
  })));
  const rChip = run('validate-styledness.js', [chipped, '--archetype', 'capture', '--metadata', metaFile]);
  assert.equal(rChip.code, 0, `a chip cell must pass even with the identity known:\n${rChip.out}`);
  assert.match(rChip.out, /OK   status-as-text/);
});

// ---- spacing resolves through the theme, not a hardcoded literal --------------
// A numeric-STRING spacing key is a step on the theme scale: '4' → spacing.4 → 16px.
// It used to fall through to parseInt('4') and emit 4px — while the card default's
// own comment claimed 16 — so this pins the token semantics from both directions
// (the card default, and an explicitly authored padding: "4"). The blueprint is
// written to the temp dir on purpose: the fixtures directory is snapshot territory.
test("spacing key '4' resolves through the theme scale to 16px (not 4px)", () => {
  const bp = {
    screen: 'Spacing Probe', archetype: 'record-detail',
    entity: { fullClassName: 'His.Facilities.Domain.Asset', modelType: { name: 'Asset', module: 'His.Facilities' } },
    form: { module: 'His.Facilities', name: 'spacing-probe' },
    layout: {
      kind: 'stack', name: 'page', padding: 'lg', gap: 'lg',
      children: [
        // no padding → the compiler's card default, which must land on spacing.4
        { kind: 'card', name: 'defaultPadCard', title: 'Default Padding', children: [{ kind: 'field', property: 'name' }] },
        // authored numeric-string key → the same 16px
        { kind: 'card', name: 'tokenPadCard', title: 'Token Padding', padding: '4', gap: '2', children: [{ kind: 'field', property: 'code' }] },
      ],
    },
  };
  const bpFile = path.join(WORK, 'spacing-probe.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));

  const compileTo = (out, extra = []) => {
    const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', ...extra]);
    assert.equal(r.code, 0, `compile failed:\n${r.out}`);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };
  const findCard = (doc, name) => {
    let hit = null;
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.componentName === name) hit = n;
      for (const v of Object.values(n)) walk(v);
    })(doc.components);
    assert.ok(hit, `container "${name}" not found in the compiled output`);
    return hit;
  };
  const padOf = (card) => {
    const box = JSON.parse(card.desktop.stylingBox);
    const sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => box[k]);
    assert.deepEqual(new Set(sides).size, 1, `expected uniform padding, got ${JSON.stringify(box)}`);
    return sides[0];
  };

  for (const theme of THEMES) {
    const doc = compileTo(path.join(WORK, `spacing-probe--${theme}.json`), ['--theme', theme]);
    assert.equal(padOf(findCard(doc, 'defaultPadCard')), '16',
      `${theme}: the card default padding must be spacing.4 = 16px`);
    const tokenCard = findCard(doc, 'tokenPadCard');
    assert.equal(padOf(tokenCard), '16', `${theme}: padding "4" must resolve to spacing.4 = 16px`);
    assert.equal(tokenCard.desktop.gap, '8px', `${theme}: gap "2" must resolve to spacing.2 = 8px`);
    assert.equal(tokenCard.gap, 8, `${theme}: the root-level gap duplicate must match the desktop block`);
  }

  // --no-style keeps the same neutral step values — spacing must not collapse to 4px
  const neutral = compileTo(path.join(WORK, 'spacing-probe--no-style.json'), ['--no-style']);
  assert.equal(padOf(findCard(neutral, 'defaultPadCard')), '16', 'neutral spacing.4 must still be 16px');
  assert.equal(padOf(findCard(neutral, 'tokenPadCard')), '16', 'neutral padding "4" must still be 16px');
});

// ---- --no-style: neutral tokens, no brand ------------------------------------
// R-042 says --no-style is the ONE thing that skips the default-theme pass. The
// bar is mechanical: the compiled output must carry NONE of the named theme's
// distinctive palette values, yet still be valid markup. The styled control in the
// same test proves the assertion has teeth (the brand hex IS there without the flag).
test('--no-style compiles to neutral tokens (no brand values) and still passes validate-schema', () => {
  const fixture = 'asset-capture.blueprint.json';
  const tokens = JSON.parse(fs.readFileSync(
    path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes', 'shesha.tokens.json'), 'utf8'));
  // distinctive shesha values: the brand hex plus the two surface/line values the
  // compiler actually emits (page ground + card hairline)
  const brandValues = [
    tokens.palette.brand.primary,       // #003BB2
    tokens.palette.surfaces.canvas,     // #F8F8F9  → roles.pageBg
    tokens.palette.lines.border,        // #E8EAF0  → roles.hairline
  ];

  const plain = path.join(WORK, 'no-style--asset-capture.json');
  const r = run('compile-blueprint.js', [
    '--blueprint', path.join(FIXTURES, fixture), '--out', plain, '--no-live', '--theme', 'shesha', '--no-style',
  ]);
  assert.equal(r.code, 0, `compile --no-style failed:\n${r.out}`);
  assert.match(r.out, /--no-style/, 'the compiler must say it skipped the theme pass');
  const neutral = fs.readFileSync(plain, 'utf8');
  for (const v of brandValues) {
    assert.doesNotMatch(neutral, new RegExp(v, 'i'), `--no-style output still carries the shesha value ${v}`);
  }
  const schema = run('validate-schema.js', [plain]);
  assert.equal(schema.code, 0, `--no-style output failed validate-schema:\n${schema.out}`);

  // control: the same fixture WITH the theme does carry the brand surface values
  const styled = path.join(WORK, 'styled-control--asset-capture.json');
  const r2 = run('compile-blueprint.js', [
    '--blueprint', path.join(FIXTURES, fixture), '--out', styled, '--no-live', '--theme', 'shesha',
  ]);
  assert.equal(r2.code, 0, `styled control compile failed:\n${r2.out}`);
  const brandText = fs.readFileSync(styled, 'utf8');
  assert.match(brandText, new RegExp(tokens.palette.surfaces.canvas, 'i'),
    'the styled control lost the theme page ground — the --no-style assertion above is now vacuous');
});

// ---- the compiler gates itself, and says so honestly -------------------------
// The compile step used to write --out unconditionally and hand back a three-gate
// hint. It now runs schema/guardrails/styledness on its own output in-process, so
// exit 0 is a claim about the ARTIFACT. Both halves are asserted: every fixture
// self-gates clean, and the parting hint names all four gates (resolve-bindings
// included, flagged as caller-run because it needs the live backend).
test('compile self-gates its own output and names all four gates', () => {
  for (const fixture of BLUEPRINTS) {
    const name = fixture.replace(/\.blueprint\.json$/, '');
    const out = path.join(WORK, `selfgate--${name}.json`);
    const r = run('compile-blueprint.js', [
      '--blueprint', path.join(FIXTURES, fixture), '--out', out, '--no-live', '--theme', 'shesha',
    ]);
    assert.equal(r.code, 0, `compile of ${name} did not exit 0 — its own gates rejected it:\n${r.out}`);
    assert.match(r.out, /self-gated:/, `${name}: the compiler did not report running its own gates`);
    for (const gate of ['validate-schema', 'validate-guardrails', 'resolve-bindings', 'validate-styledness']) {
      assert.match(r.out, new RegExp(gate), `${name}: the gate hint omits ${gate}`);
    }
    assert.match(r.out, /resolve-bindings \(caller-run/,
      `${name}: the hint must say resolve-bindings stays caller-run (it needs the live backend)`);
  }
});

test('compile FAILS the command when its output trips a guardrail [R-028]', () => {
  // Post-fix no blueprint can naturally emit a root-level `columns` component, so the
  // wiring itself is what gets proven: a scratch compiler that seeds an R-028
  // violation into the tree must exit non-zero — and must still leave the file on
  // disk, because self-gating fails the COMMAND, not the evidence.
  const src = fs.readFileSync(path.join(SCRIPTS, 'compile-blueprint.js'), 'utf8');
  const seeded = src.replace(
    'fs.writeFileSync(outFile, JSON.stringify(form, null, 2)',
    `form.components.push({ id: 'seeded-r028', type: 'columns', version: 1, parentId: 'root', componentName: 'seededSplit', columns: [] });\n` +
    'fs.writeFileSync(outFile, JSON.stringify(form, null, 2)');
  assert.notEqual(seeded, src, 'could not seed the scratch compiler — the write site moved');
  const scratch = path.join(SCRIPTS, '.selfgate-probe.compile-blueprint.js'); // sibling: keeps relative asset paths valid
  const out = path.join(WORK, 'selfgate-violation.json');
  try {
    fs.writeFileSync(scratch, seeded);
    const r = spawnSync(process.execPath, [
      scratch, '--blueprint', path.join(FIXTURES, BLUEPRINTS[0]), '--out', out, '--no-live', '--theme', 'shesha',
    ], { encoding: 'utf8' });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    assert.notEqual(r.status, 0, `expected a non-zero exit from the seeded violation:\n${output}`);
    assert.match(output, /validate-guardrails\.js FAILED/, `the failing gate must be named:\n${output}`);
    assert.match(output, /R-028/, `the guardrail finding must be printed:\n${output}`);
    assert.ok(fs.existsSync(out), 'the output must survive a failed self-gate — the file is the diagnosis');
  } finally {
    fs.rmSync(scratch, { force: true });
  }
});

// ---- golden-corpus regression bar -------------------------------------------
// The 11 goldens are SEED templates, not shippable markup: they already carry
// placeholder ids ({{GEN_KEY}}), missing parentIds/versions and boolean
// defaultValues, so 8 of them fail validate-guardrails.js and always did. The
// meaningful bar is therefore "no NEW rule id fails" — this map is the pre-existing
// debt, captured from the validator as it stood before the walkers below were added
// (R-012/013/014/017/021/022/023/024/028/037/041/052/053/054/055).
//
// --legacy-corpus downgrades the two measured-channel rules (R-052 text colour
// without contentType:"custom", R-053 dead no-op channels) to WARN. The corpus
// predates the capability matrix and genuinely trips them — 33 text nodes author a
// colour that never reaches the DOM. That is real, reported debt, not a check
// weakness: the flag exists ONLY for this test, and the second case below asserts
// that R-052/R-053 are the ONLY new ids the corpus trips.
const GOLDEN_BASELINE_FAILS = {
  'auth-page--auth-login.json': ['R-006', 'R-009'],
  'capture--employee-create.json': ['R-001', 'R-003'],
  'capture-standalone--standalone-create.json': ['R-002', 'R-003'],
  'dashboard--dashboard.json': ['R-003', 'R-007'],
  'hub--rs-detail-with-header.json': ['R-002', 'R-003'],
  'inline-card--inline-editable-table.json': [],
  'list-card--entity-datalist.json': [],
  'list-card-item--entity-card.json': [],
  'modal-dialog--rs-create-dialog.json': ['R-002', 'R-003', 'R-009'],
  'record-detail--employee-detail.json': ['R-001', 'R-003'],
  'table-worklist--employee-table.json': ['R-002'],
};
const failingRuleIds = (output) => [...new Set(
  output.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.match(/\[([^\]]+)\]/)?.[1]).filter(Boolean),
)].sort();

test('the golden corpus is complete and accounted for', () => {
  const goldens = fs.readdirSync(path.join(SKILL, 'assets', 'golden'))
    .filter((f) => f.endsWith('.json') && f !== '_index.json').sort();
  assert.equal(goldens.length, 11, `expected 11 golden forms, found ${goldens.length}`);
  assert.deepEqual(goldens, Object.keys(GOLDEN_BASELINE_FAILS).sort());
});

for (const [golden, baseline] of Object.entries(GOLDEN_BASELINE_FAILS)) {
  test(`golden ${golden}: no new failing rule id`, () => {
    const file = path.join(SKILL, 'assets', 'golden', golden);
    const r = run('validate-guardrails.js', [file, '--legacy-corpus']);
    assert.deepEqual(failingRuleIds(r.out), baseline.slice().sort(),
      `the failing rule ids for ${golden} changed — a new walker regressed the corpus (or the corpus was fixed; update GOLDEN_BASELINE_FAILS)`);
    assert.equal(r.code, baseline.length ? 1 : 0, 'exit code must follow the fail count');
  });
}

// ---- golden corpus: the styledness floor, honestly baselined --------------------
// The goldens are hand-made SEED templates, and the raised styledness floor catches real
// debt in them. The bar is the same as for guardrails: no NEW failing check, and the debt
// is written down per-form rather than papered over by weakening the check. The archetype
// comes from the golden's filename prefix (that is the archetype it seeds), so the
// page-anatomy floor is genuinely enforced here — and it FAILS the three hand-made page
// goldens that open straight into content with no header band, which is exactly the
// vanilla shape this work exists to make impossible.
const GOLDEN_STYLEDNESS_BASELINE = {
  'auth-page--auth-login.json': [],
  'capture--employee-create.json': [],
  // page ground + coverage debt: this standalone seed is a bare form body by design
  'capture-standalone--standalone-create.json': ['page-chrome', 'style-coverage'],
  'dashboard--dashboard.json': [],
  // VANILLA PAGE: opens into content, and its five grids author no density
  'hub--rs-detail-with-header.json': ['datatable-presentation', 'page-anatomy'],
  // an inline-editing seed: no page ground, no type, no grid presentation
  'inline-card--inline-editable-table.json': ['datatable-presentation', 'page-chrome', 'style-coverage', 'typography'],
  'list-card--entity-datalist.json': ['page-chrome'],
  'list-card-item--entity-card.json': [],
  'modal-dialog--rs-create-dialog.json': [],
  'record-detail--employee-detail.json': ['page-anatomy'],   // VANILLA PAGE
  'table-worklist--employee-table.json': ['page-anatomy'],   // VANILLA PAGE
};
const failingChecks = (output) => [...new Set(
  output.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(/\s+/)[1]).filter(Boolean),
)].sort();

test('the golden styledness baseline covers the whole corpus', () => {
  assert.deepEqual(Object.keys(GOLDEN_STYLEDNESS_BASELINE).sort(), Object.keys(GOLDEN_BASELINE_FAILS).sort());
});

for (const [golden, baseline] of Object.entries(GOLDEN_STYLEDNESS_BASELINE)) {
  test(`golden ${golden}: no new failing styledness check`, () => {
    const archetype = golden.replace(/--.*$/, '');
    const r = run('validate-styledness.js', [path.join(SKILL, 'assets', 'golden', golden), '--archetype', archetype]);
    assert.deepEqual(failingChecks(r.out), baseline.slice().sort(),
      `the failing styledness checks for ${golden} changed — a new check regressed the corpus (or the corpus was fixed; update GOLDEN_STYLEDNESS_BASELINE)`);
    assert.equal(r.code, baseline.length ? 1 : 0, 'exit code must follow the fail count');
  });
}

// the page-anatomy floor must be the reason the page goldens fail — proof it has teeth on
// hand-made markup, not only on the purpose-built vanilla-page fixture
test('the page-anatomy floor FAILS the hand-made page goldens that have no header band', () => {
  for (const golden of ['table-worklist--employee-table.json', 'record-detail--employee-detail.json', 'hub--rs-detail-with-header.json']) {
    const r = run('validate-styledness.js', [path.join(SKILL, 'assets', 'golden', golden), '--archetype', golden.replace(/--.*$/, '')]);
    assert.match(r.out, /FAIL page-anatomy — a ".*" page must open with a page-header band/,
      `${golden} is a page seed with no band — the floor must say so`);
  }
});

test('golden corpus: R-052/R-053 are the ONLY rules the legacy-corpus flag masks', () => {
  const extra = new Set();
  for (const [golden, baseline] of Object.entries(GOLDEN_BASELINE_FAILS)) {
    const r = run('validate-guardrails.js', [path.join(SKILL, 'assets', 'golden', golden)]);
    for (const id of failingRuleIds(r.out)) if (!baseline.includes(id)) extra.add(id);
  }
  assert.deepEqual([...extra].sort(), ['R-052', 'R-053'],
    'the measured-channel debt in assets/golden changed shape — investigate before touching the flag');
});

// ---- negative case ----------------------------------------------------------
test('broken-bindings fixture FAILS the guardrail gate', () => {
  // Its defects are binding-identity defects, so they only become mechanical once
  // the entity metadata is supplied (arg 2) — exactly how resolve-bindings would
  // see them, minus the live backend. Without metadata the same file only warns.
  const fixture = path.join(FIXTURES, 'broken-bindings.json');
  const meta = path.join(FIXTURES, 'broken-bindings.metadata.json');
  const withMeta = run('validate-guardrails.js', [fixture, meta]);
  assert.notEqual(withMeta.code, 0, `expected a non-zero exit, got 0:\n${withMeta.out}`);
  assert.ok(failingRuleIds(withMeta.out).includes('R-015'),
    `expected the guessed reference-list identity to FAIL [R-015]:\n${withMeta.out}`);

  const withoutMeta = run('validate-guardrails.js', [fixture]);
  assert.equal(withoutMeta.code, 0, 'without metadata the identity check can only warn — that contract changed');
});

test('stacked-buttons fixture FAILS the guardrail gate on R-057', () => {
  // Both stack shapes in one file: a COLUMN container holding two button components,
  // and a two-item buttonGroup with no isInline:true. Nothing else in the fixture is
  // broken, so R-057 must be the ONLY failing id — that is what makes it a proof the
  // check has teeth rather than a file that trips something.
  const r = run('validate-guardrails.js', [path.join(FIXTURES, 'stacked-buttons.json')]);
  assert.notEqual(r.code, 0, `expected a non-zero exit:\n${r.out}`);
  assert.deepEqual(failingRuleIds(r.out), ['R-057'], `expected R-057 alone to fail:\n${r.out}`);
  assert.match(r.out, /actionStack/, 'the stacked container must be named');
  assert.match(r.out, /collapsedGroup/, 'the non-inline buttonGroup must be named');
});
