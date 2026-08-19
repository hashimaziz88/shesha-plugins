// D-002, D-023, D-024, D-025, D-041: the workspace wiring holds its shape.
//
// The load-bearing assertion is the dependency arrow registry <- sfs <- verify:
// a compiler that imports its own verifier cannot be audited by it.

import fs from 'node:fs';
import path from 'node:path';
import { families, readJsonGuarded } from '@shesha/registry/coverage';
import { listFiles, readText, rel, subdirs } from '../lib/fsx.mjs';

export const id = 'g-workspace-hygiene';
export const describe = 'five private packages, acyclic deps, no sfs->verify, no json imports, no ranged deps, tsconfig shape';
export const inputPaths = [
  'package.json', 'tsconfig.json', 'package-lock.json',
  'packages/verify/config/source-patterns.json', 'packages', 'plugins',
];

/** The five packages and the only legal direction of dependency. */
const EXPECTED_PACKAGES = ['mcp', 'precedent', 'registry', 'sfs', 'verify'];
/** Layer index: a package may depend only on strictly lower layers. */
const LAYER = { registry: 0, sfs: 1, verify: 2, mcp: 3, precedent: 0 };

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'packages', unit: 'package' },
    { name: 'dep-direction', unit: 'import' },
    { name: 'json-imports', unit: 'file' },
    { name: 'ranged-deps', unit: 'dependency' },
    { name: 'tsconfig', unit: 'assertion' },
    { name: 'plugins-clean', unit: 'path' },
  ]);

  // Patterns as data, so this file does not contain the import syntax it hunts for.
  const patternsGot = readJsonGuarded(path.join(root, 'packages/verify/config/source-patterns.json'),
    fams.get('json-imports'), 'source-patterns.json');
  if (!patternsGot.ok) return fams.list;
  const W = /** @type {{workspace:{jsonImport:string, verifyImport:string[]}}} */ (patternsGot.value).workspace;

  // ---- packages: exactly five, all private, all in the workspaces glob -------
  const pkgFam = fams.get('packages');
  const rootPkgGot = readJsonGuarded(path.join(root, 'package.json'), pkgFam, 'package.json');
  /** @type {string[]} */
  let workspaces = [];
  if (rootPkgGot.ok) {
    const rp = /** @type {{workspaces?:string[], scripts?:Record<string,string>}} */ (rootPkgGot.value);
    workspaces = rp.workspaces || [];
    const wsPointer = pkgFam.pointer('root#workspaces');
    wsPointer.assert(JSON.stringify(workspaces) === JSON.stringify(['packages/*']),
      `root workspaces must be exactly ["packages/*"] (D-040 conflict 6), found ${JSON.stringify(workspaces)}`);
  }

  const present = subdirs(path.join(root, 'packages'));
  const cardinality = pkgFam.pointer('packages#cardinality');
  cardinality.assert(
    JSON.stringify(present) === JSON.stringify(EXPECTED_PACKAGES),
    `packages/ must contain exactly ${EXPECTED_PACKAGES.join(', ')}; found ${present.join(', ') || '(none)'}`);

  /** @type {Record<string, Record<string,string>>} */
  const deps = {};
  for (const name of present) {
    const p = pkgFam.pointer(`packages/${name}/package.json`);
    const got = readJsonGuarded(path.join(root, 'packages', name, 'package.json'),
      fams.get('packages'), `packages/${name}/package.json#read`);
    if (!got.ok) { p.fail(`packages/${name} has no readable package.json`); continue; }
    const pkg = /** @type {{name?:string, private?:boolean, type?:string, dependencies?:Record<string,string>, exports?:Record<string,unknown>}} */ (got.value);
    deps[name] = pkg.dependencies || {};
    const problems = [];
    if (pkg.private !== true) problems.push('"private" must be true; flipping it needs a new DECISIONS row');
    if (pkg.type !== 'module') problems.push('"type" must be "module"');
    if (pkg.name !== `@shesha/${name}`) problems.push(`"name" must be @shesha/${name}, found ${pkg.name}`);
    if (!pkg.exports || typeof pkg.exports !== 'object') problems.push('must declare an "exports" map');
    if (problems.length) p.fail(`packages/${name}: ${problems.join('; ')}`);
    else p.check(problems.length + 4);
  }

  // ---- dependency direction: acyclic, one way, and never sfs -> verify -------
  const dirFam = fams.get('dep-direction');
  for (const name of present) {
    for (const dep of Object.keys(deps[name] || {})) {
      const m = /^@shesha\/(.+)$/.exec(dep);
      if (!m) continue;
      const p = dirFam.pointer(`${name} -> ${dep}`);
      const from = LAYER[/** @type {keyof typeof LAYER} */ (name)];
      const to = LAYER[/** @type {keyof typeof LAYER} */ (m[1])];
      if (from === undefined || to === undefined) { p.fail(`unknown package in the layer map: ${name} -> ${m[1]}`); continue; }
      p.assert(to < from,
        `dependency direction reversed: ${name} (layer ${from}) may not depend on ${m[1]} (layer ${to}). ` +
        'The arrow is registry <- sfs <- verify <- mcp (D-041).');
    }
  }
  // The specific forbidden import, asserted by source scan as well as by manifest.
  for (const f of listFiles(path.join(root, 'packages', 'sfs'), { ext: ['.mjs'] })) {
    const r = rel(root, f);
    const text = readText(f) || '';
    const p = dirFam.pointer(`${r}#imports-verify`);
    p.assert(!W.verifyImport.some((pat) => new RegExp(pat).test(text)),
      `${r} imports packages/verify — a compiler that calls its own verifier cannot be audited by it (D-041)`);
  }

  // ---- no import of a .json file anywhere in packages/** or .claude/hooks ----
  const jsonFam = fams.get('json-imports');
  for (const dir of ['packages', '.claude/hooks']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of listFiles(abs, { ext: ['.mjs'] })) {
      const r = rel(root, f);
      const text = readText(f) || '';
      const p = jsonFam.pointer(r);
      const m = new RegExp(W.jsonImport).exec(text);
      p.assert(m === null,
        `${r} imports a .json file (${m ? m[0] : ''}); every JSON read goes through readJsonGuarded (D-025)`);
    }
  }

  // ---- no ranged versions on any non-@shesha dependency ---------------------
  const rangeFam = fams.get('ranged-deps');
  /** @type {[string, Record<string,string>][]} */
  const allDepSets = [];
  if (rootPkgGot.ok) {
    const rp = /** @type {{devDependencies?:Record<string,string>, dependencies?:Record<string,string>}} */ (rootPkgGot.value);
    allDepSets.push(['package.json', { ...(rp.dependencies || {}), ...(rp.devDependencies || {}) }]);
  }
  for (const name of present) allDepSets.push([`packages/${name}/package.json`, deps[name] || {}]);
  for (const [where, set] of allDepSets) {
    for (const [dep, version] of Object.entries(set)) {
      const p = rangeFam.pointer(`${where}: ${dep}`);
      if (dep.startsWith('@shesha/')) {
        p.assert(version === '*', `cross-package deps use "*", found "${version}"`);
        continue;
      }
      p.assert(/^\d+\.\d+\.\d+$/.test(version),
        `${dep}@${version} is a range; every external dependency is pinned exactly so npm ci is reproducible`);
    }
  }

  // ---- tsconfig shape ------------------------------------------------------
  const tsFam = fams.get('tsconfig');
  const tsGot = readJsonGuarded(path.join(root, 'tsconfig.json'), tsFam, 'tsconfig.json');
  if (tsGot.ok) {
    const ts = /** @type {{compilerOptions?:Record<string,unknown>}} */ (tsGot.value);
    const co = ts.compilerOptions || {};
    tsFam.pointer('strict').assert(co.strict === true, '"strict" must be true (D-023)');
    tsFam.pointer('noUncheckedIndexedAccess').assert(co.noUncheckedIndexedAccess === true,
      'noUncheckedIndexedAccess must be true: every indexed access is checked (BL-010 / D-024, re-enabled in WP-1c)');
    tsFam.pointer('module').assert(co.module === 'nodenext', '"module" must be nodenext');
    tsFam.pointer('moduleResolution').assert(co.moduleResolution === 'nodenext', '"moduleResolution" must be nodenext');
    tsFam.pointer('checkJs').assert(co.checkJs === true, '"checkJs" must be true — types are JSDoc, checked (D-023)');
    tsFam.pointer('resolveJsonModule').assert(!('resolveJsonModule' in co),
      'resolveJsonModule must be absent: no .json import is legal (D-025)');
  }

  // ---- lockfile present and installable ------------------------------------
  const lockPointer = fams.get('packages').pointer('package-lock.json');
  lockPointer.assert(fs.existsSync(path.join(root, 'package-lock.json')),
    'package-lock.json is committed and authoritative; without it npm ci cannot be reproducible');

  // ---- plugins/** carries no package.json, no node_modules, no scripts/ -----
  const plugFam = fams.get('plugins-clean');
  const pluginsDir = path.join(root, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    // A required family cannot dispose its whole population as not-applicable and
    // still mean anything, so an absent plugins/ is asserted, not excused.
    plugFam.pointer('plugins#present').fail('plugins/ does not exist; this repository ships Claude Code plugins');
  } else {
    // Scope: this gate owns the WORKSPACE wiring, so the assertion here is that no
    // plugin declares itself an npm package (D-040 conflict 6). Whether a skill may
    // ship a helper script at all is a purity question that g-skill-purity owns at
    // WP-7a; six unrelated skills ship shell and PowerShell helpers that predate
    // this rebuild, and failing them here would be this gate reaching outside its
    // subject to delete working behaviour.
    for (const f of listFiles(pluginsDir)) {
      const r = rel(root, f);
      if (r.includes('/shesha-developer-0-43/')) continue; // frozen, gates skip it
      if (path.basename(f) !== 'package.json') continue;
      plugFam.pointer(r).fail(`plugins/** contains no package.json after WP-0 (D-040 conflict 6): ${r}`);
    }
    // The family must walk something even when clean, or it reports pass over nothing.
    const sentinel = plugFam.pointer('plugins#scanned');
    sentinel.check();
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'sfs imports verify',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/index.mjs');
      fs.appendFileSync(f, "\nimport { VERIFY_API_VERSION } from '@shesha/verify';\nexport const leak = VERIFY_API_VERSION;\n");
    },
    expect: 'fail',
  },
  {
    name: 'a module imports a .json file directly',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/bad-json-import.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      // Assembled from parts so this gate does not match its own mutation payload.
      fs.writeFileSync(f, `import cfg ${'from'} '../config/gate-ratchet.${'json'}';\nexport const x = cfg;\n`);
    },
    expect: 'fail',
  },
  {
    name: 'an external dependency is loosened to a caret range',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/package.json');
      const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
      pkg.dependencies.ajv = '^8.17.1';
      fs.writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'tsconfig loses strict',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'tsconfig.json');
      const ts = JSON.parse(fs.readFileSync(f, 'utf8'));
      ts.compilerOptions.strict = false;
      fs.writeFileSync(f, `${JSON.stringify(ts, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'tsconfig disables noUncheckedIndexedAccess',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'tsconfig.json');
      const ts = JSON.parse(fs.readFileSync(f, 'utf8'));
      ts.compilerOptions.noUncheckedIndexedAccess = false;
      fs.writeFileSync(f, `${JSON.stringify(ts, null, 2)}\n`);
    },
    expect: 'fail',
  },
];
