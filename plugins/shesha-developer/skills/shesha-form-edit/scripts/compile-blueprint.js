#!/usr/bin/env node
// compile-blueprint.js --blueprint <blueprint.json> --out <form.json>
//                      [--backend http://localhost:21021] [--no-live]
//                      [--theme <name>] [--no-style] [--token-file <path>]
//
// L3: the blueprint IR is the ONLY build input; the model chooses the
// adaptation, this script types the JSON. Pipeline:
//   layout tree → flex containers (display:flex + desktop.dimensions.width [R-028/R-029])
//   fields      → by-datatype components, live-metadata bindings [R-004/R-015/R-034]
//   tables      → dataContext(v8) wrapper + datatable columns [R-005]
//   floor       → validationErrors + Submit/exit buttonGroup on capture archetypes [R-006/R-007]
//   versions    → stamped from the 0.45 components-kb [R-003]
//   ids         → deterministic (sha of form+path) → reruns diff cleanly
//
// With --backend (default on): resolves reflist identities + datatype-driven
// component choice from live Metadata/GetProperties. --no-live skips (bindings
// then need resolve-bindings.js before push).
// Accepts a raw JSON blueprint or a Markdown blueprint containing a fenced
// ```blueprint-json block. The blueprint is validated against
// shesha-design-comprehension/schemas/blueprint.schema.json (via that skill's
// scripts/validate-blueprint.mjs) BEFORE anything compiles — invalid → exit 2,
// no output written.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gymUuid } from './gym-lib/ids.js';
import { GymApi } from './gym-lib/api.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const bpFile = argVal('--blueprint', null);
const outFile = argVal('--out', null);
if (!bpFile || !outFile) { console.error('usage: node compile-blueprint.js --blueprint <bp.json|bp.md> --out <form.json> [--backend url] [--no-live] [--theme name] [--no-style] [--token-file path]'); process.exit(2); }

// ---- load + VALIDATE the blueprint (JSON or fenced block in Markdown) ---------
// The schema check is not the compiler's own opinion: it runs the one validator
// that owns the blueprint contract, shesha-design-comprehension's
// validate-blueprint.mjs. In-process import over a sibling-skill relative path —
// both skills ship in the same plugin, so no package resolution is involved; the
// existsSync guard turns a mangled install into a readable error instead of an
// ERR_MODULE_NOT_FOUND stack. Nothing is written before this passes.
const VALIDATOR = path.join(SCRIPT_DIR, '..', '..', 'shesha-design-comprehension', 'scripts', 'validate-blueprint.mjs');
if (!fs.existsSync(VALIDATOR)) {
  console.error(`blueprint validator missing: ${VALIDATOR} — the shesha-design-comprehension skill must ship alongside shesha-form-edit`);
  process.exit(2);
}
const { validateBlueprint, loadSchema, readBlueprint } = await import(pathToFileURL(VALIDATOR).href);

let bp;
try {
  bp = readBlueprint(bpFile);
} catch (err) {
  console.error(`cannot read blueprint ${bpFile}: ${err.message}`);
  process.exit(2);
}
const bpFindings = validateBlueprint(bp, loadSchema()).errors;
if (bpFindings.length) {
  console.error(`INVALID blueprint ${bpFile} — no spec, no build (${bpFindings.length} finding(s), nothing written):`);
  for (const f of bpFindings) console.error(`  FAIL ${f}`);
  console.error('  gate: node ../shesha-design-comprehension/scripts/validate-blueprint.mjs <blueprint>');
  process.exit(2);
}

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));
const ver = (type) => {
  const v = index[type]?.version;
  if (!Number.isInteger(v)) throw new Error(`component type "${type}" not in the 0.45 KB — unusable by definition (L1)`);
  return v;
};

// ---- live metadata (datatype → component, reflist identity) -------------------
let propsMeta = null; // Map(lower -> prop)
if (!args.includes('--no-live')) {
  const api = new GymApi(argVal('--backend', 'http://localhost:21021'), { tokenFile: argVal('--token-file', null) });
  // A credentials/config failure is the caller's to fix — say so once, no stack.
  try { await api.authenticate(); }
  catch (err) { console.error(`auth against ${api.baseUrl} failed: ${err.message}`); process.exit(2); }
  const { ok, body } = await api.getJson(`/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(bp.entity.fullClassName)}`);
  const arr = Array.isArray(body?.result) ? body.result : null;
  if (ok && arr) {
    propsMeta = new Map();
    for (const p of arr) if (p?.path) propsMeta.set(String(p.path).toLowerCase(), p);
  } else {
    console.error(`WARN: metadata for ${bp.entity.fullClassName} unavailable — compiling without live binding resolution`);
  }
}

const BY_DATATYPE = {
  'string': 'textField',
  'string-multiline': 'textArea',
  'text': 'textArea',
  'number': 'numberField',
  'float': 'numberField',
  'int64': 'numberField',
  'date': 'dateField',
  'date-time': 'dateField',
  'time': 'timePicker',
  'boolean': 'checkbox',
  'reference-list-item': 'dropdown',
  'entity': 'autocomplete',
  'guid': 'textField',
};

// Capture-class archetypes: their action row is a FOOTER, so it right-aligns
// [R-057]. Declared here (not next to the floor block that also reads it) because
// buildContainer consults it while the tree is still compiling — a later `const`
// would be in its temporal dead zone.
const CAPTURE_ARCHETYPES = new Set(['capture', 'modal-dialog', 'wizard']);
const isCaptureFooter = () => CAPTURE_ARCHETYPES.has(bp.archetype);
// Component types that ARE buttons. A container holding only these is an action
// row and must render as one horizontal line, never a vertical stack [R-057].
const BUTTON_TYPES = new Set(['button', 'buttonGroup', 'buttons']);

// A property name that reads as a reference-list lifecycle (status / state / stage,
// plain or suffixed: assetStatus, workflowState). Same expression validate-styledness
// uses for its status-as-text check, so the compiler and the gate agree by construction.
const STATUS_PROP = /(^|[a-z])(status|state|stage)$/;

function titleCase(prop) {
  const last = prop.split('.').pop();
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

// ---- React-design-intuition scales ------------------------------------------
// The model designs in React terms (Stack/Row/Grid/Card, gap/padding, heading
// levels); these map each to the measured Shesha channel. Colour/brand is the
// Style pass's job — here we set only structural layout + hierarchy defaults.
// Neutral spacing scale — the fallback when the active theme file defines no
// spacing map (and the whole scale under --no-style / an unknown theme, where TOK
// is null): neutral means sane defaults, never 0.
// It carries the numeric-string STEPS as well as the aliases, so a spacing key such
// as '4' still resolves to 16 with no theme loaded instead of degrading to 4px.
const SPACE = {
  '1': 4, '2': 8, '3': 12, '4': 16, '5': 20, '6': 24, '8': 32, '10': 40, '12': 48, '16': 64, '20': 80,
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32,
};
// Spacing is a THEME token, not a literal. `TOK.spacing` (defined below, always
// before the first compile call) is consulted FIRST, so a numeric-STRING key is a
// step on the theme scale — '4' → spacing.4 → 16px — and never 4px. That confusion
// is why the card default emitted 4px while its comment claimed 16.
const themeSpace = (key) => {
  const map = TOK && TOK.spacing;
  if (!map || typeof map !== 'object') return undefined;
  const v = map[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
// a spacing token with a neutral px fallback — for the compiler's own defaults
const themePx = (key, fallback) => themeSpace(key) ?? fallback;
const resolveSpace = (v, dflt) => {
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return v; // a raw NUMBER is a literal px value
  const key = String(v).trim();
  const themed = themeSpace(key); // '4' → 16; also picks up xs/sm/md/… if a theme names them
  if (themed !== undefined) return themed;
  if (SPACE[key] !== undefined) return SPACE[key];
  const n = parseInt(key, 10);
  return Number.isFinite(n) ? n : dflt;
};
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between', 'space-around': 'space-around' };
// structural heading hierarchy (px/weight); the brand type scale overrides in the Style pass
const HEADING = { 1: { size: 24, weight: '600' }, 2: { size: 20, weight: '600' }, 3: { size: 16, weight: '600' }, 4: { size: 14, weight: '600' } };

// pad a stylingBox JSON string from a padding spec (uniform px)
function paddingBox(v) {
  const p = String(resolveSpace(v, 0));
  return JSON.stringify({ paddingTop: p, paddingRight: p, paddingBottom: p, paddingLeft: p });
}

// ---- theme tokens: DESIGN IS COMPILED IN, not a second pass -----------------
// The brand token file is a compile-time input; the compiler resolves colour /
// type / radius from it as it emits each node, so the first output is on-brand.
// (App-level AntD chrome — input/table/button skin — is the separate one-time
// `$antdTheme` app setup, not a per-form pass.)
const THEME_DIR = path.join(SCRIPT_DIR, '..', '..', 'shesha-design-system', 'assets', 'themes');
const themeName = argVal('--theme', bp.theme || 'shesha');
// --no-style is the ONLY thing that skips the theme pass [R-042]. It takes the
// exact same road as an unknown theme: TOK stays null, so every tk() / resolveSpace()
// call yields its neutral fallback instead of a brand token (SKILL.md §5).
const noStyle = args.includes('--no-style');
let TOK = null;
if (noStyle) {
  console.error('NOTE: --no-style — theme-token resolution skipped, emitting neutral tokens [R-042]');
} else {
  try { TOK = JSON.parse(fs.readFileSync(path.join(THEME_DIR, `${themeName}.tokens.json`), 'utf8')); }
  catch { console.error(`WARN: theme "${themeName}" not found in ${THEME_DIR} — emitting neutral defaults`); }
}

const tkRaw = (dotted) => (dotted || '').split('.').reduce((o, k) => (o == null ? o : o[k]), TOK);
// resolve a token path or a role (roles.* values are themselves token paths → resolve twice)
function tk(pathOrRole, fallback) {
  if (!TOK) return fallback;
  const p = /^(roles|palette|type|spacing|radius|shadow|chrome)\./.test(pathOrRole) ? pathOrRole : `roles.${pathOrRole}`;
  let v = tkRaw(p);
  if (typeof v === 'string' && /^(palette|type|spacing|radius|shadow|chrome)\./.test(v)) v = tkRaw(v);
  return v ?? fallback;
}
const HEADING_TOKEN = { 1: 'type.scale.title', 2: 'type.scale.subtitle', 3: 'type.scale.cardHeader', 4: 'type.scale.body' };

const bindingIndex = new Map((bp.bindings ?? []).map((b) => [b.property, b]));

function fieldComponent(node, idKey) {
  const prop = node.property;
  const binding = bindingIndex.get(prop) ?? {};
  const meta = propsMeta?.get(String(prop).toLowerCase().split('.')[0]);
  let type = node.component ?? binding.component;
  if (!type) {
    const dt = binding.datatype ?? meta?.dataType;
    // A status/state/stage property is a LIFECYCLE, never free text. With live metadata
    // the datatype already says reference-list-item; without it (--no-live) the plain
    // 'string' default used to compile a status to a textField — which throws the
    // lifecycle away and is exactly what validate-styledness' status-as-text check
    // FAILS on. Default it to the reference-list editor instead; resolve-bindings
    // fills the identity from metadata [R-015].
    type = dt ? (BY_DATATYPE[dt] ?? 'textField') : (STATUS_PROP.test(prop) ? 'dropdown' : 'textField');
  }
  const comp = {
    id: gymUuid('bp', bp.form.name, idKey),
    type,
    version: ver(type),
    propertyName: prop,
    label: binding.label ?? node.title ?? titleCase(prop),
    labelAlign: 'left',
    // fields fill their column; minWidth:0 lets flex columns shrink cleanly [flexbox min-content trap];
    // a token-driven border makes inputs visible on-brand in one pass, even before the app AntD theme
    desktop: {
      dimensions: { width: '100%', minWidth: '0px' },
      border: { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: tk('inputBorder', '#D0D5E0') } }, radius: { all: tk('baseRadius', 6) } },
    },
  };
  if (type === 'dropdown' || type === 'radio' || type === 'refListStatus') {
    const p = propsMeta?.get(String(prop).toLowerCase());
    if (p?.referenceListName) {
      // identity copied verbatim from metadata [R-015]
      comp.dataSourceType = 'referenceList';
      comp.referenceListId = { module: p.referenceListModule ?? null, name: p.referenceListName.split('.').pop() };
    } else if (propsMeta) {
      console.error(`WARN: ${prop} compiled as ${type} but metadata shows no referenceListName`);
    }
  }
  if (type === 'autocomplete') {
    const p = propsMeta?.get(String(prop).toLowerCase());
    if (p?.entityType) Object.assign(comp, { dataSourceType: 'entitiesList', entityTypeShortAlias: p.entityType, mode: 'single' });
  }
  return comp;
}

let seq = 0;
/**
 * One node → one component. `presentation` (the presentation IR) is a DECORATOR over the
 * structural compile: a recipe or a role may replace what the node's `kind` would have
 * emitted, then tone / surface / overrides colour whatever came out. A node with no
 * `presentation` block takes exactly the road it always took.
 */
function compileNode(node, idPrefix) {
  const idKey = `${idPrefix}/${node.kind}:${node.name ?? node.property ?? seq++}`;
  const pres = node.presentation;
  if (!pres) return compileKind(node, idKey);
  const presented = presentedNode(node, idKey, pres);   // recipe > role > (null → kind)
  const comp = presented ?? compileKind(node, idKey);
  return applyPresentation(comp, node, pres, idKey);
}

function compileKind(node, idKey) {
  switch (node.kind) {
    case 'field':
      return fieldComponent(node, idKey);
    case 'text':
      return {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'text', version: ver('text'),
        componentName: node.name ?? `text${seq}`,
        content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
        // contentType:"custom" is what LETS desktop.font.color reach the DOM — without
        // it antd's own preset ink wins and the colour is measured as a no-op [R-052]
        contentType: 'custom',
        desktop: { font: { size: tk('type.scale.body', 14), color: tk('bodyText', '#181818') } },
      };
    case 'heading': {
      const lvl = node.level ?? 2;
      const h = HEADING[lvl] ?? HEADING[2];
      return {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'text', version: ver('text'),
        componentName: node.name ?? `heading${seq}`,
        content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
        // heading ink needs the same contentType:"custom" gate as body text [R-052]
        contentType: 'custom',
        // on-brand hierarchy from the theme type scale + heading ink [R-030]
        desktop: { font: { size: tk(HEADING_TOKEN[lvl], h.size), weight: String(tk('type.weights.semibold', 600)), color: tk('sectionHeading', '#181818') } },
      };
    }
    case 'buttonGroup':
    case 'actions':
      // the node's own button specs win over the Save/Back floor [R-057]
      return floorButtonGroup(idKey, node);
    case 'datatable': {
      const table = {
        id: gymUuid('bp', bp.form.name, `${idKey}/table`),
        type: 'datatable', version: ver('datatable'),
        componentName: `${node.name ?? 'table'}Grid`, propertyName: `${node.name ?? 'table'}Grid`,
        canEditInline: 'no', canAddInline: 'no', canDeleteInline: 'no', useMultiselect: false,
        // Presentation floor for a grid [R-042 / validate-styledness "datatable-presentation"].
        // The measured matrix is the authority on WHICH grid channels render: `rowDimensions.height`
        // (density) and `headerBackgroundColor` are recorded changes-geometry, while the obvious
        // candidates — rowHoverBackgroundColor, striped, rowDividers, rowPaddingTop/Bottom — are
        // all `not-measured`, so hover/stripe intent has no proven channel and is NOT authored here.
        // Row height + header contrast + body ink are the three that provably reach the DOM.
        rowDimensions: { height: tk('chrome.tableRowHeight', 44) },
        headerBackgroundColor: tk('tableHeaderBg', '#f5f6f8'),
        desktop: { font: { size: tk('type.scale.body', 14), color: tk('bodyText', '#181818') } },
        items: (node.columns ?? []).map((col, i) => ({
          id: gymUuid('bp', bp.form.name, `${idKey}/col/${col}`),
          itemType: 'item', sortOrder: i, columnType: 'data',
          propertyName: col, caption: titleCase(col), isVisible: true, allowSorting: true,
          displayComponent: { type: '[default]' }, editComponent: { type: '[not-editable]' }, createComponent: { type: '[not-editable]' },
        })),
      };
      const ctx = {
        id: gymUuid('bp', bp.form.name, `${idKey}/ctx`),
        type: 'dataContext', version: ver('dataContext'),
        entityType: bp.entity.fullClassName, sourceType: 'Entity',
        dataFetchingMode: 'paging', defaultPageSize: 10,
        uniqueStateId: node.name ?? 'table', componentName: node.name ?? 'table', propertyName: node.name ?? 'table',
        sortMode: 'standard', allowReordering: 'no',
        components: [table],
      };
      table.parentId = ctx.id;
      for (const it of table.items) it.parentId = table.id;
      return ctx;
    }
    case 'datalist': {
      const list = {
        id: gymUuid('bp', bp.form.name, `${idKey}/list`),
        type: 'datalist', version: ver('datalist'),
        componentName: `${node.name ?? 'list'}List`, propertyName: `${node.name ?? 'list'}List`,
        formSelectionMode: 'name',
        formId: { name: node.itemForm ?? `${bp.form.name}-item`, module: bp.form.module },
        orientation: 'vertical', selectionMode: 'none',
      };
      const ctx = {
        id: gymUuid('bp', bp.form.name, `${idKey}/ctx`),
        type: 'dataContext', version: ver('dataContext'),
        entityType: bp.entity.fullClassName, sourceType: 'Entity',
        dataFetchingMode: 'paging', defaultPageSize: 10,
        uniqueStateId: node.name ?? 'list', componentName: node.name ?? 'list', propertyName: node.name ?? 'list',
        sortMode: 'standard', allowReordering: 'no',
        components: [list],
      };
      list.parentId = ctx.id;
      return ctx;
    }
    case 'tabs': {
      const tabs = {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'tabs', version: ver('tabs'),
        componentName: node.name ?? 'tabs', tabType: 'line',
        defaultActiveKey: node.children?.[0]?.name ?? 'tab1',
        tabs: (node.children ?? []).map((tab, i) => {
          const key = tab.name ?? `tab${i + 1}`;
          return {
            id: gymUuid('bp', bp.form.name, `${idKey}/tab/${key}`),
            key, title: tab.title ?? titleCase(key),
            components: (tab.children ?? []).map((c) => compileNode(c, `${idKey}/${key}`)),
          };
        }),
      };
      for (const t of tabs.tabs) for (const c of t.components) c.parentId = tabs.id;
      return tabs;
    }
    // region | stack | container | row | grid | card | section — all flex containers [R-028/R-029]
    default:
      return buildContainer(node, idKey);
  }
}

// One flex-container builder for every layout kind. Reads the React-style props
// (gap/padding/align/justify/width) and maps each to a measured channel; a
// container ALWAYS sets display:flex so the flex props aren't inert [R-029].
function buildContainer(node, idKey) {
  const COLUMN_PARENT = node.kind !== 'row' && node.kind !== 'grid';
  let children = (node.children ?? []).map((c) => {
    const compiled = compileNode(c, idKey);
    // A capture screen's action row is a FOOTER. Inside a COLUMN stack the group has
    // no alignment lever of its own (buttonGroup dimensions/stylingBox are measured
    // no-ops), so it gets its own right-aligned row [R-057]. Inside an author's row
    // (a toolbar) the author's justify already governs — left alone.
    if (COLUMN_PARENT && isCaptureFooter() && (c.kind === 'actions' || c.kind === 'buttonGroup')) {
      return actionFooterRow(compiled);
    }
    return compiled;
  });
  // An action row is a row whatever kind the author reached for: a container whose
  // children are ALL buttons renders as one horizontal line, never a vertical stack
  // [R-057]. Capture footers right-align; elsewhere the author's justify stands.
  const allButtons = children.length > 0 && children.every((c) => BUTTON_TYPES.has(c.type));
  const isRow = node.kind === 'row' || node.kind === 'grid' || allButtons;

  // grid: N equal columns. Each child is WRAPPED in a width-carrying flex column
  // (the same mechanism the 66/33 row split uses) rather than sizing the field
  // directly — a form-item's own width doesn't stretch reliably, which collapses
  // gridded controls to stubs. The field then fills its column at 100%.
  if (node.kind === 'grid') {
    const cols = Number.isInteger(node.columns) ? node.columns : (children.length || 1);
    const g = resolveSpace(node.gap, themePx('4', 16)); // theme spacing.4, neutral 16
    const w = `calc((100% - ${(cols - 1) * g}px) / ${cols})`;
    children = children.map((c, i) => {
      const col = {
        id: gymUuid('bp', bp.form.name, `${idKey}/gcol/${i}`),
        type: 'container', version: ver('container'),
        componentName: `${node.name ?? 'grid'}Col${i}`,
        direction: 'vertical', display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', gap: 0,
        desktop: {
          display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', justifyContent: 'flex-start', alignItems: 'stretch',
          gap: '0px', stylingBox: '{}',
          dimensions: { width: w, minWidth: '0px', height: 'auto', minHeight: 'auto', maxHeight: 'auto', maxWidth: '100%' },
        },
        components: [c],
      };
      c.parentId = col.id;
      return col;
    });
  }
  // row: children keep their author width but need minWidth:0 so a 66/33 split
  // doesn't overflow and wrap to stacked (the #1 split-failure cause).
  if (node.kind === 'row') {
    children = children.map((c) => {
      if (c.desktop?.dimensions?.width) c.desktop.dimensions.minWidth = '0px';
      return c;
    });
  }

  // section/card with a title gets a heading child prepended (before parentId stamp)
  if ((node.kind === 'section' || node.kind === 'card') && node.title) {
    const heading = compileNode({ kind: 'heading', level: 3, content: node.title, name: `${node.name ?? node.kind}Title` }, idKey);
    children.unshift(heading);
  }

  // The 0.45 renderer reads the flex model from the `desktop` breakpoint block,
  // NOT from root-level props — this is THE reason root display/flexDirection did
  // nothing and rows stacked. Build the full desktop style object (mirrors the
  // container's own defaultStyles shape) so layout is honoured. [R-030/R-032]
  // ONE resolved gap for both the desktop block and the root-level duplicate below —
  // resolving it twice let the two drift apart.
  // action rows sit tighter than layout rows: spacing.2 between buttons
  const gapPx = resolveSpace(node.gap, allButtons ? themePx('2', 8) : (isRow ? themePx('4', 16) : themePx('3', 12)));
  const desktop = {
    display: 'flex',
    flexDirection: isRow ? 'row' : 'column',
    flexWrap: node.kind === 'grid' ? 'wrap' : 'nowrap',
    justifyContent: node.justify ? (JUSTIFY[node.justify] ?? node.justify)
      : (allButtons && isCaptureFooter() ? 'flex-end' : 'flex-start'),
    alignItems: node.align ? (ALIGN[node.align] ?? node.align) : (allButtons ? 'center' : (isRow ? 'flex-start' : 'stretch')),
    gap: `${gapPx}px`,
    dimensions: {
      width: node.width ?? (isRow ? '100%' : 'auto'),
      height: 'auto', minHeight: 'auto', maxHeight: 'auto',
      minWidth: '0px', maxWidth: '100%',
    },
    stylingBox: node.padding !== undefined ? paddingBox(node.padding) : '{}',
  };

  // card: on-brand surface from tokens (border-forward per the Shesha philosophy —
  // hairline border, whisper shadow) so it's designed in the first output [R-030]
  if (node.kind === 'card') applyCardSurface(desktop, node);

  const container = {
    id: gymUuid('bp', bp.form.name, idKey),
    type: 'container', version: ver('container'),
    componentName: node.name ?? `${node.kind}${seq}`,
    // root duplicates kept for migration compatibility; desktop is authoritative
    direction: isRow ? 'horizontal' : 'vertical',
    display: 'flex', flexDirection: isRow ? 'row' : 'column',
    gap: gapPx,
    flexWrap: node.kind === 'grid' ? 'wrap' : 'nowrap',
    stylingBox: desktop.stylingBox,
    desktop,
    components: children,
  };
  for (const c of container.components) c.parentId = container.id;
  return container;
}

/**
 * The card SURFACE — one definition, two callers: `kind: "card"` and
 * `presentation.surface: "card"` on any container. Border-forward per the Shesha design
 * philosophy (hairline border + whisper shadow), all of it from theme tokens [R-030].
 */
function applyCardSurface(desktop, node) {
  desktop.background = { type: 'color', color: tk('cardBg', '#ffffff') };
  desktop.border = { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', color: tk('hairline', '#e5e7eb'), style: 'solid' } }, radius: { all: tk('cardRadius', 8) } };
  desktop.shadow = { offsetX: 0, offsetY: 1, blurRadius: 4, spreadRadius: 0, color: 'rgba(0,0,0,0.08)' };
  // '4' is a spacing TOKEN key: theme spacing.4 = 16px in both shipped themes
  // (neutral fallback 16 under --no-style) — not 4px.
  if (node.padding === undefined) desktop.stylingBox = paddingBox('4');
}

// ---- action rows -------------------------------------------------------------
// The Save/Back pair is the FLOOR [R-007/R-020], not a ceiling: a blueprint that
// names its own buttons gets those instead. Button specs are read from, in order:
//   node.items / node.buttons — the rich shape {name,label,buttonType,icon,action,url}
//   node.children            — the shape the blueprint schema allows TODAY (a node's
//                              only child channel), read as label-carrying specs
// Whatever the source, the group always carries isInline:true — without it the
// renderer collapses it to an overflow "…" menu (proven by the golden shape) [R-057].
const DEFAULT_ACTION_SPECS = [
  { name: 'btnSave', label: 'Save', buttonType: 'primary', icon: 'SaveOutlined', action: 'submit' },
  { name: 'btnBack', label: 'Back', buttonType: 'default', icon: 'ArrowLeftOutlined', action: 'navigate', url: '/' },
];
const SUBMIT_WORDS = /^(save|submit|create|add|update|confirm|apply|send|register)\b/i;
const EXIT_WORDS = /^(back|cancel|close|discard|exit|return)\b/i;
const DEFAULT_ICONS = { submit: 'SaveOutlined', navigate: 'ArrowLeftOutlined' };

/** Normalise one authored spec (rich object OR blueprint child node) into a spec. */
function actionSpec(raw, i) {
  const label = raw.label ?? raw.title ?? raw.content ?? (raw.name ? titleCase(raw.name) : `Action ${i + 1}`);
  const name = raw.name ?? `btn${String(label).replace(/[^A-Za-z0-9]/g, '') || i}`;
  let action = raw.action ?? raw.buttonAction ?? null;
  if (!action) action = SUBMIT_WORDS.test(label) ? 'submit' : (EXIT_WORDS.test(label) ? 'navigate' : null);
  return { name, label, action, buttonType: raw.buttonType, icon: raw.icon, url: raw.url ?? raw.target };
}

/**
 * A normalised spec → a buttonGroup item. The id key is the button's SLUG (btnSave →
 * "save"), so the Save/Back pair keeps the ids it has always had and an authored
 * button keeps its id across recompiles [R-025]. Key order mirrors the golden item
 * shape so a rerun diffs cleanly.
 */
function actionItem(spec, i, idKey, allowPrimary) {
  const slug = spec.name.replace(/^btn/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || String(i);
  const item = {
    id: gymUuid('bp', bp.form.name, `${idKey}/actions/${slug}`),
    itemType: 'item', itemSubType: 'button', sortOrder: i,
    name: spec.name, label: spec.label,
    // exactly ONE primary per action zone [R-007] — the first submit earns it
    buttonType: spec.buttonType ?? (spec.action === 'submit' && allowPrimary ? 'primary' : 'default'),
  };
  const icon = spec.icon ?? (spec.action ? DEFAULT_ICONS[spec.action] : undefined);
  if (icon) item.icon = icon;
  if (spec.action) item.buttonAction = spec.action;
  item.editMode = 'inherited';
  if (spec.action === 'submit') {
    item.actionConfiguration = { _type: 'action-config', actionName: 'Submit', actionOwner: 'shesha.form', handleSuccess: false, handleFail: false };
  } else if (spec.action === 'navigate') {
    // a Navigate with an empty target crashes the page [R-008] — default to the root
    item.actionConfiguration = { _type: 'action-config', actionName: 'Navigate', actionOwner: 'shesha.common', actionArguments: { navigationType: 'url', url: spec.url ?? '/' } };
  }
  return item;
}

function floorButtonGroup(idKey, node) {
  const authored = [node?.items, node?.buttons, node?.children].find((a) => Array.isArray(a) && a.length);
  const specs = (authored ?? DEFAULT_ACTION_SPECS).map(actionSpec);
  let primaryTaken = specs.some((s) => s.buttonType === 'primary');
  const items = specs.map((spec, i) => {
    const allow = !primaryTaken;
    if (spec.action === 'submit' && allow) primaryTaken = true;
    return actionItem(spec, i, idKey, allow);
  });
  const name = node?.name ?? 'formActions';
  return {
    id: gymUuid('bp', bp.form.name, `${idKey}/actions`),
    type: 'buttonGroup', version: ver('buttonGroup'),
    componentName: name, propertyName: name,
    label: 'Form Actions', hideLabel: true, isInline: true, editMode: 'editable',
    items,
  };
}

/**
 * Wrap an action group in its own flex ROW so 2+ buttons read as one line and, on a
 * capture footer, sit right-aligned [R-057]. buttonGroup's own dimensions/stylingBox
 * are measured no-ops (assets/measured-capability-matrix.json), so the alignment
 * lever HAS to be the containing container — exactly what buildContainer normalises
 * for author-written action rows.
 */
function actionFooterRow(group) {
  const row = {
    id: gymUuid('bp', bp.form.name, `${group.id}/actionsRow`),
    type: 'container', version: ver('container'),
    componentName: `${group.componentName}Row`,
    direction: 'horizontal', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap',
    gap: themePx('2', 8), stylingBox: '{}',
    desktop: {
      display: 'flex', flexDirection: 'row', flexWrap: 'nowrap',
      justifyContent: isCaptureFooter() ? 'flex-end' : 'flex-start',
      alignItems: 'center',
      gap: `${themePx('2', 8)}px`,
      dimensions: { width: '100%', height: 'auto', minHeight: 'auto', maxHeight: 'auto', minWidth: '0px', maxWidth: '100%' },
      stylingBox: '{}',
    },
    components: [group],
  };
  group.parentId = row.id;
  return row;
}

// ---- block instantiation: page chrome comes from the BLOCK LIBRARY -----------
// assets/blocks/*.block.json used to be hand-composition-only: a model read the
// subtree and filled the placeholders by hand. That left the compiler emitting the
// neutral floor and nothing else — technically styled, but no page anatomy.
//
// A block is a `subtree` plus two model-filled schemes:
//   "$binding:x"  a FACT the filler must supply (a title, a reflist identity, …)
//   "$slot:y"     a structural hole (here: a generated id)
// and a paired ../shesha-design-system/assets/block-styles/<overlay>.style.json whose
// `targets` are keyed by componentName and whose values may carry "$role:token"
// placeholders that resolve against the ACTIVE THEME.
//
// This resolver instantiates a block deterministically:
//   * every node gets a compiler id (gymUuid over form name + id scope) and the KB
//     version for its type — the block files' own hardcoded versions are re-stamped,
//     so a KB bump can never leave chrome on a stale version [R-003]
//   * "$binding:x" resolves from the facts dict; UNRESOLVABLE drops the owning node
//     (never a literal — asserted below), "$slot:y" becomes a deterministic id
//   * the paired overlay is merged per componentName, "$role:t" through tk(); a role
//     the active theme does not define is DROPPED rather than emitted as a literal
//   * measured no-op breakpoint channels are stripped per type [R-053] and a text
//     node that ends up with a font colour gets contentType:"custom" [R-052]
//   * container flex intent declared at the block root is mirrored into `desktop`,
//     because the 0.45 renderer reads the flex model from there [R-029/R-030]
const BLOCK_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'blocks');
const BLOCK_STYLE_DIR = path.join(SCRIPT_DIR, '..', '..', 'shesha-design-system', 'assets', 'block-styles');

/** measured no-op appearance channels per component type — same normalisation as validate-guardrails' R-053 */
const noopChannels = (() => {
  let matrix;
  const cache = new Map();
  return (type) => {
    if (matrix === undefined) {
      try { matrix = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'measured-capability-matrix.json'), 'utf8').replace(/^﻿/, '')); }
      catch { matrix = null; }
    }
    if (!matrix) return null;
    if (cache.has(type)) return cache.get(type);
    const byPath = new Map();
    for (const [key, val] of Object.entries(matrix.components?.[type]?.settings ?? {})) {
      const p = key.split('=')[0];
      if (!/^(desktop|tablet|mobile)\./.test(p)) continue;
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(val);
    }
    const set = new Set();
    for (const [p, variants] of byPath) {
      const real = variants.filter((v) => v.effect !== 'not-measured' && v.effect !== 'unknown');
      if (!real.length || !real.every((v) => v.effect === 'no-op') || !real.every((v) => v.bucket === 'appearance')) continue;
      set.add(p);
    }
    cache.set(type, set);
    return set;
  };
})();

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** delete a dotted path from an object (used to strip measured no-op channels) */
function unsetPath(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const k of parts.slice(0, -1)) { if (!isPlain(cur)) return; cur = cur[k]; }
  if (isPlain(cur)) delete cur[parts[parts.length - 1]];
}

/** deep-merge `src` into `dst` (objects merge, everything else overwrites) */
function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isPlain(v)) { if (!isPlain(dst[k])) dst[k] = {}; deepMerge(dst[k], v); }
    else dst[k] = v;
  }
  return dst;
}

/** resolve every "$role:token" inside an overlay value; a role the theme lacks → undefined (key dropped) */
function resolveRoles(value) {
  if (typeof value === 'string') {
    const m = /^\$role:(.+)$/.exec(value);
    if (!m) return value;
    return tk(m[1], undefined);
  }
  if (Array.isArray(value)) return value.map(resolveRoles).filter((v) => v !== undefined);
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) { const r = resolveRoles(v); if (r !== undefined) out[k] = r; }
    return out;
  }
  return value;
}

/**
 * Instantiate one block into a ready component node.
 * @param {string} name         block file base name (assets/blocks/<name>.block.json)
 * @param {object} opts.facts   values for the block's "$binding:x" placeholders
 * @param {string} opts.idScope id-key prefix — deterministic ids across recompiles [R-025]
 * @param {Set<string>} opts.prune componentNames to drop outright
 * @returns {object|null} the node, or null when the block (or its root) could not be filled
 */
function instantiateBlock(name, { facts = {}, idScope, prune = new Set() } = {}) {
  const block = readJson(path.join(BLOCK_DIR, `${name}.block.json`));
  if (!block?.subtree) {
    console.error(`WARN: block "${name}" not found in ${BLOCK_DIR} — chrome for this archetype is skipped`);
    return null;
  }
  const overlay = readJson(path.join(BLOCK_STYLE_DIR, `${block.$styleOverlay ?? name}.style.json`));
  const targets = overlay?.targets ?? {};

  /** resolve placeholders inside a value; returns {value, missing:[]} */
  function fill(value, idKey) {
    const missing = [];
    const walk = (v) => {
      if (typeof v === 'string') {
        const b = /^\$binding:(.+)$/.exec(v);
        if (b) {
          const got = facts[b[1]];
          if (got === undefined || got === null || got === '') { missing.push(b[1]); return undefined; }
          return got;
        }
        const s = /^\$slot:(.+)$/.exec(v);
        if (s) return gymUuid('bp', bp.form.name, `${idKey}/slot/${s[1]}`);
        return v;
      }
      if (Array.isArray(v)) return v.map(walk).filter((x) => x !== undefined);
      if (isPlain(v)) {
        const out = {};
        for (const [k, x] of Object.entries(v)) { const r = walk(x); if (r !== undefined) out[k] = r; }
        return out;
      }
      return v;
    };
    return { value: walk(value), missing };
  }

  function visit(raw, idPath) {
    if (!isPlain(raw) || typeof raw.type !== 'string') return null;
    const cname = raw.componentName ?? raw.propertyName ?? raw.type;
    if (prune.has(cname)) return null;
    const idKey = `${idScope}/${idPath}/${cname}`;

    const kids = Array.isArray(raw.components) ? raw.components : null;
    const { components, ...rest } = raw;
    const { value: node, missing } = fill(rest, idKey);
    // A block placeholder the compiler cannot fill from blueprint/entity facts is a
    // hole in the DESIGN, not something to paper over with a literal: drop the node.
    if (missing.length) return null;

    node.id = gymUuid('bp', bp.form.name, idKey);
    node.version = ver(node.type);

    // overlay (theme roles resolved) then the compiler's own token defaults on top
    const t = targets[cname];
    if (t) for (const bpk of ['desktop', 'tablet', 'mobile']) {
      const blk = resolveRoles(t[bpk]);
      if (isPlain(blk) && Object.keys(blk).length) deepMerge(node[bpk] = node[bpk] ?? {}, blk);
    }

    // a container's flex model must live in `desktop` or children stack [R-029]
    if (node.type === 'container') {
      // A block's `gap: "16"` is a LITERAL px value — the block files were hand-authored
      // and live-validated in px, unlike a blueprint's gap, where a numeric string is a
      // step on the theme spacing scale ('16' → spacing.16 → 64px). Reading them the same
      // way blew the band's 16px title gap out to 64px.
      const gapPx = /^\d+(\.\d+)?$/.test(String(node.gap ?? '')) ? Number(node.gap) : resolveSpace(node.gap, themePx('3', 12));
      const dk = node.desktop = node.desktop ?? {};
      dk.display = 'flex';
      dk.flexDirection = node.flexDirection ?? 'column';
      dk.flexWrap = node.flexWrap ?? 'nowrap';
      dk.justifyContent = node.justifyContent ?? 'flex-start';
      dk.alignItems = node.alignItems ?? 'stretch';
      dk.gap = `${gapPx}px`;
      dk.dimensions = { width: '100%', height: 'auto', minHeight: 'auto', maxHeight: 'auto', minWidth: '0px', maxWidth: '100%', ...(dk.dimensions ?? {}) };
      dk.stylingBox = dk.stylingBox ?? '{}';
      node.gap = gapPx;                    // root duplicate as a NUMBER, matching the compiler's own containers
      node.display = 'flex';
      node.direction = dk.flexDirection === 'row' ? 'horizontal' : 'vertical';
      node.stylingBox = dk.stylingBox;
    }

    // measured-channel hygiene: no authored no-op, and text ink needs the custom gate
    const noops = noopChannels(node.type);
    if (noops) for (const ch of noops) {
      if (node.type === 'text' && /\.font\.color$/.test(ch)) continue; // owned by R-052, satisfied below
      unsetPath(node, ch);
    }
    if (node.type === 'text') {
      const coloured = ['desktop', 'tablet', 'mobile'].some((b) => node[b]?.font?.color);
      if (coloured) node.contentType = 'custom';
    }
    // The block library predates R-028: several blocks reach for `customStyle` to set
    // display/flex, which the 0.45 renderer ignores outright. Drop those — the pill's
    // shape comes from the component itself (solidBackground + the reference-list item
    // colours [R-036]), and a split is sized with desktop.dimensions.width. customStyle
    // that carries no flex intent (letter-spacing, text-transform) is left alone.
    if (node.customStyle && /\b(flex|display)\b/.test(JSON.stringify(node.customStyle))) delete node.customStyle;

    if (kids) {
      const out = [];
      kids.forEach((child, i) => {
        const c = visit(child, `${idPath}/${i}`);
        if (!c) return;
        c.parentId = node.id;
        out.push(c);
      });
      node.components = out;
    }
    return node;
  }

  const root = visit(block.subtree, 'root');
  if (!root) return null;
  // A "$binding:"/"$slot:" literal in shipped markup renders as that literal text —
  // a class of bug the resolver must make impossible, not merely unlikely.
  const text = JSON.stringify(root);
  if (/\$binding:|\$slot:|\$role:/.test(text)) {
    console.error(`BLOCK RESOLVER ERROR — block "${name}" emitted an unresolved placeholder, nothing written:`);
    for (const m of new Set(text.match(/\$(?:binding|slot|role):[A-Za-z0-9_.]+/g) ?? [])) console.error(`  FAIL ${m}`);
    process.exit(2);
  }
  return root;
}

// ---- per-archetype page chrome ----------------------------------------------
// Page archetypes get anatomy ABOVE the blueprint's content, inside the page root:
//   table-worklist            → page-header band
//   record-detail | hub       → page-header band + meta strip (native KeyInformationBar)
//   dashboard                 → page-header band + a `statistic` stat-tile row
//   capture | modal-dialog | auth-page | wizard | … → NOTHING. A dialog or a login
//   page has no page anatomy; giving them a band would be a design error, not a floor.
const PAGE_ARCHETYPES = new Set(['table-worklist', 'record-detail', 'hub', 'dashboard']);
// Blueprint opt-out: `"chrome": false` on the blueprint ROOT (a root-level key — the
// blueprint schema constrains layout-NODE keys, not root keys, so this needs no schema
// change). Use it when the design genuinely has no page header, e.g. a screen embedded
// in a host page that already draws one.
const chromeEnabled = bp.chrome !== false && PAGE_ARCHETYPES.has(bp.archetype);

/** the reflist status fact, from live metadata first, else an explicit blueprint binding */
function statusFact() {
  for (const b of bp.bindings ?? []) {
    if (!STATUS_PROP.test(String(b.property ?? ''))) continue;
    const live = propsMeta?.get(String(b.property).toLowerCase());
    if (live?.referenceListName) {
      return { property: b.property, module: live.referenceListModule ?? null, name: live.referenceListName.split('.').pop() };
    }
    // No live backend (--no-live) → the identity may ride on the binding itself as
    // `referenceList: {module, name}`, which is what comprehension READ off metadata.
    // Identity is never GUESSED [R-015]: no live metadata and no declared identity
    // means no chip, because an unidentified reference list renders EMPTY.
    if (b.referenceList?.name) return { property: b.property, module: b.referenceList.module ?? null, name: b.referenceList.name.split('.').pop() };
  }
  return null;
}

/**
 * Pull the band's content out of the blueprint layout, MUTATING a shallow clone of
 * layout.children: a leading level-1 heading becomes the band title (leaving it in the
 * body too would ship two page titles), and a top-level actions/buttonGroup node
 * becomes the band's header actions (page actions belong in the band).
 */
function harvestChrome(layout) {
  const out = { title: bp.screen ?? bp.form?.label ?? titleCase(bp.form.name), subtitle: bp.subtitle ?? null, actions: null };
  if (!Array.isArray(layout.children)) return out;
  const kids = layout.children.slice();
  if (kids[0]?.kind === 'heading' && (kids[0].level ?? 2) === 1 && (kids[0].content ?? kids[0].title)) {
    out.title = kids.shift().content ?? out.title;
    if (!out.subtitle && kids[0]?.kind === 'text' && kids[0].content) out.subtitle = kids.shift().content;
  }
  const ai = kids.findIndex((k) => k.kind === 'actions' || k.kind === 'buttonGroup');
  if (ai >= 0) out.actions = kids.splice(ai, 1)[0];
  layout.children = kids;
  return out;
}

/**
 * The page-header band [block: page-header-band].
 * ONE band builder, two callers: the per-archetype chrome below, and a blueprint node
 * that declares `presentation.recipe: "page-header-band"` (which passes its own idScope,
 * so the band's ids follow the node's position). The archetype chrome stands down when a
 * node declares the recipe — see `bandDeclared` at the assemble step; that is what makes
 * a double band impossible rather than merely unlikely.
 */
function chromeBand(harvest, status, idScope = `${bp.form.name}/chrome/band`) {
  const prune = new Set();
  if (!harvest.subtitle) prune.add('breadcrumbTrail');
  if (!status) prune.add('statusChip');
  if (!harvest.actions) prune.add('headerActions');
  const band = instantiateBlock('page-header-band', {
    idScope,
    prune,
    // `facts` fills the inline "$binding:x" placeholders. The block's `$bindings` array
    // ALSO declares dotted paths (subtree.components.0.content._code, …) for values the
    // block spells out in full rather than as a placeholder — those indices are into the
    // UNPRUNED subtree, so pruning invalidates them; the compiler fills them by
    // componentName below instead, which survives any prune.
    facts: {
      referenceListModule: status?.module ?? null,
      referenceListName: status?.name,
    },
  });
  if (!band) return null;

  // ---- fill the band from blueprint facts + theme tokens ---------------------
  const find = (cname) => {
    let hit = null;
    (function walk(n) { if (hit || !isPlain(n)) return; if (n.componentName === cname) { hit = n; return; } for (const c of n.components ?? []) walk(c); })(band);
    return hit;
  };
  // band surface: the overlay's $role:surfaceCard is not a role any theme defines, so
  // the band background/hairline come from the chrome roles (bandBg is where shesha-bold
  // visibly parts company with shesha: a brand tint instead of a white surface).
  band.desktop.background = { type: 'color', color: tk('bandBg', '#ffffff') };
  band.desktop.border = { radiusType: 'all', borderType: 'custom', border: { bottom: { width: '1px', style: 'solid', color: tk('bandBorder', '#e5e7eb') } }, radius: { all: 0 } };
  band.desktop.stylingBox = JSON.stringify({
    paddingTop: String(themePx('3', 12)), paddingBottom: String(themePx('3', 12)),
    paddingLeft: String(themePx('4', 16)), paddingRight: String(themePx('4', 16)),
  });
  band.stylingBox = band.desktop.stylingBox;

  const crumb = find('breadcrumbTrail');
  if (crumb) {
    // $bindings path subtree.components.0.content._code — "JS returning the breadcrumb
    // string". The compiler knows the trail as a literal, so it returns that literal
    // rather than reaching into `data` for fields it cannot prove exist.
    crumb.content = { _mode: 'code', _code: `return ${JSON.stringify(String(harvest.subtitle))};` };
    crumb.desktop = deepMerge(crumb.desktop ?? {}, { font: { size: tk('type.scale.micro', 12), weight: String(tk('type.weights.regular', 400)), color: tk('bandSubtext', '#6b7280'), align: 'left' } });
    crumb.contentType = 'custom';
  }
  const title = find('titleText');
  if (title) {
    title.content = String(harvest.title);
    title.propertyName = 'pageTitle';
    title.label = 'Page title';
    title.desktop = deepMerge(title.desktop ?? {}, { font: { size: tk('type.scale.title', 24), weight: String(tk('type.weights.semibold', 600)), color: tk('bandText', '#181818'), align: 'left' } });
    title.contentType = 'custom';
  }
  const chip = find('statusChip');
  if (chip && status) {
    chip.propertyName = status.property;
    chip.referenceListId = { module: status.module ?? null, name: status.name };
  }
  const left = find('titleLeft');
  const actions = find('headerActions');
  if (left) {
    // the ONLY split lever is desktop.dimensions.width [R-028]; the band's titleRow gap is 16
    left.desktop.dimensions = { ...left.desktop.dimensions, width: actions ? 'calc(100% - 220px)' : '100%' };
  }
  if (actions && harvest.actions) {
    // reuse the compiler's own action machinery so band buttons obey [R-007]/[R-008]
    const group = floorButtonGroup(idScope, harvest.actions);
    actions.items = group.items.map((it) => ({ ...it, id: gymUuid('bp', bp.form.name, `${idScope}/action/${it.name}`) }));
  }
  return band;
}

/**
 * The meta strip, carried by the NATIVE KeyInformationBar (the registry says it exists,
 * is authorable and declares a `columns` slot) rather than the hand-composed container
 * strip — a native carrier is one component instead of nine, and its dividers/gap are
 * measured. Cells are the first three non-status bindings, label + mustache value.
 */
function chromeMetaStrip() {
  const cells = (bp.bindings ?? []).filter((b) => b.property && !STATUS_PROP.test(b.property)).slice(0, 3);
  if (cells.length < 2) return null;
  const idScope = `${bp.form.name}/chrome/meta`;
  const kib = {
    id: gymUuid('bp', bp.form.name, `${idScope}/bar`),
    type: 'KeyInformationBar', version: ver('KeyInformationBar'),
    componentName: 'metaStrip', propertyName: 'metaStrip',
    label: 'Key information', hideLabel: true, hidden: false,
    orientation: 'horizontal', alignItems: 'flex-start',
    gap: themePx('8', 32), dividerThickness: '1px', dividerColor: tk('divider', '#f0f0f0'), dividerHeight: 60,
    desktop: {
      background: { type: 'color', color: tk('cardBg', '#ffffff') },
      dimensions: { width: '100%', height: 'auto', minWidth: '0px', maxWidth: '100%' },
    },
    columns: cells.map((b, i) => {
      const colId = gymUuid('bp', bp.form.name, `${idScope}/col/${b.property}`);
      const mk = (kind, extra) => ({
        id: gymUuid('bp', bp.form.name, `${idScope}/col/${b.property}/${kind}`),
        type: 'text', version: ver('text'),
        componentName: `meta${kind}_${i + 1}`, propertyName: `meta${kind}_${i + 1}`,
        hideLabel: true, hidden: false, textType: 'span', contentDisplay: 'content',
        dataType: 'string', contentType: 'custom', ...extra,
      });
      return {
        id: colId, width: 220, textAlign: 'left', flexDirection: 'column', padding: '0px',
        components: [
          mk('Label', {
            content: String(b.label ?? titleCase(b.property)).toUpperCase(),
            desktop: { font: { size: tk('type.scale.micro', 12), weight: String(tk('type.weights.semibold', 600)), color: tk('bandSubtext', '#6b7280'), align: 'left' } },
            customStyle: { _mode: 'code', _code: "return { letterSpacing: '0.06em', textTransform: 'uppercase' };" },
          }),
          mk('Value', {
            content: `{{data.${b.property}}}`,
            desktop: { font: { size: tk('type.scale.body', 14), weight: String(tk('type.weights.regular', 400)), color: tk('bodyText', '#181818'), align: 'left' } },
          }),
        ],
      };
    }),
  };
  for (const col of kib.columns) for (const c of col.components) c.parentId = kib.id;
  return kib;
}

/**
 * Dashboard stat-tile row — one native `statistic` per data region in the layout.
 * The compiler cannot know a metric the blueprint never measured, so the value is the
 * em-dash default rather than an invented number; the row is the ANATOMY, and a
 * blueprint that later carries metrics fills the values.
 */
function chromeStatRow(layout) {
  const regions = [];
  // A tile's title is the human name of the region it summarises: the datatable node's own
  // title if it has one, else the enclosing card/section heading (which is where a blueprint
  // actually puts the human label), else the node name title-cased.
  (function walk(n, groupTitle) {
    if (!isPlain(n)) return;
    if (n.kind === 'datatable' || n.kind === 'datalist') regions.push({ ...n, $groupTitle: groupTitle });
    const next = ((n.kind === 'card' || n.kind === 'section') && n.title) ? n.title : groupTitle;
    for (const c of n.children ?? []) walk(c, next);
  })(layout, null);
  if (!regions.length) return null;
  const idScope = `${bp.form.name}/chrome/stats`;
  const tiles = regions.slice(0, 4).map((r, i) => ({
    id: gymUuid('bp', bp.form.name, `${idScope}/tile/${r.name ?? i}`),
    type: 'statistic', version: ver('statistic'),
    componentName: `statTile${i + 1}`, propertyName: `statTile${i + 1}`,
    hideLabel: true, hidden: false,
    title: String(r.title ?? r.$groupTitle ?? titleCase(r.name ?? `region ${i + 1}`)),
    value: '—',
    titleFont: { size: tk('type.scale.micro', 12), weight: String(tk('type.weights.semibold', 600)), color: tk('bandSubtext', '#6b7280'), align: 'left' },
    valueFont: { size: tk('type.scale.title', 24), weight: String(tk('type.weights.semibold', 600)), color: tk('statTileValue', '#181818'), align: 'left' },
    desktop: {
      background: { type: 'color', color: tk('statTileBg', '#ffffff') },
      border: { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: tk('hairline', '#e5e7eb') } }, radius: { all: tk('cardRadius', 8) } },
      dimensions: { width: `calc((100% - ${(Math.min(regions.length, 4) - 1) * themePx('4', 16)}px) / ${Math.min(regions.length, 4)})`, height: 'auto', minWidth: '0px', maxWidth: '100%' },
      stylingBox: paddingBox('4'),
    },
  }));
  const row = {
    id: gymUuid('bp', bp.form.name, `${idScope}/row`),
    type: 'container', version: ver('container'),
    componentName: 'statTileRow', propertyName: 'statTileRow',
    direction: 'horizontal', display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
    gap: themePx('4', 16), stylingBox: '{}',
    desktop: {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      justifyContent: 'flex-start', alignItems: 'stretch', gap: `${themePx('4', 16)}px`,
      dimensions: { width: '100%', height: 'auto', minHeight: 'auto', maxHeight: 'auto', minWidth: '0px', maxWidth: '100%' },
      stylingBox: '{}',
    },
    components: tiles,
  };
  for (const t of tiles) t.parentId = row.id;
  return row;
}

// ---- presentation IR ---------------------------------------------------------
// A layout node may carry a `presentation` block (blueprint schema $defs.presentation):
//   recipe    a block from assets/blocks/, instantiated AT THIS NODE through the same
//             instantiateBlock resolver the archetype chrome uses — one resolver, not two
//   role      what the node IS: title → heading · status → refListStatus chip ·
//             metric → statistic tile · meta → KeyInformationBar strip · body → no-op
//   tone      a colour ROLE resolved through the ACTIVE theme, never a colour
//   surface   card | band | plain
//   overrides a dotted path under the emitted `desktop` block → a TOKEN PATH
// The theme (--theme) stays the only styling input [R-042]: nothing here reads a literal
// colour or size, and an unknown token path FAILS the compile rather than degrading.

/**
 * tone → token paths. Fallbacks are deliberately NEUTRAL (grey ink / grey surfaces), so
 * `--no-style` and an unknown theme emit no brand or semantic colour at all [R-042]. A
 * theme that does not define a semantic colour (requirements-studio ships no
 * palette.semantic.success) therefore resolves that tone to neutral ink — add the token to
 * the theme rather than hardcoding the colour here.
 */
const TONE_TOKENS = {
  accent: { fg: ['palette.brand.primary', '#181818'], bg: ['palette.brand.tint', '#f0f2f5'], border: ['palette.brand.primary', '#d0d5e0'] },
  neutral: { fg: ['palette.ink.primary', '#181818'], bg: ['palette.surfaces.surface', '#ffffff'], border: ['palette.lines.border', '#e5e7eb'] },
  success: { fg: ['palette.semantic.success', '#181818'], bg: ['palette.semantic.successBg', '#f0f2f5'], border: ['palette.semantic.successBorder', '#d0d5e0'] },
  warning: { fg: ['palette.semantic.warning', '#181818'], bg: ['palette.semantic.warningBg', '#f0f2f5'], border: ['palette.semantic.warningBorder', '#d0d5e0'] },
  danger: { fg: ['palette.semantic.danger', '#181818'], bg: ['palette.semantic.dangerBg', '#f0f2f5'], border: ['palette.semantic.dangerBorder', '#d0d5e0'] },
};
const toneColours = (tone) => {
  const t = TONE_TOKENS[tone];
  if (!t) return null;
  return { fg: tk(t.fg[0], t.fg[1]), bg: tk(t.bg[0], t.bg[1]), border: tk(t.border[0], t.border[1]) };
};
// The types whose surface/ink channels the measured matrix proves render. refListStatus is
// absent on purpose: EVERY appearance channel on it is a measured no-op [R-053] — its
// colour comes from the reference-list items [R-036] — so a tone on a chip is a no-op here
// too, by design rather than by omission.
const TONEABLE = new Set(['text', 'statistic', 'container', 'card', 'datatable', 'KeyInformationBar']);
const SURFACEABLE = new Set(['container', 'card', 'statistic', 'KeyInformationBar']);

/** every declared recipe, in compile order — written to the <out>.presentation.json sidecar */
const presentationDeclared = [];

/** a reference-list identity for a property: live metadata first, else the blueprint binding [R-015] */
function reflistIdentity(prop) {
  if (!prop) return null;
  const live = propsMeta?.get(String(prop).toLowerCase());
  if (live?.referenceListName) {
    return { property: prop, module: live.referenceListModule ?? null, name: live.referenceListName.split('.').pop() };
  }
  const b = bindingIndex.get(prop);
  if (b?.referenceList?.name) return { property: prop, module: b.referenceList.module ?? null, name: b.referenceList.name.split('.').pop() };
  return null;
}

/** the band facts carried by a NODE (rather than by the whole blueprint, as harvestChrome does) */
function harvestFromNode(node) {
  const kids = Array.isArray(node.children) ? node.children : [];
  const heading = kids.find((k) => k.kind === 'heading');
  const text = kids.find((k) => k.kind === 'text' && (k.content ?? '').trim());
  const actions = kids.find((k) => k.kind === 'actions' || k.kind === 'buttonGroup');
  return {
    title: heading?.content ?? heading?.title ?? node.title ?? bp.screen ?? titleCase(bp.form.name),
    subtitle: text?.content ?? bp.subtitle ?? null,
    actions: actions ?? null,
  };
}

/** the facts a block's "$binding:x" placeholders can be filled from, for a node-level recipe */
function recipeFacts(node) {
  const st = reflistIdentity(node.property) ?? statusFact();
  return {
    statusPropertyName: node.property ?? st?.property,
    referenceListModule: st?.module ?? null,
    referenceListName: st?.name,
    rowProperty: node.property,
    rowLabel: node.title ?? (node.property ? titleCase(node.property) : undefined),
  };
}

/** instantiate the declared recipe at this node */
function recipeNode(node, idKey, recipe) {
  // page-header-band goes through the band builder, not raw instantiateBlock: the band
  // needs its title/subtitle/chip/actions filled, and that filling already exists.
  if (recipe === 'page-header-band') return chromeBand(harvestFromNode(node), statusFact(), `${idKey}/band`);
  return instantiateBlock(recipe, { idScope: idKey, facts: recipeFacts(node) });
}

/** role: status → a refListStatus CHIP, never prose */
function statusChipNode(node, idKey) {
  const prop = node.property ?? statusFact()?.property;
  if (!prop) { console.error('WARN: presentation.role "status" on a node with no property — skipped'); return null; }
  const id = reflistIdentity(prop);
  if (id?.name) {
    const pill = instantiateBlock('status-pill', {
      idScope: idKey,
      facts: { statusPropertyName: prop, referenceListModule: id.module ?? null, referenceListName: id.name },
    });
    // the block names its root "statusChip"; a page can hold more than one chip (the band
    // already carries one), so the blueprint's node name wins where it gave one
    if (pill) { if (node.name) pill.componentName = node.name; return pill; }
  }
  // No declared identity (--no-live, nothing on the binding) → still a chip. resolve-bindings
  // fills the identity from metadata [R-015]; an unidentified reference list renders EMPTY,
  // which is a binding gap, not a reason to fall back to text.
  if (!id?.name) console.error(`WARN: no reference-list identity for "${prop}" — the chip ships unidentified; run resolve-bindings [R-015]`);
  return {
    id: gymUuid('bp', bp.form.name, `${idKey}/chip`),
    type: 'refListStatus', version: ver('refListStatus'),
    componentName: node.name ?? `${prop}Chip`, propertyName: prop,
    label: titleCase(prop), hideLabel: true, showIcon: false,
    ...(id?.name ? { referenceListId: { module: id.module ?? null, name: id.name } } : {}),
  };
}

/** role: metric → a native `statistic` tile (same carrier as the dashboard stat row) */
function metricTile(node, idKey, pres) {
  const name = node.name ?? `metric${seq}`;
  const tone = toneColours(pres.tone) ?? { fg: tk('statTileValue', '#181818') };
  return {
    id: gymUuid('bp', bp.form.name, `${idKey}/metric`),
    type: 'statistic', version: ver('statistic'),
    componentName: name, propertyName: name,
    hideLabel: true, hidden: false,
    title: String(node.title ?? titleCase(name)),
    // the compiler never invents a number: an unmeasured metric is the em-dash default
    value: String(node.content ?? '—'),
    titleFont: { size: tk('type.scale.micro', 12), weight: String(tk('type.weights.semibold', 600)), color: tk('bandSubtext', '#6b7280'), align: 'left' },
    valueFont: { size: tk('type.scale.title', 24), weight: String(tk('type.weights.semibold', 600)), color: tone.fg, align: 'left' },
    desktop: {
      background: { type: 'color', color: tk('statTileBg', '#ffffff') },
      border: { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: tk('hairline', '#e5e7eb') } }, radius: { all: tk('cardRadius', 8) } },
      dimensions: { width: node.width ?? '100%', height: 'auto', minWidth: '0px', maxWidth: '100%' },
      stylingBox: paddingBox('4'),
    },
  };
}

/** role: meta → the native KeyInformationBar strip, one cell per bound child */
function metaBar(node, idKey) {
  const cells = (node.children ?? []).filter((c) => c.property);
  if (cells.length < 2) { console.error('WARN: presentation.role "meta" needs 2+ bound children — skipped'); return null; }
  const kib = {
    id: gymUuid('bp', bp.form.name, `${idKey}/meta`),
    type: 'KeyInformationBar', version: ver('KeyInformationBar'),
    componentName: node.name ?? 'metaStrip', propertyName: node.name ?? 'metaStrip',
    label: 'Key information', hideLabel: true, hidden: false,
    orientation: 'horizontal', alignItems: 'flex-start',
    gap: themePx('8', 32), dividerThickness: '1px', dividerColor: tk('divider', '#f0f0f0'), dividerHeight: 60,
    desktop: {
      background: { type: 'color', color: tk('cardBg', '#ffffff') },
      dimensions: { width: '100%', height: 'auto', minWidth: '0px', maxWidth: '100%' },
    },
    columns: cells.slice(0, 6).map((c, i) => {
      const label = c.title ?? bindingIndex.get(c.property)?.label ?? titleCase(c.property);
      const mk = (kind, extra) => ({
        id: gymUuid('bp', bp.form.name, `${idKey}/meta/${c.property}/${kind}`),
        type: 'text', version: ver('text'),
        componentName: `meta${kind}_${i + 1}`, propertyName: `meta${kind}_${i + 1}`,
        hideLabel: true, hidden: false, textType: 'span', contentDisplay: 'content',
        dataType: 'string', contentType: 'custom', ...extra,
      });
      return {
        id: gymUuid('bp', bp.form.name, `${idKey}/meta/${c.property}`),
        width: 220, textAlign: 'left', flexDirection: 'column', padding: '0px',
        components: [
          mk('Label', {
            content: String(label).toUpperCase(),
            desktop: { font: { size: tk('type.scale.micro', 12), weight: String(tk('type.weights.semibold', 600)), color: tk('bandSubtext', '#6b7280'), align: 'left' } },
          }),
          mk('Value', {
            content: `{{data.${c.property}}}`,
            desktop: { font: { size: tk('type.scale.body', 14), weight: String(tk('type.weights.regular', 400)), color: tk('bodyText', '#181818'), align: 'left' } },
          }),
        ],
      };
    }),
  };
  for (const col of kib.columns) for (const c of col.components) c.parentId = kib.id;
  return kib;
}

/**
 * recipe > role > (null → the node's own `kind`). A recipe is AUTHORITATIVE for its node:
 * whatever the kind would have emitted, the block replaces it, and the node's children are
 * the block's content facts rather than compiled siblings.
 */
function presentedNode(node, idKey, pres) {
  if (pres.recipe) {
    const built = recipeNode(node, idKey, pres.recipe);
    presentationDeclared.push({
      recipe: pres.recipe,
      node: node.name ?? node.property ?? node.kind,
      componentName: built?.componentName ?? null,
      type: built?.type ?? null,
      role: pres.role ?? null, tone: pres.tone ?? null, surface: pres.surface ?? null,
      landed: Boolean(built),
    });
    if (built) return built;
    // Declared and NOT landed is recorded, not swallowed: validate-styledness reads the
    // sidecar and fails the form, so a recipe that silently vanished cannot ship.
    console.error(`WARN: recipe "${pres.recipe}" could not be instantiated at ${node.name ?? node.kind} — falling back to the node's own kind`);
  }
  switch (pres.role) {
    case 'status': return statusChipNode(node, idKey);
    case 'metric': return metricTile(node, idKey, pres);
    case 'meta': return metaBar(node, idKey);
    // a title is the existing heading path — level 1 unless the node says otherwise
    case 'title': return compileKind({ ...node, kind: 'heading', level: node.level ?? 1 }, idKey);
    default: return null;   // body | undefined → the node's own kind
  }
}

/** set a dotted path on an object, creating plain objects on the way down */
function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const k of parts.slice(0, -1)) {
    if (!isPlain(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function applyTone(comp, tone) {
  const t = toneColours(tone);
  if (!t || !TONEABLE.has(comp.type)) return;
  if (comp.type === 'statistic') { comp.valueFont = { ...(comp.valueFont ?? {}), color: t.fg }; return; }
  const dk = comp.desktop = comp.desktop ?? {};
  if (comp.type === 'text') {
    dk.font = { ...(dk.font ?? {}), color: t.fg };
    comp.contentType = 'custom';   // without it the ink never reaches the DOM [R-052]
    return;
  }
  dk.background = { type: 'color', color: t.bg };
  const radius = dk.border?.radius ?? { all: tk('cardRadius', 8) };
  dk.border = { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: t.border } }, radius };
}

function applySurface(comp, node, surface) {
  if (!surface || !SURFACEABLE.has(comp.type)) return;
  const dk = comp.desktop = comp.desktop ?? {};
  if (surface === 'card') { applyCardSurface(dk, node); return; }
  if (surface === 'band') {
    dk.background = { type: 'color', color: tk('bandBg', '#ffffff') };
    dk.border = { radiusType: 'all', borderType: 'custom', border: { bottom: { width: '1px', style: 'solid', color: tk('bandBorder', '#e5e7eb') } }, radius: { all: 0 } };
    if (node.padding === undefined) {
      dk.stylingBox = JSON.stringify({
        paddingTop: String(themePx('3', 12)), paddingBottom: String(themePx('3', 12)),
        paddingLeft: String(themePx('4', 16)), paddingRight: String(themePx('4', 16)),
      });
      comp.stylingBox = dk.stylingBox;
    }
    return;
  }
  // plain: no surface at all
  delete dk.background; delete dk.border; delete dk.shadow;
}

/**
 * overrides: `"<dotted path under desktop>": "<token path>"`, plus the two structural
 * aliases `gap` and `padding` (spacing tokens). The value is resolved against the ACTIVE
 * theme token file; an unknown path is a COMPILE ERROR naming the path — a token that does
 * not exist is a design defect, not something to fall back from.
 */
function applyOverrides(comp, node, overrides, idKey) {
  for (const [prop, tokenPath] of Object.entries(overrides ?? {})) {
    if (!TOK) {
      console.error(`NOTE: --no-style / unknown theme — override ${prop} → ${tokenPath} not resolved (neutral output) [R-042]`);
      continue;
    }
    const value = tkRaw(tokenPath);
    if (value === undefined || value === null || isPlain(value)) {
      console.error(`OVERRIDE ERROR — unknown token path "${tokenPath}" (presentation.overrides.${prop} on ${node.name ?? node.kind}) in theme "${themeName}", nothing written:`);
      console.error(`  FAIL the active theme file defines no ${tokenPath}. Token paths only [R-042]: spacing.* · radius.* · palette.* · type.* · shadow.*`);
      process.exit(2);
    }
    if (prop === 'gap') {
      const px = Number(value);
      const dk = comp.desktop = comp.desktop ?? {};
      dk.gap = `${px}px`;
      if (comp.type === 'container') comp.gap = px;
      continue;
    }
    if (prop === 'padding') {
      const box = JSON.stringify({ paddingTop: String(value), paddingRight: String(value), paddingBottom: String(value), paddingLeft: String(value) });
      const dk = comp.desktop = comp.desktop ?? {};
      dk.stylingBox = box;
      if (comp.type === 'container') comp.stylingBox = box;
      continue;
    }
    // `statistic` carries its type on titleFont/valueFont, not on a desktop.font block
    if (comp.type === 'statistic' && prop.startsWith('font.')) {
      const key = prop.slice('font.'.length);
      comp.valueFont = { ...(comp.valueFont ?? {}), [key]: value };
      continue;
    }
    // an appearance channel the matrix records as a no-op is not styling — refuse to author it
    if (noopChannels(comp.type)?.has(`desktop.${prop}`)) {
      console.error(`WARN: override ${prop} on ${comp.type} is a measured no-op channel [R-053] — skipped`);
      continue;
    }
    setPath(comp.desktop = comp.desktop ?? {}, prop, value);
    if (comp.type === 'text' && prop.startsWith('font.color')) comp.contentType = 'custom';
  }
  void idKey;
}

function applyPresentation(comp, node, pres, idKey) {
  if (!comp || typeof comp !== 'object') return comp;
  applyTone(comp, pres.tone);
  applySurface(comp, node, pres.surface);
  applyOverrides(comp, node, pres.overrides, idKey);
  return comp;
}

/** every recipe the blueprint DECLARES, read off the layout before anything compiles */
const declaredRecipes = (() => {
  const out = new Set();
  (function walk(n) {
    if (!isPlain(n)) return;
    if (n.presentation?.recipe) out.add(n.presentation.recipe);
    for (const c of n.children ?? []) walk(c);
  })(bp.layout);
  return out;
})();

// ---- page chrome -------------------------------------------------------------
// validate-styledness.js requires page ground (a root background / sha-page /
// hideHeading) in the first root components. Before, only kind:"card" roots got a
// background, so a stack/region/row root compiled to markup that failed the
// compiler's OWN gate. Page ground is now stamped at the form root regardless of
// root kind — same mechanism as the card surface, pageBg token instead of cardBg.
function stampPageChrome(node) {
  const surfaceable = node.type === 'container' || node.type === 'card';
  if (!surfaceable) {
    // datatable/datalist roots compile to a dataContext, whose desktop block is not
    // a measured surface — wrap it in a page-root container that carries the ground.
    const wrapper = {
      id: gymUuid('bp', bp.form.name, `${bp.form.name}/pageRoot`),
      type: 'container', version: ver('container'),
      componentName: 'pageRoot',
      direction: 'vertical', display: 'flex', flexDirection: 'column', gap: 12, flexWrap: 'nowrap',
      stylingBox: '{}',
      desktop: {
        display: 'flex', flexDirection: 'column', flexWrap: 'nowrap',
        justifyContent: 'flex-start', alignItems: 'stretch', gap: '12px',
        dimensions: { width: '100%', height: 'auto', minHeight: 'auto', maxHeight: 'auto', minWidth: '0px', maxWidth: '100%' },
        stylingBox: '{}',
      },
      components: [node],
    };
    node.parentId = wrapper.id;
    return stampPageChrome(wrapper);
  }
  node.desktop = node.desktop ?? {};
  // a card root already carries its own surface — don't overwrite it
  if (!node.desktop.background) node.desktop.background = { type: 'color', color: tk('pageBg', '#f5f6f8') };
  return node;
}

// ---- assemble ------------------------------------------------------------------
// Chrome is harvested from the blueprint BEFORE the content compiles: harvestChrome
// mutates a shallow clone of layout.children (a leading h1 and a top-level action row
// move INTO the band instead of being duplicated below it).
// An explicit `presentation.recipe: "page-header-band"` on a node is AUTHORITATIVE for the
// band: the archetype chrome stands down (no second band), and the harvest does not run —
// the declaring node's own children are the band's title/subtitle/actions.
const bandDeclared = declaredRecipes.has('page-header-band');
const harvestable = chromeEnabled && !bandDeclared;
const layout = harvestable ? { ...bp.layout, children: [...(bp.layout.children ?? [])] } : bp.layout;
const harvest = harvestable ? harvestChrome(layout) : null;
const pageRoot = stampPageChrome(compileNode(layout, bp.form.name));

if (chromeEnabled) {
  const status = statusFact();
  const chrome = [bandDeclared ? null : chromeBand(harvest, status)];
  if (bp.archetype === 'record-detail' || bp.archetype === 'hub') chrome.push(chromeMetaStrip());
  if (bp.archetype === 'dashboard') chrome.push(chromeStatRow(layout));
  const stamped = chrome.filter(Boolean);
  for (const c of stamped) c.parentId = pageRoot.id;
  const kids = pageRoot.components ?? [];
  if (bandDeclared) {
    // the rest of the chrome goes AFTER the blueprint's own band, or the page would open
    // with a meta strip and the page-anatomy floor would (correctly) fail
    const at = kids.findIndex((c) => c.componentName === 'pageHeaderBand');
    pageRoot.components = at >= 0 ? [...kids.slice(0, at + 1), ...stamped, ...kids.slice(at + 1)] : [...stamped, ...kids];
  } else {
    pageRoot.components = [...stamped, ...kids];
  }
  const names = [bandDeclared ? 'pageHeaderBand (blueprint-declared)' : null, ...stamped.map((c) => c.componentName)].filter(Boolean);
  console.error(`chrome (${bp.archetype}): ${names.join(' + ') || '(none resolvable)'}`);
}

const rootChildren = [pageRoot];

// floor: capture archetypes always get validationErrors + Submit/exit pair
// [R-006/R-007/R-020] (CAPTURE_ARCHETYPES is declared up top — buildContainer
// needs it while the tree compiles)
const treeText = JSON.stringify(rootChildren);
if (CAPTURE_ARCHETYPES.has(bp.archetype)) {
  if (!treeText.includes('"validationErrors"')) {
    rootChildren.push({
      id: gymUuid('bp', bp.form.name, 'validationErrors'),
      type: 'validationErrors', version: ver('validationErrors'),
      componentName: 'formValidationErrors',
    });
  }
  // the appended pair lands in its own right-aligned footer row [R-057]
  if (!treeText.includes('"Submit"')) rootChildren.push(actionFooterRow(floorButtonGroup('floor')));
}
for (const c of rootChildren) c.parentId = 'root';

// ---- slot-aware nesting guard --------------------------------------------------
// Some 0.45 components do not host children in a plain `components` array: they
// declare NAMED slots (a card's header/content, a tabs' tabs, a wizard's steps).
// A child emitted into `components` on such a component is silently DROPPED by the
// renderer — the markup validates, the screen comes up empty. assets/component-
// registry.json is the shape authority for which slots exist, so the guard reads
// customContainerNames from there rather than hard-coding a list.
//
// Registry absent, or a type it does not know → no check (the registry says what
// EXISTS; a gap in it must never invent a compile error). As of the committed
// registry, 8 components declare slots (card, collapsiblePanel, tabs, wizard,
// columns, sizableColumns, searchableTabs, KeyInformationBar); the compiler only
// ever emits one of them (tabs) and it emits into `tabs`, so today this guard is a
// no-op that pins that invariant and catches the next slotted emitter.
{
  const REG = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'component-registry.json'), 'utf8').replace(/^﻿/, '')); }
    catch { return null; }
  })();
  const slotErrors = [];
  if (REG?.components) {
    (function walk(node, where) {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
      if (!node || typeof node !== 'object') return;
      const slots = typeof node.type === 'string' ? REG.components[node.type]?.customContainerNames : null;
      if (Array.isArray(slots) && slots.length && !slots.includes('components')
          && Array.isArray(node.components) && node.components.length) {
        slotErrors.push(
          `${where} (${node.type}${node.componentName ? ` "${node.componentName}"` : ''}): ${node.components.length} child(ren) emitted into \`components\`, `
          + `but the registry declares named slots for this type — valid slots are ${slots.map((s) => `\`${s}\``).join(', ')}. `
          + 'The renderer reads children from the named slot only, so these children would never render.',
        );
      }
      for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, `${where}.${k}`);
    })(rootChildren, 'components');
  }
  if (slotErrors.length) {
    console.error(`SLOT NESTING ERROR — ${slotErrors.length} misplaced child set(s), nothing written:`);
    for (const e of slotErrors) console.error(`  FAIL ${e}`);
    process.exit(2);
  }
}

const form = {
  components: rootChildren,
  formSettings: {
    // vertical (top) labels: clean modern layout that stays aligned in any column
    // width — horizontal labelCol/wrapperCol cram in multi-column splits.
    layout: 'vertical',
    colon: false,
    labelCol: { span: 24 },
    wrapperCol: { span: 24 },
    modelType: bp.entity.modelType ?? bp.entity.fullClassName,
  },
};

fs.writeFileSync(outFile, JSON.stringify(form, null, 2) + '\n');
console.log(`compiled ${bp.screen} (${bp.archetype}) → ${outFile}`);

// ---- presentation manifest (sidecar) -----------------------------------------
// A declared recipe has to be checkable AFTER the compile, by something that only has the
// markup. The declaration is a BLUEPRINT fact and does not belong in the pushed form (it
// would not survive the Create/UpdateMarkup round-trip and would pollute the diff), so it
// rides a sidecar next to --out: <out>.presentation.json. validate-styledness reads it when
// it exists and FAILS a form whose declared recipe left no structural trace.
// No declared recipe → no sidecar, so nothing changes for a blueprint without presentation.
const sidecarFile = `${outFile}.presentation.json`;
if (presentationDeclared.length) {
  fs.writeFileSync(sidecarFile, `${JSON.stringify({
    form: { module: bp.form.module, name: bp.form.name },
    archetype: bp.archetype,
    theme: noStyle ? null : themeName,
    declared: presentationDeclared,
  }, null, 2)}\n`);
  console.log(`presentation manifest → ${sidecarFile} (${presentationDeclared.length} declared recipe(s))`);
} else if (fs.existsSync(sidecarFile)) {
  // a stale manifest from an earlier blueprint would fail this form for recipes it no
  // longer declares — the manifest describes THIS compile or it does not exist
  fs.rmSync(sidecarFile, { force: true });
}

// ---- self-gating: the compiler runs its own offline gates ---------------------
// Writing the file unconditionally made "compiled" a claim about effort, not about
// the artifact. The three gates that need nothing but the file itself now run here,
// so a compile that produces markup the skill's own rules reject FAILS THE COMMAND.
// The output is deliberately LEFT ON DISK — self-gating fails the command, it does
// not make the evidence vanish. (validate-guardrails' optional entity-metadata arg
// is not available at compile time; it runs metadata-free, exactly as the offline
// eval suite invokes it — the identity checks then WARN instead of FAIL.)
// validate-styledness cannot read the archetype off the markup (an archetype is a
// blueprint fact, not a component), and its page-anatomy floor only applies to page
// archetypes — so the compiler, which DOES know, passes it through. Without the flag
// that gate degrades to a WARN, never to a false pass.
const SELF_GATES = ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js'];
const GATE_ARGS = {
  'validate-styledness.js': ['--archetype', bp.archetype,
    // the compiler and the floor must AGREE, or an opted-out blueprint could never compile
    ...(bp.chrome === false ? ['--no-page-anatomy'] : [])],
};
const failedGates = [];
for (const gate of SELF_GATES) {
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, gate), outFile, ...(GATE_ARGS[gate] ?? [])], { encoding: 'utf8' });
  if (r.status !== 0) {
    failedGates.push(gate);
    console.error(`\n--- ${gate} FAILED on ${outFile} ---`);
    console.error(`${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd());
  }
}
if (failedGates.length) {
  console.error(`\nself-gate FAILED: ${failedGates.join(', ')} — output left at ${outFile} for diagnosis`);
  process.exit(1);
}
console.log(`self-gated: ${SELF_GATES.join(' → ')} all pass`);
// Four gates, not three [R-042/quality-gates.md]. The three above already ran on
// this file; resolve-bindings stays CALLER-RUN because it needs the live backend
// (entity metadata + reflist identities), which the compiler may not have.
console.log('gate chain: validate-schema → validate-guardrails → resolve-bindings → validate-styledness');
console.log('next: resolve-bindings (caller-run — needs the live backend), then push');
