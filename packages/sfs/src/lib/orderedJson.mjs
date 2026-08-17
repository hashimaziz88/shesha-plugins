// Canonical key order (§2.4.4). Never call JSON.stringify on a node directly.
//
// Byte-equality is the whole point of Q1 and Q2, and two programs cannot agree on
// bytes unless they agree on key order. The order lists below are therefore data,
// not convention, and an unlisted key is SER-6102 rather than an alphabetical tail:
// an unlisted key means the registry is incomplete, and that must fail loudly.

/** Node key order. Type-specific props sit between `isDynamic` and `editMode`. */
export const NODE_KEY_ORDER = [
  'id', 'type', 'version', 'propertyName', 'componentName', 'label', 'hideLabel', 'labelAlign',
  'hidden', 'isDynamic', '<type-specific>',
  'editMode', 'enableStyleOnReadonly', 'desktop', 'tablet', 'mobile',
  'items', 'tabs', 'content', 'header', 'components', 'parentId',
];

export const BLOCK_KEY_ORDER = [
  'display', 'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
  'font', 'background', 'border', 'shadow', 'dimensions', 'stylingBox',
  'enableStyleOnReadonly', 'className',
];

export const DIMENSIONS_KEY_ORDER = ['width', 'height', 'minHeight', 'maxHeight', 'minWidth', 'maxWidth'];

export const STYLINGBOX_KEY_ORDER = [
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
];

/** The three breakpoint blocks, in emission order. */
export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

export class KeyOrderError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'KeyOrderError'; this.code = 'SER-6102'; }
}

/**
 * Reorder one object's own keys against a declared order.
 *
 * `<type-specific>` is a placeholder slot: any key not otherwise listed lands
 * there, in the order the caller supplied it, which is the registry's declaration
 * order. That is the one controlled exception to "unlisted keys fail".
 * @param {Record<string, unknown>} obj
 * @param {string[]} order
 * @param {{allowExtra?:boolean, where?:string}} [opts]
 * @returns {Record<string, unknown>}
 */
export function orderKeys(obj, order, opts = {}) {
  const slot = order.indexOf('<type-specific>');
  const listed = new Set(order.filter((k) => k !== '<type-specific>'));
  const extra = Object.keys(obj).filter((k) => !listed.has(k));

  if (extra.length > 0 && slot < 0 && opts.allowExtra !== true) {
    throw new KeyOrderError(
      `SER-6102 unlisted key(s) ${extra.join(', ')}${opts.where ? ` at ${opts.where}` : ''}. ` +
      'The order list has no alphabetical tail: an unlisted key means the registry is incomplete.');
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of order) {
    if (key === '<type-specific>') {
      for (const e of extra) out[e] = obj[e];
      continue;
    }
    if (Object.hasOwn(obj, key)) out[key] = obj[key];
  }
  // With no placeholder slot but allowExtra, extras keep their original order at the end.
  if (slot < 0 && opts.allowExtra === true) for (const e of extra) out[e] = obj[e];
  return out;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively impose canonical order on a component tree.
 * @param {unknown} value
 * @param {string} [where]
 * @returns {unknown}
 */
export function orderNode(value, where = '') {
  if (Array.isArray(value)) return value.map((v, i) => orderNode(v, `${where}[${i}]`));
  if (!isPlainObject(value)) return value;

  const obj = /** @type {Record<string, unknown>} */ (value);

  // A breakpoint block is recognised by position, not by shape, so the caller
  // reaches it through orderNode on a node and we handle it below.
  const ordered = orderKeys(obj, NODE_KEY_ORDER, { where });

  for (const bp of BREAKPOINTS) {
    if (!Object.hasOwn(ordered, bp)) continue;
    const block = ordered[bp];
    if (!isPlainObject(block)) continue;
    const b = orderKeys(/** @type {Record<string, unknown>} */ (block), BLOCK_KEY_ORDER, { where: `${where}.${bp}` });
    if (isPlainObject(b.dimensions)) {
      b.dimensions = orderKeys(/** @type {Record<string, unknown>} */ (b.dimensions), DIMENSIONS_KEY_ORDER,
        { where: `${where}.${bp}.dimensions` });
    }
    ordered[bp] = b;
  }

  for (const key of ['items', 'tabs', 'components']) {
    if (Array.isArray(ordered[key])) ordered[key] = orderNode(ordered[key], `${where}.${key}`);
  }
  for (const key of ['content', 'header']) {
    if (isPlainObject(ordered[key])) {
      const c = /** @type {Record<string, unknown>} */ (ordered[key]);
      if (Array.isArray(c.components)) c.components = orderNode(c.components, `${where}.${key}.components`);
      ordered[key] = c;
    }
  }
  return ordered;
}

/**
 * `stylingBox` is a JSON STRING inside markup, with no spaces and absent sides omitted.
 * @param {Record<string, number|string>} sides
 * @returns {string}
 */
export function stylingBoxString(sides) {
  /** @type {Record<string, number|string>} */
  const out = {};
  for (const key of STYLINGBOX_KEY_ORDER) if (Object.hasOwn(sides, key)) out[key] = sides[key];
  return JSON.stringify(out);
}

/**
 * The only serialiser the compiler may use for markup.
 * @param {unknown} value
 * @param {{pretty?:boolean}} [opts]
 * @returns {string}
 */
export function orderedStringify(value, opts = {}) {
  return JSON.stringify(orderNode(value), null, opts.pretty ? 2 : undefined);
}
