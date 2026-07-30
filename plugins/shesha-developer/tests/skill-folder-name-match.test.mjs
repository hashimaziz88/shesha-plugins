import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: every skill's folder name equals its frontmatter `name`
 * (docs/RECONCILIATION.md's "Guard tests to add", item 4; repo CLAUDE.md's
 * own "skill folder name must match frontmatter name" convention).
 *
 * One known, pre-existing violation: `skills/add-public-portal/` declares
 * `name: shesha-public-portal`. It is a real drift (skill selection and any
 * tooling that keys off the folder name for this skill will disagree with
 * whatever keys off its declared `name`), but it is explicitly out of this
 * task's edit scope — the task that produced this guard test was scoped
 * away from touching `add-public-portal`, since it was being worked on
 * elsewhere. Rather than silently ignore it (which would let a SECOND
 * mismatch land unnoticed) or weaken the assertion for every skill, this is
 * a single, named, narrowly-scoped allowance: it fails loudly if the
 * mismatch's shape changes (e.g. the declared name changes to something
 * else), and it does nothing for any other skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, '..', 'skills');

/**
 * Known out-of-scope exception: folder -> its current (wrong) declared name.
 * Do not add to this list to silence a NEW mismatch — fix the drift instead.
 */
const KNOWN_OUT_OF_SCOPE_MISMATCH = {
  'add-public-portal': 'shesha-public-portal',
};

function frontmatterName(skillMdPath) {
  const text = readFileSync(skillMdPath, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, `${skillMdPath} has no YAML frontmatter`);
  const m = /^name:\s*(\S+)/m.exec(fm[1]);
  assert.ok(m, `${skillMdPath} frontmatter has no name`);
  return m[1].trim();
}

test('every skill folder name matches its frontmatter name (or is the recorded out-of-scope exception)', () => {
  const offenders = [];
  const exceptionsSeen = new Set();
  for (const entry of readdirSync(SKILLS_DIR)) {
    if (entry.startsWith('.')) continue;
    const skillMd = join(SKILLS_DIR, entry, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const declared = frontmatterName(skillMd);
    if (declared === entry) continue;
    if (KNOWN_OUT_OF_SCOPE_MISMATCH[entry] === declared) {
      exceptionsSeen.add(entry);
      continue;
    }
    offenders.push(`skills/${entry}/SKILL.md declares name: "${declared}", folder is "${entry}"`);
  }
  assert.deepEqual(
    offenders, [],
    `these skills' folder names don't match their frontmatter name (rename the folder or the `
    + `frontmatter to agree): ${offenders.join('; ')}`,
  );
  // Guard the exception itself: if add-public-portal's mismatch gets fixed,
  // update KNOWN_OUT_OF_SCOPE_MISMATCH instead of leaving a stale allowance.
  for (const folder of Object.keys(KNOWN_OUT_OF_SCOPE_MISMATCH)) {
    const skillMd = join(SKILLS_DIR, folder, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    assert.ok(
      exceptionsSeen.has(folder),
      `expected skills/${folder}/SKILL.md to still declare name: "${KNOWN_OUT_OF_SCOPE_MISMATCH[folder]}" `
      + `— if this was fixed, remove it from KNOWN_OUT_OF_SCOPE_MISMATCH`,
    );
  }
});
