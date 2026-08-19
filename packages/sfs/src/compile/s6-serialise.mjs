// Stage 6: identified tree -> {Markup, envelope} plus the compile report.
//
// This is the only place in the repo that turns a tree into form bytes. Everything
// before it is in-memory, which is what makes "no file is written when a stage raises"
// true by construction rather than by discipline: stage 6 is simply unreachable.
//
// `DateUpdated` is always null on write. It is server-owned, and writing a value would
// introduce a clock into a function that must be pure (section 2.4.3).

import { createHash } from 'node:crypto';
import { orderedStringify, orderNode } from '../lib/orderedJson.mjs';
import { SfsError } from './s1-parse.mjs';

/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */
/** @typedef {import('./s2-resolve.mjs').Diagnostic} Diagnostic */

/** The 23 envelope fields, in the measured production order. */
export const ENVELOPE_FIELDS = [
  'Markup', 'ModelType', 'TemplateId', 'IsTemplate', 'Access', 'Permissions',
  'ConfigurationForm', 'GenerationLogicTypeName', 'GenerationLogicExtensionJson',
  'PlaceholderIcon', 'Id', 'OriginId', 'Name', 'Label', 'ItemType', 'Description',
  'ModuleName', 'FrontEndApplication', 'Suppress', 'DateUpdated', 'BaseModules',
  'Comments', 'ConfigHash',
];

/** Compiler-internal keys that must never reach the output. */
const INTERNAL = /^_/;

/**
 * Strip every compiler-internal key. A leaked `_sfsPath` would be a real defect: it
 * would make the markup carry the author's directory structure.
 * @param {unknown} value
 * @returns {unknown}
 */
function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (value === null || typeof value !== 'object') return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    // '_type' is a MEASURED production key on every action config, not a
    // compiler-internal marker; it is the one underscore key that ships.
    if (INTERNAL.test(key) && key !== '_type') continue;
    out[key] = stripInternal(v);
  }
  return out;
}

/**
 * Every emitted `_code` goes through `new Function` before it can ship. A syntactically
 * broken script body is SER-6201 here rather than a blank screen at runtime.
 * @param {unknown} value
 * @param {string} where
 * @returns {void}
 */
function checkCode(value, where) {
  if (Array.isArray(value)) { value.forEach((v, i) => checkCode(v, `${where}[${i}]`)); return; }
  if (value === null || typeof value !== 'object') return;
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (obj._mode === 'code' && typeof obj._code === 'string') {
    try {
      // eslint-disable-next-line no-new-func
      new Function(obj._code);
    } catch (e) {
      throw new SfsError('SER-6201',
        `SER-6201 emitted _code at ${where} does not parse: ${/** @type {Error} */ (e).message}`, where);
    }
  }
  for (const [key, v] of Object.entries(obj)) checkCode(v, `${where}.${key}`);
}

/** @param {string} s @returns {string} */
function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

/**
 * @param {{components:Record<string, unknown>[], formSettings:Record<string, unknown>, doc:SfsDoc, nodes:any[]}} tree
 * @param {{registry:import('../lib/registry.mjs').Registry, sfsSha256:string, escapes:any[], diagnostics:Diagnostic[]}} ctx
 * @returns {{markup:string, envelope:Record<string, unknown>, report:Record<string, unknown>, meta:Record<string, unknown>}}
 */
export function serialise(tree, ctx) {
  const doc = tree.doc;
  const components = /** @type {unknown[]} */ (stripInternal(tree.components));
  const formSettings = /** @type {Record<string, unknown>} */ (stripInternal(tree.formSettings));

  checkCode(components, 'components');

  // Markup is the canonical stringify of exactly {components, formSettings}. formSettings
  // keeps its own declared order, so it is stringified separately and spliced, because
  // orderNode's key order is the NODE order and would reject its keys as unlisted.
  const orderedComponents = orderNode(components, 'components');
  const markup = JSON.stringify({ components: orderedComponents, formSettings });

  const ACCESS = { inherited: 1, anonymous: 2, authenticated: 4 };
  const access = ACCESS[/** @type {keyof typeof ACCESS} */ (doc.access || 'authenticated')];

  /** @type {Record<string, unknown>} */
  const envelope = {
    Markup: markup,
    ModelType: doc.entity ?? null,
    TemplateId: null,
    IsTemplate: false,
    // Mirrored from formSettings.access: two fields, one value, so they cannot disagree.
    Access: access,
    Permissions: doc.permissions ?? [],
    ConfigurationForm: null,
    GenerationLogicTypeName: null,
    GenerationLogicExtensionJson: null,
    PlaceholderIcon: null,
    // Id and OriginId are identical by construction and are the caller's to assign on
    // a real push; the compiler never invents one, because that would need randomness.
    Id: null,
    OriginId: null,
    Name: doc.form,
    Label: doc.label,
    ItemType: 'form',
    Description: doc.description ?? null,
    ModuleName: doc.module,
    FrontEndApplication: null,
    Suppress: false,
    DateUpdated: null,
    BaseModules: [],
    Comments: null,
    ConfigHash: '',
  };

  const missing = ENVELOPE_FIELDS.filter((f) => !Object.hasOwn(envelope, f));
  const extra = Object.keys(envelope).filter((f) => !ENVELOPE_FIELDS.includes(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new SfsError('SER-6101',
      `SER-6101 envelope shape is wrong: missing ${missing.join(', ') || 'none'}, unexpected ${extra.join(', ') || 'none'}`);
  }

  // Counts are DERIVED from the tree, never tallied by hand while building it.
  const counts = countOf(tree);
  /** @type {Record<string, unknown>} */
  const report = {
    form: `${doc.module}/${doc.form}`,
    verdict: 'pass',
    exit: 0,
    sfsSha256: ctx.sfsSha256,
    registryRef: ctx.registry.ref,
    brand: doc.brand ?? 'shesha',
    markupSha256: sha256(markup),
    markupBytes: Buffer.byteLength(markup, 'utf8'),
    counts,
    escapes: ctx.escapes,
    diagnostics: ctx.diagnostics,
  };

  const meta = {
    form: `${doc.module}/${doc.form}`,
    kind: doc.kind,
    nodes: tree.nodes.map((n) => ({ id: n.id, sfsPath: n.sfsPath, name: n.name, type: n.type })),
  };

  return { markup, envelope, report, meta };
}

/**
 * A1's summands, each computed by walking the emitted tree once.
 * @param {{components:Record<string, unknown>[], nodes:any[]}} tree
 * @returns {Record<string, number>}
 */
export function countOf(tree) {
  let components = 0;
  let slots = 0;
  let items = 0;
  let breakpointBlocks = 0;
  let columns = 0;
  let actions = 0;
  /** @type {Set<string>} */
  const typeVersions = new Set();
  /** @type {Set<string>} */
  const types = new Set();

  /** @param {Record<string, unknown>} n @returns {void} */
  const walk = (n) => {
    components += 1;
    types.add(String(n.type));
    typeVersions.add(`${String(n.type)}@${String(n.version)}`);
    for (const bp of ['desktop', 'tablet', 'mobile']) if (n[bp] !== undefined) breakpointBlocks += 1;
    for (const slot of ['content', 'header']) {
      const w = /** @type {Record<string, unknown>|undefined} */ (n[slot]);
      if (w === undefined || w === null || typeof w !== 'object' || w.id === undefined) continue;
      slots += 1;
      for (const kid of /** @type {Record<string, unknown>[]} */ (w.components || [])) walk(kid);
    }
    if (Array.isArray(n.items)) {
      items += n.items.length;
      if (n.type === 'buttonGroup') actions += n.items.length;
      else columns += n.items.length;
    }
    if (Array.isArray(n.components)) for (const kid of n.components) walk(/** @type {Record<string, unknown>} */ (kid));
  };
  for (const root of tree.components) walk(root);

  return {
    components,
    slots,
    items,
    ids: tree.nodes.length,
    breakpointBlocks,
    styledComponents: breakpointBlocks / 3,
    versionsStamped: components,
    distinctTypes: types.size,
    distinctTypeVersions: typeVersions.size,
    columns,
    actions,
  };
}

/** Re-exported so callers do not reach into orderedJson for the one call they need. */
export { orderedStringify };
