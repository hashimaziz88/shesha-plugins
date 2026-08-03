#!/usr/bin/env node
// validate-blueprint.mjs <blueprint.json | blueprint.md> [--schema <path>]
//
// The runtime validator for the blueprint IR — the contract between
// comprehension (which authors blueprints) and shesha-form-edit's compiler
// (which accepts ONLY a blueprint as build input, "no spec, no build").
//
// Checks, against schemas/blueprint.schema.json:
//   * every top-level `required` key is present
//   * `archetype` is in the schema enum
//   * `entity.fullClassName` and `form.module` / `form.name` are non-empty
//   * every layout node's `kind` is in the node enum, and carries no key the
//     node definition does not declare (recursive walk through `children`)
//
// Library:  import { validateBlueprint, loadSchema, readBlueprint } from '.../validate-blueprint.mjs'
//           validateBlueprint(bp, schema) -> { errors: string[], nodeCount: number }
// CLI:      exit 0 clean · 1 invalid (findings printed) · 2 usage/IO error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Default schema location — sibling `schemas/` dir of this script's skill. */
export const DEFAULT_SCHEMA_PATH = path.join(HERE, '..', 'schemas', 'blueprint.schema.json');

/** Read + parse the blueprint schema (defaults to this skill's copy). */
export function loadSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8').replace(/^﻿/, ''));
}

/**
 * Pull the blueprint JSON text out of a raw file body. A `.md` blueprint carries
 * its machine twin in a fenced ```blueprint-json block; a `.json` file is the
 * blueprint itself.
 * @returns {string} JSON text
 */
export function extractBlueprintJson(text, { markdown = false } = {}) {
  const body = text.replace(/^﻿/, '');
  if (!markdown) return body;
  const m = body.match(/```blueprint-json\s*\n([\s\S]*?)```/);
  if (!m) throw new Error('no ```blueprint-json fenced block found in the Markdown blueprint');
  return m[1];
}

/** Load a blueprint from a `.json` or `.md` path. Returns the parsed object. */
export function readBlueprint(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(extractBlueprintJson(text, { markdown: /\.md$/i.test(file) }));
}

/**
 * Structurally validate a blueprint object against the blueprint schema.
 * Never throws on a malformed blueprint — every defect comes back as an error
 * string, so callers can print the whole list at once.
 * @param {object} bp parsed blueprint
 * @param {object} schema parsed blueprint.schema.json
 * @returns {{errors: string[], nodeCount: number}}
 */
export function validateBlueprint(bp, schema) {
  const errors = [];
  let nodeCount = 0;

  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) {
    return { errors: ['blueprint is not a JSON object'], nodeCount: 0 };
  }

  const nodeDef = schema?.$defs?.node;
  if (!nodeDef?.properties?.kind?.enum) {
    return { errors: ['schema is missing $defs.node.properties.kind.enum — not a blueprint schema'], nodeCount: 0 };
  }
  const kinds = new Set(nodeDef.properties.kind.enum);
  const nodeKeys = new Set(Object.keys(nodeDef.properties));
  const archetypes = new Set(schema.properties?.archetype?.enum ?? []);

  for (const req of schema.required ?? []) {
    if (bp[req] === undefined) errors.push(`missing required "${req}"`);
  }
  if (bp.archetype !== undefined && !archetypes.has(bp.archetype)) {
    errors.push(`archetype "${bp.archetype}" not in the schema enum`);
  }
  if (!bp.entity?.fullClassName) errors.push('entity.fullClassName missing');
  if (!bp.form?.module || !bp.form?.name) errors.push('form.module/name missing');

  const walkNode = (n, at) => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      errors.push(`${at}: node is not an object`);
      return;
    }
    nodeCount++;
    if (!kinds.has(n.kind)) errors.push(`${at}: kind "${n.kind}" not in the schema enum`);
    for (const k of Object.keys(n)) {
      if (!nodeKeys.has(k)) errors.push(`${at}: unknown node key "${k}"`);
    }
    const children = n.children;
    if (children !== undefined && !Array.isArray(children)) {
      errors.push(`${at}: children must be an array`);
    } else {
      for (const [i, c] of (children ?? []).entries()) walkNode(c, `${at}/${n.kind}[${i}]`);
    }
  };
  if (bp.layout !== undefined) walkNode(bp.layout, 'layout');

  return { errors, nodeCount };
}

// ---- CLI --------------------------------------------------------------------
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const argVal = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--schema');
  if (!file) {
    console.error('usage: node validate-blueprint.mjs <blueprint.json|blueprint.md> [--schema <blueprint.schema.json>]');
    process.exit(2);
  }
  let bp; let schema;
  try {
    schema = loadSchema(argVal('--schema', DEFAULT_SCHEMA_PATH));
    bp = readBlueprint(file);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }
  const { errors, nodeCount } = validateBlueprint(bp, schema);
  if (errors.length) {
    console.error(`INVALID blueprint: ${file} — ${errors.length} finding(s)`);
    for (const e of errors) console.error(`  FAIL ${e}`);
    process.exit(1);
  }
  console.log(`OK ${file} — valid blueprint IR (${nodeCount} layout node${nodeCount === 1 ? '' : 's'})`);
  process.exit(0);
}
