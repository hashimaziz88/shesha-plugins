/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/lib/tabkey.mjs
 *
 * Pure, dependency-free half of tab-key resolution for the layout probe
 * (../layout-probe.js). The OTHER half — walking up an element's ancestor
 * chain to find the nearest `role="tabpanel"` and reading its associated
 * nav item's `data-node-key` via `aria-labelledby` -> `getElementById` ->
 * `closest('[data-node-key]')` — needs live DOM APIs (`document`,
 * `getAttribute`, `getComputedStyle`) that don't exist outside a browser /
 * page.evaluate context, so that part is written inline in
 * layout-probe.js's PROBE_BODY (see the "tab-pane detection" section
 * there) rather than here. This module holds only the ID-string fallback,
 * which IS pure and unit-testable without a browser.
 *
 * REAL DOM SHAPE THIS TARGETS (verified against antd 5.27.6 / rc-tabs in
 * shesha-framework's node_modules — see task-7 report for how):
 *
 *   <div class="ant-tabs-tab" data-node-key="general">
 *     <div role="tab" id="rc-tabs-0-tab-general" aria-controls="rc-tabs-0-panel-general">General</div>
 *   </div>
 *   ...
 *   <div class="ant-tabs-tabpane [ant-tabs-tabpane-hidden]"
 *        role="tabpanel" id="rc-tabs-0-panel-general"
 *        aria-labelledby="rc-tabs-0-tab-general" aria-hidden="false|true">
 *     ...tab content...
 *   </div>
 *
 * (source: node_modules/rc-tabs/es/TabNavList/TabNode.js for the nav item,
 * node_modules/rc-tabs/es/TabPanelList/TabPane.js for the pane, and
 * node_modules/antd/es/tabs/style/index.js for the `-hidden { display: none }`
 * rule.) The primary resolution path (aria-labelledby -> tab id ->
 * nearest [data-node-key] ancestor) is exact and unambiguous. This
 * fallback — parsing the pane's own `id` for the `-panel-<key>` suffix
 * rc-tabs always generates — only kicks in if that primary path can't
 * resolve (e.g. a probe root that excludes the tab nav bar itself, or a
 * custom Tabs render that dropped `aria-labelledby`).
 * ───────────────────────────────────────────────────────────────────────── */

// parseTabKeyFromPaneId(id) => key string, or null if `id` doesn't look like
// an rc-tabs-generated pane id ("<tabsId>-panel-<key>"). Uses indexOf (the
// FIRST "-panel-" occurrence), not lastIndexOf: `tabsId` is rc-tabs' own
// generated/supplied id (e.g. "rc-tabs-0") and never itself contains
// "-panel-", so the first marker is always the real delimiter — taking
// everything after it as the key means a key that itself contains "-panel-"
// (unusual, but not disallowed) still resolves correctly in full.
export function parseTabKeyFromPaneId(id) {
  if (id == null) return null;
  var str = String(id);
  var marker = '-panel-';
  var idx = str.indexOf(marker);
  if (idx === -1) return null;
  return str.slice(idx + marker.length);
}
