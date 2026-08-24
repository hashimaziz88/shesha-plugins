// §4.3.8: the real enforcer of INV 1 (D-003). String-matching a Bash command line cannot
// enforce "the compiler is the only writer of markup" — any indirection (a helper with a
// computed path) never puts the path on the command line. block-form-writes is the fast
// first line; this gate is the decision procedure. For every compiled artifact it locates
// the sibling SFS and the sibling provenance meta (registrySha256, brand, compilerVersion),
// recompiles under exactly those, and hard-fails unless the emitted bytes are byte-identical
// (D-021 makes this decidable). A subject with no sibling SFS, or a meta missing a hash, is
// a hard failure — never uninspectable.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';
import { compile, COMPILER_VERSION } from '../../../sfs/src/compile/index.mjs';
import { registryFingerprint } from '../../../sfs/src/lib/registry.mjs';

export const id = 'g-markup-provenance';
export const describe = 'every compiled artifact recompiles byte-identically from its sibling SFS under its recorded registry/compiler provenance (INV 1, D-003)';
export const inputPaths = [
  'packages/sfs/test/fixtures',
  'packages/verify/test/fixtures/run',
  'packages/sfs/src/compile',
  'packages/registry/data',
  'packages/verify/config/fixture-floors.json',
];

const FLOORS = 'packages/verify/config/fixture-floors.json';

/** Every compiled-artifact subject, repo-relative. @param {string} root @returns {string[]} */
function subjects(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {RegExp} re */
  const walk = (dir, re) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, re);
      else if (re.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(path.join(root, 'packages/sfs/test/fixtures'), /\.expected\.form\.json$/);
  walk(path.join(root, 'packages/verify/test/fixtures/run/screens'), /\.form\.json$/);
  walk(path.join(root, 'runs'), /\.form\.json$/);
  return out.sort();
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([{ name: 'markup-provenance', unit: 'artifact' }]);
  const fam = fams.get('markup-provenance');

  for (const rel of subjects(root)) {
    const p = fam.pointer(rel);
    const base = rel.replace(/\.expected\.form\.json$/, '').replace(/\.form\.json$/, '');
    const sfsPath = path.join(root, `${base}.sfs.json`);
    // The provenance sidecar records registrySha256/brand/compilerVersion. It is NOT named
    // *.compiled.meta.json — g-artifact-naming bans that shape (D-044) — it is *.provenance.json.
    const metaPath = path.join(root, `${base}.provenance.json`);
    if (!fs.existsSync(sfsPath)) { p.fail(`${rel} has no sibling ${base}.sfs.json — the compiler is not provably its writer`); continue; }
    if (!fs.existsSync(metaPath)) { p.fail(`${rel} has no sibling ${base}.provenance.json (registrySha256/brand/compilerVersion)`); continue; }
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { p.fail(`${base}.provenance.json is unparseable`); continue; }
    if (typeof meta.registrySha256 !== 'string' || typeof meta.compilerVersion !== 'string') { p.fail(`${base}.provenance.json is missing registrySha256 or compilerVersion`); continue; }
    const brand = typeof meta.brand === 'string' ? meta.brand : 'shesha';
    if (meta.compilerVersion !== COMPILER_VERSION) { p.fail(`${rel} was compiled by ${meta.compilerVersion}, current is ${COMPILER_VERSION} — regenerate the fixture`); continue; }
    if (meta.registrySha256 !== registryFingerprint(root, brand)) { p.fail(`${rel} registrySha256 is stale — the registry changed since the fixture was blessed; regenerate it`); continue; }

    const sfsText = fs.readFileSync(sfsPath, 'utf8');
    const committed = fs.readFileSync(path.join(root, rel), 'utf8');
    let emitted;
    try { emitted = `${JSON.stringify(compile(sfsText, { brand, source: rel }).envelope, null, 2)}\n`; } catch (e) { p.fail(`${rel} sibling SFS does not compile: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`); continue; }
    p.assert(emitted === committed, `${rel} is NOT byte-identical to a recompile of its sibling SFS — it was written by something other than the compiler, or edited after compile (INV 1 / D-003)`);
  }

  // Floor: the subject set never narrows below its declared minimum.
  const floors = readJsonGuarded(path.join(root, FLOORS), fam, FLOORS);
  const floor = floors.ok ? (/** @type {any} */ (floors.value).families?.['markup-provenance']?.floor ?? 0) : 0;
  fam.pointer('markup-provenance#floor').assert(fam.walked >= floor,
    `${fam.walked} provenance subjects, below the ${floor} floor (fixture-floors.json)`);

  return fams.list;
}

export const mutations = [
  {
    name: 'a committed markup byte is flipped, so it no longer matches a recompile',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/test/fixtures/clean/booking-create.expected.form.json');
      fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8')} `);
    },
    expect: 'fail',
  },
  {
    name: 'a sibling SFS is deleted, so the compiler cannot be proved the writer',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => { fs.rmSync(path.join(tmp, 'packages/sfs/test/fixtures/clean/booking-detail.sfs.json')); },
    expect: 'fail',
  },
  {
    name: 'a computed-path writer emits a form.json with no sibling SFS (the hook cannot see it, the gate does)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const d = path.join(tmp, 'packages/verify/test/fixtures/run/screens');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'smuggled.form.json'), '{"Name":"smuggled","Markup":"[]"}\n');
    },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
