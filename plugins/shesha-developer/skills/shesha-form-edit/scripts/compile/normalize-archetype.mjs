// normalize-archetype.mjs — the archetype's anatomy, as ORDINARY layout nodes.
//
// A page archetype implies anatomy the blueprint does not spell out: a header band, a meta
// strip, dashboard metric tiles, the capture error/action floor, page ground. That anatomy
// used to be appended to the COMPILED tree by a second, block-instantiating presentation
// system — two constructors for every shape and two places to fix every bug.
//
// This stage is PURE: validated blueprint in, canonical blueprint-shaped layout tree out. It
// reads no theme, generates no id, emits no component. Everything downstream is the one
// generic node compiler, so the band compiles through exactly the same code as any
// author-written container. Three keys below are compiler-internal, and the blueprint schema
// forbids all three: `ink` (a theme ROLE for a band child's text colour),
// `intent.role: "caption"`, `intent.surface: "page"`.

import { STATUS_PROP, titleCase } from './resolve-bindings-offline.mjs';

// Page archetypes get anatomy above the blueprint's content. capture | modal-dialog |
// auth-page | wizard get NONE: a dialog or a login page has no page anatomy, and giving
// them a band would be a design error, not a floor.
export const PAGE_ARCHETYPES = new Set(['table-worklist', 'record-detail', 'hub', 'dashboard']);
// Capture-class archetypes: their action row is a FOOTER, so it right-aligns [R-057].
export const CAPTURE_ARCHETYPES = new Set(['capture', 'modal-dialog', 'wizard']);
// Page archetypes that show ONE record, and therefore have a page-level lifecycle worth a band
// chip. A table-worklist / dashboard is a COLLECTION: it has no single record, so a status
// binding there identifies a status COLUMN (compile-node's chip cell), and a band chip bound to
// `data.status` would render empty. Declaring the reference-list identity a column needs must
// not conjure a page-level chip.
const RECORD_ARCHETYPES = new Set(['record-detail', 'hub']);

/** @returns {{layout: object, notes: string[]}} the canonical layout tree + what was added */
export function normalizeArchetype(bp) {
  const notes = [];
  // a shallow clone: harvesting MOVES a leading page title and a top-level action row into
  // the band rather than duplicating them below it
  const body = { ...bp.layout, children: [...(bp.layout.children ?? [])] };
  const children = [];

  // `chrome: false` on the blueprint root is the opt-out — for a screen embedded in a host
  // page that already draws a header. The archetype is otherwise the ONE authority on page
  // anatomy, so a double band is impossible by construction.
  if (bp.chrome !== false && PAGE_ARCHETYPES.has(bp.archetype)) {
    children.push(headerBand(bp, harvestHeader(bp, body)));
    notes.push('pageHeaderBand');
    if (bp.archetype === 'record-detail' || bp.archetype === 'hub') {
      const strip = metaStrip(bp);
      if (strip) { children.push(strip); notes.push('metaStrip'); }
    }
    if (bp.archetype === 'dashboard') {
      const tiles = metricTileRow(body);
      if (tiles) { children.push(tiles); notes.push('statTileRow'); }
    }
  }

  children.push(body);

  // the capture floor [R-006/R-007/R-020]: an error summary always, and the Save/exit pair
  // unless the blueprint names its own actions. pageRoot is a column, so the compiler's own
  // capture-footer rule right-aligns the group [R-057] — no special case here.
  if (CAPTURE_ARCHETYPES.has(bp.archetype)) {
    children.push({ kind: 'validationErrors', name: 'formValidationErrors' });
    notes.push('validationErrors');
    if (!hasActions(bp.layout)) {
      children.push({ kind: 'actions', name: 'formActions' });
      notes.push('formActions');
    }
  }

  // page GROUND: every form's root is a page surface, whatever the blueprint root's kind.
  // Before this it was stamped on the COMPILED root, so a datatable root (which compiles to
  // a dataContext, not a surface) needed a wrapper special case.
  return {
    notes,
    layout: { kind: 'container', name: 'pageRoot', width: '100%', gap: '3', intent: { surface: 'page' }, children },
  };
}

const isPageTitle = (n) =>
  Boolean(n) && ((n.kind === 'heading' && (n.level ?? 2) === 1) || n.intent?.role === 'title')
  && Boolean(n.content ?? n.title);

/**
 * Pull the band's content OUT of the body (mutating the cloned children array): a leading
 * page title becomes the band title, the text right after it the subtitle, and a top-level
 * action row the band's header actions. Leaving any of them in the body too would ship the
 * page title twice and split the page's actions across two zones.
 */
function harvestHeader(bp, body) {
  const kids = body.children;
  const out = {
    title: bp.screen ?? bp.form?.label ?? titleCase(bp.form.name),
    subtitle: bp.subtitle ?? null,
    actions: null,
    // the first bound property that reads as a lifecycle — the page's status, if any, and only
    // on a single-record page (see RECORD_ARCHETYPES)
    status: RECORD_ARCHETYPES.has(bp.archetype)
      ? ((bp.bindings ?? []).find((b) => b.property && STATUS_PROP.test(String(b.property)))?.property ?? null)
      : null,
  };
  if (isPageTitle(kids[0])) {
    const t = kids.shift();
    out.title = t.content ?? t.title ?? out.title;
    if (!out.subtitle && kids[0]?.kind === 'text' && kids[0].content) out.subtitle = kids.shift().content;
  }
  const ai = kids.findIndex((k) => k.kind === 'actions' || k.kind === 'buttonGroup');
  if (ai >= 0) out.actions = kids.splice(ai, 1)[0];
  return out;
}

/** the page-header band: a full-width banded surface over subtitle + title row */
function headerBand(bp, h) {
  const left = {
    kind: 'row', name: 'titleLeft', gap: '3', align: 'center',
    // the ONLY split lever is desktop.dimensions.width [R-028]; 220px reserves the actions
    width: h.actions ? 'calc(100% - 220px)' : '100%',
    children: [{ kind: 'heading', level: 1, name: 'titleText', content: String(h.title), ink: 'bandText' }],
  };
  if (h.status) left.children.push({ kind: 'chip', name: 'statusChip', property: h.status, intent: { role: 'status' } });

  const titleRow = { kind: 'row', name: 'titleRow', gap: '4', justify: 'space-between', align: 'start', children: [left] };
  if (h.actions) titleRow.children.push({ ...h.actions, name: 'headerActions' });

  const band = { kind: 'container', name: 'pageHeaderBand', width: '100%', gap: '3', intent: { surface: 'band' }, children: [] };
  if (h.subtitle) band.children.push({ kind: 'text', name: 'breadcrumbTrail', content: String(h.subtitle), intent: { role: 'caption' } });
  band.children.push(titleRow);
  return band;
}

/** the at-a-glance strip: the first three non-status bindings, label + value */
function metaStrip(bp) {
  const cells = (bp.bindings ?? []).filter((b) => b.property && !STATUS_PROP.test(String(b.property))).slice(0, 3);
  if (cells.length < 2) return null;
  return {
    kind: 'container', name: 'metaStrip', width: '100%', intent: { role: 'meta' },
    children: cells.map((b) => ({ kind: 'field', property: b.property, title: b.label ?? titleCase(b.property) })),
  };
}

/**
 * The dashboard's metric row — one tile per data region in the layout. The compiler cannot
 * know a metric the blueprint never measured, so a tile's value is the em-dash default; the
 * ROW is the anatomy, and a blueprint that later carries metrics fills the values. Sized as
 * a `grid` so tile width comes from the one column mechanism, not a second calc().
 */
function metricTileRow(body) {
  const regions = [];
  // a tile's title is the human name of the region it summarises: the region's own title,
  // else the enclosing card/section heading (where a blueprint actually puts the label)
  (function walk(n, group) {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'datatable' || n.kind === 'datalist') regions.push({ ...n, group });
    const next = ((n.kind === 'card' || n.kind === 'section') && n.title) ? n.title : group;
    for (const c of n.children ?? []) walk(c, next);
  })(body, null);
  if (!regions.length) return null;
  const tiles = regions.slice(0, 4).map((r, i) => ({
    kind: 'text', name: `statTile${i + 1}`,
    title: String(r.title ?? r.group ?? titleCase(r.name ?? `region ${i + 1}`)),
    intent: { role: 'metric' },
  }));
  return { kind: 'grid', name: 'statTileRow', width: '100%', columns: tiles.length, gap: '4', children: tiles };
}

/** does the blueprint name its own action row anywhere? then the floor pair stands down */
function hasActions(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'actions' || node.kind === 'buttonGroup') return true;
  return (node.children ?? []).some(hasActions);
}
