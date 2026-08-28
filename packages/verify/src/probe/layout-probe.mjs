// The T4b measurement instrument (§3.2.5, ported from quarantine/layout-probe.js to ESM,
// WP-3c). It walks a RENDERED page and emits structural residue — bounding boxes, nesting,
// parent-relative row bands, scroll-vs-client extents — for t4b-residue.mjs to assert over.
// It asserts NOTHING itself, and it names, in a `capabilities` block, what it cannot see, so
// the asserter disposes those dimensions uninspectable rather than guessing.
//
// A real browser is required only in CI's optional smoke job. `--emit-eval` prints the
// in-page function for a Playwright MCP browser_evaluate; `--url` drives a local Playwright.
// Neither runs in `npm run green` — t4b-residue.mjs runs over recorded JSON.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EXIT } from '@shesha/registry/coverage';

/**
 * The fields the probe emits per node. The §3.8 row-28 command asserts `colSpan24` is
 * absent from this object: change 4 of §3.2.5 deleted the /24 span, and a field that is
 * merely stopped being written is a field that comes back. This is the declaration.
 */
export const FIELDS = Object.freeze({
  id: 'walk order, unique within one probe',
  parentId: 'id of the emitting parent, null at the probe root',
  depth: 'nesting depth below the probe root',
  tag: 'lowercased tagName',
  role: 'coarse role the blueprint vocabulary understands',
  name: 'data-sha-c-name — the join key back to a form component, null when absent',
  rect: '{x,y,w,h} viewport rect to 2dp — NOT rounded to integers: rounding makes two abutting boxes report a full-width one-pixel intersection, and destroys the only signal that separates abutment from a real overlap',
  scroll: '{w,h,cw,ch} scrollWidth/scrollHeight vs clientWidth/clientHeight',
  position: 'computed position',
  zIndex: 'computed z-index, so only a DELIBERATE stacking decision excuses a node painting over its neighbours',
  flexDirection: 'flex-direction for a flex container, else null — the single-row declaration',
  isContainer: 'flex/grid, or two or more element children',
  tabKey: 'always null; see capabilityReasons.tabAssignment',
  rowBand: 'PARENT-RELATIVE y band index among one parent’s direct children',
});

/** The three dimensions the instrument cannot see (§3.2.5 change 6). */
export const CAPABILITY_KEYS = Object.freeze(['tabAssignment', 'fillVsFixedIntent', 'appearance']);

/** The `--summary` budget (§3.2.5 change 2). */
export const SUMMARY_MAX_ROWS = 200;
export const SUMMARY_MAX_BYTES = 8192;

// Runs INSIDE the page — self-contained, string-serialisable, no closures over module scope.
// Browser globals are reached through globalThis so this file typechecks with no DOM lib.
export const PROBE_FN = function (/** @type {any} */ opts) {
  var G = /** @type {any} */ (globalThis);
  var doc = G.document; var win = G.window; var loc = G.location; var gcs = G.getComputedStyle;
  opts = opts || {};
  var ROOT = opts.root || 'body';
  var Y_TOL = opts.yTolerance == null ? 14 : opts.yTolerance;
  var MIN_AREA = opts.minArea == null ? 24 : opts.minArea;
  var rootEl = doc.querySelector(ROOT) || doc.body;

  function visible(/** @type {any} */ el) {
    var cs = gcs(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  // CHANGE 1: identity is the compiler's data-sha-c-name, not a truncated text label.
  function nameOf(/** @type {any} */ el) {
    var n = el.getAttribute && el.getAttribute('data-sha-c-name');
    return n ? String(n) : null;
  }
  function roleOf(/** @type {any} */ el) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute && el.getAttribute('role');
    if (role) return String(role);
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'button' || (el.className && /btn|button/i.test(String(el.className)))) return 'button';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'control';
    if (tag === 'table' || (el.className && /table|grid|datalist|datatable/i.test(String(el.className)))) return 'table';
    if (tag === 'th') return 'col-header';
    if (tag === 'label') return 'label';
    if (tag === 'a') return 'link';
    var cs = gcs(el);
    if (cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex') return 'container';
    return 'box';
  }
  function isContainer(/** @type {any} */ el) {
    var cs = gcs(el);
    return cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex' || el.children.length >= 2;
  }

  /** @type {any[]} */
  var nodes = [];
  var idCounter = 0;
  function walk(/** @type {any} */ el, /** @type {number} */ depth, /** @type {number|null} */ parentId) {
    if (!visible(el)) return;
    var r = el.getBoundingClientRect();
    if (r.width * r.height < MIN_AREA) return;
    var cs = gcs(el);
    var myId = idCounter++;
    // 2dp, not integers: Math.round on viewport rects makes two abutting boxes report a
    // full-width one-pixel intersection, which is indistinguishable from a real overlap.
    var p2 = function (/** @type {number} */ n) { return Math.round(n * 100) / 100; };
    nodes.push({
      id: myId, parentId: parentId, depth: depth, tag: el.tagName.toLowerCase(),
      role: roleOf(el), name: nameOf(el),
      rect: { x: p2(r.x), y: p2(r.y), w: p2(r.width), h: p2(r.height) },
      scroll: { w: el.scrollWidth, h: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight },
      position: cs.position,
      zIndex: cs.zIndex,
      flexDirection: (cs.display === 'flex' || cs.display === 'inline-flex') ? cs.flexDirection : null,
      isContainer: isContainer(el),
      // CHANGE 3: an inactive antd tab panel is display:none and filtered by the visibility
      // test, so tab membership is unmeasurable here — reported, never asserted.
      tabKey: null,
      rowBand: 0,
    });
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, myId);
  }
  walk(rootEl, 0, null);

  /** @type {Record<string, any[]>} */
  var byParent = {};
  nodes.forEach(function (/** @type {any} */ n) {
    if (n.parentId == null) return;
    var k = String(n.parentId);
    var bucket = byParent[k];
    if (!bucket) { bucket = []; byParent[k] = bucket; }
    bucket.push(n);
  });
  // CHANGE 5: row bands are PARENT-RELATIVE — computed within one parent's direct children,
  // never on viewport-absolute y (which split one row across a 14px boundary and merged
  // unrelated containers at the same absolute y). CHANGE 4: colSpan24 is deleted.
  Object.keys(byParent).forEach(function (/** @type {string} */ pid) {
    var kids = byParent[pid] || [];
    var minY = Math.min.apply(null, kids.map(function (/** @type {any} */ k) { return k.rect.y; }));
    kids.forEach(function (/** @type {any} */ k) { k.rowBand = Math.round((k.rect.y - minY) / Y_TOL); });
  });

  return {
    screen: opts.screen || (doc.title || loc.href),
    url: loc.href,
    viewport: { w: win.innerWidth, h: win.innerHeight },
    capturedAt: opts.stamp || null,
    nodeCount: nodes.length,
    nodes: nodes,
    // CHANGE 6: name what the instrument cannot see; t4b-residue refuses to evaluate any
    // assertion whose dimension is false here, disposing it uninspectable.
    capabilities: { tabAssignment: false, fillVsFixedIntent: false, appearance: false },
    capabilityReasons: {
      tabAssignment: 'inactive antd tab panels are display:none and filtered by the visibility test',
      fillVsFixedIntent: 'a computed width cannot distinguish a 1fr fill from a fixed size that happens to match',
      appearance: 'the probe captures no colour, font, background, border, radius, shadow, gap or padding',
    },
  };
};

/**
 * CHANGE 2: a bounded summary — containers and named nodes only, <=200 rows, <=8 KB.
 * @param {any} probe
 * @returns {{screen:any, viewport:any, capabilities:any, rows:any[]}}
 */
export function summarise(probe) {
  const rows = (probe.nodes || [])
    .filter((/** @type {any} */ n) => n.isContainer || n.name)
    .slice(0, SUMMARY_MAX_ROWS)
    .map((/** @type {any} */ n) => ({ id: n.id, parentId: n.parentId, depth: n.depth, role: n.role, name: n.name, rect: n.rect, rowBand: n.rowBand }));
  const out = { screen: probe.screen, viewport: probe.viewport, capabilities: probe.capabilities, rows };
  let text = JSON.stringify(out);
  while (text.length > SUMMARY_MAX_BYTES && out.rows.length > 0) {
    out.rows = out.rows.slice(0, Math.max(0, out.rows.length - 10));
    text = JSON.stringify(out);
  }
  return out;
}

/**
 * Drive a local Playwright chromium and return the probe. The specifier is held in a
 * variable so a machine with the package but no browser fails at launch, not at parse.
 * @param {{url:string, opts:any, vw:number, vh:number}} a
 * @returns {Promise<any>}
 */
export async function capture(a) {
  const { chromium } = /** @type {any} */ (await import('playwright'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: a.vw, height: a.vh } });
    await page.goto(a.url, { waitUntil: 'networkidle' });
    // The Shesha shell redirects and then renders the configurable form, so networkidle
    // alone can sample a page on which not one component exists yet.
    await page.waitForSelector('[data-sha-c-name]', { timeout: 30000 });
    return await page.evaluate(PROBE_FN, a.opts);
  } finally {
    await browser.close();
  }
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  /** @type {Record<string, any>} */
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === undefined || !k.startsWith('--')) continue;
    const nx = argv[i + 1];
    args[k.slice(2)] = nx !== undefined && !nx.startsWith('--') ? argv[(i += 1)] : true;
  }
  const opts = { root: args.root || 'body', screen: args.screen || null, stamp: args.stamp || null };
  if (args['emit-eval']) { process.stdout.write(`(${PROBE_FN.toString()})(${JSON.stringify(opts)})\n`); return EXIT.pass; }
  if (typeof args.summary === 'string') {
    process.stdout.write(`${JSON.stringify(summarise(JSON.parse(fs.readFileSync(args.summary, 'utf8'))), null, 2)}\n`);
    return EXIT.pass;
  }
  if (typeof args.url !== 'string') {
    process.stderr.write('usage: layout-probe.mjs --emit-eval [--root SEL] | --summary <probe.json> | --url <url> --out <file> [--root SEL]\n');
    return EXIT.usage;
  }
  /** @type {any} */
  let result;
  try {
    result = await capture({ url: args.url, opts, vw: Number(args.vw || 1440), vh: Number(args.vh || 900) });
  } catch (e) {
    // No browser is a partial, never a pass: `npx playwright install chromium` is an
    // operator step, and nothing here degrades a missing measurement into a green one.
    process.stderr.write(`layout-probe: no browser (${/** @type {Error} */ (e).message.split('\n')[0]})\n`);
    return EXIT.partial;
  }
  const out = `${JSON.stringify(result, null, 2)}\n`;
  if (typeof args.out === 'string') { fs.writeFileSync(args.out, out); process.stderr.write(`wrote ${args.out} (${result.nodeCount} nodes)\n`); } else process.stdout.write(out);
  return EXIT.pass;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv)
    .then((c) => { if (c) process.exit(c); })
    .catch((e) => { process.stderr.write(`${e}\n`); process.exit(EXIT.fail); });
}
