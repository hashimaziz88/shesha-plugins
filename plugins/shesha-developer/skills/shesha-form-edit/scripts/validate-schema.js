#!/usr/bin/env node
// validate-schema.js <form.json>
// The CHEAPEST gate (first in the hook chain): validates markup against
// schemas/form-config.schema.json. Zero dependencies — interprets exactly the
// subset of JSON Schema that generate-schema.js emits (required, enum, type,
// pattern, items/$ref recursion, not:{}).
//
// It is ALSO typed against assets/component-registry.json wherever that registry
// has data: a component whose registry entry declares `propTypes` gets each typed
// prop checked — an enum prop rejects a non-member, a number prop rejects a string,
// a css-length prop rejects a bare number. The registry says what EXISTS; it does
// NOT say what renders (that is the measured matrix + R-053), so this adds shape
// checks only. No registry, or a type/prop the registry does not know → exactly the
// previous behaviour, so a fresh install gains no new failure mode.
// Exit 1 on violations, 2 on usage/schema errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(SCRIPT_DIR, '..', 'schemas', 'form-config.schema.json');
const REGISTRY_PATH = path.join(SCRIPT_DIR, '..', 'assets', 'component-registry.json');

const file = process.argv[2];
if (!file) { console.error('usage: node validate-schema.js <form.json>'); process.exit(2); }

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

let root = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (typeof root.markup === 'string') root = JSON.parse(root.markup);
if (root.result && (root.result.markup || root.result.components)) {
  root = typeof root.result.markup === 'string' ? JSON.parse(root.result.markup) : root.result;
}

const violations = [];
const componentDef = schema.$defs.component;

// ---- typed registry (absence = skip, never a false pass) ---------------------
let REGISTRY = null;
try { REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8').replace(/^﻿/, '')); }
catch { REGISTRY = null; }   // not installed / not regenerated yet → schema-only

// Appearance channels are authored inside the breakpoint blocks; the registry's prop
// paths are device-agnostic, so each typed path is checked at the root AND under
// every breakpoint (the same normalisation validate-guardrails uses for the matrix).
const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

const valueAt = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o == null || typeof o !== 'object' ? undefined : o[k]), obj);

/**
 * One typed prop against one authored value.
 * A non-primitive is always skipped: `{_code,_mode}` is a JS setting and a nested
 * object is a compound whose leaves are typed by their own paths — neither is a
 * literal this can judge.
 */
function checkTypedValue(def, value, where, type) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value === 'object') return;
  if (def.type === 'enum') {
    // members are compared loosely: the settings forms store some unions as strings
    // and the markup carries the same choice as a number, which is the same choice.
    if (!def.values.includes(value) && !def.values.includes(String(value))) {
      violations.push(`${where}: ${JSON.stringify(value)} is not a member of ${type}.${def.pathLabel} — registry enum is ${JSON.stringify(def.values)}`);
    }
  } else if (def.type === 'numeric-picker') {
    // an open numeric picker: any number (or numeric string) is legal, a word is not
    if (!/^-?\d+(\.\d+)?$/.test(String(value))) {
      violations.push(`${where}: ${JSON.stringify(value)} is not numeric — the registry types ${type}.${def.pathLabel} as a numeric picker (presets ${JSON.stringify(def.values)})`);
    }
  } else if (def.type === 'number') {
    if (typeof value === 'string') {
      violations.push(`${where}: ${JSON.stringify(value)} is a string but the registry types ${type}.${def.pathLabel} as a number`);
    }
  } else if (def.type === 'css-length') {
    if (typeof value === 'number') {
      violations.push(`${where}: ${value} is a bare number but the registry types ${type}.${def.pathLabel} as a CSS length string — the renderer concatenates, it does not coerce; write "${value}px"`);
    }
  }
}

/** Type every registry-typed prop of one component node. No entry → no checks. */
function checkTypes(node, pathStr) {
  if (!REGISTRY) return;
  const propTypes = REGISTRY.components?.[node.type]?.propTypes;
  if (!propTypes) return;
  for (const [prop, rawDef] of Object.entries(propTypes)) {
    const def = { ...rawDef, pathLabel: prop };
    checkTypedValue(def, valueAt(node, prop), `${pathStr}.${prop}`, node.type);
    for (const bp of BREAKPOINTS) {
      if (node[bp] && typeof node[bp] === 'object') {
        checkTypedValue(def, valueAt(node[bp], prop), `${pathStr}.${bp}.${prop}`, node.type);
      }
    }
  }
}

function typeOk(value, t) {
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) =>
    x === 'array' ? Array.isArray(value)
    : x === 'integer' ? Number.isInteger(value)
    : x === 'object' ? (value !== null && typeof value === 'object' && !Array.isArray(value))
    : typeof value === x);
}

function checkNode(node, pathStr) {
  if (!node || typeof node !== 'object') {
    violations.push(`${pathStr}: component is not an object`);
    return;
  }
  for (const req of componentDef.required) {
    if (node[req] === undefined || node[req] === null || node[req] === '') violations.push(`${pathStr}: missing required "${req}"`);
  }
  for (const [prop, def] of Object.entries(componentDef.properties)) {
    const v = node[prop];
    if (v === undefined || v === null) continue;
    if (def.not && Object.keys(def.not).length === 0) {
      violations.push(`${pathStr}.${prop}: forbidden — ${def.description || 'not allowed'}`);
      continue;
    }
    if (def.enum && !def.enum.includes(v)) {
      violations.push(`${pathStr}.${prop}: "${v}" not in schema enum${prop === 'type' ? ' — unknown component type (not in the 0.45 KB, unusable by definition)' : ''}`);
      continue;
    }
    if (def.type && !typeOk(v, def.type)) {
      violations.push(`${pathStr}.${prop}: expected ${def.type}, got ${Array.isArray(v) ? 'array' : typeof v}${def.description ? ` — ${def.description}` : ''}`);
      continue;
    }
    if (def.pattern && typeof v === 'string' && !new RegExp(def.pattern).test(v)) {
      violations.push(`${pathStr}.${prop}: "${String(v).slice(0, 40)}" fails pattern${def.description ? ` — ${def.description}` : ''}`);
    }
  }
  checkTypes(node, pathStr);
  // recurse all slot shapes
  recurse(node.components, `${pathStr}.components`);
  if (Array.isArray(node.columns)) node.columns.forEach((c, i) => recurse(c?.components, `${pathStr}.columns[${i}]`));
  if (Array.isArray(node.tabs)) node.tabs.forEach((t, i) => recurse(t?.components, `${pathStr}.tabs[${i}]`));
  if (Array.isArray(node.steps)) node.steps.forEach((s, i) => recurse(s?.components, `${pathStr}.steps[${i}]`));
  if (node.content?.components) recurse(node.content.components, `${pathStr}.content`);
  if (node.header?.components) recurse(node.header.components, `${pathStr}.header`);
}

function recurse(components, pathStr) {
  if (!Array.isArray(components)) return;
  components.forEach((c, i) => checkNode(c, `${pathStr}[${i}]`));
}

for (const req of schema.required) {
  if (root[req] === undefined) violations.push(`(root): missing required "${req}"`);
}
if (root.formSettings) {
  const fsDef = schema.properties.formSettings.properties;
  if (root.formSettings.layout !== undefined && !fsDef.layout.enum.includes(root.formSettings.layout)) {
    violations.push(`formSettings.layout: "${root.formSettings.layout}" not in ${JSON.stringify(fsDef.layout.enum)}`);
  }
  // typed against the registry's own formSettings section — same three rules as the
  // component walk, so a form-level setting is no less typed than a component prop
  const fsTypes = REGISTRY?.formSettings?.propTypes;
  if (fsTypes) {
    for (const [prop, rawDef] of Object.entries(fsTypes)) {
      if (prop === 'layout') continue;   // already reported above from the schema
      const def = { ...rawDef, pathLabel: prop };
      checkTypedValue(def, valueAt(root.formSettings, prop), `formSettings.${prop}`, 'formSettings');
    }
  }
}
recurse(root.components, 'components');

for (const v of violations) console.log(`SCHEMA  ${v}`);
console.log(`\n${violations.length} schema violation(s) — ${file}`);
process.exit(violations.length ? 1 : 0);
