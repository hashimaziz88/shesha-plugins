/**
 * THE ONLY FILE THAT REACHES INTO THE TARGET APP'S node_modules.
 *
 * Every fact about Shesha that a compiler, validator or generator needs comes through
 * here, derived by executing the app's own installed package. If a fact cannot be got
 * this way it is a recorded GAP, not a line of prose in a Markdown file.
 *
 * Exit-code contract (owned by shesha.mjs, raised from here as tagged errors):
 *   2  target app is not Shesha 0.45
 *   20 harness failed (esbuild or in-page evaluation)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = join(HERE, 'harness');
const REQUIRED_GENERATION = '0.45';

export class FrameworkError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'FrameworkError';
    this.exitCode = exitCode;
  }
}

/**
 * Locate the adminportal inside a Shesha app checkout. Accepts either the repo root
 * (which contains adminportal/) or the adminportal directory itself, so callers do not
 * have to know the layout.
 */
export function resolveAppPaths(appPath) {
  const root = resolve(appPath);
  if (!existsSync(root)) {
    throw new FrameworkError(`--app path does not exist: ${root}`, 2);
  }
  const candidates = [join(root, 'adminportal'), root];
  for (const dir of candidates) {
    const pkg = join(dir, 'node_modules', '@shesha-io', 'reactjs', 'package.json');
    if (existsSync(pkg)) {
      return {
        appRoot: root,
        adminportal: dir,
        packageJson: pkg,
        packageDir: dirname(pkg),
      };
    }
  }
  throw new FrameworkError(
    `Could not find @shesha-io/reactjs under ${join(root, 'adminportal', 'node_modules')} ` +
      `or ${join(root, 'node_modules')}. Is this a Shesha app, and has npm install been run?`,
    2
  );
}

/**
 * Assert the target really is 0.45 and capture a drift guard.
 *
 * The drift guard exists because everything downstream is derived from one specific
 * build of one specific bundle. If the app is upgraded under us, cached ground truth
 * silently describes a framework that is no longer installed.
 */
export function readFrameworkIdentity(paths) {
  const pkg = JSON.parse(readFileSync(paths.packageJson, 'utf8'));
  const version = pkg.version || '(none)';
  const generation = version.split('.').slice(0, 2).join('.');

  if (generation !== REQUIRED_GENERATION) {
    throw new FrameworkError(
      `This skill targets Shesha ${REQUIRED_GENERATION} only. ` +
        `${paths.adminportal} has @shesha-io/reactjs@${version} (generation ${generation}). ` +
        `Use the plugin matching that generation instead.`,
      2
    );
  }

  const esmEntry = join(paths.packageDir, pkg.module || 'dist/index.es.js');
  const cjsEntry = join(paths.packageDir, pkg.main || 'dist/index.js');
  const hashOf = (p) =>
    existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;

  return {
    package: '@shesha-io/reactjs',
    version,
    generation,
    // Recorded so later phases can detect the app being upgraded beneath cached truth.
    driftGuard: {
      moduleEntry: pkg.module || null,
      moduleSha256: hashOf(esmEntry),
      mainSha256: hashOf(cjsEntry),
    },
    declaredPeerReact: (pkg.peerDependencies && pkg.peerDependencies.react) || null,
    adminportal: paths.adminportal,
  };
}

/** Read installed versions of the peers the harness renders against. */
export function readPeerVersions(paths) {
  const read = (name) => {
    const p = join(paths.adminportal, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')).version || null;
    } catch {
      return null;
    }
  };
  return {
    react: read('react'),
    'react-dom': read('react-dom'),
    antd: read('antd'),
    next: read('next'),
    nanoid: read('nanoid'),
  };
}

/**
 * esbuild plugin stubbing what a bare registry probe must not drag in.
 *
 * Three classes, all verified against the bundle's actual import list rather than guessed:
 *
 * 1. next/* — dist/index.es.js:1 statically imports next/image, next/link and
 *    next/navigation, so they evaluate at load whether or not their code paths run.
 * 2. Next-coupled third parties — @bprogress/next and next-navigation-guard reach into
 *    next/dist internals (which is where next/dist/compiled/gzip-size, and with it the
 *    fs/zlib/stream chain, enters the graph). Neither participates in building a toolbox
 *    registry; both are navigation chrome.
 * 3. Node builtins — reached only by transitive code that never executes here. Shimmed
 *    rather than emptied where a top-level evaluation might touch them, because an empty
 *    module turns into a load-time TypeError that fails the whole bundle.
 *
 * If a stub ever matters, it surfaces as an in-page error via runHarness, which reports
 * console errors and page exceptions verbatim. Nothing fails silently.
 */
function stubPlugin() {
  const EVENTS_SHIM = `
export class EventEmitter {
  constructor(){ this._e = {}; }
  on(n,f){ (this._e[n] ||= []).push(f); return this; }
  addListener(n,f){ return this.on(n,f); }
  once(n,f){ return this.on(n,f); }
  off(){ return this; }
  removeListener(){ return this; }
  removeAllListeners(){ this._e = {}; return this; }
  emit(n,...a){ (this._e[n]||[]).forEach(f=>f(...a)); return true; }
  listeners(n){ return (this._e[n]||[]).slice(); }
  setMaxListeners(){ return this; }
}
export default EventEmitter;
EventEmitter.EventEmitter = EventEmitter;
export const once = () => Promise.resolve([]);
`;
  const STREAM_SHIM = `
import { EventEmitter } from 'events';
class Stream extends EventEmitter { pipe(d){ return d; } on(n,f){ return super.on(n,f); } }
export class Readable extends Stream { read(){ return null; } push(){ return false; } }
export class Writable extends Stream { write(){ return true; } end(){ return this; } }
export class Duplex extends Stream {}
export class Transform extends Stream {}
export class PassThrough extends Stream {}
export { Stream };
export default Stream;
Stream.Readable = Readable; Stream.Writable = Writable; Stream.Duplex = Duplex;
Stream.Transform = Transform; Stream.PassThrough = PassThrough; Stream.Stream = Stream;
`;
  const BUFFER_SHIM = `
export const Buffer = {
  isBuffer: () => false,
  from: (x) => (typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x || 0)),
  alloc: (n) => new Uint8Array(n || 0),
  concat: (a) => new Uint8Array(a && a.length ? a[0] : 0),
  byteLength: (s) => (typeof s === 'string' ? s.length : 0),
};
export default { Buffer };
export const kMaxLength = 0;
`;
  const EMPTY = 'export default {};';

  const MODULE_STUBS = {
    'next/image': 'export default function Image(){ return null }',
    'next/link': 'export default function Link(){ return null }',
    'next/navigation':
      'export function useRouter(){ return {push(){},replace(){},back(){},forward(){},refresh(){},prefetch(){}} }\n' +
      'export function usePathname(){ return "/" }\n' +
      'export function useSearchParams(){ return new URLSearchParams() }\n' +
      'export function useParams(){ return {} }\n' +
      'export function redirect(){}\n' +
      'export function notFound(){}\n' +
      'export function useSelectedLayoutSegments(){ return [] }',
    'next/router':
      'export function useRouter(){ return {push(){},replace(){},back(){},prefetch(){},query:{},pathname:"/",events:{on(){},off(){}}} }\n' +
      'export default { useRouter };',
    // Navigation chrome. These are what pull next/dist internals into the graph.
    '@bprogress/next':
      'export function useProgress(){ return {start(){},stop(){}} }\n' +
      'export const ProgressProvider = ({children}) => children ?? null;\n' +
      'export const AppProgressProvider = ({children}) => children ?? null;\n' +
      'export default { ProgressProvider, AppProgressProvider, useProgress };',
    'next-navigation-guard':
      'export const NavigationGuardProvider = ({children}) => children ?? null;\n' +
      'export function useNavigationGuard(){ return { active: false, accept(){}, reject(){} } }\n' +
      'export default { NavigationGuardProvider, useNavigationGuard };',
  };

  const BUILTIN_STUBS = {
    events: EVENTS_SHIM,
    stream: STREAM_SHIM,
    'stream/web': STREAM_SHIM,
    'readable-stream': STREAM_SHIM,
    buffer: BUFFER_SHIM,
    string_decoder:
      'export class StringDecoder { write(b){ return typeof b === "string" ? b : new TextDecoder().decode(b) } end(){ return "" } }\n' +
      'export default { StringDecoder };',
    util:
      'export function inherits(c,s){ if(s) c.prototype = Object.create(s.prototype) }\n' +
      'export function promisify(f){ return (...a) => new Promise((res,rej)=>f(...a,(e,v)=>e?rej(e):res(v))) }\n' +
      'export const types = { isDate: (v) => v instanceof Date };\n' +
      'export function format(...a){ return a.join(" ") }\n' +
      'export function deprecate(f){ return f }\n' +
      'export default { inherits, promisify, types, format, deprecate };',
    path:
      'export function join(...p){ return p.filter(Boolean).join("/") }\n' +
      'export function resolve(...p){ return p.filter(Boolean).join("/") }\n' +
      'export function dirname(p){ return String(p).split("/").slice(0,-1).join("/") }\n' +
      'export function basename(p){ return String(p).split("/").pop() }\n' +
      'export function extname(p){ const b=String(p).split("/").pop(); const i=b.lastIndexOf("."); return i<0?"":b.slice(i) }\n' +
      'export const sep = "/";\n' +
      'export default { join, resolve, dirname, basename, extname, sep };',
    fs: EMPTY,
    'fs/promises': EMPTY,
    zlib: EMPTY,
    os: 'export function platform(){ return "browser" }\nexport const EOL = "\\n";\nexport default { platform, EOL };',
    crypto: EMPTY,
    http: EMPTY,
    https: EMPTY,
    net: EMPTY,
    tls: EMPTY,
    dns: EMPTY,
    child_process: EMPTY,
    worker_threads: EMPTY,
    perf_hooks: 'export const performance = globalThis.performance;\nexport default { performance };',
    assert: 'function assert(){}\nassert.ok = () => {};\nassert.equal = () => {};\nexport default assert;',
    querystring:
      'export function parse(s){ return Object.fromEntries(new URLSearchParams(s)) }\n' +
      'export function stringify(o){ return new URLSearchParams(o).toString() }\n' +
      'export default { parse, stringify };',
    url:
      'export const URL = globalThis.URL;\nexport const URLSearchParams = globalThis.URLSearchParams;\n' +
      'export function parse(s){ try { return new globalThis.URL(s) } catch { return {} } }\n' +
      'export default { URL, URLSearchParams, parse };',
    constants: EMPTY,
    tty: 'export function isatty(){ return false }\nexport default { isatty };',
    vm: EMPTY,
    module: EMPTY,
    process:
      'export const env = {};\nexport const platform = "browser";\nexport function cwd(){ return "/" }\n' +
      'export const nextTick = (f,...a) => Promise.resolve().then(() => f(...a));\n' +
      'export default { env, platform, cwd, nextTick, version: "", versions: {} };',
  };

  /**
   * Icon packs, stubbed permissively.
   *
   * Not an optimisation — a necessity. Shesha 0.45.0 depends on react-icons ^5.1.0 and
   * imports `SiCss3` from react-icons/si, but react-icons renamed that export to `SiCss`
   * inside the caret range (installed here: 5.6.0). A strict ESM bundler treats the
   * missing named export as a build error. Icons are `ReactNode` values on toolbox
   * definitions and are serialised as {__reactElement:true} regardless, so nothing about
   * the derived registry depends on them.
   *
   * Emitted as CommonJS exporting a Proxy: esbuild resolves named imports from a CJS
   * module as runtime property lookups, so ANY icon name resolves rather than needing
   * every name enumerated.
   */
  const ICON_PROXY_STUB = `
var React = require('react');
var Icon = function(){ return null };
module.exports = new Proxy({ __esModule: true, default: Icon }, {
  get: function(target, prop){ return prop in target ? target[prop] : Icon; },
  has: function(){ return true; }
});
`;

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const moduleFilter = new RegExp(`^(${Object.keys(MODULE_STUBS).map(escape).join('|')})$`);
  const builtinFilter = new RegExp(
    `^(node:)?(${Object.keys(BUILTIN_STUBS).map(escape).join('|')})$`
  );
  const iconFilter = /^react-icons(\/.*)?$/;

  return {
    name: 'shesha-probe-stubs',
    setup(build) {
      build.onResolve({ filter: iconFilter }, (args) => ({
        path: args.path,
        namespace: 'shesha-stub-icons',
      }));
      build.onLoad({ filter: /.*/, namespace: 'shesha-stub-icons' }, () => ({
        contents: ICON_PROXY_STUB,
        loader: 'js',
        resolveDir: build.initialOptions.absWorkingDir,
      }));

      build.onResolve({ filter: moduleFilter }, (args) => ({
        path: args.path,
        namespace: 'shesha-stub-module',
      }));
      build.onLoad({ filter: /.*/, namespace: 'shesha-stub-module' }, (args) => ({
        contents: MODULE_STUBS[args.path],
        loader: 'js',
      }));

      build.onResolve({ filter: builtinFilter }, (args) => ({
        path: args.path.replace(/^node:/, ''),
        namespace: 'shesha-stub-builtin',
      }));
      build.onLoad({ filter: /.*/, namespace: 'shesha-stub-builtin' }, (args) => ({
        contents: BUILTIN_STUBS[args.path],
        loader: 'js',
        // Resolve the shims' own imports (stream imports events) from this namespace.
        resolveDir: HARNESS_DIR,
      }));
    },
  };
}

/**
 * Bundle the harness against the TARGET APP's installed package.
 *
 * absWorkingDir is the adminportal so that bare specifiers (@shesha-io/reactjs, react,
 * react-dom) resolve to what the app actually has installed — not to anything in this
 * skill's own node_modules. That is what makes the derived truth attest to the real
 * artefact rather than to a convenient copy.
 */
export async function buildHarness(paths, { outDir, verbose = false, identity, cache = true } = {}) {
  const esbuild = await import('esbuild');
  const dir = outDir || join(HERE, '..', '..', '.tmp', 'harness');
  mkdirSync(dir, { recursive: true });

  const bundlePath = join(dir, 'bundle.js');
  const pagePath = join(dir, 'page.html');

  /**
   * Content-addressed bundle cache.
   *
   * Bundling the whole Shesha package is ~7s of the probe's ~9s. Phase 3's `preview`
   * shares this path and has a sub-10s budget it must hit repeatedly, so the bundle is
   * cached against everything that could invalidate it:
   *   - the installed framework version and the sha256 of its dist entry (the drift
   *     guard) — so an app upgrade rebuilds rather than serving a stale bundle
   *   - the harness source itself
   *   - the esbuild version
   * A cache written by a different framework build can never be read back.
   */
  const entrySrc = readFileSync(join(HARNESS_DIR, 'entry.js'), 'utf8');
  const cacheKey = createHash('sha256')
    .update(identity ? `${identity.version}|${identity.driftGuard.moduleSha256}` : 'no-identity')
    .update('|')
    .update(entrySrc)
    .update('|')
    .update(esbuild.version || '0')
    .digest('hex')
    .slice(0, 16);
  const cacheDir = join(paths.appRoot, '.shesha', 'harness-cache');
  const cachedBundle = join(cacheDir, `bundle.${cacheKey}.js`);

  if (cache && existsSync(cachedBundle)) {
    writeFileSync(bundlePath, readFileSync(cachedBundle));
    writeFileSync(pagePath, readFileSync(join(HARNESS_DIR, 'page.html'), 'utf8'), 'utf8');
    return { dir, bundlePath, pagePath, warnings: [], cacheHit: true, cacheKey };
  }

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [join(HARNESS_DIR, 'entry.js')],
      absWorkingDir: paths.adminportal,
      // esbuild resolves bare specifiers by walking up from the IMPORTING FILE, which
      // lives in this skill, not in the app. nodePaths adds the app's node_modules to
      // the search so @shesha-io/reactjs / react / react-dom resolve to what the target
      // app actually has installed.
      nodePaths: [join(paths.adminportal, 'node_modules')],
      bundle: true,
      outfile: bundlePath,
      platform: 'browser',
      format: 'iife',
      globalName: '__shprobe',
      target: 'chrome110',
      // dist/index.es.js:1 statically imports react-big-calendar's stylesheet. In Node
      // that is a hard ERR_UNKNOWN_FILE_EXTENSION; here it becomes a no-op.
      loader: { '.css': 'empty', '.less': 'empty', '.scss': 'empty', '.svg': 'empty' },
      plugins: [stubPlugin()],
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: verbose ? 'info' : 'silent',
      logLimit: 0,
      metafile: false,
      // Warnings are expected (the bundle is not built for this use); errors are fatal.
      write: true,
    });
  } catch (e) {
    const detail =
      (e && e.errors && e.errors.length
        ? e.errors.map((x) => `  ${x.text}${x.location ? ` (${x.location.file}:${x.location.line})` : ''}`).join('\n')
        : String((e && e.message) || e));
    throw new FrameworkError(`esbuild failed bundling the ground-truth harness:\n${detail}`, 20);
  }

  writeFileSync(pagePath, readFileSync(join(HARNESS_DIR, 'page.html'), 'utf8'), 'utf8');

  if (cache) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachedBundle, readFileSync(bundlePath));
      // The cache lives inside .shesha/, which self-ignores via its own .gitignore.
    } catch {
      /* an unwritable cache costs speed, never correctness */
    }
  }

  return {
    dir,
    bundlePath,
    pagePath,
    warnings: (result.warnings || []).map((w) => w.text),
    cacheHit: false,
    cacheKey,
  };
}

/**
 * Drive the harness in a real browser and return the derived registry.
 *
 * A silent harness failure is the single thing that would make this whole approach
 * untrustworthy, so every console message and page error is captured and surfaced.
 */
export async function runHarness(built, { grid = [], op = null, timeoutMs = 120000, headless = true } = {}) {
  const { chromium } = await import('playwright');

  const consoleMessages = [];
  const pageErrors = [];
  let browser;

  try {
    browser = await chromium.launch({ headless });
  } catch (e) {
    throw new FrameworkError(
      `Could not launch Playwright chromium: ${(e && e.message) || e}\n` +
        `Run:  npx playwright install chromium`,
      20
    );
  }

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String((err && err.stack) || err));
    });

    // Inject the operation before any script on the page runs.
    const operation = op || { kind: 'probe', grid };
    await page.addInitScript((o) => {
      window.__shesha_op = o;
    }, operation);

    await page.goto(pathToFileURL(built.pagePath).href, { waitUntil: 'load', timeout: timeoutMs });

    await page.waitForFunction(() => window.__shesha_ground_truth !== undefined, null, {
      timeout: timeoutMs,
    });

    const payload = await page.evaluate(() => window.__shesha_ground_truth);

    const errors = consoleMessages.filter((m) => m.type === 'error');
    if (!payload || !payload.ok) {
      throw new FrameworkError(
        `The ${operation.kind} harness rendered but did not produce a result.\n` +
          `  in-page error: ${(payload && payload.error) || '(none reported)'}\n` +
          (pageErrors.length ? `  page errors:\n${pageErrors.map((e) => '    ' + e).join('\n')}\n` : '') +
          (errors.length ? `  console errors:\n${errors.map((e) => '    ' + e.text).join('\n')}\n` : ''),
        20
      );
    }

    return {
      ...payload,
      diagnostics: {
        consoleErrors: errors.map((m) => m.text),
        consoleWarnings: consoleMessages.filter((m) => m.type === 'warning').map((m) => m.text),
        pageErrors,
      },
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * The default {dataType, dataFormat} sampling grid.
 *
 * Used only when the backend is unreachable. When live metadata is available the caller
 * passes the pairs actually present in this app, so dataTypeSupported is never sampled
 * against combinations that do not occur. The values here are Shesha's own DataTypes
 * constants, read from the installed package rather than typed by hand.
 */
export function readDataTypeConstants(paths) {
  // shesha-constants ships as typings + bundle; the DataTypes map is a plain object in
  // the bundle. Reading it from the typings keeps us off the minified bundle entirely.
  const dts = join(paths.packageDir, 'dist', 'interfaces', 'dataTypes.d.ts');
  if (!existsSync(dts)) return null;
  const src = readFileSync(dts, 'utf8');
  const types = new Set();
  const formats = new Set();
  // Declarations look like:  export declare const DataTypes: { string: "string"; ... }
  for (const m of src.matchAll(/"([a-zA-Z][\w-]*)"/g)) {
    const v = m[1];
    if (v.length < 40) types.add(v);
  }
  for (const m of src.matchAll(/\b([a-z][a-zA-Z]*)\s*:/g)) {
    formats.add(m[1]);
  }
  return { rawTokens: Array.from(types).sort(), keys: Array.from(formats).sort(), source: dts };
}

export function defaultGrid() {
  // Minimal, honest fallback: the dataType values Shesha's own metadata emits.
  // Kept deliberately small — a large invented grid would masquerade as measurement.
  const t = [
    'string',
    'number',
    'boolean',
    'date-time',
    'date',
    'time',
    'entity',
    'reference-list-item',
    'array',
    'object',
    'file',
    'guid',
  ];
  const f = [
    null,
    'singleline',
    'multiline',
    'html',
    'password',
    'emailAddress',
    'phoneNumber',
    'int32',
    'int64',
    'float',
    'double',
    'decimal',
    'multivalueReferenceList',
    'entityReference',
    'simple',
    'checkbox',
    'switch',
    'dropdown',
    'radiobuttons',
    'autocomplete',
  ];
  const grid = [];
  for (const dataType of t) for (const dataFormat of f) grid.push({ dataType, dataFormat });
  return grid;
}

/**
 * Run the framework's own tree -> flat -> upgrade -> tree cycle over a markup document.
 *
 * Returns the framework's output so the caller can diff it against the input. This is not
 * our opinion of valid markup; it is what Shesha itself does before rendering.
 */
export async function runRoundTrip(appPath, markup, { verbose = false, cache = true } = {}) {
  const paths = resolveAppPaths(appPath);
  const identity = readFrameworkIdentity(paths);
  const built = await buildHarness(paths, { verbose, identity, cache });
  try {
    const result = await runHarness(built, { op: { kind: 'roundtrip', markup } });
    return { identity, result, timing: { cacheHit: !!built.cacheHit } };
  } finally {
    cleanHarness(built);
  }
}

/** Best-effort cleanup of the transient bundle directory. */
export function cleanHarness(built) {
  if (!built || !built.dir) return;
  try {
    rmSync(built.dir, { recursive: true, force: true });
  } catch {
    /* leaving a temp dir behind is not worth failing a probe over */
  }
}

/**
 * The framework half of ground truth, end to end.
 * Deliberately independent of the backend so Phase 1 is never blocked on it.
 */
export async function deriveFrameworkTruth(
  appPath,
  { grid, keepHarness = false, verbose = false, cache = true } = {}
) {
  const paths = resolveAppPaths(appPath);
  const identity = readFrameworkIdentity(paths);
  const peers = readPeerVersions(paths);

  const buildStarted = Date.now();
  const built = await buildHarness(paths, { verbose, identity, cache });
  const bundleMs = Date.now() - buildStarted;
  try {
    const renderStarted = Date.now();
    const probed = await runHarness(built, { grid: grid && grid.length ? grid : defaultGrid() });
    return {
      paths,
      identity,
      peers,
      probed,
      harnessWarnings: built.warnings,
      timing: {
        bundleMs,
        renderMs: Date.now() - renderStarted,
        cacheHit: !!built.cacheHit,
        cacheKey: built.cacheKey,
      },
    };
  } finally {
    if (!keepHarness) cleanHarness(built);
  }
}
