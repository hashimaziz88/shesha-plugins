#!/usr/bin/env node
// render-instrument.js --form <module>/<name> [--portal http://localhost:3000]
//                      [--backend http://localhost:21021] [--out <dir>]
//                      [--expect-data] [--mode edit|readonly] [--headed]
//
// The ONE scripted browser pass (L5 oracle). Fail-closed: no screenshot = FAIL,
// no rendered components = FAIL, console errors = FAIL, --expect-data with all
// bound regions empty = FAIL. Budget ~30s. JSON verdict on stdout, exit code:
// 0 PASS · 1 FAIL · 2 usage/infra.

import fs from 'node:fs';
import path from 'node:path';
import { GymApi } from './gym-lib/api.js';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const formArg = argVal('--form', null);
if (!formArg || !formArg.includes('/')) { console.error('usage: node render-instrument.js --form <module>/<name> [--portal url] [--expect-data]'); process.exit(2); }
const [module, ...nameParts] = formArg.split('/');
const formName = nameParts.join('/');
const PORTAL = argVal('--portal', 'http://localhost:3000');
const OUT_DIR = argVal('--out', path.join(process.cwd(), 'render-verdicts'));
const MODE = argVal('--mode', 'edit');
const BUDGET_MS = 30000;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright not installed — run: npm install && npx playwright install chromium'); process.exit(2); }

const api = new GymApi(argVal('--backend', 'http://localhost:21021'));
await api.authenticate();

fs.mkdirSync(OUT_DIR, { recursive: true });
const verdict = {
  form: `${module}/${formName}`,
  url: `${PORTAL}/dynamic/${module}/${formName}${MODE === 'edit' ? '?mode=edit' : ''}`,
  capturedAt: new Date().toISOString(),
  rendered: false,
  componentCount: 0,
  consoleErrors: [],
  networkErrors: [],
  boundRegions: { total: 0, nonEmpty: 0 },
  screenshot: null,
  reasons: [],
  verdict: 'FAIL',
};

const TOKEN_KEY = 'xDFcxiooPQxazdndDsdRSerWQPlincytLDCarcxVxv';
const tokenBlob = Buffer.from(JSON.stringify({
  accessToken: api.token, expireInSeconds: 86400,
  expireOn: new Date(Date.now() + 86400 * 1000).toISOString(),
})).toString('base64');

const browser = await chromium.launch({ headless: !args.includes('--headed') });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ key, blob }) => {
    try { localStorage.setItem(key, blob); } catch { /* init */ }
  }, { key: TOKEN_KEY, blob: tokenBlob });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') verdict.consoleErrors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => verdict.consoleErrors.push(`PAGEERROR: ${String(e).slice(0, 400)}`));
  page.on('response', (r) => { if (r.status() >= 400) verdict.networkErrors.push(`${r.status()} ${r.url().slice(0, 180)}`); });

  await page.goto(verdict.url, { waitUntil: 'domcontentloaded', timeout: BUDGET_MS });
  // the app header is itself a sha-form — wait for page components, not just .sha-form
  await page.waitForSelector('.sha-form', { timeout: BUDGET_MS });
  // Fail-closed against a still-loading page: wait for the page-content spinner
  // to disappear AND the component count to stabilise across two polls. A
  // freshly-created form's config cache is cold, so this can take several
  // seconds; a spinner still visible at the deadline is a FAIL, not a PASS.
  const settleDeadline = Date.now() + 20000;
  let stable = 0;
  let lastCount = -1;
  let spinnerGone = false;
  let sawControls = false;
  while (Date.now() < settleDeadline) {
    const s = await page.evaluate(() => {
      const root = document.querySelector('.sha-page-content') || document.querySelector('.sha-form') || document.body;
      return {
        count: document.querySelectorAll('[data-sha-c-id]').length,
        spinning: !!document.querySelector('.ant-spin-spinning, .sha-page-content .ant-spin'),
        // inputs/selects present = the form actually hydrated (avoids measuring a half-rendered page)
        controls: root.querySelectorAll('input,select,textarea,.ant-select,.ant-picker,button').length,
      };
    });
    spinnerGone = !s.spinning;
    if (s.controls > 0) sawControls = true;
    if (spinnerGone && sawControls && s.count === lastCount && s.count > 3) { stable++; if (stable >= 2) break; }
    else stable = 0;
    lastCount = s.count;
    await page.waitForTimeout(700);
  }
  verdict.settled = spinnerGone && stable >= 2 && sawControls;

  const probe = await page.evaluate(() => {
    const comps = [...document.querySelectorAll('[data-sha-c-id]')];
    const bound = comps.filter((el) => el.getAttribute('data-sha-c-property-name'));
    const nonEmpty = bound.filter((el) => {
      const input = el.querySelector('input,textarea,select');
      if (input && String(input.value ?? '').trim() !== '') return true;
      const txt = (el.innerText || '').replace(/^[^:]*:\s*/, '').trim(); // strip "Label:" prefix
      return txt.length > 0 && !/^:?$/.test(txt);
    });
    // ---- layout-quality metrics — scoped by the reliable data-sha-c-* markers,
    // NOT .sha-page-content (whose first match in the app shell isn't the form body).
    const vw = window.innerWidth;
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };

    // usable inputs: each bound field wrapper should hold a real-width control
    const controlEls = bound.map((w) => w.querySelector('input,textarea,select,.ant-select,.ant-picker')).filter((el) => el && vis(el));
    const tinyControls = controlEls.filter((el) => el.getBoundingClientRect().width < 60).length;

    // action buttons: scope to buttonGroup markers; an inline row has ≥1 labelled button
    const bgs = comps.filter((c) => c.getAttribute('data-sha-c-type') === 'buttonGroup');
    const isEllipsis = (t) => /^(\.\.\.|···|…|⋯)$/.test((t || '').trim());
    let realButtons = 0; let collapsedActions = 0;
    for (const bg of bgs) {
      const btns = [...bg.querySelectorAll('button')].filter(vis);
      realButtons += btns.filter((b) => b.getBoundingClientRect().width >= 40 && !isEllipsis(b.innerText) && (b.innerText || '').trim().length > 0).length;
      collapsedActions += btns.filter((b) => isEllipsis(b.innerText)).length;
    }

    // horizontal overflow: no marked component should extend past the viewport
    let maxRight = 0;
    for (const el of comps) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > maxRight) maxRight = r.right; }
    const overflowX = Math.max(0, Math.round(maxRight - vw));

    // split soundness. A Shesha container is TWO divs: the marked OUTER div is
    // never the flex box (its computed flexDirection is the default 'row'); the
    // INNER div (.sha-components-container-inner) is. Read flex from the inner div
    // and measure ITS direct children — otherwise every vertical stack looks like
    // a broken row (R-032 two-div trap).
    const rowContainers = [];
    for (const c of comps) {
      if (c.getAttribute('data-sha-c-type') !== 'container') continue;
      const inner = c.querySelector(':scope > .sha-components-container-inner') || c.querySelector('.sha-components-container-inner');
      if (!inner) continue;
      const cs = getComputedStyle(inner);
      if (cs.display !== 'flex' || cs.flexDirection !== 'row') continue; // only genuine flex-rows
      const vkids = [...inner.children].filter(vis);
      if (vkids.length < 2) continue;
      const rects = vkids.map((k) => k.getBoundingClientRect());
      const sideBySide = rects.some((a, i) => rects.slice(i + 1).some((b) => Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5 && Math.abs(a.left - b.left) > 8));

      // FILL RATIO. `sideBySide` catches a row that stacked; it does NOT catch a
      // row that split but left most of the track empty — which is what a child
      // at width:auto does (flex-basis resolves to content size, flex-grow is 0,
      // so each child hugs its label). Two fields render as two narrow stubs
      // side by side, so every existing check passes. This ratio is the only
      // signal that sees it.
      const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      const track = Math.max(1, inner.clientWidth - pad);
      const gaps = (vkids.length - 1) * (parseFloat(cs.columnGap === 'normal' ? '0' : cs.columnGap) || 0);
      const fill = Math.round(((rects.reduce((s, r) => s + r.width, 0) + gaps) / track) * 100) / 100;

      // Only a DEFAULT-packed row of container children is expected to fill. An
      // action row, or one deliberately centred / end-packed / space-between, is
      // legitimately short of the track — flagging those would be noise.
      const justify = cs.justifyContent;
      const packsFromStart = justify === 'flex-start' || justify === 'normal' || justify === 'start';
      const allContainerKids = vkids.every((k) => !k.querySelector('button') && !/button/i.test(k.getAttribute('data-sha-c-type') || ''));
      rowContainers.push({
        name: c.getAttribute('data-sha-c-name'),
        children: vkids.length,
        sideBySide,
        fill,
        fillExpected: sideBySide && packsFromStart && allContainerKids,
      });
    }

    return {
      componentCount: comps.length,
      boundTotal: bound.length,
      boundNonEmpty: nonEmpty.length,
      spinning: !!document.querySelector('.ant-spin-spinning, .sha-page-content .ant-spin'),
      errorToast: !!document.querySelector('[class*="error"] [class*="toast"], .ant-notification-notice-error'),
      layout: {
        controls: controlEls.length, tinyControls,
        realButtons, buttonGroups: bgs.length, collapsedActions,
        overflowX,
        rowsExpectedSideBySide: rowContainers.length,
        rowsThatStacked: rowContainers.filter((r) => !r.sideBySide).map((r) => r.name),
        // Always reported, so the 0.8 threshold below can be calibrated against
        // real forms rather than argued about.
        rowFill: rowContainers.filter((r) => r.fillExpected).map((r) => ({ name: r.name, fill: r.fill })),
        rowsUnderFilled: rowContainers.filter((r) => r.fillExpected && r.fill < 0.8).map((r) => `${r.name ?? 'unnamed'} @ ${Math.round(r.fill * 100)}%`),
      },
      bodySample: (document.body.innerText || '').slice(0, 200),
    };
  });

  verdict.componentCount = probe.componentCount;
  verdict.boundRegions = { total: probe.boundTotal, nonEmpty: probe.boundNonEmpty };
  verdict.layout = probe.layout;
  // rendered = real form content present AND not still spinning
  verdict.rendered = probe.componentCount > 3 && !probe.spinning && verdict.settled;

  const shot = path.join(OUT_DIR, `${module}--${formName.replace(/[^a-z0-9-]/gi, '-')}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  if (fs.existsSync(shot)) verdict.screenshot = shot;

  // fail-closed judgments
  if (probe.spinning || !verdict.settled) verdict.reasons.push('page still loading (spinner visible / component count unstable at the deadline) — form did not finish rendering');
  if (!verdict.rendered && !probe.spinning) verdict.reasons.push(`only ${probe.componentCount} components rendered — the form did not load`);
  if (!verdict.screenshot) verdict.reasons.push('no screenshot captured');
  if (verdict.consoleErrors.length) verdict.reasons.push(`${verdict.consoleErrors.length} console error(s)`);
  const relevant404s = verdict.networkErrors.filter((e) => !/GetChecklists|notification/i.test(e));
  if (relevant404s.length) verdict.reasons.push(`${relevant404s.length} failed request(s)`);
  if (probe.errorToast) verdict.reasons.push('error toast visible on the page');
  if (args.includes('--expect-data') && probe.boundTotal > 0 && probe.boundNonEmpty === 0) {
    verdict.reasons.push('binding smoke failed: every bound region is empty although the entity has data [R-034]');
  }

  // ---- layout-quality gate: RELIABLE geometry signals only, fail-closed ----
  // Subtler visual quality (button style, spacing rhythm, professional polish)
  // is the design-critic's job — mechanical DOM heuristics are too brittle for it.
  const L = probe.layout;
  if (L && verdict.settled) {
    if (L.rowsThatStacked.length) verdict.reasons.push(`layout: ${L.rowsThatStacked.length} flex-row container(s) stacked instead of splitting side-by-side (${L.rowsThatStacked.filter(Boolean).join(', ') || 'unnamed'}) [R-029]`);
    if (L.rowsUnderFilled?.length) verdict.reasons.push(`layout: ${L.rowsUnderFilled.length} flex-row(s) split but left most of the track empty — children are content-sized, not sharing the row (${L.rowsUnderFilled.join(', ')}). A row child at dimensions.width:"auto" does exactly this; give each an explicit share [R-028]`);
    if (L.controls >= 3 && L.tinyControls / L.controls > 0.34) verdict.reasons.push(`layout: ${L.tinyControls}/${L.controls} inputs are <60px wide (collapsed/unusable)`);
    if (L.overflowX > 24) verdict.reasons.push(`layout: content overflows the viewport by ${L.overflowX}px (horizontal scroll)`);
    if (L.collapsedActions > 0) verdict.reasons.push('layout: action row shows an overflow "…" instead of inline buttons (buttonGroup needs isInline:true)');
    if (L.buttonGroups > 0 && L.realButtons === 0) verdict.reasons.push('layout: a buttonGroup rendered no visible labelled button (collapsed/overflow)');
  }
  // the render-instrument proves the form LOADS + is geometrically sound; a PASS
  // here is necessary, not sufficient — the visual design-critic is the quality gate.
  verdict.visualCriticRequired = true;

  verdict.verdict = verdict.reasons.length ? 'FAIL' : 'PASS';
} catch (err) {
  verdict.reasons.push(`instrument error: ${String(err.message).slice(0, 300)}`);
  verdict.verdict = 'FAIL';
} finally {
  await browser.close();
}

const outFile = path.join(OUT_DIR, `${module}--${formName.replace(/[^a-z0-9-]/gi, '-')}.verdict.json`);
fs.writeFileSync(outFile, JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.verdict === 'PASS' ? 0 : 1);
