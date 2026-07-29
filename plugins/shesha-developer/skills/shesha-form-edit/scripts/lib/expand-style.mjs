/**
 * The bridge between shesha-form-edit's normalizer and shesha-design-system's
 * role/token resolver.
 *
 * shesha-form-edit and shesha-design-system are sibling skills under
 * plugins/shesha-developer/skills/, so `resolveRole` is imported here by a
 * relative path rather than duplicated. If that cross-skill coupling ever
 * proves unworkable (e.g. the skills are split into separate repos), copy
 * resolve-role.mjs verbatim rather than inventing a second, subtly different
 * resolution semantics — see the task-7 report for the reasoning.
 */
import { resolveRole } from '../../../shesha-design-system/scripts/lib/resolve-role.mjs';

export { resolveRole };

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

const FLEX_PROP_NAMES = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Read a dotted path (e.g. "border.border.all.color") off a plain object tree. */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (isPlainObject(o) ? o[k] : undefined), obj);
}

/** Write a dotted path, creating intermediate plain objects as needed. */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * `stylingBox` is carried on the wire as a JSON STRING (verified against
 * assets/examples/*.json and tests/fixtures/t2-clean.json), and every real
 * example encodes its numeric padding values as STRINGS ("24", not 24) even
 * though the token/role source is numeric. Match that convention exactly so
 * output is indistinguishable from hand-authored markup.
 */
function stringifyStylingBox(box) {
  const out = {};
  for (const [k, v] of Object.entries(box ?? {})) {
    out[k] = typeof v === 'number' ? String(v) : v;
  }
  return JSON.stringify(out);
}

/**
 * Resolve a role into the exact per-breakpoint shape a markup container node
 * carries: a flat object per breakpoint (flex props + dimensions + border +
 * background + shadow + a STRINGIFIED stylingBox), with any node-level
 * `overrides[]` entries (the blueprint.schema.json `{prop, value, source,
 * evidence}` shape — see the task-7 report's override reconciliation)
 * spliced in so a deliberate, measured deviation survives role expansion
 * rather than being silently clobbered.
 *
 * `overrides[].prop` is a breakpoint-qualified dotted path exactly matching
 * tier2's `collectColorPaths` output, e.g. "desktop.background.color".
 */
export function expandRole(roleName, { roles, tokens }, overrides = []) {
  const resolved = resolveRole(roleName, { roles, tokens });
  const safeOverrides = Array.isArray(overrides) ? overrides.filter(isPlainObject) : [];

  const out = {};
  for (const bp of BREAKPOINTS) {
    // Deep-clone via JSON round-trip: resolved values are plain JSON-safe data.
    const bpObj = JSON.parse(JSON.stringify(resolved[bp]));
    for (const ov of safeOverrides) {
      if (typeof ov.prop === 'string' && ov.prop.startsWith(`${bp}.`)) {
        setPath(bpObj, ov.prop.slice(bp.length + 1), ov.value);
      }
    }
    const { stylingBox, ...rest } = bpObj;
    out[bp] = { ...rest, stylingBox: stringifyStylingBox(stylingBox) };
  }
  return out;
}

/** The six flex/layout props mirrored at the node's top level (see normalize-form.mjs). */
export function flexPropsOf(bpStyle) {
  const out = {};
  for (const k of FLEX_PROP_NAMES) out[k] = bpStyle[k];
  return out;
}

/**
 * A minimal, complete, "does nothing visually" style block for a container
 * synthesized by a structural transform (columns->flex, flex-child wrap) that
 * has no matching design-system role — no color, no border, no shadow, only
 * the layout/sizing the transform actually needs. Complete on purpose: a
 * synthesized container must not itself trip T2-STYLE-INCOMPLETE.
 */
export function neutralContainerStyle({ flexDirection = 'column', widthByBp = {} } = {}) {
  const out = {};
  for (const bp of BREAKPOINTS) {
    const width = widthByBp[bp] ?? 'auto';
    out[bp] = {
      display: 'flex',
      flexDirection,
      flexWrap: 'nowrap',
      gap: 0,
      justifyContent: 'flex-start',
      alignItems: flexDirection === 'row' ? 'center' : 'stretch',
      dimensions: {
        width,
        minWidth: '0',
        maxWidth: 'none',
        height: 'auto',
        minHeight: 'fit-content',
        maxHeight: 'none',
      },
      background: { type: 'color', color: 'transparent' },
      border: {
        borderType: 'none',
        radiusType: 'all',
        radius: { all: 0 },
        border: { all: { color: 'transparent', style: 'none', width: '0px' } },
      },
      shadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: 'transparent' },
      stylingBox: stringifyStylingBox({}),
    };
  }
  return out;
}

export { getPath, setPath };
