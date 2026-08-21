// The reproducible framework-props extractor (§2.8.4, WP-2b). Replaces the ad-hoc
// hand/agent parse that produced the original 13-type _framework-props.json.
//
// SIGNAL: each component's SETTINGS FORM, never a guess from prop NAMES (the L0
// lesson, 2026-08-19). The settings form is the authorable surface; its per-prop
// editor kind maps DETERMINISTICALLY to a registry valueType via EDITOR_MAP. A prop
// whose editor kind is not in the map is OMITTED, never guessed. `required` comes
// from the prop's `validate.required`; an enum domain comes from a LITERAL
// `dropdownOptions`/`options` array (a non-literal domain downgrades to `string`,
// it is never invented). valueTypeSource/requiredSource are 'source-parsed' because
// every field is read from the framework source at the pinned commit.
//
// The 13 priority types and the shared `base` contract are PINNED hand-verified
// anchors (interface-parsed, §2.8.4): the tool reads them from the current
// _framework-props.json and preserves them byte-for-byte, generating only the
// non-priority types from source. Given the same anchors + the same pinned clone
// the output is byte-identical (no clock, keys sorted by the generator downstream).
//
//   node packages/registry/tools/parse-framework-props.mjs [--check] [--report]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const REF = '0.45.1';
const DATA = `packages/registry/data/${REF}`;
const KB = 'packages/sfs/kb';
const FW = '.build/framework/shesha-reactjs/src/designer-components';

/** The 13 priority types whose entries are preserved from the pinned anchor file. */
const PRIORITY = new Set([
  'datatable', 'datalist', 'dropdown', 'button', 'buttonGroup', 'datatable.pager',
  'checkbox', 'checkboxGroup', 'radio', 'timePicker', 'section',
  'formAutocomplete', 'referenceListAutocomplete',
]);

/**
 * Editor kind (the settings-form `type`/`inputType`, or a builder method's kind) ->
 * registry valueType. A kind absent here yields NO prop (omit-never-guess). Kinds
 * that map to a structural value carry the honest coarse type (object/array); the
 * L0-lesson semantic kinds carry their reference type.
 * @type {Record<string, string>}
 */
const EDITOR_MAP = {
  // primitives
  textField: 'string', textArea: 'string', Password: 'string',
  numberField: 'number',
  switch: 'boolean', checkbox: 'boolean',
  // L0-lesson semantic reference kinds
  colorPicker: 'colorRef',
  codeEditor: 'codeSetting',
  propertyAutocomplete: 'entityPath', contextPropertyAutocomplete: 'entityPath',
  iconPicker: 'icon',
  referenceListAutocomplete: 'refListRef',
  permissions: 'permissionRef', permissionAutocomplete: 'permissionRef',
  configurableActionConfigurator: 'actionConfig',
  formAutocomplete: 'formRef',
  dimensions: 'cssSize',
  // enum-or-string selectors (enum when the option domain is a literal, else string)
  dropdown: 'enum', radio: 'enum',
  customDropdown: 'string',
  // string-valued autocompletes/paths, and values with no finer registry valueType:
  // a date and a stored-image reference both serialise as a string (coarse, honest —
  // read from the editor kind, not the prop name).
  endpointsAutocomplete: 'string', entityTypeAutocomplete: 'string',
  autocomplete: 'string', formTypeAutocomplete: 'string', imageUploader: 'string',
  date: 'string', imagePicker: 'string',
  // structured — the editor KIND (not the prop name) manifestly holds an object or
  // a list; the coarse structural valueType is what the settings form declares.
  object: 'object', queryBuilder: 'object', button: 'object',
  RefListItemSelectorSettingsModal: 'object', layerSelectorSettingsModal: 'object',
  array: 'array', labelValueEditor: 'array', editableTagGroup: 'array',
  editableTagGroupProps: 'array', multiColorPicker: 'array',
  buttonGroupConfigurator: 'array', itemListConfiguratorModal: 'array',
  columnsConfig: 'array', columnsList: 'array', sizableColumnsConfig: 'array',
  keyInformationBarColumnsList: 'array', filtersList: 'array', dataSortingEditor: 'array',
};

/**
 * Builder-method name (`.addXxx`) -> the editor kind its call configures, for the
 * methods that ARE a single typed editor. Layout/container/tab/router builders are
 * absent here on purpose: they carry no single prop value.
 * @type {Record<string, string>}
 */
const BUILDER_MAP = {
  addTextField: 'textField', addTextArea: 'textArea', addString: 'textField',
  addCheckbox: 'checkbox',
  addCodeEditor: 'codeEditor',
  addContextPropertyAutocomplete: 'contextPropertyAutocomplete',
  addPropertyAutocomplete: 'propertyAutocomplete',
  addConfigurableActionConfigurator: 'configurableActionConfigurator',
  addPermissionAutocomplete: 'permissionAutocomplete',
  addDropdown: 'dropdown',
  addEditableTagGroup: 'editableTagGroup',
  addEntityTypeAutocomplete: 'entityTypeAutocomplete',
  addObject: 'object', addArray: 'array',
};

/**
 * Editor kinds that are settings-UI STRUCTURE, not a component prop: a panel, a
 * separator, a router, a container, a style box, a tab strip. They carry no value,
 * so their presence never blocks a 'full' claim and never yields a prop.
 */
const LAYOUT_KINDS = new Set([
  'collapsiblePanel', 'sectionSeparator', 'propertyRouter', 'container',
  'styleBox', 'searchableTabs',
]);

/** @param {string} rel */
function abs(rel) { return path.join(ROOT, rel); }
/** @param {string} rel */
function readJson(rel) { return JSON.parse(fs.readFileSync(abs(rel), 'utf8').replace(/^﻿/, '')); }

/**
 * Resolve the on-disk settings-form path for a KB source string, tolerating the
 * handful of KB entries whose recorded path predates a folder/extension rename.
 * @param {string} source @returns {string|null}
 */
function resolveSourcePath(source) {
  // A KB pointer at index.ts(x) is the component, not its settings form; prefer a
  // sibling settingsForm.ts/.json when one exists (D-097 data-quality fallback).
  if (/\/index\.tsx?$/.test(source)) {
    const dir = path.dirname(source);
    for (const sib of ['settingsForm.ts', 'settingsForm.json', 'settings.ts']) {
      const p = path.join(abs(FW), dir, sib);
      if (fs.existsSync(p)) return p;
    }
  }
  const direct = path.join(abs(FW), source);
  if (fs.existsSync(direct)) return direct;
  // Known renames: chart(s), phoneNumber(Input), settings(.ts|.tsx) vs settingsForm.
  const cands = [
    source.replace(/^charts\//, 'chart/'),
    source.replace(/^chart\//, 'charts/'),
    source.replace(/^charts?\/settings\.ts$/, 'charts/settingsFormIndividual.ts'),
    source.replace(/^phoneNumber\//, 'phoneNumberInput/'),
    source.replace(/settings\.tsx?$/, 'settingsForm.json'),
    source.replace(/settingsForm\.json$/, 'settings.ts'),
  ];
  for (const c of cands) { const p = path.join(abs(FW), c); if (fs.existsSync(p)) return p; }
  return null;
}

/**
 * Extract editor prop records from an already-parsed object graph (json-markup) or
 * a TS object-literal snapshot. Each input node is a plain object that MAY carry
 * propertyName + type/inputType + validate + dropdownOptions/options.
 * @param {any} node
 * @param {(rec:{propertyName:string,kind:string,required:boolean,enumVals:string[]|null})=>void} emit
 */
function harvestPlain(node, emit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) harvestPlain(x, emit); return; }
  const pn = node.propertyName;
  const kind = typeof node.type === 'string' ? node.type
    : (typeof node.inputType === 'string' ? node.inputType : null);
  if (typeof pn === 'string' && kind) {
    const required = !!(node.validate && node.validate.required === true);
    let enumVals = null;
    // Only a fluent-builder `dropdownOptions` (or options/items) literal is a reliable
    // enum domain. json-markup's `values` key is NOT read as a domain: its editor list
    // can disagree in representation with the value forms actually carry (e.g.
    // dataContext.defaultPageSize lists "10" but forms emit the number 10), which would
    // make T2.09 reject clean output — so such props stay the honest coarse `string`.
    const opts = node.dropdownOptions || node.options || node.items;
    if (Array.isArray(opts)) {
      const vals = opts.map((o) => (o && typeof o === 'object' ? o.value : undefined))
        .filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
      if (vals.length && vals.length === opts.length) enumVals = vals;
    }
    emit({ propertyName: pn, kind, required, enumVals });
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') harvestPlain(v, emit);
}

/**
 * Convert a TS object-literal node into a plain snapshot of the fields we need, then
 * harvest it. Also handles `.addXxx({...})` builder calls whose method implies a kind.
 * @param {ts.SourceFile} sf
 * @param {(rec:{propertyName:string,kind:string,required:boolean,enumVals:string[]|null})=>void} emit
 */
function harvestTs(sf, emit) {
  /** @param {ts.Node} n @returns {any} */
  const literal = (n) => {
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isNumericLiteral(n)) return Number(n.text);
    if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isObjectLiteralExpression(n)) {
      /** @type {any} */ const o = {};
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
          o[p.name.text] = literal(p.initializer);
        }
      }
      return o;
    }
    if (ts.isArrayLiteralExpression(n)) return n.elements.map(literal);
    return undefined; // non-literal (identifier, call, spread) -> unknown
  };

  /** @param {ts.Node} n */
  const walk = (n) => {
    // Builder call: .addXxx({ propertyName, validate?, dropdownOptions? })
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const mappedKind = BUILDER_MAP[method];
      const arg0 = n.arguments[0];
      if (mappedKind && arg0 && ts.isObjectLiteralExpression(arg0)) {
        const o = literal(arg0);
        if (o && typeof o.propertyName === 'string' && !o.type && !o.inputType) {
          o.type = mappedKind;
          harvestPlain(o, emit);
        }
      }
    }
    // Any object literal carrying propertyName + type/inputType (rows, inputs, markup)
    if (ts.isObjectLiteralExpression(n)) {
      const o = literal(n);
      if (o && typeof o.propertyName === 'string' && (o.type || o.inputType)) harvestPlain(o, emit);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

/**
 * Parse one component's settings form. Returns the mapped own-props (base-covered,
 * dotted, and designer-internal names removed), plus the two signals build() needs
 * to decide a 'full' claim: how many BASE-contract props the form carries (evidence
 * the component extends IConfigurableFormComponent), and whether any REAL (non-base,
 * non-layout) editor was dropped for want of a mapping (which would make a 'full'
 * claim dishonest — a prop silently missing).
 * @param {string} type @param {any} kb @param {Set<string>} baseNames
 * @returns {{props:Record<string, any>, baseHits:number, unmappedReal:Set<string>, mechanism:string, ok:boolean}}
 */
function parseComponent(type, kb, baseNames) {
  const sf = kb.settingsForm || {};
  /** @type {{props:Record<string, any>, baseHits:number, unmappedReal:Set<string>, mechanism:string, ok:boolean}} */
  const out = { props: {}, baseHits: 0, unmappedReal: new Set(), mechanism: sf.mechanism || 'none', ok: false };
  if (!sf.source) return out;
  const p = resolveSourcePath(sf.source);
  if (!p) return out;
  const src = fs.readFileSync(p, 'utf8');

  /** @type {{propertyName:string,kind:string,required:boolean,enumVals:string[]|null}[]} */
  const recs = [];
  /** @param {{propertyName:string,kind:string,required:boolean,enumVals:string[]|null}} r */
  const emit = (r) => { recs.push(r); };
  if (/\.(json)$/.test(p)) {
    try { harvestPlain(JSON.parse(src), emit); } catch { return out; }
  } else {
    const srcFile = ts.createSourceFile(p, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    harvestTs(srcFile, emit);
  }
  out.ok = true;

  for (const r of recs) {
    const name = r.propertyName;
    if (!name || name.startsWith('_') || name === 'settingsTabs') continue;
    if (name.includes('.')) continue;            // dotted style path -> base object
    if (baseNames.has(name)) { out.baseHits += 1; continue; } // base contract owns it
    let valueType = EDITOR_MAP[r.kind];
    if (valueType === undefined) {
      if (!LAYOUT_KINDS.has(r.kind)) out.unmappedReal.add(r.kind); // a real prop we could not type
      continue;                                   // omit-never-guess
    }
    let enumField = null;
    if (valueType === 'enum') {
      if (r.enumVals && r.enumVals.length) enumField = r.enumVals;
      else valueType = 'string';                 // dropdown w/o literal domain -> string
    }
    if (name in out.props) continue;             // first confident mapping wins
    /** @type {any} */
    const rec = { valueType, required: r.required, valueTypeSource: 'source-parsed', requiredSource: 'source-parsed' };
    if (enumField) rec.enum = enumField;
    out.props[name] = rec;
  }
  return out;
}

/** @returns {{fileText:string, report:any}} */
export function build() {
  const index = /** @type {Record<string, any>} */ (readJson(`${KB}/_index.json`));
  const current = /** @type {{_provenance?:string, commit?:string, base:Record<string, any>, types:Record<string, any>}} */ (
    readJson(`${DATA}/_framework-props.json`));
  const baseNames = new Set(Object.keys(current.base));

  /** @type {Record<string, any>} */
  const types = {};
  /** @type {{generatedOwn:string[], baseOnly:string[], preserved:string[], skipped:string[], unmappedReal:Record<string, number>, mechanisms:Record<string, number>}} */
  const report = { generatedOwn: [], baseOnly: [], preserved: [], skipped: [], unmappedReal: {}, mechanisms: {} };

  for (const [type, meta] of Object.entries(index)) {
    if (PRIORITY.has(type)) { types[type] = current.types[type]; report.preserved.push(type); continue; }
    const kb = readJson(`${KB}/${meta.file}`);
    const r = parseComponent(type, kb, baseNames);
    report.mechanisms[r.mechanism] = (report.mechanisms[r.mechanism] || 0) + 1;
    for (const u of r.unmappedReal) report.unmappedReal[u] = (report.unmappedReal[u] || 0) + 1;
    const n = Object.keys(r.props).length;
    // A 'full' claim is honest only when the form carries the base contract AND no
    // real (non-layout) editor was dropped. Own-props may then be empty: the whole
    // authorable surface IS the base contract, source-parsed end to end.
    const eligible = r.ok && r.baseHits >= 1 && r.unmappedReal.size === 0;
    if (eligible) {
      types[type] = sortKeys(r.props);
      if (n > 0) report.generatedOwn.push(`${type}:${n}`); else report.baseOnly.push(type);
    } else if (r.ok) {
      report.skipped.push(`${type}(base:${r.baseHits} dropped:${[...r.unmappedReal].join('|') || '-'})`);
    }
  }

  const out = {
    _provenance: current._provenance,
    commit: current.commit,
    base: current.base,
    types: sortKeys(types),
  };
  return { fileText: `${JSON.stringify(out, null, 2)}\n`, report };
}

/** @param {Record<string, any>} o */
function sortKeys(o) {
  /** @type {Record<string, any>} */ const s = {};
  for (const k of Object.keys(o).sort()) s[k] = o[k];
  return s;
}

async function main() {
  const args = process.argv.slice(2);

  const dbgAt = args.indexOf('--debug');
  if (dbgAt >= 0) {
    const type = args[dbgAt + 1];
    const index = /** @type {Record<string, any>} */ (readJson(`${KB}/_index.json`));
    if (!type || !index[type]) { console.error(`--debug: unknown type "${type}"`); return 2; }
    const kb = readJson(`${KB}/${index[type].file}`);
    const sf = kb.settingsForm || {};
    const p = sf.source ? resolveSourcePath(sf.source) : null;
    console.log(`${type}: mechanism=${sf.mechanism} source=${sf.source} resolved=${p ? 'yes' : 'NO'}`);
    if (!p) return 0;
    const src = fs.readFileSync(p, 'utf8');
    /** @type {any[]} */ const recs = [];
    /** @param {any} r */
    const emit = (r) => { recs.push(r); };
    if (/\.json$/.test(p)) { try { harvestPlain(JSON.parse(src), emit); } catch (e) { console.log('json parse fail', (/** @type {Error} */ (e)).message); } }
    else harvestTs(ts.createSourceFile(p, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), emit);
    for (const r of recs) console.log(`  ${r.propertyName}  kind=${r.kind}  req=${r.required}  enum=${r.enumVals ? r.enumVals.join('|') : '-'}`);
    return 0;
  }

  const { fileText, report } = build();
  const target = abs(`${DATA}/_framework-props.json`);

  if (args.includes('--report')) {
    const full = report.preserved.length + report.generatedOwn.length + report.baseOnly.length;
    console.log(`parse-framework-props: preserved ${report.preserved.length} priority, ${report.generatedOwn.length} with own-props, ${report.baseOnly.length} base-only, ${report.skipped.length} skipped`);
    console.log(`  mechanisms: ${JSON.stringify(report.mechanisms)}`);
    console.log(`  candidate full types (priority + generatedOwn + baseOnly): ${full}`);
    console.log(`  base-only (full via base contract, no distinct config): ${report.baseOnly.join(', ')}`);
    console.log(`  skipped (not full — dropped a real editor or no base contract): ${report.skipped.join(', ')}`);
    console.log(`  unmapped REAL editor kinds encountered: ${JSON.stringify(report.unmappedReal)}`);
    return 0;
  }
  if (args.includes('--check')) {
    const cur = fs.readFileSync(target, 'utf8');
    if (cur !== fileText) { console.error('parse-framework-props: _framework-props.json is stale — re-run the tool'); return 1; }
    console.log('parse-framework-props --check: byte-identical'); return 0;
  }
  fs.writeFileSync(target, fileText);
  console.log(`parse-framework-props: wrote ${DATA}/_framework-props.json · ${Object.keys(JSON.parse(fileText).types).length} typed components`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
