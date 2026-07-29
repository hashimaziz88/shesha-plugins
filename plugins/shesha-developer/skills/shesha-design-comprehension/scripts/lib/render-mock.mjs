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
const BOX_TYPES = new Set(['container', 'datatable', 'tabs', 'card', 'region', 'wizard', 'datalist']);

// Chart component types the registry marks authorable (references/archetypes.md,
// dashboard.flow.json) — any of these get their chart type named in the mock.
const CHART_TYPES = new Set(['barChart', 'lineChart', 'pieChart', 'polarAreaChart']);

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

  // Only surface flexWrap when it actually wraps — "nowrap" is the
  // uninteresting default and would just add noise to every summary line.
  if (style.flexWrap === 'wrap') parts.push('wrap');

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

/**
 * Render one buttonGroup item inline with the action it fires, marking the
 * primary — e.g. "[Save]◄primary → Submit/shesha.form". Wiring that is
 * invisible in the mock is wiring a reviewer cannot check, so every item
 * shows its actionOwner/actionName pair (and its navigate target, when set)
 * rather than just the button label.
 */
function formatButtonGroupItem(item) {
  const label = item && (item.label || item.actionName || '?');
  let out = `[${label}]`;
  if (item && item.primary) out += '◄primary'; // ◄primary
  const action = item && item.action;
  if (action && (action.actionName || action.actionOwner)) {
    out += ` → ${action.actionName || '?'}/${action.actionOwner || '?'}`; // →
  }
  if (item && item.target) out += ` → ${item.target}`;
  return out;
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

function renderNode(node, depth, nodesByName, lines, opts = {}) {
  const { headerPrefix = '' } = opts;
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  const isBox = BOX_TYPES.has(node.type);
  const flowMarker = node.addedBy === 'flow-manifest' ? '  (added by flow)' : '';

  if (isBox) {
    let header = `${indent}┌─ ${headerPrefix}${node.node}`;
    if (node.role) header += ` ─── role: ${node.role}`;
    header += flowMarker;
    lines.push(header);

    const summary = node.style && formatSummary(node.style.desktop);
    if (summary) lines.push(`${childIndent}${summary}`);

    if (node.type === 'datatable' && Array.isArray(node.columns) && node.columns.length) {
      lines.push(`${childIndent}│ ${node.columns.map(columnLabel).join(' | ')} │`);
    }

    // A datalist is a repeating row-template card, never a column grid — the
    // shape must be visibly different from a datatable's "│ col | col │"
    // header, since drawing a card collection as a grid is a documented
    // defect class (references/archetypes.md's list-card entry).
    if (node.type === 'datalist') {
      lines.push(`${childIndent}╭ card ╮ ╭ card ╮ ╭ card ╮  ⋯ (repeating card row)`);
      lines.push(`${childIndent}row-template → ${node.rowTemplate || '(row template unspecified)'}`);
    }

    if (Array.isArray(node.overrides)) {
      for (const ov of node.overrides) {
        lines.push(`${childIndent}Δ ${ov.prop}=${ov.value} [${ov.source}]`);
      }
    }

    if (node.type === 'tabs' && Array.isArray(node.tabs) && node.tabs.length) {
      // Tab assignment drifts more than anything else in this codebase, so
      // each tab's key/title and its member nodes render explicitly rather
      // than falling back to a flat children[] list.
      for (const tab of node.tabs) {
        let tabHeader = `${childIndent}▤ tab: ${tab.key}`;
        if (tab.title) tabHeader += ` ("${tab.title}")`;
        lines.push(tabHeader);
        const tabKids = Array.isArray(tab.children) ? tab.children : [];
        for (const kidName of tabKids) {
          const kid = nodesByName.get(kidName);
          if (!kid) continue;
          renderNode(kid, depth + 2, nodesByName, lines);
        }
      }
    } else if (node.type === 'wizard') {
      // Steps render as an ordered sequence with step names, so a reviewer
      // can see which nodes belong to which step at a glance.
      const kids = childNamesOf(node, nodesByName);
      kids.forEach((kidName, i) => {
        const kid = nodesByName.get(kidName);
        if (!kid) return;
        renderNode(kid, depth + 1, nodesByName, lines, { headerPrefix: `Step ${i + 1}: ` });
      });
    } else if (node.type !== 'datalist') {
      const kids = childNamesOf(node, nodesByName);
      for (const kidName of kids) {
        const kid = nodesByName.get(kidName);
        if (!kid) continue;
        renderNode(kid, depth + 1, nodesByName, lines);
      }
    }

    lines.push(`${indent}└─`);
  } else {
    let line = `${indent}${headerPrefix}${node.node}`;
    if (node.role) line += ` ─── role: ${node.role}`;
    if (node.content !== undefined && node.content !== null) line += ` "${node.content}"`;

    // buttonGroup wiring is invisible in prose — render every item inline
    // with the action it fires and mark the primary, so a reviewer can check
    // the wiring without opening the built form.
    if (node.type === 'buttonGroup' && Array.isArray(node.items) && node.items.length) {
      line += ` ─── buttonGroup: ${node.items.map(formatButtonGroupItem).join('  ')}`;
    }

    if (CHART_TYPES.has(node.type)) line += ` ⟨chart: ${node.type}⟩`;

    if (node.valueBinding) {
      const vb = node.valueBinding;
      const agg = vb.aggregate ? `${vb.aggregate} ` : '';
      line += ` ⟨bind: ${agg}${vb.property}⟩`;
    }

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
