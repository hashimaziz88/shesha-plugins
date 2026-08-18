// The decompiler (section 2.5). Markup or envelope in, SFS out.
//
// D-076 is the governing rule: the decompiler is LOSSLESS by default. Every prop the
// compiler will not regenerate from the lifted SFS is carried in a typed raw block,
// so `compile(decompile(m))` differs from `m` by exactly the normalisation set
// N1..N12 and nothing else — which is the load-bearing constraint behind Q2.
//
// The residue pass at the bottom is how losslessness is achieved by measurement
// rather than by a hand-maintained prop list: the candidate SFS is compiled once,
// each emitted node is diffed against its source node at base level, and every
// difference outside the normalisation-owned key set becomes a raw prop. The
// normalisation-owned keys (EXCLUDED below) are exactly the N1..N12 surface: keys
// where the compiler is SUPPOSED to disagree with a defective input.

import { compile } from '../compile/index.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { camelPath } from '../compile/s2-resolve.mjs';
import { AUTO_LABEL } from '../compile/s3-normalise.mjs';
import { resolveToken } from '../lib/tokens.mjs';
import { detect } from './detect.mjs';

/** @typedef {import('../lib/registry.mjs').Registry} Registry */
/** @typedef {{severity:'error'|'info', code:string, message:string, where?:string}} Diagnostic */

export class DecompileError extends Error {
  /** @param {string} code @param {string} m */
  constructor(code, m) { super(m); this.name = 'DecompileError'; this.code = code; }
}

/**
 * Base-level keys the residue pass must NOT lift back, because the compiler is
 * supposed to disagree with the input about them. This set is the decompiler's
 * half of the N1..N12 contract:
 *   N1  label / labelAlign / hideLabel are normalisation outputs
 *   N3  className is a recipe output, never carried
 *   N5  legacy styling props are deleted per-type (rec.legacyStyleProps, added below)
 *   N6  base stylingBox is always the literal "{}"
 *   N7  the code-mode onRowClick and the duplicate dblClickActionConfiguration die
 *   N12 item-level editMode is stamped from the kind profile (D-077)
 */
export const EXCLUDED = new Set([
  'id', 'parentId', 'componentName', 'version', 'sortOrder',
  'desktop', 'tablet', 'mobile', 'content', 'header', 'components', 'items', 'tabs',
  'label', 'labelAlign', 'hideLabel', 'className', 'stylingBox',
  'onRowClick', 'dblClickActionConfiguration', 'editMode',
]);

/** Access integer -> SFS enum. */
const ACCESS_NAMES = { 1: 'inherited', 2: 'anonymous', 4: 'authenticated' };

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** @param {unknown} a @param {unknown} b @returns {boolean} */
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/**
 * type -> SFS node kind, generated from the registry's sfsNode column (D-111).
 * `container` resolves to row/col by the node's own flexDirection.
 * @param {Registry} reg
 * @param {Record<string, unknown>} mk
 * @returns {string|null}
 */
function nodeKindOf(reg, mk) {
  const type = String(mk.type);
  const rec = reg.components[type];
  if (rec === undefined || rec.sfsNode === null || rec.sfsNode === undefined) return null;
  if (type === 'container') {
    const dir = mk.flexDirection ?? (isObj(mk.desktop) ? mk.desktop.flexDirection : undefined);
    return dir === 'row' ? 'row' : 'col';
  }
  return rec.sfsNode;
}

/**
 * Reverse role lookup: literal value -> `$role:<name>`, first declaration wins.
 * @param {Registry} reg
 * @param {unknown} value
 * @returns {string|null}
 */
function roleFor(reg, value) {
  for (const name of Object.keys(reg.roles.roles)) {
    if (deepEqual(resolveToken(reg, `$role:${name}`, '<decompile>'), value)) return `$role:${name}`;
  }
  return null;
}

/**
 * Match one node's appearance channels against the surface recipes (section 2.5
 * step 4, reversed). Every recipe channel must agree with the block for the match
 * to hold, and appearance is read from DESKTOP — on a per-breakpoint conflict the
 * desktop value wins, which is the N2 lift.
 * @param {Registry} reg
 * @param {Record<string, unknown>} block the desktop block
 * @returns {string|null} the surface name
 */
function surfaceFor(reg, block) {
  const bg = isObj(block.background) ? block.background.color : undefined;
  const border = isObj(block.border) ? block.border : undefined;
  const borderAll = border !== undefined && isObj(border.border) && isObj(border.border.all)
    ? border.border.all : undefined;
  const radius = border !== undefined && isObj(border.radius) ? border.radius.all : undefined;
  const shadow = isObj(block.shadow) ? block.shadow : undefined;

  for (const [name, recipe] of Object.entries(reg.roles.surfaces)) {
    const r = /** @type {Record<string, unknown>} */ (recipe);
    if (Object.keys(r).length === 0) continue; // "none" matches everything vacuously
    let ok = true;
    if (r.bg !== undefined) {
      ok = ok && deepEqual(bg, resolveToken(reg, String(r.bg), '<decompile>'));
    }
    if (r.border !== undefined) {
      ok = ok && borderAll !== undefined && borderAll.style === 'solid'
        && deepEqual(borderAll.color, resolveToken(reg, String(r.border), '<decompile>'));
    }
    if (r.radius !== undefined) {
      ok = ok && deepEqual(radius, resolveToken(reg, String(r.radius), '<decompile>'));
    }
    if (r.shadow !== undefined) {
      const want = resolveToken(reg, String(r.shadow), '<decompile>');
      // The empty shadow token means "no shadow emitted".
      const wantsNone = isObj(want) && Object.keys(want).length === 0;
      ok = ok && (wantsNone ? shadow === undefined : shadow !== undefined
        && Object.entries(/** @type {Record<string, unknown>} */ (want)).every(([k, v]) => deepEqual(shadow[k], v)));
    }
    if (ok && (r.bg !== undefined || r.border !== undefined)) return name;
  }
  return null;
}

/**
 * pad/margin lift from the desktop block's stylingBox string.
 * @param {Record<string, unknown>} block
 * @returns {{pad?:Record<string, number>, margin?:Record<string, number>}}
 */
function boxFor(block) {
  if (typeof block.stylingBox !== 'string') return {};
  /** @type {Record<string, string>} */
  let sides;
  try { sides = JSON.parse(block.stylingBox); } catch { return {}; }
  /** @type {Record<string, number>} */
  const pad = {};
  /** @type {Record<string, number>} */
  const margin = {};
  for (const [key, value] of Object.entries(sides)) {
    const m = /^(margin|padding)(Top|Right|Bottom|Left)$/.exec(key);
    if (m === null) continue;
    const side = m[2].toLowerCase();
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    (m[1] === 'padding' ? pad : margin)[side] = n;
  }
  /** @type {{pad?:Record<string, number>, margin?:Record<string, number>}} */
  const out = {};
  if (Object.keys(pad).length > 0) out.pad = pad;
  if (Object.keys(margin).length > 0) out.margin = margin;
  return out;
}

/**
 * Reverse one framework action config to the SFS intent form (section 2.5 step 6).
 * @param {Registry} reg
 * @param {Record<string, unknown>} cfg
 * @param {Map<string, string>} regionNameById dataContext id -> lifted region name
 * @param {Diagnostic[]} diagnostics
 * @returns {Record<string, unknown>|null} null when the (actionName, actionOwner) pair is unmapped
 */
function liftAction(reg, cfg, regionNameById, diagnostics) {
  const actionName = String(cfg.actionName);
  /** @type {string|null} */
  let intent = null;
  /** @type {any} */
  let spec = null;
  for (const [name, s] of Object.entries(reg.actions.intents)) {
    if (/** @type {any} */ (s).actionName === actionName) { intent = name; spec = s; break; }
  }
  if (intent === null) {
    diagnostics.push({ severity: 'info', code: 'DEC-7301', message: `unmapped action "${actionName}" carried raw` });
    return null;
  }

  /** @type {Record<string, unknown>} */
  const out = { do: intent };
  /** @type {Record<string, unknown>} */
  const withArgs = {};

  if (spec.actionOwner === reg.actions._ownerRefSentinel) {
    const ownerId = String(cfg.actionOwner);
    const target = regionNameById.get(ownerId);
    if (target === undefined) {
      diagnostics.push({ severity: 'info', code: 'DEC-7302', message: `action "${actionName}" owner ${ownerId} is not a data region; carried raw` });
      return null;
    }
    withArgs.target = target;
  }

  const args = /** @type {Record<string, unknown>} */ (cfg.actionArguments || {});
  /** @type {Record<string, string>} */
  const reverseMap = {};
  for (const [sfsKey, fwKey] of Object.entries(/** @type {Record<string, string>} */ (spec.argMap))) {
    reverseMap[fwKey] = sfsKey;
  }
  for (const [fwKey, value] of Object.entries(args)) {
    const sfsKey = reverseMap[fwKey];
    if (sfsKey === undefined) {
      // An unmapped framework argument equal to the intent's default is regenerated;
      // anything else cannot be expressed and voids the lift.
      if (deepEqual(/** @type {Record<string, unknown>} */ (spec.argDefaults)[fwKey], value)) continue;
      diagnostics.push({ severity: 'info', code: 'DEC-7303', message: `argument "${fwKey}" of "${actionName}" is not liftable; carried raw` });
      return null;
    }
    if (sfsKey === 'form' && isObj(value)) {
      withArgs.form = `${String(value.module)}/${String(value.name)}`;
    } else if (sfsKey === 'args' && intent === 'navigate' && Array.isArray(value)) {
      /** @type {Record<string, unknown>} */
      const qp = {};
      for (const pair of /** @type {Record<string, unknown>[]} */ (value)) qp[String(pair.key)] = pair.value;
      withArgs.args = qp;
    } else if (deepEqual(/** @type {Record<string, unknown>} */ (spec.argDefaults)[fwKey], value)) {
      continue; // a default the compiler will regenerate
    } else {
      withArgs[sfsKey] = value;
    }
  }
  if (Object.keys(withArgs).length > 0) out.with = withArgs;

  if (cfg.onSuccess !== undefined && isObj(cfg.onSuccess)) {
    const inner = liftAction(reg, cfg.onSuccess, regionNameById, diagnostics);
    if (inner === null) return null;
    out.onSuccess = inner;
  }
  if (cfg.onFail !== undefined && isObj(cfg.onFail)) {
    const inner = liftAction(reg, cfg.onFail, regionNameById, diagnostics);
    if (inner === null) return null;
    out.onFail = inner;
  }
  return out;
}

/**
 * The page-shell lift. A single root card whose content leads with a container of
 * text nodes is the shell; its texts become `page` and everything else — including
 * any body region the golden nested INSIDE the title band (defect N10) — becomes
 * the body list.
 * @param {Record<string, unknown>[]} components
 * @returns {{page:{title:string, subtitle?:string}, body:Record<string, unknown>[]}|null}
 */
function liftShell(components) {
  if (components.length !== 1) return null;
  const root = components[0];
  if (root.type !== 'card' || !isObj(root.content) || !Array.isArray(root.content.components)) return null;
  const kids = /** @type {Record<string, unknown>[]} */ (root.content.components);
  const band = kids[0];
  if (band === undefined || band.type !== 'container' || !Array.isArray(band.components)) return null;
  const bandKids = /** @type {Record<string, unknown>[]} */ (band.components);
  if (bandKids.length === 0 || bandKids[0].type !== 'text') return null;

  /** @type {string[]} */
  const texts = [];
  /** @type {Record<string, unknown>[]} */
  const body = [];
  for (const kid of bandKids) {
    if (kid.type === 'text' && texts.length < 2 && body.length === 0) {
      texts.push(String(kid.content ?? ''));
    } else {
      body.push(kid); // N10: a body region nested inside the title band is lifted out
    }
  }
  body.push(...kids.slice(1));

  /** @type {{title:string, subtitle?:string}} */
  const page = { title: texts[0] };
  if (texts.length > 1) page.subtitle = texts[1];
  return { page, body };
}

/**
 * kind inference (section 2.5 step 2).
 * @param {Record<string, unknown>[]} components
 * @param {Record<string, unknown>} formSettings
 * @param {Diagnostic[]} diagnostics
 * @returns {string}
 */
function inferKind(components, formSettings, diagnostics) {
  let hasTable = false;
  /** @param {unknown} n @returns {void} */
  const walk = (n) => {
    if (!isObj(n)) return;
    if (n.type === 'datatable' || n.type === 'datalist') hasTable = true;
    for (const key of ['components']) if (Array.isArray(n[key])) n[key].forEach(walk);
    for (const key of ['content', 'header']) if (isObj(n[key]) && Array.isArray(/** @type {any} */ (n[key]).components)) /** @type {any} */ (n[key]).components.forEach(walk);
  };
  components.forEach(walk);
  if (hasTable && formSettings.dataLoaderType === 'gql') return 'list';
  diagnostics.push({ severity: 'info', code: 'DEC-7201', message: 'kind is ambiguous; defaulted to custom' });
  return 'custom';
}

/**
 * @typedef {{sfs:Record<string, unknown>, diagnostics:Diagnostic[], unlifted:{path:string, keys:string[]}[],
 *            provenance:string, structuralEscapes:number}} DecompileResult
 */

/**
 * @param {unknown} input an envelope, a bare markup object, a components[] array, or JSON text of any
 * @param {{brand?:string, registry?:Registry}} [options]
 * @returns {DecompileResult}
 */
export function decompile(input, options = {}) {
  const reg = options.registry ?? loadRegistry(options.brand ?? 'shesha');
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const { components, formSettings, envelope, provenance } = detect(input);

  const kind = inferKind(components, formSettings, diagnostics);
  const profile = reg.formSettings.kinds[kind];

  // --- document header, from the envelope -------------------------------------
  const modelType = isObj(formSettings.modelType) ? formSettings.modelType : undefined;
  const module = typeof envelope.ModuleName === 'string' ? envelope.ModuleName
    : modelType !== undefined && typeof modelType.module === 'string' ? modelType.module : 'app';
  const form = typeof envelope.Name === 'string' ? envelope.Name : 'form';

  /** @type {Record<string, unknown>} */
  const sfs = {
    sfs: '1.0',
    form,
    module,
    kind,
  };
  if (typeof envelope.ModelType === 'string') sfs.entity = envelope.ModelType;
  sfs.label = typeof envelope.Label === 'string' ? envelope.Label : form;
  if (typeof envelope.Description === 'string') sfs.description = envelope.Description;
  const access = ACCESS_NAMES[/** @type {1|2|4} */ (formSettings.access ?? envelope.Access)];
  if (access !== undefined) sfs.access = access;
  if (Array.isArray(envelope.Permissions) && envelope.Permissions.length > 0) sfs.permissions = envelope.Permissions;

  // hooks: every non-null hook key that is LEGAL for the kind is lifted; an illegal
  // one (the golden's onBeforeDataLoad on a list) is a normalisation finding (N8).
  /** @type {Record<string, unknown>} */
  const hooks = {};
  for (const key of reg.formSettings._hookKeys) {
    const value = formSettings[key];
    if (value === null || value === undefined) continue;
    if (profile !== undefined && Array.isArray(profile.hooks) && profile.hooks.includes(key)) {
      hooks[key] = value;
    } else {
      diagnostics.push({ severity: 'info', code: 'DEC-7202', message: `hook "${key}" is not legal for kind "${kind}" and was dropped (N8)` });
    }
  }
  if (Object.keys(hooks).length > 0) sfs.hooks = hooks;

  // --- shell and body ----------------------------------------------------------
  const shell = liftShell(components);
  const bodyMarkup = shell === null ? components : shell.body;
  if (shell !== null) sfs.page = shell.page;

  // dataContext id -> lifted name, needed before actions can be reversed.
  /** @type {Map<string, string>} */
  const regionNameById = new Map();
  /** @param {unknown} n @returns {void} */
  const index = (n) => {
    if (!isObj(n)) return;
    if (n.type === 'dataContext' && typeof n.id === 'string') {
      regionNameById.set(n.id, liftedName(n, 'data', 0));
    }
    if (Array.isArray(n.components)) n.components.forEach(index);
    for (const key of ['content', 'header']) if (isObj(n[key]) && Array.isArray(/** @type {any} */ (n[key]).components)) /** @type {any} */ (n[key]).components.forEach(index);
  };
  bodyMarkup.forEach(index);

  /** @type {{path:string, keys:string[]}[]} */
  const unlifted = [];
  /** @type {Map<string, Record<string, unknown>>} lifted-region sfsPath (name path) -> source markup node */
  const sources = new Map();
  let structuralEscapes = 0;

  /**
   * @param {Record<string, unknown>} mk
   * @param {number} i sibling index, for synthesised names
   * @param {string} parentPath
   * @param {Set<string>} taken sibling names already used
   * @returns {Record<string, unknown>}
   */
  const lift = (mk, i, parentPath, taken) => {
    const kindOf = nodeKindOf(reg, mk);
    const rec = reg.components[String(mk.type)];

    if (kindOf === null) {
      // Section 2.5 step 3: an input with no SFS container is a field, anything
      // else is a structural raw escape.
      const name = uniq(liftedName(mk, 'raw', i), taken);
      if (rec !== undefined && rec.isInput === true) {
        return { node: 'field', name, component: String(mk.type) };
      }
      structuralEscapes += 1;
      return {
        node: 'raw',
        name,
        raw: {
          reason: `decompiled: no SFS container for ${String(mk.type)}`,
          type: String(mk.type),
          props: baseProps(mk),
        },
      };
    }

    const name = uniq(liftedName(mk, kindOf, i), taken);
    /** @type {Record<string, unknown>} */
    const region = { node: kindOf, name };
    const path = `${parentPath}/${name}`;
    sources.set(path, mk);

    if (typeof mk.label === 'string' && !AUTO_LABEL.test(mk.label)) region.label = mk.label;

    const desktop = isObj(mk.desktop) ? mk.desktop : {};

    // node-kind-specific lifts, mirroring the schema's per-variant prop lists
    if (kindOf === 'data') {
      if (typeof mk.entityType === 'string' && mk.entityType !== sfs.entity) region.entityType = mk.entityType;
      if (typeof mk.defaultPageSize === 'number' && mk.defaultPageSize !== 10) region.pageSize = mk.defaultPageSize;
      if (mk.dataFetchingMode === 'all') region.mode = 'all';
    }
    if (kindOf === 'row' || kindOf === 'col') {
      const alignMap = { 'flex-start': 'start', center: 'center', 'flex-end': 'end' };
      const align = alignMap[/** @type {keyof typeof alignMap} */ (String(mk.alignItems))];
      if (align !== undefined) region.align = align;
      const justifyMap = { center: 'center', 'flex-end': 'end', 'space-around': 'around' };
      const jDefault = kindOf === 'row' ? 'space-between' : 'flex-start';
      if (typeof mk.justifyContent === 'string' && mk.justifyContent !== jDefault) {
        const j = justifyMap[/** @type {keyof typeof justifyMap} */ (mk.justifyContent)]
          ?? (mk.justifyContent === 'flex-start' ? 'start' : mk.justifyContent === 'space-between' ? 'between' : undefined);
        if (j !== undefined) region.justify = j;
      }
    }
    if (kindOf === 'table') {
      if (mk.freezeHeaders === true) region.freezeHeaders = true;
      if (mk.canEditInline === 'yes') region.inline = 'all';
      const rowClick = isObj(mk.rowClickActionConfiguration) ? mk.rowClickActionConfiguration
        : isObj(mk.onRowClick) && typeof mk.onRowClick !== 'string' ? mk.onRowClick : undefined;
      if (rowClick !== undefined) {
        const lifted = liftAction(reg, rowClick, regionNameById, diagnostics);
        if (lifted !== null) region.onRowClick = lifted;
      }
      region.columns = liftColumns(reg, mk, regionNameById, diagnostics);
    }
    if (String(mk.type) === 'buttonGroup' && Array.isArray(mk.items)) {
      region.items = liftButtons(reg, /** @type {Record<string, unknown>[]} */ (mk.items), regionNameById, diagnostics);
    }

    // style: surface match first, then per-channel role reversal, then the box
    /** @type {Record<string, unknown>} */
    const style = {};
    const surface = surfaceFor(reg, desktop);
    if (surface !== null) {
      style.surface = surface;
    } else if (isObj(desktop.background) && desktop.background.type === 'color') {
      const role = roleFor(reg, desktop.background.color);
      if (role !== null) style.bg = role;
      else unlifted.push({ path, keys: ['background'] });
    }
    Object.assign(style, boxFor(desktop));
    if (Object.keys(style).length > 0) region.style = style;

    // children + responsive geometry inversion
    if (Array.isArray(mk.components) && mk.components.length > 0) {
      /** @type {Set<string>} */
      const childTaken = new Set();
      region.children = /** @type {Record<string, unknown>[]} */ (mk.components)
        .map((c, j) => lift(/** @type {Record<string, unknown>} */ (c), j, path, childTaken));
      const responsive = liftResponsive(mk, /** @type {Record<string, unknown>[]} */ (mk.components),
        /** @type {Record<string, unknown>[]} */ (region.children));
      if (responsive !== null) region.responsive = responsive;
    }

    return region;
  };

  /** @type {Set<string>} */
  const rootTaken = new Set();
  sfs.body = bodyMarkup.map((mk, i) => lift(mk, i, shell === null ? '' : '/pageShell', rootTaken));

  // --- residue pass (D-076): compile the candidate, diff, carry the rest raw ----
  applyResidues(sfs, sources, reg, unlifted, diagnostics);

  return { sfs, diagnostics, unlifted, provenance, structuralEscapes };
}

/**
 * @param {Record<string, unknown>} mk
 * @param {string} kindOf
 * @param {number} i
 * @returns {string}
 */
function liftedName(mk, kindOf, i) {
  if (typeof mk.propertyName === 'string' && mk.propertyName.length > 0) return camelPath(mk.propertyName);
  return `${kindOf === 'raw' ? 'region' : kindOf}${i + 1}`;
}

/** @param {string} name @param {Set<string>} taken @returns {string} */
function uniq(name, taken) {
  let out = name;
  let n = 2;
  while (taken.has(out)) { out = `${name}${n}`; n += 1; }
  taken.add(out);
  return out;
}

/**
 * Every base prop of a markup node except identity and tree keys — the payload of
 * a structural raw escape.
 * @param {Record<string, unknown>} mk
 * @returns {Record<string, unknown>}
 */
function baseProps(mk) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(mk)) {
    if (EXCLUDED.has(key) || key === 'type') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Invert the reserve arithmetic (section 2.5 step 5). Fixed px children plus one
 * calc() child give {fixed, fill, gap}; a row parent whose tablet or mobile block
 * stacks gives `stack`.
 * @param {Record<string, unknown>} mk the parent markup node
 * @param {Record<string, unknown>[]} kids markup children
 * @param {Record<string, unknown>[]} regions lifted children (for names)
 * @returns {Record<string, unknown>|null}
 */
function liftResponsive(mk, kids, regions) {
  /** @type {Record<string, unknown>} */
  const out = {};

  const isRow = (isObj(mk.desktop) ? mk.desktop.flexDirection : mk.flexDirection) === 'row';
  const gap = Number(isObj(mk.desktop) ? mk.desktop.gap : mk.gap);
  if (Number.isFinite(gap) && gap !== (isRow ? 16 : 0)) out.gap = gap;

  if (isRow) {
    // Section 2.5 step 5: a breakpoint is stacked when its block says column OR
    // when every child is 100% wide there — the golden's N9 defect is a row
    // block whose children are all 100%, and its INTENT was a stack.
    const stackedAt = /** @param {string} bp @returns {boolean} */ (bp) => {
      const dir = isObj(mk[bp]) ? /** @type {Record<string, unknown>} */ (mk[bp]).flexDirection : undefined;
      if (dir === 'column') return true;
      if (kids.length === 0) return false;
      return kids.every((kid) => {
        const d = isObj(kid[bp]) ? /** @type {Record<string, unknown>} */ (kid[bp]) : {};
        return isObj(d.dimensions) && d.dimensions.width === '100%';
      });
    };
    if (stackedAt('tablet')) out.stack = 'at:tablet';
    else if (stackedAt('mobile')) out.stack = 'at:mobile';
  }

  /** @type {Record<string, string>} */
  const fixed = {};
  /** @type {string|null} */
  let fill = null;
  kids.forEach((kid, i) => {
    const d = isObj(kid.desktop) ? kid.desktop : {};
    const w = isObj(d.dimensions) ? d.dimensions.width : undefined;
    const name = String(regions[i].name);
    if (typeof w !== 'string') return;
    if (/^\d+px$/.test(w)) fixed[name] = w;
    else if (w.startsWith('calc(')) fill = name;
  });
  if (fill !== null && Object.keys(fixed).length > 0) {
    out.fill = fill;
    out.fixed = fixed;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * datatable items -> SFS columns (section 2.5 step 6 for the column actions).
 * @param {Registry} reg
 * @param {Record<string, unknown>} mk
 * @param {Map<string, string>} regionNameById
 * @param {Diagnostic[]} diagnostics
 * @returns {Record<string, unknown>[]}
 */
function liftColumns(reg, mk, regionNameById, diagnostics) {
  const items = Array.isArray(mk.items) ? /** @type {Record<string, unknown>[]} */ (mk.items) : [];
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const item of items) {
    if (item.columnType === 'crud-operations') continue; // regenerated from `inline`
    /** @type {Record<string, unknown>} */
    const col = {};
    if (typeof item.propertyName === 'string') col.bind = camelPath(item.propertyName);
    col.caption = item.caption;
    if (typeof item.width === 'number') col.width = item.width;
    if (typeof item.minWidth === 'number') col.min = item.minWidth;
    if (Object.hasOwn(item, 'maxWidth')) col.max = item.maxWidth;
    if (item.isVisible === false) col.visible = false;
    if (item.allowSorting === false) col.sortable = false;

    // A real inline editor is content, not decoration (D-076). edit and create are
    // identical in every measured production form; a divergence is recorded rather
    // than silently halved.
    const edit = isObj(item.editComponent) ? item.editComponent : undefined;
    if (edit !== undefined && edit.type !== '[not-editable]' && typeof edit.type === 'string') {
      col.editor = { type: edit.type, props: isObj(edit.settings) ? edit.settings : {} };
      if (!deepEqual(item.editComponent, item.createComponent)) {
        diagnostics.push({ severity: 'info', code: 'DEC-7304', message: `column "${String(item.propertyName)}" edit and create editors differ; the edit editor was lifted for both` });
      }
    }

    const display = isObj(item.displayComponent) ? item.displayComponent : {};
    if (display.type === 'refListStatus' && isObj(display.settings)) {
      const s = display.settings;
      const refId = isObj(s.referenceListId) ? s.referenceListId : {};
      /** @type {Record<string, unknown>} */
      const render = {
        kind: 'statusBadge',
        refList: `${String(refId.module)}/${String(refId.name)}`,
      };
      if (s.solidBackground === true) render.solid = true;
      if (s.showReflistName !== false) render.showName = true;
      if (s.showIcon === true) render.showIcon = true;
      col.render = render;
    } else if (typeof display.type === 'string' && display.type !== '[default]') {
      col.render = { kind: 'custom', type: display.type, props: isObj(display.settings) ? display.settings : {} };
    }

    if (isObj(item.actionConfiguration)) {
      const lifted = liftAction(reg, item.actionConfiguration, regionNameById, diagnostics);
      if (lifted !== null) col.do = lifted;
    }
    out.push(col);
  }
  return out;
}

/**
 * buttonGroup items -> SFS action items.
 * @param {Registry} reg
 * @param {Record<string, unknown>[]} items
 * @param {Map<string, string>} regionNameById
 * @param {Diagnostic[]} diagnostics
 * @returns {Record<string, unknown>[]}
 */
function liftButtons(reg, items, regionNameById, diagnostics) {
  /** @type {Record<string, string>} */
  const styleByButtonType = {};
  for (const [sfsStyle, fw] of Object.entries(/** @type {Record<string, string>} */ (reg.actions._buttonStyleMap))) {
    if (styleByButtonType[fw] === undefined) styleByButtonType[fw] = sfsStyle;
  }
  /** @type {Record<string, unknown>[]} */
  const out = [];
  items.forEach((item, i) => {
    /** @type {Record<string, unknown>} */
    const entry = {
      name: typeof item.name === 'string' ? item.name : `item${i + 1}`,
      label: item.label,
    };
    const style = styleByButtonType[String(item.buttonType)];
    if (style !== undefined && style !== 'default') entry.style = style;
    if (typeof item.icon === 'string') entry.icon = item.icon;
    if (isObj(item.actionConfiguration)) {
      const lifted = liftAction(reg, item.actionConfiguration, regionNameById, diagnostics);
      if (lifted !== null) Object.assign(entry, lifted);
    }
    out.push(entry);
  });
  return out;
}

/**
 * The losslessness pass (D-076). Compile the candidate once, walk every lifted
 * region's emitted counterpart, and carry every base-level difference outside the
 * normalisation-owned key set in that region's raw block.
 * @param {Record<string, unknown>} sfs
 * @param {Map<string, Record<string, unknown>>} sources name-path -> source markup node
 * @param {Registry} reg
 * @param {{path:string, keys:string[]}[]} unlifted
 * @param {Diagnostic[]} diagnostics
 * @returns {void}
 */
function applyResidues(sfs, sources, reg, unlifted, diagnostics) {
  /** @type {import('../compile/index.mjs').CompileResult} */
  let candidate;
  try {
    candidate = compile(JSON.stringify(sfs), { registry: reg });
  } catch (e) {
    throw new DecompileError('DEC-7001',
      `DEC-7001 decompiled SFS does not compile: ${/** @type {Error} */ (e).message}`);
  }

  // emitted node by sfsPath, via the meta sidecar
  /** @type {Map<string, string>} */
  const pathById = new Map();
  for (const n of /** @type {{id:string, sfsPath:string}[]} */ (/** @type {any} */ (candidate.meta).nodes)) {
    pathById.set(n.id, n.sfsPath);
  }
  /** @type {Map<string, Record<string, unknown>>} */
  const emittedByPath = new Map();
  /** @param {unknown} n @returns {void} */
  const collect = (n) => {
    if (!isObj(n)) return;
    if (typeof n.id === 'string' && pathById.has(n.id)) {
      emittedByPath.set(/** @type {string} */ (pathById.get(n.id)), n);
    }
    if (Array.isArray(n.components)) n.components.forEach(collect);
    for (const key of ['content', 'header']) {
      if (isObj(n[key]) && Array.isArray(/** @type {any} */ (n[key]).components)) /** @type {any} */ (n[key]).components.forEach(collect);
    }
  };
  /** @type {{components:unknown[]}} */
  const markup = JSON.parse(candidate.markup);
  markup.components.forEach(collect);

  // attach raw residues onto the SFS regions, matched by the same name path
  /** @param {Record<string, unknown>} region @param {string} parentPath @returns {void} */
  const attach = (region, parentPath) => {
    const path = `${parentPath}/${String(region.name)}`;
    const source = sources.get(path);
    const emitted = emittedByPath.get(path);
    if (source !== undefined && emitted !== undefined) {
      const rec = reg.components[String(source.type)];
      const legacy = new Set(rec !== undefined ? rec.legacyStyleProps : []);
      /** @type {Record<string, unknown>} */
      const residue = {};
      /** @type {string[]} */
      const dropped = [];
      for (const [key, value] of Object.entries(source)) {
        if (EXCLUDED.has(key) || key === 'type' || legacy.has(key)) continue;
        if (!Object.hasOwn(emitted, key) || !deepEqual(emitted[key], value)) residue[key] = value;
      }
      for (const key of Object.keys(emitted)) {
        if (EXCLUDED.has(key) || key === 'type' || Object.hasOwn(source, key)) continue;
        dropped.push(key);
      }
      if (Object.keys(residue).length > 0) {
        region.raw = {
          reason: 'decompiled: props the registry defaults do not regenerate (D-076)',
          props: residue,
        };
      }
      if (dropped.length > 0) unlifted.push({ path, keys: dropped });
    }
    if (Array.isArray(region.children)) {
      for (const child of /** @type {Record<string, unknown>[]} */ (region.children)) attach(child, path);
    }
  };
  const root = sfs.page === undefined ? '' : '/pageShell';
  for (const region of /** @type {Record<string, unknown>[]} */ (sfs.body)) attach(region, root);

  // final validation compile — DEC-7001 if the residues broke the schema
  try {
    compile(JSON.stringify(sfs), { registry: reg });
  } catch (e) {
    throw new DecompileError('DEC-7001',
      `DEC-7001 decompiled SFS does not compile after the residue pass: ${/** @type {Error} */ (e).message}`);
  }
  if (diagnostics.length > 0) { /* diagnostics already collected by the lifts */ }
}
