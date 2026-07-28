#!/usr/bin/env node
// Pushes gym forms to the backend and measures them in a real browser.
// Per form: navigate /dynamic/<module>/<form>, DOM-probe every gym instance
// wrapper, diff variants against the baseline, classify per-setting effect,
// screenshot once, capture console/network errors. Always continues.
//
// Usage:
//   node run-gym.js [--only textField,container] [--skip-push] [--skip-measure]
//                   [--portal http://localhost:3000] [--backend http://localhost:21021]
//                   [--headed]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GymApi } from './gym-lib/api.js';
import { probeFn, STYLE_PROPS } from './gym-lib/probe.js';
import { classify, expectTokensFor, flagContainerArtifacts } from './gym-lib/classify.js';
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
const WAIT_MS = 20000;
const RETRIES = 2;

// gym/ is generated output and is not committed — generate it first. Without this
// guard a fresh checkout fails with a bare ENOENT that reads like a broken script.
const manifestPath = path.join(GYM_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(
    `No gym manifest at ${manifestPath}.\n` +
    `gym/ is regenerated, never committed (it carries backend-specific ids). Run:\n` +
    `  node scripts/generate-component-gym.js\n` +
    `then re-run this script. Full procedure: references/gym.md.`
  );
  process.exit(1);
}
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

const api = new GymApi(BACKEND);
await api.authenticate();

/** Row count of the gym entity at measure time — recorded in matrix.provenance. */
let gymEntityRowCount = null;

// The committed manifest carries a module id from whichever backend last ran the gym.
// Trusting it (the old `if (!manifest.module.id)`) made every Create fail with
// "There is no entity Module with id = …" against any other backend — a 404 that reads
// like a broken script rather than a stale id. Always confirm the id resolves HERE, and
// re-resolve when it does not, so a committed manifest is safe to reuse.
{
  const resolved = await api.resolveModuleId(manifest.module.name);
  if (manifest.module.id && manifest.module.id !== resolved) {
    console.error(
      `module "${manifest.module.name}" is ${resolved} on this backend, not the manifest's `
      + `${manifest.module.id} — re-resolving and dropping stale per-form backendIds.`,
    );
    // Those ids belong to the other backend too; keeping them would update the wrong forms.
    for (const f of Object.values(manifest.forms ?? {})) delete f.backendId;
    for (const h of Object.values(manifest.helperForms ?? {})) delete h.backendId;
  }
  manifest.module.id = resolved;
  saveManifest();
}

// ---------------------------------------------------------------------------
// PRECONDITION: the gym entity must exist and be reachable.
//
// Every gym form binds a dataContext to GYM_ENTITY. If that entity is not registered on
// the target backend, the forms still render — so the run "succeeds" — but nothing loads,
// and every data-dependent setting measures as a no-op because it genuinely does nothing
// in that state. A run against a missing entity produced 41 confident
// `changes-geometry → no-op` flips with no warning, and a false no-op is worse than no
// measurement: validate-blocks.js downgrades hand-matrix verdicts on strong measured
// no-op evidence, so it marks working techniques dead.
//
// Measuring nothing and reporting it as measurement is the failure this refuses to commit.
{
  const ec = await api.getJson('/api/services/app/EntityConfig/GetMainDataList?maxResultCount=1000');
  const items = ec.body?.result?.items ?? ec.body?.result ?? [];
  const registered = Array.isArray(items)
    && items.some((e) => (e.fullClassName || e.className) === GYM_ENTITY);

  if (!registered) {
    console.error(
      `\nREFUSING TO MEASURE: the gym entity "${GYM_ENTITY}" is not registered on ${BACKEND}.\n\n`
      + `Every gym form binds a dataContext to it. Without it the forms still render, so the\n`
      + `run would look successful — but no data loads, and every data-dependent setting\n`
      + `measures as a no-op because it genuinely does nothing in that state. Those false\n`
      + `no-ops then overwrite real capability data and mark working techniques dead.\n\n`
      + `Fix one of:\n`
      + `  - create the entity via Skill(shesha-developer:domain-model) and seed a few rows,\n`
      + `    then rebuild + double-boot [R-040];\n`
      + `  - point --backend at an instance that has it;\n`
      + `  - change GYM_ENTITY in scripts/gym-lib/scaffolds.js to an entity this backend has\n`
      + `    (it must have rows — an empty table produces the same false no-ops).\n\n`
      + `Pass --allow-missing-entity to measure anyway, accepting that data-dependent\n`
      + `verdicts will be wrong. Do not commit the resulting matrix.`,
    );
    if (!has('--allow-missing-entity')) process.exitCode = 1;
    if (!has('--allow-missing-entity')) throw new Error('gym entity not registered');
  }

  // Row count matters as much as registration: an entity that exists but is EMPTY produces
  // the same false no-ops, because a data-dependent setting genuinely does nothing when
  // there is nothing to render. Recorded in the matrix provenance either way.
  const shortName = GYM_ENTITY.split('.').pop();
  const rows = await api.getJson(`/api/dynamic/${manifest.module.name}/${shortName}/Crud/GetAll?maxResultCount=1`);
  gymEntityRowCount = rows.body?.result?.totalCount ?? null;
  if (gymEntityRowCount === 0) {
    console.error(
      `WARNING: "${GYM_ENTITY}" is registered but has ZERO rows. Data-dependent settings will\n`
      + `measure as no-ops because they genuinely do nothing with nothing to render. Seed a few\n`
      + `rows spanning each reference-list value before trusting this matrix.`,
    );
  }
  console.error(`gym entity: ${GYM_ENTITY} registered, ${gymEntityRowCount ?? '?'} row(s)`);
}

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

// PROVENANCE. The conditions of a run change its answers, and without recording them a
// reader cannot tell a real no-op from an artifact. Two concrete cases seen on this repo:
// a run against a backend where the gym entity did not exist reported every data-dependent
// setting as no-op; and a chart whose baseline rendered a placeholder while its variants
// rendered a real chart attributed one container-level `display: block → flex` delta to all
// 18 of its settings as changes-geometry. Neither is visible from measuredAt alone.
matrix.provenance = {
  backend: BACKEND,
  portal: PORTAL,
  gymEntity: GYM_ENTITY,
  gymEntityRowCount: gymEntityRowCount,
  module: manifest.module.name,
  moduleId: manifest.module.id,
  kbGeneratedAt: (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'components-kb', '_meta.json'), 'utf8')).generated ?? null;
    } catch { return null; }
  })(),
  baselineOnly: BASELINE_ONLY,
  onlyTypes: ONLY.length ? ONLY : null,
  note: 'A no-op measured against an entity with no rows is not evidence that the setting does nothing.',
};
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

    // ---- container-level artifact detection ---------------------------------
    // classify() sees one variant at a time, so it cannot tell a per-setting effect from
    // a difference in how the component's own container happened to render. When many
    // unrelated settings produce a BYTE-IDENTICAL delta, that is one container-level
    // difference attributed to all of them, not N independent findings.
    //
    // Observed on barChart: a single `display: block → flex` (baseline rendered a
    // placeholder, variants rendered a real chart) was recorded as changes-geometry for
    // all 18 of its settings — including aggregationMethod=min, orderDirection=asc and
    // strokeWidth=17, none of which can affect display. The committed matrix carried 8
    // such clusters across 105 rows.
    //
    // These become `unknown`, which is what the matrix already means by "cannot
    // determine": something differed, but not demonstrably because of this setting.
    // Asserting changes-geometry here is a false positive that downstream tooling trusts.
    for (const c of flagContainerArtifacts(comp.settings)) {
      console.error(
        `  ${type}: ${c.keys.length} settings shared one delta ${c.delta.slice(0, 60)}… `
        + `→ recorded as unknown (container-level artifact, not ${c.was})`,
      );
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
