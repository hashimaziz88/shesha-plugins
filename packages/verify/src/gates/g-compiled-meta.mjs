// D-104, WP-3b.1: the compiler emits the §3.3.1 provenance sidecar on every compile,
// and it validates against packages/sfs/schema/compiled-meta.schema.json.
//
// This is the foundation the placement predicates (WP-3b.2) and the T3 tier (WP-3b.3)
// stand on: T3 reads placement — region, cell sizing, row groups, tab membership —
// from the compiler's own declaration in this sidecar, never from rendered CSS, which
// resolves a `1fr` intent to a pixel width the DOM cannot tell from a fixed one. The
// gate compiles every clean fixture and asserts its sidecar both validates the schema
// and carries the semantics the predicates depend on (a fill cell records its reserve,
// the page shell reads region "page"). A schema that drifts from what the compiler
// emits is caught here, not three tiers later.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);

export const id = 'g-compiled-meta';
export const describe = 'the compiler emits the §3.3.1 sidecar and every clean fixture validates against compiled-meta.schema.json';
export const inputPaths = [
  'packages/sfs/schema/compiled-meta.schema.json',
  'packages/sfs/test/fixtures/clean',
  'packages/sfs/src/compile',
];

const SCHEMA = 'packages/sfs/schema/compiled-meta.schema.json';
const CLEAN = 'packages/sfs/test/fixtures/clean';

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'schema', unit: 'file' },
    { name: 'sidecar', unit: 'fixture' },
    { name: 'placement', unit: 'node' },
  ]);
  const schemaFam = fams.get('schema');
  const sidecarFam = fams.get('sidecar');
  const placeFam = fams.get('placement');

  const got = readJsonGuarded(path.join(root, SCHEMA), schemaFam, SCHEMA);
  if (!got.ok) return fams.list;
  /** @type {any} */
  let validate;
  try {
    validate = new Ajv2020({ allErrors: true, strict: false }).compile(got.value);
    schemaFam.pointer(`${SCHEMA}#compiles`).check();
  } catch (e) {
    schemaFam.pointer(`${SCHEMA}#compiles`).fail(`compiled-meta.schema.json is not a compilable schema: ${/** @type {Error} */ (e).message}`);
    return fams.list;
  }

  const dir = path.join(root, CLEAN);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sfs.json')).sort() : [];
  if (files.length === 0) {
    sidecarFam.pointer(`${CLEAN}#empty`).fail(`no *.sfs.json under ${CLEAN}; a sidecar gate over nothing is not a pass`);
    return fams.list;
  }

  const { compile } = await import('../../../sfs/src/compile/index.mjs');

  for (const f of files) {
    const rel = `${CLEAN}/${f}`;
    const p = sidecarFam.pointer(rel);
    const src = readText(path.join(dir, f));
    if (src === null) { p.fail(`${rel} is unreadable`); continue; }
    /** @type {any} */
    let meta;
    try { meta = compile(src, { source: rel }).meta; } catch (e) {
      p.fail(`${rel} does not compile: ${/** @type {Error} */ (e).message.split('\n')[0]}`);
      continue;
    }
    if (validate(meta)) p.check();
    else {
      const first = (validate.errors || []).slice(0, 2).map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      p.fail(`${rel} sidecar fails compiled-meta.schema.json: ${first}`);
      continue;
    }

    // The schema proves shape; these prove the semantics the predicates read. A fill
    // cell that forgot its reserve, or a page shell that lost its region, validates the
    // shape and breaks every ratio/region predicate downstream.
    const nodes = /** @type {any[]} */ (meta.nodes);
    for (const n of nodes) {
      const np = placeFam.pointer(`${rel}:${n.name}#${n.sfsPath}`);
      const problems = [];
      if (n.sfsPath === '/pageShell' && n.region !== 'page') problems.push(`page shell has region "${n.region}", not "page"`);
      if (n.cell.sizing === 'fill' && typeof n.cell.reservePx !== 'number') problems.push('a fill cell has no reservePx');
      if (n.cell.sizing === 'fixed' && typeof n.cell.px !== 'number') problems.push('a fixed cell has no px');
      if (n.cell.sizing === 'auto' && (n.cell.px !== null || n.cell.reservePx !== null)) problems.push('an auto cell carries px/reservePx');
      np.assert(problems.length === 0, `${rel} node "${n.name}": ${problems.join('; ')}`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the schema requires a member the compiler never emits',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, SCHEMA);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.$defs.node.required.push('reserveWidth');
      j.$defs.node.properties.reserveWidth = { type: 'number' };
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the schema drops a cell sizing the compiler emits',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, SCHEMA);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.$defs.cell.properties.sizing.enum = ['fill', 'fixed'];
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
    },
    expect: 'fail',
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
