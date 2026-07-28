#!/usr/bin/env node
/**
 * validate-blueprint.mjs — validates a blueprint IR against blueprint.schema.json.
 *
 * Zero dependencies. Interprets exactly the JSON Schema subset the blueprint schema
 * uses: type, const, enum, required, properties, additionalProperties:false, items,
 * minItems, minLength, minimum, maximum, pattern, $ref, oneOf.
 *
 * `oneOf` branches are discriminated on `kind`, so an invalid node reports the error
 * for ITS kind rather than fifteen parallel failures.
 *
 * Also enforces the structural invariants a schema cannot express:
 *   - no duplicate node `name` within the tree (they become component names)
 *   - every `field`/`chip` property appears in `bindings` when bindings are supplied
 *   - capture-family archetypes carry an `actions` node
 *
 * Usage:
 *   node scripts/validate-blueprint.mjs <blueprint.json|blueprint.md>
 * Exit 0 valid · 1 invalid · 2 usage/unreadable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  SCRIPT_DIR, '..', '..', 'shesha-design-comprehension', 'schemas', 'blueprint.schema.json',
);

export function loadSchema(schemaPath = SCHEMA_PATH) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8').replace(/^﻿/, ''));
}

/** Extract the blueprint object from a .json file or a fenced ```blueprint-json block. */
export function readBlueprint(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (file.endsWith('.md')) {
    const m = raw.match(/```blueprint-json\s*([\s\S]*?)```/);
    if (!m) throw new Error('no ```blueprint-json fenced block found in the Markdown blueprint');
    return JSON.parse(m[1]);
  }
  return JSON.parse(raw);
}

function deref(schema, root) {
  let s = schema;
  const seen = new Set();
  while (s && s.$ref) {
    if (seen.has(s.$ref)) throw new Error(`cyclic $ref at ${s.$ref}`);
    seen.add(s.$ref);
    const parts = s.$ref.replace(/^#\//, '').split('/');
    s = parts.reduce((o, k) => o?.[k], root);
  }
  return s;
}

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

function typeMatches(want, v) {
  const list = Array.isArray(want) ? want : [want];
  return list.some((t) => {
    if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
    if (t === 'number') return typeof v === 'number';
    return typeOf(v) === t;
  });
}

/**
 * Validate `value` against `schema`. Pushes `{ at, msg }` onto errors.
 * `at` is a JSON-pointer-ish path so a finding is actionable.
 */
function check(value, schema, root, at, errors) {
  const s = deref(schema, root);
  if (!s) return;

  // oneOf — discriminate on kind so errors are attributable.
  if (s.oneOf) {
    const branches = s.oneOf.map((b) => deref(b, root));
    const kind = value?.kind;
    if (typeof kind !== 'string') {
      errors.push({ at, msg: `expected an object with a "kind" (one of: ${branches.map((b) => b.properties?.kind?.const).filter(Boolean).join(', ')})` });
      return;
    }
    const branch = branches.find((b) => b.properties?.kind?.const === kind);
    if (!branch) {
      errors.push({ at, msg: `unknown kind "${kind}" — valid kinds here: ${branches.map((b) => b.properties?.kind?.const).filter(Boolean).join(', ')}` });
      return;
    }
    check(value, branch, root, at, errors);
    return;
  }

  if (s.type && !typeMatches(s.type, value)) {
    errors.push({ at, msg: `expected ${Array.isArray(s.type) ? s.type.join('|') : s.type}, got ${typeOf(value)}` });
    return;
  }
  if (s.const !== undefined && value !== s.const) {
    errors.push({ at, msg: `must be "${s.const}"` });
    return;
  }
  if (s.enum && !s.enum.includes(value)) {
    errors.push({ at, msg: `must be one of: ${s.enum.join(', ')} (got ${JSON.stringify(value)})` });
    return;
  }
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) {
      errors.push({ at, msg: `must not be empty` });
    }
    if (s.pattern && !new RegExp(s.pattern).test(value)) {
      errors.push({ at, msg: `"${value}" does not match ${s.pattern}${/[A-Z]/.test(value[0] ?? '') ? ' — looks PascalCase; entity properties are camelCase' : ''}` });
    }
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) errors.push({ at, msg: `must be >= ${s.minimum}` });
    if (s.maximum !== undefined && value > s.maximum) errors.push({ at, msg: `must be <= ${s.maximum}` });
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) {
      errors.push({ at, msg: `must have at least ${s.minItems} item(s)` });
    }
    if (s.items) value.forEach((v, i) => check(v, s.items, root, `${at}[${i}]`, errors));
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of s.required ?? []) {
      if (value[key] === undefined) {
        const hint = s.properties?.[key]?.description;
        errors.push({ at: `${at}.${key}`, msg: `is required${hint ? ` — ${hint.split('.')[0]}` : ''}` });
      }
    }
    if (s.additionalProperties === false && s.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in s.properties)) {
          const kind = value.kind ? ` on kind "${value.kind}"` : '';
          errors.push({ at: `${at}.${key}`, msg: `is not a valid property${kind} — it would be silently ignored` });
        }
      }
    }
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (value[key] !== undefined) check(value[key], sub, root, `${at}.${key}`, errors);
    }
  }
}

const CAPTURE_ARCHETYPES = new Set(['capture', 'modal-dialog', 'wizard']);

/** Invariants the schema cannot express. */
function structuralChecks(bp, errors) {
  const names = new Map();
  const props = new Set();
  let hasActions = false;

  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return;
    if (node.name) {
      if (names.has(node.name)) {
        errors.push({ at: `${at}.name`, msg: `duplicate node name "${node.name}" (also at ${names.get(node.name)}) — names become component names and must be unique in scope` });
      } else names.set(node.name, at);
    }
    if (node.kind === 'actions') hasActions = true;
    if ((node.kind === 'field' || node.kind === 'chip') && node.property) props.add(node.property);
    (node.children ?? []).forEach((c, i) => walk(c, `${at}.children[${i}]`));
  };
  walk(bp.layout, 'layout');

  if (Array.isArray(bp.bindings) && bp.bindings.length) {
    const bound = new Set(bp.bindings.map((b) => b?.property));
    for (const p of props) {
      if (!bound.has(p)) {
        errors.push({ at: 'bindings', msg: `layout binds "${p}" but bindings[] does not declare it — the compiler cannot resolve its datatype or component` });
      }
    }
  }

  if (CAPTURE_ARCHETYPES.has(bp.archetype) && !hasActions) {
    errors.push({ at: 'layout', msg: `archetype "${bp.archetype}" has no actions node — a capture screen needs a Submit and an explicit exit [R-006/R-007/R-020]` });
  }
}

export function validateBlueprint(bp, schema = loadSchema()) {
  const errors = [];
  check(bp, schema, schema, '', errors);
  if (!errors.length) structuralChecks(bp, errors);
  return errors;
}

// ---- CLI --------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/validate-blueprint.mjs <blueprint.json|blueprint.md>');
    process.exit(2);
  }
  let bp;
  try { bp = readBlueprint(file); } catch (e) {
    console.error(`cannot read blueprint: ${e.message}`);
    process.exit(2);
  }
  const errors = validateBlueprint(bp);
  if (!errors.length) {
    console.log(`blueprint OK — ${path.basename(file)} (screen "${bp.screen}", archetype ${bp.archetype})`);
    process.exit(0);
  }
  console.error(`blueprint INVALID — ${path.basename(file)}, ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ${e.at || '(root)'} ${e.msg}`);
  console.error('\nSchema: shesha-design-comprehension/schemas/blueprint.schema.json');
  console.error('Node grammar guidance: references/designing-like-react.md');
  process.exit(1);
}
