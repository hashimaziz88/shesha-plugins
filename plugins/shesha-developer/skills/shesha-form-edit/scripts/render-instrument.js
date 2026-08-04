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
// placement oracle and the report all consume the artifacts written here
// (screenshot + evidence.json), they do not re-drive a browser.
//
// ONE EVIDENCE FILE. The probe itself lives in
// ../../shesha-design-comprehension/scripts/layout-probe.js — the canonical
// probe module — and this script writes the canonical render-evidence document
// it defines. The former layout sidecar artifact and the second copy of the
// layout data inside the verdict were both DELETED — one probe, one evidence
// document, one shape.
//
// Artifacts per form, in <out>:
//   <module>--<name>.png                  screenshot
//   <module>--<name>.evidence.json        THE canonical render evidence (geometry,
//                                         censuses, health, console/network) —
//                                         the single input to Layer 3
//                                         (verify-placement.mjs) and Layer 4
//                                         (design-critic)
//   <module>--<name>.verdict.json         the instrument's own pass/fail summary:
//                                         { form, verdict, reasons, evidencePath, … }
//   .pw-state-<backend-host>.json         reusable Playwright storageState

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { GymApi } from './gym-lib/api.js';

// Cross-skill require of the canonical probe module (CommonJS, so `require`
// rather than `import` keeps it synchronous and format-explicit). Established
// practice here — compile-blueprint.js reaches across to validate-blueprint.mjs
// the same way.
const require_ = createRequire(import.meta.url);
const { PROBE_FN, computeHealth, finalizeEvidence } =
  require_('../../shesha-design-comprehension/scripts/layout-probe.js');

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

// ---- the canonical evidence document, with fail-closed empty defaults --------
// A probe that threw must still leave a schema-VALID document (empty, and
// therefore reported downstream as `malformed-evidence` — nothing measured)
// rather than a half-written file that reads as a placement pass.
export const EMPTY_EVIDENCE = {
  form: null,
  url: null,
  timestamp: null,
  viewport: { w: 1440, h: 900 },
  components: [],
  rowBands: [],
  columnClusters: [],
  tabMembership: null,
  controls: { total: 0, tiny: 0 },
  boundRegions: { total: 0, nonEmpty: 0 },
  actionButtonHealth: { groups: 0, collapsed: 0, stacked: 0, realButtons: 0, stackedContainers: [] },
  overflow: { x: 0, y: 0 },
  consoleErrors: [],
  networkErrors: [],
  settled: false,
  screenshotPath: null,
  health: null,
};

/**
 * Project the probe payload onto the canonical evidence document. The field
 * names are written out here on purpose: this artifact is the instrument's
 * signed output and the schema is pinned at SOURCE level against both producers
 * (tests/contract/probe-contract.contract.test.mjs). Detection logic is NOT
 * duplicated — measurement is PROBE_FN, metrics are computeHealth, and the
 * shape is enforced by finalizeEvidence, all from the one probe module.
 * @param {object} probe PROBE_FN's return value
 * @param {object} meta  { form, url, timestamp, consoleErrors, networkErrors, settled, screenshotPath }
 * @returns {{ doc: object, problems: string[] }}
 */
export function buildEvidence(probe, meta) {
  const p = probe || {};
  const comps = Array.isArray(p.components) ? p.components : [];
  return finalizeEvidence({
    form: meta.form,
    url: meta.url,
    timestamp: meta.timestamp,
    viewport: p.viewport || { w: 1440, h: 900 },
    components: comps.map((c) => ({
      name: c.name ?? null,
      type: c.type ?? null,
      id: c.id ?? null,
      parentId: c.parentId ?? null,
      rect: { x: c.rect?.x, y: c.rect?.y, w: c.rect?.w, h: c.rect?.h },
      columnIndex: c.columnIndex ?? 0,
      tabMembership: c.tabMembership ?? null,
      propertyName: c.propertyName ?? null,
      rowBand: c.rowBand ?? null,
      depth: c.depth ?? 0,
    })),
    rowBands: p.rowBands ?? EMPTY_EVIDENCE.rowBands,
    columnClusters: p.columnClusters ?? EMPTY_EVIDENCE.columnClusters,
    tabMembership: p.tabMembership ?? null,
    controls: p.controls ?? EMPTY_EVIDENCE.controls,
    boundRegions: p.boundRegions ?? EMPTY_EVIDENCE.boundRegions,
    actionButtonHealth: p.actionButtonHealth ?? EMPTY_EVIDENCE.actionButtonHealth,
    overflow: p.overflow ?? EMPTY_EVIDENCE.overflow,
    consoleErrors: meta.consoleErrors ?? [],
    networkErrors: meta.networkErrors ?? [],
    settled: meta.settled ?? false,
    screenshotPath: meta.screenshotPath ?? null,
    health: computeHealth(p),
    capturedBy: 'render-instrument',
    multiColumnContainers: p.multiColumnContainers ?? [],
  }, { lenient: true });
}


// ---- one form, one fresh page ----------------------------------------------
// A fresh page per form keeps the probe isolated (no leaked listeners, no
// carried-over console errors) while still sharing the ONE browser + ONE login.
async function verifyForm(context, spec, cfg) {
  const verdict = {
    form: spec.key,
    url: `${cfg.portal}/dynamic/${spec.module}/${spec.formName}${cfg.mode === 'edit' ? '?mode=edit' : ''}`,
    timestamp: new Date().toISOString(),
    rendered: false,
    componentCount: 0,
    consoleErrors: [],
    networkErrors: [],
    boundRegions: { total: 0, nonEmpty: 0 },
    screenshotPath: null,
    reasons: [],
    verdict: 'FAIL',
    evidence: null, // the canonical document; written to <slug>.evidence.json
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

    // ONE probe — the canonical page-context function from the probe module.
    const probe = await page.evaluate(PROBE_FN, { root: 'body', mode: 'shesha', screen: spec.key });

    const shot = path.join(cfg.outDir, `${spec.slug}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    if (fs.existsSync(shot)) verdict.screenshotPath = shot;

    const built = buildEvidence(probe, {
      form: spec.key,
      url: verdict.url,
      timestamp: verdict.timestamp,
      consoleErrors: verdict.consoleErrors,
      networkErrors: verdict.networkErrors,
      settled: verdict.settled,
      screenshotPath: verdict.screenshotPath,
    });
    verdict.evidence = built.doc;
    verdict.evidenceProblems = built.problems;

    const comps = built.doc.components;
    verdict.componentCount = comps.length;
    verdict.boundRegions = built.doc.boundRegions;
    // rendered = real form content present AND not still spinning
    verdict.rendered = comps.length > 3 && !probe.spinning && verdict.settled;

    // fail-closed judgments
    if (probe.spinning || !verdict.settled) verdict.reasons.push('page still loading (spinner visible / component count unstable at the deadline) — form did not finish rendering');
    if (!verdict.rendered && !probe.spinning) verdict.reasons.push(`only ${comps.length} components rendered — the form did not load`);
    if (!verdict.screenshotPath) verdict.reasons.push('no screenshot captured');
    if (verdict.consoleErrors.length) verdict.reasons.push(`${verdict.consoleErrors.length} console error(s)`);
    const relevant404s = verdict.networkErrors.filter((e) => !/GetChecklists|notification/i.test(e));
    if (relevant404s.length) verdict.reasons.push(`${relevant404s.length} failed request(s)`);
    if (probe.errorToast) verdict.reasons.push('error toast visible on the page');
    if (cfg.expectData && built.doc.boundRegions.total > 0 && built.doc.boundRegions.nonEmpty === 0) {
      verdict.reasons.push('binding smoke failed: every bound region is empty although the entity has data [R-034]');
    }
    // A document the placement oracle cannot measure is an INFRASTRUCTURE
    // failure of this instrument — surface it here rather than letting Layer 3
    // report it as a design mismatch.
    if (built.problems.length) verdict.reasons.push(`evidence not canonical: ${built.problems.slice(0, 3).join('; ')}`);

    // ---- layout-quality gate: RELIABLE geometry signals only, fail-closed ----
    // The detectors live in the probe module (computeHealth); this instrument only
    // decides that a health issue is a FAIL. Subtler visual quality (button style,
    // spacing rhythm, professional polish) is the design-critic's job.
    if (verdict.settled) {
      for (const issue of built.doc.health?.issues ?? []) verdict.reasons.push(`layout: ${issue}`);
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
  // ONE evidence file. `<slug>.evidence.json` IS the canonical render evidence
  // (see ../../shesha-design-comprehension/scripts/layout-probe.js) and the only
  // input Layer 3 (verify-placement.mjs) and Layer 4 (design-critic) read. The
  // former standalone layout sidecar artifact is gone.
  const evidenceFile = path.join(outDir, `${spec.slug}.evidence.json`);
  fs.writeFileSync(evidenceFile, JSON.stringify(verdict.evidence ?? EMPTY_EVIDENCE, null, 2) + '\n');

  // The verdict is the instrument's OWN pass/fail summary and carries NO second
  // copy of the layout data — it points at the evidence instead.
  const verdictFile = path.join(outDir, `${spec.slug}.verdict.json`);
  fs.writeFileSync(verdictFile, JSON.stringify({
    form: verdict.form,
    url: verdict.url,
    finalUrl: verdict.finalUrl ?? null,
    timestamp: verdict.timestamp,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    evidencePath: evidenceFile,
    screenshotPath: verdict.screenshotPath,
    settled: verdict.settled ?? false,
    rendered: verdict.rendered,
    componentCount: verdict.componentCount,
    boundRegions: verdict.boundRegions,
    consoleErrors: verdict.consoleErrors,
    networkErrors: verdict.networkErrors,
    cacheCleared: verdict.cacheCleared ?? null,
    stateReused: verdict.stateReused ?? false,
    visualCriticRequired: true,
  }, null, 2) + '\n');
  return { verdictFile, evidenceFile };
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
        // Print the SLIM verdict — never the evidence document, which lives in
        // its own file and would otherwise flood the caller's context.
        console.log(fs.readFileSync(files.verdictFile, 'utf8').trimEnd());

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
  console.log(`// artifacts in ${cfg.outDir} (.png · .evidence.json · .verdict.json per form)`);
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
