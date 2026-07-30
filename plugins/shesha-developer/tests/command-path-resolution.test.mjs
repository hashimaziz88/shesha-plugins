import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: every path cited in `commands/*.md` resolves from the citing file
 * (docs/RECONCILIATION.md's "Guard tests to add", item 3).
 *
 * The three commands cite paths three different ways:
 *   - fully skill-qualified (`shesha-form-edit/references/archetypes.md`)
 *   - repo-root-qualified (`plugins/shesha-developer/skills/shesha-form-edit/scripts/`)
 *   - bare, relying on prose context established earlier in the same file
 *     (`backend-probe.mjs`, `validate-schema.js`, ...) — each of these
 *     commands names exactly one skill it hands off to
 *     (`shesha-developer:shesha-form-edit`, `shesha-developer:shesha-gym`) or
 *     cites the owning directory outright just before the bare names, and
 *     every bare name in these three files is one of that skill's own
 *     `scripts/`/`references/` files (verified by hand against the tree
 *     when this test was written — `backend-probe.mjs`,
 *     `validate-schema.js`, `validate-guardrails.js`, `resolve-bindings.js`,
 *     `validate-styledness.js` all live under
 *     `shesha-form-edit/scripts/`).
 *
 * This test resolves the first two forms directly. For the third, it uses
 * the same context clue a reader would: the `shesha-developer:<skill>`
 * mention or the explicit directory citation earlier in the file. It does
 * NOT invent a general path-inference mechanism beyond that — a bare
 * filename in a command with neither clue would be reported as
 * unresolvable rather than guessed at.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');
const COMMANDS_DIR = join(PLUGIN_ROOT, 'commands');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');

const skillNames = new Set(
  readdirSync(SKILLS_DIR).filter((s) => !s.startsWith('.') && existsSync(join(SKILLS_DIR, s, 'SKILL.md'))),
);

function extractBacktickSpans(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => ({ token: m[1], index: m.index }));
}

/** A clean file path: word/dot/slash/hyphen only, ending in a known extension. */
const FILE_TOKEN = /^[\w./-]+\.(md|js|mjs|json)$/;
/** A clean directory path: ends in a trailing slash. */
const DIR_TOKEN = /^[\w./-]+\/$/;
/** Bare filename, no directory at all. */
const BARE_FILE = /^[\w.-]+\.(md|js|mjs|json)$/;

function resolveQualified(token) {
  const firstSeg = token.split('/')[0];
  if (firstSeg === 'plugins') return join(REPO_ROOT, token);
  if (skillNames.has(firstSeg)) return join(SKILLS_DIR, token);
  return null; // not a recognizably-qualified path
}

test('every path cited in commands/*.md resolves from the citing file', () => {
  const offenders = [];
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0, `expected command files under ${COMMANDS_DIR}`);

  for (const file of files) {
    const path = join(COMMANDS_DIR, file);
    const text = readFileSync(path, 'utf8');
    const spans = extractBacktickSpans(text);

    // Context clues, in the order a reader would meet them.
    const skillMention = /shesha-developer:([a-z0-9-]+)/.exec(text);
    const contextSkill = skillMention && skillNames.has(skillMention[1]) ? skillMention[1] : null;

    let contextDir = null;
    for (const { token } of spans) {
      if (DIR_TOKEN.test(token)) {
        const asRepoRoot = join(REPO_ROOT, token);
        if (existsSync(asRepoRoot)) { contextDir = asRepoRoot; break; }
        const asSkillsRoot = join(SKILLS_DIR, token);
        if (existsSync(asSkillsRoot)) { contextDir = asSkillsRoot; break; }
      }
    }
    if (!contextDir && contextSkill) {
      // Fall back to the named skill's scripts/ dir — every bare filename
      // actually seen in these commands is a script.
      contextDir = join(SKILLS_DIR, contextSkill, 'scripts');
    }

    for (const { token } of spans) {
      if (DIR_TOKEN.test(token)) {
        const resolved = resolveQualified(token) ?? (contextDir && join(contextDir, '..'));
        const ok = existsSync(join(REPO_ROOT, token)) || existsSync(join(SKILLS_DIR, token));
        if (!ok) offenders.push(`${file}: directory "${token}" does not resolve`);
        continue;
      }
      if (FILE_TOKEN.test(token) && token.includes('/')) {
        const resolved = resolveQualified(token);
        if (resolved) {
          if (!existsSync(resolved)) offenders.push(`${file}: "${token}" does not resolve (tried ${resolved})`);
          continue;
        }
        // Slash-bearing but not skill/plugins-qualified (e.g. "scripts/x.mjs") — use context.
        if (contextDir) {
          const rel = token.includes('/') ? basename(token) : token;
          const candidate = join(contextDir, rel);
          if (!existsSync(candidate)) offenders.push(`${file}: "${token}" does not resolve under context dir ${contextDir}`);
          continue;
        }
        offenders.push(`${file}: "${token}" has no recognizable skill/plugins prefix and no context directory to resolve it against`);
        continue;
      }
      if (BARE_FILE.test(token)) {
        if (!contextDir) {
          offenders.push(`${file}: bare filename "${token}" has neither a shesha-developer:<skill> mention nor an explicit directory citation to resolve it against`);
          continue;
        }
        const candidate = join(contextDir, token);
        if (!existsSync(candidate)) offenders.push(`${file}: "${token}" does not resolve under context dir ${contextDir}`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    `these paths cited in commands/*.md do not resolve: ${offenders.join('; ')}`,
  );
});
