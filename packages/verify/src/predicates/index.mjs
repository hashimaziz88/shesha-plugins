// The frozen 18-name placement predicate table (WP-3b.2, D-014/D-105; brief §3.3.2).
//
// D-014: placement is executable predicates over the compiled tree, never English a
// model judges. Each predicate reads the compiler's provenance sidecar (§3.3.1) via
// the tree index — the DECLARED placement, so a `1fr` intent that the DOM resolves to
// an unrecoverable pixel width is here an exact `fill` with its reserve. A predicate on
// an absent node returns ABSENT; the evaluator disposes that pointer `fail` (the design
// says the node must exist), never uninspectable. There is no eval, no dynamic import
// and no free-text matching: a contract row names a predicate key and a comparator,
// both closed sets, validated by assertions.schema.json before it reaches here.

import { buildIndex } from './tree.mjs';

/** The sentinel a predicate returns for a node/row that is not in the compiled tree. */
export const ABSENT = Symbol('ABSENT');

/** The reference container width the declared-intent ratio is computed at (§3.3.2). */
const REF_WIDTH = 1440;

/**
 * The cells of a container, in order. A "cell" is a direct child of the named row.
 * @param {import('./tree.mjs').TreeIndex} idx
 * @param {string} row container name
 * @returns {import('./tree.mjs').SidecarNode[]}
 */
function cellsOf(idx, row) {
  const c = idx.byName(row);
  return c ? idx.childrenOf(c.id) : [];
}

/**
 * A cell's declared-intent width at REF_WIDTH: fixed -> px; fill -> 1440 - Σfixed -
 * reserve; auto -> equal share of the non-fixed remainder. Never measured.
 * @param {import('./tree.mjs').SidecarNode} node
 * @param {import('./tree.mjs').TreeIndex} idx
 * @returns {number|typeof ABSENT}
 */
function effectiveWidth(node, idx) {
  const row = node.cell.row;
  if (row === null) return ABSENT;
  const sibs = cellsOf(idx, row);
  const fixedSum = sibs.reduce((a, s) => a + (s.cell.sizing === 'fixed' ? (s.cell.px || 0) : 0), 0);
  if (node.cell.sizing === 'fixed') return node.cell.px || 0;
  if (node.cell.sizing === 'fill') return REF_WIDTH - fixedSum - (node.cell.reservePx || 0);
  const autoCount = sibs.filter((s) => s.cell.sizing === 'auto').length;
  return autoCount > 0 ? (REF_WIDTH - fixedSum) / autoCount : REF_WIDTH - fixedSum;
}

/**
 * The ancestor names of a node, nearest first, up to (excluding) the root sentinel.
 * @param {import('./tree.mjs').SidecarNode} node
 * @param {import('./tree.mjs').TreeIndex} idx
 * @returns {string[]}
 */
function ancestorsOf(node, idx) {
  /** @type {string[]} */
  const out = [];
  let cur = node;
  while (cur && cur.parent !== 'root') {
    const p = idx.byId(cur.parent);
    if (!p) break;
    out.push(p.name);
    cur = p;
  }
  return out;
}

/**
 * The 18 predicates. Each takes (args, idx) and returns a value or ABSENT. The keys of
 * this object are the complete, frozen registry — packages/verify/config/predicates.json
 * mirrors them and g-no-prose-assertions fails on any drift between the two.
 * @type {Record<string, (args: any, idx: import('./tree.mjs').TreeIndex) => any>}
 */
export const PREDICATES = {
  cellCount: ({ row }, idx) => (idx.byName(row) ? cellsOf(idx, row).length : ABSENT),
  cellRow: ({ node }, idx) => { const n = idx.byName(node); return n ? n.cell.row : ABSENT; },
  cellIndex: ({ node }, idx) => { const n = idx.byName(node); return n ? n.cell.index : ABSENT; },
  cellSizing: ({ node }, idx) => { const n = idx.byName(node); return n ? n.cell.sizing : ABSENT; },
  cellPx: ({ node }, idx) => { const n = idx.byName(node); return n ? n.cell.px : ABSENT; },
  cellsEqual: ({ row }, idx) => {
    if (!idx.byName(row)) return ABSENT;
    const cells = cellsOf(idx, row);
    const first = cells[0];
    if (!first) return ABSENT;
    return cells.every((c) => c.cell.sizing === first.cell.sizing
      && (c.cell.sizing !== 'fixed' || c.cell.px === first.cell.px));
  },
  ratio: ({ a, b }, idx) => {
    const na = idx.byName(a); const nb = idx.byName(b);
    if (!na || !nb || na.cell.row === null || na.cell.row !== nb.cell.row) return ABSENT;
    const wa = effectiveWidth(na, idx); const wb = effectiveWidth(nb, idx);
    if (wa === ABSENT || wb === ABSENT || wb === 0) return ABSENT;
    return wa / wb;
  },
  parent: ({ node }, idx) => {
    const n = idx.byName(node);
    if (!n) return ABSENT;
    if (n.parent === 'root') return 'root';
    const p = idx.byId(n.parent);
    return p ? p.name : ABSENT;
  },
  ancestors: ({ node }, idx) => { const n = idx.byName(node); return n ? ancestorsOf(n, idx) : ABSENT; },
  depth: ({ node }, idx) => { const n = idx.byName(node); return n ? n.depth : ABSENT; },
  region: ({ node }, idx) => { const n = idx.byName(node); return n ? n.region : ABSENT; },
  tab: ({ node }, idx) => { const n = idx.byName(node); return n ? n.tabKey : ABSENT; },
  rowGroupSizes: ({ container }, idx) => {
    const c = idx.byName(container);
    if (!c) return ABSENT;
    // Each direct child is one row group: a `row` child is a horizontal row whose size
    // is its own cell count; any other child is a single-cell row group.
    return idx.childrenOf(c.id).map((k) => (k.orientation === 'row' ? idx.childrenOf(k.id).length : 1));
  },
  rowGroupMembers: ({ node }, idx) => {
    const n = idx.byName(node);
    if (!n) return ABSENT;
    const p = idx.byId(n.parent);
    // In a row parent the node shares one horizontal row with all its siblings; in a
    // col parent (or under root) the node stands alone in its own row.
    return p && p.orientation === 'row' ? idx.childrenOf(p.id).map((k) => k.name) : [n.name];
  },
  nextSibling: ({ node }, idx) => {
    const n = idx.byName(node);
    if (!n) return ABSENT;
    const sibs = idx.childrenOf(n.parent);
    const i = sibs.findIndex((s) => s.id === n.id);
    return i >= 0 && i + 1 < sibs.length ? /** @type {any} */ (sibs[i + 1]).name : null;
  },
  align: ({ node }, idx) => { const n = idx.byName(node); return n ? n.align : ABSENT; },
  componentType: ({ node }, idx) => { const n = idx.byName(node); return n ? n.type : ABSENT; },
  count: ({ type }, idx) => idx.all.filter((n) => n.type === type).length,
};

/** The frozen predicate names, for the registry-drift checks. */
export const PREDICATE_NAMES = Object.freeze(Object.keys(PREDICATES).sort());

/**
 * Apply one comparator to a predicate's value. The comparator set is closed (§3.3.2);
 * an unknown comparator is a contract error, surfaced as a non-match with a reason.
 * @param {any} value
 * @param {any} expect the single-key comparator object
 * @returns {{ok:boolean, reason?:string}}
 */
export function compare(value, expect) {
  if (value === ABSENT) return { ok: false, reason: 'the named node/row is not in the compiled tree' };
  const keys = expect && typeof expect === 'object' ? Object.keys(expect) : [];
  if (keys.length !== 1) return { ok: false, reason: `expect must carry exactly one comparator, got ${JSON.stringify(expect)}` };
  const op = /** @type {string} */ (keys[0]);
  const want = expect[op];
  switch (op) {
    case 'eq': return { ok: value === want };
    case 'neq': return { ok: value !== want };
    case 'gte': return { ok: typeof value === 'number' && value >= want };
    case 'lte': return { ok: typeof value === 'number' && value <= want };
    case 'within': return { ok: Array.isArray(want) && typeof value === 'number' && value >= want[0] && value <= want[1] };
    case 'oneOf': return { ok: Array.isArray(want) && want.includes(value) };
    case 'includes': return { ok: Array.isArray(value) && value.includes(want) };
    case 'includesAll': return { ok: Array.isArray(value) && Array.isArray(want) && want.every((w) => value.includes(w)) };
    case 'everyEq': return { ok: Array.isArray(value) && value.length > 0 && value.every((v) => v === want) };
    case 'isNull': return { ok: (value === null) === (want === true) };
    case 'notNull': return { ok: (value !== null && value !== undefined) === (want === true) };
    default: return { ok: false, reason: `unknown comparator "${op}"` };
  }
}

/**
 * Evaluate one contract predicate row against a compiled sidecar. Pure and total: it
 * returns the value and the pass/fail, and never throws on a bad name (that is a
 * failing predicate, ABSENT).
 * @param {{predicate:string, args:any, expect:any}} row
 * @param {{nodes:import('./tree.mjs').SidecarNode[]}|import('./tree.mjs').TreeIndex} metaOrIndex
 * @returns {{predicate:string, value:any, expect:any, pass:boolean, reason:string|null}}
 */
export function evaluate(row, metaOrIndex) {
  const idx = /** @type {any} */ (metaOrIndex).byName ? /** @type {import('./tree.mjs').TreeIndex} */ (metaOrIndex) : buildIndex(/** @type {any} */ (metaOrIndex));
  const fn = PREDICATES[row.predicate];
  if (!fn) return { predicate: row.predicate, value: undefined, expect: row.expect, pass: false, reason: `no such predicate "${row.predicate}"` };
  const value = fn(row.args || {}, idx);
  const { ok, reason } = compare(value, row.expect);
  return {
    predicate: row.predicate,
    value: value === ABSENT ? 'ABSENT' : value,
    expect: row.expect,
    pass: ok,
    reason: ok ? null : (reason || `${JSON.stringify(value === ABSENT ? 'ABSENT' : value)} does not satisfy ${JSON.stringify(row.expect)}`),
  };
}
