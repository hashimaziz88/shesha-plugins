// T1 — schema validation (§3.2.2). The cheapest tier: does an SFS document validate
// against sfs.schema.json? WP-4 ships this; WP-3a wires it into verify.mjs with the
// `envelope`/`file` families and the ENVELOPE-SYNTHESISED uninspectable rule.
//
// One family, `schema`, unit `file`: every *.sfs.json under the given directory is a
// pointer, checked when it validates and failed with the ajv message when it does
// not. A directory with no fixtures walks 0 and fails — zero coverage is never a pass.
//
//   node packages/verify/src/tiers/t1-schema.mjs <dir>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import { families, report, verdictOf, EXIT, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot, readText } from '../lib/fsx.mjs';
import { nodeId } from '../../../sfs/src/lib/ids.mjs';
import { walkComponents } from '../walk.mjs';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /\{\{[^}]+\}\}/;

/**
 * Unwrap an ABP envelope / double-stringified Markup / bare {components} / bare
 * array to `{envelope, doc}` — at most four hops (T1.01, the existing readArtifact
 * logic). `envelope` is null when the input is bare markup.
 * @param {string} raw
 * @returns {{envelope:any|null, doc:any}}
 */
export function readArtifact(raw) {
  let v = JSON.parse(raw.replace(/^﻿/, ''));
  let envelope = null;
  for (let hop = 0; hop < 4; hop++) {
    if (Array.isArray(v)) return { envelope, doc: { components: v } };
    if (v && typeof v === 'object' && Array.isArray(v.components)) return { envelope, doc: v };
    if (v && typeof v === 'object' && typeof v.Markup === 'string') { envelope = v; v = JSON.parse(v.Markup); continue; }
    if (v && typeof v === 'object' && v.Markup && typeof v.Markup === 'object') { envelope = v; v = v.Markup; continue; }
    break;
  }
  if (v && typeof v === 'object' && Array.isArray(v.components)) return { envelope, doc: v };
  throw new Error('T1.01 artifact is neither an envelope, {components,formSettings}, nor a component array');
}

/**
 * The full §3.2.2 T1 over ONE compiled form: file/markupSchema/structure + optional
 * sfsSchema and meta. Verdict-bearing in verify.mjs.
 * @param {string} root
 * @param {{envelope:any|null, doc:any}} art
 * @param {{sfs?:any, meta?:any, provenance?:string, legacy?:boolean}} [opts]
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t1Full(root, art, opts = {}) {
  const { envelope, doc } = art;
  const meta = opts.meta || null;
  const legacy = opts.legacy === true;
  // The sidecar carries every emitted component PLUS logical parent nodes (a card's
  // content/header region is a node a child's parentId points at, but it is not a
  // physical component in the tree). So parentId resolves against ids ∪ metaIds, and
  // the sidecar legitimately has MORE nodes than the markup has components.
  const metaNodes = meta && Array.isArray(meta.nodes) ? meta.nodes : [];
  const metaById = new Map(metaNodes.map((/** @type {any} */ n) => [n.id, n]));
  const [metaModule, metaForm] = String(meta && meta.form ? meta.form : '/').split('/');
  const fams = families([
    { name: 'file', unit: 'artifact' },
    { name: 'sfsSchema', unit: 'node', required: false },
    { name: 'markupSchema', unit: 'component' },
    { name: 'structure', unit: 'component' },
    { name: 'meta', unit: 'node', required: false },
  ]);
  const fileFam = fams.get('file');
  const compFam = fams.get('markupSchema');
  const structFam = fams.get('structure');
  const metaFam = fams.get('meta');

  // ---- T1.01 / T1.01b: the artifact parsed; provenance honesty ------------
  if (opts.provenance === 'ENVELOPE-SYNTHESISED') {
    fileFam.pointer('file#provenance').cannot('envelope was synthesised by detect.mjs; the 23 envelope fields are defaults, not observed', 'T1.01b');
  } else {
    fileFam.pointer('file#parsed').check();
  }

  // ---- T1.03 markup/envelope contract ------------------------------------
  if (envelope && opts.provenance !== 'ENVELOPE-SYNTHESISED') {
    const mp = compFam.pointer('envelope#contract');
    const problems = [];
    if (Object.keys(envelope).length !== 23) problems.push(`${Object.keys(envelope).length} top-level fields, expected 23`);
    if (envelope.Id !== envelope.OriginId) problems.push('Id !== OriginId');
    if (typeof envelope.Markup !== 'string') problems.push('Markup is not a JSON string');
    mp.assert(problems.length === 0, `T1.03 envelope contract: ${problems.join('; ')}`);
  } else if (opts.provenance === 'ENVELOPE-SYNTHESISED') {
    compFam.pointer('envelope#contract').na('provenance ENVELOPE-SYNTHESISED (T1.03)');
  }

  // ---- structure: T1.04-T1.09 over every component -----------------------
  const visits = walkComponents(doc);
  structFam.pointer('structure#nonempty').assert(visits.length > 0, 'T1.09 the form has zero components');
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const dupes = new Set();
  for (const { node } of visits) {
    if (typeof node.id === 'string' && node.id) { if (ids.has(node.id)) dupes.add(node.id); ids.add(node.id); }
  }
  for (const { node, where } of visits) {
    // A datatable column-definition (columnType) and a `[default]`/`[...]` renderer
    // sentinel in a column triplet are SCHEMA, not components — they carry no id by
    // design. The structure checks apply only to real components.
    if (!node.type || String(node.type).startsWith('[') || node.columnType !== undefined) continue;
    const id = node.id;
    // T1.04 non-empty id
    structFam.pointer(`${where}#T1.04`).assert(typeof id === 'string' && id.length > 0,
      `T1.04 component at ${where} has no non-empty id`);
    if (typeof id !== 'string' || !id) continue;
    // T1.05 no unreplaced token
    structFam.pointer(`${where}#T1.05`).assert(!TOKEN.test(id), `T1.05 id "${id}" at ${where} is an unreplaced token`);
    // T1.06 unique
    structFam.pointer(`${where}#T1.06`).assert(!dupes.has(id), `T1.06 id "${id}" at ${where} is duplicated`);
    // T1.07 parentId resolves to a component, a logical sidecar node, or "root"
    const pid = node.parentId;
    structFam.pointer(`${where}#T1.07`).assert(pid === 'root' || pid === null || pid === undefined || ids.has(pid) || metaById.has(pid),
      `T1.07 parentId "${pid}" at ${where} resolves to no component, no sidecar node, nor "root"`);
    // T1.08 v5 id, recomputed from the sidecar sfsPath when the node has one
    const sp = structFam.pointer(`${where}#T1.08`);
    if (legacy) { sp.na('legacy artifact: v5-id recompute not applicable (T1.08)'); continue; }
    if (!UUID_V5.test(id)) { sp.fail(`T1.08 id "${id}" at ${where} is not an RFC-4122 v5 uuid`); continue; }
    const metaNode = metaById.get(id);
    if (!metaNode) { sp.check(); continue; } // a stamped-but-unmapped component: v5 verified, no sfsPath to recompute
    const expect = nodeId(metaModule, metaForm, metaNode.sfsPath);
    sp.assert(id === expect, `T1.08 id "${id}" at ${where} != recomputed nodeId ${expect} for sfsPath ${metaNode.sfsPath}`);
  }

  // ---- T1.02 SFS validates (only when an SFS is supplied) ----------------
  if (opts.sfs !== undefined) {
    const schema = JSON.parse(readText(path.join(root, 'packages/sfs/schema/sfs.schema.json')) || '{}');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const sp = fams.get('sfsSchema').pointer('sfs#schema');
    if (validate(opts.sfs)) sp.check();
    else sp.fail(`T1.02 SFS fails sfs.schema.json: ${(validate.errors || []).slice(0, 2).map((/** @type {any} */ e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  }

  // ---- T1.10 sidecar covers every component -------------------------------
  // Every emitted component must have a sidecar node (so T2/T3 and the predicates
  // can trust it). The reverse does not hold: the sidecar also carries logical
  // parent nodes that are not physical components, so metaIds ⊋ ids is expected.
  if (metaNodes.length > 0) {
    metaFam.pointer('meta#covers-markup').assert([...ids].every((i) => metaById.has(i)),
      `T1.10 sidecar is missing ${[...ids].filter((i) => !metaById.has(i)).length} component id(s) present in the markup`);
  }

  return fams.list;
}

/**
 * @param {string} root
 * @param {string} dir directory of *.sfs.json to validate, repo-relative or absolute
 * @returns {import('@shesha/registry/coverage').Family[]}
 */
export function t1Schema(root, dir) {
  const fams = families([{ name: 'schema', unit: 'file' }]);
  const fam = fams.get('schema');

  const schemaPath = path.join(root, 'packages/sfs/schema/sfs.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const abs = path.isAbsolute(dir) ? dir : path.join(root, dir);
  const files = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith('.sfs.json')).sort() : [];
  // An empty directory would let the tier pass over nothing; the family walks a
  // sentinel that fails, so 0 fixtures is a fail, not a vacuous pass.
  if (files.length === 0) {
    fam.pointer(`${dir}#empty`).fail(`no *.sfs.json under ${dir}; a schema tier over nothing is not a pass`);
    return fams.list;
  }

  for (const f of files) {
    const rel = `${dir}/${f}`;
    const p = fam.pointer(rel);
    /** @type {unknown} */
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8').replace(/^﻿/, '')); } catch (e) {
      p.fail(`${rel} is not valid JSON: ${/** @type {Error} */ (e).message}`);
      continue;
    }
    if (validate(doc)) { p.check(); continue; }
    const first = (validate.errors || []).slice(0, 2)
      .map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    p.fail(`${rel} fails sfs.schema.json: ${first}`);
  }
  return fams.list;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  const arg = process.argv[2];
  if (arg === undefined) { console.error('usage: t1-schema.mjs <dir-of-sfs-fixtures> | <form.json> [--sfs f] [--meta f] [--legacy]'); process.exit(EXIT.usage); }
  const abs = path.isAbsolute(arg) ? arg : path.join(root, arg);
  // A directory is the WP-4 clean-fixture batch (§3.2.2 dir-mode); a file is the
  // single compiled form the full T1 ladder inspects.
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    process.exit(await runGuarded(async () => {
      const fams = t1Schema(root, arg);
      const fam = fams.find((x) => x.name === 'schema');
      console.log(report(fams, { title: 't1-schema' }));
      console.log(`${fam?.checked ?? 0}/${fam?.walked ?? 0} valid`);
      return verdictOf(fams) === 'pass' ? EXIT.pass : EXIT.fail;
    }));
  } else {
    process.exit(await runGuarded(async () => {
      const raw = readText(abs);
      if (raw === null) { console.error(`t1-schema: cannot read ${arg}`); return EXIT.usage; }
      const art = readArtifact(raw);
      const sfsAt = process.argv.indexOf('--sfs');
      const metaAt = process.argv.indexOf('--meta');
      /** @param {string} a */
      const resolve = (a) => (path.isAbsolute(a) ? a : path.join(root, a));
      const sfs = sfsAt >= 0 ? JSON.parse(readText(resolve(process.argv[sfsAt + 1])) || 'null') : undefined;
      const meta = metaAt >= 0 ? JSON.parse(readText(resolve(process.argv[metaAt + 1])) || 'null') : null;
      const fams = t1Full(root, art, { sfs, meta, legacy: process.argv.includes('--legacy') });
      console.log(report(fams, { title: 't1-schema' }));
      return exitFor(verdictOf(fams));
    }));
  }
}
