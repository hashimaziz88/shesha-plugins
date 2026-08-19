// The ONE tree walker for T1, T2 and T3 (§3.2.2). It reaches every component
// through every container channel the registry declares — never the literal key
// `components` alone. §1.7 T5 was three broken nodes under `items`/`columns` that a
// components-only walker never visited, so it reported `structure walked 3, checked
// 6, failures 0`; §1.4 was five mutually inconsistent tree walkers. There is exactly
// one here, and the channels are DATA (`load(ref).slots`), not a hard-coded list.
//
// This module is registry-data-driven, not coverage arithmetic: it defines no
// walked/checked counter pair and no verdictOf, so it is exempt from
// g-coverage-single-impl's re-export rule and is instead the subject of the
// single-walker assertion. It yields; the tier that consumes it does the counting.

import { load } from '@shesha/registry';

/**
 * Resolve a dotted channel key (`content.components`) to a value on `node`.
 * @param {any} node
 * @param {string} key
 * @returns {any}
 */
function resolve(node, key) {
  let cur = node;
  for (const seg of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * The root component list of a parsed markup object, an SFS `{components}` object,
 * or a bare component array. Envelope unwrapping is T1.01's job, not the walker's.
 * @param {any} doc
 * @returns {any[]}
 */
export function rootComponents(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.components)) return doc.components;
  return [];
}

/**
 * @typedef {{node:any, where:string, slot:string, parentNode:any}} Visit
 */

/**
 * Every component in `doc`, in depth-first order, reached through every declared
 * channel. A plain function (not a generator): the single-walker contract in
 * source-patterns.json matches `function walkComponents(`, and the returned array
 * is still iterable for `[...]`/`for..of`/`.map` callers.
 * @param {any} doc a parsed markup object, an SFS `{components}`, or a component[]
 * @param {{ref?:string, slots?:import('@shesha/registry').SlotChannel[]}} [opts]
 * @returns {Visit[]}
 */
export function walkComponents(doc, opts = {}) {
  const slots = opts.slots || load(opts.ref).slots;
  const seen = new WeakSet();
  /** @type {Visit[]} */
  const out = [];

  /**
   * @param {any} node
   * @param {string} where
   * @param {string} slot
   * @param {any} parentNode
   * @returns {void}
   */
  function visit(node, where, slot, parentNode) {
    if (node == null || typeof node !== 'object') return;
    if (seen.has(node)) return; // a malformed cyclic tree must not spin the walker
    seen.add(node);
    out.push({ node, where, slot, parentNode });

    for (const ch of slots) {
      const value = resolve(node, ch.key);
      if (ch.shape === 'array') {
        if (!Array.isArray(value)) continue;
        for (let i = 0; i < value.length; i++) {
          visit(value[i], `${where}.${ch.key}[${i}]`, ch.key, node);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value) && 'type' in value) {
        // 'single' — the datatable column triplet {type, settings}
        visit(value, `${where}.${ch.key}`, ch.key, node);
      }
    }
  }

  const roots = rootComponents(doc);
  for (let i = 0; i < roots.length; i++) {
    visit(roots[i], `components[${i}]`, 'components', null);
  }
  return out;
}
