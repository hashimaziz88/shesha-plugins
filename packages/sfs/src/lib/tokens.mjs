// Token resolution (section 2.1.8). Five prefixes, each with its own failure code,
// and a literal colour anywhere under `style` is TOK-2010.
//
// Resolution happens at COMPILE TIME, per run, per brand. That is the whole reason
// literal colours can be banned outright rather than tolerated: there is no build
// step to bake them at, so there is no reason to allow one.

/** @typedef {import('./registry.mjs').Registry} Registry */

export class TokenError extends Error {
  /** @param {string} code @param {string} m */
  constructor(code, m) { super(m); this.name = 'TokenError'; this.code = code; }
}

/**
 * A bare word matches only when it is a CSS named colour, so `align: "left"` and
 * `weight: "semibold"` are not mistaken for colours. Applied to every string under
 * `style` at any depth.
 */
export const LITERAL_COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/** The 16 CSS named colours that are also plausible token names, plus the keywords. */
const NAMED_COLOURS = new Set([
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple', 'fuchsia',
  'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'orange',
  'transparent', 'currentcolor',
]);

/** Which prefix reports which code. */
const CODES = { role: 'TOK-2001', type: 'TOK-2002', space: 'TOK-2003', radius: 'TOK-2004', shadow: 'TOK-2005' };

/**
 * @param {unknown} obj
 * @param {string} dotted
 * @returns {unknown}
 */
function at(obj, dotted) {
  /** @type {unknown} */
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[seg];
  }
  return cur;
}

/**
 * Resolve one `$prefix:name` reference to a literal.
 * @param {Registry} reg
 * @param {string} ref
 * @param {string} where the SFS path, for the error message
 * @returns {unknown}
 */
export function resolveToken(reg, ref, where) {
  const m = /^\$(role|type|space|radius|shadow):([A-Za-z0-9_.-]+)$/.exec(ref);
  if (m === null) {
    throw new TokenError('TOK-2000', `TOK-2000 "${ref}" at ${where} is not a token reference; the five prefixes are $role: $type: $space: $radius: $shadow:`);
  }
  const [, prefix, name] = m;
  const code = CODES[/** @type {keyof typeof CODES} */ (prefix)];

  if (prefix === 'role') {
    const target = reg.roles.roles[name];
    if (typeof target !== 'string') {
      throw new TokenError(code, `${code} unresolved $role:${name} at ${where}; add a role to tokens/roles.json`);
    }
    const value = at(reg.tokens, target);
    if (value === undefined) {
      throw new TokenError(code, `${code} role "${name}" points at "${target}", which the brand file has no value for`);
    }
    return value;
  }

  if (prefix === 'type') {
    for (const group of ['scale', 'weights']) {
      const value = at(reg.tokens.type, `${group}.${name}`);
      if (value !== undefined) return value;
    }
    if (name === 'family') return reg.tokens.type.family;
    throw new TokenError(code, `${code} unresolved $type:${name} at ${where}; it is in neither type.scale nor type.weights`);
  }

  const group = { space: 'spacing', radius: 'radius', shadow: 'shadow' }[prefix];
  const value = at(reg.tokens, `${group}.${name}`);
  if (value === undefined) {
    throw new TokenError(code, `${code} unresolved $${prefix}:${name} at ${where}; add it to ${group} in the brand token file`);
  }
  return value;
}

/**
 * Walk a `style` object, resolving every token and rejecting every literal colour.
 * Returns a NEW object; the input is never mutated, because s2 must stay pure.
 * @param {Registry} reg
 * @param {unknown} style
 * @param {string} where
 * @returns {unknown}
 */
export function resolveStyle(reg, style, where) {
  if (typeof style === 'string') {
    if (style.startsWith('$')) return resolveToken(reg, style, where);
    const bare = style.trim().toLowerCase();
    if (LITERAL_COLOUR.test(style) || NAMED_COLOURS.has(bare)) {
      throw new TokenError('TOK-2010',
        `TOK-2010 literal colour "${style}" at ${where}. Colours are only reachable through $role:, `
        + 'so that swapping the brand token file moves every colour site at once');
    }
    return style;
  }
  if (Array.isArray(style)) return style.map((v, i) => resolveStyle(reg, v, `${where}[${i}]`));
  if (style !== null && typeof style === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(style)) out[k] = resolveStyle(reg, v, `${where}.${k}`);
    return out;
  }
  return style;
}

/**
 * Expand `style.surface` through roles.json, then let explicit channels win.
 * @param {Registry} reg
 * @param {Record<string, unknown>} style
 * @returns {Record<string, unknown>}
 */
export function applySurface(reg, style) {
  const surface = style.surface;
  if (typeof surface !== 'string') return { ...style };
  const recipe = reg.roles.surfaces[surface];
  if (recipe === undefined) {
    throw new TokenError('TOK-2006', `TOK-2006 unknown style.surface "${surface}"; the enum is ${Object.keys(reg.roles.surfaces).join(' | ')}`);
  }
  const { surface: _drop, ...explicit } = style;
  return { ...recipe, ...explicit };
}
