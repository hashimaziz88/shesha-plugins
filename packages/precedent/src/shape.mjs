// @shesha/precedent — Index A: the deterministic SHAPE of a form (§4.7.2).
//
// A shape is computed exactly from a form's structure — archetype-ish kind, entity
// cardinality, component multiset, region topology, column count, action intents, tabs,
// responsive signature, escape count. No embedding, no model, no network: shape
// similarity is reproducible across machines and CI, which is why the primary index is
// shape, not prose (§4). This package is dependency-layer 0 (g-workspace-hygiene): it
// imports nothing from @shesha/sfs or @shesha/registry, so it carries its own tiny
// node walk and shapes the compiled markup directly (the corpus is markup, and layer 0
// may not reach up to the decompiler to recover the SFS kinds).
//
// The topology similarity is a trigram-shingle Jaccard over the depth-first
// serialisation — a fast, deterministic proxy for normalised tree-edit distance that
// keeps a full 5000-row scan inside the 50 ms budget a real O(n^2) edit distance would
// blow (shape.test.mjs asserts the budget).

/**
 * @typedef {{kind:string, archetype:string, entityDepth:number,
 *   nodeMultiset:Record<string,number>, regionTopology:string,
 *   columnCount:number, actionIntents:string[], hasTabs:boolean,
 *   responsiveShape:string, escapeCount:number}} Shape
 */

/** The container channels a component's children hang off, tried in order. */
const CHILD_KEYS = ['components', 'content.components', 'header.components', 'items', 'columns', 'tabs'];

/** @param {any} node @param {string} key @returns {any} */
function at(node, key) {
  let cur = node;
  for (const seg of key.split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[seg]; }
  return cur;
}

/** The ordered child nodes of a component, across every declared channel. @param {any} node @returns {any[]} */
function childrenOf(node) {
  /** @type {any[]} */
  const kids = [];
  for (const key of CHILD_KEYS) {
    const v = at(node, key);
    if (Array.isArray(v)) for (const c of v) { if (c && typeof c === 'object' && c.type) kids.push(c); }
  }
  return kids;
}

/** The root component list of a markup form, an SFS-ish {components}, or a bare array. @param {any} form @returns {any[]} */
function roots(form) {
  if (Array.isArray(form)) return form;
  if (form && Array.isArray(form.components)) return form.components;
  return [];
}

/**
 * The node-kind (component `type`) tree, depth-first, names stripped:
 * `card(text,text,dataContext(search,table,pager))`.
 * @param {any} node @returns {string}
 */
function topologyOf(node) {
  const type = String(node.type || '?');
  const kids = childrenOf(node);
  return kids.length ? `${type}(${kids.map(topologyOf).join(',')})` : type;
}

/**
 * The full shape of a form. Deterministic and total: a malformed form yields a shape
 * with zeroed counts rather than throwing.
 * @param {any} form the compiled markup ({components, formSettings}) or a component array
 * @returns {Shape}
 */
export function shapeOf(form) {
  const fs = (form && form.formSettings && typeof form.formSettings === 'object') ? form.formSettings : {};
  const rs = roots(form);
  /** @type {Record<string, number>} */
  const nodeMultiset = {};
  const actionIntents = new Set();
  const flexDirs = new Set();
  let columnCount = 0;
  let hasTabs = false;
  let escapeCount = 0;

  /** @param {any} node */
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const type = String(node.type || '?');
    nodeMultiset[type] = (nodeMultiset[type] || 0) + 1;
    if (type.includes('tabs') || Array.isArray(node.tabs)) hasTabs = true;
    if (node._rawEscape === true || type === 'raw') escapeCount += 1;
    if (typeof node.flexDirection === 'string') flexDirs.add(node.flexDirection);
    if (Array.isArray(node.items)) {
      for (const it of node.items) {
        if (it && it.columnType === 'data') columnCount += 1;
        const ac = it && it.actionConfiguration;
        if (ac && typeof ac.actionName === 'string') actionIntents.add(ac.actionName);
        if (it && typeof it.buttonAction === 'string') actionIntents.add(it.buttonAction);
      }
    }
    const ac = node.actionConfiguration;
    if (ac && typeof ac.actionName === 'string') actionIntents.add(ac.actionName);
    for (const c of childrenOf(node)) visit(c);
  };
  for (const r of rs) visit(r);

  const submitter = typeof fs.dataSubmitterType === 'string' ? fs.dataSubmitterType : 'none';
  const modelType = typeof fs.modelType === 'string' ? fs.modelType : '';
  return {
    kind: submitter !== 'none' ? 'create' : 'list',
    archetype: '',
    entityDepth: modelType ? modelType.split('.').length : 0,
    nodeMultiset,
    regionTopology: rs.map(topologyOf).join(','),
    columnCount,
    actionIntents: [...actionIntents].sort(),
    hasTabs,
    responsiveShape: [...flexDirs].sort().join('|'),
    escapeCount,
  };
}

/** Multiset Jaccard: Σmin(counts) / Σmax(counts). @param {Record<string,number>} a @param {Record<string,number>} b @returns {number} */
function multisetJaccard(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return 1;
  let inter = 0; let union = 0;
  for (const k of keys) { const x = a[k] || 0; const y = b[k] || 0; inter += Math.min(x, y); union += Math.max(x, y); }
  return union === 0 ? 1 : inter / union;
}

/** Character trigrams of a string. @param {string} s @returns {Set<string>} */
function trigrams(s) {
  const t = new Set();
  const p = `  ${s} `;
  for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3));
  return t;
}

/** Jaccard of two sets. @param {Set<string>} a @param {Set<string>} b @returns {number} */
function jaccardSet(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** The topology trigram set of a shape — precompute once per shape and reuse across a
 * scan so a full corpus sweep does not rebuild every row's shingles on every query.
 * @param {Shape} s @returns {Set<string>} */
export function topoTrigrams(s) { return trigrams(s.regionTopology); }

/**
 * Shape similarity from precomputed topology trigram sets — the hot path a scan calls
 * per corpus row (§4.7.2): 0.5·jaccard(nodeMultiset) + 0.3·jaccard(trigrams) +
 * 0.2·(kind equal).
 * @param {Shape} a @param {Set<string>} aTrg @param {Shape} b @param {Set<string>} bTrg
 * @returns {number}
 */
export function similarityCached(a, aTrg, b, bTrg) {
  const nodes = multisetJaccard(a.nodeMultiset, b.nodeMultiset);
  const topo = jaccardSet(aTrg, bTrg);
  const kind = a.kind === b.kind ? 1 : 0;
  return 0.5 * nodes + 0.3 * topo + 0.2 * kind;
}

/**
 * Shape similarity in [0,1] (§4.7.2): 0.5·jaccard(nodeMultiset) + 0.3·topology
 * similarity + 0.2·(kind equal). Topology similarity is trigram-shingle Jaccard of the
 * depth-first serialisation — the fast proxy for normalised tree-edit distance.
 * @param {Shape} a @param {Shape} b @returns {number}
 */
export function similarity(a, b) {
  return similarityCached(a, trigrams(a.regionTopology), b, trigrams(b.regionTopology));
}
