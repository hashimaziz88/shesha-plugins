// The presentation IR — the second half of the blueprint contract.
//
// pipeline.test.mjs already compiles every fixture (presentation-showcase included) under
// both shipped themes, runs the offline gates and byte-compares the snapshots. This file
// pins the presentation SEMANTICS that a snapshot diff alone would not explain:
//
//   * a declared recipe is authoritative — exactly ONE page-header band, never two
//   * role mapping: status → refListStatus chip, metric → statistic, surface → card surface
//   * tone resolves through the ACTIVE theme (the same blueprint resolves a DIFFERENT
//     accent colour under shesha and under requirements-studio — proof it is a token
//     lookup, not a literal)
//   * overrides are TOKEN PATHS: a raw hex fails validate-blueprint, an unknown token path
//     fails the compile (exit 2)
//   * the <out>.presentation.json manifest gives validate-styledness teeth: a declared
//     recipe that left no structural trace FAILS.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const SCRIPTS = path.join(SKILL, 'scripts');
const COMPREHENSION = path.join(SKILL, '..', 'shesha-design-comprehension');
const FIXTURES = path.join(HERE, 'fixtures');
const SNAPSHOTS = path.join(HERE, '__snapshots__');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'form-edit-presentation-'));
const FIXTURE = path.join(FIXTURES, 'presentation-showcase.blueprint.json');

const run = (script, args, dir = SCRIPTS) => {
  const r = spawnSync(process.execPath, [path.join(dir, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const snap = (theme) => JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, `presentation-showcase--${theme}.json`), 'utf8'));
const findAll = (doc, pred) => {
  const out = [];
  (function w(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(w);
    if (typeof n.type === 'string' && pred(n)) out.push(n);
    for (const v of Object.values(n)) w(v);
  })(doc.components);
  return out;
};
const byName = (doc, cname) => findAll(doc, (n) => n.componentName === cname)[0] ?? null;

// ---- the schema is versioned, and `presentation` is a known node key ----------
test('the blueprint schema is versioned and declares the presentation IR', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(COMPREHENSION, 'schemas', 'blueprint.schema.json'), 'utf8'));
  assert.match(String(schema.version), /^\d+\.\d+\.\d+$/, 'the schema carries no semver version');
  assert.ok(schema.$defs.node.properties.presentation, '"presentation" is not a known node key — the validator would reject it');
  const pres = schema.$defs.presentation;
  assert.deepEqual(pres.properties.role.enum, ['title', 'status', 'metric', 'meta', 'body']);
  assert.deepEqual(pres.properties.tone.enum, ['accent', 'neutral', 'success', 'warning', 'danger']);
  assert.deepEqual(pres.properties.surface.enum, ['card', 'band', 'plain']);
  assert.equal(pres.additionalProperties, false, 'an unknown presentation key must be an error');
  // the recipe enum IS the block library's file list — drift here means a recipe that
  // validates but cannot be instantiated (or a block no blueprint can reach)
  const blocks = fs.readdirSync(path.join(SKILL, 'assets', 'blocks'))
    .filter((f) => f.endsWith('.block.json')).map((f) => f.replace(/\.block\.json$/, '')).sort();
  assert.deepEqual(pres.properties.recipe.enum.slice().sort(), blocks,
    'the presentation.recipe enum has drifted from assets/blocks/ — the block library is the source of truth');
});

// ---- tokens only -------------------------------------------------------------
test('a raw hex (or a px literal) in presentation.overrides FAILS validate-blueprint', () => {
  const mk = (overrides, name) => {
    const bp = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    bp.form.name = name;
    bp.layout.children[1].children[0].presentation.overrides = overrides;
    const f = path.join(WORK, `${name}.blueprint.json`);
    fs.writeFileSync(f, JSON.stringify(bp, null, 2));
    return f;
  };
  const hex = run('validate-blueprint.mjs', [mk({ 'font.color': '#ff0000' }, 'raw-hex')], path.join(COMPREHENSION, 'scripts'));
  assert.equal(hex.code, 1, `a raw hex must be INVALID blueprint IR:\n${hex.out}`);
  assert.match(hex.out, /raw colour "#ff0000"/);
  assert.match(hex.out, /TOKENS ONLY/);

  const px = run('validate-blueprint.mjs', [mk({ 'font.size': '12px' }, 'raw-px')], path.join(COMPREHENSION, 'scripts'));
  assert.equal(px.code, 1, `a px literal must be INVALID blueprint IR:\n${px.out}`);
  assert.match(px.out, /raw size "12px"/);

  // and the enums have teeth
  const bad = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  bad.layout.children[0].presentation = { recipe: 'not-a-block', role: 'sparkle', tone: 'chartreuse', surface: 'glass', bogus: 1 };
  const badFile = path.join(WORK, 'bad-enums.blueprint.json');
  fs.writeFileSync(badFile, JSON.stringify(bad, null, 2));
  const enums = run('validate-blueprint.mjs', [badFile], path.join(COMPREHENSION, 'scripts'));
  assert.equal(enums.code, 1);
  for (const needle of [/recipe "not-a-block"/, /role "sparkle"/, /tone "chartreuse"/, /surface "glass"/, /unknown presentation key "bogus"/]) {
    assert.match(enums.out, needle);
  }

  // the fixture itself is valid — the assertions above are not passing by accident
  assert.equal(run('validate-blueprint.mjs', [FIXTURE], path.join(COMPREHENSION, 'scripts')).code, 0);
});

test('an overrides token path the active theme does not define FAILS the compile (exit 2)', () => {
  const bp = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  bp.form.name = 'unknown-token';
  bp.layout.children[1].children[0].presentation.overrides = { 'font.size': 'type.scale.gigantic' };
  const bpFile = path.join(WORK, 'unknown-token.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));
  const out = path.join(WORK, 'unknown-token.json');
  const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 2, `an unknown token path must fail the compile:\n${r.out}`);
  assert.match(r.out, /unknown token path "type\.scale\.gigantic"/);
  assert.equal(fs.existsSync(out), false, 'nothing must be written for an unresolvable token');
});

// ---- one band, never two -----------------------------------------------------
test('an explicit page-header-band recipe suppresses the archetype chrome band (exactly ONE band)', () => {
  for (const theme of ['shesha', 'requirements-studio']) {
    const doc = snap(theme);
    const bands = findAll(doc, (n) => n.componentName === 'pageHeaderBand');
    assert.equal(bands.length, 1, `${theme}: expected exactly ONE page-header band, found ${bands.length}`);
    // it is the FIRST child of the page root — what validate-styledness' page-anatomy floor reads
    assert.equal(doc.components[0].components[0].componentName, 'pageHeaderBand');
    // and the rest of the record-detail chrome sits AFTER it, not before
    assert.equal(doc.components[0].components[1].type, 'KeyInformationBar');
    const title = byName(doc, 'titleText');
    assert.equal(title.content, 'Air Handling Unit 04', 'the band title comes from the declaring node\'s heading');
    // one page title: the heading the band consumed is not also in the body
    const dupes = findAll(doc, (n) => n.content === 'Air Handling Unit 04');
    assert.equal(dupes.length, 1, `${theme}: the declared band's title is duplicated in the body`);
  }
  // the compiler SAYS which band it used, and says it only once
  const out = path.join(WORK, 'band-log.json');
  const r = run('compile-blueprint.js', ['--blueprint', FIXTURE, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /chrome \(record-detail\): pageHeaderBand \(blueprint-declared\) \+ metaStrip/);
  assert.equal((fs.readFileSync(out, 'utf8').match(/"componentName": "pageHeaderBand"/g) ?? []).length, 1);

  // control: the SAME blueprint without the recipe still gets a band — from the archetype
  // chrome this time. One band either way; the recipe changes WHO emits it, not how many.
  const bp = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  bp.form.name = 'no-recipe';
  delete bp.layout.children[0].presentation;
  const bpFile = path.join(WORK, 'no-recipe.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));
  const chromeOut = path.join(WORK, 'no-recipe.json');
  const r2 = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', chromeOut, '--no-live', '--theme', 'shesha']);
  assert.equal(r2.code, 0, r2.out);
  assert.equal((fs.readFileSync(chromeOut, 'utf8').match(/"componentName": "pageHeaderBand"/g) ?? []).length, 1);
  assert.doesNotMatch(r2.out, /blueprint-declared/);
  assert.equal(fs.existsSync(`${chromeOut}.presentation.json`), false,
    'a blueprint that declares no recipe must leave no presentation manifest');
});

// ---- role mapping ------------------------------------------------------------
test('role/surface map to the measured carriers: status → chip, metric → statistic, surface:card → card surface', () => {
  const doc = snap('shesha');
  const chip = byName(doc, 'assetStatusChip');
  assert.ok(chip, 'role:"status" produced no chip');
  assert.equal(chip.type, 'refListStatus', `a status is a chip, not a ${chip.type}`);
  assert.equal(chip.propertyName, 'status');
  // identity copied from the blueprint binding, never guessed [R-015]
  assert.deepEqual(chip.referenceListId, { module: 'boxfusion.test', name: 'AssetStatus' });
  // and nothing in the form renders that status as prose
  assert.deepEqual(findAll(doc, (n) => n.propertyName === 'status' && ['text', 'textField', 'textArea'].includes(n.type)), []);

  const metric = byName(doc, 'uptimeMetric');
  assert.equal(metric.type, 'statistic', `role:"metric" must emit a statistic, got ${metric.type}`);
  assert.equal(metric.title, 'Uptime');
  assert.equal(metric.value, '98.6%');

  const row = byName(doc, 'metricsRow');
  assert.equal(row.type, 'container');
  assert.ok(row.desktop.background?.color, 'surface:"card" left no background');
  assert.ok(row.desktop.border?.border?.all?.color, 'surface:"card" left no hairline');
  assert.equal(row.desktop.flexDirection, 'row', 'the surface must not disturb the flex model [R-029]');
});

test('role:"meta" builds a KeyInformationBar from the node\'s bound children, role:"title" a heading', () => {
  const bp = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  bp.form.name = 'meta-and-title';
  bp.layout.children[2] = {
    kind: 'row', name: 'assetMeta', presentation: { role: 'meta' },
    children: [
      { kind: 'field', property: 'name', title: 'Asset name' },
      { kind: 'field', property: 'serialNumber' },
    ],
  };
  bp.layout.children.push({ kind: 'text', name: 'sectionTitle', content: 'Maintenance', presentation: { role: 'title', tone: 'accent' } });
  const bpFile = path.join(WORK, 'meta-and-title.blueprint.json');
  fs.writeFileSync(bpFile, JSON.stringify(bp, null, 2));
  const out = path.join(WORK, 'meta-and-title.json');
  const r = run('compile-blueprint.js', ['--blueprint', bpFile, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, `compile failed (its own gates rejected it):\n${r.out}`);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));

  const bar = byName(doc, 'assetMeta');
  assert.equal(bar.type, 'KeyInformationBar', `role:"meta" must emit the native strip, got ${bar.type}`);
  assert.equal(bar.columns.length, 2, 'one cell per bound child');
  assert.deepEqual(bar.columns.map((c) => c.components[0].content), ['ASSET NAME', 'SERIAL NUMBER']);
  assert.deepEqual(bar.columns.map((c) => c.components[1].content), ['{{data.name}}', '{{data.serialNumber}}']);

  const heading = byName(doc, 'sectionTitle');
  assert.equal(heading.type, 'text');
  assert.ok(heading.desktop.font.size >= 18, `role:"title" must take a title type step, got ${heading.desktop.font.size}`);
  assert.equal(heading.desktop.font.color, '#003BB2', 'tone:"accent" must colour the title ink from the theme');
  assert.equal(heading.contentType, 'custom', 'text ink without contentType:"custom" is a no-op [R-052]');
});

// ---- tone resolves through the ACTIVE theme ----------------------------------
test('tone:"accent" resolves a DIFFERENT colour under shesha and requirements-studio', () => {
  const themeOf = (t) => JSON.parse(fs.readFileSync(
    path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes', `${t}.tokens.json`), 'utf8'));
  const accentOf = (t) => byName(snap(t), 'uptimeMetric').valueFont.color;

  const shesha = accentOf('shesha');
  const rs = accentOf('requirements-studio');
  assert.equal(shesha, themeOf('shesha').palette.brand.primary, 'accent must resolve to the theme brand primary');
  assert.equal(rs, themeOf('requirements-studio').palette.brand.primary);
  assert.notEqual(shesha, rs, 'tone:"accent" resolved the same colour under both themes — it is a literal, not a token [R-042]');

  // the override rides the same road: type.scale.titleLg is 24 in shesha, 28 in RS
  for (const t of ['shesha', 'requirements-studio']) {
    assert.equal(byName(snap(t), 'uptimeMetric').valueFont.size, themeOf(t).type.scale.titleLg,
      `${t}: the overrides token path did not resolve against the active theme`);
  }
  assert.notEqual(themeOf('shesha').type.scale.titleLg, themeOf('requirements-studio').type.scale.titleLg,
    'the override assertion above is vacuous unless the two themes size titleLg differently');

  // --no-style resolves NO brand value at all [R-042]
  const out = path.join(WORK, 'no-style.json');
  const r = run('compile-blueprint.js', ['--blueprint', FIXTURE, '--out', out, '--no-live', '--theme', 'shesha', '--no-style']);
  assert.equal(r.code, 0, r.out);
  const neutral = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(neutral, new RegExp(themeOf('shesha').palette.brand.primary, 'i'),
    '--no-style still emitted the brand accent');
  assert.match(r.out, /override font\.size → type\.scale\.titleLg not resolved/);
});

// ---- the manifest gives the gate teeth ---------------------------------------
test('the presentation manifest records the declared recipe, and validate-styledness fails when it did not land', () => {
  const out = path.join(WORK, 'manifest.json');
  const r = run('compile-blueprint.js', ['--blueprint', FIXTURE, '--out', out, '--no-live', '--theme', 'shesha']);
  assert.equal(r.code, 0, r.out);
  const manifest = JSON.parse(fs.readFileSync(`${out}.presentation.json`, 'utf8'));
  assert.equal(manifest.theme, 'shesha');
  assert.deepEqual(manifest.declared.map((d) => [d.recipe, d.componentName, d.landed]),
    [['page-header-band', 'pageHeaderBand', true]]);

  // it PASSES while the band is there …
  const pass = run('validate-styledness.js', [out, '--archetype', 'record-detail']);
  assert.equal(pass.code, 0, pass.out);
  assert.match(pass.out, /OK {3}declared-recipe — "page-header-band" at node "headerBand" landed as "pageHeaderBand"/);

  // … and FAILS when the declared recipe is gone from the markup. The band is renamed
  // rather than deleted, so page-anatomy still passes structurally and declared-recipe is
  // the lone failure — that is what makes this a check with teeth and not a side effect.
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  doc.components[0].components[0].componentName = 'someOtherHeader';
  const probe = path.join(WORK, 'lost-recipe.json');
  fs.writeFileSync(probe, JSON.stringify(doc, null, 2));
  fs.copyFileSync(`${out}.presentation.json`, `${probe}.presentation.json`);
  const fail = run('validate-styledness.js', [probe, '--archetype', 'record-detail']);
  assert.equal(fail.code, 1, `a declared recipe that left no trace must FAIL:\n${fail.out}`);
  const fails = fail.out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(/\s+/)[1]);
  assert.deepEqual(fails, ['declared-recipe'], `declared-recipe must be the lone failure:\n${fail.out}`);
  assert.match(fail.out, /no component named "pageHeaderBand"/);

  // no manifest → the check is silent (every other fixture in the suite)
  const silent = run('validate-styledness.js', [path.join(SNAPSHOTS, 'table-worklist--shesha.json'), '--archetype', 'table-worklist']);
  assert.equal(silent.code, 0);
  assert.doesNotMatch(silent.out, /declared-recipe/);
});
