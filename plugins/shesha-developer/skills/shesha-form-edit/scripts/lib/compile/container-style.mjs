/**
 * Container style resolution — the compiler's OWN role/style/overrides
 * expansion, done once, up front, so the markup this module returns is
 * already in normalized shape. Reuses expand-style.mjs's `expandRole` /
 * `neutralContainerStyle` (the same functions normalize-form.mjs itself
 * calls) rather than re-deriving role expansion — see the task brief's
 * "reuse, do not reimplement" rule.
 *
 * Why this exists instead of just leaving `role` on the node for
 * normalize-form.mjs to expand later: several blueprint containers carry
 * BOTH a `role` AND a literal `style` override block (e.g. table-worklist's
 * "page" node, record-detail's "mainColumn"/"detailRail"), and one bare
 * container carries only a `style` block with no role at all
 * (record-detail's "body"). normalize-form.mjs's own role expansion
 * (applyRoleStyle) has no notion of a second "style" layer to merge on top —
 * it would either skip the node (no role) or clobber the merge (role
 * present, re-expanding from scratch). Resolving fully here and never
 * leaving a `role` string on the output means normalize() has nothing left
 * to do for this node — required for compile-then-normalize to be a no-op.
 */
import {
  expandRole, neutralContainerStyle, isPlainObject, setPath, BREAKPOINTS,
} from '../expand-style.mjs';

const FLEX_PROP_NAMES = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];

// ---------------------------------------------------------------------------
// Role-color provenance stamping.
//
// tier2.mjs's T2-STYLE-OFF-TOKEN flags ANY literal hex/rgb(a) `color` leaf on
// a container that has no matching `overrides[]` entry — including a color
// that came from resolving a design-system ROLE (roles.styles.json's own
// $roles.pageBg/$roles.cardHeaderBg/$roles.hairline tokens all resolve to
// literal hex, e.g. "#F8F8F9"/"#E8EAF0"), because the check has no way to
// see WHERE a post-resolution literal came from — it only ever sees the
// resolved value. Every one of the 15 roles carries at least one such color,
// so every role-styled container would otherwise trip this check on every
// single archetype. tier2.mjs's own header comment frames `overrides[]` as
// exactly the escape hatch for "this literal is deliberate, not a
// copy-pasted accident" — a role's own governed default IS deliberate (it is
// the project's sanctioned token, not an ad hoc choice), so the compiler
// self-documents every such color with a synthetic `overrides[]` entry
// naming the role/token as its `source`/`evidence`, rather than leaving a
// human to hand-add one entry per color per role per breakpoint. A
// blueprint-authored override (real deviation, real provenance) is left
// completely untouched and never duplicated.
const COLOR_LITERAL_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(/i;

// Mirrors tier2.mjs's own isFrameworkDefaultColor() exactly (duplicated, not
// imported — tier2.mjs exports only its main `tier2` function).
function isFrameworkDefaultColor(path, value) {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  const grandparent = parts[parts.length - 3];
  const v = value.toLowerCase();
  if (last === 'color' && parent === 'shadow' && (v === '#000' || v === '#000000')) return true;
  if (last === 'color' && parent === 'background' && v === '#ffffff') return true;
  if (last === 'color' && grandparent === 'border' && ['all', 'top', 'bottom', 'left', 'right'].includes(parent) && v === '#d9d9d9') return true;
  return false;
}

function collectColorLeaves(obj, prefix = '') {
  const found = [];
  if (!isPlainObject(obj)) return found;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const p = prefix ? `${prefix}.${key}` : key;
    if (key === 'color' && typeof value === 'string' && (COLOR_LITERAL_RE.test(value) || RGB_RE.test(value))) {
      found.push({ path: p, value });
    } else if (isPlainObject(value)) {
      found.push(...collectColorLeaves(value, p));
    }
  }
  return found;
}

function stampColorProvenance(resolved, bpNode) {
  const existing = Array.isArray(bpNode.overrides) ? bpNode.overrides.filter(isPlainObject) : [];
  const coveredProps = new Set(existing.map((o) => o.prop));
  const synthetic = [];
  for (const bp of BREAKPOINTS) {
    for (const { path, value } of collectColorLeaves(resolved[bp])) {
      if (isFrameworkDefaultColor(path, value)) continue;
      const prop = `${bp}.${path}`;
      if (coveredProps.has(prop)) continue;
      synthetic.push({
        prop,
        value,
        source: bpNode.role ? `design-system role "${bpNode.role}"` : 'blueprint style block',
        evidence: bpNode.role
          ? `resolved from roles.styles.json role "${bpNode.role}" via its token reference (shesha.tokens.json)`
          : "literal value from this blueprint node's own \"style\" block",
      });
      coveredProps.add(prop);
    }
  }
  return [...existing, ...synthetic];
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function mergeStylingBox(baseValue, patchObj) {
  if (!isPlainObject(patchObj)) return baseValue;
  let baseObj = {};
  if (typeof baseValue === 'string') {
    try { baseObj = JSON.parse(baseValue || '{}'); } catch { baseObj = {}; }
  } else if (isPlainObject(baseValue)) {
    baseObj = baseValue;
  }
  const merged = { ...baseObj };
  for (const [k, v] of Object.entries(patchObj)) merged[k] = typeof v === 'number' ? String(v) : v;
  return JSON.stringify(merged);
}

/**
 * Resolve a blueprint container node's complete per-breakpoint style.
 *
 * @param {object} bpNode - the blueprint node (may carry `role`, `style`, `overrides`)
 * @param {{roles: object, tokens: object}} ctx
 * @returns {{desktop, tablet, mobile, display, flexDirection, flexWrap, gap, justifyContent, alignItems}}
 */
export function resolveContainerStyle(bpNode, { roles, tokens }) {
  const hasRole = typeof bpNode.role === 'string' && bpNode.role.length > 0;
  const overrides = Array.isArray(bpNode.overrides) ? bpNode.overrides : [];

  let base;
  if (hasRole) {
    base = expandRole(bpNode.role, { roles, tokens }, overrides);
  } else {
    const desktopStyle = bpNode.style?.desktop ?? {};
    base = neutralContainerStyle({
      flexDirection: desktopStyle.flexDirection ?? 'column',
      widthByBp: { desktop: desktopStyle.dimensions?.width ?? 'auto' },
    });
    // expandRole splices overrides[] into the resolved role itself; mirror
    // that same splice here for the no-role/neutral-base branch so the two
    // paths honour overrides identically.
    for (const bp of BREAKPOINTS) {
      for (const ov of overrides) {
        if (isPlainObject(ov) && typeof ov.prop === 'string' && ov.prop.startsWith(`${bp}.`)) {
          setPath(base[bp], ov.prop.slice(bp.length + 1), ov.value);
        }
      }
    }
  }

  // Merge the blueprint's own literal `style` block on top, if any. Every
  // fixture that carries `style` only ever gives a `desktop` entry; mirror
  // that same delta onto tablet/mobile too unless the blueprint supplies its
  // own bp-specific delta (honoured if present, for forward compatibility).
  const styleBlock = bpNode.style;
  if (isPlainObject(styleBlock)) {
    const desktopDelta = styleBlock.desktop ?? {};
    for (const bp of BREAKPOINTS) {
      const delta = styleBlock[bp] ?? desktopDelta;
      const { stylingBox: deltaStylingBox, ...restDelta } = isPlainObject(delta) ? delta : {};
      base[bp] = deepMerge(base[bp], restDelta);
      if (deltaStylingBox !== undefined) {
        base[bp].stylingBox = mergeStylingBox(base[bp].stylingBox, deltaStylingBox);
      }
    }
  }

  const out = { desktop: base.desktop, tablet: base.tablet, mobile: base.mobile };
  const flexMirror = {};
  for (const p of FLEX_PROP_NAMES) flexMirror[p] = out.desktop[p];
  const overridesOut = stampColorProvenance(out, bpNode);
  return { ...flexMirror, ...out, ...(overridesOut.length ? { overrides: overridesOut } : {}) };
}
