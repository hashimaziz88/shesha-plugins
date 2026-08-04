/**
 * render — the rendered gates, against a live Shesha app.
 *
 * ONE boot, ONE login, ONE batched evaluate per form, exactly ONE screenshot per form. The
 * previous stack's browser work was killed for cost, and a per-element round trip is the
 * difference between a three-second gate and a thirty-second one.
 *
 * Everything this produces is evidence: evidence.json plus form.png per form. `verified` in
 * the ledger is unreachable without an artefact, and `rendered` is unreachable without these.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getToken } from './api.mjs';
import { CAPTURE_FN, RENDER_EXIT, runRenderedGates } from './anatomy.mjs';

export { RENDER_EXIT };

/**
 * The framework's default localStorage key for the auth token, from
 * providers/sheshaApplication/contexts.tsx. The token is stored as base64-encoded JSON,
 * which is why it cannot simply be pasted in as a bearer string.
 */
export const DEFAULT_ACCESS_TOKEN_NAME = 'xDFcxiooPQxazdndDsdRSerWQPlincytLDCarcxVxv';

export class RenderError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'RenderError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/**
 * Clear the adminportal's form caches.
 *
 * After ANY push the IndexedDB stores `form` and `form_lookup` keep serving the previous
 * markup, so a render without this measures a ghost of the last build [R-056]. It must run
 * from a NON-app page — an in-app deleteDatabase blocks silently because the app holds an
 * open connection.
 */
async function clearFormCaches(context, page, frontendUrl) {
  /**
   * After ANY push the adminportal's IndexedDB stores `form` and `form_lookup` keep serving
   * the previous markup, so a render without this measures a ghost of the last build [R-056].
   *
   * This is done over CDP rather than by evaluating in the page, because every in-page route
   * failed for a different reason: `favicon.ico` gives an image-viewer context, and a
   * deliberately non-existent path still boots the Next app shell, which then navigates and
   * destroys the execution context mid-evaluate. CDP's Storage domain acts on the ORIGIN and
   * cannot be interrupted by navigation, and it does not need the app to be unmounted.
   */
  const origin = new URL(frontendUrl).origin;
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'indexeddb,local_storage,cache_storage,websql,service_workers',
    });
    await cdp.detach().catch(() => {});
    return { ok: true, method: 'CDP Storage.clearDataForOrigin', origin };
  } catch (e) {
    // Say so rather than proceeding as if the cache were clear: a ghost render is worse than
    // a reported failure, because it looks like a successful measurement.
    return { ok: false, method: 'CDP', origin, error: (e && e.message) || String(e) };
  }
}

/** Seed the auth token so the app is logged in without driving a login form. */
async function injectAuth(page, frontendUrl, accessToken, expireOn, tokenName) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* nothing useful to do if storage is unavailable */
      }
    },
    {
      key: tokenName,
      // saveUserToken base64-encodes a {accessToken, expireInSeconds, expireOn} object.
      value: Buffer.from(JSON.stringify({ accessToken, expireInSeconds: 86400, expireOn })).toString('base64'),
    }
  );
}

/**
 * Render one or more forms and run the three rendered gates over each.
 *
 * `forms` is [{ module, name, declaredGroups?, expectStatTiles? }].
 */
export async function renderForms({
  appRoot,
  backend,
  frontendUrl,
  forms,
  theme,
  vanilla = null,
  outDir,
  viewport = { width: 1440, height: 900 },
  headless = true,
  timeoutMs = 90000,
  tokenName = DEFAULT_ACCESS_TOKEN_NAME,
  onProgress = null,
}) {
  const say = (m) => onProgress && onProgress(m);
  mkdirSync(outDir, { recursive: true });

  const accessToken = await getToken(backend, { cacheDir: join(appRoot, '.shesha') });
  const expireOn = new Date(Date.now() + 86400000).toISOString();

  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless });
  } catch (e) {
    throw new RenderError(`could not launch chromium: ${(e && e.message) || e}\n  run: npx playwright install chromium`, RENDER_EXIT.RENDER_FAILED);
  }

  const results = [];
  try {
    // ONE context, ONE login, reused across every form.
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await injectAuth(page, frontendUrl, accessToken, expireOn, tokenName);

    say('clearing the adminportal form caches [R-056]');
    const cleared = await clearFormCaches(context, page, frontendUrl);
    say(cleared.ok ? `cleared origin storage for ${cleared.origin}` : `WARNING: could not clear the form caches (${cleared.error}) — this render may be a ghost of the previous build`);

    for (const form of forms) {
      const label = `${form.module}/${form.name}`;
      const consoleErrors = [];
      const consoleWarnings = [];
      const pageErrors = [];
      const failedRequests = [];

      const onConsole = (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
        else if (m.type() === 'warning') consoleWarnings.push(m.text());
      };
      const onPageError = (e) => pageErrors.push(String((e && e.message) || e));
      const onResponse = (r) => {
        if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() });
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      const url = `${frontendUrl.replace(/\/+$/, '')}/dynamic/${encodeURIComponent(form.module)}/${encodeURIComponent(form.name)}`;
      say(`rendering ${label}`);
      let navOk = true;
      let navError = null;
      /**
       * READINESS, and why this is the most important part of the whole gate.
       *
       * The first working version waited for `.sha-page-content` and then slept 1200ms. That
       * selector belongs to the app SHELL, which renders immediately, so the gates measured a
       * loading spinner and produced six confident design failures from a blank page — one
       * font weight, no micro-labels, no surface triplet. Confident nonsense is worse than no
       * gate at all.
       *
       * So readiness means the FORM is present and the spinners are gone. If that never
       * happens, the result is RENDER_DEFERRED (exit 12) and the gates DO NOT RUN. That is
       * what exit 12 is for.
       */
      let ready = false;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        try {
          await page.waitForFunction(
            () => {
              const spinning = document.querySelectorAll('.ant-spin-spinning, .ant-skeleton-active').length;
              if (spinning > 0) return false;
              // Real form output, not the shell: a rendered component container, a table, or
              // an input. The shell provides none of these.
              const content = document.querySelectorAll(
                '.sha-components-container, .ant-table, .ant-form-item, .sha-datatable, input, .sha-component'
              ).length;
              return content > 0;
            },
            null,
            { timeout: 45000 }
          );
          ready = true;
        } catch {
          ready = false;
        }
        // Let Ant finish its own layout pass before measuring.
        if (ready) await page.waitForTimeout(1200);
      } catch (e) {
        navOk = false;
        navError = (e && e.message) || String(e);
      }

      let geometry = null;
      let captureError = null;
      if (navOk && ready) {
        try {
          geometry = await page.evaluate(`(${CAPTURE_FN})()`);
        } catch (e) {
          captureError = (e && e.message) || String(e);
        }
      }

      // EXACTLY ONE screenshot per form. No screenshot means FAIL, never "probably fine".
      const pngPath = join(outDir, `${form.module}.${form.name}.png`);
      let shotOk = true;
      try {
        await page.screenshot({ path: pngPath, fullPage: true });
      } catch {
        shotOk = false;
      }

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);

      let gates = null;
      let exitCode = RENDER_EXIT.OK;
      if (!navOk) {
        exitCode = RENDER_EXIT.RENDER_FAILED;
      } else if (!ready) {
        // The page loaded but the form never finished rendering. Reporting design failures
        // from a spinner is the worst outcome available, so the gates are skipped and this is
        // reported as DEFERRED, not as a pass and not as a design verdict.
        exitCode = RENDER_EXIT.RENDER_DEFERRED;
      } else if (!geometry || !shotOk) {
        exitCode = RENDER_EXIT.RENDER_FAILED;
      } else {
        gates = runRenderedGates({
          fingerprint: geometry.fingerprint,
          vanilla,
          theme,
          geometry,
          consoleErrors: [...consoleErrors, ...pageErrors],
          declaredGroups: form.declaredGroups ?? 1,
          expectStatTiles: !!form.expectStatTiles,
          expectBand: !!form.expectBand,
          expectSurface: !!form.expectSurface,
          enforceRhythm: !!form.enforceRhythm,
        });
        exitCode = gates.exitCode;
      }

      const evidence = {
        form: label,
        url,
        renderedAt: new Date().toISOString(),
        viewport,
        theme: theme.name,
        navOk,
        ready,
        navError,
        captureError,
        screenshot: shotOk ? pngPath : null,
        consoleErrors,
        consoleWarnings: consoleWarnings.slice(0, 20),
        pageErrors,
        failedRequests,
        nodeCount: geometry ? geometry.nodes.length : 0,
        fingerprint: geometry ? geometry.fingerprint : null,
        gaps: geometry ? geometry.gaps : null,
        gates: gates
          ? {
              pass: gates.pass,
              exitCode: gates.exitCode,
              capVerdict: gates.capVerdict,
              capReason: gates.capReason,
              checked: gates.checked,
              failures: gates.failures,
            }
          : null,
        exitCode,
      };
      const evidencePath = join(outDir, `${form.module}.${form.name}.evidence.json`);
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

      results.push({ ...evidence, evidencePath });
    }

    await context.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

/**
 * smoke — post-push binding check.
 *
 * Aimed squarely at the 7.2 correctness dimension: BINDINGS, not styling, are the dominant
 * interactive failure. A table can render headers and a correct pager count with every cell
 * blank, which looks like a styling problem and is not [R-004].
 */
export async function smokeForm({
  appRoot,
  backend,
  frontendUrl,
  form,
  outDir,
  expectedBindings = [],
  viewport = { width: 1440, height: 900 },
  headless = true,
  tokenName = DEFAULT_ACCESS_TOKEN_NAME,
  onProgress = null,
}) {
  const say = (m) => onProgress && onProgress(m);
  mkdirSync(outDir, { recursive: true });
  const accessToken = await getToken(backend, { cacheDir: join(appRoot, '.shesha') });
  const expireOn = new Date(Date.now() + 86400000).toISOString();

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await injectAuth(page, frontendUrl, accessToken, expireOn, tokenName);
    await clearFormCaches(context, page, frontendUrl);

    const url = `${frontendUrl.replace(/\/+$/, '')}/dynamic/${encodeURIComponent(form.module)}/${encodeURIComponent(form.name)}`;
    say(`loading ${form.module}/${form.name} for the binding smoke`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2500);

    /**
     * Read the rendered table: header captions, row count, and how many cells are non-empty.
     * A correct count with empty cells is the exact PascalCase failure, and it is invisible
     * to any offline check.
     */
    const observed = await page.evaluate(() => {
      const tables = [...document.querySelectorAll('table')];
      const out = [];
      for (const t of tables) {
        const headers = [...t.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim()).filter(Boolean);
        const rows = [...t.querySelectorAll('tbody tr')];
        const cells = rows.flatMap((r) => [...r.querySelectorAll('td')]);
        const nonEmpty = cells.filter((c) => (c.textContent || '').trim().length > 0).length;
        out.push({ headers, rowCount: rows.length, cellCount: cells.length, nonEmptyCells: nonEmpty });
      }
      const pagerText = [...document.querySelectorAll('.ant-pagination-total-text, .sha-pager, [class*="pager"]')]
        .map((e) => (e.textContent || '').trim())
        .filter(Boolean);
      const emptyMarkers = [...document.querySelectorAll('.ant-empty, .ant-empty-description')].map((e) => (e.textContent || '').trim());
      return { tables: out, pagerText, emptyMarkers };
    });

    const pngPath = join(outDir, `${form.module}.${form.name}.smoke.png`);
    await page.screenshot({ path: pngPath, fullPage: true });

    const failures = [];
    for (const t of observed.tables) {
      if (t.rowCount > 0 && t.cellCount > 0 && t.nonEmptyCells === 0) {
        failures.push(
          `a table rendered ${t.rowCount} row(s) and ${t.cellCount} cell(s) with EVERY CELL BLANK — this is the camelCase binding failure [R-004], not a styling problem`
        );
      }
      for (const want of expectedBindings) {
        if (!t.headers.some((h) => h.toLowerCase().includes(String(want).toLowerCase()))) {
          failures.push(`expected a column for "${want}" but no header matched`);
        }
      }
    }
    if (observed.tables.length === 0 && expectedBindings.length) {
      failures.push(`expected a table with ${expectedBindings.length} bound column(s) but none rendered`);
    }

    const result = {
      form: `${form.module}/${form.name}`,
      url,
      screenshot: pngPath,
      observed,
      failures,
      pass: failures.length === 0,
    };
    const p = join(outDir, `${form.module}.${form.name}.smoke.json`);
    writeFileSync(p, JSON.stringify(result, null, 2) + '\n', 'utf8');
    return { ...result, path: p };
  } finally {
    await browser.close().catch(() => {});
  }
}
