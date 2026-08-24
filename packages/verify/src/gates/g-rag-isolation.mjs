// D-110, WP-9 (§4.7.1): RAG is never used for a correctness lookup.
//
// "Which props are legal on datatable in 0.45.1?" needs an exact answer from the
// registry, not a nearest-neighbour from an embedding — retrieval over the KB would
// reintroduce, probabilistically, the ambiguity the registry removes. So precedent
// retrieval stays out of the compiler and the verifier entirely, precedent never
// reaches up into the compiler, and no skill routes a props/versions/enums question to
// the retrieval tool. The detection patterns live in source-patterns.json and
// rag-forbidden.json (not inline), so this gate does not match its own source.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded, readJsonGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot, listFiles, rel } from '../lib/fsx.mjs';

export const id = 'g-rag-isolation';
export const describe = 'the compiler and verifier never import the retrieval package, precedent never imports the compiler, and no skill routes a correctness question to the retrieval tool';
export const inputPaths = ['packages/sfs/src', 'packages/verify/src', 'packages/precedent', 'plugins', 'packages/verify/config/rag-forbidden.json', 'packages/verify/config/source-patterns.json'];

const REGISTRY_LOOKUP = 'packages/mcp/src/tools/registry_lookup.mjs';

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'compiler-clean', unit: 'file' },
    { name: 'precedent-isolated', unit: 'file' },
    { name: 'registry-lookup', unit: 'file', required: false },
    { name: 'skill-prose', unit: 'md-file' },
  ]);
  const cc = fams.get('compiler-clean');
  const pi = fams.get('precedent-isolated');
  const rl = fams.get('registry-lookup');
  const sp = fams.get('skill-prose');

  const patGot = readJsonGuarded(path.join(root, 'packages/verify/config/source-patterns.json'), cc, 'source-patterns.json');
  if (!patGot.ok) return fams.list;
  const P = /** @type {{ragIsolation:{precedentImport:string, compileImport:string, similarityTerms:string}}} */ (patGot.value).ragIsolation;
  const precedentImport = new RegExp(P.precedentImport);
  const compileImport = new RegExp(P.compileImport);
  const similarityTerms = new RegExp(P.similarityTerms);

  // ---- (1) compiler + verifier never reference the retrieval package --------
  for (const dir of ['packages/sfs/src', 'packages/verify/src']) {
    for (const f of listFiles(path.join(root, dir), { ext: ['.mjs'] })) {
      const r = rel(root, f);
      cc.pointer(r).assert(!precedentImport.test(readText(f) || ''),
        `${r} references the retrieval package — RAG must never enter the compiler or the verifier (§4.7.1)`);
    }
  }

  // ---- (2) the retrieval package never imports the compiler -----------------
  for (const f of listFiles(path.join(root, 'packages/precedent'), { ext: ['.mjs'] })) {
    const r = rel(root, f);
    pi.pointer(r).assert(!compileImport.test(readText(f) || ''),
      `${r} imports the compiler — the retrieval package is dependency-layer 0 and may not reach up into @shesha/sfs`);
  }

  // ---- (3) the registry lookup carries no similarity vocabulary ------------
  // The MCP tool is WP-8; until it exists there is nothing to scan (required:false).
  const rlAbs = path.join(root, REGISTRY_LOOKUP);
  if (fs.existsSync(rlAbs)) {
    rl.pointer(REGISTRY_LOOKUP).assert(!similarityTerms.test(readText(rlAbs) || ''),
      `${REGISTRY_LOOKUP} contains similarity vocabulary — a registry lookup is exact, never nearest-neighbour`);
  }

  // ---- (4) no skill routes a correctness question to the retrieval tool -----
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/rag-forbidden.json'), sp, 'rag-forbidden.json');
  const patterns = got.ok ? (/** @type {any} */ (got.value).patterns || []).map((/** @type {string} */ p) => new RegExp(p, 'i')) : [];
  const mds = fs.existsSync(path.join(root, 'plugins')) ? listFiles(path.join(root, 'plugins'), { ext: ['.md'] }) : [];
  for (const f of mds) {
    const r = rel(root, f);
    const hit = patterns.find((/** @type {RegExp} */ re) => re.test(readText(f) || ''));
    sp.pointer(r).assert(!hit, `${r} pairs the retrieval tool with a correctness question — that answer comes from the registry (§4.7.1)`);
  }

  return fams.list;
}

// Mutation payloads assembled from fragments so this file never contains the tokens the
// gate itself scans for (it would otherwise match its own source in check 1).
const AT_PRECEDENT = `@shesha/${'precedent'}`;
const SEARCH_TOOL = `${'precedent'}_search`;

export const mutations = [
  {
    name: 'a compiler file imports the retrieval package',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/rag-leak.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, `import { retrieve } from '${AT_PRECEDENT}';\nexport const x = retrieve;\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the retrieval package imports the compiler',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/precedent/src/leak.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, "import { compile } from '@shesha/sfs';\nexport const x = compile;\n");
    },
    expect: 'fail',
  },
  {
    name: 'a skill routes a props question to the retrieval tool',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-spec/SKILL.md');
      fs.appendFileSync(f, `\nTo find which props are legal on a component, call \`${SEARCH_TOOL}\` and use the nearest result.\n`);
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
