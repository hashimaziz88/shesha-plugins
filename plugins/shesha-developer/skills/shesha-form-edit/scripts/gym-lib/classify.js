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
