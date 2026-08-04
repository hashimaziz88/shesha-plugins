/**
 * The RENDERED gates: anti-vanilla, anatomy, integrity.
 *
 * WHY THESE CANNOT BE OFFLINE. "The warm colour palette configured in the markup is not
 * visible in the rendered form" is 12% of the failure tail, and no JSON validator can detect
 * it by construction. The previous stack's styledness gate ran offline, so it measured HOW
 * MUCH themed markup was emitted rather than how the form LOOKS — which is how a form scored
 * PASS at 96% while the critic said the brand voice was nearly absent. Seven of its nine
 * style blocks were inert.
 *
 * So every assertion here consumes a fingerprint captured from a live DOM. The functions are
 * pure over that fingerprint, which is what makes them testable without a browser.
 *
 * ANATOMY IS SCORED BEFORE COLOUR AND WEIGHTED ABOVE IT. A model latches onto colour when
 * the deficit is layout; an anatomy failure therefore caps the critic verdict at `generic`
 * regardless of how well the palette matches.
 */

export const RENDER_EXIT = {
  OK: 0,
  RENDER_FAILED: 11,
  RENDER_DEFERRED: 12,
  SMOKE: 13,
  VANILLA: 16,
  ANATOMY: 17,
};

/**
 * Floors calibrated from the measured gap, not guessed.
 *
 * The reference designs use 25 distinct font sizes and 153 uppercase micro-labels; the
 * shipped Shesha form uses 3 sizes, 2 weights and zero micro-labels. These numbers sit
 * deliberately close to the Shesha side so the gate catches "nothing changed" rather than
 * grading design quality — that is the critic's job, and a floor that doubles as a rubric
 * gets tuned until it passes.
 */
export const FLOORS = {
  distinctFontSizes: 6,
  distinctFontWeights: 3,
  microLabels: 1,
  minInputWidthPx: 60,
};

function norm(c) {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return `#${hex}`;
  }
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return s;
}

function eq(a, b) {
  const x = norm(a);
  const y = norm(b);
  return x !== null && y !== null && x === y;
}

function px(v) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fail(code, axis, message, detail = null) {
  return { code, axis, message, detail };
}

// =====================================================================================
/**
 * GATE 1 — anti-vanilla.
 *
 * Compares the live fingerprint against the VANILLA one captured with the theme stripped,
 * and asserts divergence on every axis the active theme claims to set. Same-as-vanilla on a
 * claimed axis is exit 16, with the axis named — because "we set a primary colour and the
 * page still looks stock" is the exact failure this exists to catch.
 */
export function antiVanilla({ fingerprint, vanilla, theme }) {
  const failures = [];
  const checked = [];
  const notAsserted = [];
  const fp = fingerprint;

  if (!fp) return { pass: false, failures: [fail(RENDER_EXIT.VANILLA, 'fingerprint', 'no fingerprint was captured')], checked };

  // ---- divergence from vanilla, per claimed axis ---------------------------------
  if (vanilla) {
    const axes = [
      ['primaryColour', theme.brand.primary, fp.primaryColour, vanilla.primaryColour],
      ['pageBackground', theme.surface.canvas, fp.pageBackground, vanilla.pageBackground],
      ['cardSurface', theme.surface.surface, fp.cardSurface, vanilla.cardSurface],

    ];
    for (const [axis, claimed, live, base] of axes) {
      if (claimed === null || claimed === undefined) continue;
      checked.push(axis);
      // surface is #ffffff in every brand, so "same as vanilla" is correct there and must
      // not be reported as a failure.
      const claimedEqualsVanilla = eq(claimed, base);
      if (claimedEqualsVanilla) continue;
      if (eq(live, base)) {
        failures.push(
          fail(
            RENDER_EXIT.VANILLA,
            axis,
            `${axis} still renders as the unthemed default (${norm(base)}) — the theme claims ${norm(claimed)}, so nothing reached the DOM`,
            { claimed: norm(claimed), live: norm(live), vanilla: norm(base) }
          )
        );
      }
    }
  } else {
    checked.push('vanilla-baseline-absent');
  }

  /**
   * fontFamily is deliberately NOT asserted. Mining six working forms found 62 font blocks
   * and ZERO body-face families — only mono is ever set. The body face therefore is not a
   * per-component channel in Shesha 0.45, and the app theme has no antd token channel to
   * deliver it either. Asserting it would fail every correct form forever.
   */
  notAsserted.push({ axis: 'fontFamily', why: 'not a per-component channel in 0.45, and the app theme has no token channel to carry it' });

  // ---- concrete floors -----------------------------------------------------------
  checked.push('fontSizes', 'fontWeights', 'microLabels', 'cardRadius', 'surfaceTriplet', 'primaryAction');

  const sizes = (fp.fontSizes || []).map(px).filter((n) => n !== null);
  const distinctSizes = new Set(sizes).size;
  if (distinctSizes < FLOORS.distinctFontSizes) {
    failures.push(
      fail(RENDER_EXIT.VANILLA, 'fontSizes', `only ${distinctSizes} distinct font size(s) rendered; the floor is ${FLOORS.distinctFontSizes}`, {
        sizes: [...new Set(sizes)].sort((a, b) => a - b),
      })
    );
  }

  const weights = new Set((fp.fontWeights || []).map((w) => String(w)));
  if (weights.size < FLOORS.distinctFontWeights) {
    failures.push(
      fail(RENDER_EXIT.VANILLA, 'fontWeights', `only ${weights.size} distinct font weight(s); the floor is ${FLOORS.distinctFontWeights}`, {
        weights: [...weights],
      })
    );
  }

  // The uppercase micro-label: 153 instances across the reference corpus, zero in the
  // shipped Shesha form. Highest signal per unit of effort in the whole design.
  const micro = fp.microLabels ?? 0;
  if (micro < FLOORS.microLabels) {
    failures.push(
      fail(
        RENDER_EXIT.VANILLA,
        'microLabels',
        `no uppercase micro-label rendered (${theme.microLabel.size}px / ${theme.microLabel.weight} / ${theme.microLabel.tracking}) — the reference corpus has 153 and the stock Shesha form has zero`
      )
    );
  }

  const wantRadius = theme.radius.card;
  if (wantRadius !== undefined && Array.isArray(fp.cardRadii) && fp.cardRadii.length) {
    const radii = fp.cardRadii.map(px).filter((n) => n !== null);
    if (!radii.some((r) => Math.abs(r - wantRadius) < 0.5)) {
      failures.push(
        fail(RENDER_EXIT.VANILLA, 'cardRadius', `no card rendered at the brand radius of ${wantRadius}px; saw ${[...new Set(radii)].join(', ')}`, {
          expected: wantRadius,
          saw: [...new Set(radii)],
        })
      );
    }
  }

  // The page-wash -> surface -> border triplet. Three distinct planes are what makes a page
  // read as layered rather than flat; the shipped form gets this right and it is kept.
  const triplet = [fp.pageBackground, fp.cardSurface, fp.borderColour].map(norm);
  if (new Set(triplet.filter(Boolean)).size < 3) {
    failures.push(
      fail(RENDER_EXIT.VANILLA, 'surfaceTriplet', 'the page-wash / surface / border triplet does not render as three distinct values', {
        saw: triplet,
      })
    );
  }

  /**
   * Exactly one primary action, and PRIMARY means "filled with the brand colour".
   *
   * Counting any button with an opaque background made the white bordered "refresh" a second
   * primary, so a correct one-primary form failed. The brand fill is the only definition that
   * matches what the design standard means: roughly one primary to two secondary across 235
   * buttons in the reference build.
   */
  const fills = Array.isArray(fp.buttons) ? fp.buttons : [];
  const primaries = fills.filter((b) => eq(b, theme.brand.primary)).length;
  if (primaries > 1) {
    failures.push(fail(RENDER_EXIT.VANILLA, 'primaryAction', `${primaries} actions render in the brand primary; exactly one should`));
  } else if (fills.length > 0 && primaries === 0) {
    /**
     * A button's FILL is not a per-component channel. Mining six working forms found five
     * button items and ZERO desktop style blocks among them — antd takes the fill from the
     * app theme's primaryColor. So "the primary button is not brand green" is a THEME finding,
     * not a form defect, and the app theme is explicitly deferred from v1.0.
     *
     * Reported, never silently dropped: the count of markup-level primaries is already
     * enforced offline by R-007, and this records that the colour needs the theme pass.
     */
    notAsserted.push({
      axis: 'primaryActionFill',
      why:
        `no button renders filled with ${theme.brand.primary}; the fill comes from the app theme's primaryColor, ` +
        'which is not a per-component channel and is deferred from v1.0. R-007 enforces exactly one markup-level primary offline.',
      saw: [...new Set(fills)],
    });
  }

  return { pass: failures.length === 0, failures, checked, notAsserted };
}

// =====================================================================================
/**
 * GATE 2 — anatomy.
 *
 * Everything here is computable from getBoundingClientRect in the single batched evaluate.
 * These are the assertions that catch a page which is correctly coloured and structurally
 * absent.
 */
/**
 * Anatomy is asserted against what the form DECLARES, never universally.
 *
 * An unstyled two-node calibration form has no header band and should not be judged for
 * lacking one — it makes no such claim. Asserting unconditionally made every form fail
 * anatomy, which swallowed the anti-vanilla exit code and meant a genuinely unstyled form
 * reported 17 instead of 16. Expectations come from the caller, who knows the archetype.
 */
export function anatomy({
  geometry,
  theme,
  declaredGroups = 1,
  expectStatTiles = false,
  expectBand = false,
  expectSurface = false,
  enforceRhythm = false,
}) {
  const failures = [];
  const checked = [];
  if (!geometry || !Array.isArray(geometry.nodes) || geometry.nodes.length === 0) {
    return {
      pass: false,
      failures: [fail(RENDER_EXIT.ANATOMY, 'geometry', 'no geometry was captured, so anatomy could not be assessed')],
      checked,
    };
  }
  const N = geometry.nodes;
  const vw = geometry.viewport?.w ?? 1440;

  // 1. a distinct header band above the content — only when the form claims one
  if (expectBand) {
  checked.push('headerBand');
  const bands = N.filter(
    (n) => n.box.w > vw * 0.6 && n.box.h > 24 && n.box.h < 240 && n.box.y < 260 && norm(n.style.background) && norm(n.style.background) !== norm(geometry.pageBackground)
  );
  if (bands.length === 0) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'headerBand', 'no distinct header band renders above the content'));
  }
  }

  // 2. content on a surface inset from the page edge — only when the form claims one
  if (expectSurface) {
  checked.push('inset');
  const surfaces = N.filter((n) => n.box.w > vw * 0.5 && norm(n.style.background) === norm(theme.surface.surface));
  if (surfaces.length === 0) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'inset', 'no content surface renders at the brand surface colour'));
  } else if (surfaces.every((s) => s.box.x <= 1)) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'inset', 'every content surface is flush to the page edge; content should be inset'));
  }
  }

  // 3. more visual sections than the spec declared groups
  checked.push('grouping');
  if (declaredGroups > 1) {
    const sections = N.filter((n) => n.box.w > vw * 0.4 && n.box.h > 40 && (px(n.style.borderTopWidth) > 0 || norm(n.style.background) === norm(theme.surface.surface)));
    if (sections.length < declaredGroups) {
      failures.push(
        fail(RENDER_EXIT.ANATOMY, 'grouping', `the spec declares ${declaredGroups} logical group(s) but only ${sections.length} visual section(s) render`)
      );
    }
  }

  // 4. exactly one right-aligned action row, holding exactly one primary
  checked.push('actionRow');
  const actionRows = N.filter((n) => n.style.display === 'flex' && /flex-end|right/.test(String(n.style.justifyContent)));
  if (actionRows.length > 1) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'actionRow', `${actionRows.length} right-aligned action rows render; exactly one should`));
  }

  // 5. vertical rhythm drawn from the brand's declared gap set, not arbitrary values
  if (enforceRhythm) {
  checked.push('rhythm');
  const declared = new Set((theme.spacing.declared || []).map(Number));
  const gaps = (geometry.gaps || []).map(px).filter((n) => n !== null && n > 0);
  const offGrid = [...new Set(gaps)].filter((g) => !declared.has(Math.round(g)));
  if (gaps.length && offGrid.length) {
    failures.push(
      fail(
        RENDER_EXIT.ANATOMY,
        'rhythm',
        `gap value(s) ${offGrid.join(', ')} are not in the ${theme.name} declared spacing set — gaps come from the brand's set, never from "multiples of 4"`,
        { declared: [...declared], offGrid }
      )
    );
  }
  }

  // 6. stat tiles occupy ONE ROW, not a stack. A measured failure of the previous stack.
  checked.push('statRow');
  if (expectStatTiles) {
    const tiles = N.filter((n) => n.kit === 'StatCard' || n.part === 'statCard');
    if (tiles.length > 1) {
      const ys = tiles.map((t) => t.box.y);
      const spread = Math.max(...ys) - Math.min(...ys);
      if (spread > 8) {
        failures.push(
          fail(RENDER_EXIT.ANATOMY, 'statRow', `${tiles.length} stat tiles are stacked (top edges span ${Math.round(spread)}px) instead of forming one row`)
        );
      }
      const widths = tiles.map((t) => t.box.w);
      const ragged = Math.max(...widths) - Math.min(...widths);
      if (ragged > 4) {
        failures.push(
          fail(RENDER_EXIT.ANATOMY, 'statRow', `stat tiles are unequal (widths span ${Math.round(ragged)}px); a KPI row is equal columns`)
        );
      }
    }
  }

  // 7. no declared region renders empty
  checked.push('noEmptyRegions');
  const empties = N.filter((n) => n.declaredBinding && !String(n.text || '').trim());
  if (empties.length) {
    failures.push(
      fail(RENDER_EXIT.ANATOMY, 'noEmptyRegions', `${empties.length} region(s) declared a binding but rendered empty`, {
        regions: empties.map((e) => e.declaredBinding).slice(0, 8),
      })
    );
  }

  return { pass: failures.length === 0, failures, checked };
}

// =====================================================================================
/**
 * GATE 3 — integrity. Cheap structural sanity that would embarrass a delivery.
 */
export function integrity({ geometry, consoleErrors = [] }) {
  const failures = [];
  const checked = ['consoleErrors', 'wrappedRow', 'inputWidth', 'overflowMenu'];
  const N = (geometry && geometry.nodes) || [];
  const vw = geometry?.viewport?.w ?? 1440;

  if (consoleErrors.length) {
    failures.push(
      fail(RENDER_EXIT.RENDER_FAILED, 'consoleErrors', `${consoleErrors.length} console error(s) during render`, {
        errors: consoleErrors.slice(0, 5),
      })
    );
  }

  /**
   * A flex row that WRAPPED. The first version compared children's top edges and flagged any
   * spread over 8px — which fires on every vertically-centred row, including the app shell's
   * own header, so it reported "wrapped" on a perfectly fine page. A row is only wrapped when
   * one child sits ENTIRELY BELOW another, which is what an actual line break looks like.
   */
  for (const n of N) {
    if (n.style.display !== 'flex') continue;
    if (n.style.flexDirection && n.style.flexDirection !== 'row') continue;
    if (String(n.style.flexWrap) === 'nowrap') continue;
    if (!Array.isArray(n.childBoxes) || n.childBoxes.length < 2) continue;
    const wrapped = n.childBoxes.some((a) => n.childBoxes.some((b) => b.top >= a.bottom - 1 && b !== a));
    if (wrapped) {
      failures.push(
        fail(
          RENDER_EXIT.ANATOMY,
          'wrappedRow',
          `a flex row (${n.kit || n.tag}) wrapped onto more than one line — its children did not fit, which is the 150px-of-1336px case`
        )
      );
      break;
    }
  }

  const narrow = N.filter((n) => n.isInput && n.box.w > 0 && n.box.w < FLOORS.minInputWidthPx);
  if (narrow.length) {
    failures.push(
      fail(RENDER_EXIT.ANATOMY, 'inputWidth', `${narrow.length} input(s) render narrower than ${FLOORS.minInputWidthPx}px`, {
        widths: narrow.map((n) => Math.round(n.box.w)).slice(0, 8),
      })
    );
  }

  // A buttonGroup without isInline collapses to an overflow "..." menu [R-057].
  if (N.some((n) => /^\s*(…|\.\.\.)\s*$/.test(String(n.text || '')))) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'overflowMenu', 'an action group collapsed to an overflow "..." menu — buttonGroup.isInline is missing [R-057]'));
  }

  if (vw < 1080) {
    failures.push(fail(RENDER_EXIT.ANATOMY, 'viewport', `the viewport is ${vw}px; the design has a minimum of 1080px`));
  }

  return { pass: failures.length === 0, failures, checked };
}

// =====================================================================================
/**
 * Run all three, in the order that matters.
 *
 * Anatomy is evaluated FIRST and reported first, because a model reading this will otherwise
 * fix the colour and declare victory. The returned `capVerdict` is what the critic must
 * honour: an anatomy failure caps it at `generic` no matter how good the palette is.
 */
export function runRenderedGates({ fingerprint, vanilla, theme, geometry, consoleErrors, declaredGroups, expectStatTiles }) {
  const anat = anatomy({ geometry, theme, declaredGroups, expectStatTiles });
  const vanillaResult = antiVanilla({ fingerprint, vanilla, theme });
  const integ = integrity({ geometry, consoleErrors });

  const all = [...anat.failures, ...vanillaResult.failures, ...integ.failures];

  // Exit-code precedence: a broken render beats an anatomy failure beats a vanilla one,
  // because that is the order in which they must be fixed.
  let exitCode = RENDER_EXIT.OK;
  if (integ.failures.some((f) => f.code === RENDER_EXIT.RENDER_FAILED)) exitCode = RENDER_EXIT.RENDER_FAILED;
  else if (!anat.pass) exitCode = RENDER_EXIT.ANATOMY;
  else if (!vanillaResult.pass) exitCode = RENDER_EXIT.VANILLA;

  return {
    pass: all.length === 0,
    exitCode,
    // The critic is not allowed to award more than this.
    capVerdict: anat.pass ? null : 'generic',
    capReason: anat.pass ? null : 'anatomy failed, and anatomy is weighted above colour',
    anatomy: anat,
    antiVanilla: vanillaResult,
    notAsserted: vanillaResult.notAsserted || [],
    integrity: integ,
    failures: all,
    checked: { anatomy: anat.checked, antiVanilla: vanillaResult.checked, integrity: integ.checked },
  };
}

/**
 * The single batched page function.
 *
 * ONE evaluate, not one per element. A per-element round trip is the difference between a
 * two-second gate and a twenty-second one, and the previous stack's browser work was killed
 * for exactly that kind of cost.
 */
export const CAPTURE_FN = `() => {
  const isInput = (el) => ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.getAttribute('role') === 'textbox';

  /**
   * SCOPE TO THE FORM, NOT THE PAGE.
   *
   * Measuring document.body swept in the adminportal's own shell — its dark rail, its header,
   * its fonts — so pageBackground read as the shell's transparent body and fontFamily read
   * -apple-system from the shell. Every colour axis then failed on a correctly themed form.
   * The gates are about the FORM the compiler produced, so the scope is the form root and the
   * page background is read from the form's own scroll container.
   */
  /**
   * Pick the LARGEST plausible form container, not the first match.
   *
   * Selecting the first .sha-page-content grabbed a 43-node subtree of a page with hundreds
   * of elements, so the fingerprint reported 3 font sizes on a form that visibly renders
   * many more. The scope must exclude the shell but contain the whole form, so candidates are
   * ranked by element count and the richest wins.
   */
  const candidates = [
    ...document.querySelectorAll('.sha-page-content, .sha-form, .sha-components-container, main'),
  ];
  let scope = document.body;
  let best = 0;
  for (const c of candidates) {
    const n = c.querySelectorAll('*').length;
    if (n > best) {
      best = n;
      scope = c;
    }
  }
  // The shell's own rail and header must never be inside the scope.
  if (scope === document.body) {
    const shell = document.querySelector('.ant-layout-content, [class*="layout-content"]');
    if (shell) scope = shell;
  }

  const all = [...scope.querySelectorAll('*')];
  const nodes = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const kids = [...el.children].map(c => c.getBoundingClientRect()).filter(b => b.width > 1 && b.height > 1);
    const childTops = kids.map(b => b.top);
    nodes.push({
      // Child boxes, so a genuine line break can be told from a centred row.
      childBoxes: kids.map(b => ({ top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) })),
      tag: el.tagName,
      kit: el.getAttribute('data-kit') || null,
      part: el.getAttribute('data-part') || null,
      declaredBinding: el.getAttribute('data-binding') || null,
      // Only the ant-/sha- classes, which are the sole stable way to tell WHAT a rendered box
      // is. Shesha emits no data-* type markers, so without these the fidelity diff can see
      // boxes but not roles, and a role check that cannot observe one side is decoration.
      cls: (typeof el.className === 'string' ? el.className : '')
        .split(/\\s+/)
        .filter((c) => /^(ant|sha)-/.test(c))
        .slice(0, 8),
      isInput: isInput(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      childTopSpread: childTops.length > 1 ? Math.max(...childTops) - Math.min(...childTops) : 0,
      text: (el.childElementCount === 0 ? (el.textContent || '') : '').trim().slice(0, 80),
      style: {
        background: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        borderRadius: cs.borderTopLeftRadius,
        borderTopWidth: cs.borderTopWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderColor: cs.borderTopColor,
        borderLeftColor: cs.borderLeftColor,
        display: cs.display,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        flexWrap: cs.flexWrap,
        gap: cs.gap,
        textTransform: cs.textTransform,
        letterSpacing: cs.letterSpacing,
        boxShadow: cs.boxShadow,
      },
    });
  }

  const opaque = nodes.filter(n => n.style.background && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(n.style.background));
  const byArea = [...opaque].sort((a,b) => (b.box.w*b.box.h) - (a.box.w*a.box.h));
  const scopeBg = getComputedStyle(scope).backgroundColor;
  const pageBackground = (scopeBg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(scopeBg)) ? scopeBg : getComputedStyle(document.body).backgroundColor;

  // A micro-label is uppercase, small and tracked out. Counting the SHAPE rather than a
  // class name is what makes it real: the previous stack emitted the markup and never
  // checked that it rendered.
  const microLabels = nodes.filter(n => {
    const t = (n.text || '').trim();
    if (t.length < 3) return false;
    const caps = n.style.textTransform === 'uppercase' || (t === t.toUpperCase() && /[A-Z]{3}/.test(t));
    return caps && parseFloat(n.style.fontSize) <= 12.5 && parseInt(n.style.fontWeight, 10) >= 500;
  }).length;

  const cards = nodes.filter(n => parseFloat(n.style.borderRadius) > 0 && n.box.w > 120 && n.box.h > 40);

  return {
    nodes,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    pageBackground,
    gaps: [...new Set(nodes.map(n => n.style.gap).filter(g => g && g !== 'normal').flatMap(g => String(g).split(/\\s+/)))],
    fingerprint: {
      microLabels,
      fontSizes: [...new Set(nodes.map(n => n.style.fontSize))],
      fontWeights: [...new Set(nodes.map(n => n.style.fontWeight))],
      fontFamily: nodes.length ? nodes[0].style.fontFamily : null,
      cardRadii: [...new Set(cards.map(c => c.style.borderRadius))],
      cardSurface: (cards.filter(c => c.style.background && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c.style.background)).sort((x,y)=>(y.box.w*y.box.h)-(x.box.w*x.box.h))[0] || { style: {} }).style.background || null,
      pageBackground,
      borderColour: (nodes.find(n => parseFloat(n.style.borderTopWidth) > 0 && n.style.borderColor && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(n.style.borderColor)) || { style: {} }).style.borderColor || null,
      // The primary action: a filled button-ish element carrying the brand colour.
primaryActions: 0,
primaryColour: null,
      buttons: nodes.filter(n => n.tag === "BUTTON" || n.kit === "Button").map(n => n.style.background),
      distinctBackgrounds: [...new Set(opaque.map(n => n.style.background))].length,
    },
  };
}`;
