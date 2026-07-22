// Browser-side probe. PROBE_FN runs inside the page via page.evaluate and
// returns a snapshot per gym instance wrapper: geometry + curated computed
// styles for the wrapper, its deepest descendant, and the first form control.
// Kept string-serializable (no imports, no closure state).

export const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'minHeight', 'maxWidth',
  'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems', 'alignSelf',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'color', 'textAlign', 'letterSpacing',
  'backgroundColor', 'backgroundImage',
  'borderTopWidth', 'borderTopStyle', 'borderTopColor',
  'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius', 'boxShadow', 'opacity', 'overflow', 'visibility', 'cursor', 'outlineWidth',
];

export function probeFn(cfg) {
  // cfg: { selector, attr, prefix, styleProps }
  const out = {};
  const round = (n) => Math.round(n * 10) / 10;

  const snapshotEl = (el) => {
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of cfg.styleProps) style[p] = cs[p];
    return style;
  };

  const wrappers = document.querySelectorAll(cfg.selector);
  for (const w of wrappers) {
    const name = w.getAttribute(cfg.attr) || '';
    if (!name.startsWith(cfg.prefix)) continue;

    const r = w.getBoundingClientRect();
    // deepest single-chain descendant
    let deep = w;
    while (deep.children.length === 1) deep = deep.children[0];
    const control = w.querySelector('input,select,textarea,button,canvas,img,table,[role="combobox"]');
    const measured = control || (deep !== w ? deep : w.firstElementChild || w);

    const attrs = {};
    if (control) {
      for (const a of ['placeholder', 'type', 'disabled', 'readonly', 'value', 'aria-required', 'aria-disabled']) {
        const v = control.getAttribute(a);
        if (v !== null) attrs[a] = v;
      }
    }

    // Subtree style union: per prop, the set of distinct computed values across
    // ALL descendants — a style change on ANY node shows up, not just the three
    // sampled nodes (measured: background renders on middle nodes like
    // ant-input-affix-wrapper that wrapper/deepest/control sampling misses).
    const styleUnion = {};
    {
      // geometry props excluded — computed sizes ripple with layout and are
      // already covered by the wrapper rect diff
      const unionProps = cfg.styleProps.filter(
        (p) => !['width', 'height', 'minHeight', 'maxWidth', 'lineHeight'].includes(p),
      );
      const els = [w, ...w.querySelectorAll('*')].slice(0, 300);
      const sets = {};
      for (const p of unionProps) sets[p] = new Set();
      for (const el of els) {
        const cs = getComputedStyle(el);
        for (const p of unionProps) sets[p].add(cs[p]);
      }
      for (const p of unionProps) styleUnion[p] = [...sets[p]].sort().join(' | ');
    }

    let canvasSig = null;
    const canvas = w.querySelector('canvas');
    if (canvas) {
      try {
        const durl = canvas.toDataURL();
        canvasSig = `${durl.length}:${durl.slice(-40)}`;
      } catch { canvasSig = 'tainted'; }
    }

    out[name] = {
      rect: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) },
      childCount: w.querySelectorAll('*').length,
      styleUnion,
      canvasSig,
      wrapperStyle: snapshotEl(w),
      style: snapshotEl(measured),
      controlStyle: control ? snapshotEl(control) : null,
      measuredTag: measured.tagName.toLowerCase(),
      text: (w.innerText || '').slice(0, 120),
      attrs,
    };
  }
  return out;
}
