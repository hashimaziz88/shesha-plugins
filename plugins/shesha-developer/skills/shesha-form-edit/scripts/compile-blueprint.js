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
    const dt = binding.datatype ?? meta?.dataType ?? 'string';
    type = BY_DATATYPE[dt] ?? 'textField';
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
function compileNode(node, idPrefix) {
  const idKey = `${idPrefix}/${node.kind}:${node.name ?? node.property ?? seq++}`;
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
  if (node.kind === 'card') {
    desktop.background = { type: 'color', color: tk('cardBg', '#ffffff') };
    desktop.border = { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', color: tk('hairline', '#e5e7eb'), style: 'solid' } }, radius: { all: tk('cardRadius', 8) } };
    desktop.shadow = { offsetX: 0, offsetY: 1, blurRadius: 4, spreadRadius: 0, color: 'rgba(0,0,0,0.08)' };
    // '4' is a spacing TOKEN key: theme spacing.4 = 16px in both shipped themes
    // (neutral fallback 16 under --no-style) — not 4px.
    if (node.padding === undefined) desktop.stylingBox = paddingBox('4');
  }

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
const rootChildren = [stampPageChrome(compileNode(bp.layout, bp.form.name))];

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

// ---- self-gating: the compiler runs its own offline gates ---------------------
// Writing the file unconditionally made "compiled" a claim about effort, not about
// the artifact. The three gates that need nothing but the file itself now run here,
// so a compile that produces markup the skill's own rules reject FAILS THE COMMAND.
// The output is deliberately LEFT ON DISK — self-gating fails the command, it does
// not make the evidence vanish. (validate-guardrails' optional entity-metadata arg
// is not available at compile time; it runs metadata-free, exactly as the offline
// eval suite invokes it — the identity checks then WARN instead of FAIL.)
const SELF_GATES = ['validate-schema.js', 'validate-guardrails.js', 'validate-styledness.js'];
const failedGates = [];
for (const gate of SELF_GATES) {
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, gate), outFile], { encoding: 'utf8' });
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
