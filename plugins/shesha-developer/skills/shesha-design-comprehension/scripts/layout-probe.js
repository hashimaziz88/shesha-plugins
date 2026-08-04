#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/layout-probe.js
 *
 * THE canonical layout probe. One probe function, one evidence schema.
 *
 * This module owns three things, and it is the ONLY place any of them exist:
 *
 *   1. `PROBE_FN`         — the page-context measurement function. It is
 *                            string-serialised into a browser (Playwright MCP
 *                            `browser_evaluate`, or local `page.evaluate`) and
 *                            returns the RAW measurement payload.
 *   2. `computeHealth`    — the Node-side layout-quality metrics (stacked
 *                            splits, tiny controls, stacked/collapsed action
 *                            rows, overflow). Migrated here from
 *                            shesha-form-edit/scripts/render-instrument.js so
 *                            there is one detector, not two.
 *   3. `EVIDENCE_REQUIRED` + `validateEvidence` + `finalizeEvidence` — the
 *                            canonical RENDER EVIDENCE schema, declared once
 *                            and enforced fail-closed by every producer.
 *
 * TWO PRODUCERS, ONE SCHEMA. This script's CLI and
 * shesha-form-edit/scripts/render-instrument.js both emit exactly the
 * canonical evidence document (`<module>--<name>.evidence.json`); the
 * instrument fills the fields only a scripted browser session can know
 * (consoleErrors, networkErrors, screenshotPath, settled), a bare CLI capture
 * leaves those present-but-empty and stamps `capturedBy: "layout-probe"`.
 * There is NO second layout artifact — the old per-form layout sidecar and the
 * duplicated layout block inside the instrument's verdict were both DELETED.
 *
 * Downstream consumers: shesha-design-comprehension/scripts/verify-placement.mjs
 * (Layer 3 placement oracle) and the design-critic (Layer 4). Neither drives a
 * browser — they read the evidence file.
 *
 * TWO WAYS TO RUN — the core (`PROBE_FN`) is identical in both:
 *
 *  A) Playwright MCP (this environment — no local playwright needed):
 *       1. mcp__playwright__browser_navigate  { url }
 *       2. mcp__playwright__browser_evaluate   { function: "(" + PROBE_FN + ")(OPTS)" }
 *          → returns the RAW payload; wrap it with `finalizeEvidence` yourself,
 *            or just use mode B.
 *     Print the call-ready snippet:  node layout-probe.js --emit-eval [--root SEL]
 *
 *  B) Local Node + Playwright (CI / when playwright is installed):
 *       node layout-probe.js --url <url> --screen <name> --form <module>/<name> \
 *                            --out <file>.evidence.json [--root SEL]
 *
 * Pin ONE fixed viewport for BOTH capture and verification (default 1440x900);
 * never compare measurements taken at different viewports — see the failure
 * modes in ../SKILL.md.
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

/* ── The canonical render-evidence schema (declared ONCE) ────────────────── */
// Field presence is the contract. `tests/contract/probe-contract.contract.test.mjs`
// in shesha-form-edit pins this same list against both producers' source.
const EVIDENCE_REQUIRED = {
  top: [
    'form',               // form identity — "<module>/<name>" (or the screen name for a prototype capture)
    'url',
    'timestamp',          // ISO capture time. ONE name — never `capturedAt`
    'viewport',           // { w, h } — pinned, and identical for capture + verification
    'components',         // per-component geometry: the placement substrate
    'rowBands',           // y-band grouping, computed once here
    'columnClusters',     // x-band clustering, per container
    'tabMembership',      // page-level active tab (per-component membership lives on each component)
    'controls',           // interactive-control census
    'boundRegions',       // data-binding census
    'actionButtonHealth', // inline / collapsed / stacked verdict for action rows
    'overflow',           // { x, y } px past the viewport
    'consoleErrors',
    'networkErrors',
    'settled',
    'screenshotPath',     // ONE name — never `screenshot`
    'health',             // the aggregate layout-quality metrics
  ],
  perComponent: ['name', 'type', 'id', 'parentId', 'rect', 'columnIndex', 'tabMembership'],
  rect: ['x', 'y', 'w', 'h'],
};

/* ── The page-context probe (runs INSIDE the browser) ────────────────────── */
// Keep it self-contained ES5 — no closures over node scope, no optional
// chaining — so it survives `String(PROBE_FN)` serialisation into any browser.
const PROBE_FN = function (opts) {
  opts = opts || {};
  var ROOT = opts.root || 'body';
  var X_TOL = opts.xTolerance == null ? 16 : opts.xTolerance; // px: same column band
  var Y_TOL = opts.yTolerance == null ? 14 : opts.yTolerance; // px: same row band
  var MIN_AREA = opts.minArea == null ? 24 : opts.minArea;    // ignore slivers
  var MODE = opts.mode || 'auto'; // 'auto' | 'shesha' | 'dom'

  var rootEl = document.querySelector(ROOT) || document.body;
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  function cls(el) { return typeof el.className === 'string' ? el.className : ''; }

  function vis(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // Best-effort human label, in priority order.
  function labelOf(el) {
    var aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'));
    if (aria) return String(aria).trim();
    if (el.id) {
      var esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
      var lbl = document.querySelector('label[for="' + esc + '"]');
      if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
    }
    var own = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) own += n.textContent.trim() + ' ';
    }
    own = own.trim();
    if (own) return own.slice(0, 80);
    var t = (el.textContent || '').trim();
    return t ? t.slice(0, 80) : '';
  }

  // Coarse role the blueprint vocabulary understands.
  function roleOf(el) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute && el.getAttribute('role');
    if (role) return role;
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'button' || /btn|button/i.test(cls(el))) return 'button';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'control';
    if (tag === 'table' || /table|grid|datalist|datatable/i.test(cls(el))) return 'table';
    if (tag === 'th') return 'col-header';
    if (tag === 'label') return 'label';
    if (tag === 'a') return 'link';
    var cs = getComputedStyle(el);
    if (cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex') return 'container';
    return 'box';
  }

  function isContainerEl(el) {
    var cs = getComputedStyle(el);
    return cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex' ||
      el.children.length >= 2;
  }

  // Which tab panel does this element live in? null = not inside any tab.
  function tabOf(el) {
    var n = el;
    while (n && n !== document.body) {
      if (n.getAttribute) {
        var role = n.getAttribute('role');
        if (role === 'tabpanel' || /tabpane/i.test(cls(n))) {
          var by = n.getAttribute('aria-labelledby');
          var tabEl = by ? document.getElementById(by) : null;
          var title = tabEl ? (tabEl.textContent || '').trim() : '';
          if (!title) title = n.getAttribute('data-sha-c-name') || n.getAttribute('id') || 'tab';
          return title.slice(0, 80);
        }
      }
      n = n.parentElement;
    }
    return null;
  }

  /* ---- 1) collect components ---------------------------------------------
   * A built Shesha form is measured through its `data-sha-c-*` markers (the
   * reliable identity channel); anything else (a design prototype, a plain
   * HTML page) falls back to a geometry walk of the visible DOM tree.        */
  var marked = [].slice.call(rootEl.querySelectorAll('[data-sha-c-id]'));
  var useMarkers = MODE === 'shesha' || (MODE === 'auto' && marked.length > 0);
  var components = [];
  var elFor = {}; // component id -> element

  if (useMarkers) {
    for (var mi = 0; mi < marked.length; mi++) {
      var el = marked[mi];
      if (!vis(el)) continue;
      var pEl = el.parentElement ? el.parentElement.closest('[data-sha-c-id]') : null;
      var cid = el.getAttribute('data-sha-c-id');
      components.push({
        name: el.getAttribute('data-sha-c-name') || labelOf(el) || cid,
        type: el.getAttribute('data-sha-c-type') || roleOf(el),
        id: cid,
        parentId: pEl ? pEl.getAttribute('data-sha-c-id') : null,
        rect: rectOf(el),
        columnIndex: 0,
        tabMembership: tabOf(el),
        propertyName: el.getAttribute('data-sha-c-property-name') || null,
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        depth: 0,
        isContainer: isContainerEl(el),
      });
      elFor[cid] = el;
    }
    // depth from the parent chain
    var byId = {};
    for (var di = 0; di < components.length; di++) byId[components[di].id] = components[di];
    for (var dj = 0; dj < components.length; dj++) {
      var d = 0; var cur = components[dj];
      while (cur && cur.parentId != null && byId[cur.parentId] && d < 64) { d++; cur = byId[cur.parentId]; }
      components[dj].depth = d;
    }
  } else {
    var seq = 0;
    (function walk(node, depth, parentId) {
      if (!vis(node)) return;
      var r = node.getBoundingClientRect();
      if (r.width * r.height < MIN_AREA) return;
      var myId = 'n' + (seq++);
      components.push({
        name: labelOf(node),
        type: roleOf(node),
        id: myId,
        parentId: parentId,
        rect: rectOf(node),
        columnIndex: 0,
        tabMembership: tabOf(node),
        propertyName: null,
        tag: node.tagName.toLowerCase(),
        role: roleOf(node),
        depth: depth,
        isContainer: isContainerEl(node),
      });
      elFor[myId] = node;
      for (var i = 0; i < node.children.length; i++) walk(node.children[i], depth + 1, myId);
    })(rootEl, 0, null);
  }

  /* ---- 2) column clustering per container + row banding ------------------ */
  var byParent = {};
  for (var ci = 0; ci < components.length; ci++) {
    var c = components[ci];
    var key = c.parentId == null ? '__root__' : String(c.parentId);
    (byParent[key] = byParent[key] || []).push(c);
  }
  var index = {};
  for (var ii = 0; ii < components.length; ii++) index[components[ii].id] = components[ii];

  function bandsOf(kids) {
    var xs = kids.map(function (k) { return k.rect.x; }).sort(function (a, b) { return a - b; });
    var bands = [];
    for (var i = 0; i < xs.length; i++) {
      var hit = false;
      for (var j = 0; j < bands.length; j++) if (Math.abs(bands[j] - xs[i]) <= X_TOL) { hit = true; break; }
      if (!hit) bands.push(xs[i]);
    }
    return bands.sort(function (a, b) { return a - b; });
  }

  var columnClusters = [];
  var multiColumnContainers = [];
  Object.keys(byParent).forEach(function (pid) {
    var kids = byParent[pid];
    var parent = index[pid] || null;
    var edges = bandsOf(kids);
    var pw = (parent && parent.rect.w) || vw || 1;
    kids.forEach(function (k) {
      var best = Infinity; var idx = 0;
      edges.forEach(function (band, n) {
        var dist = Math.abs(band - k.rect.x);
        if (dist < best) { best = dist; idx = n; }
      });
      k.columnIndex = idx;
      k.columnCount = edges.length;
      k.colSpan24 = Math.max(1, Math.round((k.rect.w / pw) * 24));
    });
    var cluster = {
      parentId: pid === '__root__' ? null : pid,
      parentName: parent ? parent.name : null,
      columnCount: edges.length,
      edges: edges,
      childIds: kids.map(function (k) { return k.id; }),
    };
    columnClusters.push(cluster);
    if (edges.length >= 2) multiColumnContainers.push(cluster);
  });

  // global y-banding — the "same row" signal
  var rowBands = [];
  components.slice().sort(function (a, b) { return a.rect.y - b.rect.y; }).forEach(function (k) {
    var band = null;
    for (var i = 0; i < rowBands.length; i++) if (Math.abs(rowBands[i].y - k.rect.y) <= Y_TOL) { band = rowBands[i]; break; }
    if (!band) { band = { y: k.rect.y, componentIds: [] }; rowBands.push(band); }
    band.componentIds.push(k.id);
  });
  for (var bi = 0; bi < rowBands.length; bi++) {
    var ids = rowBands[bi].componentIds;
    for (var bj = 0; bj < ids.length; bj++) if (index[ids[bj]]) index[ids[bj]].rowBand = bi;
  }

  /* ---- 3) censuses + layout-quality raw signals -------------------------- */
  var boundEls = [];
  for (var qi = 0; qi < components.length; qi++) {
    if (components[qi].propertyName) boundEls.push(elFor[components[qi].id]);
  }
  var nonEmpty = boundEls.filter(function (w) {
    if (!w) return false;
    var input = w.querySelector('input,textarea,select');
    if (input && String(input.value == null ? '' : input.value).trim() !== '') return true;
    var txt = (w.innerText || '').replace(/^[^:]*:\s*/, '').trim(); // strip a "Label:" prefix
    return txt.length > 0 && !/^:?$/.test(txt);
  });

  var controlEls = (boundEls.length ? boundEls : [rootEl]).map(function (w) {
    return w && w.querySelector('input,textarea,select,.ant-select,.ant-picker');
  }).filter(function (el) { return el && vis(el); });
  if (!boundEls.length) {
    controlEls = [].slice.call(rootEl.querySelectorAll('input,textarea,select,.ant-select,.ant-picker')).filter(vis);
  }
  var tinyControls = controlEls.filter(function (el) { return el.getBoundingClientRect().width < 60; }).length;

  // action buttons — scoped to buttonGroup markers where they exist
  var isEllipsis = function (t) { return /^(\.\.\.|···|…|⋯)$/.test((t || '').trim()); };
  var bgs = [].slice.call(rootEl.querySelectorAll('[data-sha-c-type="buttonGroup"]'));
  var realButtons = 0; var collapsedActions = 0;
  for (var gi = 0; gi < bgs.length; gi++) {
    var btns = [].slice.call(bgs[gi].querySelectorAll('button')).filter(vis);
    realButtons += btns.filter(function (b) {
      return b.getBoundingClientRect().width >= 40 && !isEllipsis(b.innerText) && (b.innerText || '').trim().length > 0;
    }).length;
    collapsedActions += btns.filter(function (b) { return isEllipsis(b.innerText); }).length;
  }

  // stacked action buttons [R-057]: two sibling buttons inside one action
  // container whose y-ranges are disjoint while their x-ranges overlap.
  var actionContainers = bgs.slice();
  for (var ai = 0; ai < components.length; ai++) {
    if (components[ai].type !== 'container') continue;
    var ce = elFor[components[ai].id];
    if (!ce) continue;
    var kids = ce.querySelectorAll('[data-sha-c-type="button"], [data-sha-c-type="buttonGroup"]');
    if (kids.length >= 2) actionContainers.push(ce);
  }
  var stackedActionRows = [];
  for (var si = 0; si < actionContainers.length; si++) {
    var ac = actionContainers[si];
    var abtns = [].slice.call(ac.querySelectorAll('button')).filter(vis)
      .filter(function (b) { return !isEllipsis(b.innerText) && (b.innerText || '').trim().length > 0; });
    if (abtns.length < 2) continue;
    var arects = abtns.map(function (b) { return b.getBoundingClientRect(); });
    var stacked = arects.some(function (a, i) {
      return arects.slice(i + 1).some(function (b) {
        var yDisjoint = a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
        var xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4;
        return yDisjoint && xOverlap;
      });
    });
    if (stacked) stackedActionRows.push(ac.getAttribute('data-sha-c-name') || ac.getAttribute('data-sha-c-id'));
  }

  // overflow: no measured component should extend past the viewport
  var maxRight = 0; var maxBottom = 0;
  for (var oi = 0; oi < components.length; oi++) {
    var rr = components[oi].rect;
    if (rr.w > 0 && rr.x + rr.w > maxRight) maxRight = rr.x + rr.w;
    if (rr.h > 0 && rr.y + rr.h > maxBottom) maxBottom = rr.y + rr.h;
  }

  // split soundness — a Shesha container is TWO divs; read flex from the INNER
  // div and measure ITS direct children, or every vertical stack looks broken
  // (the R-032 two-div trap).
  var rowContainers = [];
  for (var ri = 0; ri < components.length; ri++) {
    if (components[ri].type !== 'container') continue;
    var rc = elFor[components[ri].id];
    if (!rc) continue;
    var inner = rc.querySelector(':scope > .sha-components-container-inner') || rc.querySelector('.sha-components-container-inner');
    if (!inner) continue;
    var ics = getComputedStyle(inner);
    if (ics.display !== 'flex' || ics.flexDirection !== 'row') continue;
    var vkids = [].slice.call(inner.children).filter(vis);
    if (vkids.length < 2) continue;
    var krects = vkids.map(function (k) { return k.getBoundingClientRect(); });
    var sideBySide = krects.some(function (a, i) {
      return krects.slice(i + 1).some(function (b) {
        return Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5 && Math.abs(a.left - b.left) > 8;
      });
    });
    rowContainers.push({ name: components[ri].name, children: vkids.length, sideBySide: sideBySide });
  }

  var activeTab = null;
  var activeTabEl = document.querySelector('.ant-tabs-tab-active, [role="tab"][aria-selected="true"]');
  if (activeTabEl) activeTab = (activeTabEl.textContent || '').trim().slice(0, 80) || null;

  return {
    screen: opts.screen || (document.title || location.href),
    url: location.href,
    viewport: { w: vw, h: vh },
    capturedVia: useMarkers ? 'sha-markers' : 'dom-walk',
    components: components,
    rowBands: rowBands,
    columnClusters: columnClusters,
    multiColumnContainers: multiColumnContainers,
    tabMembership: activeTab,
    controls: { total: controlEls.length, tiny: tinyControls },
    boundRegions: { total: boundEls.length, nonEmpty: nonEmpty.length },
    actionButtonHealth: {
      groups: bgs.length,
      collapsed: collapsedActions,
      stacked: stackedActionRows.length,
      realButtons: realButtons,
      stackedContainers: stackedActionRows,
    },
    overflow: { x: Math.max(0, Math.round(maxRight - vw)), y: Math.max(0, Math.round(maxBottom - vh)) },
    rowSplits: {
      expectedSideBySide: rowContainers.length,
      stacked: rowContainers.filter(function (r) { return !r.sideBySide; }).map(function (r) { return r.name; }),
    },
    spinning: !!document.querySelector('.ant-spin-spinning, .sha-page-content .ant-spin'),
    errorToast: !!document.querySelector('[class*="error"] [class*="toast"], .ant-notification-notice-error'),
    bodySample: (document.body.innerText || '').slice(0, 200),
  };
};

/* ── Node-side: layout-quality metrics (ONE detector, used by both producers) */
/**
 * Aggregate the raw probe payload into the canonical `health` block. This is
 * the migrated render-instrument layout gate — same detection logic, relocated
 * so the metrics live next to the measurement that produces them.
 * @param {object} raw the PROBE_FN return value
 * @returns {object} health metrics + the human-readable `issues` it implies
 */
function computeHealth(raw) {
  const r = raw || {};
  const controls = r.controls || { total: 0, tiny: 0 };
  const ab = r.actionButtonHealth || { groups: 0, collapsed: 0, stacked: 0, realButtons: 0, stackedContainers: [] };
  const splits = r.rowSplits || { expectedSideBySide: 0, stacked: [] };
  const overflow = r.overflow || { x: 0, y: 0 };
  const stackedSplits = Array.isArray(splits.stacked) ? splits.stacked : [];
  const stackedActions = Array.isArray(ab.stackedContainers) ? ab.stackedContainers : [];
  const tinyRatio = controls.total >= 3 ? controls.tiny / controls.total : 0;

  const issues = [];
  if (stackedSplits.length) {
    issues.push(`${stackedSplits.length} flex-row container(s) stacked instead of splitting side-by-side (${stackedSplits.filter(Boolean).join(', ') || 'unnamed'}) [R-029]`);
  }
  if (tinyRatio > 0.34) issues.push(`${controls.tiny}/${controls.total} inputs are <60px wide (collapsed/unusable)`);
  if (overflow.x > 24) issues.push(`content overflows the viewport by ${overflow.x}px (horizontal scroll)`);
  if (ab.collapsed > 0) issues.push('action row shows an overflow "…" instead of inline buttons (buttonGroup needs isInline:true)');
  if (ab.groups > 0 && !ab.realButtons) issues.push('a buttonGroup rendered no visible labelled button (collapsed/overflow)');
  if (stackedActions.length) {
    issues.push(`${stackedActions.length} action container(s) render their buttons stacked vertically instead of inline (${stackedActions.filter(Boolean).join(', ') || 'unnamed'}) — buttonGroup needs isInline:true, the container a flex row [R-057]`);
  }

  return {
    componentCount: Array.isArray(r.components) ? r.components.length : 0,
    stackedSplits,
    rowsExpectedSideBySide: splits.expectedSideBySide || 0,
    tinyControls: controls.tiny || 0,
    tinyControlRatio: Math.round(tinyRatio * 100) / 100,
    stackedActionRows: stackedActions,
    collapsedActions: ab.collapsed || 0,
    realButtons: ab.realButtons || 0,
    overflowX: overflow.x || 0,
    overflowY: overflow.y || 0,
    spinning: !!r.spinning,
    errorToast: !!r.errorToast,
    issues,
    verdict: issues.length ? 'FAIL' : 'PASS',
  };
}

/* ── Node-side: the evidence schema guard ────────────────────────────────── */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Fail-closed shape check for a canonical evidence document. Returns the list
 * of problems; an empty list is the only clean answer. Consumers treat a
 * non-empty list as `malformed-evidence` — an infrastructure failure, never a
 * placement mismatch.
 * @param {object} doc a candidate evidence document
 */
function validateEvidence(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['evidence is not an object'];
  for (const f of EVIDENCE_REQUIRED.top) {
    if (!Object.prototype.hasOwnProperty.call(doc, f)) problems.push(`missing required field: ${f}`);
  }
  if (!Array.isArray(doc.components)) {
    problems.push('components is not an array');
    return problems;
  }
  let measurable = 0;
  doc.components.forEach((c, i) => {
    if (!c || typeof c !== 'object') { problems.push(`components[${i}] is not an object`); return; }
    for (const f of EVIDENCE_REQUIRED.perComponent) {
      if (!Object.prototype.hasOwnProperty.call(c, f)) problems.push(`components[${i}] missing ${f}`);
    }
    const rect = c.rect;
    if (!rect || EVIDENCE_REQUIRED.rect.some((k) => !isNum(rect[k]))) problems.push(`components[${i}] (${c.name || c.id}) has no measurable rect`);
    else measurable++;
  });
  if (doc.components.length && !measurable) problems.push('no component carries a measurable rect — nothing was measured');
  return problems;
}

/**
 * Order + freeze a canonical evidence document, refusing to emit a malformed
 * one. Every producer ends here, which is why there is only one shape.
 * @param {object} doc the fully-populated candidate document
 * @param {{lenient?: boolean}} [opts] lenient=true returns `{ doc, problems }` instead of throwing
 */
function finalizeEvidence(doc, opts) {
  const problems = validateEvidence(doc);
  if (problems.length && !(opts && opts.lenient)) {
    throw new Error(`evidence is not canonical:\n  - ${problems.join('\n  - ')}`);
  }
  const ordered = {};
  for (const f of EVIDENCE_REQUIRED.top) ordered[f] = doc[f];
  for (const k of Object.keys(doc)) if (!(k in ordered)) ordered[k] = doc[k];
  return (opts && opts.lenient) ? { doc: ordered, problems } : ordered;
}

/* ── Node CLI ────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  var a = {};
  for (var i = 2; i < argv.length; i++) {
    var k = argv[i];
    if (k.indexOf('--') === 0) {
      var key = k.slice(2);
      var val = (argv[i + 1] && argv[i + 1].indexOf('--') !== 0) ? argv[++i] : true;
      a[key] = val;
    }
  }
  return a;
}

const USAGE =
  'Usage:\n  node layout-probe.js --emit-eval [--root SEL] [--screen NAME]\n' +
  '  node layout-probe.js --url <url> [--form <module>/<name>] [--screen <name>] ' +
  '[--out <file>.evidence.json] [--root SEL] [--vw 1440] [--vh 900] [--wait ms]';

async function main() {
  var args = parseArgs(process.argv);
  var opts = {
    root: args.root || 'body',
    screen: args.screen || null,
    mode: args.mode || 'auto',
  };

  // Mode A helper: print the exact browser_evaluate payload, then exit.
  if (args['emit-eval']) {
    process.stdout.write('(' + PROBE_FN.toString() + ')(' + JSON.stringify(opts) + ')\n');
    return;
  }

  if (!args.url) { console.error(USAGE); process.exit(2); }

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    console.error('Local playwright not installed. Use --emit-eval and run the payload via the Playwright MCP browser_evaluate instead.');
    process.exit(3);
  }
  var vw = +(args.vw || 1440), vh = +(args.vh || 900);
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await page.goto(args.url, { waitUntil: 'networkidle' });
  if (args.wait) await page.waitForTimeout(+args.wait);
  var raw = await page.evaluate(PROBE_FN, opts);
  await browser.close();

  // The canonical evidence document. A bare CLI capture cannot observe console
  // or network errors, cannot judge settledness and takes no screenshot — those
  // fields are present-but-empty and `capturedBy` says why.
  var evidence = finalizeEvidence({
    form: args.form || opts.screen || raw.screen,
    url: raw.url,
    timestamp: new Date().toISOString(),
    viewport: raw.viewport,
    components: raw.components,
    rowBands: raw.rowBands,
    columnClusters: raw.columnClusters,
    tabMembership: raw.tabMembership,
    controls: raw.controls,
    boundRegions: raw.boundRegions,
    actionButtonHealth: raw.actionButtonHealth,
    overflow: raw.overflow,
    consoleErrors: [],
    networkErrors: [],
    settled: null,
    screenshotPath: null,
    health: computeHealth(raw),
    capturedBy: 'layout-probe',
    multiColumnContainers: raw.multiColumnContainers,
    screen: raw.screen,
  });

  var out = JSON.stringify(evidence, null, 2);
  if (args.out) {
    require('fs').writeFileSync(args.out, out + '\n');
    console.error('wrote ' + args.out + ' (' + evidence.components.length + ' components, ' +
      evidence.multiColumnContainers.length + ' multi-column containers, health ' + evidence.health.verdict + ')');
  } else {
    process.stdout.write(out + '\n');
  }
}

if (require.main === module) main();

module.exports = { PROBE_FN, computeHealth, validateEvidence, finalizeEvidence, EVIDENCE_REQUIRED, USAGE };
