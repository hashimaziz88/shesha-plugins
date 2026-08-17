#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/layout-probe.js
 *
 * The measurement instrument for the design-comprehension layer.
 *
 * It walks a RENDERED page (a design prototype OR a built Shesha form) and
 * emits a structural layout JSON: bounding boxes, nesting depth, inferred
 * column membership (from x-clustering), row grouping (from y-banding) and
 * text/role for each meaningful node. It does NOT measure pixels for their
 * own sake — it produces the STRUCTURAL signals the blueprint's `assertions`
 * block is verified against (column membership, row grouping, nesting depth,
 * tab assignment). See ../references/verification-loop.md.
 *
 * TWO WAYS TO RUN — the core (`PROBE_FN`) is identical in both:
 *
 *  A) Playwright MCP (this environment — no local playwright needed):
 *       1. mcp__playwright__browser_navigate  { url }
 *       2. mcp__playwright__browser_evaluate   { function: <contents of PROBE_FN>,
 *                                                "(" + PROBE_FN + ")(OPTS)" }
 *          → returns the layout JSON; save it yourself to a .json file.
 *     Print the call-ready snippet:  node layout-probe.js --emit-eval [--root SEL]
 *
 *  B) Local Node + Playwright (CI / when @playwright/test is installed):
 *       node layout-probe.js --url <url> --screen <name> --out <file.json> [--root SEL]
 *
 * Pin ONE fixed viewport for BOTH capture and verification (default 1440x900);
 * never compare measurements taken at different viewports — see the failure
 * modes in ../SKILL.md.
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

// The probe runs INSIDE the page. Keep it self-contained (no closures over
// node scope) so it can be string-serialised for browser_evaluate / page.evaluate.
const PROBE_FN = function (opts) {
  opts = opts || {};
  var ROOT = opts.root || 'body';
  var X_TOL = opts.xTolerance == null ? 16 : opts.xTolerance; // px: same column band
  var Y_TOL = opts.yTolerance == null ? 14 : opts.yTolerance; // px: same row band
  var MIN_AREA = opts.minArea == null ? 24 : opts.minArea;    // ignore slivers

  var rootEl = document.querySelector(ROOT) || document.body;

  function visible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  // Best-effort human label for a node, in priority order.
  function labelOf(el) {
    var aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'));
    if (aria) return aria.trim();
    if (el.id) {
      var lbl = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
    }
    // own text only (exclude descendants' text noise) — first non-empty text node
    var own = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) { own += n.textContent.trim() + ' '; }
    }
    own = own.trim();
    if (own) return own.slice(0, 80);
    var t = (el.textContent || '').trim();
    return t ? t.slice(0, 80) : '';
  }

  // Classify the node into a coarse role the blueprint vocabulary understands.
  function roleOf(el) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute && el.getAttribute('role');
    if (role) return role;
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'button' || (el.className && /btn|button/i.test(el.className))) return 'button';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'control';
    if (tag === 'table' || (el.className && /table|grid|datalist|datatable/i.test(el.className))) return 'table';
    if (tag === 'th') return 'col-header';
    if (tag === 'label') return 'label';
    if (tag === 'a') return 'link';
    var cs = getComputedStyle(el);
    if (cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex') return 'container';
    return 'box';
  }

  function isContainer(el) {
    var cs = getComputedStyle(el);
    return cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex' ||
      el.children.length >= 2;
  }

  // 1) Collect candidate nodes with geometry + depth.
  var nodes = [];
  var idCounter = 0;
  function walk(el, depth, parentId) {
    if (!visible(el)) return;
    var r = el.getBoundingClientRect();
    if (r.width * r.height < MIN_AREA) return;
    var cs = getComputedStyle(el);
    var myId = idCounter++;
    nodes.push({
      id: myId,
      parentId: parentId,
      depth: depth,
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      label: labelOf(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      flexDirection: (cs.display === 'flex' || cs.display === 'inline-flex') ? cs.flexDirection :
        (cs.display === 'grid' ? 'grid(' + (cs.gridTemplateColumns || '').split(' ').length + ')' : null),
      isContainer: isContainer(el)
    });
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, myId);
  }
  walk(rootEl, 0, null);

  // 2) Per-container: cluster DIRECT children into columns (x-bands) and rows (y-bands).
  //    This is the placement signal — column membership + row grouping per parent.
  function clusterCol(children) {
    var edges = children.map(function (c) { return c.rect.x; }).sort(function (a, b) { return a - b; });
    var bands = [];
    edges.forEach(function (x) {
      var b = bands.find(function (bb) { return Math.abs(bb - x) <= X_TOL; });
      if (b == null) bands.push(x);
    });
    bands.sort(function (a, b) { return a - b; });
    return bands; // sorted distinct left-edge bands
  }

  var byParent = {};
  nodes.forEach(function (n) {
    if (n.parentId == null) return;
    (byParent[n.parentId] = byParent[n.parentId] || []).push(n);
  });

  var containers = [];
  Object.keys(byParent).forEach(function (pid) {
    var kids = byParent[pid];
    var parent = nodes[+pid];
    var colBands = clusterCol(kids);
    // assign each child a column index + a normalized /24 span (within parent width)
    var pw = parent.rect.w || 1;
    kids.forEach(function (k) {
      var ci = 0, best = Infinity;
      colBands.forEach(function (band, idx) {
        var d = Math.abs(band - k.rect.x);
        if (d < best) { best = d; ci = idx; }
      });
      k.colIndex = ci;
      k.colCount = colBands.length;
      k.colSpan24 = Math.max(1, Math.round((k.rect.w / pw) * 24));
      k.rowBand = Math.round(k.rect.y / Y_TOL); // coarse y-band → row grouping
    });
    if (colBands.length >= 2) {
      containers.push({
        parentId: +pid,
        parentLabel: parent.label,
        parentRole: parent.role,
        columnCount: colBands.length,
        columnEdges: colBands,
        childIds: kids.map(function (k) { return k.id; })
      });
    }
  });

  return {
    screen: opts.screen || (document.title || location.href),
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    capturedAt: opts.stamp || null, // pass a timestamp in; Date.now() is intentionally not called here
    nodeCount: nodes.length,
    multiColumnContainers: containers,
    nodes: nodes
  };
};

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

async function main() {
  var args = parseArgs(process.argv);
  var opts = {
    root: args.root || 'body',
    screen: args.screen || null,
    stamp: args.stamp || null
  };

  // Mode A helper: print the exact browser_evaluate payload, then exit.
  if (args['emit-eval']) {
    var payload = '(' + PROBE_FN.toString() + ')(' + JSON.stringify(opts) + ')';
    process.stdout.write(payload + '\n');
    return;
  }

  // Mode B: drive a local Playwright browser.
  if (!args.url) {
    console.error('Usage:\n  node layout-probe.js --emit-eval [--root SEL] [--screen NAME]\n' +
      '  node layout-probe.js --url <url> --screen <name> --out <file.json> [--root SEL]');
    process.exit(2);
  }
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
  var result = await page.evaluate(PROBE_FN, opts);
  await browser.close();
  var out = JSON.stringify(result, null, 2);
  if (args.out) {
    require('fs').writeFileSync(args.out, out);
    console.error('wrote ' + args.out + ' (' + result.nodeCount + ' nodes, ' +
      result.multiColumnContainers.length + ' multi-column containers)');
  } else {
    process.stdout.write(out + '\n');
  }
}

if (require.main === module) main();
module.exports = { PROBE_FN };
