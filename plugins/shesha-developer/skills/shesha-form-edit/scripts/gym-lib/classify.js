// Effect classification: diff one variant snapshot against the baseline snapshot.
// Pure — unit-testable with fixture snapshots.
// Priority: breaks-render > changes-geometry > changes-style > renders > no-op.

const GEOMETRY_EPSILON = 0.5;

function normColor(v) {
  if (typeof v !== 'string') return v;
  const m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return v.replace(/rgba\((\d+), (\d+), (\d+), 1\)/, 'rgb($1, $2, $3)');
}

function diffStyles(base, vari) {
  const delta = {};
  if (!base || !vari) return delta;
  for (const prop of new Set([...Object.keys(base), ...Object.keys(vari)])) {
    const b = normColor(base[prop]);
    const v = normColor(vari[prop]);
    if (b !== v) delta[prop] = { baseline: base[prop], variant: vari[prop] };
  }
  return delta;
}

/**
 * classify(baselineSnap, variantSnap, opts) → { effect, cssDelta?, notes? }
 * snaps are probe.js outputs for one wrapper; either may be undefined.
 * opts.expectTokens: strings to look for in the delta (e.g. "17px", "rgb(255, 0, 170)").
 */
export function classify(baselineSnap, variantSnap, opts = {}) {
  if (!baselineSnap && !variantSnap) return { effect: 'unknown', notes: 'baseline and variant both missing from DOM' };
  if (!variantSnap) return { effect: 'breaks-render', notes: 'variant wrapper missing while baseline rendered' };
  if (!baselineSnap) return { effect: 'unknown', notes: 'baseline wrapper missing — cannot diff' };

  const notes = [];

  // geometry
  const geomChanged =
    Math.abs(baselineSnap.rect.w - variantSnap.rect.w) > GEOMETRY_EPSILON ||
    Math.abs(baselineSnap.rect.h - variantSnap.rect.h) > GEOMETRY_EPSILON ||
    baselineSnap.childCount !== variantSnap.childCount;

  // style (measured node first, wrapper + control as secondary signals)
  const cssDelta = {
    ...prefixKeys(diffStyles(baselineSnap.style, variantSnap.style), ''),
    ...prefixKeys(diffStyles(baselineSnap.wrapperStyle, variantSnap.wrapperStyle), 'wrapper.'),
    ...prefixKeys(diffStyles(baselineSnap.controlStyle, variantSnap.controlStyle), 'control.'),
    // subtree union catches changes on nodes the samples miss
    ...prefixKeys(diffStyles(baselineSnap.styleUnion, variantSnap.styleUnion), 'subtree.'),
  };
  const styleChanged = Object.keys(cssDelta).length > 0;

  if (opts.expectTokens?.length && styleChanged) {
    const deltaText = JSON.stringify(cssDelta);
    const hit = opts.expectTokens.find((t) => deltaText.includes(t));
    if (hit) notes.push(`expected value observed (${hit})`);
  }

  if (variantSnap.childCount === 0 && baselineSnap.childCount > 0) {
    // whole subtree gone (e.g. hidden=true) — geometry change, not a crash
    return { effect: 'changes-geometry', notes: 'component subtree removed (0 descendants)' };
  }

  if (geomChanged) {
    const res = { effect: 'changes-geometry' };
    if (styleChanged) res.cssDelta = cssDelta;
    if (notes.length) res.notes = notes.join('; ');
    return res;
  }
  if (styleChanged) {
    const res = { effect: 'changes-style', cssDelta };
    if (notes.length) res.notes = notes.join('; ');
    return res;
  }
  if (
    baselineSnap.text !== variantSnap.text ||
    JSON.stringify(baselineSnap.attrs) !== JSON.stringify(variantSnap.attrs)
  ) {
    return { effect: 'renders', notes: 'text/attribute difference only' };
  }
  if (baselineSnap.canvasSig && variantSnap.canvasSig && baselineSnap.canvasSig !== variantSnap.canvasSig) {
    return { effect: 'renders', notes: 'canvas pixels differ (visual change not visible in CSS)' };
  }
  return { effect: 'no-op' };
}

function prefixKeys(obj, prefix) {
  if (!prefix) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[`${prefix}${k}`] = v;
  return out;
}

/** Tokens the runner should expect for a given variant value. */
export function expectTokensFor(value) {
  const tokens = [];
  if (value === '#ff00aa' || value === '#ff00aa'.toUpperCase()) tokens.push('rgb(255, 0, 170)');
  if (value === 17 || value === '17' || value === '17px') tokens.push('17px');
  if (typeof value === 'string' && value.startsWith('GYM-TXT-')) tokens.push(value);
  return tokens;
}

/**
 * Container-level artifact detection.
 *
 * classify() sees one variant at a time, so it cannot distinguish a per-setting effect from
 * a difference in how the component's own container happened to render. When many unrelated
 * settings produce a BYTE-IDENTICAL delta, that is one container-level difference attributed
 * to all of them — not N independent findings.
 *
 * Observed on barChart: a single `display: block → flex` (the baseline rendered a placeholder
 * while variants rendered a real chart) was recorded as changes-geometry for 19 of its
 * settings, including aggregationMethod=min, orderDirection=asc and strokeWidth=17 — none of
 * which can affect display. The 2026-07-22 matrix carried 8 such clusters across 105 rows.
 *
 * Members of a cluster become `unknown`, which is what the matrix already means by "cannot
 * determine": something differed, but not demonstrably because of this setting. The measured
 * verdict is preserved in `attributedEffect` so nothing is lost. Settings whose delta is
 * distinct are untouched — on barChart that correctly keeps dimensions.height and background.
 *
 * Mutates `settings` in place and returns the clusters it flagged.
 *
 * @param {object} settings  comp.settings — { [key]: { effect, cssDelta, … } }
 * @param {{min?: number, minPaths?: number}} opts  min rows (default 5) and min DISTINCT
 *   setting paths (default 3) for a cluster to count as an artifact. Both matter: rows alone
 *   flags one setting measured across many values, which is a real finding, not an artifact.
 * @returns {Array<{delta: string, keys: string[], was: string}>}
 */
export function flagContainerArtifacts(settings, opts = {}) {
  const min = opts.min ?? 5;
  const byDelta = new Map();

  for (const [key, s] of Object.entries(settings ?? {})) {
    if (s?.effect !== 'changes-geometry' && s?.effect !== 'changes-style') continue;
    if (!s.cssDelta || !Object.keys(s.cssDelta).length) continue;
    const sig = JSON.stringify(s.cssDelta);
    if (!byDelta.has(sig)) byDelta.set(sig, []);
    byDelta.get(sig).push(key);
  }

  const flagged = [];
  for (const [sig, keys] of byDelta) {
    if (keys.length < min) continue;

    // The premise is N UNRELATED settings sharing a delta. Keys are `path=valueKey`, so a
    // cluster that is one path measured across many VALUES is not an artifact — it is one
    // setting whose values all genuinely have the same effect. calendar's
    // displayPeriod=month|week|work_week|day|agenda hit the row threshold that way and was
    // wrongly demoted; barChart's real artifact spanned aggregationMethod, orderDirection,
    // strokeWidth and more. Require breadth across paths, not just row count.
    const paths = new Set(keys.map((k) => k.split('=')[0]));
    if (paths.size < (opts.minPaths ?? 3)) continue;

    const was = settings[keys[0]].effect;
    for (const key of keys) {
      const s = settings[key];
      s.attributedEffect = s.effect;
      s.effect = 'unknown';
      s.attribution = 'container-level';
      s.notes = `identical delta on ${keys.length} unrelated settings — a container-level `
        + `render difference, not attributable to this setting`;
    }
    flagged.push({ delta: sig, keys, was });
  }
  return flagged;
}
