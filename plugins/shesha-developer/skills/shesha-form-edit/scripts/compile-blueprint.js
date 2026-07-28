#!/usr/bin/env node
// compile-blueprint.js --blueprint <blueprint.json> --out <form.json>
//                      [--backend http://localhost:21021] [--no-live]
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
// ```blueprint-json block.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymUuid } from './gym-lib/ids.js';
import { GymApi } from './gym-lib/api.js';
import { readBlueprint, validateBlueprint } from './validate-blueprint.mjs';
// Appearance is design-system's; the compiler links its resolver as a pure function.
import {
  loadStylePlan, validateStylePlan, NEUTRAL_PLAN,
} from '../../shesha-design-system/scripts/resolve-style-plan.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'components-kb');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const bpFile = argVal('--blueprint', null);
const outFile = argVal('--out', null);
if (!bpFile || !outFile) {
  console.error(`usage: node compile-blueprint.js --blueprint <bp.json|bp.md> --out <form.json>
                          [--metadata <entity.probe.json>]  offline entity metadata (preferred)
                          [--live [--backend <url>]]        fetch metadata instead of using a snapshot
                          [--theme <brand>] [--no-style]

BUILD IS PURE AND OFFLINE by default. It reads a metadata snapshot rather than a live
backend, so a build is reproducible and testable. Produce the snapshot with
  node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>
which writes <Entity>.probe.json next to the token file. Mutation is a separate step
(scripts/apply-form.mjs) — compiling never touches the backend.`);
  process.exit(2);
}

// ---- load + VALIDATE blueprint (JSON or fenced block in Markdown) --------------
// The compiler validates the blueprint itself. Never trust that an upstream agent
// validated it — an agent that skipped the step and one that ran it look identical.
const bp = readBlueprint(bpFile);
{
  const errors = validateBlueprint(bp);
  if (errors.length) {
    console.error(`blueprint INVALID — ${path.basename(bpFile)}, ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e.at || '(root)'} ${e.msg}`);
    console.error('\nSchema: shesha-design-comprehension/schemas/blueprint.schema.json');
    console.error('Validate directly: node scripts/validate-blueprint.mjs <blueprint>');
    process.exit(1);
  }
}

const index = JSON.parse(fs.readFileSync(path.join(KB_DIR, '_index.json'), 'utf8'));
const ver = (type) => {
  const v = index[type]?.version;
  if (!Number.isInteger(v)) throw new Error(`component type "${type}" not in the 0.45 KB — unusable by definition (L1)`);
  return v;
};

// ---- archetype resolution against the golden corpus ---------------------------
// The blueprint's archetype must exist in the corpus, and the corpus tells us which
// component types that archetype's chrome is built from — which is what the capability
// gate below checks against measured reality.
const GOLDEN_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'golden');
const goldenIndex = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, '_index.json'), 'utf8'));
const archetype = (goldenIndex.forms ?? []).find((f) => f.archetype === bp.archetype);
if (!archetype) {
  console.error(
    `archetype "${bp.archetype}" is not in the golden corpus (assets/golden/_index.json).\n`
    + `Available: ${(goldenIndex.forms ?? []).map((f) => f.archetype).sort().join(', ')}`,
  );
  process.exit(1);
}
console.error(`archetype: ${bp.archetype} — ${archetype.file}`);

// ---- capability gate: refuse to emit onto a channel measured as dead ----------
// The gym measures every component against a live runtime. A type the runtime does not
// register, or a style channel measured as a no-op, cannot be made to work by authoring
// it more carefully — emitting it produces markup that looks right and renders nothing.
const MATRIX_PATH = path.join(SCRIPT_DIR, '..', 'assets', 'measured-capability-matrix.json');
let matrix = null;
try { matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8')); }
catch { console.error(`WARN: measured-capability-matrix.json unreadable — emitting without the capability gate`); }

/**
 * Refuse a component type the measured matrix reports as absent from the runtime.
 * `unknown`/`not-measured` is not evidence of absence and must not block.
 */
function assertTypeRenders(type, where) {
  const m = matrix?.components?.[type];
  if (!m) return;
  if (m.renderStatus === 'not-registered') {
    console.error(
      `refusing to emit "${type}" (${where}): the measured capability matrix records it as `
      + `not-registered on Shesha ${matrix.sheshaVersion ?? '0.45'} — the runtime has no such component.\n`
      + `Regenerate the matrix if the runtime changed: see references/gym.md.`,
    );
    process.exit(1);
  }
  if (m.renderStatus === 'breaks-render') {
    console.error(
      `refusing to emit "${type}" (${where}): measured as breaks-render — it takes the whole form down.`,
    );
    process.exit(1);
  }
}

// Gate the archetype's own chrome up front, so a corpus/runtime mismatch fails before
// any work rather than producing a form that silently omits its toolbar.
for (const t of archetype.componentTypes ?? []) assertTypeRenders(t, `${bp.archetype} chrome`);

// ---- entity metadata: a snapshot by default, live only on request --------------
// Metadata drives datatype→component selection and reference-list identity. The build
// stays PURE: it reads a snapshot file, so the same blueprint plus the same snapshot
// always compiles to the same markup and can be tested with no backend at all.
// `--live` is the escape hatch for interactive work where no snapshot exists yet.
let propsMeta = null; // Map(lowercased path -> prop)
const metaFile = argVal('--metadata', null);
const wantsLive = args.includes('--live');

function indexProps(arr, source) {
  propsMeta = new Map();
  for (const p of arr) if (p?.path) propsMeta.set(String(p.path).toLowerCase(), p);
  console.error(`metadata: ${propsMeta.size} properties from ${source}`);
}

if (metaFile) {
  const snap = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, ''));
  // Accepts a raw property array, a backend-probe entity slice, or a full probe summary.
  const arr = Array.isArray(snap) ? snap
    : Array.isArray(snap.properties) ? snap.properties
      : Array.isArray(snap.entities)
        ? (snap.entities.find((e) => e.fullClassName === bp.entity.fullClassName) ?? snap.entities[0])?.properties
        : null;
  if (!Array.isArray(arr)) {
    console.error(`--metadata ${path.basename(metaFile)} has no property array (expected [], {properties:[]} or a backend-probe summary)`);
    process.exit(2);
  }
  indexProps(arr, path.basename(metaFile));
} else if (wantsLive) {
  const api = new GymApi(argVal('--backend', 'http://localhost:21021'));
  await api.authenticate();
  const { ok, body } = await api.getJson(`/api/services/app/Metadata/GetProperties?container=${encodeURIComponent(bp.entity.fullClassName)}`);
  const arr = Array.isArray(body?.result) ? body.result : null;
  if (ok && arr) indexProps(arr, 'live backend');
  else console.error(`WARN: metadata for ${bp.entity.fullClassName} unavailable — compiling without binding resolution`);
} else {
  console.error(
    `WARN: no --metadata snapshot and no --live — compiling without binding resolution.\n`
    + `      Component choice falls back to declared datatypes and reference-list identity\n`
    + `      cannot be resolved [R-015]. Produce a snapshot with scripts/backend-probe.mjs.`,
  );
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

function titleCase(prop) {
  const last = prop.split('.').pop();
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

// ---- React-design-intuition scales ------------------------------------------
// The model designs in React terms (Stack/Row/Grid/Card, gap/padding, heading
// levels); these map each to the measured Shesha channel. Colour/brand is the
// Style pass's job — here we set only structural layout + hierarchy defaults.
const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32 };
const resolveSpace = (v, dflt) => {
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return v;
  if (SPACE[v] !== undefined) return SPACE[v];
  const n = parseInt(v, 10);
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

// ---- style plan: DESIGN IS COMPILED IN, not a second pass --------------------
// Appearance is owned by shesha-design-system. It exposes tokens → a normalized,
// validated STYLE PLAN (schemas/style-plan.schema.json); this compiler consumes
// the plan and bakes concrete values into every node, so the first output is
// already on-brand. There is no later free-form styling pass, and design-system
// never pushes. A theme that cannot resolve every key the plan requires falls
// back to neutral values with a warning rather than emitting half a brand.
// (App-level AntD chrome — input/table/button skin — is the separate one-time
// `$antdTheme` app setup, not a per-form pass.)
const themeName = argVal('--theme', bp.theme || 'shesha');
const noStyle = process.argv.includes('--no-style');
const { plan: STYLE, source: styleSource, warning: styleWarning } = noStyle
  ? { plan: NEUTRAL_PLAN, source: null, warning: null }
  : loadStylePlan(themeName);
if (styleWarning) console.error(`WARN: ${styleWarning}`);
{
  const planErrors = validateStylePlan(STYLE);
  if (planErrors.length) {
    console.error(`style plan for "${themeName}" does not satisfy style-plan.schema.json:`);
    for (const e of planErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
console.error(`style plan: brand "${STYLE.brand}"${styleSource ? ` (${path.basename(styleSource)})` : ' (neutral)'}`);

// Back-compat shim for the emit code below: role name / token path → plan value.
const STYLE_BY_ROLE = {
  pageBg: STYLE.colors.pageBg,
  cardBg: STYLE.colors.cardBg,
  cardHeaderBg: STYLE.colors.cardHeaderBg,
  bodyText: STYLE.colors.bodyText,
  sectionHeading: STYLE.colors.sectionHeading,
  secondaryText: STYLE.colors.secondaryText,
  inputBorder: STYLE.colors.inputBorder,
  hairline: STYLE.colors.hairline,
  appPrimary: STYLE.colors.appPrimary,
  baseRadius: STYLE.radius.base,
  cardRadius: STYLE.radius.card,
  'type.scale.body': STYLE.type.bodySize,
  'type.scale.title': STYLE.type.headingSizes[1],
  'type.scale.subtitle': STYLE.type.headingSizes[2],
  'type.scale.cardHeader': STYLE.type.headingSizes[3],
  'type.weights.semibold': STYLE.type.semiboldWeight,
};
function tk(pathOrRole, fallback) {
  const v = STYLE_BY_ROLE[pathOrRole];
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

/**
 * A stable componentName for nodes the blueprint did not name — derived from the id
 * path tail, so it is unique per position rather than per traversal order.
 */
function nameFromKey(idKey, prefix) {
  const tail = idKey.split('/').slice(-2).join('_').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${prefix}_${tail || 'n'}`;
}

// Deterministic ids are seeded from the node's FULL STRUCTURAL PATH plus its sibling
// ordinal. The previous scheme keyed on `kind:name ?? property ?? seq++`, where seq was a
// single global mutable counter — so inserting one node renumbered every later unnamed
// node, and two siblings sharing a name or a property produced the SAME key and therefore
// the same uuid. Path+ordinal is unique by construction and stable under edits elsewhere.
function compileNode(node, idPrefix, ordinal = 0) {
  const label = node.name ?? node.property ?? node.kind;
  const idKey = `${idPrefix}/${ordinal}:${node.kind}#${label}`;
  switch (node.kind) {
    case 'field':
      return fieldComponent(node, idKey);
    case 'text':
      return {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'text', version: ver('text'),
        componentName: node.name ?? nameFromKey(idKey, 'text'),
        content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
        desktop: { font: { size: tk('type.scale.body', 14), color: tk('bodyText', '#181818') } },
      };
    case 'heading': {
      const lvl = node.level ?? 2;
      const h = HEADING[lvl] ?? HEADING[2];
      return {
        id: gymUuid('bp', bp.form.name, idKey),
        type: 'text', version: ver('text'),
        componentName: node.name ?? nameFromKey(idKey, 'heading'),
        content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
        // on-brand hierarchy from the theme type scale + heading ink [R-030]
        desktop: { font: { size: tk(HEADING_TOKEN[lvl], h.size), weight: String(tk('type.weights.semibold', 600)), color: tk('sectionHeading', '#181818') } },
      };
    }
    case 'buttonGroup':
    case 'actions':
      return floorButtonGroup(idKey);
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
      for (const it of table.items) it.parentId = table.id;

      // ARCHETYPE CHROME. On a table-worklist the golden corpus wraps the grid in a
      // toolbar row — quick search left, pager right — because a bare datatable ships
      // without a way to search or page, which reads as an unfinished screen. The
      // chrome's component types were capability-gated above, so this only emits types
      // the runtime is measured to register.
      if (bp.archetype === 'table-worklist') {
        const nm = node.name ?? 'table';
        const toolbarChildren = [];
        for (const [type, suffix, extra] of [
          ['datatable.quickSearch', 'Search', { block: false }],
          ['datatable.pager', 'Pager', { showSizeChanger: true, showTotalItems: true }],
        ]) {
          assertTypeRenders(type, `${bp.archetype} toolbar`);
          toolbarChildren.push({
            id: gymUuid('bp', bp.form.name, `${idKey}/chrome/${suffix}`),
            type, version: ver(type),
            componentName: `${nm}${suffix}`, propertyName: `${nm}${suffix}`,
            ...extra,
          });
        }
        const toolbar = {
          id: gymUuid('bp', bp.form.name, `${idKey}/chrome/toolbar`),
          type: 'container', version: ver('container'),
          componentName: `${nm}Toolbar`,
          direction: 'horizontal', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap',
          desktop: {
            display: 'flex', flexDirection: 'row', flexWrap: 'nowrap',
            justifyContent: 'space-between', alignItems: 'center',
            gap: '8px', stylingBox: JSON.stringify({ marginBottom: '12' }),
            // full width so the right-hand cluster sits flush with the table edge [R-028/R-029]
            dimensions: { width: '100%', minWidth: '0px', height: 'auto' },
          },
          components: toolbarChildren,
        };
        for (const c of toolbarChildren) c.parentId = toolbar.id;
        ctx.components = [toolbar, table];
        toolbar.parentId = ctx.id;
      }

      table.parentId = ctx.id;
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
            components: (tab.children ?? []).map((c, ci) => compileNode(c, `${idKey}/${key}`, ci)),
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
  const isRow = node.kind === 'row' || node.kind === 'grid';
  let children = (node.children ?? []).map((c, ci) => compileNode(c, idKey, ci));

  // grid: N equal columns. Each child is WRAPPED in a width-carrying flex column
  // (the same mechanism the 66/33 row split uses) rather than sizing the field
  // directly — a form-item's own width doesn't stretch reliably, which collapses
  // gridded controls to stubs. The field then fills its column at 100%.
  if (node.kind === 'grid') {
    const cols = Number.isInteger(node.columns) ? node.columns : (children.length || 1);
    const g = resolveSpace(node.gap, 16);
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

  // section/card with a title gets a heading child prepended (before parentId stamp).
  // The heading's name is derived from the id PATH, not from `node.kind` — two unnamed
  // cards both produced "cardTitle", a componentName collision the identity gate now
  // rejects.
  if ((node.kind === 'section' || node.kind === 'card') && node.title) {
    const heading = compileNode({
      kind: 'heading', level: 3, content: node.title,
      name: node.name ? `${node.name}Title` : nameFromKey(idKey, `${node.kind}Title`),
    }, idKey);
    children.unshift(heading);
  }

  // The 0.45 renderer reads the flex model from the `desktop` breakpoint block,
  // NOT from root-level props — this is THE reason root display/flexDirection did
  // nothing and rows stacked. Build the full desktop style object (mirrors the
  // container's own defaultStyles shape) so layout is honoured. [R-030/R-032]
  const desktop = {
    display: 'flex',
    flexDirection: isRow ? 'row' : 'column',
    flexWrap: node.kind === 'grid' ? 'wrap' : 'nowrap',
    justifyContent: node.justify ? (JUSTIFY[node.justify] ?? node.justify) : 'flex-start',
    alignItems: node.align ? (ALIGN[node.align] ?? node.align) : (isRow ? 'flex-start' : 'stretch'),
    gap: `${resolveSpace(node.gap, isRow ? 16 : 12)}px`,
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
    if (node.padding === undefined) desktop.stylingBox = paddingBox('4'); // spacing.4 = 16
  }

  const container = {
    id: gymUuid('bp', bp.form.name, idKey),
    type: 'container', version: ver('container'),
    componentName: node.name ?? nameFromKey(idKey, node.kind),
    // root duplicates kept for migration compatibility; desktop is authoritative
    direction: isRow ? 'horizontal' : 'vertical',
    display: 'flex', flexDirection: isRow ? 'row' : 'column',
    gap: resolveSpace(node.gap, isRow ? 16 : 12),
    flexWrap: node.kind === 'grid' ? 'wrap' : 'nowrap',
    stylingBox: desktop.stylingBox,
    desktop,
    components: children,
  };
  for (const c of container.components) c.parentId = container.id;
  return container;
}

function floorButtonGroup(idKey) {
  // isInline:true is what renders Save/Back as an inline button row; without it
  // the group collapses to an overflow "…" menu (proven by the golden shape).
  return {
    id: gymUuid('bp', bp.form.name, `${idKey}/actions`),
    type: 'buttonGroup', version: ver('buttonGroup'),
    componentName: 'formActions', propertyName: 'formActions',
    label: 'Form Actions', hideLabel: true, isInline: true, editMode: 'editable',
    items: [
      {
        id: gymUuid('bp', bp.form.name, `${idKey}/actions/save`),
        itemType: 'item', itemSubType: 'button', sortOrder: 0,
        name: 'btnSave', label: 'Save', buttonType: 'primary', icon: 'SaveOutlined',
        buttonAction: 'submit', editMode: 'inherited',
        actionConfiguration: { _type: 'action-config', actionName: 'Submit', actionOwner: 'shesha.form', handleSuccess: false, handleFail: false },
      },
      {
        id: gymUuid('bp', bp.form.name, `${idKey}/actions/back`),
        itemType: 'item', itemSubType: 'button', sortOrder: 1,
        name: 'btnBack', label: 'Back', buttonType: 'default', icon: 'ArrowLeftOutlined',
        buttonAction: 'navigate', editMode: 'inherited',
        actionConfiguration: { _type: 'action-config', actionName: 'Navigate', actionOwner: 'shesha.common', actionArguments: { navigationType: 'url', url: '/' } },
      },
    ],
  };
}

// ---- assemble ------------------------------------------------------------------
const rootChildren = [compileNode(bp.layout, bp.form.name)];

// floor: capture archetypes always get validationErrors + Submit/exit pair [R-006/R-007/R-020]
const CAPTURE_ARCHETYPES = new Set(['capture', 'modal-dialog', 'wizard']);
const treeText = JSON.stringify(rootChildren);
if (CAPTURE_ARCHETYPES.has(bp.archetype)) {
  if (!treeText.includes('"validationErrors"')) {
    rootChildren.push({
      id: gymUuid('bp', bp.form.name, 'validationErrors'),
      type: 'validationErrors', version: ver('validationErrors'),
      componentName: 'formValidationErrors',
    });
  }
  if (!treeText.includes('"Submit"')) rootChildren.push(floorButtonGroup('floor'));
}
for (const c of rootChildren) c.parentId = 'root';

// Page ground. The styled-ness gate looks for a root surface establishing the canvas
// [R-042]; without it a fully token-styled tree still reads as default AntD on a white
// void. The style plan already carries pageBg, so apply it to the outermost container
// rather than leaving the one surface the user actually notices unpainted.
{
  const pageRoot = rootChildren.find((c) => c.type === 'container');
  if (pageRoot) {
    pageRoot.desktop = pageRoot.desktop ?? {};
    pageRoot.desktop.background = { type: 'color', color: STYLE.colors.pageBg };
    if (!pageRoot.desktop.stylingBox || pageRoot.desktop.stylingBox === '{}') {
      pageRoot.desktop.stylingBox = JSON.stringify({
        paddingLeft: '24', paddingRight: '24', paddingTop: '24', paddingBottom: '24',
      });
    }
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
console.log(`next gates: validate-schema → validate-guardrails → resolve-bindings`);
