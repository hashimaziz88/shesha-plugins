#!/usr/bin/env node
/**
 * gen-registry.mjs — generate assets/component-registry.json: the TYPED registry of
 * what each 0.45 component IS (its props, and the type of each prop).
 *
 * Usage:
 *   node scripts/gen-registry.mjs                       # try the backend, fall back to offline
 *   node scripts/gen-registry.mjs --offline             # never touch a backend
 *   node scripts/gen-registry.mjs --backend <url> [--token-file <path>]
 *   node scripts/gen-registry.mjs --out <path>
 *
 * AUTHORITY BOUNDARY. The registry says what EXISTS (the typed shape of every
 * component). It does NOT say what RENDERS — that is
 * assets/measured-capability-matrix.json and the R-053 render gate. A prop that is
 * in the registry but carries no matrix measurement is `not-measured`, never
 * "supported".
 *
 * ---- generation sources, in order of preference -------------------------------
 *
 * The component CATALOGUE (types, props, settings shape) is a property of the
 * RENDERER, not of the backend: no Shesha API enumerates designer components. So
 * the catalogue always comes from the bundled, offline-capable
 * assets/components-kb/ — itself generated from the renderer source by
 * scripts/generate-component-kb.js (+ extract-enums.js for the dropdown enums).
 *
 * What a LIVE backend adds, and nothing else can:
 *   1. `frameworkVersion` — the real version of the Shesha module on the machine
 *      being pushed to (app/Module/GetAll → the module named "Shesha" → .version).
 *   2. per-component `version` harvested off real markup on that backend, exactly
 *      the R-049 live-version probe backend-probe.mjs --versions performs. A type
 *      stamped differently on the backend than in the KB is recorded as
 *      versionSource:"live" so a push is stamped for the target machine.
 *
 * Both modes are supported and the mode used is PRINTED and stamped into the file
 * as `generatedFrom` ("live-backend" | "offline-kb"), so a consumer report can be
 * honest about which one it read.
 *
 * Credentials, post-hardening (gym-lib/api.js owns the policy): the admin/123qwe
 * default is localhost-only; for any remote backend set SHESHA_USER /
 * SHESHA_PASSWORD. --token-file must point OUTSIDE this skill directory (a session
 * token has no business in the installed plugin tree — contracts.md §2-3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GymApi } from './gym-lib/api.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(SCRIPT_DIR, '..');
const KB_DIR = path.join(SKILL, 'assets', 'components-kb');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OFFLINE = args.includes('--offline');
const BACKEND = argVal('--backend', 'http://localhost:21021');
const OUT = argVal('--out', path.join(SKILL, 'assets', 'component-registry.json'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

// ---- bundled offline sources --------------------------------------------------

const kbIndex = readJson(path.join(KB_DIR, '_index.json'));
const kbMeta = readJson(path.join(KB_DIR, '_meta.json'));
const kbEnums = readJson(path.join(KB_DIR, '_enums.json'));
const groups = readJson(path.join(SKILL, 'assets', 'groups', 'index.json')).components ?? {};
const matrix = (() => {
  try { return readJson(path.join(SKILL, 'assets', 'measured-capability-matrix.json')); }
  catch { return null; }
})();
const formSchema = readJson(path.join(SKILL, 'schemas', 'form-config.schema.json'));

const KB_TYPES = Object.keys(kbIndex).filter((t) => !t.startsWith('_'));

// ---- prop typing --------------------------------------------------------------
// Only types with EVIDENCE in the bundled sources are emitted. `enum` values come
// from _enums.json (parsed from the renderer's own settings forms/unions); the rest
// come from the settings field's editor component, which is the renderer's own
// declaration of what the field accepts.
const EDITOR_TYPE = {
  numberField: 'number',
  checkbox: 'boolean',
  textField: 'string',
  textArea: 'string',
  codeEditor: 'string',
  colorPicker: 'string',
  dropdown: null,   // typed only when _enums.json knows the members
  radio: null,
};
// The 0.45 `dimensions` style object takes CSS LENGTH STRINGS ("317px", "100%",
// "auto") on every axis — a bare number there is the coercion bug the gym measures
// (the renderer concatenates, it does not coerce), so it gets its own type.
// Deliberately scoped to `…dimensions.<axis>`: a bare `width`/`maxHeight` prop
// elsewhere (chevron.width, list.maxHeight) is an antd numeric prop, not a length.
const CSS_LENGTH = /(^|\.)dimensions\.(width|height|minWidth|maxWidth|minHeight|maxHeight)$/;

const NUMERIC = /^-?\d+(\.\d+)?$/;

function enumType(entry) {
  const values = entry.values;
  // An all-numeric option list (pageSize 5/10/20/…, heading level 1–5) is a PICKER's
  // presets, not a closed union: the renderer accepts any number there. Typing it as
  // an enum would reject a legitimate `defaultPageSize: 12`. So it becomes a
  // numeric-picker: the presets are recorded, and only a non-numeric value is wrong.
  const allNumeric = values.every((v) => NUMERIC.test(String(v)));
  return {
    type: allNumeric ? 'numeric-picker' : 'enum',
    values,
    source: entry.source ?? 'kb-enums',
  };
}

function propTypeFor(type, propPath, editorType) {
  const enumEntry = kbEnums[type]?.[propPath];
  if (enumEntry && Array.isArray(enumEntry.values) && enumEntry.values.length) {
    return enumType(enumEntry);
  }
  if (CSS_LENGTH.test(propPath)) return { type: 'css-length', source: 'kb-path' };
  const t = EDITOR_TYPE[editorType];
  if (t) return { type: t, source: `kb-editor:${editorType}` };
  return null;
}

/** every dotted ancestor of a path: "border.radius.all" → border, border.radius */
function ancestors(p) {
  const parts = p.split('.');
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}

// ---- live enrichment ----------------------------------------------------------

/**
 * Harvest the target backend's framework version + live component versions.
 * Returns null when the backend cannot be reached / authenticated — the caller
 * then falls back to offline, loudly. A single non-2xx never throws.
 */
async function harvestLive(baseUrl) {
  const api = new GymApi(baseUrl, { tokenFile: argVal('--token-file', null) });
  try { await api.authenticate(); }
  catch (err) { console.error(`gen-registry: backend ${baseUrl} unusable — ${err.message}`); return null; }

  const mods = await api.getJson('/api/services/app/Module/GetAll?MaxResultCount=200');
  if (!mods.ok) { console.error(`gen-registry: Module/GetAll HTTP ${mods.status} — falling back`); return null; }
  const items = mods.body?.result?.items ?? mods.body?.result ?? [];
  const shesha = items.find((m) => m?.name === 'Shesha');
  // the Shesha core module's version IS the framework version on this machine;
  // 0.45 spells it `currentVersionNo` (older payloads used `version`)
  const frameworkVersion = shesha?.currentVersionNo ?? shesha?.version ?? null;

  // Live component versions: walk real markup on THIS backend, newest first — the
  // same mechanism as backend-probe.mjs --versions [R-049].
  const versions = {};
  const ambiguous = {};
  const harvestedFrom = [];
  const list = await api.getJson('/api/services/Shesha/FormConfiguration/GetAll?MaxResultCount=200');
  let forms = list.body?.result?.items ?? list.body?.result ?? [];
  const stamp = (f) => Date.parse(f?.lastModificationTime || f?.creationTime || '') || 0;
  forms = forms.filter((f) => f?.id).sort((a, b) => stamp(b) - stamp(a)).slice(0, 12);
  for (const f of forms) {
    const r = await api.getJson(`/api/services/Shesha/FormConfiguration/GetJson?id=${encodeURIComponent(f.id)}`);
    if (!r.ok || !r.body) { harvestedFrom.push({ name: f.name, status: r.status, note: 'no markup' }); continue; }
    let markup = r.body;
    if (typeof markup.markup === 'string') { try { markup = JSON.parse(markup.markup); } catch { /* leave */ } }
    if (markup.result) markup = typeof markup.result.markup === 'string' ? JSON.parse(markup.result.markup) : markup.result;
    let seen = 0;
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      if (typeof v.type === 'string' && Number.isInteger(v.version)) {
        seen++;
        if (versions[v.type] === undefined) versions[v.type] = v.version;
        else if (versions[v.type] !== v.version) (ambiguous[v.type] ??= new Set()).add(v.version);
      }
      for (const x of Object.values(v)) walk(x);
    })(markup?.components ?? markup);
    harvestedFrom.push({ name: f.name, components: seen });
  }

  return {
    baseUrl: api.baseUrl,
    frameworkVersion,
    versions,
    // a type stamped at two versions in one corpus is ambiguous — recorded, never
    // silently resolved, so the KB stays the arbiter for it
    ambiguous: Object.fromEntries(Object.entries(ambiguous).map(([t, s]) => [t, [versions[t], ...s]])),
    harvestedFrom,
  };
}

// ---- build --------------------------------------------------------------------

let live = null;
if (!OFFLINE) live = await harvestLive(BACKEND);
const mode = live ? 'live-backend' : 'offline-kb';

const components = {};
const stats = { total: 0, authorable: 0, notAuthorable: 0, withPropTypes: 0, propTypeCount: 0, liveVersions: 0, versionDrift: 0, withSlots: 0 };

for (const type of KB_TYPES.sort()) {
  const kb = readJson(path.join(KB_DIR, kbIndex[type].file ?? `${type}.json`));
  const fields = Array.isArray(kb.settingsFields) ? kb.settingsFields : [];
  const resolved = kb.settingsProps?.resolvedProps ?? [];

  const props = new Set([...resolved, ...fields.map((f) => f.path), ...(kb.appearanceFieldPaths ?? [])]);
  for (const p of [...props]) for (const a of ancestors(p)) props.add(a);
  props.delete(undefined);

  const propTypes = {};
  const editorFor = new Map(fields.map((f) => [f.path, f.editorType]));
  for (const p of props) {
    const t = propTypeFor(type, p, editorFor.get(p));
    if (t) propTypes[p] = t;
  }
  // _enums.json can know a union the settings form does not surface as a field
  for (const [p, e] of Object.entries(kbEnums[type] ?? {})) {
    if (!propTypes[p] && Array.isArray(e.values) && e.values.length) {
      propTypes[p] = enumType(e);
      props.add(p);
    }
  }

  // authorable = in this skill's toolbox allowlist (assets/groups/index.json).
  // A type outside it is not usable by the authoring pipeline; the reason says why
  // so lookup.js can answer instead of printing a bare UNRESOLVED.
  const group = groups[type] ?? null;
  const noSettingsForm = kb.settingsForm?.mechanism === 'none' || fields.length === 0;
  const authorable = Boolean(group);
  let authorableReason = null;
  if (!authorable) authorableReason = noSettingsForm ? 'no-settings-form' : 'not-in-toolbox-allowlist';

  const slots = kb.slots ?? null;
  const customContainerNames = Array.isArray(slots?.customContainerNames) && slots.customContainerNames.length
    ? slots.customContainerNames : null;

  const kbVersion = kbIndex[type]?.version ?? kb.version ?? null;
  // `version` is ALWAYS the KB's — the KB is the arbiter for this generation and the
  // committed registry has to be portable. A live harvest reads version stamps off
  // whatever markup happens to exist on that backend, so an old form yields an OLD
  // stamp: useful as DRIFT evidence (R-049), useless as the canonical version. So the
  // live number is recorded beside it, never substituted for it.
  const liveVersion = Number.isInteger(live?.versions?.[type]) ? live.versions[type] : null;

  components[type] = {
    type,
    name: kb.name ?? kbIndex[type]?.name ?? type,
    group,
    version: kbVersion,
    versionSource: 'kb',
    liveVersion,
    versionDrift: liveVersion !== null && liveVersion !== kbVersion,
    isInput: kb.isInput ?? kbIndex[type]?.isInput ?? null,
    isOutput: kb.isOutput ?? null,
    // NOT derivable from the bundled sources: `isHidden` is a field on the
    // renderer's component DEFINITION, which the KB does not carry. null = unknown,
    // never false — a guessed false would licence authoring a hidden component.
    isHidden: null,
    authorable,
    authorableReason,
    hostsChildren: slots?.hostsChildren ?? null,
    customContainerNames,
    settingsParseQuality: kb.settingsForm?.parseQuality ?? null,
    props: [...props].filter(Boolean).sort(),
    propTypes,
  };

  stats.total++;
  if (authorable) stats.authorable++; else stats.notAuthorable++;
  if (Object.keys(propTypes).length) { stats.withPropTypes++; stats.propTypeCount += Object.keys(propTypes).length; }
  if (liveVersion !== null) stats.liveVersions++;
  if (liveVersion !== null && liveVersion !== kbVersion) stats.versionDrift++;
  if (customContainerNames) stats.withSlots++;
}

// ---- form-level settings ------------------------------------------------------
// Form settings are not a component, so they have no KB entry. Their declared
// shape lives in schemas/form-config.schema.json (generated from the same KB
// generation) and their vocabulary in references/components/form-shape.md — the two
// in-repo sources, both offline-capable.
const FORM_SETTINGS_PROPS = [
  '_formFields', 'access', 'colon', 'dataLoaderType', 'dataLoadersSettings',
  'dataSubmitterType', 'dataSubmittersSettings', 'labelCol', 'layout', 'modelType',
  'onAfterDataLoad', 'onBeforeDataLoad', 'onBeforeSubmit', 'onDataLoaded',
  'onPrepareSubmitData', 'onSubmitFailed', 'onSubmitSuccess', 'permissions',
  'showModeToggler', 'uniqueFormId', 'version', 'wrapperCol',
];
const formSettings = {
  props: [...FORM_SETTINGS_PROPS].sort(),
  propTypes: {
    // enum straight off the generated schema — the same list validate-schema
    // already enforces, now typed so the typed walker owns it uniformly
    layout: { type: 'enum', values: formSchema.properties.formSettings.properties.layout.enum, source: 'form-config.schema.json' },
    // references/components/form-shape.md § Loader / submitter
    dataLoaderType: { type: 'enum', values: ['none', 'gql', 'custom'], source: 'form-shape.md' },
    dataSubmitterType: { type: 'enum', values: ['none', 'gql', 'custom'], source: 'form-shape.md' },
    access: { type: 'number', source: 'form-config.schema.json' },
    version: { type: 'number', source: 'corpus' },
    colon: { type: 'boolean', source: 'corpus' },
    showModeToggler: { type: 'boolean', source: 'corpus' },
  },
};

const registry = {
  frameworkVersion: live?.frameworkVersion ?? matrix?.sheshaVersion ?? null,
  frameworkVersionSource: live?.frameworkVersion
    ? 'live-backend:app/Module/GetAll[Shesha].version'
    : (matrix?.sheshaVersion ? 'assets/measured-capability-matrix.json:sheshaVersion' : 'unknown'),
  generatedFrom: mode,
  generatedAt: new Date().toISOString(),
  generator: 'scripts/gen-registry.mjs',
  source: {
    componentsKb: {
      sourceBranch: kbMeta.sourceBranch ?? null,
      commit: kbMeta.commit ?? null,
      generatedAt: kbMeta.generatedAt ?? null,
      componentCount: KB_TYPES.length,
    },
    backend: live ? { baseUrl: live.baseUrl, harvestedFrom: live.harvestedFrom, ambiguousVersions: live.ambiguous } : null,
  },
  notes: [
    'The registry says what EXISTS (typed shape). assets/measured-capability-matrix.json says what RENDERS (R-053). A registry prop with no matrix measurement is "not-measured", never "supported".',
    'isHidden is null for every component: the renderer component definition carries it, the components-kb does not.',
    'props are device-AGNOSTIC. Appearance channels are authored inside the desktop/tablet/mobile blocks — strip that prefix before matching a prop path.',
  ],
  stats,
  formSettings,
  components,
};

fs.writeFileSync(OUT, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

console.log(`gen-registry: mode=${mode}${live ? ` backend=${live.baseUrl}` : ''}`);
console.log(`gen-registry: frameworkVersion=${registry.frameworkVersion} (${registry.frameworkVersionSource})`);
console.log(
  `gen-registry: ${stats.total} components — ${stats.authorable} authorable, ${stats.notAuthorable} not; ` +
  `${stats.withPropTypes} with propTypes (${stats.propTypeCount} typed props); ` +
  `${stats.withSlots} declare customContainerNames; ${stats.liveVersions} live version stamps harvested (${stats.versionDrift} drift vs KB)`,
);
console.log(`gen-registry: wrote ${path.relative(SKILL, OUT).replace(/\\/g, '/')}`);
