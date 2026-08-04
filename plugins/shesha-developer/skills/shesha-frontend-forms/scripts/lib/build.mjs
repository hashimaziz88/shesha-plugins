/**
 * build — the supervisor.
 *
 * Drives the pipeline across several screens from a manifest. It owns NO new opinions: it calls
 * the same compileSpec / runGates / pushForm / renderForms every subcommand calls, so a screen
 * built here is indistinguishable from one built by hand. A supervisor that validated differently
 * from `check` would be a second, quieter set of rules.
 *
 * THE ONE STRUCTURAL DECISION, and it is deliberate: OFFLINE GATES FOR EVERY SCREEN COMPLETE
 * BEFORE ANY PUSH HAPPENS.
 *
 * The obvious implementation walks each screen through the whole pipeline in turn. That means a
 * typo in screen four is discovered after screens one to three are already deployed, leaving a
 * half-built fleet that neither matches the manifest nor the previous state — and the operator
 * has to work out which half. Compiling and checking everything first costs a few seconds and
 * makes the write phase all-or-nothing at the point where it is still free to abort.
 *
 * Once pushing starts, failures no longer abort the run: screen two being un-renderable does not
 * make screen three's deployment wrong, and stopping there would strand the fleet in exactly the
 * state the barrier exists to prevent. Every screen's outcome is reported.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { COMPILE_EXIT, CompileError, compileSpec } from './compile.mjs';
import { normaliseMarkup, runGates } from './gates.mjs';
import { PUSH_EXIT, PushError, pushForm } from './push.mjs';
import { RENDER_EXIT, RenderError, renderForms } from './render.mjs';
import { record, newRunId } from './ledger.mjs';

export const BUILD_EXIT = {
  OK: 0,
  MANIFEST_INVALID: 6,
  OFFLINE_GATES: 1,
  PUSH_FAILED: 8,
  RENDER_FAILED: 11,
};

export class BuildError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'BuildError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/**
 * Read and validate a manifest.
 *
 * Validation is strict and up front, because the whole point of the barrier is to fail before
 * touching the backend. A manifest that names a spec which does not exist must not get as far as
 * compiling screen one.
 */
export function loadManifest(manifestPath) {
  const p = resolve(manifestPath);
  if (!existsSync(p)) {
    throw new BuildError(`no manifest at ${p}`, BUILD_EXIT.MANIFEST_INVALID);
  }
  let doc;
  try {
    const raw = readFileSync(p, 'utf8');
    doc = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    throw new BuildError(`the manifest is not valid JSON: ${(e && e.message) || e}`, BUILD_EXIT.MANIFEST_INVALID);
  }

  const screens = Array.isArray(doc) ? doc : doc.screens;
  if (!Array.isArray(screens) || screens.length === 0) {
    throw new BuildError('the manifest has no `screens` array', BUILD_EXIT.MANIFEST_INVALID);
  }

  const problems = [];
  const seen = new Set();
  const base = dirname(p);
  const resolved = screens.map((s, i) => {
    const where = `screens[${i}]`;
    if (!s || typeof s !== 'object') {
      problems.push(`${where} is not an object`);
      return null;
    }
    for (const key of ['module', 'name', 'spec']) {
      if (typeof s[key] !== 'string' || !s[key]) problems.push(`${where}.${key} is required`);
    }
    const form = `${s.module}/${s.name}`;
    if (seen.has(form)) problems.push(`${where} repeats ${form} — two screens cannot share one form`);
    seen.add(form);

    // Spec paths are relative to the MANIFEST, not the cwd: a manifest should be movable with
    // its specs and still work.
    const specPath = s.spec && (isAbsolute(s.spec) ? s.spec : join(base, s.spec));
    if (specPath && !existsSync(specPath)) problems.push(`${where}.spec does not exist: ${specPath}`);

    return { ...s, form, specPath };
  });

  if (problems.length) {
    throw new BuildError(`the manifest is invalid:\n  - ${problems.join('\n  - ')}`, BUILD_EXIT.MANIFEST_INVALID);
  }
  return { path: p, theme: doc.theme || 'shesha', screens: resolved };
}

/**
 * PHASE ONE — compile and gate every screen. Nothing is written to the backend here.
 */
export async function buildOffline({
  manifest,
  appRoot,
  groundTruth,
  kitDirFor,
  nodeModulesDir,
  outDir,
  // The SAME context builder `check` and `compile` use. Passed in rather than reconstructed,
  // because a supervisor that assembled its own ctx would gate on different facts — most
  // visibly the live metadata the bindings gate needs, whose absence turns failures into skips.
  makeCtx,
  onProgress = null,
}) {
  const say = (m) => onProgress && onProgress(m);
  mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const screen of manifest.screens) {
    const themeName = screen.theme || manifest.theme;
    const file = join(outDir, `${screen.module}.${screen.name}.json`);
    const entry = { form: screen.form, screen, file, themeName };

    try {
      say(`compiling ${screen.form}`);
      const compiled = await compileSpec({
        specPath: screen.specPath,
        kitDir: kitDirFor(themeName),
        nodeModulesDir,
        groundTruth,
        themeName,
        formName: screen.form,
        tmpDir: join(outDir, '.tmp', `${screen.module}.${screen.name}`),
      });
      writeFileSync(file, JSON.stringify(compiled.markup, null, 2) + '\n', 'utf8');

      const { doc, error } = normaliseMarkup(compiled.markup);
      if (error || !doc) throw new BuildError(`compiled output is not markup: ${error}`, BUILD_EXIT.OFFLINE_GATES);

      const report = runGates(doc, makeCtx(doc, screen.form), {
        skipReason: 'build gates offline; push runs the full chain including round-trip',
      });
      entry.archetype = compiled.report ? compiled.report.archetype : null;
      entry.failures = report.failures.map((f) => ({ gate: f.gate, ruleId: f.ruleId || null, message: f.message }));
      entry.warnings = report.warnings.length;
      entry.ok = report.failures.length === 0;
      say(entry.ok ? `  ${screen.form}: gates clean` : `  ${screen.form}: ${entry.failures.length} failure(s)`);
    } catch (e) {
      // A compile that throws is reported as this screen's failure rather than aborting the
      // sweep: the operator wants every broken screen in one pass, not the first one.
      entry.ok = false;
      entry.failures = [
        {
          gate: e instanceof CompileError ? 'compile' : 'build',
          ruleId: null,
          message: (e && e.message) || String(e),
          exitCode: e && e.exitCode ? e.exitCode : COMPILE_EXIT.SPEC_INVALID,
        },
      ];
      say(`  ${screen.form}: ${entry.failures[0].message}`);
    }
    results.push(entry);
  }

  return results;
}

/**
 * PHASE TWO — push, then render. Only reached when EVERY screen passed phase one.
 */
export async function buildOnline({
  offline,
  appRoot,
  backend,
  frontendUrl,
  groundTruth,
  theme,
  vanilla,
  pushDir,
  renderDir,
  render = true,
  onProgress = null,
}) {
  const say = (m) => onProgress && onProgress(m);
  const runId = newRunId();

  for (const entry of offline) {
    try {
      say(`pushing ${entry.form}`);
      const res = await pushForm({
        appRoot,
        backend,
        file: entry.file,
        formModule: entry.screen.module,
        formName: entry.screen.name,
        groundTruth,
        ctx: { registry: groundTruth.registry, formName: entry.screen.name },
        outDir: pushDir,
      });
      entry.pushed = !!res.verified;
      entry.pushDiff = res.differences || 0;
      if (!entry.pushed) entry.pushError = `re-fetch diff reported ${entry.pushDiff} difference(s)`;
    } catch (e) {
      entry.pushed = false;
      entry.pushError = (e && e.message) || String(e);
      entry.pushExit = e instanceof PushError ? e.exitCode : PUSH_EXIT.HTTP;
      say(`  ${entry.form}: push failed — ${entry.pushError}`);
    }
  }

  if (!render) return offline;

  // ONE browser for every screen. renderForms already reuses a single context and login, so the
  // whole fleet is rendered in one boot rather than one boot per screen.
  const renderable = offline.filter((e) => e.pushed);
  if (renderable.length) {
    try {
      const results = await renderForms({
        appRoot,
        backend,
        frontendUrl,
        forms: renderable.map((e) => ({
          module: e.screen.module,
          name: e.screen.name,
          declaredGroups: e.screen.groups || 1,
          expectStatTiles: !!e.screen.expectStatTiles,
          expectBand: !!e.screen.expectBand,
          expectSurface: !!e.screen.expectSurface,
          enforceRhythm: !!e.screen.enforceRhythm,
        })),
        theme,
        vanilla,
        outDir: renderDir,
        onProgress: (m) => say(`render: ${m}`),
      });
      for (const r of results) {
        const entry = renderable.find((e) => e.form === r.form);
        if (!entry) continue;
        entry.rendered = r.exitCode === 0;
        entry.renderExit = r.exitCode;
        entry.screenshot = r.screenshot || null;
        entry.renderFailures = r.gates ? r.gates.failures || [] : [];
      }
    } catch (e) {
      for (const entry of renderable) {
        if (entry.rendered === undefined) {
          entry.rendered = false;
          entry.renderExit = e instanceof RenderError ? e.exitCode : RENDER_EXIT.RENDER_FAILED;
          entry.renderError = (e && e.message) || String(e);
        }
      }
      say(`render: ${(e && e.message) || e}`);
    }
  }

  // The ledger records the FLEET, not just the screens that worked, so a partial build is
  // legible afterwards instead of looking like a clean run that covered fewer screens.
  for (const entry of offline) {
    if (!entry.pushed || !entry.screenshot) continue;
    try {
      record(appRoot, {
        runId,
        form: entry.form,
        status: entry.rendered ? 'rendered' : 'pushed',
        evidence: entry.screenshot,
      });
    } catch {
      // record() refuses a status whose artefact is missing. That refusal is correct and is not
      // the build's failure to report.
    }
  }

  return offline;
}

/** The worst outcome across the fleet, as one exit code. */
export function summariseBuild(entries, { pushed = true } = {}) {
  const offlineFailed = entries.filter((e) => !e.ok);
  if (offlineFailed.length) {
    return {
      exitCode: BUILD_EXIT.OFFLINE_GATES,
      ok: false,
      phase: 'offline',
      counts: { total: entries.length, offlineFailed: offlineFailed.length },
      why: `${offlineFailed.length} of ${entries.length} screen(s) failed their offline gates — nothing was pushed`,
    };
  }
  if (!pushed) {
    return {
      exitCode: BUILD_EXIT.OK,
      ok: true,
      phase: 'offline',
      counts: { total: entries.length, offlineFailed: 0 },
      why: `${entries.length} screen(s) compiled and passed their gates; --offline stopped before the backend`,
    };
  }

  const pushFailed = entries.filter((e) => e.pushed === false);
  const renderFailed = entries.filter((e) => e.pushed && e.rendered === false);
  const counts = {
    total: entries.length,
    pushed: entries.filter((e) => e.pushed).length,
    rendered: entries.filter((e) => e.rendered).length,
    pushFailed: pushFailed.length,
    renderFailed: renderFailed.length,
  };

  if (pushFailed.length) {
    return { exitCode: BUILD_EXIT.PUSH_FAILED, ok: false, phase: 'push', counts, why: `${pushFailed.length} screen(s) did not verify` };
  }
  if (renderFailed.length) {
    return { exitCode: BUILD_EXIT.RENDER_FAILED, ok: false, phase: 'render', counts, why: `${renderFailed.length} screen(s) failed a rendered gate` };
  }
  return { exitCode: BUILD_EXIT.OK, ok: true, phase: 'complete', counts, why: `${counts.total} screen(s) pushed, verified and rendered` };
}
