#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/layout-probe.js
 *
 * The measurement instrument for the design-comprehension layer.
 *
 * It walks a RENDERED page (a design prototype OR a built Shesha form) and
 * emits a structural layout JSON: bounding boxes, nesting depth, inferred
 * column membership (from x-clustering), row grouping (from y-banding), tab
 * assignment (from the nearest ancestor `role="tabpanel"`, see the "tab-pane
 * detection" section of PROBE_BODY below and scripts/lib/tabkey.mjs) and
 * text/role for each meaningful node. It does NOT measure pixels for their
 * own sake — it produces the STRUCTURAL signals the blueprint's `assertions`
 * block is verified against (column membership, row grouping, nesting depth,
 * tab assignment). See ../references/verification-loop.md.
 *
 * TAB CAPTURE reads real Ant Design / rc-tabs markup (verified against the
 * actual node_modules in shesha-framework — see ../.superpowers/sdd/.../
 * task-7-report.md for how). Every walked node gets a `tabKey` (the key of
 * its nearest enclosing tab pane, or null if none) and a `hidden` flag (true
 * when that nearest pane is currently inactive — `display:none` via antd's
 * `ant-tabs-tabpane-hidden` class). Inactive-but-MOUNTED panes are still
 * walked (the usual visible()/MIN_AREA gate is bypassed for their subtree,
 * since a collapsed ancestor makes getBoundingClientRect report 0x0 for
 * everything inside it) so their contents are captured with real rect data
 * from whenever they were last laid out. A pane never yet activated is not
 * in the DOM at all (rc-tabs only mounts a pane on first visit unless
 * `forceRender` is set) — no static-DOM probe can see it, so click through
 * every tab at least once before the FINAL capture used for verification.
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
 *
 * COLUMN/ROW CLUSTERING lives in scripts/lib/cluster.mjs, not inline here, so
 * it is directly unit-testable without a browser (tests/layout-probe.test.mjs
 * imports it). PROBE_FN itself must stay a single self-contained function
 * (it is string-serialised into the page), so `buildProbeFn()` below reads
 * cluster.mjs's source TEXT at require-time and splices it into the probe
 * body — the shipped browser logic and the unit-tested logic are therefore
 * byte-identical, never two hand-maintained copies that can drift.
 * ───────────────────────────────────────────────────────────────────────── */

'use strict';

var fs = require('fs');
var path = require('path');

// Read a lib/*.mjs file's source and strip its ESM `export ` keywords so the
// function declarations can live inside PROBE_FN's body (a plain, non-module
// function scope). No other rewriting is needed — every spliced module is
// deliberately written in var/function-expression ES5 style for exactly this
// reason (see each module's own header comment).
function loadLibSource(name) {
  var file = path.join(__dirname, 'lib', name);
  var src = fs.readFileSync(file, 'utf8');
  return src.replace(/^export\s+function/gm, 'function');
}
function loadClusterSource() {
  return loadLibSource('cluster.mjs');
}
// scripts/lib/tabkey.mjs — the pure (DOM-free) half of tab-key resolution;
// see that file's header for the DOM shape and why the rest lives inline below.
function loadTabKeySource() {
  return loadLibSource('tabkey.mjs');
}

// The probe runs INSIDE the page. Keep it self-contained (no closures over
// node scope) so it can be string-serialised for browser_evaluate / page.evaluate.
// Built via `new Function` so the spliced-in cluster.mjs source (read at
// require-time, see loadClusterSource above) is actually part of the
// function's own text — both for `.toString()` (the --emit-eval path) and
// for Playwright's internal function serialisation (page.evaluate(PROBE_FN)).
var PROBE_BODY = [
  'opts = opts || {};',
  "var ROOT = opts.root || 'body';",
  'var X_TOL = opts.xTolerance == null ? 16 : opts.xTolerance; // px: same column band',
  'var Y_TOL = opts.yTolerance == null ? 14 : opts.yTolerance; // px: same row band',
  'var MIN_AREA = opts.minArea == null ? 24 : opts.minArea;    // ignore slivers',
  '',
  'var rootEl = document.querySelector(ROOT) || document.body;',
  '',
  'function visible(el) {',
  "  var cs = getComputedStyle(el);",
  "  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;",
  '  var r = el.getBoundingClientRect();',
  '  return r.width > 1 && r.height > 1;',
  '}',
  '',
  '// Best-effort human label for a node, in priority order.',
  'function labelOf(el) {',
  "  var aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'));",
  '  if (aria) return aria.trim();',
  '  if (el.id) {',
  '    var lbl = document.querySelector(\'label[for="\' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + \'"]\');',
  '    if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();',
  '  }',
  "  // own text only (exclude descendants' text noise) — first non-empty text node",
  "  var own = '';",
  '  for (var i = 0; i < el.childNodes.length; i++) {',
  '    var n = el.childNodes[i];',
  "    if (n.nodeType === 3 && n.textContent.trim()) { own += n.textContent.trim() + ' '; }",
  '  }',
  '  own = own.trim();',
  '  if (own) return own.slice(0, 80);',
  "  var t = (el.textContent || '').trim();",
  "  return t ? t.slice(0, 80) : '';",
  '}',
  '',
  '// Classify the node into a coarse role the blueprint vocabulary understands.',
  'function roleOf(el) {',
  '  var tag = el.tagName.toLowerCase();',
  "  var role = el.getAttribute && el.getAttribute('role');",
  '  if (role) return role;',
  "  if (/^h[1-6]$/.test(tag)) return 'heading';",
  "  if (tag === 'button' || (el.className && /btn|button/i.test(el.className))) return 'button';",
  "  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'control';",
  "  if (tag === 'table' || (el.className && /table|grid|datalist|datatable/i.test(el.className))) return 'table';",
  "  if (tag === 'th') return 'col-header';",
  "  if (tag === 'label') return 'label';",
  "  if (tag === 'a') return 'link';",
  '  var cs = getComputedStyle(el);',
  "  if (cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex') return 'container';",
  "  return 'box';",
  '}',
  '',
  'function isContainer(el) {',
  '  var cs = getComputedStyle(el);',
  "  return cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex' ||",
  '    el.children.length >= 2;',
  '}',
  '',
  '// ── clustering logic (spliced in from scripts/lib/cluster.mjs — do not hand-edit here) ──',
  loadClusterSource(),
  '// ── end spliced cluster.mjs ──',
  '',
  '// ── pure tab-key string logic (spliced in from scripts/lib/tabkey.mjs) ──',
  loadTabKeySource(),
  '// ── end spliced tabkey.mjs ──',
  '',
  '// ── tab-pane detection (Ant Design / rc-tabs — see lib/tabkey.mjs header',
  '//    for the exact DOM shape this was verified against). Inactive-but-',
  "//    mounted panes get class ant-tabs-tabpane-hidden -> display:none; a",
  '//    pane never yet activated is not mounted at all (rc-tabs only mounts',
  '//    on first visit unless forceRender is set) and so cannot be captured',
  '//    by any single-pass static-DOM probe — click through every tab at',
  '//    least once before the final capture so all panes are mounted (see',
  '//    ../references/verification-loop.md).',
  'function nearestTabPane(el) {',
  '  var cur = el;',
  '  while (cur) {',
  "    if (cur.nodeType === 1 && cur.getAttribute && cur.getAttribute('role') === 'tabpanel') return cur;",
  '    cur = cur.parentElement;',
  '  }',
  '  return null;',
  '}',
  'function tabKeyOfPane(pane) {',
  "  var labelledBy = pane.getAttribute('aria-labelledby');",
  '  if (labelledBy) {',
  '    var tabBtn = document.getElementById(labelledBy);',
  "    var wrapper = (tabBtn && tabBtn.closest) ? tabBtn.closest('[data-node-key]') : null;",
  '    if (wrapper) {',
  "      var raw = wrapper.getAttribute('data-node-key');",
  '      if (raw != null) return raw;',
  '    }',
  '  }',
  '  return parseTabKeyFromPaneId(pane.id); // pure fallback, spliced in from tabkey.mjs',
  '}',
  'function isHiddenTabPane(pane) {',
  '  var cs = getComputedStyle(pane);',
  "  return cs.display === 'none' || pane.getAttribute('aria-hidden') === 'true';",
  '}',
  '',
  '// 1) Collect candidate nodes with geometry + depth.',
  'var nodes = [];',
  'var idCounter = 0;',
  'function walk(el, depth, parentId, hiddenAncestor) {',
  '  var pane = nearestTabPane(el);',
  '  var tabKey = pane ? tabKeyOfPane(pane) : null;',
  '  var hiddenNow = !!hiddenAncestor || (pane ? isHiddenTabPane(pane) : false);',
  '  if (!hiddenNow) {',
  '    if (!visible(el)) return;',
  '  } else {',
  "    // Bypass the normal visible()/MIN_AREA gate for content inside an",
  '    // inactive-but-mounted tab pane: getBoundingClientRect collapses to',
  '    // 0x0 for anything under a display:none ancestor, which would',
  "    // otherwise make every node in a non-active tab look like an empty",
  '    // sliver and get silently dropped. Still respect visibility:hidden',
  '    // and opacity:0, which are independent of the tab-pane mechanism.',
  '    var csHidden = getComputedStyle(el);',
  "    if (csHidden.visibility === 'hidden' || +csHidden.opacity === 0) return;",
  '  }',
  '  var r = el.getBoundingClientRect();',
  '  if (!hiddenNow && r.width * r.height < MIN_AREA) return;',
  '  var cs = getComputedStyle(el);',
  '  var myId = idCounter++;',
  '  nodes.push({',
  '    id: myId,',
  '    parentId: parentId,',
  '    depth: depth,',
  '    tag: el.tagName.toLowerCase(),',
  '    role: roleOf(el),',
  '    label: labelOf(el),',
  '    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },',
  "    flexDirection: (cs.display === 'flex' || cs.display === 'inline-flex') ? cs.flexDirection :",
  "      (cs.display === 'grid' ? 'grid(' + (cs.gridTemplateColumns || '').split(' ').length + ')' : null),",
  '    isContainer: isContainer(el),',
  '    tabKey: tabKey,',
  '    hidden: hiddenNow',
  '  });',
  '  for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, myId, hiddenNow);',
  '}',
  'walk(rootEl, 0, null, false);',
  '',
  '// 2) Per-container: cluster DIRECT children into columns (row-band-aware x-clustering,',
  '//    see cluster.mjs) and rows. This is the placement signal — column membership + row',
  '//    grouping per parent. columnCount is derived from horizontal overlap WITHIN a shared',
  '//    row band, not from left-edge distinctness alone — a vertically-stacked pair at',
  "//    different indents (Shesha's outer/inner div nesting) no longer inflates columnCount.",
  '//    Native px widths (never a /24 grid) are recorded per split child as childWidths,',
  '//    index-aligned with childIds.',
  'var containers = buildMultiColumnContainers(nodes, { xTolerance: X_TOL, yTolerance: Y_TOL });',
  '',
  'return {',
  '  screen: opts.screen || (document.title || location.href),',
  '  url: location.href,',
  '  viewport: { w: window.innerWidth, h: window.innerHeight },',
  '  capturedAt: opts.stamp || null, // pass a timestamp in; Date.now() is intentionally not called here',
  '  nodeCount: nodes.length,',
  '  multiColumnContainers: containers,',
  '  nodes: nodes',
  '};'
].join('\n');

var PROBE_FN = new Function('opts', PROBE_BODY);

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
