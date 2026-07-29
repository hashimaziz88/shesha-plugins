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
// Role-derived colors and T2-STYLE-OFF-TOKEN.
//
// `resolveRole` (shesha-design-system) legitimately resolves a role's token
// references down to literal hex ("$roles.pageBg" -> "palette.surfaces.
// canvas" -> "#F8F8F9") — that IS what resolution means, not a defect to
// paper over. This module used to self-stamp a synthetic `overrides[]`
// entry onto every such color so it would survive tier2.mjs's
// T2-STYLE-OFF-TOKEN check — but `overrides[]` exists to record a *measured*
// deviation (`source`/`evidence` naming a real, human-reviewed decision);
// auto-generating one for every ordinary theme color forged exactly the
// provenance record the check exists to verify, making the check trivially
// satisfiable and permanently unable to catch a genuine off-token value
// again. The fix belongs in the check, not here: tier2.mjs's
// T2-STYLE-OFF-TOKEN is now THEME-AWARE — it resolves the active theme's
// token file itself and treats any color literal that matches a token in it
// as on-token by definition, with no override required. This module's own
// job is therefore back to just resolving the role/style, verbatim, with no
// provenance bookkeeping — any `overrides[]` on the OUTPUT is exactly (and
// only) whatever the blueprint node itself genuinely authored.
// ---------------------------------------------------------------------------

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
  // Only genuinely blueprint-authored overrides survive onto the output node
  // — no synthetic provenance is ever stamped (see this file's header
  // comment). T2-STYLE-OFF-TOKEN itself resolves whether a role-derived
  // literal is on-token; this module has nothing further to prove.
  const overridesOut = overrides.filter(isPlainObject);
  return { ...flexMirror, ...out, ...(overridesOut.length ? { overrides: overridesOut } : {}) };
}
