import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabKeyFromPaneId } from '../scripts/lib/tabkey.mjs';
import { evaluate } from '../scripts/lib/assertions.mjs';
import layoutProbeModule from '../scripts/layout-probe.js';

/* ── pure string logic (lib/tabkey.mjs) ──────────────────────────────────
 * The DOM-walking half (ancestor lookup) can't run outside a page, but the
 * ID-suffix fallback IS pure and directly testable. */

test('parseTabKeyFromPaneId extracts the key after the rc-tabs "-panel-" marker', () => {
  assert.equal(parseTabKeyFromPaneId('rc-tabs-0-panel-general'), 'general');
  assert.equal(parseTabKeyFromPaneId('rc-tabs-1-panel-documents'), 'documents');
});

test('parseTabKeyFromPaneId uses the FIRST "-panel-" marker so a key containing "-panel-" resolves in full', () => {
  assert.equal(parseTabKeyFromPaneId('rc-tabs-0-panel-my-panel-section'), 'my-panel-section');
});

test('parseTabKeyFromPaneId returns null for ids that are not rc-tabs pane ids', () => {
  assert.equal(parseTabKeyFromPaneId('some-other-id'), null);
  assert.equal(parseTabKeyFromPaneId(''), null);
  assert.equal(parseTabKeyFromPaneId(null), null);
  assert.equal(parseTabKeyFromPaneId(undefined), null);
});

/* ── PROBE_FN wiring smoke tests (source-text — same pattern layout-probe
 * .test.mjs already uses for the Task 2 defect regressions, since PROBE_FN
 * is string-serialised and can't be unit-tested for DOM behavior without a
 * browser) ──────────────────────────────────────────────────────────────── */

test('PROBE_FN is wired for tab capture: tabKey/hidden stamped, tabpanel detection present', () => {
  var src = layoutProbeModule.PROBE_FN.toString();
  assert.ok(src.includes('nearestTabPane'), 'PROBE_FN must locate the nearest role=tabpanel ancestor');
  assert.ok(src.includes("role') === 'tabpanel'"), 'PROBE_FN must detect tab panes via role="tabpanel"');
  assert.ok(src.includes('data-node-key'), 'PROBE_FN must read the nav item\'s data-node-key');
  assert.ok(src.includes('tabKey: tabKey'), 'PROBE_FN must stamp tabKey onto every node');
  assert.ok(src.includes('hidden: hiddenNow'), 'PROBE_FN must stamp a hidden flag onto every node');
  assert.ok(src.includes('parseTabKeyFromPaneId'), 'PROBE_FN must splice in the pure tabkey.mjs fallback');
});

/* ── full DOM-mock functional test ────────────────────────────────────────
 * layout-probe.js's PROBE_FN is a single string-serialised function that
 * expects to run against a live `document`/`getComputedStyle`/`window` in a
 * browser page. A real browser wasn't reachable in this environment (see
 * task-7 report), so this builds a minimal fake DOM whose SHAPE was read
 * directly from the real antd 5.27.6 / rc-tabs source in
 * shesha-framework/shesha-reactjs/node_modules (TabNode.js for the nav item,
 * TabPane.js for the pane, tabs/style/index.js for the -hidden -> display:none
 * rule) — not guessed — and executes PROBE_FN against it for real, rather
 * than only asserting on its source text. */

function buildFakeTabsDom() {
  var idSeq = 0;
  var byId = new Map();
  function el(tag, opts) {
    opts = opts || {};
    var e = {
      __id: idSeq++,
      tag: tag,
      attrs: opts.attrs || {},
      style: opts.style || {},
      rect: opts.rect || { x: 0, y: 0, width: 100, height: 30 },
      text: opts.text || '',
      children: [],
      parentElement: null,
      nodeType: 1,
      tagName: tag.toUpperCase(),
      id: (opts.attrs && opts.attrs.id) || '',
      className: (opts.attrs && opts.attrs.class) || '',
      getAttribute: function (name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      getBoundingClientRect: function () {
        var cur = this;
        while (cur) {
          if (cur.style.display === 'none') return { x: 0, y: 0, width: 0, height: 0 };
          cur = cur.parentElement;
        }
        var r = this.rect;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      get childNodes() {
        var nodes = this.children.slice();
        if (this.text) nodes.unshift({ nodeType: 3, textContent: this.text });
        return nodes;
      },
      get textContent() {
        var t = this.text || '';
        this.children.forEach(function (c) { t += (c.textContent || ''); });
        return t;
      },
      closest: function (sel) {
        var attrName = sel.replace(/^\[|\]$/g, '');
        var cur = this;
        while (cur) {
          if (cur.attrs && Object.prototype.hasOwnProperty.call(cur.attrs, attrName)) return cur;
          cur = cur.parentElement;
        }
        return null;
      }
    };
    if (opts.attrs && opts.attrs.id) byId.set(opts.attrs.id, e);
    return e;
  }
  function append(parent, child) {
    child.parentElement = parent;
    parent.children.push(child);
    return child;
  }

  // body > detailTabs(nav + content-holder[paneGeneral(active), paneDocuments(hidden)])
  //   paneGeneral contains an active field AND a nested inner Tabs (nested-tab test)
  //   paneDocuments (display:none, aria-hidden=true) still holds a real field
  var body = el('body', { rect: { x: 0, y: 0, width: 1440, height: 900 } });
  var detailTabs = el('div', { rect: { x: 40, y: 40, width: 800, height: 500 } });
  append(body, detailTabs);

  var nav = el('div');
  append(detailTabs, nav);
  ['general', 'documents'].forEach(function (key) {
    var navItem = el('div', { attrs: { 'data-node-key': key } });
    var btn = el('div', { attrs: { role: 'tab', id: 'rc-tabs-0-tab-' + key }, text: key });
    append(navItem, btn);
    append(nav, navItem);
  });

  var contentHolder = el('div');
  append(detailTabs, contentHolder);

  var paneGeneral = el('div', {
    attrs: { role: 'tabpanel', id: 'rc-tabs-0-panel-general', 'aria-labelledby': 'rc-tabs-0-tab-general', 'aria-hidden': 'false' },
    rect: { x: 40, y: 80, width: 800, height: 400 }
  });
  append(contentHolder, paneGeneral);
  var passengerName = el('input', { attrs: { 'aria-label': 'passengerName' }, rect: { x: 60, y: 100, width: 300, height: 30 } });
  append(paneGeneral, passengerName);

  var paneDocuments = el('div', {
    attrs: { role: 'tabpanel', id: 'rc-tabs-0-panel-documents', 'aria-labelledby': 'rc-tabs-0-tab-documents', 'aria-hidden': 'true' },
    style: { display: 'none' },
    rect: { x: 40, y: 80, width: 800, height: 400 }
  });
  append(contentHolder, paneDocuments);
  var attachments = el('div', { attrs: { 'aria-label': 'attachments' }, rect: { x: 60, y: 100, width: 300, height: 30 } });
  append(paneDocuments, attachments);

  // nested tabs, inside the ACTIVE general pane: nearest ancestor should win
  var innerTabs = el('div');
  append(paneGeneral, innerTabs);
  var innerContentHolder = el('div');
  append(innerTabs, innerContentHolder);
  var innerPaneA = el('div', {
    attrs: { role: 'tabpanel', id: 'rc-tabs-1-panel-inner-a', 'aria-labelledby': 'rc-tabs-1-tab-inner-a', 'aria-hidden': 'false' },
    rect: { x: 60, y: 200, width: 700, height: 150 }
  });
  append(innerContentHolder, innerPaneA);
  var innerNav = el('div');
  append(innerTabs, innerNav);
  var innerNavItem = el('div', { attrs: { 'data-node-key': 'inner-a' } });
  var innerBtn = el('div', { attrs: { role: 'tab', id: 'rc-tabs-1-tab-inner-a' }, text: 'Inner A' });
  append(innerNavItem, innerBtn);
  append(innerNav, innerNavItem);
  var nestedField = el('input', { attrs: { 'aria-label': 'nestedField' }, rect: { x: 80, y: 220, width: 200, height: 30 } });
  append(innerPaneA, nestedField);

  // a plain field with no tabs involved at all
  var untabbed = el('input', { attrs: { 'aria-label': 'untabbed' }, rect: { x: 0, y: 700, width: 100, height: 30 } });
  append(body, untabbed);

  return { body: body, byId: byId };
}

function withFakeBrowserGlobals(dom, fn) {
  var saved = { document: global.document, window: global.window, getComputedStyle: global.getComputedStyle, CSS: global.CSS, location: global.location };
  global.document = {
    querySelector: function (sel) { return sel === 'body' ? dom.body : null; },
    getElementById: function (id) { return dom.byId.get(id) || null; },
    title: 'sanity'
  };
  global.window = { innerWidth: 1440, innerHeight: 900, CSS: { escape: function (s) { return s; } } };
  global.CSS = { escape: function (s) { return s; } };
  global.getComputedStyle = function (e) {
    return Object.assign({ display: 'block', visibility: 'visible', opacity: '1', flexDirection: 'row', gridTemplateColumns: '' }, e.style);
  };
  global.location = { href: 'http://sanity.test' };
  try {
    return fn();
  } finally {
    global.document = saved.document;
    global.window = saved.window;
    global.getComputedStyle = saved.getComputedStyle;
    global.CSS = saved.CSS;
    global.location = saved.location;
  }
}

function nodeByLabel(probe, label) {
  return probe.nodes.find(function (n) { return n.label === label; });
}

test('PROBE_FN captures tabKey for a node under the active pane', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var passengerName = nodeByLabel(probe, 'passengerName');
  assert.ok(passengerName, 'expected a captured node labelled passengerName');
  assert.equal(passengerName.tabKey, 'general');
  assert.equal(passengerName.hidden, false);
});

test('PROBE_FN still captures nodes inside an inactive-but-mounted (display:none) tab pane, flagged hidden', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var attachments = nodeByLabel(probe, 'attachments');
  assert.ok(attachments, 'expected the hidden pane\'s child to still be captured, not silently dropped');
  assert.equal(attachments.tabKey, 'documents');
  assert.equal(attachments.hidden, true);
});

test('PROBE_FN resolves nested tabs to the NEAREST tab-pane ancestor, not the outer one', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var nestedField = nodeByLabel(probe, 'nestedField');
  assert.ok(nestedField);
  assert.equal(nestedField.tabKey, 'inner-a', 'nested field must resolve to the inner tab, not "general"');
});

test('PROBE_FN leaves tabKey null for a node with no enclosing tabs', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var untabbed = nodeByLabel(probe, 'untabbed');
  assert.ok(untabbed);
  assert.equal(untabbed.tabKey, null);
});

/* ── end-to-end: tab() evaluated against a REAL (not hand-authored) probe ── */

test('tab() assertion passes end-to-end against a real PROBE_FN capture, for both the active and the hidden pane', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var results = evaluate(['tab(passengerName, general)', 'tab(attachments, documents)', 'tab(nestedField, inner-a)'], probe);
  results.forEach(function (r) { assert.equal(r.pass, true, r.assertion + ': ' + r.message); });
});

test('tab() assertion fails end-to-end when the asserted key does not match the real capture', () => {
  var dom = buildFakeTabsDom();
  var probe = withFakeBrowserGlobals(dom, function () {
    return layoutProbeModule.PROBE_FN({ root: 'body' });
  });
  var results = evaluate(['tab(attachments, general)'], probe);
  assert.equal(results[0].pass, false);
  assert.match(results[0].message, /documents/);
});
