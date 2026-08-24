// §4.3.9 / §4.1.1: judge isolation as a decision procedure. (1) No file under plugins/**
// or packages/** places the builder's self-report token within 400 chars of an evaluator
// or design-critic reference — the one legitimate place the token appears is the schema
// that DEFINES the isolation rule, which is excluded. (2) dispatch.schema.json's
// paths[].not.pattern is byte-equal to the canonical value (the isolation rule as a
// regex). (3) sfs-evaluator's tools grant no Bash. The token is assembled at runtime so
// this gate's own source never contains the contiguous literal it forbids.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-judge-isolation';
export const describe = 'no self-report token near an evaluator/critic reference; dispatch not.pattern canonical; evaluator has no Bash';
export const inputPaths = ['plugins/shesha-developer/agents', 'packages/sfs/schema/dispatch.schema.json'];

// Assembled so this file never contains the contiguous literal its scan forbids.
const LEAK = `__SAA${'_RESULT__'}`;
const CANON_PATTERN = String.raw`(^|/)(logs)/|\.rationale\.|` + LEAK;
const ROLES = ['sfs-evaluator', 'design-critic'];
const SCAN_ROOTS = ['plugins', 'packages'];
const SCAN_EXT = new Set(['.md', '.mjs', '.js', '.json', '.ts', '.txt']);
const SKIP_DIR = new Set(['node_modules', '.git', '.build', 'coverage', 'data']);
// The schema that DEFINES the isolation rule legitimately holds the token beside the role
// enum; exclude it from the proximity scan (its pattern is asserted directly below).
const DEFINER = 'packages/sfs/schema/dispatch.schema.json';

/** @param {string} dir @param {string} root @param {string[]} out */
function walk(dir, root, out) {
  /** @type {import('node:fs').Dirent[]} */
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), root, out); continue; }
    if (SCAN_EXT.has(path.extname(e.name))) out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
  }
}

/** True if `token` occurs within 400 chars of any role name in `text`. @param {string} text */
function leakNearRole(text) {
  let i = text.indexOf(LEAK);
  while (i !== -1) {
    for (const role of ROLES) {
      let r = text.indexOf(role);
      while (r !== -1) { if (Math.abs(r - i) <= 400) return true; r = text.indexOf(role, r + 1); }
    }
    i = text.indexOf(LEAK, i + 1);
  }
  return false;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'no-leak', unit: 'file' },
    { name: 'schema-pattern', unit: 'assertion' },
    { name: 'evaluator-tools', unit: 'assertion' },
  ]);

  // (1) proximity scan.
  const leakFam = fams.get('no-leak');
  /** @type {string[]} */
  const files = [];
  for (const r of SCAN_ROOTS) walk(path.join(root, r), root, files);
  for (const rel of files) {
    if (rel === DEFINER) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!text.includes(LEAK)) { leakFam.pointer(rel).check(); continue; }
    leakFam.pointer(rel).assert(!leakNearRole(text), `${rel} places the builder self-report token within 400 chars of an evaluator/critic reference (§4.1.1)`);
  }

  // (2) the canonical not.pattern.
  const schemaFam = fams.get('schema-pattern');
  const sp = schemaFam.pointer(DEFINER);
  let schema = /** @type {any} */ (null);
  try { schema = JSON.parse(fs.readFileSync(path.join(root, DEFINER), 'utf8')); } catch { /* handled */ }
  const actual = schema && schema.properties && schema.properties.paths && schema.properties.paths.items
    && schema.properties.paths.items.not ? schema.properties.paths.items.not.pattern : undefined;
  sp.assert(actual === CANON_PATTERN, `dispatch.schema.json paths[].not.pattern is ${JSON.stringify(actual)}, not the canonical isolation pattern`);

  // (3) the evaluator grants no Bash.
  const toolFam = fams.get('evaluator-tools');
  const tp = toolFam.pointer('plugins/shesha-developer/agents/sfs-evaluator.md');
  let ev;
  try { ev = fs.readFileSync(path.join(root, 'plugins/shesha-developer/agents/sfs-evaluator.md'), 'utf8'); } catch { ev = null; }
  if (ev === null) tp.fail('sfs-evaluator.md is missing');
  else {
    const m = /^tools:\s*(.*)$/m.exec(ev);
    const tools = m && m[1] ? m[1].split(',').map((s) => s.trim()) : [];
    tp.assert(!tools.includes('Bash'), 'sfs-evaluator.md tools must not include Bash');
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'Bash is granted to the evaluator',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/agents/sfs-evaluator.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^tools:\s*(.*)$/m, 'tools: $1, Bash'));
    },
    expect: 'fail',
  },
  {
    name: 'the dispatch not.pattern is weakened',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, DEFINER);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.properties.paths.items.not.pattern = '(^|/)(logs)/';
      fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
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
