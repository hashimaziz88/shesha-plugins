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
//   5. re-serialise with recursively SORTED keys (D-078): key order is the
//
//      emitter's property and Q1 pins it; the comparator asserts content only
//
// What survives is structure, types, versions, bindings and appearance — which is
// precisely what the two programs are being asked to agree about.


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
    // The slot wrapper's own id is positional too: production slots carry nanoid
    // ids and the compiler stamps v5, so a raw comparison could never agree.
    if (typeof wrap.id === 'string') positions.set(wrap.id, `${position}#${key}`);
    const arr = wrap.components;
    if (!Array.isArray(arr)) continue;
    arr.forEach((child, i) => collect(child, `${position}#${key}.${i}`, positions));
  }
}


/**
 * An ownerRef action carries a node id as a VALUE, nested inside an action
 * config. It is name-derived on one arm and a nanoid on the other, so it too is
 * compared by position, at any depth.
 * @param {unknown} value
 * @param {Map<string, string>} positions
 * @returns {unknown}
 */
function deepOwner(value, positions) {
  if (Array.isArray(value)) return value.map((v) => deepOwner(v, positions));
  if (!isObj(value)) return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = k === 'actionOwner' && typeof v === 'string' && positions.has(v)
      ? /** @type {string} */ (positions.get(v))
      : deepOwner(v, positions);
  }
  return out;
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
    out[key] = deepOwner(value, positions);
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
    if (typeof wrap.id === 'string') w.id = `${position}#${key}`;
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
 * Recursively sorted keys: the comparator's total order (D-078). Key ORDER inside
 * markup is the emitter's property, and Q1 already pins the emitter's bytes; two
 * independent programs cannot be asked to agree on insertion order, only on
 * content. Sorting every object's keys makes byte equality of the normal form
 * exactly content equality, with no order escape hatch.
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isObj(value)) return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
  return out;
}

/**
 * Normal form of a `Markup` STRING, re-serialised canonically. This is the value
 * Q2 compares byte-for-byte.
 * @param {string} markupString
 * @returns {string}
 */
export function normalForm(markupString) {
  return JSON.stringify(sortKeysDeep(normalFormOf(JSON.parse(markupString))));
}
