// Stage 1: bytes -> validated sfsDoc.
//
// Owns UTF-8 decode, JSON.parse with line/col, ajv validation, ajv-error -> domain
// error translation, sibling-name uniqueness, the `sfs` version gate, and the
// forbidden-key scan.
//
// The forbidden-key scan is the load-bearing one. `id`, `parentId`, `version`,
// `actionName`, `actionOwner` and `componentName` are all COMPILER OUTPUTS. An SFS
// document that names one is not a document with an extra field: it is a document
// trying to pin a value the compiler derives, which is how two sources of truth get
// created. So it is SFS-1003, not a warning.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';

// `ajv/dist/2020.js` is CJS. Node's ESM loader unwraps `default` to the class, but
// tsc types the default import as the module namespace, so the two disagree about
// what is constructable. Resolving it here once keeps the disagreement out of the
// call site and works whichever shape the loader hands over.
const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);

export class SfsError extends Error {
  /** @param {string} code @param {string} m @param {string} [where] */
  constructor(code, m, where) {
    super(m);
    this.name = 'SfsError';
    this.code = code;
    this.where = where || '';
  }
}

/** The six keys an SFS document may never contain, at any depth (SFS-1003). */
export const FORBIDDEN_KEYS = ['id', 'parentId', 'version', 'actionName', 'actionOwner', 'componentName'];

/** The one `sfs` value this compiler accepts. */
export const SFS_VERSION = '1.0';

/** @returns {string} the schema's absolute path */
function schemaPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'sfs.schema.json');
}

/** @type {{validate:import('ajv').ValidateFunction, sha:string}|null} */
let compiled = null;

/**
 * ajv compilation is expensive and the schema never changes within a process, so it
 * is compiled once. This is a pure memo — no I/O per node, and no state that could
 * make two compiles in one process differ.
 * @returns {{validate:import('ajv').ValidateFunction}}
 */
export function validator() {
  if (compiled !== null) return compiled;
  const text = fs.readFileSync(schemaPath(), 'utf8').replace(/^﻿/, '');
  const schema = JSON.parse(text);
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  compiled = { validate: ajv.compile(schema), sha: '' };
  return compiled;
}

/**
 * Report the line and column of a JSON.parse failure, which `JSON.parse` gives only
 * as a character offset. A parse error with no location is unactionable on a
 * 1,400-byte file and useless on a 700 KB one.
 * @param {string} text
 * @param {number} pos
 * @returns {string}
 */
function lineCol(text, pos) {
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `line ${line}, column ${col}`;
}

/**
 * Keys whose VALUE is a map of data, not a map of SFS keys. `openDialog` args and
 * `navigate` query parameters are named by the target form, so `args: {id: ...}` is
 * a parameter called `id` and not the SFS `id` key — the forbidden scan has to stop
 * at these or it fires on correct documents.
 */
const DATA_VALUED = new Set(['props', 'args', 'relay', 'const']);

/**
 * Walk every object in the document, collecting forbidden keys and duplicate
 * sibling names. One walk, because two walks over the same tree is two chances to
 * disagree about what a sibling is.
 * @param {unknown} node
 * @param {string} where
 * @param {{forbidden:{key:string, where:string}[], dupes:{name:string, where:string}[]}} acc
 * @param {boolean} [inData] true once the walk is inside a DATA_VALUED subtree
 * @returns {void}
 */
function scan(node, where, acc, inData = false) {
  if (Array.isArray(node)) {
    // Siblings are the entries of a `children`/`items`/`tabs`/`bands` array.
    /** @type {Map<string, number>} */
    const names = new Map();
    node.forEach((child, i) => {
      if (!inData && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        const name = /** @type {Record<string, unknown>} */ (child).name;
        if (typeof name === 'string') {
          if (names.has(name)) acc.dupes.push({ name, where: `${where}[${i}]` });
          else names.set(name, i);
        }
      }
      scan(child, `${where}[${i}]`, acc, inData);
    });
    return;
  }
  if (node === null || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (!inData && FORBIDDEN_KEYS.includes(key)) {
      acc.forbidden.push({ key, where: `${where}.${key}` });
    }
    // `raw.props` keys are already constrained by the schema's propertyNames, so a
    // forged id cannot hide in there either.
    scan(value, `${where}.${key}`, acc, inData || DATA_VALUED.has(key));
  }
}

/**
 * @typedef {{sfs:string, form:string, module:string, kind:string, entity?:string,
 *            label:string, description?:string, access?:string, permissions?:string[],
 *            brand?:string, submits?:boolean, page?:{title:string, subtitle?:string},
 *            hooks?:Record<string, string>, body:Record<string, unknown>[],
 *            raw?:Record<string, unknown>}} SfsDoc
 */

/**
 * @param {string} text raw SFS bytes, already UTF-8 decoded
 * @param {string} [source] a path, for error messages only — never for output
 * @returns {{doc:SfsDoc, diagnostics:{severity:string, code:string, message:string}[]}}
 */
export function parse(text, source = '<input>') {
  /** @type {{severity:string, code:string, message:string}[]} */
  const diagnostics = [];

  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    const at = /position (\d+)/.exec(msg);
    const loc = at ? ` at ${lineCol(text, Number(at[1]))}` : '';
    throw new SfsError('SFS-1000', `SFS-1000 ${source} is not valid JSON${loc}: ${msg}`, source);
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SfsError('SFS-1000', `SFS-1000 ${source} must be a JSON object`, source);
  }
  const obj = /** @type {Record<string, unknown>} */ (doc);

  // The version gate runs BEFORE the schema, so a future document gets "wrong
  // version" rather than forty confusing schema violations.
  if (obj.sfs !== SFS_VERSION) {
    throw new SfsError('SFS-1001',
      `SFS-1001 ${source} declares sfs "${String(obj.sfs)}"; this compiler accepts "${SFS_VERSION}" only`, source);
  }

  const acc = { forbidden: /** @type {{key:string, where:string}[]} */ ([]), dupes: /** @type {{name:string, where:string}[]} */ ([]) };
  scan(obj, '$', acc);

  if (acc.forbidden.length > 0) {
    const list = acc.forbidden.map((f) => `${f.where}`).join(', ');
    throw new SfsError('SFS-1003',
      `SFS-1003 ${source} names ${acc.forbidden.length} compiler-owned key(s): ${list}. `
      + `${FORBIDDEN_KEYS.join(', ')} are all derived by the compiler; naming one creates a second source of truth`,
      source);
  }
  if (acc.dupes.length > 0) {
    const list = acc.dupes.map((d) => `"${d.name}" at ${d.where}`).join(', ');
    throw new SfsError('SFS-1005',
      `SFS-1005 duplicate sibling name(s) in ${source}: ${list}. `
      + 'A name is the path segment every id is derived from, so siblings cannot share one', source);
  }

  const { validate } = validator();
  if (!validate(obj)) {
    // One diagnostic per instancePath, deduped: ajv reports every branch of a oneOf,
    // and a fifteen-error cascade from one bad key is noise, not information.
    /** @type {Map<string, string>} */
    const byPath = new Map();
    for (const err of validate.errors || []) {
      const at = err.instancePath || '$';
      if (byPath.has(at)) continue;
      byPath.set(at, `${err.message || 'is invalid'}${err.params && Object.keys(err.params).length > 0 ? ` (${JSON.stringify(err.params)})` : ''}`);
    }
    const lines = [...byPath.entries()].slice(0, 12).map(([at, msg]) => `  ${at} ${msg}`);
    throw new SfsError('SFS-1101',
      `SFS-1101 ${source} violates sfs.schema.json in ${byPath.size} place(s):\n${lines.join('\n')}`, source);
  }

  return { doc: /** @type {SfsDoc} */ (/** @type {unknown} */ (obj)), diagnostics };
}
