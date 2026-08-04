// compile-node.mjs — the ONE generic node compiler.
//
// A normalized layout tree in, markup components out. There is no second pass and no second
// presentation system: page anatomy (band / meta strip / metric tiles / ground / capture
// floor) arrives from normalize-archetype.mjs as ORDINARY nodes, so every constructor below
// has exactly one caller path — the node's `kind`, or the `intent.role` that overrides it.
//
//   layout kinds → flex containers (the flex model lives in `desktop` [R-028/R-029])
//   field        → by-datatype component + live-metadata binding [R-004/R-015/R-034]
//   data regions → dataContext(v8) wrapper [R-005]
//   actions      → buttonGroup, isInline, one primary, inferred actions [R-007/R-008/R-057]
//   intent       → role picks the carrier, emphasis/surface colour it through the theme

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymUuid } from '../gym-lib/ids.js';
import { titleCase, STATUS_PROP } from './resolve-bindings-offline.mjs';
import { CAPTURE_ARCHETYPES } from './normalize-archetype.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between', 'space-around': 'space-around' };
// structural heading hierarchy; the theme type scale overrides the px fallbacks
const HEADING = { 1: 24, 2: 20, 3: 16, 4: 14 };
const HEADING_TOKEN = { 1: 'type.scale.title', 2: 'type.scale.subtitle', 3: 'type.scale.cardHeader', 4: 'type.scale.body' };
// a container holding only these is an action row and must render as one line [R-057]
const BUTTON_TYPES = new Set(['button', 'buttonGroup', 'buttons']);
// The Save/Back pair is the FLOOR [R-007/R-020], not a ceiling.
const DEFAULT_ACTION_SPECS = [
  { name: 'btnSave', label: 'Save', buttonType: 'primary', icon: 'SaveOutlined', action: 'submit' },
  { name: 'btnBack', label: 'Back', buttonType: 'default', icon: 'ArrowLeftOutlined', action: 'navigate', url: '/' },
];
const SUBMIT_WORDS = /^(save|submit|create|add|update|confirm|apply|send|register)\b/i;
const EXIT_WORDS = /^(back|cancel|close|discard|exit|return)\b/i;
const DEFAULT_ICONS = { submit: 'SaveOutlined', navigate: 'ArrowLeftOutlined' };
/**
 * The ONE Navigate action builder. Every navigation the compiler emits — a Back button, a
 * row-open affordance — comes from here, so there is exactly one place that knows the
 * action-config envelope. A Navigate with an empty target crashes the page [R-008], so every
 * caller supplies its own arguments.
 */
const navigateAction = (actionArguments) => ({
  _type: 'action-config', actionName: 'Navigate', actionOwner: 'shesha.common', actionArguments,
});
/** PascalCase / dotted entity name → the kebab form the `<entity>-details` convention uses */
const kebab = (s) => String(s).split('.').pop()
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-')
  .toLowerCase().replace(/(^-|-$)/g, '');
// emphasis → token paths. Fallbacks are deliberately NEUTRAL so --no-style and an unknown
// theme emit no brand or semantic colour at all [R-042]. A theme that does not define a
// semantic colour resolves that emphasis to neutral ink — add the token, never a hex here.
const EMPHASIS_TOKENS = {
  accent: ['palette.brand.primary', '#181818', 'palette.brand.tint', '#f0f2f5', 'palette.brand.primary', '#d0d5e0'],
  neutral: ['palette.ink.primary', '#181818', 'palette.surfaces.surface', '#ffffff', 'palette.lines.border', '#e5e7eb'],
  success: ['palette.semantic.success', '#181818', 'palette.semantic.successBg', '#f0f2f5', 'palette.semantic.successBorder', '#d0d5e0'],
  warning: ['palette.semantic.warning', '#181818', 'palette.semantic.warningBg', '#f0f2f5', 'palette.semantic.warningBorder', '#d0d5e0'],
  danger: ['palette.semantic.danger', '#181818', 'palette.semantic.dangerBg', '#f0f2f5', 'palette.semantic.dangerBorder', '#d0d5e0'],
};
// Types whose surface/ink channels the measured matrix proves render. refListStatus is
// absent on purpose: every appearance channel on it is a measured no-op [R-053] — a chip's
// colour comes from the reference-list items [R-036].
const EMPHASISABLE = new Set(['text', 'statistic', 'container', 'card', 'datatable', 'KeyInformationBar']);
const SURFACEABLE = new Set(['container', 'card', 'statistic', 'KeyInformationBar']);

const dims = (width) => ({ width, height: 'auto', minHeight: 'auto', maxHeight: 'auto', minWidth: '0px', maxWidth: '100%' });

export function createCompiler({ bp, theme, bindings, ver }) {
  const { tk, space, px, padBox } = theme;
  const uuid = (key) => gymUuid('bp', bp.form.name, key);
  const isCaptureFooter = () => CAPTURE_ARCHETYPES.has(bp.archetype);
  let seq = 0;

  /** a font block from the theme type scale + an ink ROLE (never a literal colour) */
  const font = (sizeToken, sizePx, ink, weight) => ({
    size: tk(sizeToken, sizePx),
    ...(weight ? { weight: String(tk(`type.weights.${weight}`, weight === 'regular' ? 400 : 600)) } : {}),
    color: tk(ink, '#181818'), align: 'left',
  });

  /**
   * The ONE container constructor — every flex box the compiler emits (layout kinds, grid
   * columns, action footers) comes from here. The 0.45 renderer reads the flex model from the
   * `desktop` block, NOT from root-level props: THE reason root display/flexDirection did
   * nothing and rows stacked [R-029/R-030]. The root duplicates are migration compatibility.
   */
  function container(idKey, name, { row = false, wrap = false, justify = 'flex-start', align, gap, width = '100%', box = '{}' }, children = []) {
    const desktop = {
      display: 'flex', flexDirection: row ? 'row' : 'column', flexWrap: wrap ? 'wrap' : 'nowrap',
      justifyContent: justify, alignItems: align ?? (row ? 'flex-start' : 'stretch'),
      gap: `${gap}px`, dimensions: dims(width), stylingBox: box,
    };
    const comp = {
      id: uuid(idKey), type: 'container', version: ver('container'), componentName: name,
      direction: row ? 'horizontal' : 'vertical',
      display: 'flex', flexDirection: row ? 'row' : 'column',
      gap, flexWrap: desktop.flexWrap, stylingBox: box,
      desktop, components: children,
    };
    for (const c of children) c.parentId = comp.id;
    return comp;
  }

  // ---- fields --------------------------------------------------------------
  function fieldComponent(node, idKey) {
    const prop = node.property;
    const type = bindings.componentFor(node);
    const comp = {
      id: uuid(idKey), type, version: ver(type),
      propertyName: prop, label: bindings.label(node), labelAlign: 'left',
      // fields fill their column; minWidth:0 lets flex columns shrink cleanly (the flexbox
      // min-content trap). A token border makes inputs on-brand before the app AntD theme.
      desktop: {
        dimensions: { width: '100%', minWidth: '0px' },
        border: { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: tk('inputBorder', '#D0D5E0') } }, radius: { all: tk('baseRadius', 6) } },
      },
    };
    if (type === 'dropdown' || type === 'radio' || type === 'refListStatus') {
      const id = bindings.reflistIdentity(prop);
      if (id) { comp.dataSourceType = 'referenceList'; comp.referenceListId = { module: id.module, name: id.name }; }
      else if (bindings.hasMetadata) console.error(`WARN: ${prop} compiled as ${type} but metadata shows no referenceListName`);
    }
    if (type === 'autocomplete') {
      const ent = bindings.entityIdentity(prop);
      if (ent) Object.assign(comp, { dataSourceType: 'entitiesList', entityTypeShortAlias: ent.entityType, mode: 'single' });
    }
    return comp;
  }

  // ---- text ----------------------------------------------------------------
  /**
   * ONE text constructor for body copy, headings and captions. `contentType:"custom"` is what
   * LETS desktop.font.color reach the DOM — without it antd's preset ink wins and the colour is
   * a measured no-op [R-052]. `node.ink` is normalize-archetype's internal ink override.
   */
  function textComponent(node, idKey, sizeToken, sizePx, ink, weight) {
    return {
      id: uuid(idKey), type: 'text', version: ver('text'),
      componentName: node.name ?? `text${seq}`,
      content: node.content ?? node.title ?? '', textType: 'span', contentDisplay: 'content',
      contentType: 'custom',
      desktop: { font: font(sizeToken, sizePx, node.ink ?? ink, weight) },
    };
  }

  // ---- action rows ---------------------------------------------------------
  /** normalise one authored spec (rich object OR blueprint child node) into a spec */
  function actionSpec(raw, i) {
    const label = raw.label ?? raw.title ?? raw.content ?? (raw.name ? titleCase(raw.name) : `Action ${i + 1}`);
    const name = raw.name ?? `btn${String(label).replace(/[^A-Za-z0-9]/g, '') || i}`;
    let action = raw.action ?? raw.buttonAction ?? null;
    if (!action) action = SUBMIT_WORDS.test(label) ? 'submit' : (EXIT_WORDS.test(label) ? 'navigate' : null);
    return { name, label, action, buttonType: raw.buttonType, icon: raw.icon, url: raw.url ?? raw.target };
  }

  /** a spec → a buttonGroup item, keyed by the button's SLUG so ids survive recompiles [R-025] */
  function actionItem(spec, i, idKey, allowPrimary) {
    const slug = spec.name.replace(/^btn/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || String(i);
    const item = {
      id: uuid(`${idKey}/actions/${slug}`),
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
      item.actionConfiguration = navigateAction({ navigationType: 'url', url: spec.url ?? '/' });
    }
    return item;
  }

  /**
   * Button specs come from node.items / node.buttons (the rich shape) or node.children (the
   * only child channel the blueprint schema allows today), else the Save/Back floor. The group
   * ALWAYS carries isInline, or the renderer collapses it to an overflow "…" menu [R-057].
   */
  function actionGroup(idKey, node) {
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
      id: uuid(`${idKey}/actions`), type: 'buttonGroup', version: ver('buttonGroup'),
      componentName: name, propertyName: name,
      label: 'Form Actions', hideLabel: true, isInline: true, editMode: 'editable',
      items,
    };
  }

  /** Wrap an action group in its own flex ROW so 2+ buttons read as one line and, on a capture
   *  footer, right-align [R-057]: buttonGroup's own dimensions/stylingBox are measured no-ops,
   *  so the containing container HAS to be the alignment lever. */
  const actionFooterRow = (group) => container(`${group.id}/actionsRow`, `${group.componentName}Row`, {
    row: true, align: 'center', gap: px('2', 8),
    justify: isCaptureFooter() ? 'flex-end' : 'flex-start',
  }, [group]);

  // ---- data regions --------------------------------------------------------
  /** every data region rides a dataContext(v8) wrapper [R-005] */
  function dataContext(node, idKey, child) {
    const name = node.name ?? 'data';
    const ctx = {
      id: uuid(`${idKey}/ctx`), type: 'dataContext', version: ver('dataContext'),
      entityType: bp.entity.fullClassName, sourceType: 'Entity',
      dataFetchingMode: 'paging', defaultPageSize: 10,
      uniqueStateId: name, componentName: name, propertyName: name,
      sortMode: 'standard', allowReordering: 'no',
      components: [child],
    };
    child.parentId = ctx.id;
    return ctx;
  }

  /**
   * The DISPLAY cell for one bound column. A reference-list column left on `[default]` renders
   * the raw enum NUMBER, which throws the lifecycle away exactly like a status compiled to text
   * — so a column whose property resolves to a reference-list identity gets the chip cell
   * instead. The shape is the live-validated one from references/components/junction-subtables.md
   * (`displayComponent.settings.referenceListId`); the identity is never guessed [R-015], so a
   * property with no live metadata and no declared `bindings[].referenceList` stays `[default]`
   * and validate-styledness' status-as-text check reports it (WARN offline, FAIL when the
   * identity was knowable).
   */
  function columnDisplay(col) {
    const id = bindings.reflistIdentity(col);
    if (id) return { type: 'refListStatus', settings: { referenceListId: { module: id.module, name: id.name } } };
    if (STATUS_PROP.test(String(col).split('.').pop())) {
      console.error(`WARN: column "${col}" reads as a lifecycle but has no reference-list identity — `
        + 'it renders the raw enum number; declare bindings[].referenceList or compile with live metadata [R-015]');
    }
    return { type: '[default]' };
  }

  /**
   * `rowAction: {kind:"open-record"}` → the datatable's row-activation action channel. The
   * blueprint says only what activating a row MEANS; this is the one place that knows the
   * channel and the target convention (`<entity-kebab>-details`, the shape every shipped detail
   * form uses). Navigate comes from the SAME builder the Back button uses.
   *
   * HONESTY: `datatable.onRowClick` is `not-measured` in assets/measured-capability-matrix.json
   * — a configurableActionConfigurator the gym cannot measure visually. The shape is authored
   * from the KB settings form; nothing here claims it fires. One live click test is the only
   * proof (references/components/data-tables.md), and no gate asserts row-open works.
   */
  function rowOpenAction(node) {
    const target = node.rowAction.target
      ?? `${kebab(bp.entity.modelType?.name ?? bp.entity.fullClassName)}-details`;
    return navigateAction({
      navigationType: 'form',
      formId: { name: target, module: bp.form.module },
      queryParameters: [{ key: 'id', value: '{{selectedRow.id}}' }],
    });
  }

  function datatable(node, idKey) {
    const name = node.name ?? 'table';
    const table = {
      id: uuid(`${idKey}/table`), type: 'datatable', version: ver('datatable'),
      componentName: `${name}Grid`, propertyName: `${name}Grid`,
      canEditInline: 'no', canAddInline: 'no', canDeleteInline: 'no', useMultiselect: false,
      // The grid presentation floor [R-042]. The measured matrix says WHICH grid channels
      // render: rowDimensions.height + headerBackgroundColor are recorded changes-geometry,
      // while rowHover/striped/rowDividers/rowPadding* are "not-measured" — no hover here.
      rowDimensions: { height: tk('chrome.tableRowHeight', 44) },
      headerBackgroundColor: tk('tableHeaderBg', '#f5f6f8'),
      desktop: { font: { size: tk('type.scale.body', 14), color: tk('bodyText', '#181818') } },
      items: (node.columns ?? []).map((col, i) => ({
        id: uuid(`${idKey}/col/${col}`),
        itemType: 'item', sortOrder: i, columnType: 'data',
        propertyName: col, caption: titleCase(col), isVisible: true, allowSorting: true,
        displayComponent: columnDisplay(col), editComponent: { type: '[not-editable]' }, createComponent: { type: '[not-editable]' },
      })),
    };
    if (node.rowAction?.kind === 'open-record') table.onRowClick = rowOpenAction(node);
    for (const it of table.items) it.parentId = table.id;
    return dataContext(node, idKey, table);
  }

  const datalist = (node, idKey) => dataContext(node, idKey, {
    id: uuid(`${idKey}/list`), type: 'datalist', version: ver('datalist'),
    componentName: `${node.name ?? 'list'}List`, propertyName: `${node.name ?? 'list'}List`,
    formSelectionMode: 'name',
    formId: { name: node.itemForm ?? `${bp.form.name}-item`, module: bp.form.module },
    orientation: 'vertical', selectionMode: 'none',
  });

  function tabs(node, idKey) {
    const out = {
      id: uuid(idKey), type: 'tabs', version: ver('tabs'),
      componentName: node.name ?? 'tabs', tabType: 'line',
      defaultActiveKey: node.children?.[0]?.name ?? 'tab1',
      tabs: (node.children ?? []).map((tab, i) => {
        const key = tab.name ?? `tab${i + 1}`;
        return {
          id: uuid(`${idKey}/tab/${key}`), key, title: tab.title ?? titleCase(key),
          components: (tab.children ?? []).map((c) => compileNode(c, `${idKey}/${key}`)),
        };
      }),
    };
    for (const t of out.tabs) for (const c of t.components) c.parentId = out.id;
    return out;
  }

  // ---- layout containers ---------------------------------------------------
  function buildContainer(node, idKey) {
    const columnParent = node.kind !== 'row' && node.kind !== 'grid';
    let children = (node.children ?? []).map((c) => {
      const compiled = compileNode(c, idKey);
      // A capture screen's action row is a FOOTER: inside a COLUMN stack the group has no
      // alignment lever, so it gets its own right-aligned row [R-057]; inside an author's row
      // (a toolbar) the author's justify already governs.
      return (columnParent && isCaptureFooter() && (c.kind === 'actions' || c.kind === 'buttonGroup'))
        ? actionFooterRow(compiled) : compiled;
    });
    // An action row is a row whatever kind the author reached for [R-057].
    const allButtons = children.length > 0 && children.every((c) => BUTTON_TYPES.has(c.type));
    const isRow = node.kind === 'row' || node.kind === 'grid' || allButtons;
    const gap = space(node.gap, allButtons ? px('2', 8) : px(isRow ? '4' : '3', isRow ? 16 : 12));

    if (node.kind === 'grid') {
      // N equal columns. Each child is WRAPPED in a width-carrying flex column rather than
      // sized directly — a form-item's own width does not stretch reliably, which collapses
      // gridded controls to stubs. It is the ONE width mechanism [R-028]: a metric tile row
      // and a 66/33 split are sized by this same code.
      const cols = Number.isInteger(node.columns) ? node.columns : (children.length || 1);
      const w = `calc((100% - ${(cols - 1) * gap}px) / ${cols})`;
      children = children.map((c, i) => container(`${idKey}/gcol/${i}`, `${node.name ?? 'grid'}Col${i}`, { gap: 0, width: w }, [c]));
    }
    // row: children keep their author width but need minWidth:0 so a 66/33 split does not
    // overflow and wrap to stacked (the #1 split-failure cause).
    if (node.kind === 'row') {
      for (const c of children) if (c.desktop?.dimensions?.width) c.desktop.dimensions.minWidth = '0px';
    }
    // a section/card with a title gets its heading prepended (before the parentId stamp)
    if ((node.kind === 'section' || node.kind === 'card') && node.title) {
      children.unshift(compileNode({ kind: 'heading', level: 3, content: node.title, name: `${node.name ?? node.kind}Title` }, idKey));
    }

    const comp = container(idKey, node.name ?? `${node.kind}${seq}`, {
      row: isRow, wrap: node.kind === 'grid', gap,
      justify: node.justify ? (JUSTIFY[node.justify] ?? node.justify)
        : (allButtons && isCaptureFooter() ? 'flex-end' : 'flex-start'),
      align: node.align ? (ALIGN[node.align] ?? node.align) : (allButtons ? 'center' : undefined),
      width: node.width ?? (isRow ? '100%' : 'auto'),
      box: node.padding !== undefined ? padBox(node.padding) : '{}',
    }, children);
    if (node.kind === 'card') applyCardSurface(comp.desktop, node);
    return comp;
  }

  /** The card SURFACE — border-forward per the Shesha design philosophy (hairline border,
   *  whisper shadow), all of it from theme tokens [R-030]. One definition, two callers:
   *  kind:"card" and intent.surface:"card". */
  function applyCardSurface(dk, node) {
    dk.background = { type: 'color', color: tk('cardBg', '#ffffff') };
    dk.border = { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', color: tk('hairline', '#e5e7eb'), style: 'solid' } }, radius: { all: tk('cardRadius', 8) } };
    dk.shadow = { offsetX: 0, offsetY: 1, blurRadius: 4, spreadRadius: 0, color: 'rgba(0,0,0,0.08)' };
    // '4' is a spacing TOKEN key: theme spacing.4 = 16px (neutral fallback 16) — not 4px.
    if (node.padding === undefined) dk.stylingBox = padBox('4');
  }

  // ---- intent carriers -----------------------------------------------------
  /** intent.role "status" → a refListStatus CHIP, never prose */
  function statusChip(node, idKey) {
    const prop = node.property;
    if (!prop) { console.error('WARN: intent.role "status" on a node with no property — skipped'); return null; }
    const id = bindings.reflistIdentity(prop);
    // No declared identity (--no-live, nothing on the binding) → still a chip: resolve-bindings
    // fills it from metadata [R-015], and an unidentified reference list rendering EMPTY is a
    // binding gap, not a reason to fall back to text.
    if (!id) console.error(`WARN: no reference-list identity for "${prop}" — the chip ships unidentified; run resolve-bindings [R-015]`);
    return {
      id: uuid(`${idKey}/chip`), type: 'refListStatus', version: ver('refListStatus'),
      componentName: node.name ?? `${prop}Chip`, propertyName: prop,
      label: titleCase(prop), hideLabel: true, showIcon: false,
      // the pill fill + ink come from the reference-list items [R-036]; every breakpoint
      // appearance channel on refListStatus is a measured no-op, so none is authored
      solidBackground: true, showReflistName: true,
      ...(id ? { referenceListId: { module: id.module, name: id.name } } : {}),
    };
  }

  /** intent.role "metric" → a native `statistic` tile */
  function metricTile(node, idKey, intent) {
    const name = node.name ?? `metric${seq}`;
    const valueFont = font('type.scale.title', 24, 'statTileValue', 'semibold');
    const emph = emphasisColours(intent.emphasis);
    if (emph) valueFont.color = emph.fg;
    return {
      id: uuid(`${idKey}/metric`), type: 'statistic', version: ver('statistic'),
      componentName: name, propertyName: name, hideLabel: true, hidden: false,
      title: String(node.title ?? titleCase(name)),
      // the compiler never invents a number: an unmeasured metric is the em-dash default
      value: String(node.content ?? '—'),
      titleFont: font('type.scale.micro', 12, 'bandSubtext', 'semibold'), valueFont,
      desktop: {
        background: { type: 'color', color: tk('statTileBg', '#ffffff') },
        border: { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: tk('hairline', '#e5e7eb') } }, radius: { all: tk('cardRadius', 8) } },
        dimensions: { width: node.width ?? '100%', height: 'auto', minWidth: '0px', maxWidth: '100%' },
        stylingBox: padBox('4'),
      },
    };
  }

  /** intent.role "meta" → the at-a-glance strip on the NATIVE KeyInformationBar: one component
   *  instead of nine hand-composed ones, with measured dividers and gap. One cell per bound
   *  child, label + mustache value. */
  function metaBar(node, idKey) {
    const cells = (node.children ?? []).filter((c) => c.property).slice(0, 6);
    if (cells.length < 2) { console.error('WARN: intent.role "meta" needs 2+ bound children — skipped'); return null; }
    const kib = {
      id: uuid(`${idKey}/meta`), type: 'KeyInformationBar', version: ver('KeyInformationBar'),
      componentName: node.name ?? 'metaStrip', propertyName: node.name ?? 'metaStrip',
      label: 'Key information', hideLabel: true, hidden: false,
      orientation: 'horizontal', alignItems: 'flex-start',
      gap: px('8', 32), dividerThickness: '1px', dividerColor: tk('divider', '#f0f0f0'), dividerHeight: 60,
      desktop: {
        background: { type: 'color', color: tk('cardBg', '#ffffff') },
        dimensions: { width: '100%', height: 'auto', minWidth: '0px', maxWidth: '100%' },
      },
      columns: cells.map((c, i) => {
        const cell = (kind, content, fnt) => ({
          id: uuid(`${idKey}/meta/${c.property}/${kind}`), type: 'text', version: ver('text'),
          componentName: `meta${kind}_${i + 1}`, propertyName: `meta${kind}_${i + 1}`,
          hideLabel: true, hidden: false, textType: 'span', contentDisplay: 'content',
          dataType: 'string', contentType: 'custom', content, desktop: { font: fnt },
        });
        const label = String(c.title ?? bindings.get(c.property).label ?? titleCase(c.property)).toUpperCase();
        return {
          id: uuid(`${idKey}/meta/${c.property}`),
          width: 220, textAlign: 'left', flexDirection: 'column', padding: '0px',
          components: [
            cell('Label', label, font('type.scale.micro', 12, 'bandSubtext', 'semibold')),
            cell('Value', `{{data.${c.property}}}`, font('type.scale.body', 14, 'bodyText', 'regular')),
          ],
        };
      }),
    };
    for (const col of kib.columns) for (const c of col.components) c.parentId = kib.id;
    return kib;
  }

  // ---- emphasis + surface --------------------------------------------------
  function emphasisColours(emphasis) {
    const t = EMPHASIS_TOKENS[emphasis];
    return t ? { fg: tk(t[0], t[1]), bg: tk(t[2], t[3]), border: tk(t[4], t[5]) } : null;
  }

  function applyEmphasis(comp, emphasis) {
    const t = emphasisColours(emphasis);
    if (!t || !EMPHASISABLE.has(comp.type)) return;
    if (comp.type === 'statistic') { comp.valueFont = { ...(comp.valueFont ?? {}), color: t.fg }; return; }
    const dk = comp.desktop = comp.desktop ?? {};
    if (comp.type === 'text') {
      dk.font = { ...(dk.font ?? {}), color: t.fg };
      comp.contentType = 'custom';   // without it the ink never reaches the DOM [R-052]
      return;
    }
    dk.background = { type: 'color', color: t.bg };
    dk.border = { radiusType: 'all', borderType: 'all', border: { all: { width: '1px', style: 'solid', color: t.border } }, radius: dk.border?.radius ?? { all: tk('cardRadius', 8) } };
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
          paddingTop: String(px('3', 12)), paddingBottom: String(px('3', 12)),
          paddingLeft: String(px('4', 16)), paddingRight: String(px('4', 16)),
        });
        comp.stylingBox = dk.stylingBox;
      }
      return;
    }
    // page GROUND — the root's own surface, and the floor validate-styledness' page-chrome
    // check reads. Same mechanism as a card, pageBg instead of cardBg.
    if (surface === 'page') { dk.background = { type: 'color', color: tk('pageBg', '#f5f6f8') }; return; }
    delete dk.background; delete dk.border; delete dk.shadow;   // plain
  }

  /** intent.role → the CARRIER for that meaning; null means "no role, or a no-op role — compile
   *  the node's own `kind`". The blueprint never names the carrier: this is the only place that
   *  decides what a role renders as. */
  function roleCarrier(node, idKey, intent) {
    switch (intent.role) {
      case 'status': return statusChip(node, idKey);
      case 'metric': return metricTile(node, idKey, intent);
      case 'meta': return metaBar(node, idKey);
      case 'title': return compileKind({ ...node, kind: 'heading', level: node.level ?? 1 }, idKey);
      // supporting micro-copy (a breadcrumb trail, a caption). Compiler-internal: the
      // blueprint's intent enum does not offer it.
      case 'caption': return textComponent(node, idKey, 'type.scale.micro', 12, 'bandSubtext');
      default: return null;   // body | undefined → the node's own kind
    }
  }

  // ---- the dispatcher ------------------------------------------------------
  /**
   * One node → one component. `intent` is a DECORATOR over the structural compile: a `role`
   * may replace what the node's `kind` would have emitted, then emphasis/surface colour
   * whatever came out; no `intent` takes exactly the `kind`'s road. density/artDirection are
   * carried on the IR for the design layers — ignoring them here is the contract.
   */
  function compileNode(node, idPrefix) {
    const idKey = `${idPrefix}/${node.kind}:${node.name ?? node.property ?? seq++}`;
    const intent = node.intent;
    if (!intent) return compileKind(node, idKey);
    const comp = roleCarrier(node, idKey, intent) ?? compileKind(node, idKey);
    if (comp && typeof comp === 'object') {
      applyEmphasis(comp, intent.emphasis);
      applySurface(comp, node, intent.surface);
    }
    return comp;
  }

  function compileKind(node, idKey) {
    switch (node.kind) {
      case 'field': return fieldComponent(node, idKey);
      case 'text': return textComponent(node, idKey, 'type.scale.body', 14, 'bodyText');
      case 'heading': {
        const lvl = HEADING[node.level] ? node.level : 2;
        return textComponent(node, idKey, HEADING_TOKEN[lvl], HEADING[lvl], 'sectionHeading', 'semibold');
      }
      case 'buttonGroup':
      case 'actions': return actionGroup(idKey, node);
      case 'datatable': return datatable(node, idKey);
      case 'datalist': return datalist(node, idKey);
      case 'tabs': return tabs(node, idKey);
      // the capture floor's error summary [R-006] — emitted only by normalize-archetype
      case 'validationErrors': return {
        id: uuid(idKey), type: 'validationErrors', version: ver('validationErrors'),
        componentName: node.name ?? 'formValidationErrors',
      };
      // region | stack | container | row | grid | card | section — all flex [R-028/R-029]
      default: return buildContainer(node, idKey);
    }
  }

  return { compileNode };
}

/**
 * Slot-aware nesting guard. Some 0.45 components host children in NAMED slots (a card's
 * header/content, a tabs' tabs, a wizard's steps); a child emitted into `components` on such a
 * component is silently DROPPED — the markup validates, the screen comes up empty.
 * assets/component-registry.json is the shape authority, so the slot list is READ, never
 * hard-coded; a type it does not know gets no check, because a registry gap must never invent
 * a compile error.
 */
export function slotErrors(tree) {
  let registry = null;
  try { registry = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', '..', 'assets', 'component-registry.json'), 'utf8').replace(/^﻿/, '')); }
  catch { return []; }
  if (!registry?.components) return [];
  const errors = [];
  (function walk(node, where) {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
    if (!node || typeof node !== 'object') return;
    const slots = typeof node.type === 'string' ? registry.components[node.type]?.customContainerNames : null;
    if (Array.isArray(slots) && slots.length && !slots.includes('components')
        && Array.isArray(node.components) && node.components.length) {
      errors.push(`${where} (${node.type}${node.componentName ? ` "${node.componentName}"` : ''}): ${node.components.length} child(ren) emitted into \`components\`, `
        + `but the registry declares named slots for this type — valid slots are ${slots.map((s) => `\`${s}\``).join(', ')}. `
        + 'The renderer reads children from the named slot only, so these children would never render.');
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, `${where}.${k}`);
  })(tree, 'components');
  return errors;
}
