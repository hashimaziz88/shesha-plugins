/**
 * Flow-manifest completion — fills any gap between what an archetype's flow
 * manifest requires (`requiredNodes(flow)`, shesha-form-edit/assets/
 * archetypes/*.flow.json) and what the blueprint actually authored. Real
 * gaps found across the 8 bundled fixtures (see the task report): both
 * table-worklist and list-card's `pageHeader` omit the `subtitle` text node
 * their flow requires alongside `heading`; dashboard's blueprint stops at
 * two metric tiles (`metric1`/`metric2`) but its flow requires three.
 *
 * Every synthesized node is marked `addedBy: "flow-manifest"` (the blueprint
 * schema's own convention, `assets/blueprint.schema.json`'s `node.addedBy`
 * enum) so compile-spec's report can tell a human exactly which nodes it
 * invented rather than authored from the design, with placeholder content
 * that clearly reads as a stand-in.
 */
import { requiredNodes } from '../flow.mjs';

const PLACEHOLDER_CONTENT = {
  text: 'Placeholder — replace with real content',
};

function placeholderFor(req) {
  if (req.type === 'text') {
    // A couple of well-known required-but-omitted text nodes get a more
    // useful placeholder than the generic one; anything else falls back.
    if (req.node === 'subtitle') return 'Browse, search, and manage records.';
    if (/label$/i.test(req.node)) return 'Metric';
    if (/value$/i.test(req.node)) return '—';
    return PLACEHOLDER_CONTENT.text;
  }
  return undefined;
}

/**
 * @returns {{ nodes: object[], added: Array<{node, type, reason}> }}
 */
export function completeBlueprintNodes(blueprintNodes, flow) {
  if (!flow) return { nodes: blueprintNodes, added: [] };

  const nodesByName = new Map(blueprintNodes.map((n) => [n.node, n]));
  const required = requiredNodes(flow);
  const added = [];

  // Pass 1 — synthesize any required node the blueprint never authored.
  for (const req of required) {
    if (nodesByName.has(req.node)) continue;
    const node = {
      node: req.node,
      type: req.type,
      addedBy: 'flow-manifest',
      ...(req.role ? { role: req.role } : {}),
      ...(req.slot ? { slot: req.slot } : {}),
    };
    const content = placeholderFor(req);
    if (content !== undefined) node.content = content;
    nodesByName.set(req.node, node);
    added.push({
      node: req.node,
      type: req.type,
      reason: `required by "${flow.archetype}"'s flow manifest but absent from the blueprint — synthesized with placeholder content`,
    });
  }

  // Pass 2 — splice any required child name missing from its (possibly
  // just-synthesized) parent's own `children` ordering.
  for (const req of required) {
    if (!Array.isArray(req.children)) continue;
    const parent = nodesByName.get(req.node);
    if (!parent) continue;
    if (!Array.isArray(parent.children)) parent.children = [];
    for (const childName of req.children) {
      if (!parent.children.includes(childName)) parent.children.push(childName);
      const child = nodesByName.get(childName);
      if (child && child.slot === undefined) child.slot = req.node;
    }
  }

  return { nodes: [...nodesByName.values()], added };
}
