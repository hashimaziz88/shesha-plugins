// Stage 4: canonical tree -> full tree.
//
// Owns all three breakpoint blocks from ONE `style` plus ONE `responsive`, the calc()
// reserve arithmetic, registry defaults, slot topology, the column [not-editable]
// triplet, the crud-operations column, editMode stamping, and the `raw` merge.
//
// N2, N3, N5 and N9 are enforced here by construction:
//   N2  the resolved appearance object is written into all three blocks from one source
//   N3  className likewise — one value, three blocks, same pass
//   N5  a legacy styling prop is never emitted for a type with v7 channels
//   N9  a stacked breakpoint is always flexDirection:column, so 100%-wide children
//       cannot sit in a row block

import { BREAKPOINTS, stylingBoxString } from '../lib/orderedJson.mjs';
import { SfsError } from './s1-parse.mjs';

/** @typedef {import('./s2-resolve.mjs').Node} Node */
/** @typedef {import('./s2-resolve.mjs').Diagnostic} Diagnostic */
/** @typedef {import('../lib/registry.mjs').Registry} Registry */
/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */

/**
 * The breakpoint ladder, widest first. Only these three exist.
 * @type {readonly ['desktop', 'tablet', 'mobile']}
 */
const LADDER = ['desktop', 'tablet', 'mobile'];

/**
 * The emitted background object. Every key is required by the framework.
 * @param {unknown} colour
 * @returns {Record<string, unknown>}
 */
function backgroundOf(colour) {
  return {
    type: 'color',
    color: colour,
    repeat: 'no-repeat',
    size: 'auto',
    position: 'center',
    gradient: { direction: 'to right', colors: {} },
    url: '',
    storedFile: { id: null },
    uploadFile: null,
  };
}

/**
 * The emitted border object. `radius.all` and `border.all` are the only sub-keys the
 * compiler writes; the per-side objects are emitted empty because the framework reads
 * `borderType: "all"`.
 * @param {string|null} colour
 * @param {number|null} radius
 * @param {boolean} hidden
 */
function borderOf(colour, radius, hidden) {
  return {
    hideBorder: false,
    radiusType: 'all',
    borderType: 'all',
    border: {
      all: { width: '1px', style: hidden ? 'none' : 'solid', color: colour === null ? '#d9d9d9' : colour },
      top: {}, bottom: {}, left: {}, right: {},
    },
    radius: { all: radius === null ? 0 : radius },
  };
}

/**
 * Canonical shadow key order (section 2.1.8), whatever order the token file used.
 * @param {unknown} s
 * @returns {Record<string, unknown>}
 */
function shadowOf(s) {
  const t = /** @type {Record<string, unknown>} */ (s);
  return {
    offsetX: t.offsetX ?? 0,
    offsetY: t.offsetY ?? 0,
    color: t.color ?? '#000',
    blurRadius: t.blurRadius ?? 0,
    spreadRadius: t.spreadRadius ?? 0,
  };
}

/**
 * `pad`/`margin` -> the stylingBox string. Values are STRING numbers, which is the
 * measured production shape, and absent sides are omitted rather than zeroed.
 * @param {Record<string, unknown>} style
 * @returns {string}
 */
function stylingBoxFor(style) {
  /** @type {Record<string, string>} */
  const sides = {};
  const margin = /** @type {Record<string, number>} */ (style.margin || {});
  const pad = /** @type {Record<string, number>} */ (style.pad || {});
  /** @type {[string, string][]} */
  const sidePairs = [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']];
  for (const [key, side] of sidePairs) {
    if (margin[key] !== undefined) sides[`margin${side}`] = String(margin[key]);
  }
  for (const [key, side] of sidePairs) {
    if (pad[key] !== undefined) sides[`padding${side}`] = String(pad[key]);
  }
  return stylingBoxString(sides);
}

/**
 * The reserve arithmetic (section 2.1.5), stated once.
 *
 *   reserve = sum(fixed widths in px) + gap x count(fixed children)
 *
 * Verified against production: one fixed child at 180px with gap 16 gives 196, and the
 * production form carries `calc(100% - 196px)` byte for byte.
 * @param {Record<string, string>} fixed
 * @param {number} gap
 * @param {string} where
 * @returns {number}
 */
export function reserveFor(fixed, gap, where) {
  let total = 0;
  let count = 0;
  for (const [name, value] of Object.entries(fixed)) {
    const m = /^(\d+)px$/.exec(value);
    if (m === null) {
      throw new SfsError('EXP-4104',
        `EXP-4104 fixed width "${value}" for "${name}" at ${where} is not px. The reserve arithmetic is `
        + 'defined for px only: declare fixed in px, or use raw at desktop', where);
    }
    total += Number(m[1]);
    count += 1;
  }
  return total + gap * count;
}

/**
 * Child widths per breakpoint, from the parent's one `responsive` declaration.
 * @param {Node} parent
 * @returns {Record<'desktop'|'tablet'|'mobile', Record<string, string>>} breakpoint -> childName -> width
 */
export function childWidths(parent) {
  /** @type {Record<'desktop'|'tablet'|'mobile', Record<string, string>>} */
  const out = { desktop: {}, tablet: {}, mobile: {} };
  const r = parent.responsive;
  if (r === null) {
    // A row with no responsive declaration still cannot give every child the
    // 100% dimension default: two 100% children in a row block is exactly the
    // incoherent geometry N9 exists to kill. Children of an undeclared row are
    // auto at every breakpoint.
    if (parent.props._flexDirection === 'row') {
      for (const bp of LADDER) for (const c of parent.children) out[bp][c.name] = 'auto';
    }
    return out;
  }

  const fixed = /** @type {Record<string, string>} */ (r.fixed || {});
  const fill = typeof r.fill === 'string' ? r.fill : null;
  const isRow = parent.props._flexDirection === 'row';
  const gap = typeof r.gap === 'number' ? r.gap : (isRow ? 16 : 0);
  const stack = typeof r.stack === 'string' ? r.stack : 'never';

  const names = parent.children.map((c) => c.name);
  for (const name of Object.keys(fixed)) {
    if (!names.includes(name)) {
      throw new SfsError('SFS-1502', `SFS-1502 responsive.fixed names "${name}", which is not a direct child of ${parent.sfsPath}`, parent.sfsPath);
    }
  }
  if (fill !== null && !names.includes(fill)) {
    throw new SfsError('SFS-1502', `SFS-1502 responsive.fill names "${fill}", which is not a direct child of ${parent.sfsPath}`, parent.sfsPath);
  }
  if (Object.keys(fixed).length > 0 && fill === null) {
    throw new SfsError('SFS-1503', `SFS-1503 ${parent.sfsPath} declares fixed widths with no fill to consume the reserve`, parent.sfsPath);
  }

  const reserve = reserveFor(fixed, gap, parent.sfsPath);
  // `at:X` puts X and every NARROWER breakpoint into column. `below:` is rejected by
  // the schema precisely because it is off-by-one ambiguous.
  const stackFrom = stack === 'at:tablet' ? 1 : stack === 'at:mobile' ? 2 : LADDER.length;

  LADDER.forEach((bp, i) => {
    const col = out[bp];
    for (const name of names) {
      if (i >= stackFrom) { col[name] = '100%'; continue; }
      const fixedWidth = fixed[name];
      if (fixedWidth !== undefined) col[name] = fixedWidth;
      else if (name === fill) col[name] = `calc(100% - ${reserve}px)`;
      else col[name] = 'auto';
    }
  });
  return out;
}

/**
 * Build one breakpoint block. Appearance is IDENTICAL across the three (N2/N3); only
 * geometry varies, which is the whole reason SFS has no per-breakpoint style channel.
 * @param {Node} n
 * @param {string} bp
 * @param {string|null} width
 * @param {boolean} stacked
 * @returns {Record<string, unknown>}
 */
function blockFor(n, bp, width, stacked) {
  const channels = new Set(n.record.breakpointChannels);
  const style = n.style;
  /** @type {Record<string, unknown>} */
  const block = {};

  const isRow = n.props._flexDirection === 'row';
  const hide = Array.isArray(n.responsive?.hide) ? /** @type {string[]} */ (n.responsive.hide) : [];

  if (channels.has('display')) {
    block.display = hide.includes(bp) ? 'none' : 'flex';
    // N9: a stacked breakpoint is column, so a 100%-wide child can never sit in a row.
    block.flexDirection = stacked ? 'column' : String(n.props._flexDirection || 'column');
    block.justifyContent = justifyOf(n.props._justify, isRow);
    block.alignItems = stacked ? 'stretch' : alignOf(n.props._align);
    block.flexWrap = 'nowrap';
    const gap = n.responsive !== null && typeof n.responsive.gap === 'number'
      ? n.responsive.gap : (isRow ? 16 : 0);
    block.gap = String(gap);
  } else if (hide.includes(bp)) {
    block.display = 'none';
  }

  // The `text` channel lands on `font`, and only on a node whose registry record
  // declares it: font on a container is a framework no-op.
  if (channels.has('font') && style.text !== undefined) {
    const t = /** @type {Record<string, unknown>} */ (style.text);
    block.font = {
      type: n.props._fontFamily ?? '$family',
      size: t.size,
      weight: t.weight,
      color: t.color,
      align: t.align ?? 'left',
    };
  }
  if (channels.has('background') && style.bg !== undefined) block.background = backgroundOf(style.bg);
  if (channels.has('border') && (style.border !== undefined || style.radius !== undefined || style._noBorder === true)) {
    block.border = borderOf(
      style.border === undefined ? null : /** @type {string} */ (style.border),
      style.radius === undefined ? null : /** @type {number} */ (style.radius),
      style._noBorder === true,
    );
  }
  if (channels.has('shadow') && style.shadow !== undefined) block.shadow = shadowOf(style.shadow);

  if (channels.has('dimensions')) {
    const defaults = n.record.dimensionDefaults;
    if (defaults !== undefined || width !== null || style.width !== undefined || style.height !== undefined) {
      /** @type {Record<string, unknown>} */
      const dims = { ...(defaults || {}) };
      if (style.width !== undefined) dims.width = style.width;
      if (style.height !== undefined) dims.height = style.height;
      // The parent's reserve arithmetic wins over a declared style.width: geometry is
      // the parent's to distribute.
      if (width !== null) dims.width = width;
      if (n.props._pageShell === true) Object.assign(dims, n.props._pageShellDimensions);
      block.dimensions = dims;
    }
  }

  if (channels.has('stylingBox')) {
    const box = stylingBoxFor(style);
    if (box !== '{}') block.stylingBox = box;
  }
  if (channels.has('enableStyleOnReadonly')) block.enableStyleOnReadonly = false;
  // N3: one className value, written into every block in this same pass.
  if (channels.has('className') && typeof n.props._className === 'string') block.className = n.props._className;

  return block;
}

/** @param {unknown} v @param {boolean} isRow @returns {string} */
function justifyOf(v, isRow) {
  const map = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
  if (typeof v === 'string' && map[/** @type {keyof typeof map} */ (v)] !== undefined) {
    return map[/** @type {keyof typeof map} */ (v)];
  }
  return isRow ? 'space-between' : 'flex-start';
}

/** @param {unknown} v @returns {string} */
function alignOf(v) {
  const map = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
  if (typeof v === 'string' && map[/** @type {keyof typeof map} */ (v)] !== undefined) {
    return map[/** @type {keyof typeof map} */ (v)];
  }
  return 'stretch';
}

/**
 * The `[not-editable]` triplet, emitted on every non-inline column.
 *
 * `[default]` on edit/create is EXP-4302 and a flat editor with no `settings` wrapper
 * is unrepresentable, which is how `debug.md` rows 20 and 21 die.
 * @param {Registry} reg
 * @param {Record<string, unknown>} col
 * @param {boolean} inline
 * @returns {Record<string, unknown>}
 */
function columnComponents(reg, col, inline) {
  const render = /** @type {Record<string, unknown>|null} */ (col.render);
  /** @type {Record<string, unknown>} */
  let display = { type: '[default]' };

  if (render !== null && render.kind === 'statusBadge') {
    // refListStatus is a core registry component; the cast preserves the original
    // runtime behaviour (a missing record would still throw on the .version read).
    const rec = /** @type {import('../lib/registry.mjs').ComponentRecord} */ (reg.components.refListStatus);
    display = {
      type: 'refListStatus',
      settings: {
        type: 'refListStatus',
        version: rec.version,
        propertyName: col.bind,
        componentName: `${String(col.bind)}Cell`,
        label: col.caption,
        hideLabel: true,
        referenceListId: render._referenceListId,
        solidBackground: render.solid === true,
        showReflistName: render.showName !== false,
        showIcon: render.showIcon === true,
      },
    };
  } else if (render !== null && render.kind === 'custom') {
    display = { type: String(render.type), settings: { ...(/** @type {Record<string, unknown>} */ (render.props || {})) } };
  }

  if (!inline) {
    return { displayComponent: display, editComponent: { type: '[not-editable]' }, createComponent: { type: '[not-editable]' } };
  }
  // Inline columns carry a REAL editor or none at all. `[default]` on edit/create is
  // EXP-4302 by construction: the only reachable shapes are the declared editor's
  // {type, settings} wrapper (EXP-4301's guarantee) or absence.
  const editor = /** @type {Record<string, unknown>|undefined} */ (col.editor);
  if (editor !== undefined && typeof editor.type === 'string') {
    const wrapped = { type: editor.type, settings: { ...(/** @type {Record<string, unknown>} */ (editor.props || {})) } };
    return { displayComponent: display, editComponent: wrapped, createComponent: wrapped };
  }
  return { displayComponent: display };
}

/**
 * Merge a `raw` block LAST, after expansion and before stamping, so it can override any
 * generated prop but cannot forge an id, parentId or version — those three are rejected
 * by the schema's propertyNames, so this merge cannot reintroduce them.
 * @param {Node} n
 * @param {Record<string, unknown>} emitted
 * @param {{path:string, at:string, reason:string, props:string[], structural:boolean}[]} escapes
 * @returns {void}
 */
function mergeRaw(n, emitted, escapes) {
  if (n.raw === null) return;
  const where = typeof n.raw.at === 'string' ? n.raw.at : 'base';
  const props = /** @type {Record<string, unknown>} */ (n.raw.props || {});
  const target = where === 'base' ? emitted : /** @type {Record<string, unknown>} */ (emitted[where]);
  if (target === undefined) {
    throw new SfsError('EXP-4201', `EXP-4201 raw at "${where}" for ${n.sfsPath} has no such target block`, n.sfsPath);
  }
  Object.assign(target, props);
  escapes.push({
    path: n.sfsPath,
    at: where,
    reason: String(n.raw.reason),
    props: Object.keys(props),
    structural: where === 'items' || n.node === 'raw',
  });
}

/**
 * @param {Node} n
 * @param {{registry:Registry, doc:SfsDoc, profile:any, escapes:any[], nodes:{id:string, sfsPath:string, name:string, type:string}[]}} ctx
 * @param {Record<string, string|null>} widths breakpoint -> this node's width
 * @returns {Record<string, unknown>}
 */
function expandNode(n, ctx, widths) {
  const reg = ctx.registry;
  const rec = n.record;

  // The page shell's geometry and class are constants, not inputs (N4, N3).
  if (n.props._pageShell === true) {
    n.props._className = 'sha-page';
    n.props._pageShellDimensions = {
      width: '100%', height: 'auto', minHeight: '0px', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto',
    };
  }
  if (n.props._textNode === true) n.props._fontFamily = reg.tokens.type.family;

  // The typed escape hatch (§2.1.9): a node:"raw" region emits raw.props VERBATIM
  // under type+version+name, is recorded as a structural escape, and is marked
  // `_rawEscape` so s5 stamps only its own id/parentId and never descends into the
  // opaque payload (its items/components keep their production ids). This is what
  // lets an un-expressible production node round-trip: it re-decompiles to the same
  // escape because its emitted payload still fails to lift.
  if (n.node === 'raw') {
    const raw = /** @type {Record<string, unknown>} */ (n.raw || {});
    const props = /** @type {Record<string, unknown>} */ (raw.props || {});
    /** @type {Record<string, unknown>} */
    const escaped = { type: n.type, version: n.version, propertyName: n.name, componentName: n.name };
    for (const [key, value] of Object.entries(props)) escaped[key] = value;
    escaped._rawEscape = true;
    escaped._sfsPath = n.sfsPath;
    ctx.escapes.push({
      path: n.sfsPath, at: 'node', reason: String(raw.reason || 'raw escape'),
      props: Object.keys(props), structural: true,
    });
    return escaped;
  }

  /** @type {Record<string, unknown>} */
  const out = { type: n.type, version: n.version, propertyName: n.name, componentName: n.name };

  // N1: a label is emitted only when SFS declared one; hideLabel is always explicit.
  if (n.label !== undefined) out.label = n.label;
  out.hideLabel = n.props._hideLabel !== false;
  // Most registry records (103 of 121) carry no `defaults` block — only the 18 with
  // authored default props do. A node of any other type (a button, an alert, a
  // checkbox field …) reaching here with `rec.defaults` undefined was the
  // `reading 'hidden'` TypeError the mining run hit on 498 real forms
  // (MINING-REPORT.md §5). A missing defaults block means "no defaults to apply",
  // not a crash and not an error.
  const recDefaults = rec.defaults || {};
  out.hidden = recDefaults.hidden === undefined ? false : recDefaults.hidden;
  out.isDynamic = false;

  // Registry defaults for every unstated prop, then the node's own props on top.
  for (const [key, value] of Object.entries(recDefaults)) {
    if (key === 'hidden' || key === 'hideLabel') continue;
    out[key] = value;
  }
  for (const [key, value] of Object.entries(n.props)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }

  // Input-ish leaves (field/select/status/list): s2 left the framework shapes on
  // `_`-prefixed hints; lift them into the real keys. `propertyName` is the bound
  // property, not the region name, for these nodes.
  if (typeof n.props._propertyName === 'string') out.propertyName = n.props._propertyName;
  if (n.props._referenceListId !== undefined) out.referenceListId = n.props._referenceListId;
  if (n.props._dataSourceType !== undefined) out.dataSourceType = n.props._dataSourceType;
  if (n.props._solidBackground !== undefined) out.solidBackground = n.props._solidBackground;
  if (n.props._showReflistName !== undefined) out.showReflistName = n.props._showReflistName;
  if (n.props._formId !== undefined) { out.formId = n.props._formId; out.formSelectionMode = 'name'; }

  // The container's base-level flex mirror, which production carries alongside the
  // three blocks.
  if (rec.breakpointChannels.includes('display')) {
    const isRow = n.props._flexDirection === 'row';
    out.display = 'flex';
    out.flexDirection = String(n.props._flexDirection || 'column');
    out.justifyContent = justifyOf(n.props._justify, isRow);
    out.alignItems = alignOf(n.props._align);
    out.flexWrap = 'nowrap';
    out.gap = String(n.responsive !== null && typeof n.responsive.gap === 'number' ? n.responsive.gap : (isRow ? 16 : 0));
    out.direction = n.props._flexDirection === 'row' ? 'horizontal' : 'vertical';
  }
  if (n.props._textNode === true) out.content = n.props.content;

  // editMode, stamped from the kind profile onto the channel the registry declares.
  const channel = rec.editModeChannel;
  if (typeof channel === 'string') out.editMode = ctx.profile.editMode[channel];

  // N6: base stylingBox is ALWAYS the literal "{}". Values live only in the blocks.
  if (rec.breakpointChannels.includes('stylingBox')) out.stylingBox = '{}';

  const stack = n.responsive === null ? 'never' : String(n.responsive.stack || 'never');
  const stackFrom = stack === 'at:tablet' ? 1 : stack === 'at:mobile' ? 2 : LADDER.length;
  if (rec.breakpointBlocks) {
    LADDER.forEach((bp, i) => {
      out[bp] = blockFor(n, bp, widths[bp] ?? null, i >= stackFrom);
    });
  }

  // dataContext derives its own props from the document and its declared page size.
  if (n.type === 'dataContext') {
    out.entityType = n.props.entityType ?? ctx.doc.entity;
    out.defaultPageSize = n.props.pageSize ?? 10;
    out.uniqueStateId = n.name;
    delete out.pageSize;
    out.dataFetchingMode = n.props.mode === 'all' ? 'all' : 'paging';
    delete out.mode;
  }

  // Columns: the triplet, the crud-operations insertion, and columnType derivation.
  if (n.columns.length > 0) {
    const inline = String(n.props.inline || 'none') !== 'none';
    /** @type {Record<string, unknown>[]} */
    const items = n.columns.map((col) => {
      /** @type {Record<string, unknown>} */
      const emitted = {
        itemType: 'item',
        sortOrder: col.sortOrder,
        columnType: col.bind === null ? 'action' : 'data',
        caption: col.caption,
        isVisible: col.visible !== false,
        allowSorting: col.sortable !== false,
        ...columnComponents(reg, col, inline),
      };
      if (col.bind !== null) emitted.propertyName = col.bind;
      if (col.min !== undefined) emitted.minWidth = col.min;
      if (col.width !== undefined) emitted.width = col.width;
      // `max: null` is a measured production shape; it is carried, not invented.
      if (col.max !== undefined) emitted.maxWidth = col.max;
      if (col.do !== undefined) emitted.actionConfiguration = col.do;
      emitted._sfsPath = col.sfsPath;
      return emitted;
    });
    if (inline) {
      // Auto-inserted at sortOrder -1, which is what makes `debug.md` row 22
      // (inline enabled with no CRUD column) unreachable.
      // caption "" and isVisible true are the measured production shape of the
      // crud-operations column, not decoration.
      items.unshift({
        itemType: 'item', sortOrder: -1, columnType: 'crud-operations',
        caption: '', isVisible: true, _sfsPath: `${n.sfsPath}#col:crud`,
      });
      out.canEditInline = 'yes';
    }
    out.items = items;
    delete out.columns;
    delete out.inline;
  }

  // Action items: editMode on the item as well as the group (section 2.1.7).
  if (n.items.length > 0) {
    out.items = n.items.map((it) => {
      /** @type {Record<string, unknown>} */
      const emitted = {
        itemType: 'item',
        itemSubType: 'button',
        sortOrder: it.sortOrder,
        name: it.name,
        label: it.label,
        buttonType: it.buttonType,
        editMode: ctx.profile.editMode.actionsItem,
        buttonAction: it.buttonAction,
        actionConfiguration: it.actionConfiguration,
      };
      if (it.icon !== undefined) emitted.icon = it.icon;
      emitted._sfsPath = it.sfsPath;
      return emitted;
    });
  }

  // Slot topology: children go into the registry's declared childrenKey, which is how
  // `card.content.components` stops being a thing an author can get wrong.
  const kids = n.children.map((c) => expandNode(c, ctx, perChildWidths(n, c)));
  if (kids.length > 0) {
    if (rec.childrenKey === 'content.components') out.content = { components: kids };
    else if (rec.childrenKey === 'components') out.components = kids;
    else throw new SfsError('EXP-4201', `EXP-4201 ${n.type} at ${n.sfsPath} has ${kids.length} child(ren) but no childrenKey`, n.sfsPath);
  } else if (rec.childrenKey === 'content.components') {
    out.content = { components: [] };
  }
  // A slot the registry declares is emitted whether or not it has children: production
  // carries `header: {id, components: []}` on every card, and a slot that appears only
  // when occupied would make the decompiler's round trip depend on occupancy.
  // `slots` is recorded two ways across the registry: an array of slot names (card
  // alone), or an object {kind, names, …} on the 103 leaf records. Normalising before
  // asking for a slot is the second half of the WP-5c robustness fix: without it a
  // leaf field crashed here on `(object).includes` right after clearing the `hidden`
  // TypeError above.
  // The ComponentRecord type declares `slots` as string[]; the data also carries the
  // object shape on leaf records, so read through `unknown` into the union.
  const rawSlots = /** @type {string[] | {names?: string[]} | undefined} */ (/** @type {unknown} */ (rec.slots));
  const slotNames = Array.isArray(rawSlots)
    ? rawSlots
    : (rawSlots && Array.isArray(rawSlots.names) ? rawSlots.names : []);
  if (slotNames.includes('header')) {
    out.header = { components: n.headerChildren.map((c) => expandNode(c, ctx, { desktop: null, tablet: null, mobile: null })) };
  }

  out._sfsPath = n.sfsPath;
  mergeRaw(n, out, ctx.escapes);
  return out;
}

/**
 * @param {Node} parent
 * @param {Node} child
 * @returns {Record<string, string|null>}
 */
function perChildWidths(parent, child) {
  const table = childWidths(parent);
  return {
    desktop: table.desktop[child.name] ?? null,
    tablet: table.tablet[child.name] ?? null,
    mobile: table.mobile[child.name] ?? null,
  };
}

/**
 * @param {{roots:Node[], doc:SfsDoc, formSettings:Record<string, unknown>}} tree
 * @param {{registry:Registry}} ctx
 * @returns {{tree:{components:Record<string, unknown>[], formSettings:Record<string, unknown>, doc:SfsDoc}, diagnostics:Diagnostic[], escapes:any[]}}
 */
export function expand(tree, ctx) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  /** @type {any[]} */
  const escapes = [];
  const profile = ctx.registry.formSettings.kinds[tree.doc.kind];
  const inner = { registry: ctx.registry, doc: tree.doc, profile, escapes, nodes: [] };
  const components = tree.roots.map((r) => expandNode(r, inner, { desktop: null, tablet: null, mobile: null }));
  return { tree: { components, formSettings: tree.formSettings, doc: tree.doc }, diagnostics, escapes };
}
