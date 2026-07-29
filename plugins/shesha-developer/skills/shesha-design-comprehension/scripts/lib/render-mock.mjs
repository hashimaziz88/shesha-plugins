/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/lib/render-mock.mjs
 *
 * Renders a styled blueprint (assets/blueprint.schema.json) to an ASCII
 * placement mock. This is NOT a hand-drawn wireframe: it walks the SAME
 * resolved node tree the compiler will consume (roles + resolved desktop
 * style, already expanded from tokens to literal values), so the mock
 * cannot drift from what actually gets built.
 *
 * Two audiences read the output:
 *  - a human, approving placement at the planning gate;
 *  - the model, for which a spatial rendering conveys nesting and sizing
 *    that prose cannot.
 *
 * Deterministic: renderMock(blueprint) must return the same string on every
 * call for the same input — no clock, no randomness, no reliance on
 * Object.keys() order (all iteration here is over explicit arrays).
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

// Node types that render as a bordered box (header + optional interior +
// recursed children + footer). Everything else renders as a single line.
const BOX_TYPES = new Set(['container', 'datatable', 'tabs', 'card', 'region']);

/**
 * Build a resolved-value summary line from a node's resolved `desktop` style.
 * Only literal values ever appear here — a caller that hands in an
 * unresolved token (e.g. "$spacing.6") gets that token printed verbatim,
 * which is a bug in the caller, not something this function silently fixes.
 */
function formatSummary(style) {
  if (!style) return '';
  const parts = [];

  if (style.display === 'flex' && style.flexDirection) {
    parts.push(`flex ${style.flexDirection}`);
  } else if (style.display) {
    parts.push(String(style.display));
  }

  if (style.gap !== undefined && style.gap !== null) parts.push(`gap ${style.gap}`);
  if (style.justifyContent) parts.push(`justify:${style.justifyContent}`);
  if (style.alignItems) parts.push(`align:${style.alignItems}`);

  const dims = style.dimensions || {};
  const dimBits = [];
  if (dims.width !== undefined && dims.width !== null) dimBits.push(`w:${dims.width}`);
  if (dims.minHeight !== undefined && dims.minHeight !== null) dimBits.push(`minH:${dims.minHeight}`);
  if (dimBits.length) parts.push(dimBits.join(' '));

  const pad = style.stylingBox && style.stylingBox.padding;
  if (pad !== undefined && pad !== null) parts.push(`pad ${pad}`);

  return parts.join(' · '); // "·" — literal middle dot, spelled out to survive any encoding round-trip
}

/** Column label for a datatable header row. Accepts plain strings or {name|field|propertyName} objects. */
function columnLabel(col) {
  if (typeof col === 'string') return col;
  if (col && typeof col === 'object') return col.name || col.field || col.propertyName || JSON.stringify(col);
  return String(col);
}

/** Resolve the ordered list of child node-names for a node. */
function childNamesOf(node, nodesByName) {
  if (Array.isArray(node.children)) return node.children;
  // Fall back to slot-derived membership, in declaration order, for nodes
  // that name their parent via `slot` but were not listed in a `children[]`.
  const out = [];
  for (const n of nodesByName.values()) {
    if (n.slot === node.node) out.push(n.node);
  }
  return out;
}

function renderNode(node, depth, nodesByName, lines) {
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const isBox = BOX_TYPES.has(node.type);
  const flowMarker = node.addedBy === 'flow-manifest' ? '  (added by flow)' : '';

  if (isBox) {
    let header = `${indent}┌─ ${node.node}`;
    if (node.role) header += ` ─── role: ${node.role}`;
    header += flowMarker;
    lines.push(header);

    const summary = node.style && formatSummary(node.style.desktop);
    if (summary) lines.push(`${childIndent}${summary}`);

    if (node.type === 'datatable' && Array.isArray(node.columns) && node.columns.length) {
      lines.push(`${childIndent}│ ${node.columns.map(columnLabel).join(' | ')} │`);
    }

    if (Array.isArray(node.overrides)) {
      for (const ov of node.overrides) {
        lines.push(`${childIndent}Δ ${ov.prop}=${ov.value} [${ov.source}]`);
      }
    }

    const kids = childNamesOf(node, nodesByName);
    for (const kidName of kids) {
      const kid = nodesByName.get(kidName);
      if (!kid) continue;
      renderNode(kid, depth + 1, nodesByName, lines);
    }

    lines.push(`${indent}└─`);
  } else {
    let line = `${indent}${node.node}`;
    if (node.role) line += ` ─── role: ${node.role}`;
    if (node.content !== undefined && node.content !== null) line += ` "${node.content}"`;
    line += flowMarker;
    lines.push(line);
  }
}

/**
 * Render a styled blueprint to a deterministic ASCII placement mock.
 * @param {object} blueprint - a styled blueprint per assets/blueprint.schema.json
 * @returns {string}
 */
export function renderMock(blueprint) {
  const nodes = blueprint && Array.isArray(blueprint.nodes) ? blueprint.nodes : null;
  if (!nodes || nodes.length === 0) {
    throw new Error('renderMock: no nodes');
  }

  const nodesByName = new Map();
  for (const n of nodes) nodesByName.set(n.node, n);

  // Roots are nodes with no slot — the tree's entry points.
  let roots = nodes.filter((n) => !n.slot);
  if (roots.length === 0) roots = nodes; // defensive: malformed tree, render everything flat rather than emit nothing

  const lines = [];
  if (blueprint.screen) lines.push(`${blueprint.screen}${blueprint.archetype ? ` (${blueprint.archetype})` : ''}`);
  if (blueprint.viewport) lines.push(`viewport ${blueprint.viewport}`);
  if (lines.length) lines.push('');

  roots.forEach((root, i) => {
    if (i > 0) lines.push('');
    renderNode(root, 0, nodesByName, lines);
  });

  return lines.join('\n');
}
