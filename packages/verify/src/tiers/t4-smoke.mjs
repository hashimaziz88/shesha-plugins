// T4 — Live smoke (§3.2.5). The tier that answers "does this screen actually work in a
// browser against a real backend", which no amount of tree analysis can answer.
//
// The split that keeps it testable with no browser: `capture()` DRIVES the page and
// records what happened; `t4Smoke()` ASSERTS over that record. The recording is the only
// part that needs Playwright and a live host, so `--selftest` proves every assertion
// against a recorded snapshot plus the stub HTTP backend, and `npm run green` never
// launches anything (§3.7: everything is testable with no backend, browser, model or
// network).
//
// Absent Playwright or `--base-url`, T4 records {"result":"notRun","reason":"..."} and
// exits 3. It never exits 0 without having run, and `notRun` is never mapped to a pass
// anywhere (§3.2.0 rule 3). T4 does not enter `result` (D-015): it needs a browser the
// reference host does not have, and a permanently amber gate is a muted gate (§1.7 T4).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 't4-smoke';
export const describe = 'render, console cleanliness, every action clicked and its consequence read from the backend, reference-list options, read-only values';

export const checks = [
  { id: 'T4.01', family: 'render', describe: 'the screen renders at the target viewport, reached the way a user reaches it' },
  { id: 'T4.02', family: 'console', describe: 'zero error-level console messages; warnings are counted and printed but never scored' },
  { id: 'T4.03', family: 'actions', describe: 'every action site in the compiled tree is clicked — an unreachable control is uninspectable, never skipped' },
  { id: 'T4.04', family: 'consequences', describe: 'each action consequence is asserted against a raw backend GET, never against a toast' },
  { id: 'T4.05', family: 'reflistOptions', describe: 'every reference-list control populates its options' },
  { id: 'T4.06', family: 'readOnlyValues', describe: 'a read-only field renders its value rather than a blank' },
];

/** Reachable, but the recording could not exercise it — the honest middle state. */
const UNREACHED = 'unreached';

/**
 * What T4 needs before it can run at all. The reason is assembled from what is actually
 * missing, so it never claims Playwright is absent on a host that has it.
 * @param {{baseUrl?:string|null, playwright?:boolean}} opts
 * @returns {{ok:boolean, reason:string}}
 */
export function t4Available(opts) {
  const missing = [];
  if (opts.playwright === false) missing.push('playwright not installed');
  if (!opts.baseUrl) missing.push('no --base-url given');
  return { ok: missing.length === 0, reason: missing.join('; ') };
}

/** True when the Playwright package resolves in this workspace. @returns {Promise<boolean>} */
export async function hasPlaywright() {
  try { await import('playwright'); return true; } catch { return false; }
}

/**
 * @typedef {{name:string, clicked?:boolean, unreachable?:string,
 *            consequence?:{kind:string, verifyUrl?:string, expect?:any}}} ActionRecord
 * @typedef {{screen:string, navigation?:{how?:string, url?:string},
 *            render?:{rootPresent?:boolean, viewport?:{w:number,h:number}},
 *            console?:{level:string, text:string}[], actionSites?:ActionRecord[],
 *            reflists?:{name:string, optionCount:number|null}[],
 *            readOnly?:{name:string, value:string|null}[]}} SmokeRecord
 */

/**
 * T4 over one recorded smoke run.
 * @param {SmokeRecord} rec
 * @param {{backendGet?: (url:string) => Promise<{status:number, body:any}>, viewport?:{w:number,h:number}}} [opts]
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function t4Smoke(rec, opts = {}) {
  const fams = families([
    { name: 'render', unit: 'screen', required: false },
    { name: 'console', unit: 'message', required: false },
    { name: 'actions', unit: 'action-site', required: false },
    { name: 'consequences', unit: 'action-site', required: false },
    { name: 'reflistOptions', unit: 'control', required: false },
    { name: 'readOnlyValues', unit: 'control', required: false },
  ]);
  const F = {
    render: fams.get('render'), console: fams.get('console'), actions: fams.get('actions'),
    consequences: fams.get('consequences'), reflistOptions: fams.get('reflistOptions'),
    readOnlyValues: fams.get('readOnlyValues'),
  };

  // ---- T4.01 the screen rendered, reached the way a user reaches it ----------
  // A pasted `?id=` is not the real route: the documented 500 on subtable Crud/Create
  // only reproduces through the row-click path, so how it was reached is part of the
  // measurement, not a detail.
  const render = rec.render || {};
  const nav = rec.navigation || {};
  const rp = F.render.pointer(`${rec.screen}#T4.01`);
  if (render.rootPresent === undefined) {
    rp.cannot('the recording captured no render observation', 'T4.01');
  } else {
    rp.assert(render.rootPresent === true && nav.how !== 'pasted-id',
      `T4.01 ${rec.screen} did not render${nav.how === 'pasted-id' ? ' and was reached by a pasted ?id=, not the real route' : ''}`);
  }

  // ---- T4.02 console is clean ------------------------------------------------
  // Warnings are counted and printed; they never affect the result.
  const msgs = Array.isArray(rec.console) ? rec.console : null;
  const cp = F.console.pointer(`${rec.screen}#T4.02`);
  if (msgs === null) {
    cp.cannot('the recording captured no console transcript', 'T4.02');
  } else {
    const errors = msgs.filter((m) => m && m.level === 'error');
    cp.assert(errors.length === 0,
      `T4.02 ${rec.screen} logged ${errors.length} console error(s): ${errors.slice(0, 3).map((m) => m.text).join(' | ')}`);
  }

  // ---- T4.03 every action site clicked; T4.04 its consequence read from the API
  // `walked` is the action sites the sidecar declares, so a control the recording could
  // not reach is uninspectable — the one thing it may never be is silently dropped.
  const sites = Array.isArray(rec.actionSites) ? rec.actionSites : [];
  for (const a of sites) {
    const ap = F.actions.pointer(`${a.name}#T4.03`);
    const qp = F.consequences.pointer(`${a.name}#T4.04`);
    if (a.unreachable) {
      ap.cannot(`action site "${a.name}" was ${UNREACHED}: ${a.unreachable}`, 'T4.03');
      qp.cannot(`no consequence to assert: "${a.name}" was never clicked`, 'T4.04');
      continue;
    }
    ap.assert(a.clicked === true, `T4.03 action site "${a.name}" was never clicked, and was not reported unreachable`);

    const c = a.consequence;
    if (!c || !c.verifyUrl) {
      qp.cannot(`consequence of "${a.name}" carries no backend verification URL; a toast is not evidence`, 'T4.04');
      continue;
    }
    // A GET with nothing to compare against confirms only that the endpoint answered.
    if (c.expect === undefined || c.expect === null) {
      qp.cannot(`consequence of "${a.name}" states no expected value, so reading ${c.verifyUrl} proves only that the endpoint replied`, 'T4.04');
      continue;
    }
    if (typeof opts.backendGet !== 'function') {
      qp.cannot('backend unavailable: no reader was supplied to fetch the consequence', 'T4.04');
      continue;
    }
    let got;
    try { got = await opts.backendGet(c.verifyUrl); } catch (e) {
      qp.cannot(`backend unavailable: ${/** @type {Error} */ (e).message.split('\n')[0]}`, 'T4.04');
      continue;
    }
    if (got.status === 401 || got.status === 403) { qp.cannot(`backend unavailable: ${got.status} on ${c.verifyUrl}`, 'T4.04'); continue; }
    if (got.status >= 500) { qp.cannot(`backend unavailable: ${got.status} on ${c.verifyUrl}`, 'T4.04'); continue; }
    const actual = got.body && typeof got.body === 'object' && 'result' in got.body ? got.body.result : got.body;
    qp.assert(actual !== null && actual !== undefined && matches(actual, c.expect),
      `T4.04 consequence of "${a.name}" is not in the backend: GET ${c.verifyUrl} returned ${JSON.stringify(actual)}, expected to contain ${JSON.stringify(c.expect)}`);
  }

  // ---- T4.05 reference-list options populate ---------------------------------
  for (const r of Array.isArray(rec.reflists) ? rec.reflists : []) {
    const p = F.reflistOptions.pointer(`${r.name}#T4.05`);
    if (r.optionCount === null || r.optionCount === undefined) p.cannot(`the recording did not open "${r.name}", so its option count is unknown`, 'T4.05');
    else p.assert(r.optionCount > 0, `T4.05 reference-list control "${r.name}" rendered ${r.optionCount} options`);
  }

  // ---- T4.06 read-only fields render values, not blanks -----------------------
  // The editMode:inherited blank-render class: the field is there, bound, and empty.
  for (const f of Array.isArray(rec.readOnly) ? rec.readOnly : []) {
    const p = F.readOnlyValues.pointer(`${f.name}#T4.06`);
    if (f.value === undefined) p.cannot(`the recording captured no rendered value for "${f.name}"`, 'T4.06');
    else p.assert(typeof f.value === 'string' && f.value.trim() !== '', `T4.06 read-only field "${f.name}" rendered blank`);
  }

  return fams.list;
}

/**
 * Shallow containment: every key of `expect` is present in `actual` with an equal value.
 * @param {any} actual @param {any} expect @returns {boolean}
 */
function matches(actual, expect) {
  if (expect === undefined || expect === null) return true;
  if (typeof expect !== 'object') return actual === expect;
  return Object.entries(expect).every(([k, v]) => JSON.stringify(/** @type {any} */ (actual)[k]) === JSON.stringify(v));
}

/**
 * Drive a live screen and return a smoke record. This is the only part that needs a
 * browser and a host; exercising it end to end is BL-033.
 * @param {{baseUrl:string, screen:string, viewport?:{w:number,h:number}}} a
 * @returns {Promise<SmokeRecord>}
 */
export async function capture(a) {
  const { chromium } = /** @type {any} */ (await import('playwright'));
  const vp = a.viewport || { w: 1440, h: 900 };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    /** @type {{level:string, text:string}[]} */
    const messages = [];
    page.on('console', (/** @type {any} */ m) => messages.push({ level: m.type(), text: String(m.text()).slice(0, 200) }));
    page.on('pageerror', (/** @type {any} */ e) => messages.push({ level: 'error', text: String(e.message).slice(0, 200) }));
    await page.goto(a.baseUrl, { waitUntil: 'networkidle' });
    // The shell redirects and then renders the configurable form; networkidle alone can
    // sample the page before a single component exists.
    await page.waitForSelector('[data-sha-c-name]', { timeout: 30000 });
    const dom = await page.evaluate(() => {
      const G = /** @type {any} */ (globalThis);
      const named = [...G.document.querySelectorAll('[data-sha-c-name]')];
      return {
        rootPresent: named.length > 0,
        sites: named.filter((/** @type {any} */ el) => el.querySelector('button,[role="button"],a[href]'))
          .map((/** @type {any} */ el) => String(el.getAttribute('data-sha-c-name'))),
      };
    });
    return {
      screen: a.screen,
      navigation: { how: 'direct-url', url: a.baseUrl },
      render: { rootPresent: dom.rootPresent, viewport: vp },
      console: messages,
      // Clicking is a state-changing act against a live system; the driver records the
      // sites it found and marks them unreached rather than inventing an outcome.
      actionSites: dom.sites.map((/** @type {string} */ n) => ({ name: n, unreachable: `${UNREACHED} by this recording: clicking is a live mutation` })),
      reflists: [],
      readOnly: [],
    };
  } finally {
    await browser.close();
  }
}

/**
 * The self-test record: a complete run in which every check has something to assert, so
 * `--selftest` exercises all six rather than the two a passive recording can reach.
 * @param {string} origin the stub backend origin
 * @returns {SmokeRecord}
 */
export function selftestRecord(origin) {
  return {
    screen: 'selftest',
    navigation: { how: 'row-click', url: `${origin}/bookings` },
    render: { rootPresent: true, viewport: { w: 1440, h: 900 } },
    console: [{ level: 'warning', text: 'antd: Menu deprecated children' }, { level: 'info', text: 'react devtools' }],
    actionSites: [
      { name: 'btnSave', clicked: true, consequence: { kind: 'save', verifyUrl: '/api/services/app/Booking/Get?id=1', expect: { reference: 'BK-1001' } } },
      { name: 'btnOpenDialog', clicked: true, consequence: { kind: 'dialog', verifyUrl: '/api/services/app/Form/Get?name=booking-create', expect: { name: 'booking-create' } } },
      { name: 'btnPrint', clicked: true, consequence: { kind: 'navigate', verifyUrl: '/api/services/app/Booking/Get?id=1', expect: { id: 1 } } },
    ],
    reflists: [{ name: 'ddlStatus', optionCount: 4 }],
    readOnly: [{ name: 'txtReference', value: 'BK-1001' }],
  };
}

export const mutations = [
  { name: 'the screen did not render', covers: ['T4.01'], expect: 'fail', expectFamily: 'render', apply: (/** @type {any} */ c) => { c.record.render = { ...c.record.render, rootPresent: false }; } },
  { name: 'the screen was reached by a pasted ?id= rather than the real route', covers: [], expect: 'fail', expectFamily: 'render', apply: (/** @type {any} */ c) => { c.record.navigation = { ...c.record.navigation, how: 'pasted-id' }; } },
  { name: 'an error-level console message', covers: ['T4.02'], expect: 'fail', expectFamily: 'console', apply: (/** @type {any} */ c) => { c.record.console.push({ level: 'error', text: 'Cannot read properties of undefined' }); } },
  { name: 'an action site that was never clicked and never reported unreachable', covers: ['T4.03'], expect: 'fail', expectFamily: 'actions', apply: (/** @type {any} */ c) => { c.record.actionSites[0].clicked = false; } },
  { name: 'a consequence the backend does not confirm', covers: ['T4.04'], expect: 'fail', expectFamily: 'consequences', apply: (/** @type {any} */ c) => { c.record.actionSites[0].consequence.expect = { reference: 'BK-9999' }; } },
  { name: 'a consequence evidenced only by a toast', covers: [], expect: 'partial', expectFamily: 'consequences', apply: (/** @type {any} */ c) => { delete c.record.actionSites[0].consequence.verifyUrl; } },
  { name: 'an action site the recording could not reach', covers: [], expect: 'partial', expectFamily: 'actions', apply: (/** @type {any} */ c) => { c.record.actionSites[2] = { name: 'btnPrint', unreachable: 'the control is behind a role the smoke account does not hold' }; } },
  { name: 'a backend that refuses the consequence read', covers: [], expect: 'partial', expectFamily: 'consequences', apply: (/** @type {any} */ c) => { c.record.actionSites[0].consequence.verifyUrl = '/denied'; } },
  { name: 'a reference-list control with no options', covers: ['T4.05'], expect: 'fail', expectFamily: 'reflistOptions', apply: (/** @type {any} */ c) => { c.record.reflists[0].optionCount = 0; } },
  { name: 'a read-only field that renders blank', covers: ['T4.06'], expect: 'fail', expectFamily: 'readOnlyValues', apply: (/** @type {any} */ c) => { c.record.readOnly[0].value = ''; } },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const at = (/** @type {string} */ f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
    // The positional record path is the first bare argument that is not itself the VALUE
    // of a preceding flag, so `--metadata x.json` never gets mistaken for the recording.
    /** @type {string|undefined} */
    let file;
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a === undefined) continue;
      if (a.startsWith('--')) { const nx = args[i + 1]; if (nx !== undefined && !nx.startsWith('--')) i += 1; continue; }
      file = a; break;
    }

    if (args.includes('--selftest')) {
      const { withStubBackend } = await import('../../test/helpers/stub-backend.mjs');
      const fams = await withStubBackend((origin, backendGet) => t4Smoke(selftestRecord(origin), { backendGet }));
      console.log(report(fams, { title: `${id} --selftest`, json }));
      return exitFor(verdictOf(fams));
    }

    if (file) {
      const rec = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(repoRoot(), file), 'utf8'));
      const fams = await t4Smoke(rec, {});
      console.log(report(fams, { title: id, json }));
      return exitFor(verdictOf(fams));
    }

    // Driving a live host is verify.mjs's job (`--tiers t4 --base-url`); this CLI asserts
    // over a recording. With everything present it still did not RUN, so it says so.
    const avail = t4Available({ baseUrl: at('--base-url') || null, playwright: await hasPlaywright() });
    const out = { result: 'notRun', reason: avail.reason || 'no smoke record given; run a live capture through verify.mjs --tiers t4 --base-url' };
    console.log(json ? JSON.stringify(out) : `t4-smoke: ${out.result} — ${out.reason}`);
    return EXIT.partial;
  }));
}
