// Stage 2: validated sfsDoc -> annotated tree.
//
// Owns node->type+version, token resolution to literals, binding camelCasing,
// formRef and refListRef splitting, action intent -> (actionName, actionOwner), and
// the data-ancestor rule.
//
// Every name-derived path is computed HERE and carried on the node as `sfsPath`,
// because s5 hashes it and the meta sidecar reads it back. Building it once means the
// id and the sidecar cannot disagree about what a node is called.

import { recordForNode, versionFor } from '../lib/registry.mjs';
import { resolveStyle, applySurface } from '../lib/tokens.mjs';
import { SfsError } from './s1-parse.mjs';

/** @typedef {import('../lib/registry.mjs').Registry} Registry */
/** @typedef {import('./s1-parse.mjs').SfsDoc} SfsDoc */
/** @typedef {{severity:'error'|'info', code:string, message:string, where?:string}} Diagnostic */

/**
 * @typedef {{node:string, name:string, type:string, version:number, sfsPath:string,
 *            label:string|undefined, props:Record<string, unknown>,
 *            style:Record<string, unknown>, responsive:Record<string, unknown>|null,
 *            children:Node[], headerChildren:Node[], items:Record<string, unknown>[],
 *            columns:Record<string, unknown>[], raw:Record<string, unknown>|null,
 *            record:import('../lib/registry.mjs').ComponentRecord}} Node
 */

/**
 * PascalCase in, camelCase out — every segment, every time (N11). This is the one
 * place casing is decided, which is what makes `debug.md` row 27's all-blank table
 * unreachable: there is no second path that could emit the metadata casing.
 * @param {string} path
 * @returns {string}
 */
export function camelPath(path) {
  return String(path).split('.')
    .map((seg) => (seg.length === 0 ? seg : seg[0].toLowerCase() + seg.slice(1)))
    .join('.');
}

/**
 * `module/name` -> `{name, module}`. The key ORDER is part of the contract: s6
 * serialises objects in insertion order, and this is the shape production carries.
 * @param {string} ref
 * @param {string} where
 * @returns {{name:string, module:string}}
 */
export function splitFormRef(ref, where) {
  const at = ref.indexOf('/');
  if (at < 0) {
    throw new SfsError('SFS-1603',
      `SFS-1603 form target "${ref}" at ${where} has no module prefix; write "<module>/<form>"`, where);
  }
  return { name: ref.slice(at + 1), module: ref.slice(0, at) };
}

/**
 * `module/RefList` -> `{module, name}` — the ONE canonical reference-list shape. A
 * flat module/referenceListName pair is unrepresentable because nothing produces it.
 * @param {string} ref
 * @param {string} where
 * @returns {{module:string, name:string}}
 */
export function splitRefListRef(ref, where) {
  const at = ref.indexOf('/');
  if (at < 0) {
    throw new SfsError('MET-2301',
      `MET-2301 reference list "${ref}" at ${where} has no module prefix; write "<module>/<RefList>"`, where);
  }
  return { module: ref.slice(0, at), name: ref.slice(at + 1) };
}

/**
 * Resolve one action intent through actions.json.
 *
 * `ownerRef` stays a SENTINEL here. The target region's id does not exist until s5
 * has stamped it, so s2 records which region to look at and s5 substitutes. Resolving
 * it now would require an id before ids exist.
 * @param {Registry} reg
 * @param {Record<string, unknown>} action
 * @param {string} where
 * @returns {Record<string, unknown>}
 */
export function resolveAction(reg, action, where) {
  const intent = String(action.do);
  const spec = reg.actions.intents[intent];
  if (spec === undefined) {
    throw new SfsError('REG-2301',
      `REG-2301 unknown action intent "${intent}" at ${where}; the intents are ${Object.keys(reg.actions.intents).join(' | ')}`, where);
  }
  const withArgs = /** @type {Record<string, unknown>} */ (action.with || {});

  // Argument names are the framework's, not SFS's: `title` -> `modalTitle`. The map is
  // registry data, so adding an intent never edits this function.
  /** @type {Record<string, unknown>} */
  const args = { ...spec.argDefaults };
  for (const [key, value] of Object.entries(withArgs)) {
    if (key === 'target') continue; // consumed by ownerRef resolution, never emitted
    const mapped = spec.argMap[key];
    if (mapped === undefined) {
      throw new SfsError('REG-2302',
        `REG-2302 intent "${intent}" at ${where} takes no argument "${key}"; it accepts ${spec.with.join(', ') || 'none'}`, where);
    }
    if (key === 'form') {
      args[mapped] = splitFormRef(String(value), `${where}.with.form`);
    } else if (key === 'args' && intent === 'navigate') {
      // `navigate` args become queryParameters: an ARRAY of {key,value} pairs.
      args[mapped] = Object.entries(/** @type {Record<string, unknown>} */ (value))
        .map(([k, v]) => ({ key: k, value: v }));
    } else {
      args[mapped] = value;
    }
  }

  /** @type {Record<string, unknown>} */
  const out = {
    _type: 'action-config',
    actionName: spec.actionName,
    actionOwner: spec.actionOwner,
    actionArguments: args,
  };
  if (spec.actionOwner === reg.actions._ownerRefSentinel) {
    if (typeof withArgs.target !== 'string') {
      throw new SfsError('SFS-1601', `SFS-1601 intent "${intent}" at ${where} needs a with.target naming a data region`, where);
    }
    out._ownerRefTarget = withArgs.target;
  }
  if (action.onSuccess !== undefined || action.onFail !== undefined) {
    out.handleSuccess = action.onSuccess !== undefined;
    out.handleFail = action.onFail !== undefined;
    if (action.onSuccess !== undefined) {
      out.onSuccess = resolveAction(reg, /** @type {Record<string, unknown>} */ (action.onSuccess), `${where}.onSuccess`);
    }
    if (action.onFail !== undefined) {
      out.onFail = resolveAction(reg, /** @type {Record<string, unknown>} */ (action.onFail), `${where}.onFail`);
    }
  }
  return out;
}

/** Keys the compiler handles structurally; everything else is a type-specific prop. */
const STRUCTURAL = new Set([
  'node', 'name', 'label', 'style', 'responsive', 'when', 'raw', 'children',
  'headerChildren', 'items', 'columns', 'tabs', 'bands', 'align', 'justify',
  'onRowClick', 'onRowDoubleClick',
]);

/** Node kinds that cannot stand outside a `data` region (SFS-1201). */
const NEEDS_DATA = new Set(['table', 'list', 'pager', 'search']);

/**
 * @param {Registry} reg
 * @param {Record<string, unknown>} region
 * @param {string} parentPath
 * @param {Diagnostic[]} diagnostics
 * @returns {Node}
 */
function resolveRegion(reg, region, parentPath, diagnostics) {
  const node = String(region.node);
  const name = String(region.name);
  const sfsPath = `${parentPath}/${name}`;
  const { type, record } = recordForNode(reg, node);

  /** @type {Record<string, unknown>} */
  const props = {};
  for (const [key, value] of Object.entries(region)) {
    if (STRUCTURAL.has(key)) continue;
    props[key] = value;
  }

  // `row` and `col` are ONE registry record told apart by direction, not two records.
  // The underscore prefix marks a compiler-internal hint that s4 consumes and never
  // emits, so it cannot be mistaken for a framework prop.
  if (node === 'row' || node === 'col') {
    props._flexDirection = node === 'row' ? 'row' : 'column';
    if (typeof region.align === 'string') props._align = region.align;
    if (typeof region.justify === 'string') props._justify = region.justify;
  }

  const styleIn = /** @type {Record<string, unknown>} */ (region.style || {});
  const style = /** @type {Record<string, unknown>} */ (
    resolveStyle(reg, applySurface(reg, styleIn), `${sfsPath}.style`));

  /** @type {Node} */
  const out = {
    node,
    name,
    type,
    version: versionFor(reg, type),
    sfsPath,
    label: typeof region.label === 'string' ? region.label : undefined,
    props,
    style,
    responsive: region.responsive === undefined ? null : /** @type {Record<string, unknown>} */ (region.responsive),
    children: [],
    headerChildren: [],
    items: [],
    columns: [],
    raw: region.raw === undefined ? null : /** @type {Record<string, unknown>} */ (region.raw),
    record,
  };

  if (Array.isArray(region.children)) {
    out.children = region.children.map((c) => resolveRegion(reg, /** @type {Record<string, unknown>} */ (c), sfsPath, diagnostics));
  }
  if (Array.isArray(region.headerChildren)) {
    out.headerChildren = region.headerChildren.map((c) => resolveRegion(reg, /** @type {Record<string, unknown>} */ (c), `${sfsPath}#header`, diagnostics));
  }

  if (node === 'actions' && Array.isArray(region.items)) {
    out.items = region.items.map((raw) => {
      const item = /** @type {Record<string, unknown>} */ (raw);
      const itemPath = `${sfsPath}#item:${String(item.name)}`;
      const spec = reg.actions.intents[String(item.do)];
      if (spec === undefined) {
        throw new SfsError('REG-2301', `REG-2301 unknown action intent "${String(item.do)}" at ${itemPath}`, itemPath);
      }
      return {
        name: String(item.name),
        label: item.label,
        buttonType: reg.actions._buttonStyleMap[String(item.style || 'default')],
        icon: item.icon,
        sfsPath: itemPath,
        buttonAction: spec.buttonAction,
        actionConfiguration: resolveAction(reg, item, itemPath),
      };
    });
  }

  if (Array.isArray(region.columns)) {
    out.columns = region.columns.map((raw) => {
      const col = /** @type {Record<string, unknown>} */ (raw);
      const bind = col.bind === undefined ? null : camelPath(String(col.bind));
      // A row-action column has no binding, so its path segment is its caption.
      const seg = bind === null ? `action:${String(col.caption || 'action')}` : bind;
      const where = `${sfsPath}#col:${seg}`;
      if (bind !== null) {
        // No backend in this session, so every binding is uninspectable and counted.
        // It is never silently treated as resolved (section 2.1.6).
        diagnostics.push({ severity: 'info', code: 'MET-2200', message: `binding "${bind}" unverified: no backend`, where });
      }
      /** @type {Record<string, unknown>|null} */
      let render = null;
      if (col.render !== undefined) {
        render = { ...(/** @type {Record<string, unknown>} */ (col.render)) };
        if (render.refList !== undefined) {
          render._referenceListId = splitRefListRef(String(render.refList), `${where}.render.refList`);
        }
      }
      /** @type {Record<string, unknown>} */
      const out2 = { ...col, bind, sfsPath: where, render };
      if (col.do !== undefined) {
        out2.do = resolveAction(reg, /** @type {Record<string, unknown>} */ (col.do), `${where}.do`);
      }
      return out2;
    });
  }

  for (const key of ['onRowClick', 'onRowDoubleClick']) {
    if (region[key] !== undefined) {
      props[key] = resolveAction(reg, /** @type {Record<string, unknown>} */ (region[key]), `${sfsPath}.${key}`);
    }
  }

  if (props.bind !== undefined) props.bind = camelPath(String(props.bind));
  return out;
}

/**
 * @param {SfsDoc} doc
 * @param {{registry:Registry}} ctx
 * @returns {{tree:{roots:Node[], doc:SfsDoc}, diagnostics:Diagnostic[]}}
 */
export function resolve(doc, ctx) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const reg = ctx.registry;

  // The page shell owns the path root when `page` is declared, because it is a real
  // node with a real id and every body region is one of its descendants.
  const root = doc.page === undefined ? '' : '/pageShell';
  const roots = doc.body.map((r) => resolveRegion(reg, /** @type {Record<string, unknown>} */ (r), root, diagnostics));

  /** @param {Node} n @param {boolean} hasData @returns {void} */
  const checkAncestry = (n, hasData) => {
    if (NEEDS_DATA.has(n.node) && !hasData) {
      throw new SfsError('SFS-1201',
        `SFS-1201 "${n.node}" at ${n.sfsPath} has no data ancestor. Wrap it in a node:"data" region; `
        + 'childTable and tags are exempt because they own their data source', n.sfsPath);
    }
    const next = hasData || n.node === 'data';
    for (const c of [...n.children, ...n.headerChildren]) checkAncestry(c, next);
  };
  for (const r of roots) checkAncestry(r, false);

  return { tree: { roots, doc }, diagnostics };
}
