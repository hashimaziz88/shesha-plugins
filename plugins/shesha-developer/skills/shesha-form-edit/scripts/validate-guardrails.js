#!/usr/bin/env node
/**
 * validate-guardrails.js <form.json> [entity-metadata.json]
 *
 * Mechanical guardrails for render-killers. Every check is a rule in
 * references/_rules.json — findings cite [R-xxx]; this file owns only the
 * walkers, never the facts.
 *
 * Optional arg 2: a cached Metadata/GetProperties dump — upgrades the
 * reflist-identity check (R-015) from WARN (unverified) to FAIL on mismatch.
 *
 * Exit code 1 when any `fail` finding exists. No dependencies.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) { console.error('usage: node validate-guardrails.js <form.json> [entity-metadata.json]'); process.exit(2); }

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

let root = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (typeof root.markup === 'string') root = JSON.parse(root.markup);
if (root.result && (root.result.markup || root.result.components)) {
  root = typeof root.result.markup === 'string' ? JSON.parse(root.result.markup) : root.result;
}

// Optional entity metadata (arg 2)
let metaByProp = null;
const metaFile = process.argv[3];
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
    if (node.version === undefined || node.version === null || !Number.isInteger(node.version)) {
      add('R-003', label(node), `component "${t}" has no integer version — legacy render path (read-only spans) or migration throw`);
    } else if (kbVersions && kbVersions[t] != null && node.version !== kbVersions[t]) {
      add('R-003', label(node), `version ${node.version} ≠ KB version ${kbVersions[t]} for "${t}" — stale versions silently drop the desktop style block`, 'warn');
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

    // text does not take colour like other v7 components (R-052). All warn, not
    // fail: the h1 case is proven, but several goldens ship textType:"span" with
    // desktop.font.color, so whether span escapes the trap is unresolved —
    // verify by measuring computed colour, not by reading the JSON.
    if (t === 'text') {
      const blockColour = node.desktop?.font?.color || node.tablet?.font?.color || node.mobile?.font?.color;
      if ((blockColour || node.font?.color) && !node.textType) {
        add('R-052', label(node), 'text sets a colour with no textType — it renders as <h1 class="ant-typography"> and AntD\'s h1 rule overrides size AND colour silently. Set textType:"paragraph" + contentType:"custom" + a top-level font.color', 'warn');
      } else if (blockColour && !node.font?.color) {
        add('R-052', label(node), `text colour is only in a breakpoint block (textType:"${node.textType}") — desktop.font.color measured as a no-op on text; the working form is textType:"paragraph" + contentType:"custom" + a top-level font.color. Measure the computed colour before trusting it`, 'warn');
      }
      if (node.textAlign) add('R-052', label(node), 'top-level textAlign is in the schema but dead at runtime — use desktop.font.align', 'warn');
      if (node.textTransform || node.letterSpacing) add('R-052', label(node), 'textTransform/letterSpacing have no working lever on text — type the content in the case you want', 'warn');
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

    if (INPUT_TYPES.has(t) && node.propertyName && /^[A-Z]/.test(node.propertyName)) {
      add('R-004', node.propertyName, 'Input propertyName starts uppercase — GQL field keys are camelCase; the binding silently fails');
    }

    checkReflistIdentity(node);
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

if (hasSubmit && !hasPrimary) add('R-007', '(form)', 'Form has a Submit action but no primary button anywhere');
if (hasRequired && !hasValidationErrors) add('R-006', '(form)');

const fails = findings.filter((f) => f.severity === 'fail');
const warns = findings.filter((f) => f.severity === 'warn');
for (const f of findings) console.log(`${f.severity.toUpperCase()}  [${f.ruleId}] ${f.target}: ${f.issue}`);
console.log(`\n${fails.length} fail, ${warns.length} warn — ${file}`);
process.exit(fails.length ? 1 : 0);
