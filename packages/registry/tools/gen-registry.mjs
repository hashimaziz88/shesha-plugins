// components-kb -> the machine registry (§2.8.3). The KB is the INPUT; this program
// is the reproducible extractor that replaces the KB author's machine-local path.
//
// Three layers, merged in this order (later wins on a key):
//   1. KB base      — all 121 records at names-only: every prop NAME from the KB's
//                     resolvedProps, valueType null, valueTypeSource "unknown".
//   2. framework     — the 13 priority types get source-parsed value types + required
//                     flags for their salient props (base contract + own interface),
//                     from _framework-props.json (parsed from the pinned framework).
//   3. authored      — the ~12 records the COMPILER emits keep their measured contract
//                     fields (sfsNode, breakpointChannels, defaults, editModeChannel …)
//                     from _authored.json. These win; the compiler's bytes never move.
//
// D-113/D-114 dispose the 22 version-null records without inventing a number. No clock
// anywhere: _meta.json records content hashes, never a generatedAt, so --check can
// byte-compare.
//
//   node packages/registry/tools/gen-registry.mjs --commit <sha> [--check] [--ratchet]

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const REF = '0.45.1';
const DATA = `packages/registry/data/${REF}`;
const KB = 'packages/sfs/kb';
const PINNED_COMMIT = '3418e292f4422c1b515b78a16d67f20a4bae7db3';

/** The 13 priority types (§2.8.4). */
export const PRIORITY = [
  'datatable', 'datalist', 'dropdown', 'button', 'buttonGroup', 'datatable.pager',
  'checkbox', 'checkboxGroup', 'radio', 'timePicker', 'section',
  'formAutocomplete', 'referenceListAutocomplete',
];

/** D-113: designer-internal widgets, never authored into a form. */
const DESIGNER_INTERNAL = new Set([
  'settingsInput', 'settingsInputRow', 'labelConfigurator', 'editModeSelector',
  'searchableTabs', 'themeEditor', 'metadataEditor', 'mainMenuEditor',
  'columnsEditorComponent', 'dynamicItemsConfigurator', 'propertyRouter',
  'headerAppControl', 'datatable_template', 'dataContextSelector',
]);

/** D-086: authorable in principle, but no version migrator exists in the framework
 * source, so no honest version can be assigned without inventing one -> deferred
 * (BL-022). WP-2b confirmed against the pinned clone that none of these carry a
 * migrator; the version is genuinely absent, not merely unread. */
const VERSION_UNKNOWN = new Set([
  'buttons', 'dynamicView', 'imagePicker', 'logViewer',
  'permissionTagGroup', 'processMonitor', 'threeStateSwitch',
]);

/** D-113: components shipped under the framework's designer-components/_legacyComponents/
 * are deprecated, not authored into new forms; `legacy` is their honest disposition,
 * not the version-unknown deferral. `paragraph` is version-less AND legacy. */
const LEGACY = new Set(['paragraph']);

/** The five nested item schemas (§2.8.2). */
const ITEM_SCHEMAS = {
  datatableColumn: {
    for: ['datatable.items[]', 'childTable.items[]'],
    required: ['id', 'itemType', 'sortOrder', 'columnType'],
    note: 'propertyName required unless columnType is crud-operations; carries the displayComponent/editComponent/createComponent triplet',
  },
  buttonGroupItem: {
    for: ['buttonGroup.items[]'],
    required: ['id', 'itemType', 'itemSubType', 'sortOrder', 'name'],
    note: 'label, buttonType, icon, editMode, buttonAction, actionConfiguration',
  },
  tabsTab: { for: ['tabs.tabs[]'], required: ['id', 'key', 'title', 'components'], note: 'tabKey is invisible to the DOM probe; placement moves to T3' },
  kibColumn: { for: ['KeyInformationBar.columns[]'], required: ['id', 'width', 'components'], note: 'emitted from SFS bands[]' },
  entityPickerColumn: { for: ['entityPicker.columns[]'], required: ['id', 'propertyName', 'caption'], note: '' },
};

/** @param {string} rel @returns {unknown} */
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '')); }
/** @param {string} rel @returns {boolean} */
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
/** @param {string} s @returns {string} */
function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

/**
 * Deterministic stringify with sorted keys, so byte-identity is a function of
 * content only.
 * @param {unknown} v
 * @returns {unknown}
 */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v === null || typeof v !== 'object') return v;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (v)).sort()) out[k] = sortDeep(/** @type {Record<string, unknown>} */ (v)[k]);
  return out;
}

/**
 * The two framework-DERIVED provenances a 'full' claim rests on: `source-parsed`
 * (the registry extractor read the framework at the pinned commit) and
 * `framework-verified` (the compiler emits the prop and confirmed its type against
 * the framework). Both are ground truth from the framework; a prop typed by either,
 * with a known required flag, is fully known. `kb-only`/`unknown` are neither.
 */
const FRAMEWORK_DERIVED = new Set(['source-parsed', 'framework-verified']);

/**
 * Compute the four-state completeness ladder from a props map (§2.8.2).
 * @param {Record<string, {valueType:unknown, required:unknown, valueTypeSource:unknown}>} props
 * @returns {'none'|'names-only'|'value-typed'|'full'}
 */
function completenessOf(props) {
  const keys = Object.keys(props);
  if (keys.length === 0) return 'none';
  const allTyped = keys.every((k) => {
    const p = props[k];
    return p !== undefined && p.valueType !== null;
  });
  if (!allTyped) return 'names-only';
  const full = keys.every((k) => {
    const p = props[k];
    return p !== undefined && p.required !== null && FRAMEWORK_DERIVED.has(/** @type {string} */ (p.valueTypeSource));
  });
  return full ? 'full' : 'value-typed';
}

/**
 * Build the whole registry object.
 * @param {string} commit
 * @returns {{components:Record<string, unknown>, meta:Record<string, unknown>, ratchetMeasured:Record<string, number>}}
 */
export function build(commit) {
  const index = /** @type {Record<string, {version:number|null, name:string, isInput:boolean, file:string}>} */ (readJson(`${KB}/_index.json`));
  const authored = /** @type {{components:Record<string, any>, _datatypeMap:Record<string, unknown>}} */ (readJson(`${DATA}/_authored.json`));
  const fw = exists(`${DATA}/_framework-props.json`)
    ? /** @type {{base:Record<string, any>, types:Record<string, Record<string, any>>}} */ (readJson(`${DATA}/_framework-props.json`))
    : { base: {}, types: {} };
  const frameworkPresent = Object.keys(fw.types).length > 0;

  /** @type {Record<string, any>} */
  const components = {};

  for (const [type, meta] of Object.entries(index)) {
    const kb = /** @type {any} */ (readJson(`${KB}/${meta.file}`));
    const resolved = /** @type {string[]} */ ((kb.settingsProps && kb.settingsProps.resolvedProps) || []);

    // Layer 1: names-only from the KB resolvedProps closure, plus the shared base
    // contract's prop NAMES (every configurable component carries them), so a record
    // the KB left with zero resolvedProps is still names-only, never 'none'.
    /** @type {Record<string, any>} */
    const props = {};
    for (const name of Object.keys(fw.base)) {
      props[name] = { valueType: null, valueTypeSource: 'unknown', required: null, requiredSource: 'unknown' };
    }
    for (const name of resolved) {
      if (name.startsWith('_')) continue; // designer-internal accessors, never authored
      props[name] = { valueType: null, valueTypeSource: 'unknown', required: null, requiredSource: 'unknown' };
    }
    // The KB's settingsFields is the component's full designer field surface — its
    // legal prop names beyond the resolvedProps closure (the container flex props
    // live only here). The top segment of a dotted path (`background.color` ->
    // `background`) is the prop key on the node. Designer-internal accessors
    // (`settingsTabs`, `_`-prefixed) are never authored (D-097).
    const fieldNames = new Set();
    /** @param {any} x */
    const collectPaths = (x) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(collectPaths); return; }
      if (typeof x.path === 'string' && x.path) fieldNames.add(x.path.split('.')[0]);
      for (const v of Object.values(x)) if (v && typeof v === 'object') collectPaths(v);
    };
    collectPaths(kb.settingsFields);
    for (const name of fieldNames) {
      if (name.startsWith('_') || name === 'settingsTabs') continue;
      if (!(name in props)) props[name] = { valueType: null, valueTypeSource: 'kb-settings-field', required: null, requiredSource: 'unknown' };
    }

    const designerInternal = DESIGNER_INTERNAL.has(type);
    const versionUnknown = VERSION_UNKNOWN.has(type);
    const legacy = LEGACY.has(type);
    const priority = PRIORITY.includes(type);
    // Layer 2 applies to every type the framework extractor typed. WP-2b lifted this
    // from the 13 priority types to all ~93 components whose settings form was parsed
    // (parse-framework-props.mjs); the 13 priority entries remain the pinned anchors.
    const hasFwEntry = frameworkPresent && Object.prototype.hasOwnProperty.call(fw.types, type);

    // Layer 2: framework value types for the salient props. The salient map REPLACES
    // the closure (the §2.8.2 shape), so completeness is measured over source-parsed
    // props, not over the 136 style props. A typed component with no distinct config
    // still carries the base contract — its honest, fully source-parsed salient set.
    if (hasFwEntry) {
      /** @type {Record<string, any>} */
      const salient = {};
      for (const [name, p] of Object.entries(fw.base)) salient[name] = { ...p };
      for (const [name, p] of Object.entries(fw.types[type] || {})) salient[name] = { ...p };
      if (Object.keys(salient).length > 0) {
        for (const k of Object.keys(props)) delete props[k];
        Object.assign(props, salient);
      }
    }

    /** @type {any} */
    const record = {
      type,
      displayName: meta.name,
      version: meta.version,
      isInput: meta.isInput === true,
      authorable: true,
      props,
      slots: kbSlots(kb),
      breakpointChannels: [],
      legacyStyleProps: [],
      versionSource: 'kb',
      provenance: { confidence: hasFwEntry ? 'source-parsed' : 'kb-only' },
    };

    // D-086 / D-113: dispose the version-null records. Designer-internal widgets are
    // never authored (props wiped); legacy widgets are deprecated (kept for decompile);
    // the rest are authorable-in-principle but version-less, so deferred (BL-022).
    if (designerInternal) {
      record.authorable = false;
      record.reason = 'designer-internal';
      record.props = {};
    } else if (legacy) {
      record.authorable = false;
      record.reason = 'legacy';
      record.decision = 'D-113';
    } else if (versionUnknown) {
      record.authorable = false;
      record.reason = 'version unknown offline';
      record.decision = 'D-086';
      record.backlog = 'BL-022';
    }

    record.propsCompleteness = completenessOf(record.props);
    components[type] = record;
  }

  // Layer 3: the authored compiler overlay wins on contract fields. version must
  // agree with the KB (asserted), so the overlay never invents one.
  for (const [type, overlay] of Object.entries(authored.components)) {
    const base = components[type] || {};
    if (base.version != null && overlay.version != null && base.version !== overlay.version) {
      throw new Error(`REG-2903 authored overlay version ${overlay.version} for "${type}" disagrees with the KB version ${base.version}`);
    }
    const merged = { ...base, ...overlay };
    // The compiler's `slots` is an ARRAY (['content','header']); the KB-derived base
    // `slots` is the §2.8.2 OBJECT. Same name, different shape — a collision. The
    // authored overlay owns the compiler contract, so base's object must not leak
    // onto a compiler record: keep it only where the overlay declared its own.
    if (!Object.prototype.hasOwnProperty.call(overlay, 'slots')) delete merged.slots;
    // props MERGE, they do not replace: the overlay ADDS compiler-known prop names
    // (container's flex props, dataContext's uniqueStateId — verified against the
    // framework clone, D-097) to the KB-derived set, never wiping it. WP-2b: a null
    // (untyped) overlay prop must NOT clobber a source-parsed value the extractor
    // now supplies — the overlay only adds names or upgrades, never downgrades.
    merged.props = { ...(base.props || {}) };
    for (const [name, op] of Object.entries(overlay.props || {})) {
      const cur = merged.props[name];
      if (cur && cur.valueType != null && (op == null || op.valueType == null)) continue;
      merged.props[name] = op;
    }
    merged.propsCompleteness = completenessOf(merged.props);
    components[type] = merged;
  }

  const kbSha = sha256(fs.readFileSync(path.join(ROOT, `${KB}/_index.json`), 'utf8'));
  const authoredSha = sha256(fs.readFileSync(path.join(ROOT, `${DATA}/_authored.json`), 'utf8'));
  const fwSha = frameworkPresent ? sha256(fs.readFileSync(path.join(ROOT, `${DATA}/_framework-props.json`), 'utf8')) : null;

  const out = {
    _provenance: 'GENERATED by packages/registry/tools/gen-registry.mjs from components-kb + _authored.json + _framework-props.json. Do not hand-edit; run the generator. See _meta.json for the pinned inputs.',
    _registryRef: REF,
    _datatypeMap: authored._datatypeMap,
    _itemSchemas: ITEM_SCHEMAS,
    components,
  };

  const meta = {
    repo: 'shesha-io/shesha-framework',
    ref: 'releases/0.45',
    commit,
    kbSha256: kbSha,
    authoredSha256: authoredSha,
    frameworkSha256: fwSha,
    frameworkPresent,
    generatorVersion: '1.0.0',
    contentHash: sha256(JSON.stringify(sortDeep(out))),
  };

  const ratchetMeasured = measure(components);
  return { components: out, meta, ratchetMeasured };
}

/**
 * KB slots -> registry slots shape.
 * @param {any} kb
 * @returns {{kind:string, names:string[], childrenKey:string, hostsChildren:boolean}}
 */
function kbSlots(kb) {
  const s = kb.slots || {};
  const hosts = s.hostsChildren === true;
  const names = Array.isArray(s.customContainerNames) ? s.customContainerNames : [];
  return {
    kind: hosts ? (names.length ? 'named' : 'components') : 'none',
    names,
    childrenKey: 'components',
    hostsChildren: hosts,
  };
}

/**
 * @param {Record<string, any>} components
 * @returns {Record<string, number>}
 */
export function measure(components) {
  const all = Object.values(components);
  const authorable = all.filter((r) => r.authorable === true).length;
  const namesOnlyOrBetter = all.filter((r) => r.authorable === false
    || ['names-only', 'value-typed', 'full'].includes(r.propsCompleteness)).length;
  const valueTyped = all.filter((r) => ['value-typed', 'full'].includes(r.propsCompleteness)).length;
  const deferredAuthorable = all.filter((r) => r.authorable === false && r.reason === 'version unknown offline').length;
  const full = all.filter((r) => r.propsCompleteness === 'full').length;
  const priorityValueTyped = PRIORITY.filter((t) => components[t] && ['value-typed', 'full'].includes(components[t].propsCompleteness)).length;
  const priorityFull = PRIORITY.filter((t) => components[t] && components[t].propsCompleteness === 'full').length;
  return { records: all.length, authorable, namesOnlyOrBetter, valueTyped, full, deferredAuthorable, priorityValueTyped, priorityFull };
}

async function main() {
  const args = process.argv.slice(2);
  const commitAt = args.indexOf('--commit');
  const commit = commitAt >= 0 ? (args[commitAt + 1] ?? '') : PINNED_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    console.error('REG-2901 --commit must be a full 40-char sha; a branch name moves');
    return 2;
  }
  const check = args.includes('--check');
  const ratchet = args.includes('--ratchet');

  const { components, meta } = build(commit);
  const compText = `${JSON.stringify(components, null, 2)}\n`;
  const metaText = `${JSON.stringify(meta, null, 2)}\n`;

  if (check) {
    const cur = fs.readFileSync(path.join(ROOT, `${DATA}/components.json`), 'utf8');
    if (cur !== compText) { console.error('REG-2904 components.json is stale — run gen-registry.mjs'); return 1; }
    console.log('gen-registry --check: components.json is byte-identical');
    return 0;
  }

  fs.writeFileSync(path.join(ROOT, `${DATA}/components.json`), compText);
  fs.writeFileSync(path.join(ROOT, `${DATA}/_meta.json`), metaText);
  const m = measure(/** @type {Record<string, any>} */ (components.components));
  console.log(`gen-registry: wrote ${DATA}/components.json · records ${m.records} · namesOnlyOrBetter ${m.namesOnlyOrBetter} · priority full ${m.priorityFull}/13 · frameworkPresent ${meta.frameworkPresent}`);

  if (ratchet) {
    const cfgPath = path.join(ROOT, 'packages/registry/config/registry-ratchet.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.measured = { authorable: m.authorable, namesOnlyOrBetter: m.namesOnlyOrBetter, valueTyped: m.valueTyped, full: m.full, deferredAuthorable: m.deferredAuthorable };
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    console.log('gen-registry --ratchet: rewrote measured floors');
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
