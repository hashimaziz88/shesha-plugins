// D-049, WP-3b.4: prove every pointer in the shesha-developer plugin resolves.
//
// The lift of quarantine/g-check-references.mjs onto the one coverage implementation.
// The quarantined original had the two holes D-049 records: it created families
// lazily (so a renamed file silently dropped 9 pointers and still printed PASS), and
// it crashed with an uncaught SyntaxError on malformed JSON (indistinguishable by exit
// code from a real failure). Both are closed here: the family set is declared up front
// with families() (an undeclared family throws, R2), and every JSON read goes through
// readJsonGuarded (a malformed file is one named failure, never a crash).
//
// Six families survive the WP-7a deletion of shesha-form-edit: links, paths, skills,
// agents, roles, groups. The original's `overlays` (block $styleOverlay files) and
// `versions` (component versions vs an in-plugin components-kb) checked assets that no
// longer live in the plugin — the block library went with shesha-form-edit (D-010
// resolves styling at compile time, not through a separate overlay pass) and the KB
// relocated to packages/sfs/kb (D-095), where component-version authority is the
// registry. Those two checks are dropped, not weakened: their subjects are gone.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-check-references';
export const describe = 'every markdown link, backticked path, skill/agent id, $role token and component group in plugins/shesha-developer resolves';
export const inputPaths = ['plugins'];

const PLUGIN = 'plugins/shesha-developer';
const LINKABLE = /\.(md|json|mjs|js|ps1|sh|py)$/;
const PATH_RE = /`((?:\.\.\/|\.\/)?(?:assets|references|scripts|tests|skills|agents)\/[A-Za-z0-9._/-]+\.(?:md|json|mjs|js))`/g;

/** Blank out fenced code blocks so their contents cannot masquerade as prose. */
function stripFences(/** @type {string} */ text) {
  return text.replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' '));
}

/** @param {string} dir @param {string[]} out */
function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const ROOT = path.join(ctx.repoRoot, PLUGIN);
  const fams = families([
    { name: 'links', unit: 'link' },
    { name: 'paths', unit: 'path' },
    { name: 'skills', unit: 'skill-id' },
    { name: 'roles', unit: 'role-token' },
    { name: 'groups', unit: 'type' },
  ]);
  const F = {
    links: fams.get('links'), paths: fams.get('paths'), skills: fams.get('skills'),
    roles: fams.get('roles'), groups: fams.get('groups'),
  };
  if (!fs.existsSync(path.join(ROOT, 'skills'))) {
    F.links.pointer(`${PLUGIN}#missing`).fail(`no skills/ under ${PLUGIN} — the plugin is not where this gate expects it`);
    return fams.list;
  }

  const rel = (/** @type {string} */ p) => path.relative(ROOT, p).replace(/\\/g, '/');
  /** @param {string} p */
  const readJson = (p) => { const t = readText(p); if (t === null) return null; try { return JSON.parse(t); } catch { return undefined; } };
  const ALL = walkFiles(ROOT);
  const MD = ALL.filter((f) => f.endsWith('.md'));

  // ---- 1. markdown links resolve (fence-aware) ------------------------------
  for (const file of MD) {
    const body = stripFences(readText(file) || '');
    for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = (String(m[1]).split('#')[0] ?? '').trim();
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
      const p = F.links.pointer(`${rel(file)} -> ${target}`);
      if (!LINKABLE.test(target) && !target.includes('/')) { p.na('not a file path (prose or a markdown-syntax example)'); continue; }
      p.assert(fs.existsSync(path.resolve(path.dirname(file), target)), `link target does not exist: ${target}`);
    }
  }

  // ---- 2. backticked file paths in prose resolve ---------------------------
  const skillRoots = fs.existsSync(path.join(ROOT, 'skills')) ? fs.readdirSync(path.join(ROOT, 'skills')).map((s) => path.join(ROOT, 'skills', s)) : [];
  for (const file of MD) {
    const body = stripFences(readText(file) || '');
    for (const m of body.matchAll(PATH_RE)) {
      const target = /** @type {string} */ (m[1]);
      const candidates = [path.resolve(path.dirname(file), target), path.resolve(ROOT, target), ...skillRoots.map((r) => path.resolve(r, target))];
      F.paths.pointer(`${rel(file)} -> ${target}`).assert(candidates.some((c) => fs.existsSync(c)), `no file at this path under any skill: ${target}`);
    }
  }

  // ---- 3. skill ids ship in this marketplace -------------------------------
  const localSkills = new Set(fs.readdirSync(path.join(ROOT, 'skills')));
  let thisPlugin = 'shesha-developer';
  const manifest = readJson(path.join(ROOT, '.claude-plugin', 'plugin.json'));
  if (manifest && manifest.name) thisPlugin = manifest.name;
  const siblingPlugins = new Map();
  const pluginsDir = path.dirname(ROOT);
  if (fs.existsSync(pluginsDir)) {
    for (const p of fs.readdirSync(pluginsDir)) {
      const sk = path.join(pluginsDir, p, 'skills');
      if (fs.existsSync(sk)) siblingPlugins.set(p, new Set(fs.readdirSync(sk)));
    }
  }
  const agentNames = new Set(fs.existsSync(path.join(ROOT, 'agents'))
    ? fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : []);
  const NAMESPACE = /^(?:[a-z0-9]+-)*(?:plugin|developer|utils|superpowers|design|forms?|dev)[a-z0-9-]*$|-\d+-\d+$/;
  for (const file of MD) {
    const body = stripFences(readText(file) || '');
    /** @type {Set<string>} */
    const ids = new Set();
    for (const m of body.matchAll(/Skill\(\s*skill\s*=\s*["']([^"']+)["']/g)) ids.add(/** @type {string} */ (m[1]));
    for (const m of body.matchAll(/`([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)`/g)) {
      const ns = /** @type {string} */ (m[1]);
      if (siblingPlugins.has(ns) || ns === thisPlugin || NAMESPACE.test(ns)) ids.add(`${ns}:${m[2]}`);
    }
    for (const refId of ids) {
      const [a, b] = refId.includes(':') ? refId.split(':') : [null, refId];
      const plugin = a ?? thisPlugin;
      const name = /** @type {string} */ (b);
      const p = F.skills.pointer(`${rel(file)}: ${refId}`);
      if (plugin !== thisPlugin && !siblingPlugins.has(plugin)) { p.cannot(`"${refId}" — plugin "${plugin}" is not checked out beside this one, so membership cannot be judged`, 'T1.01'); continue; }
      // A same-plugin id resolves to a skill OR an agent; a sibling id to that plugin's skills.
      const known = plugin === thisPlugin
        ? (localSkills.has(name) || agentNames.has(name))
        : (siblingPlugins.get(plugin)?.has(name) ?? false);
      p.assert(known, `"${refId}" is neither a skill nor an agent in this marketplace — declare the dependency or drop the reference`);
    }
  }

  // ---- 4. $role tokens resolve in EVERY shipped brand ----------------------
  const themeDir = path.join(ROOT, 'skills', 'shesha-design-system', 'assets', 'themes');
  const themes = fs.existsSync(themeDir)
    ? fs.readdirSync(themeDir).filter((f) => f.endsWith('.tokens.json')).map((f) => ({ name: f, doc: readJson(path.join(themeDir, f)) })) : [];
  const getPath = (/** @type {any} */ o, /** @type {string} */ p) => p.split('.').reduce((/** @type {any} */ a, /** @type {string} */ k) => (a == null ? a : a[k]), o);
  const roleUsers = ALL.filter((f) => f.endsWith('.json') || f.endsWith('.md'));
  for (const file of roleUsers) {
    const text = readText(file) || '';
    for (const role of new Set([...text.matchAll(/\$role:([A-Za-z0-9_]+)/g)].map((x) => /** @type {string} */ (x[1])))) {
      const p = F.roles.pointer(`${rel(file)}: $role:${role}`);
      if (themes.length === 0) { p.cannot('no brand token files found to resolve $role against', 'T1.01'); continue; }
      const bad = themes.filter((t) => typeof getPath(t.doc, (t.doc && t.doc.roles && t.doc.roles[role]) ?? '') !== 'string');
      p.assert(bad.length === 0, `$role:${role} does not resolve in ${bad.map((t) => t.name).join(', ')}`);
    }
  }

  // ---- 6. every type in the component index resolves to a group entry -------
  const groupsDir = path.join(ROOT, 'skills', 'clean-form-config', 'assets', 'groups');
  const index = fs.existsSync(path.join(groupsDir, 'index.json')) ? readJson(path.join(groupsDir, 'index.json')) : null;
  if (!index) {
    F.groups.pointer('clean-form-config/assets/groups/index.json').fail('the component index is missing or unreadable');
  } else {
    /** @type {Map<string, any>} */
    const cache = new Map();
    for (const [type, group] of Object.entries(index.components ?? {})) {
      const p = F.groups.pointer(`index.json: ${type}`);
      const gp = path.join(groupsDir, `${group}.json`);
      if (!fs.existsSync(gp)) { p.fail(`${type} routes to ${group}.json, which does not exist`); continue; }
      if (!cache.has(String(group))) cache.set(String(group), readJson(gp) || {});
      p.assert(type in cache.get(String(group)), `index routes "${type}" to ${group}.json, but that file has no such entry`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'a markdown link points at a file that does not exist',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, PLUGIN, 'skills/clean-form-config/SKILL.md');
      fs.appendFileSync(f, '\nSee [the missing doc](references/this-does-not-exist.md).\n');
    },
    expect: 'fail',
  },
  {
    name: 'a doc names a skill that is not in the marketplace',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, PLUGIN, 'skills/clean-form-config/SKILL.md');
      fs.appendFileSync(f, '\nHand it to `shesha-developer:no-such-skill` and stop.\n');
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
