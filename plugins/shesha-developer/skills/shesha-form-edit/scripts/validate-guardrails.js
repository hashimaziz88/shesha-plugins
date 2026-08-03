#!/usr/bin/env node
/**
 * validate-guardrails.js <form.json> [entity-metadata.json]
 *                        [--baseline <fetched.json>] [--live-versions <map.json>]
 *                        [--legacy-corpus]
 *
 * Mechanical guardrails for render-killers. Every check is a rule in
 * references/_rules.json — findings cite [R-xxx]; this file owns only the
 * walkers, never the facts.
 *
 * Optional arg 2: a cached Metadata/GetProperties dump — upgrades the
 * reflist-identity check (R-015) from WARN (unverified) to FAIL on mismatch, and
 * the FK-reducer check (R-037) from WARN to FAIL (FK-ness is READ, never guessed).
 *
 * --baseline <fetched.json>   the pre-edit markup: every id in it must survive [R-025].
 * --live-versions <map.json>  {componentType: version} harvested from the target
 *                             backend (`backend-probe.mjs --versions`) — drift against
 *                             it FAILs [R-049]; without it the KB comparison WARNs.
 * --legacy-corpus             downgrades the two measured-channel rules (R-052/R-053)
 *                             to WARN. Exists ONLY for the assets/golden regression
 *                             corpus, which predates the capability matrix and carries
 *                             known dead-styling debt (see tests/pipeline.test.mjs).
 *                             Never pass it for a form being built.
 *
 * Exit code 1 when any `fail` finding exists. No dependencies.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// flags first, so the two positional args keep their historical meaning
const argv = process.argv.slice(2);
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const baselineFile = flagVal('--baseline');
const liveVersionsFile = flagVal('--live-versions');
const LEGACY_CORPUS = argv.includes('--legacy-corpus');
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--legacy-corpus'));

const file = positional[0];
if (!file) { console.error('usage: node validate-guardrails.js <form.json> [entity-metadata.json] [--baseline <f>] [--live-versions <f>] [--legacy-corpus]'); process.exit(2); }

// ---- rule registry ----------------------------------------------------------
const registry = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'references', '_rules.json'), 'utf8'));
const RULES = new Map(registry.rules.map((r) => [r.id, r]));
const rule = (id) => RULES.get(id) || { severity: 'warn', statement: `(unknown rule ${id})` };

// component versions (authoritative for this generation)
let kbVersions = null;
try {
  const idx = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'components-kb', '_index.json'), 'utf8'));
  kbVersions = {};
  for (const [t, e] of Object.entries(idx)) if (!t.startsWith('_')) kbVersions[t] = e.version;
} catch { kbVersions = null; }

// live component versions harvested off the target backend (R-049). Present = the
// KB is no longer the arbiter for this run: drift against the LIVE map is a FAIL.
let liveVersions = null;
if (liveVersionsFile) {
  try {
    const m = JSON.parse(fs.readFileSync(liveVersionsFile, 'utf8').replace(/^﻿/, ''));
    liveVersions = m && typeof m.versions === 'object' ? m.versions : m;
  } catch { liveVersions = null; }
}

// ---- measured capability matrix (lazy; absence = skip, never a false pass) ----
// The matrix is the gym's record of what each authored channel actually DID in a
// browser. Its keys are "<settingPath>=<variantLabel>" — normalised here exactly
// the way gym-lib/channel-map.js does it (key.split('=')[0]).
const MATRIX_PATH = path.join(SCRIPT_DIR, '..', 'assets', 'measured-capability-matrix.json');
let matrixState; // undefined = not loaded yet, null = unavailable
function noopChannels(type) {
  if (matrixState === undefined) {
    try { matrixState = { doc: JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8').replace(/^﻿/, '')), cache: new Map() }; }
    catch { matrixState = null; }
  }
  if (!matrixState) return null;
  if (matrixState.cache.has(type)) return matrixState.cache.get(type);
  const entry = matrixState.doc.components?.[type];
  let set = null;
  if (entry?.settings) {
    const byPath = new Map();
    for (const [key, val] of Object.entries(entry.settings)) {
      const p = key.split('=')[0];
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(val);
    }
    set = new Set();
    for (const [p, variants] of byPath) {
      // Scope: breakpoint-block channels only. Flat/root duplicates (root
      // display/gap/stylingBox) are inert BY DESIGN — the compiler keeps them for
      // migration compatibility and R-029/R-030 already own that fact, so flagging
      // them here would just double-report every container.
      if (!/^(desktop|tablet|mobile)\./.test(p)) continue;
      // "measured" = an actual observation. Compound-only channels (background.type,
      // background.url, …) are recorded as `not-measured` because the gym measures
      // them through the whole-object variant — so a channel that only works as part
      // of a compound can never reach this set. That is the exemption in (b),
      // guaranteed by the matrix's own vocabulary rather than by a hand-kept list.
      const real = variants.filter((v) => v.effect !== 'not-measured' && v.effect !== 'unknown');
      if (!real.length) continue;
      if (!real.every((v) => v.effect === 'no-op')) continue;   // any working variant ⇒ the channel is live
      if (!real.every((v) => v.bucket === 'appearance')) continue; // behaviour/display flags are not styling intent
      set.add(p);
    }
  }
  matrixState.cache.set(type, set);
  return set;
}
// Channels a dedicated rule already owns — reported there, not twice.
const CHANNEL_OWNED_ELSEWHERE = new Set(['text|desktop.font.color', 'text|tablet.font.color', 'text|mobile.font.color']);

let root = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (typeof root.markup === 'string') root = JSON.parse(root.markup);
if (root.result && (root.result.markup || root.result.components)) {
  root = typeof root.result.markup === 'string' ? JSON.parse(root.result.markup) : root.result;
}

// Optional entity metadata (arg 2)
let metaByProp = null;
const metaFile = positional[1];
if (metaFile) {
  try {
    let m = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, ''));
    let props = Array.isArray(m) ? m
      : (m.result && Array.isArray(m.result) ? m.result
      : (m.result && Array.isArray(m.result.properties) ? m.result.properties
      : (Array.isArray(m.properties) ? m.properties : [])));
    metaByProp = {};
    for (const p of props) if (p && p.path) metaByProp[String(p.path).toLowerCase()] = p;
  } catch { metaByProp = null; }
}
const lastSeg = (dotted) => { const s = String(dotted || ''); const i = s.lastIndexOf('.'); return i >= 0 ? s.slice(i + 1) : s; };

const findings = [];
/** add a finding; issue defaults to the rule statement; severity from the registry unless overridden */
const add = (ruleId, target, issue, severityOverride) => {
  const r = rule(ruleId);
  findings.push({ severity: severityOverride || r.severity, ruleId, target, issue: issue || r.statement });
};

const FORM_ACTIONS = new Set(['Submit', 'Navigate', 'Cancel Edit', 'Start Edit', 'Show Dialog', 'Close Dialog', 'Back']);
// UUID or nanoid (the 0.45 designer emits nanoids) — short placeholder ids are the killer
const VALID_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{10,})$/;

let hasSubmit = false;
let hasPrimary = false;
let hasRequired = false;
let hasValidationErrors = false;
const allIds = new Set();          // every component id in this markup (R-025)
const boundInputs = [];            // {prop, type, label} for every bound input (R-037)
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const valueAt = (node, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), node);
const present = (v) => v !== undefined && v !== null && v !== ''
  && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

const actionName = (node) => (node && node.actionConfiguration && node.actionConfiguration.actionName) || null;

function hasNavigateDestination(args, node) {
  if (!args) args = {};
  const t = args.target || args.targetUrl || args.url || (node && (node.targetUrl || node.target));
  if (t && String(t).trim() !== '') return true;
  const f = args.formId;
  if (f && (typeof f === 'string' ? f.trim() !== '' : f.name)) return true;
  return false;
}

function navigateTargetMissing(node) {
  const ac = node.actionConfiguration;
  if (ac && ac.actionName === 'Navigate') return !hasNavigateDestination(ac.actionArguments, node);
  if (node.buttonAction === 'navigate' || node.action === 'navigate') {
    return !hasNavigateDestination(ac && ac.actionArguments, node);
  }
  return false;
}

const label = (node) => node.componentName || node.propertyName || node.name || node.label || node.id || '(unnamed)';

const INPUT_TYPES = new Set(['textField', 'textArea', 'numberField', 'dateField', 'timeField', 'timePicker', 'dropdown',
  'autocomplete', 'checkbox', 'checkboxGroup', 'radio', 'switch', 'entityPicker', 'fileUpload', 'rate', 'slider']);
const REFLIST_TYPES = new Set(['dropdown', 'radio', 'checkboxGroup', 'refListStatus']);

function checkReflistIdentity(node) {
  const t = node.type;
  const boundToReflist = node.dataSourceType === 'referenceList' || !!node.referenceListId || t === 'refListStatus';
  if (!REFLIST_TYPES.has(t) || !boundToReflist) return;
  let authMod, authName;
  if (node.referenceListId && typeof node.referenceListId === 'object') {
    authMod = node.referenceListId.module; authName = node.referenceListId.name;
  } else if (t === 'refListStatus') {
    authMod = node.module || (node.referenceList && node.referenceList.module);
    authName = node.referenceListName ? lastSeg(node.referenceListName) : (node.referenceList && node.referenceList.name);
  }
  if (!metaByProp) {
    add('R-015', label(node), 'reference-list binding NOT verified against metadata — re-run with the entity metadata dump as arg 2 (identity is read from metadata, never guessed)', 'warn');
    return;
  }
  const p = node.propertyName && metaByProp[String(node.propertyName).toLowerCase()];
  if (!p) { add('R-015', label(node), `property "${node.propertyName}" not found in metadata — cannot verify reflist identity`, 'warn'); return; }
  if (!p.referenceListName) { add('R-015', label(node), `property "${node.propertyName}" has no referenceListName in metadata — is this really a reference-list property?`, 'warn'); return; }
  const expMod = p.referenceListModule || null;
  const expName = lastSeg(p.referenceListName);
  if ((authName && expName && authName !== expName) || (authMod && expMod && authMod !== expMod)) {
    add('R-015', label(node),
      `authored referenceList {module:${authMod}, name:${authName}} does not match metadata (${expMod}.${expName}) — the dropdown will render EMPTY. Copy from metadata verbatim.`);
  }
}

// ---- measured-channel checks (R-052 / R-053 / R-054 / R-055) ----------------
const TEXTY = new Set(['text', 'paragraph', 'title']);

function checkStyleChannels(node) {
  const t = node.type;

  // R-052 — a text colour without contentType:"custom" is a pure no-op; antd's
  // own contentType preset wins. Cheapest possible check, so it runs first.
  if (TEXTY.has(t)) {
    const coloured = BREAKPOINTS.find((bp) => present(valueAt(node, `${bp}.font.color`)));
    if (coloured && node.contentType !== 'custom') {
      add('R-052', label(node),
        `${coloured}.font.color authored but contentType is ${JSON.stringify(node.contentType ?? null)} — the colour is a measured NO-OP; set contentType:"custom" (font.size/weight apply regardless)`,
        LEGACY_CORPUS ? 'warn' : undefined);
    }
  }

  // R-054 — background.type:"image" + a plain url resolves to url(null).
  for (const bp of BREAKPOINTS) {
    const bg = node[bp] && node[bp].background;
    if (!bg || typeof bg !== 'object' || bg.type !== 'image') continue;
    const stored = (bg.storedFile && (bg.storedFile.id || bg.storedFile)) || bg.uploadFile;
    if (present(bg.url) && !present(stored)) {
      add('R-054', label(node), `${bp}.background.type:"image" carries only a url — the renderer resolves background images from stored-file paths, so this renders url(null); use an image component sized via desktop.dimensions`);
    }
  }

  // R-055 — an image taken out of flow collapses to 0×0 inside its unsized ant-image wrapper.
  if (t === 'image') {
    const abs = BREAKPOINTS.filter((bp) => {
      const p = node[bp] && node[bp].position;
      const v = p && typeof p === 'object' ? p.value : p;
      return v === 'absolute' || v === 'fixed';
    });
    if (abs.length) add('R-055', label(node), `${abs.join('/')}.position is out-of-flow — the antd ant-image wrapper is unsized, so the img collapses to 0×0; size via desktop.dimensions and keep it in flow`);
    if (typeof node.style === 'string' && /position\s*:\s*['"]?(absolute|fixed)/.test(node.style)) {
      add('R-055', label(node), 'the legacy `style` string takes this image out of flow (position absolute/fixed) — it collapses to 0×0 inside the unsized ant-image wrapper');
    }
  }

  // R-053 — matrix-as-gate: an authored breakpoint appearance channel the gym
  // measured as a no-op is dead styling. Last (it needs the matrix in memory).
  const dead = noopChannels(t);
  if (dead && dead.size) {
    for (const p of dead) {
      if (CHANNEL_OWNED_ELSEWHERE.has(`${t}|${p}`)) continue;
      if (!present(valueAt(node, p))) continue;
      add('R-053', label(node), `${t}.${p} is measured "no-op" in assets/measured-capability-matrix.json — the value never reaches the DOM; drop it or reach the effect through a channel that works`,
        LEGACY_CORPUS ? 'warn' : undefined);
    }
  }
}

// ---- R-057 — adjacent action buttons render inline ---------------------------
// Two failure shapes, one rule:
//   (i)  a buttonGroup with 2+ button items and no isInline:true — the renderer
//        collapses the whole group into an overflow "…" menu (measured by
//        render-instrument's collapsedActions probe).
//   (ii) 2+ button/buttonGroup components sharing a container that is not a real
//        flex ROW — they stack one per line. buttonGroup has no alignment lever of
//        its own (its dimensions/stylingBox are measured no-ops), so the container
//        is where both the row and the capture-footer right-alignment live.
const BUTTON_COMPONENTS = new Set(['button', 'buttonGroup', 'buttons']);

function checkInlineActions(node) {
  if (node.type === 'buttonGroup') {
    const buttons = (node.items || []).filter((it) => it && typeof it === 'object' && it.itemType !== 'group');
    if (buttons.length >= 2 && node.isInline !== true) {
      add('R-057', label(node),
        `buttonGroup has ${buttons.length} buttons but isInline is ${JSON.stringify(node.isInline ?? null)} — the group collapses to an overflow "…" menu instead of an inline row`);
    }
  }
  const kids = (node.components || []).filter((c) => c && typeof c === 'object' && c.type);
  const buttonKids = kids.filter((c) => BUTTON_COMPONENTS.has(c.type));
  if (buttonKids.length >= 2) {
    const dk = node.desktop || {};
    const flexed = dk.display === 'flex' || dk.display === 'inline-flex';
    const row = flexed && (dk.flexDirection === undefined || dk.flexDirection === 'row' || dk.flexDirection === 'row-reverse');
    if (!row) {
      add('R-057', label(node),
        `${buttonKids.length} action button component(s) share this container but desktop is display:${JSON.stringify(dk.display ?? null)} / flexDirection:${JSON.stringify(dk.flexDirection ?? null)} — they stack one per line; make it a flex ROW (and justifyContent:"flex-end" for a capture footer)`);
    }
  }
}

// ---- R-028 — split mechanics ------------------------------------------------
function checkSplitMechanics(node, isRootLevel) {
  if (node.type === 'columns') {
    if (isRootLevel) add('R-028', label(node), 'root-level `columns` component — page-level splits are flex-container children sized via desktop.dimensions.width');
    else add('R-028', label(node), 'nested `columns` component — legacy split; prefer a flex container whose children carry desktop.dimensions.width (+ minWidth:"0px")', 'warn');
  }
  if (node.customStyle && /flex/i.test(typeof node.customStyle === 'string' ? node.customStyle : JSON.stringify(node.customStyle))) {
    add('R-028', label(node), 'customStyle carries flex — customStyle is ignored by the 0.45 renderer; size split children with desktop.dimensions.width');
  }
  for (const bp of BREAKPOINTS) {
    if (node[bp] && present(node[bp].flexShrink)) {
      add('R-028', label(node), `${bp}.flexShrink never reaches the container's outer div — size the split child with ${bp}.dimensions.width + minWidth:"0px"`);
    }
  }
}

// ---- R-012 / R-013 / R-014 — string props ----------------------------------
// Props whose string value is JavaScript (checked for parseability, exempt from
// the mustache check — an object literal is not a broken mustache).
const SCRIPT_PROPS = new Set(['style', '_code', 'expression', 'actionScript',
  'onChangeCustom', 'onFocusCustom', 'onBlurCustom', 'onClickCustom', 'onSelectCustom',
  'onBeforeDataLoad', 'onAfterDataLoad', 'onDataLoaded', 'onValuesChanged', 'onInitialized',
  'onPrepareSubmitData', 'onBeforeSubmit', 'onSubmitSuccess', 'onSubmitFailed',
  'onNewRowInitialize', 'onRowSave', 'onNewListItemInitialize', 'onListItemSave',
  'canEditInlineExpression', 'canAddInlineExpression', 'canDeleteInlineExpression',
  'formIdExpression', 'incomeCustomJs', 'labelCustomJs', 'customVisibility', 'customEnabled']);
// Props that legitimately hold a serialised JSON/CSS blob — never mustache, never JS.
const OPAQUE_PROPS = new Set(['stylingBox', 'container.stylingBox']);
// Props that carry a code-mode setting; a raw code-looking string in them is dropped on save.
const CODE_MODE_PROPS = new Set(['hidden', 'disabled', 'readOnly', 'customEnabled', 'editMode', 'required']);
const CODE_SHAPED = /(^|\W)return\W|=>|\bdata\??\.|\bformData\??\./;
const SMART_QUOTES = /[‘’“”]/;
// `{expr}` where expr is a plain accessor path — a mustache typo, not code or CSS.
const SINGLE_BRACE = /(^|[^{])\{\s*[A-Za-z_$][\w$]*(?:\??\.[\w$]+|\[[^\]]*\])*\s*\}([^}]|$)/;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Compile-only syntax probe. new AsyncFunction never RUNS the body. */
function scriptSyntaxError(code) {
  try { new AsyncFunction(code); return null; } catch (e) { return String(e.message).slice(0, 160); }
}

/** Deep scan of every string in the document, labelled by its nearest component. */
function scanStrings(value, owner, key) {
  if (Array.isArray(value)) { for (const v of value) scanStrings(v, owner, key); return; }
  if (value && typeof value === 'object') {
    const nextOwner = (typeof value.type === 'string' && value.id) ? value : owner;
    for (const [k, v] of Object.entries(value)) {
      if (CODE_MODE_PROPS.has(k) && typeof v === 'string' && CODE_SHAPED.test(v)) {
        add('R-012', `${nextOwner ? label(nextOwner) : '(form)'}.${k}`, `"${k}" holds a raw code string — code-mode props must be { "_mode": "code", "_code": "…" } or the script is silently stripped on save`);
      }
      scanStrings(v, nextOwner, k);
    }
    return;
  }
  if (typeof value !== 'string' || !value.trim()) return;
  const target = `${owner ? label(owner) : '(form)'}.${key}`;
  if (SCRIPT_PROPS.has(key)) {
    if (SMART_QUOTES.test(value)) add('R-013', target, 'embedded script contains a smart quote (’ “ ”) — it is not valid JS and breaks at parse time');
    const err = scriptSyntaxError(value);
    if (err) add('R-013', target, `embedded script does not parse: ${err}`);
    else if (value.includes('`')) add('R-013', target, 'embedded script uses a template literal — it parses, but backticks + ${} are the usual source of broken script strings; prefer concatenation', 'warn');
    if (/\bglobalState\b/.test(value)) add('R-023', target, 'script touches globalState — use contexts.appContext (app-wide) or pageContext (inter-page)');
    if (/\.then\s*\(/.test(value)) add('R-024', target, 'script chains .then() — API calls use try/catch + async/await');
    else if (/\bhttp\.(get|post|put|delete|patch)\s*\(/.test(value) && !/\btry\b/.test(value)) {
      add('R-024', target, 'script calls http.* with no try/catch — a rejected request kills the handler silently');
    }
    return;
  }
  if (OPAQUE_PROPS.has(key) || key.startsWith('_')) return;
  if (/^\s*[[{]/.test(value)) return;           // serialised JSON blob
  if (SINGLE_BRACE.test(value)) {
    add('R-014', target, `"${value.slice(0, 80)}" uses single-brace {expr} — mustache needs {{double braces}}; a single brace is silently ignored and renders empty`);
  }
}

function walkItems(items, groupCtx) {
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    if (actionName(it) === 'Submit') { hasSubmit = true; if (groupCtx) groupCtx.hasSubmit = true; }
    if (it.buttonType === 'primary') { hasPrimary = true; if (groupCtx) groupCtx.primaries++; }
    if (navigateTargetMissing(it)) add('R-008', label(it));
    if (actionName(it) === 'Delete row' && it.actionConfiguration?.actionOwner === 'table') add('R-044', label(it));
    if ((it.columnType === 'data' || (it.propertyName && it.itemType === 'item' && it.columnType))
        && it.propertyName && /^[A-Z]/.test(it.propertyName)) {
      add('R-004', it.propertyName, 'Datatable column propertyName starts uppercase — cells render blank (GQL keys are camelCase)');
    }
    if (it.columnType === 'data' && it.propertyName && /[a-z]Id$/.test(it.propertyName)) {
      add('R-034', it.propertyName, 'Column bound to the raw FK `…Id` scalar — renders GUIDs; bind the object property (e.g. `person` not `personId`)', 'warn');
    }
    // inline editor shape (R-010)
    for (const slot of ['editComponent', 'createComponent']) {
      const ec = it[slot];
      if (ec && typeof ec === 'object' && ec.type && ec.type !== '[not-editable]') {
        if (ec.type === '[default]') add('R-010', `${label(it)}.${slot}`, '`[default]` is only valid on displayComponent — edit/create cells throw `reading \'migrator\'`');
        else if (!ec.settings || typeof ec.settings !== 'object') add('R-010', `${label(it)}.${slot}`, `inline editor "${ec.type}" missing the settings wrapper (flat models throw \`reading 'version'\`)`);
      }
    }
    if (it.childItems) walkItems(it.childItems, groupCtx);
    if (it.components) walkTree(it.components, null);
  }
}

function walkTree(nodes, parent) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (!node.type) { walkTree(node.components, parent); continue; } // slot objects (columns cells)
    const t = node.type;

    // structural identity (R-001/R-002/R-003)
    if (!node.id || !VALID_ID_RE.test(String(node.id))) add('R-002', label(node), `id "${node.id}" is not a generated unique id (uuid/nanoid) — the renderer silently ignores this component`);
    if (parent && !node.parentId) add('R-001', label(node), 'missing parentId — set to the direct parent\'s id');
    else if (parent && node.parentId && node.parentId !== parent.id) add('R-001', label(node), `parentId "${node.parentId}" ≠ actual parent id "${parent.id}"`, 'warn');
    if (node.id) allIds.add(String(node.id));
    if (node.version === undefined || node.version === null || !Number.isInteger(node.version)) {
      add('R-003', label(node), `component "${t}" has no integer version — legacy render path (read-only spans) or migration throw`);
    } else if (liveVersions && liveVersions[t] != null) {
      // a live probe of the target backend outranks the KB — drift is a hard fail [R-049]
      if (node.version !== liveVersions[t]) {
        add('R-049', label(node), `version ${node.version} ≠ LIVE backend version ${liveVersions[t]} for "${t}" — versions drift across point releases; stamp what the target backend renders`, 'fail');
      }
    } else if (kbVersions && kbVersions[t] != null && node.version !== kbVersions[t]) {
      add('R-003', label(node), `version ${node.version} ≠ KB version ${kbVersions[t]} for "${t}" — stale versions silently drop the desktop style block (probe the live backend with backend-probe.mjs --versions to make this exact) [R-049]`, 'warn');
    }

    if (node.validate && node.validate.required === true) hasRequired = true;
    if (t === 'validationErrors') hasValidationErrors = true;

    // defaultValue type (R-009)
    if (node.defaultValue !== undefined && node.defaultValue !== null && typeof node.defaultValue !== 'string') {
      add('R-009', label(node), `defaultValue is ${Array.isArray(node.defaultValue) ? 'an array' : typeof node.defaultValue} — the resolver calls .match() and throws; use a string/mustache or bind through data`);
    }

    // conditional visibility (R-031)
    if (node.customVisibility) add('R-031', label(node));

    // flex model must live in the desktop block, not root (R-029). A container
    // showing flex intent (flexDirection/justifyContent/gap at root or desktop)
    // but no desktop.display:flex renders stacked — the renderer ignores root flex.
    if (t === 'container') {
      const dk = node.desktop ?? {};
      const flexIntent = node.flexDirection || node.justifyContent || node.gap
        || dk.flexDirection || dk.justifyContent || dk.gap;
      const dkDisplay = dk.display;
      if (flexIntent && dkDisplay !== 'flex' && dkDisplay !== 'inline-flex' && dkDisplay !== 'grid') {
        add('R-029', label(node), `flex intent but desktop.display is "${dkDisplay ?? '(unset)'}" — the 0.45 renderer reads flex from desktop.*; children will stack`, 'warn');
      }
    }

    if (t === 'button') {
      const an = actionName(node);
      if (an && FORM_ACTIONS.has(an)) add('R-007', label(node), `Standalone button carries form action "${an}" — must be a buttonGroup item`);
      if (node.buttonType === 'primary') hasPrimary = true;
      if (an === 'Submit') hasSubmit = true;
    }

    if (t === 'buttonGroup') {
      const ctx = { primaries: 0, hasSubmit: false };
      walkItems(node.items, ctx);
      if (ctx.primaries > 1) add('R-007', label(node), `buttonGroup has ${ctx.primaries} primary buttons — exactly one primary per action zone`);
      if (ctx.hasSubmit && ctx.primaries === 0) add('R-007', label(node), 'buttonGroup contains Submit but no buttonType:"primary" item');
    }

    if (t === 'dataContext' || t === 'datatableContext') {
      if (!node.entityType && (!node.sourceType || node.sourceType === 'Entity')) add('R-005', label(node), 'dataContext missing entityType — HTTP 500 / permanent "Fetching data…" on load');
      if (!node.sourceType) add('R-005', label(node), 'dataContext missing sourceType (use "Entity" with entityType, or "Url" with an endpoint)');
    }

    if (t === 'checkboxGroup' && node.dataSourceType === 'values' && Array.isArray(node.values) && !Array.isArray(node.items)) {
      add('R-011', label(node));
    }

    if (INPUT_TYPES.has(t) && node.propertyName) {
      if (/^[A-Z]/.test(node.propertyName)) {
        add('R-004', node.propertyName, 'Input propertyName starts uppercase — GQL field keys are camelCase; the binding silently fails');
      }
      boundInputs.push({ prop: node.propertyName, type: t, label: label(node) });
      // R-021 — a human label is user-facing AND how a browser test finds the field
      if (!node.label || String(node.label) === String(node.propertyName)) {
        add('R-021', label(node), `input has no human label (label is ${JSON.stringify(node.label ?? null)}) — labels are user-facing and how browser tests locate fields`);
      }
    }

    checkReflistIdentity(node);
    checkStyleChannels(node);
    checkInlineActions(node);
    checkSplitMechanics(node, parent === null);
    if (navigateTargetMissing(node)) add('R-008', label(node));

    // recurse every slot shape
    walkTree(node.components, node);
    walkTree(node.columns, node);
    if (node.tabs) for (const tab of node.tabs) walkTree(tab.components, node);
    if (node.steps) for (const step of node.steps) walkTree(step.components, node);
    if (node.content && node.content.components) walkTree(node.content.components, node);
    if (node.header && node.header.components) walkTree(node.header.components, node);
    if (node.items && t !== 'buttonGroup') walkItems(node.items, null);
  }
}

walkTree(root.components, null);
scanStrings(root, null, '(root)');

if (hasSubmit && !hasPrimary) add('R-007', '(form)', 'Form has a Submit action but no primary button anywhere');
if (hasRequired && !hasValidationErrors) add('R-006', '(form)');

// ---- form-level checks -------------------------------------------------------
const formSettings = root.formSettings || {};
const access = root.access ?? formSettings.access;
const codeText = (v) => (typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v._code === 'string' ? v._code : ''));

// R-037 — an FK sent as a nested object is rejected by Dynamic CRUD Update.
// FK-ness is READ from metadata; without metadata we can only flag the suspicion.
{
  const reducer = codeText(formSettings.onPrepareSubmitData);
  const reduces = /\bid\b/.test(reducer);
  const FK_COMPONENTS = new Set(['autocomplete', 'entityPicker', 'entityReference']);
  if (hasSubmit && !reduces) {
    const fks = metaByProp
      ? boundInputs.filter((b) => {
        const p = metaByProp[String(b.prop).toLowerCase()];
        return p && String(p.dataType || '').toLowerCase() === 'entity';
      })
      : boundInputs.filter((b) => FK_COMPONENTS.has(b.type));
    if (fks.length) {
      const names = fks.map((f) => f.prop).join(', ');
      if (metaByProp) {
        add('R-037', '(formSettings.onPrepareSubmitData)', `submitting form binds FK-object propert${fks.length > 1 ? 'ies' : 'y'} (${names}) but onPrepareSubmitData does not reduce them to { id } — Dynamic CRUD Update answers "not allowed to be updated"`);
      } else {
        add('R-037', '(formSettings.onPrepareSubmitData)', `submitting form binds probable FK propert${fks.length > 1 ? 'ies' : 'y'} (${names}) with no onPrepareSubmitData reducer — pass the entity metadata dump as arg 2 to decide this mechanically`, 'warn');
      }
    }
  }
}

// R-017 — entity-bound forms stay on the gql loader/submitter unless a custom
// endpoint was explicitly requested (which is built via shesha-app-layer first).
if (present(formSettings.modelType)) {
  for (const k of ['dataLoaderType', 'dataSubmitterType']) {
    if (formSettings[k] && formSettings[k] !== 'gql') {
      add('R-017', `(formSettings.${k})`, `entity-bound form uses ${k}:"${formSettings[k]}" instead of "gql" — custom endpoints are opt-in only`);
    }
  }
}

// R-022 — a form whose name reads as anonymous must declare access 5.
{
  const ANON_RE = /(^|[-_/])(login|signin|sign-in|register|signup|sign-up|otp|forgot|forgot-password|reset-password|public)(?=$|[-_/.])/i;
  const names = [path.basename(file).replace(/\.json$/i, ''), formSettings.name, formSettings.label, root.name, root.label]
    .filter((s) => typeof s === 'string');
  const anon = names.find((n) => ANON_RE.test(n));
  if (anon && access !== 5) {
    add('R-022', '(formSettings.access)', `"${anon}" reads as an anonymous form but formSettings.access is ${JSON.stringify(access ?? null)} — anonymous forms carry access 5 (verify post-push by re-fetch)`);
  }
  // R-041 — a declared-anonymous form must not submit through raw entity CRUD.
  const submitter = formSettings.dataSubmitterType;
  if (access === 5 && hasSubmit && (!submitter || submitter === 'gql')) {
    add('R-041', '(formSettings)', 'access 5 (anonymous) form Submits through the default gql submitter — that is raw entity CRUD on the open internet; post to an [AbpAllowAnonymous] app service via Execute Script instead');
  }
}

// R-025 — an edit must preserve the ids it inherited.
if (baselineFile) {
  try {
    let base = JSON.parse(fs.readFileSync(baselineFile, 'utf8').replace(/^﻿/, ''));
    if (typeof base.markup === 'string') base = JSON.parse(base.markup);
    if (base.result && (base.result.markup || base.result.components)) {
      base = typeof base.result.markup === 'string' ? JSON.parse(base.result.markup) : base.result;
    }
    const baseIds = new Set();
    (function collect(v) {
      if (Array.isArray(v)) return v.forEach(collect);
      if (!v || typeof v !== 'object') return;
      if (typeof v.type === 'string' && v.id) baseIds.add(String(v.id));
      for (const x of Object.values(v)) collect(x);
    })(base.components);
    const lost = [...baseIds].filter((id) => !allIds.has(id));
    for (const id of lost.slice(0, 20)) {
      add('R-025', id, `component id present in the baseline is missing from the new markup — edits preserve ids (fresh GUIDs only on clones/new nodes)`);
    }
    if (lost.length > 20) add('R-025', '(baseline)', `…and ${lost.length - 20} more baseline ids dropped`);
  } catch (e) {
    add('R-025', '(baseline)', `could not read the baseline "${baselineFile}": ${e.message}`, 'warn');
  }
}

const fails = findings.filter((f) => f.severity === 'fail');
const warns = findings.filter((f) => f.severity === 'warn');
for (const f of findings) console.log(`${f.severity.toUpperCase()}  [${f.ruleId}] ${f.target}: ${f.issue}`);
if (matrixState === null) console.log('NOTE  measured-capability-matrix.json unavailable — the no-op channel gate [R-053] was SKIPPED');
if (LEGACY_CORPUS) console.log('NOTE  --legacy-corpus: R-052/R-053 downgraded to WARN (golden-corpus regression mode only)');
console.log(`\n${fails.length} fail, ${warns.length} warn — ${file}`);
process.exit(fails.length ? 1 : 0);
