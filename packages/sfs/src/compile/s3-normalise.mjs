// Stage 3: annotated tree -> canonical tree.
//
// This stage IS the normaliser. Six of the eight golden defects die here, and each
// one dies because the shape that expressed it is no longer reachable, not because a
// check rejects it:
//
//   N1  label/hideLabel defaults, and the page shell carries neither label nor labelAlign
//   N4  page-shell geometry is a constant; `page` takes no height input
//   N6  base stylingBox is always "{}" — values live only in the breakpoint blocks
//   N7  one wiring per event: rowClickActionConfiguration only
//   N8  formSettings is selected by `kind` and stripped to allowed union forbidden
//   N10 the body is a SIBLING of the title band, never a child of it
//
// N2, N3, N5 and N9 are s4's, because they are properties of the emitted breakpoint
// blocks rather than of the canonical tree.

import { SfsError } from './s1-parse.mjs';
import { resolveStyle } from '../lib/tokens.mjs';

/** @typedef {import('./s2-resolve.mjs').Node} Node */
/** @typedef {import('./s2-resolve.mjs').Diagnostic} Diagnostic */
/** @typedef {import('../lib/registry.mjs').Registry} Registry */
/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */

/** A `label` the designer never wrote: the framework's auto-name shape (N1). */
export const AUTO_LABEL = /^[A-Z][a-z]+\d+$/;

/**
 * The page-shell geometry, hardcoded (N4). `page` accepts a title and a subtitle and
 * nothing else, so the golden's `height: "30px"` on a table-bearing card has no input
 * that could produce it.
 */
export const PAGE_SHELL_DIMENSIONS = {
  width: '100%', height: 'auto', minHeight: '0px', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto',
};

/** The class the page shell carries in ALL THREE blocks (N3, applied in s4). */
export const PAGE_SHELL_CLASS = 'sha-page';

/**
 * Build the page shell around the body.
 *
 * N10 is structural here: `content.components` is [titleBand, ...body]. The title band
 * receives the two text nodes and nothing else, so a `data` region cannot end up
 * inside it — the golden's defect is not rejected, it is unconstructable.
 * @param {Registry} reg
 * @param {SfsDoc} doc
 * @param {Node[]} body
 * @returns {Node}
 */
function pageShell(reg, doc, body) {
  const page = /** @type {{title:string, subtitle?:string}} */ (doc.page);
  // Core registry components, always present; a cast keeps the original runtime
  // behaviour (a missing record would still throw on the .version read below).
  const container = /** @type {import('../lib/registry.mjs').ComponentRecord} */ (reg.components.container);
  const text = /** @type {import('../lib/registry.mjs').ComponentRecord} */ (reg.components.text);
  const card = /** @type {import('../lib/registry.mjs').ComponentRecord} */ (reg.components.card);

  /**
   * @param {string} name
   * @param {string} content
   * @param {string} sizeToken
   * @param {string} weight
   * @param {string} colourToken
   * @param {number} marginBottom
   * @returns {Node}
   */
  const textNode = (name, content, sizeToken, weight, colourToken, marginBottom) => ({
    node: 'text',
    name,
    type: 'text',
    version: text.version,
    sfsPath: `/pageShell/titleBand/${name}`,
    label: undefined,
    props: { content, _textNode: true },
    style: {
      text: {
        size: /** @type {number} */ (at(reg.tokens.type.scale, sizeToken)),
        weight: /** @type {string} */ (reg.tokens.type.weights[weight]),
        color: /** @type {string} */ (at(reg.tokens, reg.roles.roles[colourToken])),
        align: 'left',
      },
      margin: { bottom: marginBottom },
    },
    responsive: null,
    children: [],
    headerChildren: [],
    items: [],
    columns: [],
    raw: null,
    record: text,
  });

  /** @type {Node[]} */
  const bandChildren = [textNode('pageTitle', page.title, 'title', 'semibold', 'sectionHeading', 2)];
  if (typeof page.subtitle === 'string') {
    bandChildren.push(textNode('pageSubtitle', page.subtitle, 'subtitle', 'regular', 'secondaryText', 0));
  }

  /** @type {Node} */
  const titleBand = {
    node: 'col',
    name: 'titleBand',
    type: 'container',
    version: container.version,
    sfsPath: '/pageShell/titleBand',
    label: undefined,
    props: { _flexDirection: 'column' },
    style: { pad: { top: 4, bottom: 18 } },
    responsive: { gap: 4 },
    children: bandChildren,
    headerChildren: [],
    items: [],
    columns: [],
    raw: null,
    record: container,
  };

  return {
    node: 'card',
    name: 'pageShell',
    type: 'card',
    version: card.version,
    sfsPath: '/pageShell',
    // N1: no label, and no labelAlign. `hideHeading` is the card's own prop.
    label: undefined,
    props: { hideHeading: true, _pageShell: true },
    // The shell is built AFTER s2's token pass, so its own tokens must be resolved
    // here. Leaving "$role:pageBg" literal in the markup was a real defect: Q2's
    // oracle arm carries the measured literal, and the bytes could never agree.
    style: /** @type {Record<string, unknown>} */ (
      resolveStyle(reg, { bg: '$role:pageBg', _noBorder: true }, '/pageShell.style')),
    responsive: null,
    // N10: the body is a SIBLING of the title band.
    children: [titleBand, ...body],
    headerChildren: [],
    items: [],
    columns: [],
    raw: null,
    record: card,
  };
}

/**
 * @param {unknown} obj
 * @param {string} dotted
 * @returns {unknown}
 */
function at(obj, dotted) {
  /** @type {unknown} */
  let cur = obj;
  for (const seg of String(dotted).split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[seg];
  }
  return cur;
}

/**
 * `formSettings` selected by `kind` and stripped (N8, D-101..D-104).
 *
 * D-104 is what makes this subtle: `forbidden` means "present with a NON-null value".
 * The base block emits `onBeforeDataLoad: null`, which is legal and is what a list
 * form must carry; a non-null value there is the golden's defect 8.
 * @param {Registry} reg
 * @param {SfsDoc} doc
 * @returns {Record<string, unknown>}
 */
export function formSettingsFor(reg, doc) {
  const fs = reg.formSettings;
  const profile = fs.kinds[doc.kind];
  if (profile === undefined) {
    throw new SfsError('NRM-3401', `NRM-3401 no formSettings profile for kind "${doc.kind}"`);
  }

  /** @param {unknown} v @returns {unknown} */
  const deref = (v) => (typeof v === 'string' && v.startsWith('_') ? fs[v] : v);

  const submits = doc.submits === true;
  const submitterType = submits && profile.dataSubmitterTypeWhenSubmits !== undefined
    ? profile.dataSubmitterTypeWhenSubmits : profile.dataSubmitterType;
  const submitterSettings = submits && profile.dataSubmittersSettingsWhenSubmits !== undefined
    ? deref(profile.dataSubmittersSettingsWhenSubmits) : deref(profile.dataSubmittersSettings);

  const ACCESS = { inherited: 1, anonymous: 2, authenticated: 4 };
  const access = ACCESS[/** @type {keyof typeof ACCESS} */ (doc.access || 'authenticated')];

  // Emitted in the declared key order of form-settings.json, which s6 preserves.
  /** @type {Record<string, unknown>} */
  const out = {
    layout: fs.base.layout,
    colon: fs.base.colon,
    labelCol: fs.base.labelCol,
    wrapperCol: fs.base.wrapperCol,
    modelType: doc.entity === undefined ? null : entityToModelType(doc.entity, doc.module),
    dataLoaderType: profile.dataLoaderType,
    dataSubmitterType: submitterType,
    access,
    permissions: doc.permissions || [],
    version: fs.base.version,
  };

  // Every hook key is emitted, and every one illegal for this kind is emitted as
  // null. Present-and-null is the legal shape; absent would be a different form.
  for (const key of fs._hookKeys) {
    const declared = doc.hooks === undefined ? undefined : doc.hooks[key];
    if (declared === undefined) { out[key] = null; continue; }
    if (!profile.hooks.includes(key)) {
      throw new SfsError('NRM-3401',
        `NRM-3401 hook "${key}" is not legal for kind "${doc.kind}"; the legal hooks are `
        + `${profile.hooks.join(', ') || 'none'}. onBeforeDataLoad is legal for no kind (D-102)`);
    }
    out[key] = declared;
  }

  const loaders = deref(profile.dataLoadersSettings);
  if (loaders !== null && loaders !== undefined) out.dataLoadersSettings = loaders;
  // N8: a list or detail form NEVER carries a non-null dataSubmittersSettings.
  if (submitterSettings !== null && submitterSettings !== undefined) out.dataSubmittersSettings = submitterSettings;

  return out;
}

/**
 * `Boxfusion.Test.Domain.Bookings.Booking` -> `{name:"Booking", module:"boxfusion.test"}`.
 * @param {string} clrType
 * @param {string} moduleName
 * @returns {{name:string, module:string}}
 */
export function entityToModelType(clrType, moduleName) {
  const segments = clrType.split('.');
  // String.split always yields at least one element, so the last index is in-bounds.
  return { name: /** @type {string} */ (segments[segments.length - 1]), module: moduleName };
}

/**
 * N1 label defaults, N7 one-wiring-per-event, and sortOrder = index, applied over the
 * whole tree.
 * @param {Node} n
 * @param {Diagnostic[]} diagnostics
 * @returns {void}
 */
function normaliseNode(n, diagnostics) {
  // N1. Every non-field node hides its label. `labelAlign` is emitted only when a
  // label is present, so the golden's labelAlign-without-hideLabel cannot recur.
  // A labelled input shows its label; `field` and `select` are the two input nodes
  // (a decompiled dropdown/autocomplete lifts to `field`, so the two must agree).
  const isField = n.node === 'field' || n.node === 'select';
  n.props._hideLabel = !isField;
  if (n.label !== undefined && AUTO_LABEL.test(n.label)) {
    throw new SfsError('NRM-3101',
      `NRM-3101 label "${n.label}" at ${n.sfsPath} matches the framework's auto-name shape. `
      + 'An auto-name is not a label; omit it or write a real one', n.sfsPath);
  }

  // N7. SFS has exactly one onRowClick, so the code-mode onRowClick prop and the
  // duplicate dblClickActionConfiguration are never written. The golden wired the
  // same navigation three ways; there is one channel here.
  if (n.props.onRowClick !== undefined) {
    n.props.rowClickActionConfiguration = n.props.onRowClick;
    delete n.props.onRowClick;
  }
  if (n.props.onRowDoubleClick !== undefined) {
    n.props.dblClickActionConfiguration = n.props.onRowDoubleClick;
    delete n.props.onRowDoubleClick;
  }

  // N5, first half: a legacy styling prop is deleted whenever the type has v7
  // channels. s4 never emits one either, so there is no path that produces two.
  if (n.record.breakpointChannels.length > 0) {
    for (const legacy of n.record.legacyStyleProps) {
      if (n.props[legacy] !== undefined) {
        diagnostics.push({
          severity: 'info',
          code: 'NRM-3101',
          message: `legacy styling prop "${legacy}" dropped; ${n.type} carries v7 breakpoint channels`,
          where: n.sfsPath,
        });
        delete n.props[legacy];
      }
    }
  }

  // sortOrder is the array index, never an SFS input (A7).
  n.columns.forEach((c, i) => { c.sortOrder = i; });
  n.items.forEach((it, i) => { it.sortOrder = i; });

  for (const c of [...n.children, ...n.headerChildren]) normaliseNode(c, diagnostics);
}

/**
 * @param {{roots:Node[], doc:SfsDoc}} tree
 * @param {{registry:Registry}} ctx
 * @returns {{tree:{roots:Node[], doc:SfsDoc, formSettings:Record<string, unknown>}, diagnostics:Diagnostic[]}}
 */
export function normalise(tree, ctx) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const reg = ctx.registry;

  const roots = tree.doc.page === undefined ? tree.roots : [pageShell(reg, tree.doc, tree.roots)];
  for (const r of roots) normaliseNode(r, diagnostics);

  return {
    tree: { roots, doc: tree.doc, formSettings: formSettingsFor(reg, tree.doc) },
    diagnostics,
  };
}
