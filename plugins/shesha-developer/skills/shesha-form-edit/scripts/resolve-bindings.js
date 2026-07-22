#!/usr/bin/env node
// resolve-bindings.js <form.json> [--backend http://localhost:21021] [--model-type <fullClassName>]
//
// L4 blocking gate for entity-bound forms [R-015, R-016, R-034]:
//  - every bound propertyName exists on its scope's entity (live Metadata/GetProperties)
//  - dotted navigation paths resolve segment-by-segment
//  - every referenceListId exists (and has items when the API returns them)
//  - custom endpoints referenced in markup respond (404 = missing)
// Scope = nearest dataContext ancestor's entityType, else formSettings.modelType.
// Exit 1 with a findings table; 0 clean; 2 usage/infra errors.

import fs from 'node:fs';
import { GymApi } from './gym-lib/api.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
if (!file) { console.error('usage: node resolve-bindings.js <form.json> [--backend url] [--model-type fullClassName]'); process.exit(2); }

let root = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (typeof root.markup === 'string') root = JSON.parse(root.markup);
if (root.result && (root.result.markup || root.result.components)) {
  root = typeof root.result.markup === 'string' ? JSON.parse(root.result.markup) : root.result;
}

const api = new GymApi(argVal('--backend', 'http://localhost:21021'));
await api.authenticate();

// ---- entity metadata cache --------------------------------------------------
const propsCache = new Map(); // container(lower) -> Map(propLower -> prop) | null
async function getProps(container) {
  const key = String(container).toLowerCase();
  if (propsCache.has(key)) return propsCache.get(key);
  const { ok, body } = await api.getJson(`/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(container)}`);
  let map = null;
  const arr = Array.isArray(body?.result) ? body.result : (Array.isArray(body) ? body : null);
  if (ok && arr) {
    map = new Map();
    for (const p of arr) if (p?.path) map.set(String(p.path).toLowerCase(), p);
  }
  propsCache.set(key, map);
  return map;
}

async function resolveModelType() {
  const explicit = argVal('--model-type', null);
  if (explicit) return explicit;
  const mt = root.formSettings?.modelType;
  if (!mt) return null;
  if (typeof mt === 'string') return mt;
  // {name, module} object → resolve fullClassName via EntityTypeAutocomplete [R-016]
  const { body } = await api.getJson(`/api/services/app/Metadata/EntityTypeAutocomplete?term=${encodeURIComponent(mt.name)}`);
  const items = body?.result ?? [];
  const hit = items.find((i) => (i.value || i.displayText || '').includes(mt.name));
  return hit?.value ?? null;
}

// ---- walk markup, collect work ----------------------------------------------
const bindings = []; // {prop, scopeEntity, label}
const reflists = new Map(); // "module/name" -> label
const endpoints = new Set();

const INPUTISH = /Field$|^dropdown$|^autocomplete$|^checkbox|^radio$|^switch$|^entityPicker$|^textArea$|^rate$|^slider$|^refListStatus$|^timePicker$|^fileUpload$/;

function walk(nodes, scopeEntity) {
  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') continue;
    let scope = scopeEntity;
    if ((node.type === 'dataContext' || node.type === 'datatableContext')) {
      if (typeof node.entityType === 'string' && node.entityType) scope = node.entityType;
      if (typeof node.endpoint === 'string' && node.endpoint.startsWith('/')) endpoints.add(node.endpoint);
    }
    if (node.propertyName && typeof node.propertyName === 'string'
        && (INPUTISH.test(node.type ?? '') || node.columnType === 'data')) {
      bindings.push({ prop: node.propertyName, scopeEntity: scope, label: node.componentName || node.propertyName });
    }
    if (node.referenceListId && typeof node.referenceListId === 'object' && node.referenceListId.name) {
      reflists.set(`${node.referenceListId.module ?? ''}/${node.referenceListId.name}`, node.componentName || node.propertyName || node.type);
    }
    if (Array.isArray(node.items)) {
      for (const it of node.items) {
        if (it?.columnType === 'data' && it.propertyName) bindings.push({ prop: it.propertyName, scopeEntity: scope, label: `column ${it.propertyName}` });
      }
    }
    walk(node.components, scope);
    if (Array.isArray(node.columns)) for (const c of node.columns) walk(c?.components, scope);
    if (Array.isArray(node.tabs)) for (const t of node.tabs) walk(t?.components, scope);
    if (Array.isArray(node.steps)) for (const s of node.steps) walk(s?.components, scope);
    if (node.content?.components) walk(node.content.components, scope);
    if (node.header?.components) walk(node.header.components, scope);
  }
}

const modelType = await resolveModelType();
walk(root.components, modelType);

// ---- verify -------------------------------------------------------------------
const findings = [];

if (root.formSettings?.modelType && !modelType) {
  findings.push(`[R-016] formSettings.modelType ${JSON.stringify(root.formSettings.modelType)} did not resolve to a live entity type`);
}

for (const b of bindings) {
  if (!b.scopeEntity) continue; // unbound scope (form-data-only property) — nothing to verify against
  const segments = b.prop.split('.');
  let container = b.scopeEntity;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const props = await getProps(container);
    if (!props) { findings.push(`[R-034] ${b.label}: metadata for "${container}" unavailable — cannot verify "${b.prop}"`); break; }
    const p = props.get(seg.toLowerCase());
    if (!p) { findings.push(`[R-034] ${b.label}: "${seg}"${segments.length > 1 ? ` (segment ${i + 1} of ${b.prop})` : ''} does not exist on ${container}`); break; }
    if (i < segments.length - 1) {
      if (!p.entityType) { findings.push(`[R-034] ${b.label}: "${seg}" in "${b.prop}" is not a navigation property (no entityType) — cannot dot into it`); break; }
      container = p.entityType;
    }
  }
}

for (const [key, label] of reflists) {
  const [module, name] = key.split('/');
  // 0.45 route: reflists are configuration items (this is what the renderer itself fetches)
  let { ok, body } = await api.getJson(
    `/api/services/app/ConfigurationItem/GetCurrent?itemType=reference-list&name=${encodeURIComponent(name)}&module=${encodeURIComponent(module)}`,
  );
  let items = body?.result?.configuration?.items;
  if (!ok) {
    // legacy fallback
    ({ ok, body } = await api.getJson(`/api/services/app/ReferenceList/GetByName?name=${encodeURIComponent(name)}&module=${encodeURIComponent(module)}`));
    items = body?.result?.items;
  }
  if (!ok) {
    findings.push(`[R-015] ${label}: reference list ${module}.${name} does not exist — the dropdown renders EMPTY`);
  } else if (Array.isArray(items) && items.length === 0) {
    findings.push(`[R-015] ${label}: reference list ${module}.${name} exists but has 0 items`);
  }
}

for (const ep of endpoints) {
  const { status } = await api.getJson(ep);
  if (status === 404) findings.push(`[R-026] custom endpoint ${ep} → 404 (wrong namespace or missing service)`);
}

for (const f of findings) console.log(`FAIL  ${f}`);
console.log(`\nresolve-bindings: ${bindings.length} bindings, ${reflists.size} reflists, ${endpoints.size} endpoints checked — ${findings.length} unresolved — ${file}`);
process.exit(findings.length ? 1 : 0);
