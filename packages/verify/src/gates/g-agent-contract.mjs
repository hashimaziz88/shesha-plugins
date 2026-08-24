// §4.1.2: the agent files are proved as files. g-agent-contract walks all 6 files in
// plugins/shesha-developer/agents/ and asserts, for each: frontmatter `name` equals the
// basename; `tools` and `disallowedTools` are present and disjoint; no list contains
// MultiEdit; file size <= 4096 B; the body has no `## Hard stops` heading. Plus the
// role-specific tool restrictions. A rule that has an enforcer is not restated in prose;
// this gate is that enforcer.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-agent-contract';
export const describe = 'every agent file: name==basename, tools/disallowedTools present+disjoint, no MultiEdit, <=4096 B, no Hard stops; role tool restrictions';
export const inputPaths = ['plugins/shesha-developer/agents'];

const AGENTS = 'plugins/shesha-developer/agents';
const MAX_BYTES = 4096;

/** Parse the leading `---` frontmatter block into {key: rawValue} plus the body. @param {string} text */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: /** @type {Record<string,string>} */ ({}), body: text };
  /** @type {Record<string,string>} */
  const fm = {};
  for (const line of (m[1] || '').split('\n')) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv && kv[1]) fm[kv[1]] = (kv[2] || '').trim();
  }
  return { fm, body: m[2] || '' };
}

/** A comma-separated frontmatter list into a trimmed array. @param {string|undefined} v */
function list(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'frontmatter', unit: 'file' },
    { name: 'roles', unit: 'assertion' },
  ]);
  const fmFam = fams.get('frontmatter');
  const roleFam = fams.get('roles');

  const dir = path.join(root, AGENTS);
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { /* dir absent */ }

  /** @type {Record<string, {tools:string[], disallowed:string[]}>} */
  const seen = {};
  for (const n of names) {
    const full = path.join(dir, n);
    const text = fs.readFileSync(full, 'utf8');
    const { fm, body } = parseFrontmatter(text);
    const base = n.replace(/\.md$/, '');
    const tools = list(fm.tools);
    const disallowed = list(fm.disallowedTools);
    seen[base] = { tools, disallowed };
    const problems = [];
    if (fm.name !== base) problems.push(`frontmatter name "${fm.name}" != basename "${base}"`);
    if (tools.length === 0) problems.push('no `tools`');
    if (disallowed.length === 0) problems.push('no `disallowedTools`');
    const overlap = tools.filter((t) => disallowed.includes(t));
    if (overlap.length) problems.push(`tools and disallowedTools overlap: ${overlap.join(', ')}`);
    if (tools.includes('MultiEdit') || disallowed.includes('MultiEdit')) problems.push('lists MultiEdit (not a tool in current Claude Code)');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_BYTES) problems.push(`${bytes} B over the ${MAX_BYTES} B cap`);
    if (/^##\s+Hard stops\s*$/m.test(body)) problems.push('has a `## Hard stops` heading (a rule with an enforcer is not restated in prose)');
    fmFam.pointer(`${AGENTS}/${n}`).assert(problems.length === 0, `${n}: ${problems.join('; ')}`);
  }

  // Role-specific restrictions.
  const need = (/** @type {string} */ role, /** @type {'tools'|'disallowed'} */ key, /** @type {string[]} */ must) => {
    const a = seen[role];
    const p = roleFam.pointer(`${role}.${key}`);
    if (!a) { p.fail(`${role}.md is missing`); return; }
    const have = a[key];
    const missing = must.filter((t) => !have.includes(t));
    p.assert(missing.length === 0, `${role}.${key} must contain ${missing.join(', ')}`);
  };
  need('sfs-specwriter', 'disallowed', ['Bash', 'mcp__shesha-sfs__push']);
  need('sfs-evaluator', 'disallowed', ['Bash', 'Write', 'Edit']);
  {
    const dc = seen['design-critic'];
    const p = roleFam.pointer('design-critic.tools');
    if (!dc) p.fail('design-critic.md is missing');
    else p.assert(dc.tools.length === 1 && dc.tools[0] === 'Read', `design-critic.tools must be exactly "Read", got ${JSON.stringify(dc.tools)}`);
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'Bash is added to sfs-evaluator.tools, colliding with its disallowedTools',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, AGENTS, 'sfs-evaluator.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^tools:\s*(.*)$/m, 'tools: $1, Bash'));
    },
    expect: 'fail',
  },
  {
    name: 'an agent file is renamed without renaming its frontmatter name',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const d = path.join(tmp, AGENTS);
      fs.renameSync(path.join(d, 'design-critic.md'), path.join(d, 'renamed-critic.md'));
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
