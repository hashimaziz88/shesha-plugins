// The compiled-tree index the placement predicates read (WP-3b.2, D-014/D-105).
//
// The predicates operate over the compiler's provenance sidecar (§3.3.1) — the
// declared placement, not rendered CSS — so this builds a by-name / by-id / by-parent
// index over `meta.nodes[]` and nothing else. It is NOT a tree walker (it consumes
// the already-walked node list s5-stamp produced) and defines no coverage counters,
// so it is outside g-coverage-single-impl's subject: the tier that consumes it counts.

/**
 * @typedef {import('../../../sfs/src/compile/s5-stamp.mjs').SidecarNode} SidecarNode
 * @typedef {{
 *   all: SidecarNode[],
 *   byName(name: string): SidecarNode | undefined,
 *   byId(id: string): SidecarNode | undefined,
 *   childrenOf(id: string): SidecarNode[],
 * }} TreeIndex
 */

/**
 * Build the index. Node order in `meta.nodes` is the compiler's DFS order, so children
 * filtered by parent id keep their sibling order. byName prefers a real component over
 * a synthetic slot/item node when two share a name (only `content`/`header` collide,
 * and those are never contract targets).
 * @param {{nodes: SidecarNode[]}} meta the compiled sidecar
 * @returns {TreeIndex}
 */
export function buildIndex(meta) {
  const all = Array.isArray(meta && meta.nodes) ? meta.nodes : [];
  /** @type {Map<string, SidecarNode>} */
  const byId = new Map();
  /** @type {Map<string, SidecarNode>} */
  const byName = new Map();
  /** @type {Map<string, SidecarNode[]>} */
  const childrenByParent = new Map();

  for (const n of all) byId.set(n.id, n);
  for (const n of all) {
    const existing = byName.get(n.name);
    // A real component (type without a `.`) wins a name collision over a slot/item.
    if (existing === undefined || (String(existing.type).includes('.') && !String(n.type).includes('.'))) {
      byName.set(n.name, n);
    }
    const kids = childrenByParent.get(n.parent);
    if (kids) kids.push(n); else childrenByParent.set(n.parent, [n]);
  }

  return {
    all,
    byName: (name) => byName.get(name),
    byId: (id) => byId.get(id),
    childrenOf: (id) => childrenByParent.get(id) || [],
  };
}
