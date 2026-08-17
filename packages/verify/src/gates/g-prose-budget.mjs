// D-009, D-028, D-037: instruction files are prompt payload, not documentation.
//
// Every literal comes from packages/verify/config/prose-budget.json; this gate
// carries none of its own. Caps ratchet DOWN only.
//
// Waivers are how existing debt is carried without hiding it. A waiver names the
// path, the MEASURED allowance, the WP that removes it, and the decision that
// authorised it. It is not a skip list: the number is published, `--baseline`
// refuses to raise it, and once its WP is recorded complete in BUILD-LOG.md the
// gate fails while the path still exists.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, readJsonGuarded, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import {
  listFiles, readText, normalisedByteSize, lineCount, rel, globMatch, subdirs, findAbsolutePath,
} from '../lib/fsx.mjs';

export const id = 'g-prose-budget';
export const describe = 'SKILL.md caps, tierA cardinality, reference depth, archaeology, banned files, frontmatter';
export const inputPaths = [
  'packages/verify/config/prose-budget.json',
  'plugins', 'CLAUDE.md', 'DECISIONS.md', 'BACKLOG.md',
];

/**
 * @typedef {{path:string, bytes?:number, lines?:number, archaeology?:number, deepReferences?:number,
 *            absolutePath?:boolean, frontmatterNameMismatch?:boolean, until:string, decision:string}} Waiver
 * @typedef {{tierA:{paths:string[],expectedCount:number,cap:{lines:number,bytes:number}},
 *            tierB:{globs:string[],cap:{lines:number,bytes:number}},
 *            files:Record<string,{lines:number,bytes:number}>,
 *            skip:string[], archaeologyPatterns:string[], bannedSkillFiles:string[],
 *            allowedFrontmatterKeys:string[],
 *            waiverUntilByPathClass:{match:string,until:string,decision:string}[],
 *            waiverUntilDefault:{until:string,decision:string},
 *            waivers:Waiver[]}} Config
 */

/**
 * Which WP or BACKLOG id removes the debt on this path. A waiver whose `until`
 * is a WP already recorded complete is a hard failure, so this mapping is what
 * gives every carried-over allowance a real expiry rather than an open end.
 * @param {Config} cfg
 * @param {string} relPath
 * @returns {{until:string, decision:string}}
 */
function waiverExpiryFor(cfg, relPath) {
  for (const rule of cfg.waiverUntilByPathClass || []) {
    if (relPath.includes(rule.match)) return { until: rule.until, decision: rule.decision };
  }
  return cfg.waiverUntilDefault || { until: 'BL-012', decision: 'D-063' };
}

/**
 * @param {string} root
 * @returns {Config|null}
 */
function loadConfig(root) {
  const text = readText(path.join(root, 'packages/verify/config/prose-budget.json'));
  if (text === null) return null;
  try { return /** @type {Config} */ (JSON.parse(text)); } catch { return null; }
}

/**
 * @param {Config} cfg
 * @param {string} relPath
 * @returns {boolean}
 */
function skipped(cfg, relPath) {
  return cfg.skip.some((g) => globMatch(g, relPath) || relPath.startsWith(g.replace(/\*\*$/, '')));
}

/**
 * @param {Config} cfg
 * @param {string} relPath
 * @returns {Waiver|null}
 */
function waiverFor(cfg, relPath) {
  return cfg.waivers.find((w) => w.path === relPath) || null;
}

/**
 * Every skill directory in scope, with its tier.
 * @param {string} root
 * @param {Config} cfg
 * @returns {{dir:string, rel:string, tier:'A'|'B'}[]}
 */
function skillDirs(root, cfg) {
  /** @type {{dir:string, rel:string, tier:'A'|'B'}[]} */
  const out = [];
  const tierASet = new Set(cfg.tierA.paths);
  for (const glob of cfg.tierB.globs) {
    const base = glob.replace(/\/\*$/, '');
    const abs = path.join(root, base);
    for (const name of subdirs(abs)) {
      const r = `${base}/${name}`;
      if (skipped(cfg, r)) continue;
      out.push({ dir: path.join(abs, name), rel: r, tier: tierASet.has(r) ? 'A' : 'B' });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Archaeology matches with line numbers.
 * @param {string} text
 * @param {string[]} patterns
 * @returns {{line:number, pattern:string, excerpt:string}[]}
 */
export function archaeologyHits(text, patterns) {
  /** @type {{line:number, pattern:string, excerpt:string}[]} */
  const hits = [];
  const lines = text.split('\n');
  for (const pattern of patterns) {
    // Applied exactly as written in the config: `TODO|FIXME|XXX` is an uppercase
    // marker convention, and matching it case-insensitively fires on every
    // `xxxxxxxx-xxxx` GUID placeholder in the repo — noise that gets a whole
    // gate waived, which is the failure mode the gate exists to prevent.
    const re = new RegExp(pattern);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push({ line: i + 1, pattern, excerpt: lines[i].trim().slice(0, 100) });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/**
 * @param {string} root
 * @returns {Set<string>} WP ids recorded complete in BUILD-LOG.md
 */
function completedWps(root) {
  const text = readText(path.join(root, 'BUILD-LOG.md')) || '';
  /** @type {Set<string>} */
  const done = new Set();
  for (const m of text.matchAll(/^##\s+(WP-[0-9a-z]+)\s+—/gmi)) done.add(m[1]);
  return done;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'tierA-cardinality', unit: 'folder' },
    { name: 'skill-caps', unit: 'file' },
    { name: 'file-caps', unit: 'file' },
    { name: 'archaeology', unit: 'file' },
    { name: 'banned-files', unit: 'file' },
    { name: 'reference-depth', unit: 'file' },
    { name: 'absolute-paths', unit: 'file' },
    { name: 'frontmatter', unit: 'file' },
    { name: 'waiver-expiry', unit: 'waiver' },
  ]);

  const cfgFam = fams.get('tierA-cardinality');
  const got = readJsonGuarded(path.join(root, 'packages/verify/config/prose-budget.json'), cfgFam, 'prose-budget.json');
  if (!got.ok) return fams.list;
  const cfg = /** @type {Config} */ (got.value);
  cfg.waivers = cfg.waivers || [];

  // ---- tierA cardinality: a rename that skips the config fails --------------
  let tierAFound = 0;
  for (const p of cfg.tierA.paths) {
    const pointer = cfgFam.pointer(p);
    const present = fs.existsSync(path.join(root, p));
    if (present) tierAFound++;
    pointer.assert(present, `tierA path "${p}" does not exist; update expectedCount and paths in the same commit as the rename`);
  }
  cfgFam.pointer('tierA#expectedCount').assert(tierAFound === cfg.tierA.expectedCount,
    `tierA matched ${tierAFound}/${cfg.tierA.expectedCount}`);

  const capFam = fams.get('skill-caps');
  const archFam = fams.get('archaeology');
  const bannedFam = fams.get('banned-files');
  const depthFam = fams.get('reference-depth');
  const absFam = fams.get('absolute-paths');
  const frontFam = fams.get('frontmatter');

  for (const skill of skillDirs(root, cfg)) {
    const cap = skill.tier === 'A' ? cfg.tierA.cap : cfg.tierB.cap;
    const skillMd = path.join(skill.dir, 'SKILL.md');
    const skillMdRel = `${skill.rel}/SKILL.md`;

    // --- SKILL.md caps, honouring a measured waiver -------------------------
    const cp = capFam.pointer(skillMdRel);
    const text = readText(skillMd);
    if (text === null) {
      cp.fail(`${skillMdRel} is missing — a skill folder without SKILL.md is not a skill`);
    } else {
      const bytes = normalisedByteSize(skillMd);
      const lines = lineCount(text);
      const w = waiverFor(cfg, skillMdRel);
      const byteCap = w && typeof w.bytes === 'number' ? w.bytes : cap.bytes;
      const lineCap = w && typeof w.lines === 'number' ? w.lines : cap.lines;
      const problems = [];
      if (bytes > byteCap) problems.push(`${bytes} B over the ${byteCap} B cap`);
      if (lines > lineCap) problems.push(`${lines} lines over the ${lineCap}-line cap`);
      if (problems.length) cp.fail(`${skillMdRel} (tier ${skill.tier}): ${problems.join('; ')}`);
      else cp.check(2);

      // --- frontmatter: name + description only, folder name equals name ----
      const fp = frontFam.pointer(skillMdRel);
      const fm = /^---\n([\s\S]*?)\n---/.exec(text);
      if (!fm) fp.fail(`${skillMdRel} has no YAML frontmatter block`);
      else {
        const keys = [...fm[1].matchAll(/^([A-Za-z_][A-Za-z0-9_-]*):/gm)].map((m) => m[1]);
        const nameMatch = /^name:\s*(.+)$/m.exec(fm[1]);
        const declared = nameMatch ? nameMatch[1].trim() : '';
        const folder = path.basename(skill.rel);
        const problems2 = [];
        const allowed = cfg.allowedFrontmatterKeys || ['name', 'description'];
        const extra = keys.filter((k) => !allowed.includes(k));
        if (extra.length) problems2.push(`frontmatter carries ${extra.join(', ')}; legal keys are ${allowed.join(', ')}`);
        const nameWaiver = waiverFor(cfg, skillMdRel);
        if (declared !== folder && nameWaiver?.frontmatterNameMismatch !== true) {
          problems2.push(`frontmatter name "${declared}" must equal the folder name "${folder}"`);
        }
        if (!/^[a-z0-9-]+$/.test(folder)) problems2.push(`folder "${folder}" must be lowercase-with-hyphens`);
        if (problems2.length) fp.fail(`${skillMdRel}: ${problems2.join('; ')}`);
        else fp.check(3);
      }
    }

    // --- banned files: one pointer per SKILL, so the family cannot empty ----
    // Pointing only at violations means the family walks 0 once the last one is
    // deleted, which R1 correctly reports as zero coverage rather than success.
    const bp = bannedFam.pointer(skill.rel);
    const found = listFiles(skill.dir)
      .filter((f) => cfg.bannedSkillFiles.includes(path.basename(f)))
      .map((f) => rel(root, f));
    bp.assert(found.length === 0,
      `${skill.rel} contains banned file(s): ${found.join(', ')} — these are never legal inside a skill folder`);

    // --- reference depth, archaeology, absolute paths -----------------------
    for (const f of listFiles(skill.dir)) {
      const r = rel(root, f);
      if (skipped(cfg, r)) continue;

      const refMatch = /\/references\/(.+)$/.exec(r);
      if (refMatch) {
        const dp = depthFam.pointer(r);
        const depth = refMatch[1].split('/').length;
        const w = waiverFor(cfg, r);
        const allowed = w && typeof w.deepReferences === 'number' ? w.deepReferences : 1;
        dp.assert(depth <= allowed,
          `${r} is ${depth} level(s) below references/; only references/*.md is legal — deeper nesting truncates under partial reads`);
      }

      if (!f.endsWith('.md') && !f.endsWith('.json')) continue;
      const body = readText(f);
      if (body === null) continue;

      const ap = absFam.pointer(r);
      const abs = findAbsolutePath(body);
      const absWaiver = waiverFor(cfg, r);
      const absAllowed = absWaiver ? absWaiver.absolutePath === true : false;
      ap.assert(abs === null || absAllowed,
        `${r} contains a machine-local absolute path ("${abs}"); forward slashes and repo-relative paths only. ` +
        'A generated asset carrying one is unreproducible on any other machine.');

      if (!f.endsWith('.md')) continue;
      const hp = archFam.pointer(r);
      const hits = archaeologyHits(body, cfg.archaeologyPatterns);
      const w = waiverFor(cfg, r);
      const allowed = w && typeof w.archaeology === 'number' ? w.archaeology : 0;
      if (hits.length > allowed) {
        const shown = hits.slice(0, 4).map((h) => `${r}:${h.line} /${h.pattern}/ "${h.excerpt}"`);
        hp.fail(`${hits.length} archaeology match(es) against an allowance of ${allowed}:\n        ${shown.join('\n        ')}` +
          (hits.length > 4 ? `\n        ...and ${hits.length - 4} more` : ''));
      } else {
        hp.check();
      }
    }
  }

  // ---- root file caps -------------------------------------------------------
  const fileFam = fams.get('file-caps');
  for (const [name, cap] of Object.entries(cfg.files)) {
    const p = fileFam.pointer(name);
    const abs = path.join(root, name);
    const text = readText(abs);
    if (text === null) { p.fail(`${name} does not exist`); continue; }
    const bytes = normalisedByteSize(abs);
    const lines = lineCount(text);
    const problems = [];
    if (bytes > cap.bytes) problems.push(`${bytes} B over the ${cap.bytes} B cap`);
    if (lines > cap.lines) problems.push(`${lines} lines over the ${cap.lines}-line cap`);
    if (problems.length) p.fail(`${name}: ${problems.join('; ')}`);
    else p.check(2);

    const hp = archFam.pointer(name);
    const hits = archaeologyHits(text, cfg.archaeologyPatterns);
    const w = waiverFor(cfg, name);
    const allowed = w && typeof w.archaeology === 'number' ? w.archaeology : 0;
    if (hits.length > allowed) {
      const shown = hits.slice(0, 4).map((h) => `${name}:${h.line} /${h.pattern}/ "${h.excerpt}"`);
      hp.fail(`${hits.length} archaeology match(es) against an allowance of ${allowed}:\n        ${shown.join('\n        ')}`);
    } else hp.check();
  }

  // ---- waiver expiry: a waiver outliving its WP is a hard failure -----------
  const wFam = fams.get('waiver-expiry');
  const done = completedWps(root);
  if (cfg.waivers.length === 0) {
    wFam.pointer('waivers#none-declared').check();
  } else {
    for (const w of cfg.waivers) {
      const p = wFam.pointer(w.path);
      const problems = [];
      if (!w.until) problems.push('has no `until` WP id');
      if (!/^D-\d{3}$/.test(w.decision || '')) problems.push('has no D-0NN decision id authorising it');
      if (w.until && done.has(w.until) && fs.existsSync(path.join(root, w.path))) {
        problems.push(`${w.until} is recorded complete in BUILD-LOG.md but ${w.path} still exists`);
      }
      if (problems.length) p.fail(`waiver for ${w.path}: ${problems.join('; ')}`);
      else p.check(3);
    }
  }

  return fams.list;
}

// ---------------------------------------------------------------------------
// --baseline: write waivers from MEASURED sizes. It refuses to raise an
// existing allowance, so the only direction a waiver can move is down.
// ---------------------------------------------------------------------------

/**
 * @param {string} root
 * @returns {Promise<number>}
 */
async function baseline(root) {
  const cfg = loadConfig(root);
  if (!cfg) { console.error('g-prose-budget --baseline: prose-budget.json is unreadable'); return 2; }
  cfg.waivers = cfg.waivers || [];
  /** @type {Map<string, Waiver>} */
  const byPath = new Map(cfg.waivers.map((w) => [w.path, w]));
  let raised = 0;

  /**
   * @param {string} relPath
   * @param {Partial<Waiver>} measured
   */
  const record = (relPath, measured) => {
    const existing = byPath.get(relPath);
    if (!existing) {
      const expiry = waiverExpiryFor(cfg, relPath);
      byPath.set(relPath, /** @type {Waiver} */ ({
        path: relPath, ...measured,
        until: measured.until || expiry.until,
        decision: measured.decision || expiry.decision,
      }));
      return;
    }
    for (const key of /** @type {const} */ (['bytes', 'lines', 'archaeology', 'deepReferences'])) {
      const now = measured[key];
      const was = existing[key];
      if (typeof now !== 'number') continue;
      if (typeof was === 'number' && now > was) {
        console.error(`g-prose-budget --baseline: REFUSED to raise ${relPath} ${key} from ${was} to ${now}. ` +
          'A waiver ratchets down only; fix the regression instead.');
        raised++;
        continue;
      }
      existing[key] = now;
    }
    // Boolean allowances: recorded when still measured, DROPPED when the debt is
    // gone, so a fixed file cannot keep carrying a waiver it no longer needs.
    for (const key of /** @type {const} */ (['absolutePath', 'frontmatterNameMismatch'])) {
      if (measured[key] === true) existing[key] = true;
      else delete existing[key];
    }
  };

  for (const skill of skillDirs(root, cfg)) {
    const cap = skill.tier === 'A' ? cfg.tierA.cap : cfg.tierB.cap;
    const skillMdRel = `${skill.rel}/SKILL.md`;
    const skillMd = path.join(root, skillMdRel);
    const text = readText(skillMd);
    if (text !== null) {
      const bytes = normalisedByteSize(skillMd);
      const lines = lineCount(text);
      /** @type {Partial<Waiver>} */
      const measured = {};
      if (bytes > cap.bytes) measured.bytes = bytes;
      if (lines > cap.lines) measured.lines = lines;
      const hits = archaeologyHits(text, cfg.archaeologyPatterns);
      if (hits.length > 0) measured.archaeology = hits.length;
      if (findAbsolutePath(text) !== null) measured.absolutePath = true;
      const fm = /^---\n([\s\S]*?)\n---/.exec(text);
      const nameMatch = fm ? /^name:\s*(.+)$/m.exec(fm[1]) : null;
      if (nameMatch && nameMatch[1].trim() !== path.basename(skill.rel)) measured.frontmatterNameMismatch = true;
      if (Object.keys(measured).length) record(skillMdRel, measured);
    }
    for (const f of listFiles(path.join(root, skill.rel))) {
      const r = rel(root, f);
      if (skipped(cfg, r) || r === skillMdRel) continue;
      /** @type {Partial<Waiver>} */
      const measured = {};
      const refMatch = /\/references\/(.+)$/.exec(r);
      if (refMatch) {
        const depth = refMatch[1].split('/').length;
        if (depth > 1) measured.deepReferences = depth;
      }
      if (f.endsWith('.md') || f.endsWith('.json')) {
        const body = readText(f);
        if (body !== null) {
          if (f.endsWith('.md')) {
            const hits = archaeologyHits(body, cfg.archaeologyPatterns);
            if (hits.length > 0) measured.archaeology = hits.length;
          }
          if (findAbsolutePath(body) !== null) measured.absolutePath = true;
        }
      }
      if (Object.keys(measured).length) record(r, measured);
    }
  }

  for (const name of Object.keys(cfg.files)) {
    const text = readText(path.join(root, name));
    if (text === null) continue;
    const hits = archaeologyHits(text, cfg.archaeologyPatterns);
    if (hits.length > 0) record(name, { archaeology: hits.length, until: 'WP-10', decision: 'D-063' });
  }

  cfg.waivers = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (raised > 0) return 1;
  fs.writeFileSync(path.join(root, 'packages/verify/config/prose-budget.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`g-prose-budget --baseline: ${cfg.waivers.length} waiver(s) written from measured sizes`);
  return 0;
}

export const mutations = [
  {
    name: 'a tierA SKILL.md grows past its cap',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-design-system/SKILL.md');
      fs.appendFileSync(f, `\n${'x'.repeat(60000)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a tierA folder is renamed without updating the config',
    kind: 'repo',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const from = path.join(tmp, 'plugins/shesha-developer/skills/shesha-design-system');
      const to = path.join(tmp, 'plugins/shesha-developer/skills/shesha-designer');
      fs.renameSync(from, to);
    },
    expect: 'fail',
  },
  {
    name: 'changelog archaeology is added to an instruction file',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-design-system/SKILL.md');
      fs.appendFileSync(f, '\nThis field used to be called accent and has been renamed; do not fix the above.\n');
    },
    expect: 'fail',
  },
  {
    name: 'a README.md appears inside a skill folder',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'plugins/shesha-developer/skills/shesha-design-system/README.md');
      fs.writeFileSync(f, '# not allowed here\n');
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { repoRoot } = await import('../lib/fsx.mjs');
  const root = repoRoot();
  if (process.argv.includes('--baseline')) {
    process.exit(await baseline(root));
  }
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: root });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
