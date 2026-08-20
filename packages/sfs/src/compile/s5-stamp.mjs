// Stage 5: full tree -> identified tree.
//
// Owns one seeded v5 id per node, per slot and per item; `parentId` linkage with root
// children at "root"; the `ownerRef` substitution that turns `refresh(target:"x")`
// into the stamped id of the data region named x; and the provenance-sidecar member
// set every node carries (§3.3.1, WP-3b.1) so T3 and the placement predicates read
// placement from the compiler's own declaration, never from rendered CSS.
//
// Two things measured from production that a reimplementation gets wrong:
//   * a card's children carry the SLOT's id as their parentId, not the card's
//   * `header` is emitted as {id, components: []} even when empty
//
// ownerRef resolution is a SECOND pass on purpose. A single pass would have to resolve
// a reference to a node it may not have stamped yet, and the order of that would be an
// accident of tree shape rather than a decision.
//
// The placement members (region, cell, rowGroup, align, depth, parent, tabKey) are
// DERIVED here from data the compiler already wrote: cell sizing is read back from the
// node's own `desktop.dimensions.width` — the exact `calc(100% - Npx)` / `Npx` / auto
// string s4 emitted from the responsive intent (the same mapping §3.3.1 blesses for
// --legacy reconstruction), so this is the compiler reading its own declaration within
// one compile, not inferring geometry from CSS. tabKey is null on every current
// fixture: no clean fixture declares a `tabs` region, and tab-membership derivation
// lands with the tabs subject fixture in WP-3b.3.

import { nodeId, assertUniqueIds, V5_PATTERN } from '../lib/ids.mjs';
import { SfsError } from './s1-parse.mjs';

/** @typedef {import('./s2-resolve.mjs').Diagnostic} Diagnostic */
/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */
/**
 * @typedef {{row:string|null, index:number, count:number, sizing:'fill'|'fixed'|'auto', px:number|null, reservePx:number|null}} Cell
 * @typedef {{row:string|null, index:number, members:string[]}} RowGroup
 * @typedef {{id:string, sfsPath:string, name:string, type:string, parent:string, depth:number,
 *            region:'page'|'header'|'body'|'rail', tabKey:string|null, cell:Cell, rowGroup:RowGroup,
 *            align:'start'|'center'|'end'|'between', orientation:'row'|'col'|null}} SidecarNode
 * @typedef {{depth:number, cell:Cell, rowGroup:RowGroup, align:'start'|'center'|'end'|'between'}} Place
 */

/** The two slot keys, and the type whose children live in them. */
const SLOTS = ['content', 'header'];

/**
 * An item's stable sidecar name. name, then caption, then columnType — skipping the
 * empty string, because the auto-inserted crud-operations column carries `caption:""`
 * and an empty join key is a defect, not a name.
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function itemName(item) {
  for (const v of [item.name, item.caption, item.columnType]) {
    if (typeof v === 'string' && v !== '') return v;
  }
  return 'item';
}

/** Emitted justifyContent -> the §3.3.2 align domain {start,center,end,between}. */
const JUSTIFY_BACK = /** @type {const} */ ({
  'flex-start': 'start', center: 'center', 'flex-end': 'end', 'space-between': 'between', 'space-around': 'between',
});

/**
 * The region a node lives in, from its sfsPath. page = the injected page shell;
 * header = the title band and any card `#header` slot; everything else is body.
 * `rail` and finer body sub-regions arrive with the booking-details fixture (WP-3b.3).
 * @param {string} sfsPath
 * @returns {'page'|'header'|'body'|'rail'}
 */
function regionOf(sfsPath) {
  if (sfsPath === '/pageShell') return 'page';
  if (sfsPath.startsWith('/pageShell/titleBand') || sfsPath.includes('#header')) return 'header';
  return 'body';
}

/**
 * A node's cell sizing, read back from the width string s4 wrote from the parent's
 * responsive intent: `calc(100% - Npx)` -> fill (reserve N), `Npx` -> fixed (px N),
 * anything else (auto/100%/absent) -> auto.
 * @param {Record<string, unknown>} node
 * @returns {{sizing:'fill'|'fixed'|'auto', px:number|null, reservePx:number|null}}
 */
function sizingOf(node) {
  const desktop = /** @type {Record<string, unknown>|undefined} */ (node.desktop);
  const dims = desktop && typeof desktop === 'object' ? /** @type {Record<string, unknown>} */ (desktop.dimensions) : undefined;
  const w = dims && typeof dims === 'object' ? dims.width : undefined;
  if (typeof w === 'string') {
    const fill = /^calc\(100% - (\d+)px\)$/.exec(w);
    if (fill) return { sizing: 'fill', px: null, reservePx: Number(fill[1]) };
    const fixed = /^(\d+)px$/.exec(w);
    if (fixed) return { sizing: 'fixed', px: Number(fixed[1]), reservePx: null };
  }
  return { sizing: 'auto', px: null, reservePx: null };
}

/**
 * A node's own alignment within its row, from the flex justifyContent it declares.
 * A non-flex node has no declared alignment and reads `start`.
 * @param {Record<string, unknown>} node
 * @returns {'start'|'center'|'end'|'between'}
 */
function alignOf(node) {
  const j = node.justifyContent;
  if (typeof j === 'string' && j in JUSTIFY_BACK) return JUSTIFY_BACK[/** @type {keyof typeof JUSTIFY_BACK} */ (j)];
  return 'start';
}

/**
 * How a container lays its direct children out: `row` (one horizontal row group) or
 * `col` (each child its own row group). A leaf declares neither and reads null. The
 * placement predicates rowGroupSizes/rowGroupMembers need this — a row of all-auto
 * cells is otherwise indistinguishable from a vertical stack.
 * @param {Record<string, unknown>} node
 * @returns {'row'|'col'|null}
 */
function orientationOf(node) {
  if (node.flexDirection === 'row') return 'row';
  if (node.flexDirection === 'column') return 'col';
  return null;
}

/**
 * The Place of every child in `kids`, reached through the container `row`. cell.sizing
 * is each child's own; row/index/count and rowGroup.members are the container's.
 * @param {Record<string, unknown>[]} kids
 * @param {string|null} row the container's componentName (null for the root list)
 * @param {number} childDepth
 * @returns {Place[]}
 */
function placesOf(kids, row, childDepth) {
  const members = kids.map((k) => String(k.componentName));
  return kids.map((kid, i) => ({
    depth: childDepth,
    cell: { row, index: i, count: kids.length, ...sizingOf(kid) },
    rowGroup: { row, index: i, members },
    align: alignOf(kid),
  }));
}

/**
 * @param {Record<string, unknown>} node
 * @param {string} parentId
 * @param {{module:string, form:string, nodes:SidecarNode[],
 *          dataRegions:Map<string, string>, pending:Record<string, unknown>[]}} ctx
 * @param {Place} place placement this node occupies in its parent, computed by the caller
 * @returns {void}
 */
function stampNode(node, parentId, ctx, place) {
  const sfsPath = /** @type {string} */ (node._sfsPath);
  if (typeof sfsPath !== 'string') {
    throw new SfsError('STM-5101', 'STM-5101 a node reached stage 5 with no _sfsPath; s2 builds it for every region');
  }
  const id = nodeId(ctx.module, ctx.form, sfsPath);
  node.id = id;
  node.parentId = parentId;
  ctx.nodes.push({
    id, sfsPath, name: String(node.componentName), type: String(node.type),
    parent: parentId, depth: place.depth, region: regionOf(sfsPath), tabKey: null,
    cell: place.cell, rowGroup: place.rowGroup, align: place.align, orientation: orientationOf(node),
  });
  if (node.type === 'dataContext') ctx.dataRegions.set(String(node.componentName), id);

  // A raw escape (§2.1.9) is opaque: stamp its own id and parentId, but never
  // descend into its verbatim payload — those items/components carry production ids
  // the compiler must not re-stamp, and re-stamping would break the escape's
  // round-trip stability.
  if (node._rawEscape === true) return;

  // A pending ownerRef can sit on the node itself or on any item's action config.
  collectPending(node, ctx.pending);

  for (const slot of SLOTS) {
    const wrapper = /** @type {Record<string, unknown>|undefined} */ (node[slot]);
    if (wrapper === undefined || wrapper === null || typeof wrapper !== 'object') continue;
    const slotId = nodeId(ctx.module, ctx.form, `${sfsPath}#slot:${slot}`);
    const kids = Array.isArray(wrapper.components) ? /** @type {Record<string, unknown>[]} */ (wrapper.components) : [];
    // Rebuilt so `id` precedes `components`, which is the measured production order.
    node[slot] = { id: slotId, components: kids };
    const members = kids.map((k) => String(k.componentName));
    ctx.nodes.push({
      id: slotId, sfsPath: `${sfsPath}#slot:${slot}`, name: slot, type: `${String(node.type)}.slot`,
      parent: id, depth: place.depth + 1, region: regionOf(sfsPath), tabKey: null,
      cell: { row: String(node.componentName), index: 0, count: 1, sizing: 'auto', px: null, reservePx: null },
      rowGroup: { row: slot, index: 0, members }, align: 'start', orientation: 'col',
    });
    const childPlaces = placesOf(kids, slot, place.depth + 2);
    // placesOf returns one Place per kid, in order, so the index is defined.
    kids.forEach((kid, i) => stampNode(kid, slotId, ctx, /** @type {Place} */ (childPlaces[i])));
  }

  if (Array.isArray(node.components)) {
    const kids = /** @type {Record<string, unknown>[]} */ (node.components);
    const childPlaces = placesOf(kids, String(node.componentName), place.depth + 1);
    // placesOf returns one Place per kid, in order, so the index is defined.
    kids.forEach((kid, i) => stampNode(kid, id, ctx, /** @type {Place} */ (childPlaces[i])));
  }

  if (Array.isArray(node.items)) {
    const items = /** @type {Record<string, unknown>[]} */ (node.items);
    const members = items.map((it) => itemName(it));
    items.forEach((item, i) => {
      const itemPath = /** @type {string} */ (item._sfsPath);
      const itemId = nodeId(ctx.module, ctx.form, itemPath);
      const name = itemName(item);
      // `id` first, matching every measured items[] entry.
      const rest = { ...item };
      delete rest._sfsPath;
      for (const key of Object.keys(item)) delete item[key];
      item.id = itemId;
      Object.assign(item, rest);
      ctx.nodes.push({
        id: itemId, sfsPath: itemPath, name, type: `${String(node.type)}.item`,
        parent: id, depth: place.depth + 1, region: regionOf(sfsPath), tabKey: null,
        cell: { row: String(node.componentName), index: i, count: items.length, sizing: 'auto', px: null, reservePx: null },
        rowGroup: { row: String(node.componentName), index: i, members }, align: 'start', orientation: null,
      });
      collectPending(item, ctx.pending);
    });
  }
}

/**
 * Find every action config still carrying an unresolved ownerRef target.
 * @param {Record<string, unknown>} holder
 * @param {Record<string, unknown>[]} pending
 * @returns {void}
 */
function collectPending(holder, pending) {
  for (const value of Object.values(holder)) {
    if (value === null || typeof value !== 'object') continue;
    const cfg = /** @type {Record<string, unknown>} */ (value);
    if (cfg._type === 'action-config') {
      if (typeof cfg._ownerRefTarget === 'string') pending.push(cfg);
      collectPending(cfg, pending);
    }
  }
}

/**
 * @param {{components:Record<string, unknown>[], formSettings:Record<string, unknown>, doc:SfsDoc}} tree
 * @param {{registry:import('../lib/registry.mjs').Registry}} _ctx
 * @returns {{tree:{components:Record<string, unknown>[], formSettings:Record<string, unknown>, doc:SfsDoc, nodes:SidecarNode[]}, diagnostics:Diagnostic[]}}
 */
export function stamp(tree, _ctx) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const ctx = {
    module: tree.doc.module,
    form: tree.doc.form,
    nodes: /** @type {SidecarNode[]} */ ([]),
    dataRegions: /** @type {Map<string, string>} */ (new Map()),
    pending: /** @type {Record<string, unknown>[]} */ ([]),
  };

  const rootPlaces = placesOf(tree.components, null, 0);
  // placesOf returns one Place per root, in order, so the index is defined.
  tree.components.forEach((root, i) => stampNode(root, 'root', ctx, /** @type {Place} */ (rootPlaces[i])));

  // Pass two: every ownerRef now has a stamped target to point at.
  for (const cfg of ctx.pending) {
    const target = String(cfg._ownerRefTarget);
    const id = ctx.dataRegions.get(target);
    if (id === undefined) {
      throw new SfsError('STM-5301',
        `STM-5301 action "${String(cfg.actionName)}" targets "${target}", which is not a data region in this form. `
        + `The data regions are ${[...ctx.dataRegions.keys()].join(', ') || 'none'}`);
    }
    cfg.actionOwner = id;
    delete cfg._ownerRefTarget;
  }

  assertUniqueIds(ctx.nodes);
  for (const n of ctx.nodes) {
    if (!V5_PATTERN.test(n.id)) {
      throw new SfsError('STM-5101', `STM-5101 id "${n.id}" for ${n.sfsPath} is not a v5 uuid; the version nibble must be 5`);
    }
  }

  return { tree: { ...tree, nodes: ctx.nodes }, diagnostics };
}
