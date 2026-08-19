// Stage 5: full tree -> identified tree.
//
// Owns one seeded v5 id per node, per slot and per item; `parentId` linkage with root
// children at "root"; and the `ownerRef` substitution that turns `refresh(target:"x")`
// into the stamped id of the data region named x.
//
// Two things measured from production that a reimplementation gets wrong:
//   * a card's children carry the SLOT's id as their parentId, not the card's
//   * `header` is emitted as {id, components: []} even when empty
//
// ownerRef resolution is a SECOND pass on purpose. A single pass would have to resolve
// a reference to a node it may not have stamped yet, and the order of that would be an
// accident of tree shape rather than a decision.

import { nodeId, assertUniqueIds, V5_PATTERN } from '../lib/ids.mjs';
import { SfsError } from './s1-parse.mjs';

/** @typedef {import('./s2-resolve.mjs').Diagnostic} Diagnostic */
/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */

/** The two slot keys, and the type whose children live in them. */
const SLOTS = ['content', 'header'];

/**
 * @param {Record<string, unknown>} node
 * @param {string} parentId
 * @param {{module:string, form:string, nodes:{id:string, sfsPath:string, name:string, type:string}[],
 *          dataRegions:Map<string, string>, pending:Record<string, unknown>[]}} ctx
 * @returns {void}
 */
function stampNode(node, parentId, ctx) {
  const sfsPath = /** @type {string} */ (node._sfsPath);
  if (typeof sfsPath !== 'string') {
    throw new SfsError('STM-5101', 'STM-5101 a node reached stage 5 with no _sfsPath; s2 builds it for every region');
  }
  const id = nodeId(ctx.module, ctx.form, sfsPath);
  node.id = id;
  node.parentId = parentId;
  ctx.nodes.push({ id, sfsPath, name: String(node.componentName), type: String(node.type) });
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
    const kids = Array.isArray(wrapper.components) ? wrapper.components : [];
    // Rebuilt so `id` precedes `components`, which is the measured production order.
    node[slot] = { id: slotId, components: kids };
    ctx.nodes.push({ id: slotId, sfsPath: `${sfsPath}#slot:${slot}`, name: slot, type: `${String(node.type)}.slot` });
    for (const kid of kids) stampNode(/** @type {Record<string, unknown>} */ (kid), slotId, ctx);
  }

  if (Array.isArray(node.components)) {
    for (const kid of node.components) stampNode(/** @type {Record<string, unknown>} */ (kid), id, ctx);
  }

  if (Array.isArray(node.items)) {
    for (const raw of node.items) {
      const item = /** @type {Record<string, unknown>} */ (raw);
      const itemPath = /** @type {string} */ (item._sfsPath);
      const itemId = nodeId(ctx.module, ctx.form, itemPath);
      // `id` first, matching every measured items[] entry.
      const rest = { ...item };
      delete rest._sfsPath;
      for (const key of Object.keys(item)) delete item[key];
      item.id = itemId;
      Object.assign(item, rest);
      ctx.nodes.push({ id: itemId, sfsPath: itemPath, name: String(item.name ?? item.caption ?? 'item'), type: `${String(node.type)}.item` });
      collectPending(item, ctx.pending);
    }
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
 * @returns {{tree:{components:Record<string, unknown>[], formSettings:Record<string, unknown>, doc:SfsDoc, nodes:{id:string, sfsPath:string, name:string, type:string}[]}, diagnostics:Diagnostic[]}}
 */
export function stamp(tree, _ctx) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const ctx = {
    module: tree.doc.module,
    form: tree.doc.form,
    nodes: /** @type {{id:string, sfsPath:string, name:string, type:string}[]} */ ([]),
    dataRegions: /** @type {Map<string, string>} */ (new Map()),
    pending: /** @type {Record<string, unknown>[]} */ ([]),
  };

  for (const root of tree.components) stampNode(root, 'root', ctx);

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
