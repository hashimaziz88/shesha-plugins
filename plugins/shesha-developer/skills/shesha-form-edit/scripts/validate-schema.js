#!/usr/bin/env node
// validate-schema.js <form.json>
// The CHEAPEST gate (first in the hook chain): validates markup against
// schemas/form-config.schema.json. Zero dependencies — interprets exactly the
// subset of JSON Schema that generate-schema.js emits (required, enum, type,
// pattern, items/$ref recursion, not:{}).
// Exit 1 on violations, 2 on usage/schema errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(SCRIPT_DIR, '..', 'schemas', 'form-config.schema.json');

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
}
recurse(root.components, 'components');

for (const v of violations) console.log(`SCHEMA  ${v}`);
console.log(`\n${violations.length} schema violation(s) — ${file}`);
process.exit(violations.length ? 1 : 0);
