#!/usr/bin/env node
// render-instrument.js --form  <module>/<name>
//                      --forms <module>/<a>,<module>/<b>,...   (batch: ONE browser)
//                      [--portal http://localhost:3000]
//                      [--backend http://localhost:21021] [--out <dir>]
//                      [--expect-data] [--mode edit|readonly] [--headed]
//                      [--token-file <path>] [--no-state-reuse]
//
// The ONE scripted browser pass (L5 oracle). Fail-closed: no screenshot = FAIL,
// no rendered components = FAIL, console errors = FAIL, --expect-data with all
// bound regions empty = FAIL. Budget ~30s per form. JSON verdict per form on
// stdout, exit code: 0 all PASS · 1 any FAIL · 2 usage/infra.
//
// ONE BROWSER BOOT PER VERIFY CYCLE. `--forms` verifies a whole set from a
// single Chromium launch and a single login; artifacts fan out, browsers don't.
// A green verdict CLOSES browser work for that form — the design-critic, the
// placement diff and the report all consume the artifacts written here
// (screenshot, verdict.json, layout-probe.json), they do not re-drive a browser.
//
// Artifacts per form, in <out>:
//   <module>--<name>.png                  screenshot
//   <module>--<name>.verdict.json         full verdict (incl. probe.layout)
//   <module>--<name>.layout-probe.json    the layout payload on its own, so
//                                         Layer 3 (placement diff) can consume
//                                         it instead of launching a browser
//   .pw-state-<backend-host>.json         reusable Playwright storageState

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GymApi } from './gym-lib/api.js';

const BUDGET_MS = 30000;
const STATE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8h — a storageState older than this is not trusted
const TOKEN_KEY = 'xDFcxiooPQxazdndDsdRSerWQPlincytLDCarcxVxv';

export const USAGE =
  'usage: node render-instrument.js (--form <module>/<name> | --forms <module>/<a>,<module>/<b>,...) ' +
  '[--portal url] [--backend url] [--out dir] [--mode edit|readonly] [--expect-data] [--headed] ' +
  '[--token-file path] [--no-state-reuse]';

/**
 * Pure argument parsing — no I/O, no browser. Returns `{ error }` instead of
 * exiting so it stays unit-testable (tests/instrument-args.test.mjs).
 * @param {string[]} argv arguments after the script name
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const argVal = (name, dflt = null) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
  };

  if (args.includes('--help') || args.includes('-h')) return { help: true };

  const specs = [];
  const seen = new Set();
  const addForm = (raw) => {
    const value = String(raw).trim();
    if (!value) return null;
    if (!value.includes('/')) return `bad --form/--forms value "${value}" — expected <module>/<name>`;
    const [module, ...nameParts] = value.split('/');
    const formName = nameParts.join('/');
    if (!module || !formName) return `bad --form/--forms value "${value}" — expected <module>/<name>`;
    const key = `${module}/${formName}`;
    if (seen.has(key)) return null; // de-dupe: one boot per form, never two passes
    seen.add(key);
    specs.push({ module, formName, key, slug: `${module}--${formName.replace(/[^a-z0-9-]/gi, '-')}` });
    return null;
  };

  const formsArg = argVal('--forms');
  if (formsArg) {
    for (const piece of formsArg.split(',')) {
      const err = addForm(piece);
      if (err) return { error: err };
    }
  }
  const formArg = argVal('--form');
  if (formArg) {
    const err = addForm(formArg);
    if (err) return { error: err };
  }
  if (!specs.length) return { error: 'no form given — pass --form <module>/<name> or --forms <module>/<a>,<module>/<b>' };

  return {
    forms: specs,
    portal: (argVal('--portal', 'http://localhost:3000') || '').replace(/\/$/, ''),
    backend: argVal('--backend', 'http://localhost:21021'),
    outDir: argVal('--out', path.join(process.cwd(), 'render-verdicts')),
    mode: argVal('--mode', 'edit'),
    tokenFile: argVal('--token-file', null),
    expectData: args.includes('--expect-data'),
    headed: args.includes('--headed'),
    stateReuse: !args.includes('--no-state-reuse'),
  };
}

// ---- in-page probe (runs in the browser) -------------------------------------
/* c8 ignore start */
function pageProbe() {
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

  // stacked action buttons [R-057]: inside one action container, two sibling
  // buttons whose y-ranges are disjoint while their x-ranges overlap are on
  // separate lines — the vertical-stack failure the "…" probe above cannot see.
  // Action containers = every buttonGroup, plus any container holding ≥2 marked
  // button/buttonGroup components.
  const actionContainers = [...bgs];
  for (const c of comps) {
    if (c.getAttribute('data-sha-c-type') !== 'container') continue;
    const btnKids = [...c.querySelectorAll('[data-sha-c-type="button"], [data-sha-c-type="buttonGroup"]')];
    if (btnKids.length >= 2) actionContainers.push(c);
  }
  const stackedActionRows = [];
  for (const ac of actionContainers) {
    const btns = [...ac.querySelectorAll('button')].filter(vis)
      .filter((b) => !isEllipsis(b.innerText) && (b.innerText || '').trim().length > 0);
    if (btns.length < 2) continue;
    const rects = btns.map((b) => b.getBoundingClientRect());
    const stacked = rects.some((a, i) => rects.slice(i + 1).some((b) => {
      const yDisjoint = a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4;
      return yDisjoint && xOverlap;
    }));
    if (stacked) stackedActionRows.push(ac.getAttribute('data-sha-c-name') || ac.getAttribute('data-sha-c-id'));
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
    rowContainers.push({ name: c.getAttribute('data-sha-c-name'), children: vkids.length, sideBySide });
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
      stackedActionRows,
      overflowX,
      rowsExpectedSideBySide: rowContainers.length,
      rowsThatStacked: rowContainers.filter((r) => !r.sideBySide).map((r) => r.name),
    },
    bodySample: (document.body.innerText || '').slice(0, 200),
  };
}
/* c8 ignore stop */

// ---- one form, one fresh page ----------------------------------------------
// A fresh page per form keeps the probe isolated (no leaked listeners, no
// carried-over console errors) while still sharing the ONE browser + ONE login.
async function verifyForm(context, spec, cfg) {
  const verdict = {
    form: spec.key,
    url: `${cfg.portal}/dynamic/${spec.module}/${spec.formName}${cfg.mode === 'edit' ? '?mode=edit' : ''}`,
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
  const page = await context.newPage();
  try {
    // ---- IndexedDB form cache [R-056] — PER FORM, always ----------------------
    // A fresh Playwright context starts with an empty profile, so the first pass is
    // already clean — but in a batch run the previous form has warmed the cache, so
    // this delete is load-bearing, not decorative. Run it from /favicon.ico: an
    // in-app deleteDatabase blocks silently on the app's open connections.
    try {
      await page.goto(`${cfg.portal}/favicon.ico`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      verdict.cacheCleared = await page.evaluate(async () => {
        const drop = (name) => new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
          req.onblocked = () => resolve(false);
          setTimeout(() => resolve(false), 2000); // never hang the budget on a blocked delete
        });
        return { form: await drop('form'), form_lookup: await drop('form_lookup') };
      });
    } catch (e) {
      verdict.cacheCleared = { error: String(e.message).slice(0, 160) };
    }

    page.on('console', (m) => { if (m.type() === 'error') verdict.consoleErrors.push(m.text().slice(0, 400)); });
    page.on('pageerror', (e) => verdict.consoleErrors.push(`PAGEERROR: ${String(e).slice(0, 400)}`));
    page.on('response', (r) => { if (r.status() >= 400) verdict.networkErrors.push(`${r.status()} ${r.url().slice(0, 180)}`); });

    await page.goto(verdict.url, { waitUntil: 'domcontentloaded', timeout: BUDGET_MS });
    verdict.finalUrl = page.url(); // a bounce to /login is an auth signal, not a form bug
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

    const probe = await page.evaluate(pageProbe);

    verdict.componentCount = probe.componentCount;
    verdict.boundRegions = { total: probe.boundTotal, nonEmpty: probe.boundNonEmpty };
    verdict.layout = probe.layout;
    // rendered = real form content present AND not still spinning
    verdict.rendered = probe.componentCount > 3 && !probe.spinning && verdict.settled;

    const shot = path.join(cfg.outDir, `${spec.slug}.png`);
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
    if (cfg.expectData && probe.boundTotal > 0 && probe.boundNonEmpty === 0) {
      verdict.reasons.push('binding smoke failed: every bound region is empty although the entity has data [R-034]');
    }

    // ---- layout-quality gate: RELIABLE geometry signals only, fail-closed ----
    // Subtler visual quality (button style, spacing rhythm, professional polish)
    // is the design-critic's job — mechanical DOM heuristics are too brittle for it.
    const L = probe.layout;
    if (L && verdict.settled) {
      if (L.rowsThatStacked.length) verdict.reasons.push(`layout: ${L.rowsThatStacked.length} flex-row container(s) stacked instead of splitting side-by-side (${L.rowsThatStacked.filter(Boolean).join(', ') || 'unnamed'}) [R-029]`);
      if (L.controls >= 3 && L.tinyControls / L.controls > 0.34) verdict.reasons.push(`layout: ${L.tinyControls}/${L.controls} inputs are <60px wide (collapsed/unusable)`);
      if (L.overflowX > 24) verdict.reasons.push(`layout: content overflows the viewport by ${L.overflowX}px (horizontal scroll)`);
      if (L.collapsedActions > 0) verdict.reasons.push('layout: action row shows an overflow "…" instead of inline buttons (buttonGroup needs isInline:true)');
      if (L.buttonGroups > 0 && L.realButtons === 0) verdict.reasons.push('layout: a buttonGroup rendered no visible labelled button (collapsed/overflow)');
      if (L.stackedActionRows?.length) verdict.reasons.push(`layout: ${L.stackedActionRows.length} action container(s) render their buttons stacked vertically instead of inline (${L.stackedActionRows.filter(Boolean).join(', ') || 'unnamed'}) — buttonGroup needs isInline:true, the container a flex row [R-057]`);
    }
    // the render-instrument proves the form LOADS + is geometrically sound; a PASS
    // here is necessary, not sufficient — the visual design-critic is the quality gate.
    verdict.visualCriticRequired = true;

    verdict.verdict = verdict.reasons.length ? 'FAIL' : 'PASS';
  } catch (err) {
    verdict.reasons.push(`instrument error: ${String(err.message).slice(0, 300)}`);
    verdict.verdict = 'FAIL';
  } finally {
    await page.close().catch(() => { /* already gone */ });
  }
  return verdict;
}

// A verdict that failed because the session wasn't authenticated, rather than
// because the form is broken: the app bounced us to login / the API said 401.
function looksLikeAuthFailure(verdict) {
  if (verdict.verdict === 'PASS') return false;
  if (verdict.networkErrors.some((e) => /^(401|403)\b/.test(e))) return true;
  return /\/login/i.test(String(verdict.finalUrl || ''));
}

function writeArtifacts(verdict, spec, outDir) {
  const verdictFile = path.join(outDir, `${spec.slug}.verdict.json`);
  fs.writeFileSync(verdictFile, JSON.stringify(verdict, null, 2) + '\n');
  // Layer 3 (placement diff) consumes THIS file instead of booting its own
  // browser — the probe payload must be a first-class artifact, not buried.
  const probeFile = path.join(outDir, `${spec.slug}.layout-probe.json`);
  fs.writeFileSync(probeFile, JSON.stringify({
    form: verdict.form,
    url: verdict.url,
    capturedAt: verdict.capturedAt,
    viewport: { width: 1440, height: 900 },
    verdict: verdict.verdict,
    settled: verdict.settled ?? false,
    componentCount: verdict.componentCount,
    boundRegions: verdict.boundRegions,
    layout: verdict.layout ?? null,
  }, null, 2) + '\n');
  return { verdictFile, probeFile };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { console.log(USAGE); process.exit(0); }
  if (cfg.error) { console.error(`${cfg.error}\n${USAGE}`); process.exit(2); }

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('playwright not installed — run: npm install && npx playwright install chromium'); process.exit(2); }

  const api = new GymApi(cfg.backend, { tokenFile: cfg.tokenFile });
  await api.authenticate();

  fs.mkdirSync(cfg.outDir, { recursive: true });

  const tokenBlob = Buffer.from(JSON.stringify({
    accessToken: api.token, expireInSeconds: 86400,
    expireOn: new Date(Date.now() + 86400 * 1000).toISOString(),
  })).toString('base64');

  // ---- storageState reuse -----------------------------------------------------
  // Logging in is the same cost every run; the session cookie/localStorage is not.
  // Persist it next to the artifacts, keyed by backend host, and reuse it while
  // fresh. The IndexedDB clear [R-056] still runs per form — the state file
  // carries auth, never a form cache.
  let backendHost = 'unknown';
  try { backendHost = new URL(cfg.backend).host.replace(/[^a-z0-9.-]/gi, '_'); } catch { /* keep default */ }
  const statePath = path.join(cfg.outDir, `.pw-state-${backendHost}.json`);
  const stateIsFresh = () => {
    if (!cfg.stateReuse) return false;
    try {
      const st = fs.statSync(statePath);
      return st.isFile() && st.size > 2 && (Date.now() - st.mtimeMs) < STATE_MAX_AGE_MS;
    } catch { return false; }
  };
  const dropState = () => { try { fs.rmSync(statePath, { force: true }); } catch { /* best effort */ } };

  const browser = await chromium.launch({ headless: !cfg.headed });
  const results = [];
  let reusedState = stateIsFresh();
  try {
    const openContext = async (fromState) => {
      const opts = { viewport: { width: 1440, height: 900 } };
      if (fromState) opts.storageState = statePath;
      const ctx = await browser.newContext(opts);
      if (!fromState) {
        await ctx.addInitScript(({ key, blob }) => {
          try { localStorage.setItem(key, blob); } catch { /* init */ }
        }, { key: TOKEN_KEY, blob: tokenBlob });
      }
      return ctx;
    };

    let context;
    try {
      context = await openContext(reusedState);
    } catch (e) {
      // unreadable/corrupt state file — throw it away and authenticate normally
      console.error(`storageState unusable (${String(e.message).slice(0, 120)}) — falling back to token injection`);
      dropState();
      reusedState = false;
      context = await openContext(false);
    }

    try {
      for (let i = 0; i < cfg.forms.length; i++) {
        const spec = cfg.forms[i];
        let verdict = await verifyForm(context, spec, cfg);

        // A reused state that has actually expired presents as an auth failure on
        // the FIRST form. Delete it, re-open with token injection, and retry that
        // form once — one extra page, still one browser.
        if (reusedState && i === 0 && looksLikeAuthFailure(verdict)) {
          console.error('reused storageState looks expired (401/403 or login redirect) — re-authenticating');
          dropState();
          reusedState = false;
          await context.close().catch(() => { /* ignore */ });
          context = await openContext(false);
          verdict = await verifyForm(context, spec, cfg);
        }

        verdict.stateReused = reusedState;
        const files = writeArtifacts(verdict, spec, cfg.outDir);
        results.push({ spec, verdict, files });
        console.log(JSON.stringify(verdict, null, 2));

        // Save the freshly-authenticated state once, after the first form has
        // exercised the app (so localStorage is populated for the portal origin).
        if (!reusedState && i === 0) {
          try { await context.storageState({ path: statePath }); }
          catch (e) { console.error(`could not persist storageState: ${String(e.message).slice(0, 120)}`); }
        }
      }
    } finally {
      await context.close().catch(() => { /* ignore */ });
    }
  } finally {
    await browser.close();
  }

  // ---- per-form summary -------------------------------------------------------
  const failures = results.filter((r) => r.verdict.verdict !== 'PASS');
  const nameW = Math.max(4, ...results.map((r) => r.verdict.form.length));
  console.log('');
  console.log(`// render-instrument summary — 1 browser boot, ${results.length} form(s)`);
  console.log(`${'FORM'.padEnd(nameW)}  VERDICT  COMPS  REASONS`);
  for (const r of results) {
    const v = r.verdict;
    console.log(`${v.form.padEnd(nameW)}  ${v.verdict.padEnd(7)}  ${String(v.componentCount).padStart(5)}  ${v.reasons.length ? v.reasons[0].slice(0, 90) : '-'}`);
  }
  console.log(`// artifacts in ${cfg.outDir} (.png · .verdict.json · .layout-probe.json per form)`);
  console.log(`// ${results.length - failures.length}/${results.length} PASS${reusedState ? ' · storageState reused' : ''}`);
  // For a HUMAN repeating this check in their own browser: the same clear, by hand [R-056].
  console.log([
    '',
    `// manual re-check — run ON ${cfg.portal}/favicon.ico (NOT in the app: deleteDatabase blocks) [R-056]`,
    "indexedDB.deleteDatabase('form'); indexedDB.deleteDatabase('form_lookup');",
    ...results.map((r) => `// then open ${r.verdict.url} and hard-reload`),
  ].join('\n'));

  process.exit(failures.length ? 1 : 0);
}

// Only run when executed directly — importing this module (tests) must not boot
// a browser.
const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) await main();
