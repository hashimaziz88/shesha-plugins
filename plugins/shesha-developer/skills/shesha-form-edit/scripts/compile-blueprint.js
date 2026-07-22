#!/usr/bin/env node
// compile-blueprint.js --blueprint <blueprint.json> --out <form.json>
//                      [--backend http://localhost:21021] [--no-live]
//
// L3: the blueprint IR is the ONLY build input; the model chooses the
// adaptation, this script types the JSON. Pipeline:
//   layout tree → flex containers (display:flex + desktop.dimensions.width [R-028/R-029])
//   fields      → by-datatype components, live-metadata bindings [R-004/R-015/R-034]
//   tables      → dataContext(v8) wrapper + datatable columns [R-005]
//   floor       → validationErrors + Submit/exit buttonGroup on capture archetypes [R-006/R-007]
//   versions    → stamped from the 0.45 components-kb [R-003]
//   ids         → deterministic (sha of form+path) → reruns diff cleanly
//
// With --backend (default on): resolves reflist identities + datatype-driven
// component choice from live Metadata/GetProperties. --no-live skips (bindings
// then need resolve-bindings.js before push).
// Accepts a raw JSON blueprint or a Markdown blueprint containing a fenced
// ```blueprint-json block.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymUuid } from './gym-lib/ids.js';
import { GymApi } from './gym-lib/api.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const bpFile = argVal('--blueprint', null);
const outFile = argVal('--out', null);
if (!bpFile || !outFile) { console.error('usage: node compile-blueprint.js --blueprint <bp.json|bp.md> --out <form.json> [--backend url] [--no-live]'); process.exit(2); }

// ---- load blueprint (JSON or fenced block in Markdown) ------------------------
let bpText = fs.readFileSync(bpFile, 'utf8').replace(/^﻿/, '');
if (bpFile.endsWith('.md')) {
  const m = bpText.match(/```blueprint-json\s*\n([\s\S]*?)```/);
  if (!m) { console.error('no ```blueprint-json fenced block found in the Markdown blueprint'); process.exit(2); }
  bpText = m[1];
}
const bp = JSON.parse(bpText);
for (const req of ['screen', 'entity', 'form', 'archetype', 'layout']) {
  if (!bp[req]) { console.error(`blueprint missing required "${req}" — no spec, no build`); process.exit(1); }
}

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));
const ver = (type) => {
  const v = index[type]?.version;
  if (!Number.isInteger(v)) throw new Error(`component type "${type}" not in the 0.45 KB — unusable by definition (L1)`);
  return v;
};

// ---- live metadata (datatype → component, reflist identity) -------------------
let propsMeta = null; // Map(lower -> prop)
if (!args.includes('--no-live')) {
  const api = new GymApi(argVal('--backend', 'http://localhost:21021'));
  await api.authenticate();
  const { ok, body } = await api.getJson(`/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(bp.entity.fullClassName)}`);
  const arr = Array.isArray(body?.result) ? body.result : null;
  if (ok && arr) {
    propsMeta = new Map();
    for (const p of arr) if (p?.path) propsMeta.set(String(p.path).toLowerCase(), p);
  } else {
    console.error(`WARN: metadata for ${bp.entity.fullClassName} unavailable — compiling without live binding resolution`);
  }
}

const BY_DATATYPE = {
  'string': 'textField',
  'string-multiline': 'textArea',
  'text': 'textArea',
  'number': 'numberField',
  'float': 'numberField',
  'int64': 'numberField',
  'date': 'dateField',
  'date-time': 'dateField',
  'time': 'timePicker',
  'boolean': 'checkbox',
  'reference-list-item': 'dropdown',
  'entity': 'autocomplete',
  'guid': 'textField',
};

function titleCase(prop) {
  const last = prop.split('.').pop();
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

const bindingIndex = new Map((bp.bindings ?? []).map((b) => [b.property, b]));

function fieldComponent(node, idKey) {
  const prop = node.property;
  const binding = bindingIndex.get(prop) ?? {};
  const meta = propsMeta?.get(String(prop).toLowerCase().split('.')[0]);
  let type = node.component ?? binding.component;
  if (!type) {
    const dt = binding.datatype ?? meta?.dataType ?? 'string';
    type = BY_DATATYPE[dt] ?? 'textField';
  }
  const comp = {
    id: gymUuid('bp', bp.form.name, idKey),
    type,
    version: ver(type),
    propertyName: prop,
    label: binding.label ?? node.title ?? titleCase(prop),
  };
  if (type === 'dropdown' || type === 'radio' || type === 'refListStatus') {
    const p = propsMeta?.get(String(prop).toLowerCase());
    if (p?.referenceListName) {
      // identity copied verbatim from metadata [R-015]
      comp.dataSourceType = 'referenceList';
      comp.referenceListId = { module: p.referenceListModule ?? null, name: p.referenceListName.split('.').pop() };
    } else if (propsMeta) {
      console.error(`WARN: ${prop} compiled as ${type} but metadata shows no referenceListName`);
    }
  }
  if (type === 'autocomplete') {
    const p = propsMeta?.get(String(prop).toLowerCase());
    if (p?.entityType) Object.assign(comp, { dataSourceType: 'entitiesList', entityTypeShortAlias: p.entityType, mode: 'single' });
  }
  return comp;
}

let seq = 0;
function compileNode(node, idPrefix) {
  const idKey = `${idPrefix}/${node.kind}:${node.name ?? node.property ?? seq++}`;
  switch (node.kind) {
    case 'field':
      return fieldComponent(node, idKey);
    case 'text':
      return {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'text', version: ver('text'),
        componentName: node.name ?? `text${seq}`,
        content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
      };
    case 'buttonGroup':
      return floorButtonGroup(idKey);
    case 'datatable': {
      const table = {
        id: gymUuid('bp', bp.form.name, `${idKey}/table`),
        type: 'datatable', version: ver('datatable'),
        componentName: `${node.name ?? 'table'}Grid`, propertyName: `${node.name ?? 'table'}Grid`,
        canEditInline: 'no', canAddInline: 'no', canDeleteInline: 'no', useMultiselect: false,
        items: (node.columns ?? []).map((col, i) => ({
          id: gymUuid('bp', bp.form.name, `${idKey}/col/${col}`),
          itemType: 'item', sortOrder: i, columnType: 'data',
          propertyName: col, caption: titleCase(col), isVisible: true, allowSorting: true,
          displayComponent: { type: '[default]' }, editComponent: { type: '[not-editable]' }, createComponent: { type: '[not-editable]' },
        })),
      };
      const ctx = {
        id: gymUuid('bp', bp.form.name, `${idKey}/ctx`),
        type: 'dataContext', version: ver('dataContext'),
        entityType: bp.entity.fullClassName, sourceType: 'Entity',
        dataFetchingMode: 'paging', defaultPageSize: 10,
        uniqueStateId: node.name ?? 'table', componentName: node.name ?? 'table', propertyName: node.name ?? 'table',
        sortMode: 'standard', allowReordering: 'no',
        components: [table],
      };
      table.parentId = ctx.id;
      for (const it of table.items) it.parentId = table.id;
      return ctx;
    }
    case 'datalist': {
      const list = {
        id: gymUuid('bp', bp.form.name, `${idKey}/list`),
        type: 'datalist', version: ver('datalist'),
        componentName: `${node.name ?? 'list'}List`, propertyName: `${node.name ?? 'list'}List`,
        formSelectionMode: 'name',
        formId: { name: node.itemForm ?? `${bp.form.name}-item`, module: bp.form.module },
        orientation: 'vertical', selectionMode: 'none',
      };
      const ctx = {
        id: gymUuid('bp', bp.form.name, `${idKey}/ctx`),
        type: 'dataContext', version: ver('dataContext'),
        entityType: bp.entity.fullClassName, sourceType: 'Entity',
        dataFetchingMode: 'paging', defaultPageSize: 10,
        uniqueStateId: node.name ?? 'list', componentName: node.name ?? 'list', propertyName: node.name ?? 'list',
        sortMode: 'standard', allowReordering: 'no',
        components: [list],
      };
      list.parentId = ctx.id;
      return ctx;
    }
    case 'tabs': {
      const tabs = {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'tabs', version: ver('tabs'),
        componentName: node.name ?? 'tabs', tabType: 'line',
        defaultActiveKey: node.children?.[0]?.name ?? 'tab1',
        tabs: (node.children ?? []).map((tab, i) => {
          const key = tab.name ?? `tab${i + 1}`;
          return {
            id: gymUuid('bp', bp.form.name, `${idKey}/tab/${key}`),
            key, title: tab.title ?? titleCase(key),
            components: (tab.children ?? []).map((c) => compileNode(c, `${idKey}/${key}`)),
          };
        }),
      };
      for (const t of tabs.tabs) for (const c of t.components) c.parentId = tabs.id;
      return tabs;
    }
    default: { // region | container | row | card | inline containers
      const isRow = node.kind === 'row';
      const container = {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'container', version: ver('container'),
        componentName: node.name ?? `${node.kind}${seq}`,
        direction: isRow ? 'horizontal' : 'vertical',
        display: 'flex',
        flexDirection: isRow ? 'row' : 'column',
        gap: '12',
        components: (node.children ?? []).map((c) => compileNode(c, idKey)),
      };
      for (const c of container.components) c.parentId = container.id;
      if (node.width) container.desktop = { ...(container.desktop ?? {}), dimensions: { width: node.width } };
      return container;
    }
  }
}

function floorButtonGroup(idKey) {
  const bg = {
    id: gymUuid('bp', bp.form.name, `${idKey}/actions`),
    type: 'buttonGroup', version: ver('buttonGroup'),
    componentName: 'formActions',
    items: [
      {
        id: gymUuid('bp', bp.form.name, `${idKey}/actions/save`),
        itemType: 'item', itemSubType: 'button', sortOrder: 0,
        name: 'btnSave', label: 'Save', buttonType: 'primary',
        actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form' },
      },
      {
        id: gymUuid('bp', bp.form.name, `${idKey}/actions/back`),
        itemType: 'item', itemSubType: 'button', sortOrder: 1,
        name: 'btnBack', label: 'Back', buttonType: 'default',
        actionConfiguration: { actionName: 'Navigate', actionOwner: 'shesha.common', actionArguments: { target: '/' } },
      },
    ],
  };
  return bg;
}

// ---- assemble ------------------------------------------------------------------
const rootChildren = [compileNode(bp.layout, bp.form.name)];

// floor: capture archetypes always get validationErrors + Submit/exit pair [R-006/R-007/R-020]
const CAPTURE_ARCHETYPES = new Set(['capture', 'modal-dialog', 'wizard']);
const treeText = JSON.stringify(rootChildren);
if (CAPTURE_ARCHETYPES.has(bp.archetype)) {
  if (!treeText.includes('"validationErrors"')) {
    rootChildren.push({
      id: gymUuid('bp', bp.form.name, 'validationErrors'),
      type: 'validationErrors', version: ver('validationErrors'),
      componentName: 'formValidationErrors',
    });
  }
  if (!treeText.includes('"Submit"')) rootChildren.push(floorButtonGroup('floor'));
}
for (const c of rootChildren) c.parentId = 'root';

const form = {
  components: rootChildren,
  formSettings: {
    layout: 'horizontal',
    colon: true,
    labelCol: { span: 6 },
    wrapperCol: { span: 18 },
    modelType: bp.entity.modelType ?? bp.entity.fullClassName,
  },
};

fs.writeFileSync(outFile, JSON.stringify(form, null, 2) + '\n');
console.log(`compiled ${bp.screen} (${bp.archetype}) → ${outFile}`);
console.log(`next gates: validate-schema → validate-guardrails → resolve-bindings`);
