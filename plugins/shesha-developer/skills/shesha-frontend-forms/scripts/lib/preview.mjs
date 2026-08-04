/**
 * preview — the forward model.
 *
 * Renders a mirror-kit JSX spec headlessly to a PNG plus a geometry tree. This is the
 * whole point of the rebuild: the model writes JSX, LOOKS at the pixels, and iterates in
 * seconds, before any Shesha JSON exists. Compiling without previewing throws that away.
 *
 * It must stay fast, because it is the inner loop. No backend, no auth, no push, and no
 * Shesha bundle — only React plus the generated kit, which is a far smaller graph than the
 * ground-truth harness.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PREVIEW_EXIT = { OK: 0, JSX_INVALID: 14, NOT_IN_KIT: 15 };

export class PreviewError extends Error {
  constructor(message, exitCode, detail = null) {
    super(message);
    this.name = 'PreviewError';
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/** Raw elements and painting channels a spec may not use, with the reason. */
const FORBIDDEN_SOURCE = [
  [/<\s*(div|span|p|img|table|tbody|thead|tr|td|th)\b/, 'raw HTML elements bypass the kit and therefore bypass the compiler — use Stack, Row, Card or Text'],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML is a painting channel; layout can only be built, never painted'],
  [/\bhtmlRender\b/, 'htmlRender is a painting channel — a page faked out of html blocks is the failure this kit exists to prevent'],
  [/\bmarkdown\b/i, 'markdown is a painting channel'],
  [/style\s*=\s*\{\{/, 'an inline style prop bypasses the theme; appearance comes from emphasis/surface/role/density'],
  [/className\s*=/, 'className bypasses the theme'],
  [/#[0-9a-fA-F]{3,8}\b/, 'a hex colour literal in a spec means the theme was bypassed — every colour resolves through the active token file'],
];

/**
 * Static checks on the spec source, before esbuild.
 *
 * These run first because they produce a far better error than a bundler resolution
 * failure: naming the component and saying why it is absent is what makes the exit-15 log
 * a usable v1.1 backlog rather than a pile of module-not-found noise.
 */
export function lintSpecSource(source, kitComponents, forbiddenComponents) {
  const problems = [];

  for (const [re, why] of FORBIDDEN_SOURCE) {
    const m = source.match(re);
    if (m) problems.push({ kind: 'forbidden', found: m[0], why });
  }

  // Which kit components does the spec import?
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]@shesha-mirror\/kit['"]/g;
  const imported = [];
  let hit;
  while ((hit = importRe.exec(source))) {
    for (const part of hit[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) imported.push(name);
    }
  }
  if (imported.length === 0 && /@shesha-mirror\/kit/.test(source) === false) {
    problems.push({
      kind: 'no-kit-import',
      why: "a spec must import from '@shesha-mirror/kit'; nothing else is available to it",
    });
  }

  const notInKit = imported.filter((n) => !kitComponents.includes(n));
  for (const n of notInKit) {
    const reason = forbiddenComponents[n] || forbiddenComponents[n.toLowerCase()];
    problems.push({
      kind: 'not-in-kit',
      component: n,
      why: reason || `"${n}" is not a kit component. This is a KIT GAP — log it; do not work around it by painting. Available: ${kitComponents.join(', ')}`,
    });
  }

  // JSX element names used but never imported (a typo, or a component that does not exist).
  const usedRe = /<\s*([A-Z][A-Za-z0-9_]*)/g;
  const used = new Set();
  while ((hit = usedRe.exec(source))) used.add(hit[1]);
  for (const u of used) {
    if (u === 'React' || u === 'Fragment') continue;
    if (!imported.includes(u)) {
      problems.push({
        kind: 'not-imported',
        component: u,
        why: `<${u}> is used but not imported from '@shesha-mirror/kit'${kitComponents.includes(u) ? ' (it exists in the kit — add it to the import)' : ' and is not a kit component'}`,
      });
    }
  }

  return problems;
}

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>mock</title>
<style>
  html,body { margin:0; padding:0; }
  *, *::before, *::after { box-sizing: border-box; }
</style>
</head><body><div id="root"></div><script src="./spec.js"></script></body></html>`;

/**
 * Collect a geometry tree from the rendered mock.
 *
 * Everything comes out of ONE batched evaluate: a per-element round trip is the difference
 * between a two-second inner loop and a twenty-second one. Assertions downstream are about
 * membership, grouping and nesting — never raw pixels, because the kit renders
 * approximately while Shesha renders exactly.
 */
const GEOMETRY_FN = `() => {
  const out = [];
  const nodes = document.querySelectorAll('[data-kit]');
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.push({
      kit: el.getAttribute('data-kit'),
      sheshaType: el.getAttribute('data-shesha-type'),
      depth: (() => { let d = 0, p = el.parentElement; while (p) { if (p.hasAttribute && p.hasAttribute('data-kit')) d++; p = p.parentElement; } return d; })(),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: {
        background: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        borderRadius: cs.borderTopLeftRadius,
        borderTopWidth: cs.borderTopWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderColor: cs.borderTopColor,
        // Captured separately because the 3px LEFT accent is a distinct design element and
        // borderTopColor hides it entirely.
        borderLeftColor: cs.borderLeftColor,
        boxShadow: cs.boxShadow,
        display: cs.display,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        gap: cs.gap,
        textTransform: cs.textTransform,
        letterSpacing: cs.letterSpacing,
      },
      text: (el.textContent || '').trim().slice(0, 60),
    });
  }
  const fp = {
    fontSizes: [...new Set(out.map(o => o.style.fontSize))].sort(),
    fontWeights: [...new Set(out.map(o => o.style.fontWeight))].sort(),
    radii: [...new Set(out.map(o => o.style.borderRadius))].sort(),
    backgrounds: [...new Set(out.map(o => o.style.background))].sort(),
    colors: [...new Set(out.map(o => o.style.color))].sort(),
    gaps: [...new Set(out.map(o => o.style.gap))].filter(g => g && g !== 'normal').sort(),
    upperCaseCount: out.filter(o => o.style.textTransform === 'uppercase').length,
    pageBackground: getComputedStyle(document.body).backgroundColor,
  };
  return { nodes: out, fingerprint: fp, viewport: { w: window.innerWidth, h: window.innerHeight } };
}`;

/**
 * Bundle and render a spec.
 * Returns { pngPath, geometryPath, geometry, elapsedMs }.
 */
export async function renderPreview({
  specPath,
  kitDir,
  outDir,
  nodeModulesDir,
  viewport = { width: 1440, height: 900 },
  headless = true,
}) {
  const started = Date.now();
  const esbuild = await import('esbuild');

  const spec = resolve(specPath);
  if (!existsSync(spec)) throw new PreviewError(`no such spec: ${spec}`, PREVIEW_EXIT.JSX_INVALID);
  if (!existsSync(join(kitDir, 'index.js'))) {
    throw new PreviewError(
      `no mirror kit at ${kitDir} — run \`probe --app <path> --emit-kit\` or \`gen-kit\` first`,
      PREVIEW_EXIT.NOT_IN_KIT
    );
  }

  const source = readFileSync(spec, 'utf8');
  const manifest = JSON.parse(readFileSync(join(kitDir, 'kit-manifest.json'), 'utf8'));
  const kitComponents = manifest.components.map((c) => c.name);

  // FORBIDDEN_COMPONENTS is generated data; read it out of the emitted module text rather
  // than importing, so preview never evaluates kit code just to lint.
  let forbiddenComponents = {};
  try {
    const txt = readFileSync(join(kitDir, '_forbidden.js'), 'utf8');
    const m = txt.match(/FORBIDDEN_COMPONENTS\s*=\s*(\{[\s\S]*?\n\});/);
    if (m) forbiddenComponents = JSON.parse(m[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  } catch {
    /* linting still works without the explanations */
  }

  const problems = lintSpecSource(source, kitComponents, forbiddenComponents);
  const blocking = problems.filter((p) => p.kind === 'not-in-kit' || p.kind === 'not-imported');
  if (blocking.length) {
    throw new PreviewError(
      `the spec uses ${blocking.length} thing(s) the kit does not provide`,
      PREVIEW_EXIT.NOT_IN_KIT,
      problems
    );
  }
  if (problems.length) {
    throw new PreviewError(
      `the spec uses ${problems.length} forbidden construct(s)`,
      PREVIEW_EXIT.JSX_INVALID,
      problems
    );
  }

  mkdirSync(outDir, { recursive: true });

  // A tiny entry that mounts the spec's default export.
  const entry = join(outDir, '_entry.jsx');
  writeFileSync(
    entry,
    [
      "import React from 'react';",
      "import { createRoot } from 'react-dom/client';",
      `import Spec from ${JSON.stringify(spec.replace(/\\/g, '/'))};`,
      "createRoot(document.getElementById('root')).render(React.createElement(Spec));",
      '',
    ].join('\n'),
    'utf8'
  );

  const bundlePath = join(outDir, 'spec.js');
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile: bundlePath,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      target: 'chrome110',
      logLevel: 'silent',
      logLimit: 0,
      absWorkingDir: outDir,
      // '@shesha-mirror/kit' is the spec's only import surface.
      alias: { '@shesha-mirror/kit': join(kitDir, 'index.js') },
      // React comes from the TARGET APP's node_modules, not this skill's. Two reasons:
      // the skill only installs esbuild and playwright, and rendering the mock against the
      // same React the app runs (18.3.1) is what keeps the mock honest.
      nodePaths: nodeModulesDir ? [nodeModulesDir] : [],
    });
  } catch (e) {
    const detail = (e && e.errors ? e.errors : []).map((x) => ({
      kind: 'bundle',
      why: x.text,
      at: x.location ? `${x.location.file}:${x.location.line}:${x.location.column}` : null,
    }));
    throw new PreviewError('the spec did not bundle', PREVIEW_EXIT.JSX_INVALID, detail.length ? detail : [{ kind: 'bundle', why: (e && e.message) || String(e) }]);
  }

  writeFileSync(join(outDir, 'index.html'), PAGE_HTML, 'utf8');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));

    await page.goto(pathToFileURL(join(outDir, 'index.html')).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-kit]').length > 0, null, { timeout: 15000 }).catch(() => {});

    // A kit component that throws from allowProps surfaces here, and it must be fatal —
    // that IS the straitjacket doing its job, and a screenshot of a blank page would hide it.
    if (pageErrors.length) {
      throw new PreviewError(
        'the spec threw while rendering',
        PREVIEW_EXIT.JSX_INVALID,
        pageErrors.map((e) => ({ kind: 'runtime', why: e }))
      );
    }

    const geometry = await page.evaluate(`(${GEOMETRY_FN})()`);
    if (!geometry.nodes.length) {
      throw new PreviewError(
        'the spec rendered nothing — no kit components appeared in the DOM',
        PREVIEW_EXIT.JSX_INVALID,
        [{ kind: 'runtime', why: 'zero [data-kit] elements' }]
      );
    }

    const pngPath = join(outDir, 'mock.png');
    await page.screenshot({ path: pngPath, fullPage: true });

    const geometryPath = join(outDir, 'mock-geometry.json');
    const payload = {
      spec,
      theme: manifest.theme,
      frameworkVersion: manifest.frameworkVersion,
      viewport,
      consoleErrors,
      ...geometry,
    };
    writeFileSync(geometryPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    return { pngPath, geometryPath, geometry: payload, elapsedMs: Date.now() - started };
  } finally {
    await browser.close().catch(() => {});
  }
}
