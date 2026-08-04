// Pins assets/component-registry.json — the TYPED SHAPE authority — and the
// authority boundary between it and the measured capability matrix.
//
// The registry says what EXISTS (components, prop paths, prop types).
// assets/measured-capability-matrix.json says what RENDERS (R-053). Conflating the
// two is the failure this file exists to prevent, from both directions:
//
//   * a registry prop with no measurement is "not-measured", never "supported" —
//     that direction is a documentation rule (references/gym.md), not testable here;
//   * a MEASURED path the registry does not carry IS testable, and is a registry
//     bug: it means generate-component-kb.js missed a prop, so validate-schema.js
//     can never type a channel the gym proved real. That cross-check is the heart of
//     this file.
//
// It also pins the two consumers that read the registry for behaviour rather than
// for typing: validate-schema.js (typed enum rejection) and lookup.js (answering a
// non-authorable type instead of printing a bare UNRESOLVED).

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'form-edit-registry-'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const registry = readJson(path.join(SKILL, 'assets', 'component-registry.json'));
const matrix = readJson(path.join(SKILL, 'assets', 'measured-capability-matrix.json'));

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// ---- (a) the registry is well-formed -----------------------------------------

test('registry parses and carries its stamps + top-level sections', () => {
  for (const key of ['frameworkVersion', 'frameworkVersionSource', 'generatedFrom', 'generatedAt', 'generator', 'stats', 'formSettings', 'components']) {
    assert.ok(key in registry, `component-registry.json has no "${key}"`);
  }
  assert.match(String(registry.frameworkVersion), /^\d+\.\d+/, 'frameworkVersion is not a version string');
  // the mode is stamped so a consumer report can say which source it read
  assert.ok(['live-backend', 'offline-kb'].includes(registry.generatedFrom), `unexpected generatedFrom ${registry.generatedFrom}`);
});

test('components section is a non-empty map of typed component rows', () => {
  const types = Object.keys(registry.components);
  assert.ok(types.length > 50, `expected the full 0.45 catalogue, found ${types.length} components`);
  assert.equal(types.length, registry.stats.total, 'stats.total disagrees with the components map');
  for (const [type, c] of Object.entries(registry.components)) {
    assert.equal(c.type, type, `${type}: row.type disagrees with its key`);
    assert.ok(Array.isArray(c.props), `${type}: props is not an array`);
    assert.ok(c.propTypes && typeof c.propTypes === 'object', `${type}: propTypes is not an object`);
    assert.equal(typeof c.authorable, 'boolean', `${type}: authorable is not a boolean`);
    // a non-authorable component MUST carry a reason — lookup.js answers from it
    if (!c.authorable) assert.ok(c.authorableReason, `${type}: authorable:false with no authorableReason`);
    // slots, when declared, are named strings — compile-blueprint.js's nesting guard
    // prints them as the valid slot list
    if (c.customContainerNames !== null) {
      assert.ok(Array.isArray(c.customContainerNames) && c.customContainerNames.length, `${type}: customContainerNames is neither null nor a non-empty array`);
      for (const s of c.customContainerNames) assert.equal(typeof s, 'string');
    }
  }
});

test('formSettings section is present and typed', () => {
  const fs_ = registry.formSettings;
  assert.ok(Array.isArray(fs_.props) && fs_.props.length, 'formSettings.props is empty');
  assert.ok(fs_.propTypes && Object.keys(fs_.propTypes).length, 'formSettings.propTypes is empty');
  for (const [prop, def] of Object.entries(fs_.propTypes)) {
    assert.ok(['enum', 'numeric-picker', 'number', 'boolean', 'string', 'css-length'].includes(def.type), `formSettings.${prop}: unknown type ${def.type}`);
    if (def.type === 'enum' || def.type === 'numeric-picker') {
      assert.ok(Array.isArray(def.values) && def.values.length, `formSettings.${prop}: ${def.type} with no values`);
    }
    assert.ok(def.source, `formSettings.${prop}: no source recorded`);
  }
});

test('every prop type is a known kind with the evidence its kind requires', () => {
  const KINDS = new Set(['enum', 'numeric-picker', 'number', 'boolean', 'string', 'css-length']);
  for (const [type, c] of Object.entries(registry.components)) {
    for (const [prop, def] of Object.entries(c.propTypes)) {
      assert.ok(KINDS.has(def.type), `${type}.${prop}: unknown prop type ${def.type}`);
      if (def.type === 'enum' || def.type === 'numeric-picker') {
        assert.ok(Array.isArray(def.values) && def.values.length, `${type}.${prop}: ${def.type} with no values — an empty union would reject everything`);
      }
      assert.ok(def.source, `${type}.${prop}: typed with no source`);
    }
  }
});

// ---- (a2) provenance + staleness ---------------------------------------------
// assets/components-kb/ is canonical and hand-inspectable; component-registry.json is
// a GENERATED aggregate of it. The provenance block records which generator produced
// the committed file and the sourceHash of the KB it was produced from, so "the
// registry has drifted behind the KB" is a TEST FAILURE instead of a silent lie in a
// 14k-line artifact nobody diffs.
//
// The hash definition is owned by gen-registry.mjs (kbSourceHash) and asked for via
// `--print-source-hash`, deliberately rather than reimplemented here: two copies of
// "what counts as a KB change" would eventually disagree, and the disagreement would
// look like drift.

test('the registry carries a provenance block', () => {
  const p = registry.provenance;
  assert.ok(p && typeof p === 'object', 'component-registry.json has no provenance block — regenerate via /shesha-gym');
  for (const key of ['generatedBy', 'generatorVersion', 'mode', 'sourceHash', 'generatedAt']) {
    assert.ok(p[key], `provenance has no "${key}"`);
  }
  assert.equal(p.generatedBy, 'gen-registry.mjs');
  assert.ok(['live-backend', 'offline-kb'].includes(p.mode), `unexpected provenance.mode ${p.mode}`);
  assert.match(p.sourceHash, /^sha256:[0-9a-f]{64}$/, `provenance.sourceHash is not a sha256 stamp: ${p.sourceHash}`);
  assert.ok(!Number.isNaN(Date.parse(p.generatedAt)), `provenance.generatedAt is not a date: ${p.generatedAt}`);
  // the mode must not contradict the older top-level stamp
  assert.equal(p.mode, registry.generatedFrom, 'provenance.mode disagrees with generatedFrom');
});

test('the registry is not stale — components-kb still hashes to provenance.sourceHash', () => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'gen-registry.mjs'), '--print-source-hash'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `gen-registry.mjs --print-source-hash failed:\n${r.stdout}${r.stderr}`);
  const current = (r.stdout || '').trim();
  assert.match(current, /^sha256:[0-9a-f]{64}$/, `unexpected hash output: ${current}`);
  assert.equal(
    current,
    registry.provenance.sourceHash,
    'components-kb changed since the registry was generated — regenerate via /shesha-gym\n' +
    `  registry provenance.sourceHash: ${registry.provenance.sourceHash}\n` +
    `  components-kb hashes to:        ${current}\n` +
    `  scope: ${registry.provenance.sourceHashScope ?? 'non-underscore assets/components-kb/*.json'}`,
  );
});

// ---- (b) cross-check: measured ⊆ registry ------------------------------------
// Matrix setting keys are spelled `<path>=<variant>` (e.g.
// "desktop.dimensions.width=317px"), exactly the spelling channel-map.js and
// validate-guardrails' checkStyleChannels normalise with key.split('=')[0]. Two
// further normalisations, both matching the registry's own stated contract:
//   * BREAKPOINT PREFIX — registry prop paths are device-agnostic; appearance
//     channels are authored inside desktop/tablet/mobile (registry `notes`).
//   * COMPOUND ANCESTOR — the KB surfaces a compound settings field by its own
//     path (`font`) and its flat resolved leaves (`fontSize`), not as dotted
//     sub-paths, so the gym's `font.size` is matched by its ancestor `font`. This
//     is the same ancestor walk gen-registry.mjs uses to seed the prop set.
const BREAKPOINT = /^(desktop|tablet|mobile)\./;

const normalizeMatrixPath = (key) => String(key).split('=')[0].replace(BREAKPOINT, '');

/** true when the registry carries this path, or any dotted ancestor of it */
function registryKnows(entry, dotted) {
  const known = new Set(entry.props);
  const parts = dotted.split('.');
  for (let i = parts.length; i > 0; i--) if (known.has(parts.slice(0, i).join('.'))) return true;
  return false;
}

// KNOWN GAPS, each one a deliberate exemption rather than a normalisation failure.
//
// dataContext: assets/components-kb/dataContext.json is parsed from
// `dataTable/tableContext/settingsForm.json` — the tableContext settings form, which
// is the closest thing in the renderer source, but it does not carry the generic
// dataContext component's own four settings. The gym measured them on the real
// component, so they exist; the KB simply cannot see them. Fixing this needs a KB
// generator change (a dataContext-specific settings source), not a test change.
// Until then these four are measured-but-untyped: authoring them is legal, and
// validate-schema.js will not type them.
const CROSS_CHECK_EXEMPT = new Set([
  'dataContext|items',
  'dataContext|initialDataCode',
  'dataContext|onInitAction',
  'dataContext|onChangeAction',
]);

test('every measured component exists in the registry', () => {
  const missing = Object.keys(matrix.components ?? {}).filter((t) => !registry.components[t]);
  assert.deepEqual(missing, [], `components the gym measured but the registry does not know: ${missing.join(', ')}`);
});

test('every measured setting path exists in the registry (modulo the documented exemptions)', () => {
  const missing = [];
  for (const [type, comp] of Object.entries(matrix.components ?? {})) {
    const entry = registry.components[type];
    if (!entry) continue;   // reported by the test above
    for (const key of Object.keys(comp.settings ?? {})) {
      const p = normalizeMatrixPath(key);
      if (p.startsWith('__')) continue;         // synthetic channels (__renderStatus)
      if (CROSS_CHECK_EXEMPT.has(`${type}|${p}`)) continue;
      if (!registryKnows(entry, p)) missing.push(`${type}|${p} (from "${key}")`);
    }
  }
  assert.deepEqual(missing, [], `measured paths absent from the registry — the KB parse missed these props:\n  ${missing.join('\n  ')}`);
});

test('the exemption set is live, not stale — every exempt path is still measured and still absent', () => {
  for (const exempt of CROSS_CHECK_EXEMPT) {
    const [type, p] = exempt.split('|');
    const comp = matrix.components?.[type];
    assert.ok(comp, `exemption ${exempt}: component is no longer in the matrix — drop the exemption`);
    const stillMeasured = Object.keys(comp.settings ?? {}).some((k) => normalizeMatrixPath(k) === p);
    assert.ok(stillMeasured, `exemption ${exempt}: no longer measured — drop the exemption`);
    const entry = registry.components[type];
    assert.ok(entry, `exemption ${exempt}: component absent from the registry`);
    assert.ok(!registryKnows(entry, p), `exemption ${exempt}: the registry now KNOWS this path — drop the exemption`);
  }
});

// ---- (c) validate-schema.js is really typed by the registry -------------------

test('validate-schema rejects a buttonGroup enum value the registry does not list', () => {
  // the real enum off the registry — never a hard-coded guess
  const def = registry.components.buttonGroup?.propTypes?.gap;
  assert.ok(def, 'registry does not type buttonGroup.gap — pick another typed enum for this probe');
  assert.equal(def.type, 'enum', `buttonGroup.gap is typed ${def.type}, not enum`);
  const bad = 'huge';
  assert.ok(!def.values.includes(bad), `"${bad}" is actually a legal member of ${JSON.stringify(def.values)}`);

  const file = path.join(WORK, 'bad-enum.json');
  fs.writeFileSync(file, JSON.stringify({
    components: [{
      id: '11111111-1111-1111-1111-111111111111',
      type: 'buttonGroup', version: registry.components.buttonGroup.version ?? 5,
      componentName: 'actions', propertyName: 'actions', isInline: true,
      gap: bad, items: [],
    }],
    formSettings: { layout: 'vertical', modelType: 'Probe.Entity' },
  }, null, 2));

  const r = run('validate-schema.js', [file]);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
  assert.match(r.out, /is not a member of buttonGroup\.gap/, r.out);
  assert.match(r.out, new RegExp(JSON.stringify(def.values).replace(/[[\]]/g, '\\$&')), r.out);
});

test('the same form with a legal enum member passes', () => {
  const def = registry.components.buttonGroup.propTypes.gap;
  const file = path.join(WORK, 'good-enum.json');
  fs.writeFileSync(file, JSON.stringify({
    components: [{
      id: '11111111-1111-1111-1111-111111111111',
      type: 'buttonGroup', version: registry.components.buttonGroup.version ?? 5,
      componentName: 'actions', propertyName: 'actions', isInline: true,
      gap: def.values[0], items: [],
    }],
    formSettings: { layout: 'vertical', modelType: 'Probe.Entity' },
  }, null, 2));
  const r = run('validate-schema.js', [file]);
  assert.equal(r.code, 0, `a legal enum member must pass — typed checking has a false positive:\n${r.out}`);
});

// ---- (d) lookup.js answers a non-authorable type from the registry -----------

test('lookup answers datatable_template with its authorableReason instead of a bare UNRESOLVED', () => {
  const entry = registry.components.datatable_template;
  assert.ok(entry, 'registry no longer knows datatable_template — pick another non-authorable type');
  assert.equal(entry.authorable, false);
  assert.ok(entry.authorableReason, 'datatable_template has no authorableReason');

  const r = run('lookup.js', ['datatable_template']);
  // still a miss: the answer is "do not author this", so the exit code stays 1
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
  assert.match(r.out, new RegExp(`NOT AUTHORABLE \\(${entry.authorableReason}\\)`), r.out);
  assert.match(r.out, /why: /, `no guidance line printed:\n${r.out}`);
  assert.doesNotMatch(r.out, /^UNRESOLVED/m, `the generic UNRESOLVED line must not be the answer:\n${r.out}`);
});

test('a type the registry does not know still gets the generic UNRESOLVED line', () => {
  const r = run('lookup.js', ['sheshaNotAThingAtAll']);
  assert.equal(r.code, 1);
  assert.match(r.out, /UNRESOLVED \(check assets\/groups\/index\.json/, r.out);
});

// ---- the compiler's slot guard reads the registry ------------------------------

test('the compiler slot guard reads customContainerNames from the registry', () => {
  const slotted = Object.values(registry.components).filter((c) => Array.isArray(c.customContainerNames) && c.customContainerNames.length);
  assert.ok(slotted.length > 0, 'no component declares customContainerNames — the slot guard has nothing to guard');
  const src = fs.readFileSync(path.join(SCRIPTS, 'compile', 'compile-node.mjs'), 'utf8');
  assert.match(src, /customContainerNames/, 'compile/compile-node.mjs does not read customContainerNames');
  assert.match(src, /component-registry\.json/, 'compile/compile-node.mjs does not load the registry');
});
