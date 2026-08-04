#!/usr/bin/env node
// validate-blueprint.mjs <blueprint.json | blueprint.md> [--schema <path>]
//
// The runtime validator for the blueprint IR — the contract between
// comprehension (which authors blueprints) and shesha-form-edit's compiler
// (which accepts ONLY a blueprint as build input, "no spec, no build").
//
// TWO layers, and only two:
//
//   1. SCHEMA — a real JSON Schema (Draft 2020-12) validation of
//      schemas/blueprint.schema.json through Ajv. Every typed property, every
//      `additionalProperties: false`, every enum, every nested `items` shape and
//      every per-kind `if/then` is enforced because the SCHEMA says so. There is
//      no hand-rolled sample of checks here and no second copy of any enum.
//
//   2. SEMANTIC — only what a JSON Schema cannot express: parent context, a
//      cross-reference between a node and the bindings array, and authorability
//      against shesha-form-edit's component registry. Where a semantic check
//      needs vocabulary it READS IT OFF THE SCHEMA.
//
// A finding is STRUCTURED DATA, never a sentence:
//   { path, rule, actual, expected, message }
// `path` is a dotted/indexed instance path ("layout.children[0].intent.role") so a
// caller can route a fix; `rule` is a stable id so regressions can be counted.
//
// Library:  import { validateBlueprint, loadSchema, readBlueprint } from '.../validate-blueprint.mjs'
//           validateBlueprint(bp, schema) -> { findings: Finding[], nodeCount: number }
// CLI:      exit 0 clean · 1 invalid (findings printed) · 2 usage/IO error.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- ajv resolution ----------------------------------------------------------
// ONE node_modules tree in this plugin: shesha-form-edit's. It declares ajv as a
// dependency and owns the test/gate toolchain; this skill ships no node_modules of
// its own, so it resolves ajv from its sibling through createRequire anchored at
// that package.json. Both skills always ship together (the compiler already
// imports THIS file over the same relative path), so nothing is installed twice.
const FORM_EDIT_PKG = path.join(HERE, '..', '..', 'shesha-form-edit', 'package.json');
const siblingRequire = createRequire(FORM_EDIT_PKG);
const Ajv2020 = (() => {
  try {
    const mod = siblingRequire('ajv/dist/2020');
    return mod.default ?? mod;
  } catch (err) {
    throw new Error(
      `cannot resolve ajv from ${FORM_EDIT_PKG}: ${err.message}\n`
      + '  fix: cd ../shesha-form-edit && npm install   (ajv is a dependency of the form-edit skill; '
      + 'this skill deliberately ships no node_modules of its own)',
    );
  }
})();

/** Default schema location — sibling `schemas/` dir of this script's skill. */
export const DEFAULT_SCHEMA_PATH = path.join(HERE, '..', 'schemas', 'blueprint.schema.json');

/** shesha-form-edit's shape authority for what a component override may name. */
const REGISTRY_PATH = path.join(HERE, '..', '..', 'shesha-form-edit', 'assets', 'component-registry.json');

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

// ---- finding plumbing --------------------------------------------------------

/** JSON Pointer ("/layout/children/0/columns") → routable path ("layout.children[0].columns"). */
function toPath(pointer) {
  const parts = String(pointer ?? '').split('/').filter((p) => p !== '');
  let out = '';
  for (const raw of parts) {
    const tok = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(tok)) out += `[${tok}]`;
    else out += out ? `.${tok}` : tok;
  }
  return out;
}

const join = (base, key) => (base ? `${base}.${key}` : key);

/** value at a JSON Pointer, for the `actual` half of a finding */
function valueAt(root, pointer) {
  let cur = root;
  for (const raw of String(pointer ?? '').split('/').filter((p) => p !== '')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

/** a value shortened for a message / `actual` field — a whole subtree is noise */
function brief(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return `[array of ${v.length}]`;
  const keys = Object.keys(v);
  return `{object: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''}}`;
}

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const finding = (p, rule, actual, expected, message) => ({ path: p, rule, actual, expected, message });

/** Ajv keyword → stable rule id. The keyword IS the taxonomy; no second list of checks. */
const RULE_BY_KEYWORD = {
  additionalProperties: 'unknown-property',
  required: 'missing-property',
  type: 'wrong-type',
  enum: 'not-in-enum',
  const: 'wrong-const',
  minLength: 'empty-string',
  minItems: 'empty-array',
  maxItems: 'too-many-items',
  minimum: 'out-of-range',
  maximum: 'out-of-range',
  exclusiveMinimum: 'out-of-range',
  exclusiveMaximum: 'out-of-range',
  pattern: 'bad-format',
  format: 'bad-format',
};

/** one Ajv error → one structured finding */
function fromAjvError(err, bp) {
  const at = toPath(err.instancePath);
  const rule = RULE_BY_KEYWORD[err.keyword] ?? `schema-${err.keyword}`;
  const raw = valueAt(bp, err.instancePath);

  if (err.keyword === 'additionalProperties') {
    const key = err.params.additionalProperty;
    return finding(join(at, key), rule,
      brief(valueAt(bp, `${err.instancePath}/${key}`)),
      'not present (this object declares additionalProperties:false)',
      `unknown property "${key}"${at ? ` on ${at}` : ' at the blueprint root'} — the compiler would silently ignore it, so the schema rejects it`);
  }
  if (err.keyword === 'required') {
    const key = err.params.missingProperty;
    const where = at || 'the blueprint root';
    return finding(at, rule, `missing "${key}"`, `"${key}" present`,
      `${where} is missing required property "${key}"`);
  }
  if (err.keyword === 'type') {
    const want = Array.isArray(err.params.type) ? err.params.type.join(' or ') : err.params.type;
    return finding(at, rule, typeName(raw), err.params.type,
      `${at} must be ${want}, got ${typeName(raw)} (${JSON.stringify(brief(raw))})`);
  }
  if (err.keyword === 'enum') {
    return finding(at, rule, brief(raw), err.params.allowedValues,
      `${at}: ${JSON.stringify(brief(raw))} is not in the schema enum (${err.params.allowedValues.join(' | ')})`);
  }
  return finding(at, rule, brief(raw), err.params ?? err.schema ?? null,
    `${at || 'the blueprint root'} ${err.message}`.trim());
}

// ---- semantic layer ----------------------------------------------------------
// ONLY what the schema cannot express. Vocabulary is read off the schema, never
// re-declared here.

/** the component types shesha-form-edit can actually author; null = registry unavailable */
function loadRegistryTypes() {
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8').replace(/^﻿/, ''));
    const names = Object.keys(reg?.components ?? {});
    return names.length ? new Set(names) : null;
  } catch {
    return null;   // the registry says what EXISTS; a gap in it must never invent a finding
  }
}

/**
 * Walk the layout tree carrying the parent chain — the whole reason a semantic
 * layer exists at all. Yields {node, path, parent} for every object node.
 */
function* walkLayout(root, at = 'layout', parent = null) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return;
  yield { node: root, path: at, parent };
  const kids = root.children;
  if (!Array.isArray(kids)) return;
  for (const [i, child] of kids.entries()) yield* walkLayout(child, `${at}.children[${i}]`, root);
}

function semanticFindings(bp, schema) {
  const out = [];
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) return out;

  const nodeProps = schema?.$defs?.node?.properties ?? {};
  const intentRoles = schema?.$defs?.intent?.properties?.role?.enum ?? [];
  const buttonTypes = nodeProps.buttonType?.enum ?? [];
  const registry = loadRegistryTypes();

  // bindings, indexed by property — the cross-reference a schema cannot follow
  const bindings = new Map();
  if (Array.isArray(bp.bindings)) {
    for (const b of bp.bindings) {
      if (b && typeof b === 'object' && typeof b.property === 'string') bindings.set(b.property, b);
    }
  }
  const hasReferenceList = (prop) => {
    const b = bindings.get(prop);
    if (!b) return false;
    return Boolean(b.referenceList?.name) || /reference-?list/i.test(String(b.datatype ?? ''));
  };

  const label = (n) => n.name ?? n.property ?? n.kind;

  for (const { node, path: at, parent } of walkLayout(bp.layout)) {
    const kind = node.kind;

    // 1. heading content — a heading with nothing to say compiles to an empty text node
    if (kind === 'heading' && !String(node.content ?? node.title ?? '').trim()) {
      out.push(finding(at, 'heading-without-content', null, 'content (or title) with text',
        'a heading node must carry `content` (or `title`) — an empty heading compiles to an invisible text component'));
    }

    // 2. parent context: a tab is only meaningful inside a tabs container
    if (kind === 'tab' && parent?.kind !== 'tabs') {
      out.push(finding(at, 'tab-outside-tabs', parent ? `child of ${parent.kind}` : 'the layout root',
        'child of a tabs node',
        `a "tab" node may only be a child of a "tabs" container; this one is ${parent ? `a child of "${label(parent)}" (${parent.kind})` : 'the layout root'}. The renderer reads tabs from the tabs slot, so an orphan tab never renders.`));
    }
    // and a tabs container holds tabs, nothing else
    if (kind === 'tabs') {
      for (const [i, c] of (Array.isArray(node.children) ? node.children : []).entries()) {
        if (c && typeof c === 'object' && c.kind !== 'tab') {
          out.push(finding(`${at}.children[${i}]`, 'tabs-child-not-tab', c.kind, 'tab',
            `a "tabs" container may only hold "tab" children; "${label(c)}" is a ${c.kind} and would be dropped by the renderer`));
        }
      }
    }

    // 3. intent.role = status needs a reference-list identity to become a chip [R-015/R-036]
    if (node.intent?.role === 'status') {
      const prop = node.property;
      if (!prop) {
        out.push(finding(`${at}.intent.role`, 'status-intent-without-binding', 'no `property` on the node',
          'a `property` bound to a reference-list',
          'intent.role "status" compiles to the lifecycle chip carrier, which needs a bound property — this node binds nothing'));
      } else if (!hasReferenceList(prop)) {
        out.push(finding(`${at}.intent.role`, 'status-intent-without-binding',
          `property "${prop}" has no reference-list binding`,
          `a bindings[] entry for "${prop}" carrying referenceList.name (or a reference-list datatype)`,
          `intent.role "status" on "${prop}" has no reference-list identity in bindings[] — the chip would ship unidentified and render empty [R-015/R-036]`));
      }
    }
    // the role vocabulary itself is the schema's job; this only pins that the schema HAS one
    if (node.intent?.role !== undefined && intentRoles.length === 0) {
      out.push(finding(`${at}.intent.role`, 'schema-too-old', 'the schema declares no intent roles',
        '$defs.intent.properties.role.enum',
        'the schema carries no intent role vocabulary — it predates the semantic intent IR'));
    }

    // 4. an action zone holds BUTTONS, each captioned, with at most one primary [R-007]
    if (kind === 'actions' || kind === 'buttonGroup') {
      const kids = Array.isArray(node.children) ? node.children : [];
      let primaries = 0;
      for (const [i, c] of kids.entries()) {
        if (!c || typeof c !== 'object') continue;   // the schema already reported this child
        const childAt = `${at}.children[${i}]`;
        if (c.kind !== 'chip') {
          out.push(finding(childAt, 'action-child-not-a-button', c.kind, 'chip (the button-spec carrier)',
            `an action zone compiles to a buttonGroup, so every child must be a button spec ("chip"); "${label(c)}" is a ${c.kind}`));
          continue;
        }
        if (!String(c.title ?? c.content ?? c.name ?? '').trim()) {
          out.push(finding(childAt, 'button-without-caption', null, 'title (or content, or name)',
            'a button with no caption cannot be labelled, and its action cannot be inferred from a caption either'));
        }
        if (c.buttonType === 'primary') primaries++;
      }
      if (primaries > 1) {
        out.push(finding(at, 'multiple-primary-buttons', primaries, 'at most 1',
          `${primaries} children declare buttonType "primary" — exactly one primary per action zone [R-007] (valid types: ${buttonTypes.join(' | ')})`));
      }
    }

    // 5. an explicit component override must be something form-edit can author
    if (typeof node.component === 'string' && registry && !registry.has(node.component)) {
      out.push(finding(`${at}.component`, 'component-not-authorable', node.component,
        'a component type listed in shesha-form-edit/assets/component-registry.json',
        `component "${node.component}" is not in the component registry — it cannot be authored, so the compiler would emit markup the renderer does not know`));
    }
  }

  // 6. art direction is INTENT, in words — never an implementation value.
  // The same tokens-only rule the whole IR lives under (see the schema's root $comment): a
  // blueprint says what a node MEANS, and a raw colour or a pixel literal skips the theme
  // entirely, so the value cannot be re-branded and the next theme cannot restate it.
  if (bp.artDirection && typeof bp.artDirection === 'object' && !Array.isArray(bp.artDirection)) {
    const strings = [];
    for (const [key, v] of Object.entries(bp.artDirection)) {
      if (typeof v === 'string') strings.push([key, v]);
      else if (Array.isArray(v)) v.forEach((s, i) => { if (typeof s === 'string') strings.push([`${key}[${i}]`, s]); });
    }
    for (const [where, text] of strings) {
      const hex = text.match(/#[0-9a-fA-F]{3,8}\b/);
      if (hex) {
        out.push(finding(`artDirection.${where}`, 'art-direction-names-a-literal', hex[0], 'the intent in words',
          `artDirection names the raw colour ${hex[0]} — art direction is a JUDGMENT input, so it describes the intent ("brand reserved for interactive affordances") and the THEME owns the value. A hex here cannot be re-branded.`));
      }
      const px = text.match(/\b\d+(\.\d+)?\s?px\b/i);
      if (px) {
        out.push(finding(`artDirection.${where}`, 'art-direction-names-a-literal', px[0], 'the intent in words',
          `artDirection names the pixel literal ${px[0]} — describe the relationship ("headings step well clear of body copy") and let the theme's type and spacing scales supply the number.`));
      }
    }
  }

  // bindings carry the same component override lever
  if (Array.isArray(bp.bindings)) {
    for (const [i, b] of bp.bindings.entries()) {
      if (b && typeof b === 'object' && typeof b.component === 'string' && registry && !registry.has(b.component)) {
        out.push(finding(`bindings[${i}].component`, 'component-not-authorable', b.component,
          'a component type listed in shesha-form-edit/assets/component-registry.json',
          `binding component "${b.component}" is not in the component registry — it cannot be authored`));
      }
    }
  }

  return out;
}

// ---- the validator -----------------------------------------------------------

let compiledFor = null;   // { schema, validate } — Ajv compiles the schema ONCE per process

function compile(schema) {
  if (compiledFor?.schema === schema) return compiledFor.validate;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  compiledFor = { schema, validate };
  return validate;
}

/**
 * Validate a blueprint object against the blueprint schema, then against the
 * semantic checks the schema cannot express. Never throws on a malformed
 * blueprint — every defect comes back as a structured finding.
 * @param {object} bp parsed blueprint
 * @param {object} schema parsed blueprint.schema.json
 * @returns {{findings: Array<{path:string,rule:string,actual:*,expected:*,message:string}>, nodeCount: number}}
 */
export function validateBlueprint(bp, schema) {
  if (!schema?.$defs?.node) {
    return {
      findings: [finding('', 'not-a-blueprint-schema', 'no $defs.node', '$defs.node',
        'the supplied schema has no $defs.node — it is not the blueprint schema')],
      nodeCount: 0,
    };
  }
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) {
    return {
      findings: [finding('', 'not-an-object', typeName(bp), 'object', 'the blueprint is not a JSON object')],
      nodeCount: 0,
    };
  }

  const validate = compile(schema);
  const findings = [];
  if (!validate(bp)) {
    for (const err of validate.errors ?? []) {
      // `if` is bookkeeping for a failed if/then branch — the branch's own error
      // already says what is wrong, at the same path
      if (err.keyword === 'if') continue;
      findings.push(fromAjvError(err, bp));
    }
  }
  findings.push(...semanticFindings(bp, schema));

  // one finding per (path, rule, message): a union type is reported through several branches
  const seen = new Set();
  const unique = findings.filter((f) => {
    const k = `${f.path} ${f.rule} ${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let nodeCount = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _n of walkLayout(bp.layout)) nodeCount++;
  return { findings: unique, nodeCount };
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
  const { findings, nodeCount } = validateBlueprint(bp, schema);
  if (findings.length) {
    console.error(`INVALID blueprint: ${file} — ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  FAIL [${f.rule}] ${f.path || '(root)'} — ${f.message}`);
    process.exit(1);
  }
  console.log(`OK ${file} — valid blueprint IR (${nodeCount} layout node${nodeCount === 1 ? '' : 's'})`);
  process.exit(0);
}
