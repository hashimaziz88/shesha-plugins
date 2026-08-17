// The name-independent comparison used by Q2 and by §2.4.5's P3 (D-074).
//
// Q1 is the only byte-equality property whose subject is raw markup, because its
// subject is the compiler's own output. Q2 compares two DIFFERENT programs, and
// every id is a hash of an author-chosen name, so raw bytes can never agree. Normal
// form removes exactly the name-derived information and nothing else:
//
//   1. parse
//   2. every `id` becomes its tree position ("0.2.1", slots "0.2.1#content", items "0.2.1#item:3")
//   3. every `parentId` becomes the position of the node it points at, or "root"
//   4. `componentName` is deleted (section 2.5 step 7 drops it)
//   5. re-serialise through orderedStringify
//
// What survives is structure, types, versions, bindings and appearance — which is
// precisely what the two programs are being asked to agree about.

import { orderedStringify } from './orderedJson.mjs';

/** Arrays whose entries are positioned children. */
const CHILD_ARRAYS = ['components', 'items', 'tabs', 'columns'];
/** Objects that wrap a `components` array. */
const CHILD_WRAPPERS = ['content', 'header'];

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/**
 * Walk the tree assigning each node its position, and record id -> position.
 * @param {unknown} node
 * @param {string} position
 * @param {Map<string, string>} positions
 * @returns {void}
 */
function collect(node, position, positions) {
  if (!isObj(node)) return;
  if (typeof node.id === 'string') positions.set(node.id, position);

  for (const key of CHILD_ARRAYS) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    const marker = key === 'items' ? '#item:' : key === 'columns' ? '#col:' : '.';
    arr.forEach((child, i) => {
      collect(child, marker === '.' ? `${position}.${i}` : `${position}${marker}${i}`, positions);
    });
  }
  for (const key of CHILD_WRAPPERS) {
    const wrap = node[key];
    if (!isObj(wrap)) continue;
    const arr = wrap.components;
    if (!Array.isArray(arr)) continue;
    arr.forEach((child, i) => collect(child, `${position}#${key}.${i}`, positions));
  }
}

/**
 * @param {unknown} node
 * @param {string} position
 * @param {Map<string, string>} positions
 * @returns {unknown}
 */
function rewrite(node, position, positions) {
  if (Array.isArray(node)) return node.map((n, i) => rewrite(n, `${position}.${i}`, positions));
  if (!isObj(node)) return node;

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'componentName') continue;                       // step 4
    if (key === 'id' && typeof value === 'string') { out.id = position; continue; }
    if (key === 'parentId') {
      out.parentId = typeof value === 'string' && positions.has(value)
        ? /** @type {string} */ (positions.get(value))
        : 'root';
      continue;
    }
    out[key] = value;
  }

  for (const key of CHILD_ARRAYS) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    const marker = key === 'items' ? '#item:' : key === 'columns' ? '#col:' : '.';
    out[key] = arr.map((child, i) => rewrite(
      child, marker === '.' ? `${position}.${i}` : `${position}${marker}${i}`, positions));
  }
  for (const key of CHILD_WRAPPERS) {
    const wrap = node[key];
    if (!isObj(wrap)) continue;
    /** @type {Record<string, unknown>} */
    const w = { ...wrap };
    if (Array.isArray(wrap.components)) {
      w.components = wrap.components.map((child, i) => rewrite(child, `${position}#${key}.${i}`, positions));
    }
    out[key] = w;
  }
  return out;
}

/**
 * @typedef {{components:unknown[], formSettings?:Record<string, unknown>}} Markup
 */

/**
 * Normal form of a parsed markup object.
 * @param {Markup} markup
 * @returns {Markup}
 */
export function normalFormOf(markup) {
  /** @type {Map<string, string>} */
  const positions = new Map();
  (markup.components || []).forEach((c, i) => collect(c, String(i), positions));
  const components = (markup.components || []).map((c, i) => rewrite(c, String(i), positions));
  return markup.formSettings === undefined
    ? { components: /** @type {unknown[]} */ (components) }
    : { components: /** @type {unknown[]} */ (components), formSettings: markup.formSettings };
}

/**
 * Normal form of a `Markup` STRING, re-serialised canonically. This is the value
 * Q2 compares byte-for-byte.
 * @param {string} markupString
 * @returns {string}
 */
export function normalForm(markupString) {
  return orderedStringify(normalFormOf(JSON.parse(markupString)));
}
