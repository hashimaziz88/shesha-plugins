#!/usr/bin/env node
// Pushes gym forms to the backend and measures them in a real browser.
// Per form: navigate /dynamic/<module>/<form>, DOM-probe every gym instance
// wrapper, diff variants against the baseline, classify per-setting effect,
// screenshot once, capture console/network errors. Always continues.
//
// Usage:
//   node run-gym.js [--only textField,container] [--skip-push] [--skip-measure]
//                   [--portal http://localhost:3000] [--backend http://localhost:21021]
//                   [--headed] [--token-file <path>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GymApi } from './gym-lib/api.js';
import { probeFn, STYLE_PROPS } from './gym-lib/probe.js';
import { classify, expectTokensFor } from './gym-lib/classify.js';
import { GYM_ENTITY } from './gym-lib/scaffolds.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GYM_DIR = path.join(SCRIPT_DIR, '..', 'gym');
const MATRIX_FILE = path.join(SCRIPT_DIR, '..', 'assets', 'measured-capability-matrix.json');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const BACKEND = argVal('--backend', 'http://localhost:21021');
const PORTAL = argVal('--portal', 'http://localhost:3000');
const ONLY = argVal('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const TOKEN_FILE_ARG = argVal('--token-file', null);
const WAIT_MS = 20000;
const RETRIES = 2;

const manifestPath = path.join(GYM_DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Windows file writes occasionally fail transiently (AV/indexer locks) — retry.
function writeFileRetry(file, content, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.writeFileSync(file, content);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      const wait = 200 * (i + 1);
      const until = Date.now() + wait;
      while (Date.now() < until) { /* brief sync backoff */ }
    }
  }
}
const saveManifest = () => writeFileRetry(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const formNames = Object.keys(manifest.forms).sort()
  .filter((n) => !ONLY.length || ONLY.includes(manifest.forms[n].type));

// ---------------------------------------------------------------------------
// Push phase

const api = new GymApi(BACKEND, { tokenFile: TOKEN_FILE_ARG });
await api.authenticate();
if (!manifest.module.id) manifest.module.id = await api.resolveModuleId(manifest.module.name);

// --baseline-only: salvage mode for forms where a variant crashes the whole
// render — push markup stripped to validationErrors + baseline, measure that.
const BASELINE_ONLY = has('--baseline-only');
const stripToBaseline = (markupStr, type) => {
  const form = JSON.parse(markupStr);
  const root = form.components[0];
  root.components = root.components.filter(
    (c) => c.type === 'validationErrors' || c.componentName === `gym-${type}-baseline`,
  );
  return JSON.stringify(form);
};

if (!has('--skip-push')) {
  for (const [name, helper] of Object.entries(manifest.helperForms ?? {})) {
    const file = path.join(GYM_DIR, 'forms', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const { id, action } = await api.upsertForm({
      moduleName: manifest.module.name, moduleId: manifest.module.id,
      name, markup: fs.readFileSync(file, 'utf8'), modelType: GYM_ENTITY,
    });
    helper.backendId = id;
    console.log(`push helper ${name}: ${action} (${id})`);
  }
  let pushed = 0;
  for (const formName of formNames) {
    const entry = manifest.forms[formName];
    let markup = fs.readFileSync(path.join(GYM_DIR, 'forms', `${formName}.json`), 'utf8');
    if (BASELINE_ONLY) markup = stripToBaseline(markup, entry.type);
    try {
      const { id, action } = await api.upsertForm({
        moduleName: manifest.module.name, moduleId: manifest.module.id,
        name: formName, markup, modelType: GYM_ENTITY,
      });
      entry.backendId = id;
      entry.lastPushedAt = new Date().toISOString();
      pushed++;
      if (pushed % 20 === 0) console.log(`pushed ${pushed}/${formNames.length}...`);
    } catch (err) {
      entry.pushError = String(err.message).slice(0, 300);
      console.error(`push FAILED ${formName}: ${entry.pushError}`);
    }
  }
  saveManifest();
  console.log(`push phase: ${pushed}/${formNames.length} ok`);
}

if (has('--skip-measure')) process.exit(0);

// ---------------------------------------------------------------------------
// Measure phase

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright not installed — run: npm install && npx playwright install chromium');
  process.exit(2);
}

fs.mkdirSync(path.join(GYM_DIR, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(GYM_DIR, 'errors'), { recursive: true });

const matrix = fs.existsSync(MATRIX_FILE)
  ? JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8'))
  : { generation: '0.45', sheshaVersion: '0.45.0', components: {} };
matrix.measuredAt = new Date().toISOString();
const saveMatrix = () => {
  const sorted = { ...matrix, components: {} };
  for (const k of Object.keys(matrix.components).sort()) sorted.components[k] = matrix.components[k];
  writeFileRetry(MATRIX_FILE, JSON.stringify(sorted, null, 2) + '\n');
};

const browser = await chromium.launch({ headless: !has('--headed') });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// shesha-reactjs reads the token from localStorage under DEFAULT_ACCESS_TOKEN_NAME,
// stored as base64(JSON{accessToken, expireInSeconds, expireOn}).
const TOKEN_KEY = 'xDFcxiooPQxazdndDsdRSerWQPlincytLDCarcxVxv';
const tokenBlob = Buffer.from(JSON.stringify({
  accessToken: api.token,
  expireInSeconds: 86400,
  expireOn: new Date(Date.now() + 86400 * 1000).toISOString(),
})).toString('base64');
await context.addInitScript(({ key, blob }) => {
  try { localStorage.setItem(key, blob); } catch { /* cross-origin init */ }
}, { key: TOKEN_KEY, blob: tokenBlob });

const CANDIDATE_SELECTORS = [
  { selector: '[data-sha-c-name]', attr: 'data-sha-c-name' },
  { selector: '[data-sha-component-name]', attr: 'data-sha-component-name' },
  { selector: '[data-name]', attr: 'data-name' },
  { selector: '[id]', attr: 'id' },
];

// NOTE: '.sha-form' alone is not enough — the app header is itself a sha-form,
// so it matches before the page's dynamic form loads. Wait for gym markers too.
async function openForm(page, formName, waitMs = WAIT_MS) {
  const url = `${PORTAL}/dynamic/${manifest.module.name}/${formName}?mode=edit`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: waitMs });
  await page.waitForSelector('.sha-form', { timeout: waitMs }); // throws → retry loop
  if (manifest.probeConfig?.selector) {
    await page.waitForFunction(
      ({ selector, attr, prefix }) =>
        [...document.querySelectorAll(selector)].some((el) => (el.getAttribute(attr) || '').startsWith(prefix)),
      manifest.probeConfig,
      { timeout: waitMs },
    ).catch(() => {}); // some forms legitimately render nothing — probe records that
  }
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important;}' }).catch(() => {});
  await page.waitForTimeout(1500); // settle async data (reflists etc.)
}

async function discoverProbeConfig(page) {
  if (manifest.probeConfig?.selector) return manifest.probeConfig;
  // first load compiles the Next dev route — give it a bigger budget
  await openForm(page, formNames[0], 60000);
  for (const cand of CANDIDATE_SELECTORS) {
    const count = await page.waitForFunction(
      ({ selector, attr }) =>
        [...document.querySelectorAll(selector)].filter((el) => (el.getAttribute(attr) || '').startsWith('gym-')).length || false,
      cand,
      { timeout: 15000 },
    ).then((h) => h.jsonValue()).catch(() => 0);
    if (count >= 2) {
      manifest.probeConfig = { ...cand, prefix: 'gym-', discoveredAt: new Date().toISOString(), matched: count };
      saveManifest();
      console.log(`probe marker discovered: ${cand.selector} (${count} gym nodes)`);
      return manifest.probeConfig;
    }
  }
  const html = await page.evaluate(() => document.body.innerHTML.slice(0, 4000));
  console.error('MARKER DISCOVERY FAILED — no candidate selector matched gym-* wrappers.');
  console.error('First 4000 chars of body:\n' + html);
  process.exit(3);
}

const page = await context.newPage();
const probeConfig = await discoverProbeConfig(page);

let done = 0;
for (const formName of formNames) {
  const entry = manifest.forms[formName];
  const type = entry.type;
  const comp = { renderStatus: 'error', settings: {} };
  matrix.components[type] = comp;
  const errors = { console: [], network: [] };
  const onConsole = (msg) => { if (msg.type() === 'error') errors.console.push(msg.text().slice(0, 500)); };
  const onResponse = (res) => { if (res.status() >= 400) errors.network.push(`${res.status()} ${res.url().slice(0, 200)}`); };
  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    let snaps = null;
    for (let attempt = 0; attempt <= RETRIES && !snaps; attempt++) {
      try {
        await openForm(page, formName);
        snaps = await page.evaluate(probeFn, { ...probeConfig, styleProps: STYLE_PROPS });
      } catch (err) {
        if (attempt === RETRIES) throw err;
      }
    }

    const baseline = snaps[`gym-${type}-baseline`];
    const notRegistered = baseline && /not registered/i.test(baseline.text || '');
    comp.renderStatus = !baseline
      ? 'error'
      : notRegistered
        ? 'not-registered'
        : baseline.childCount > 0 ? 'renders' : 'renders-degraded';
    if (!baseline) comp.notes = 'baseline wrapper not found in DOM';
    if (notRegistered) comp.notes = 'component type not registered in this runtime — all settings unknown';

    if (BASELINE_ONLY && baseline) {
      comp.notes = 'at least one variant crashes the whole form render — baseline measured via salvage, per-setting effects unknown';
    }
    for (const inst of entry.instances) {
      if (BASELINE_ONLY) {
        if (inst.kind === 'variant') {
          comp.settings[`${inst.path}=${inst.valueKey}`] = {
            effect: 'unknown', bucket: inst.bucket,
            notes: baseline ? 'form crashes with full variant set; not individually measured' : 'form crashes even baseline-only',
          };
        }
        continue;
      }
      if (notRegistered) {
        if (inst.kind === 'variant') {
          comp.settings[`${inst.path}=${inst.valueKey}`] = { effect: 'unknown', bucket: inst.bucket, notes: 'component not registered' };
        }
        continue;
      }
      if (inst.kind !== 'variant') continue;
      const verdict = classify(baseline, snaps[inst.variantId], { expectTokens: expectTokensFor(inst.value) });
      const key = `${inst.path}=${inst.valueKey}`;
      comp.settings[key] = { effect: verdict.effect, bucket: inst.bucket };
      if (verdict.cssDelta && Object.keys(verdict.cssDelta).length) {
        const trimmed = Object.fromEntries(Object.entries(verdict.cssDelta).slice(0, 6));
        comp.settings[key].cssDelta = trimmed;
      }
      if (verdict.notes) comp.settings[key].notes = verdict.notes;
    }
    for (const nm of entry.notMeasured ?? []) {
      comp.settings[nm.path] = { effect: 'not-measured', notes: nm.reason };
    }

    await page.screenshot({ path: path.join(GYM_DIR, 'screenshots', `${formName}.png`), fullPage: false });
    entry.lastMeasuredAt = new Date().toISOString();
  } catch (err) {
    comp.notes = `measure failed: ${String(err.message).slice(0, 300)}`;
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
    if (errors.console.length || errors.network.length) {
      comp.consoleErrors = errors.console.length;
      fs.writeFileSync(path.join(GYM_DIR, 'errors', `${formName}.json`), JSON.stringify(errors, null, 2));
    }
    saveMatrix();
    done++;
    const effects = Object.values(comp.settings).reduce((acc, s) => {
      acc[s.effect] = (acc[s.effect] || 0) + 1;
      return acc;
    }, {});
    console.log(`[${done}/${formNames.length}] ${formName}: ${comp.renderStatus} ${JSON.stringify(effects)}`);
  }
}

saveManifest();
await browser.close();
console.log(`measured ${done} forms → ${MATRIX_FILE}`);
