// D-068: skill purity is adjudicated once, at WP-7a. D-018: styling is a
// compile-time concern, so no skill invokes a styling sub-skill or carries styling
// logic. D-002: the toolchain lives under packages/, never inside a skill folder.
//
// A skill is a ROUTER: it states intent, points at a package command, and shows
// worked examples. It is not a code package. This gate proves the design-pipeline
// skills — the routers this rebuild authors and owns — carry no executable code
// file, no forbidden directory (a `scripts/` or `node_modules/`), no banned file
// (a `package.json`, a README), and zero bytes of `assets/`. The one design skill
// whose asset debt BL-007's rewrite removes is waived, publicly and with an expiry.
//
// Every literal comes from packages/verify/config/skill-purity.json. The scope is
// the declared `skills` list, so a skill folder rename that skips the config fails
// the existence check rather than silently narrowing what is policed.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  families, readJsonGuarded, verdictOf, report, exitFor, runGuarded,
} from '@shesha/registry/coverage';
import { listFiles, repoRoot } from '../lib/fsx.mjs';
import { completedWps } from '../lib/session-state.mjs';

export const id = 'g-skill-purity';
export const describe = 'the design-pipeline skills are routers: no code file, no forbidden dir, no banned file, zero asset bytes';
export const inputPaths = [
  'packages/verify/config/skill-purity.json',
  'plugins/shesha-developer/skills/shesha-claude-designer',
  'plugins/shesha-developer/skills/shesha-design-comprehension',
  'plugins/shesha-developer/skills/shesha-design-system',
  'plugins/shesha-developer/skills/shesha-spec',
  'BUILD-LOG.md',
];

/**
 * @typedef {{skills:string[], codeExtensions:string[], forbiddenDirs:string[],
 *            bannedFiles:string[], assetWaivers:{skill:string, bytes:number, until:string, decision:string}[]}} Config
 */

/**
 * Total on-disk bytes under `dir`, raw (assets may be binary, so this must not
 * normalise). Returns 0 for a missing directory.
 * @param {string} dir
 * @returns {number}
 */
function byteSum(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += byteSum(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'code-files', unit: 'skill' },
    { name: 'structure', unit: 'skill' },
    { name: 'banned-files', unit: 'skill' },
    { name: 'asset-bytes', unit: 'skill' },
    { name: 'waiver-expiry', unit: 'waiver' },
  ]);

  const cfgFam = fams.get('code-files');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/skill-purity.json'), cfgFam, 'skill-purity.json');
  if (!got.ok) return fams.list;
  const cfg = /** @type {Config} */ (got.value);
  const skills = cfg.skills || [];
  if (skills.length === 0) {
    cfgFam.pointer('skill-purity.json#skills').fail('no skills declared; the purity check would be vacuous');
    return fams.list;
  }

  const codeFam = fams.get('code-files');
  const structFam = fams.get('structure');
  const bannedFam = fams.get('banned-files');
  const assetFam = fams.get('asset-bytes');
  const codeExt = new Set(cfg.codeExtensions || []);
  const banned = new Set(cfg.bannedFiles || []);
  const waiverBySkill = new Map((cfg.assetWaivers || []).map((w) => [w.skill, w]));

  for (const skill of skills) {
    const dir = path.join(root, skill);
    if (!fs.existsSync(dir)) {
      // A rename that skips the config: fail every family for this skill.
      codeFam.pointer(skill).fail(`declared skill "${skill}" does not exist; update skill-purity.json in the same commit as the rename`);
      structFam.pointer(skill).fail(`declared skill "${skill}" does not exist`);
      bannedFam.pointer(skill).fail(`declared skill "${skill}" does not exist`);
      assetFam.pointer(skill).fail(`declared skill "${skill}" does not exist`);
      continue;
    }

    // --- code files: a skill routes, it does not carry code -----------------
    const cp = codeFam.pointer(skill);
    const code = listFiles(dir)
      .filter((f) => codeExt.has(path.extname(f)))
      .map((f) => path.relative(dir, f).split(path.sep).join('/'));
    cp.assert(code.length === 0,
      `${skill} carries executable code: ${code.join(', ')}. A skill is a router; code lives under packages/ (D-002, D-068)`);

    // --- forbidden directories: scripts/, node_modules/ ---------------------
    const sp = structFam.pointer(skill);
    const dirs = (cfg.forbiddenDirs || []).filter((d) => {
      const abs = path.join(dir, d);
      return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    });
    sp.assert(dirs.length === 0,
      `${skill} contains forbidden director(y/ies): ${dirs.join(', ')} — a skill folder is not a package (§1.1, 10-standards inv.4)`);

    // --- banned files: package.json, README.md, ... -------------------------
    const bp = bannedFam.pointer(skill);
    const found = listFiles(dir)
      .filter((f) => banned.has(path.basename(f)))
      .map((f) => path.relative(dir, f).split(path.sep).join('/'));
    bp.assert(found.length === 0,
      `${skill} contains banned file(s): ${found.join(', ')} — never legal inside a skill folder`);

    // --- asset bytes: a router ships no assets, save a published waiver ------
    const ap = assetFam.pointer(skill);
    const bytes = byteSum(path.join(dir, 'assets'));
    const waiver = waiverBySkill.get(skill);
    if (waiver) {
      ap.na(`${bytes} B of assets/ waived until ${waiver.until} under ${waiver.decision} (BL-007 rewrite removes them)`);
    } else {
      ap.assert(bytes === 0,
        `${skill} ships ${bytes} B of assets/; a router carries none (§4/L4, budget "0 bytes of assets/")`);
    }
  }

  // --- waiver expiry: a waiver cannot outlive the WP that removes its debt ---
  const wFam = fams.get('waiver-expiry');
  const done = completedWps(root);
  const waivers = cfg.assetWaivers || [];
  if (waivers.length === 0) {
    wFam.pointer('asset-waivers#none').check();
  } else {
    for (const w of waivers) {
      const p = wFam.pointer(w.skill);
      const problems = [];
      if (!/^(WP|BL)-[0-9a-z.]{1,4}$/.test(w.until || '')) problems.push('has no WP or BL id in `until`');
      if (!/^D-\d{3}$/.test(w.decision || '')) problems.push('has no D-0NN decision authorising it');
      if (w.until && done.has(w.until) && byteSum(path.join(root, w.skill, 'assets')) > 0) {
        problems.push(`${w.until} is recorded complete in BUILD-LOG.md but ${w.skill}/assets still carries bytes`);
      }
      if (problems.length) p.fail(`waiver for ${w.skill}: ${problems.join('; ')}`);
      else p.check(3);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a skill grows a package.json (a router turned into a package)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-spec/package.json');
      fs.writeFileSync(f, '{ "name": "not-a-package" }\n');
    },
    expect: 'fail',
  },
  {
    name: 'a skill grows an executable code file',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-spec/helper.mjs');
      fs.writeFileSync(f, 'export const x = 1;\n');
    },
    expect: 'fail',
  },
  {
    name: 'a non-waived skill ships asset bytes',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const d = path.join(tmp, 'plugins/shesha-developer/skills/shesha-claude-designer/assets');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'rogue.json'), '{ "bytes": true }\n');
    },
    expect: 'fail',
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = repoRoot();
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    const byName = new Map(fams.map((f) => [f.name, f]));
    const codeF = byName.get('code-files');
    const structF = byName.get('structure');
    const bannedF = byName.get('banned-files');
    const codeFiles = codeF ? codeF.failures.length : 0;
    const scripts = structF ? structF.failures.length : 0;
    const readmes = bannedF ? bannedF.failures.length : 0;
    console.log(`\nskills ${(structF?.walked ?? 0)} · codeFiles ${codeFiles} · scripts ${scripts} · readmes ${readmes} · assetBytes 0 (non-waived)`);
    return exitFor(verdictOf(fams));
  }));
}
