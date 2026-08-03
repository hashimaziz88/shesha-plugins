// Offline eval suite for the compiler + gate chain.
//
// The pipeline's only fast feedback loop. For every blueprint fixture it compiles
// under BOTH shipped themes, runs the three offline gates, and byte-compares the
// output against a committed snapshot — so a compiler change that silently reshapes
// markup shows up as a diff in review instead of as a broken form in a browser.
//
// It also pins two boundaries:
//   * the golden corpus must not acquire NEW failing rule ids (regression bar for
//     every walker added to validate-guardrails.js), and
//   * the broken-bindings fixture must still FAIL (the gates can catch things).
//
// Snapshots: delete tests/__snapshots__/<fixture>--<theme>.json and re-run to
// re-record; the diff is the review artifact.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBlueprint, loadSchema } from '../../shesha-design-comprehension/scripts/validate-blueprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const SCRIPTS = path.join(SKILL, 'scripts');
const FIXTURES = path.join(HERE, 'fixtures');
const SNAPSHOTS = path.join(HERE, '__snapshots__');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'form-edit-pipeline-'));

const THEMES = ['shesha', 'requirements-studio'];
// shesha-bold is the third shipped theme. It rides the snapshot matrix for ONE fixture
// only — enough to pin that a third theme resolves DIFFERENTLY (its page-header band is
// brand-tinted, not white) without tripling the snapshot churn on every compiler change.
const EXTRA_THEMES = { 'table-worklist': ['shesha-bold'] };
const ALL_THEMES = [...new Set([...THEMES, ...Object.values(EXTRA_THEMES).flat()])];
const SNAP_SUFFIX = new RegExp(`--(${ALL_THEMES.join('|')})\\.json$`);
const BLUEPRINTS = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.blueprint.json')).sort();

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

test('there are blueprint fixtures to compile', () => {
  assert.ok(BLUEPRINTS.length >= 5, `expected ≥5 blueprint fixtures, found ${BLUEPRINTS.length}`);
});

// ---- blueprint fixtures are valid blueprint IR -------------------------------
// Structural check against shesha-design-comprehension/schemas/blueprint.schema.json
// (required keys, node `kind` enum, no unknown node keys) — the schema is the
// contract between comprehension and the compiler. The logic lives in
// shesha-design-comprehension/scripts/validate-blueprint.mjs (the same validator
// compile-blueprint.js runs before it compiles); this test only pins the fixtures
// against it, plus the fixtures-stay-small bar that is a test concern only.
test('every fixture is valid blueprint IR', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));

  for (const f of BLUEPRINTS) {
    const bp = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
    const { errors, nodeCount } = validateBlueprint(bp, schema);
    assert.deepEqual(errors, [], `${f}: invalid blueprint IR —\n  ${errors.join('\n  ')}`);
    assert.ok(nodeCount >= 4 && nodeCount <= 60, `${f}: ${nodeCount} nodes — fixtures stay small`);
  }
});

// The validator has teeth: a mutated blueprint must come back with findings, or
// the assertion above is vacuous.
test('validateBlueprint rejects a bad archetype and an unknown node key', () => {
  const schema = loadSchema(
    path.join(SKILL, '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json'));
  const bad = {
    screen: 'Mutant', archetype: 'not-an-archetype',
    entity: {}, form: { module: 'm' },
    layout: { kind: 'stack', bogusKey: 1, children: [{ kind: 'notAKind' }] },
  };
  const { errors } = validateBlueprint(bad, schema);
  for (const needle of [/archetype "not-an-archetype"/, /entity\.fullClassName/, /form\.module\/name/,
    /unknown node key "bogusKey"/, /kind "notAKind"/]) {
    assert.ok(errors.some((e) => needle.test(e)), `expected a finding matching ${needle}:\n${errors.join('\n')}`);
  }
});

// ---- compile → gates → snapshot ---------------------------------------------
for (const fixture of BLUEPRINTS) {
  const name = fixture.replace(/\.blueprint\.json$/, '');
  const archetype = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixture), 'utf8')).archetype;
  for (const theme of [...THEMES, ...(EXTRA_THEMES[name] ?? [])]) {
    test(`${name} @ ${theme}: compiles, passes every offline gate, matches its snapshot`, () => {
      const out = path.join(WORK, `${name}--${theme}.json`);
      const compiled = run('compile-blueprint.js', [
        '--blueprint', path.join(FIXTURES, fixture), '--out', out, '--no-live', '--theme', theme,
      ]);
      assert.equal(compiled.code, 0, `compile failed:\n${compiled.out}`);
      assert.ok(fs.existsSync(out), 'compiler wrote no output');
      // the compiler must find the theme — a missing theme silently emits neutral defaults
      assert.doesNotMatch(compiled.out, /theme ".*" not found/, `theme "${theme}" was not found`);

      for (const gate of ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js']) {
        // styledness needs the archetype — its page-anatomy floor only applies to page
        // archetypes, and an archetype is a blueprint fact, not a component.
        const r = run(gate, [out, ...(gate === 'validate-styledness.js' ? ['--archetype', archetype] : [])]);
        assert.equal(r.code, 0, `${gate} failed for ${name}@${theme}:\n${r.out}`);
      }

      const actual = fs.readFileSync(out, 'utf8');
      const snapFile = path.join(SNAPSHOTS, `${name}--${theme}.json`);
      if (!fs.existsSync(snapFile)) {
        fs.mkdirSync(SNAPSHOTS, { recursive: true });
        fs.writeFileSync(snapFile, actual);
        console.log(`  recorded snapshot ${path.basename(snapFile)}`);
        return;
      }
      assert.equal(actual, fs.readFileSync(snapFile, 'utf8'),
        `compiled output for ${name}@${theme} no longer matches its snapshot — review the change, then delete ${path.relative(SKILL, snapFile)} and re-run to re-record`);
    });
  }
}

// ---- action buttons render inline [R-057] ------------------------------------
// The snapshots are the compiler's committed output, so they are also the cheapest
// place to pin the inline contract: EVERY buttonGroup the compiler has ever emitted
// carries isInline:true — without it the whole group folds into an overflow "…" menu,
// which is invisible in the markup and only shows up in a browser. Reading the
// snapshots means a compiler change has to re-record before it can ship a collapsed
// action row. On capture archetypes the group additionally sits in a right-aligned
// flex row (its own dimensions/stylingBox are measured no-ops, so the container is
// the only alignment lever).
test('every buttonGroup in every snapshot is inline [R-057]', () => {
  const snaps = fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json'));
  assert.ok(snaps.length >= 5, `expected the recorded snapshots, found ${snaps.length}`);
  const CAPTURE = new Set(['asset-capture', 'react-grammar']); // the capture-archetype fixtures
  let seen = 0;
  for (const snap of snaps) {
    const fixture = snap.replace(SNAP_SUFFIX, '');
    const doc = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, snap), 'utf8'));
    (function walk(node, parent) {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, parent));
      if (!node || typeof node !== 'object') return;
      if (node.type === 'buttonGroup') {
        seen++;
        assert.equal(node.isInline, true,
          `${snap}: buttonGroup "${node.componentName}" is not isInline:true — it renders as an overflow "…" menu [R-057]`);
        assert.ok((node.items ?? []).length >= 2, `${snap}: buttonGroup "${node.componentName}" lost its Save/exit pair [R-007]`);
        if (CAPTURE.has(fixture)) {
          assert.equal(parent?.desktop?.display, 'flex',
            `${snap}: the capture footer holding "${node.componentName}" is not a flex box [R-057]`);
          assert.equal(parent?.desktop?.flexDirection, 'row',
            `${snap}: the capture footer holding "${node.componentName}" is a ${parent?.desktop?.flexDirection} stack, not a row [R-057]`);
          assert.equal(parent?.desktop?.justifyContent, 'flex-end',
            `${snap}: a capture footer right-aligns its actions [R-057]`);
        }
      }
      const nextParent = typeof node.type === 'string' && node.id ? node : parent;
      for (const v of Object.values(node)) walk(v, nextParent);
    })(doc.components, null);
  }
  assert.ok(seen >= 4, `expected buttonGroups across the snapshots, found ${seen}`);
});

// The floor pair is a FLOOR, not a ceiling: a blueprint that names its own buttons
// gets those. children[] is the button channel the blueprint schema allows today
// (node.items/node.buttons are honoured too, for when it grows a richer shape).
test('a blueprint that names its own action buttons gets those, not Save/Back [R-057]', () => {
  const bp = {
    screen: 'Own Buttons', archetype: 'capture',
    entity: { fullClassName: 'His.Facilities.Domain.Asset', modelType: 'His.Facilities.Domain.Asset' },
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

// ---- page chrome: blocks are per-archetype compiler output --------------------
// The compiler used to bake the neutral floor and nothing else, so a compiled page was
// technically-styled and visually vanilla — no page anatomy. assets/blocks/*.block.json
// is now instantiated as ARCHETYPE CHROME (resolver in compile-blueprint.js), and these
// tests read the committed snapshots, so a compiler change has to re-record before it can
// ship a bandless page.

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
const snap = (name, theme = 'shesha') =>
  JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, `${name}--${theme}.json`), 'utf8'));

test('a compiled table-worklist opens with a page-header band (structural)', () => {
  const band = bandOf(snap('table-worklist'));
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
  const bodyTitles = collectTypes(snap('table-worklist').components[0].components.slice(1))
    .filter((t) => t === 'text').length;
  const dup = JSON.stringify(snap('table-worklist').components[0].components.slice(1)).match(/"content":\s*"Assets"/g);
  assert.equal(dup, null, `the blueprint h1 was duplicated below the band (${bodyTitles} body text nodes)`);
});

test('a status-bearing record-detail compiles a refListStatus chip into its band, never plain text', () => {
  const doc = snap('record-detail-status');
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
  // the subtitle rides the band's breadcrumb slot, filled as code-mode JS
  const crumb = findByName(band, 'breadcrumbTrail');
  assert.ok(crumb, 'the band dropped its subtitle carrier');
  assert.match(crumb.content._code, /Register {2}\/ {2}Assets/);
  // and a native KeyInformationBar carries the meta strip, one cell per non-status binding
  const strip = doc.components[0].components[1];
  assert.equal(strip.type, 'KeyInformationBar', `expected the native meta-strip carrier, got ${strip.type}`);
  assert.equal(strip.columns.length, 3);
  assert.deepEqual(strip.columns.map((c) => c.components[0].content), ['ASSET NAME', 'SERIAL NUMBER', 'LOCATION']);
  assert.deepEqual(strip.columns.map((c) => c.components[1].content),
    ['{{data.name}}', '{{data.serialNumber}}', '{{data.location}}']);
});

test('a compiled dashboard gets a stat-tile row of native statistic components', () => {
  const doc = snap('asset-dashboard');
  assert.equal(bandOf(doc).componentName, 'pageHeaderBand');
  const row = doc.components[0].components[1];
  assert.equal(row.componentName, 'statTileRow');
  assert.equal(row.desktop.flexDirection, 'row', 'a stat-tile row is a row [R-029]');
  assert.equal(row.components.length, 2, 'one tile per data region in the blueprint');
  assert.deepEqual(row.components.map((t) => t.type), ['statistic', 'statistic']);
  assert.deepEqual(row.components.map((t) => t.title), ['Recently registered', 'Awaiting verification']);
  for (const tile of row.components) {
    assert.ok(tile.desktop.dimensions.width.startsWith('calc('), 'tiles are sized by desktop.dimensions.width [R-028]');
    assert.ok(tile.valueFont.size >= 18, 'the tile value carries the display type step');
  }
});

test('capture / modal-dialog / auth-page archetypes get NO page chrome', () => {
  for (const name of ['asset-capture', 'react-grammar']) {   // the capture-archetype fixtures
    const doc = snap(name);
    const text = JSON.stringify(doc);
    assert.doesNotMatch(text, /pageHeaderBand|statTileRow|"KeyInformationBar"/,
      `${name} is a capture archetype — a dialog/capture screen has no page anatomy, so it must carry no band, strip or stat row`);
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

test('no snapshot ever ships a block placeholder literal', () => {
  // "$binding:x" / "$slot:y" / "$role:t" are the block library's model-fill schemes. A
  // literal that survives into markup renders as that literal text on the page.
  for (const file of fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json'))) {
    const text = fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8');
    assert.doesNotMatch(text, /\$binding:|\$slot:|\$role:/, `${file} carries an unresolved block placeholder`);
  }
});

// ---- the third theme resolves differently ------------------------------------
test('shesha-bold resolves a brand-tinted header band where shesha resolves a white one', () => {
  const bandBg = (theme) => bandOf(snap('table-worklist', theme)).desktop.background.color;
  const themeOf = (t) => JSON.parse(fs.readFileSync(
    path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes', `${t}.tokens.json`), 'utf8'));
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
  for (const file of fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json'))) {
    const theme = file.match(SNAP_SUFFIX)?.[1];
    const tokens = JSON.parse(fs.readFileSync(
      path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes', `${theme}.tokens.json`), 'utf8'));
    (function w(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(w);
      if (n.type === 'datatable') {
        assert.equal(n.rowDimensions?.height, tokens.chrome.tableRowHeight,
          `${file}: datatable "${n.componentName}" row density must come from the theme`);
        assert.ok(n.headerBackgroundColor, `${file}: datatable "${n.componentName}" has no header contrast`);
        assert.ok(n.desktop?.font?.size, `${file}: datatable "${n.componentName}" has no body type`);
      }
      for (const v of Object.values(n)) w(v);
    })(JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8')).components);
  }
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
    entity: { fullClassName: 'His.Facilities.Domain.Asset', modelType: 'His.Facilities.Domain.Asset' },
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
