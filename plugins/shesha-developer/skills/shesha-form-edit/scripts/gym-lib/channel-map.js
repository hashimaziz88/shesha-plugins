// Maps hand-noted capability-matrix channels (free-form, e.g. "bg/border/radius/width/font")
// onto measured gym setting paths, and summarizes measured effects per row.
// Shared by merge-capability.js and validate-blocks.js.

const TOKEN_TO_PATHS = {
  bg: ['backgroundColor'],
  background: ['backgroundColor'],
  'background.color': ['backgroundColor'],
  'background.gradient': ['backgroundColor'],
  border: ['borderSize', 'borderType', 'borderColor', 'hideBorder'],
  'border.all': ['borderSize', 'borderType', 'borderColor', 'hideBorder'],
  'border.perside': ['borderSize', 'borderType', 'borderColor'],
  radius: ['borderRadius'],
  'border.radius': ['borderRadius'],
  width: ['width'],
  'dimensions.width': ['width'],
  'dimensions.minheight': ['minHeight', 'height'],
  height: ['height'],
  font: ['fontSize', 'fontColor', 'fontWeight'],
  fontsize: ['fontSize'],
  fontweight: ['fontWeight'],
  color: ['fontColor', 'color'],
  align: ['labelAlign', 'textAlign'],
  stylingbox: ['stylingBox'],
  shadow: ['boxShadow', 'shadow'],
  strokecolor: ['strokeColor'],
  size: ['size'],
  render: ['__renderStatus'],
};

export function channelTokens(channel) {
  return String(channel)
    .toLowerCase()
    .split(/[\s/+,()]+/)
    .filter(Boolean);
}

export function pathsForChannel(channel) {
  const paths = new Set();
  for (const tok of channelTokens(channel)) {
    for (const p of TOKEN_TO_PATHS[tok] ?? []) paths.add(p);
  }
  return paths;
}

const WORKS = new Set(['changes-style', 'changes-geometry', 'renders']);

/**
 * Summarize what the gym measured for one hand-matrix row.
 * Returns { summary: 'works'|'no-op'|'mixed'|'unmeasured', effects: {pathOrKey: effect}, renderStatus? }
 */
export function measuredForRow(measuredMatrix, component, channel) {
  const aliases = String(component).split('/').map((s) => s.trim());
  const paths = pathsForChannel(channel);
  const effects = {};
  let renderStatus;

  for (const alias of aliases) {
    const comp = measuredMatrix.components?.[alias];
    if (!comp) continue;
    renderStatus = renderStatus ?? comp.renderStatus;
    if (paths.has('__renderStatus')) effects.__renderStatus = comp.renderStatus;
    for (const [key, val] of Object.entries(comp.settings ?? {})) {
      const basePath = key.split('=')[0];
      if (paths.has(basePath)) effects[`${alias}:${key}`] = val.effect;
    }
  }

  const real = Object.values(effects).filter((e) => e !== 'not-measured' && e !== 'unknown');
  const works = real.filter((e) => WORKS.has(e));
  const noops = real.filter((e) => e === 'no-op');
  let summary;
  if (!real.length) summary = 'unmeasured';
  else if (works.length && !noops.length) summary = 'works';
  else if (noops.length && !works.length) summary = 'no-op';
  else summary = 'mixed';
  // strong = enough independent measured paths to overturn a hand verdict
  return { summary, effects, renderStatus, strong: real.length >= 2 };
}

const GOOD_HAND = new Set(['renders', 'gotcha', 'renders-via-app-theme', 'partial']);

/**
 * True when the hand row's documented technique lives in a channel the gym did
 * not author (0.45 `desktop.*` style blocks vs the gym's flat 0.43 props).
 * Verdicts across different channels can both be true — never a contradiction.
 */
export function isChannelMismatch(row) {
  return typeof row.key === 'string' && /desktop\./.test(row.key);
}

/**
 * True when the measurement categorically disagrees with the hand verdict.
 * Overturning a good hand verdict with a no-op requires strong evidence
 * (≥2 measured paths); a single works-signal is enough to refute a no-op.
 */
export function isContradiction(handVerdict, m) {
  if (m.summary === 'unmeasured' || m.summary === 'mixed') return false;
  if (GOOD_HAND.has(handVerdict) && m.summary === 'no-op') return m.strong === true;
  if (handVerdict === 'no-op' && m.summary === 'works') return true;
  return false;
}
