import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Skill-trigger collision guard.
 *
 * Three of the four design skills used to claim the same trigger phrasing:
 * shesha-claude-designer ("MATCH a design they have"),
 * shesha-design-comprehension ("must match a specific visual design"), and
 * shesha-design-system ("needs to LOOK like a specific design or brand —
 * 'make it match the design'"). Skill selection is nondeterministic, so which
 * one fired varied run to run — the same query could trigger one on one run
 * and another on the next.
 *
 * The resolution: shesha-claude-designer OWNS the design-matching trigger.
 * The others are sub-skills, described by what they own rather than by the
 * user phrasing that reaches the orchestrator.
 *
 * This test exists because that is a measurable property, and a rule nobody
 * measures drifts back.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, '..', 'skills');

/** The orchestrator owns these; no other skill may claim them. */
const RESERVED_TRIGGER_PHRASES = [
  'match a design',
  'match the design',
  'matches a design',
  'match a specific visual design',
  'look like a specific design',
  'looks like the design',
];

const OWNER = 'shesha-claude-designer';
const DESIGN_SKILLS = [
  'shesha-claude-designer',
  'shesha-design-comprehension',
  'shesha-design-system',
  'shesha-form-edit',
];

/** Minimal frontmatter reader — the description may span multiple lines. */
function readDescription(skill) {
  const p = join(SKILLS_DIR, skill, 'SKILL.md');
  assert.ok(existsSync(p), `missing SKILL.md for ${skill}`);
  const text = readFileSync(p, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, `${skill}/SKILL.md has no YAML frontmatter`);
  const m = /^description:\s*([\s\S]*?)(?=\r?\n[a-zA-Z-]+:\s|\s*$)/m.exec(fm[1]);
  assert.ok(m, `${skill}/SKILL.md frontmatter has no description`);
  return m[1].replace(/\s+/g, ' ').trim();
}

test('every design skill has a description', () => {
  for (const s of DESIGN_SKILLS) {
    const d = readDescription(s);
    assert.ok(d.length > 0, `${s} has an empty description`);
  }
});

test('descriptions stay within the 1024-character frontmatter limit', () => {
  for (const s of DESIGN_SKILLS) {
    const d = readDescription(s);
    assert.ok(d.length <= 1024, `${s} description is ${d.length} chars, limit is 1024`);
  }
});

test('no reserved design-matching trigger is claimed by more than one skill', () => {
  const claims = new Map(); // phrase -> [skills]
  for (const s of DESIGN_SKILLS) {
    const d = readDescription(s).toLowerCase();
    for (const phrase of RESERVED_TRIGGER_PHRASES) {
      if (d.includes(phrase)) {
        if (!claims.has(phrase)) claims.set(phrase, []);
        claims.get(phrase).push(s);
      }
    }
  }
  const collisions = [...claims.entries()].filter(([, skills]) => skills.length > 1);
  assert.deepEqual(
    collisions, [],
    `trigger collision — these phrases are claimed by more than one skill: ${
      collisions.map(([p, s]) => `"${p}" by ${s.join(' + ')}`).join('; ')}`,
  );
});

test('only the orchestrator claims a design-matching trigger', () => {
  for (const s of DESIGN_SKILLS) {
    if (s === OWNER) continue;
    const d = readDescription(s).toLowerCase();
    const claimed = RESERVED_TRIGGER_PHRASES.filter((p) => d.includes(p));
    assert.deepEqual(
      claimed, [],
      `${s} claims ${JSON.stringify(claimed)} — that trigger belongs to ${OWNER}. `
      + 'Describe a sub-skill by what it owns, not by the phrasing that reaches the orchestrator.',
    );
  }
});

test('the orchestrator does still claim its trigger', () => {
  // Guards the opposite failure: stripping the collision by stripping every
  // claim would leave nothing to route a design request to.
  const d = readDescription(OWNER).toLowerCase();
  const claimed = RESERVED_TRIGGER_PHRASES.filter((p) => d.includes(p));
  assert.ok(claimed.length > 0,
    `${OWNER} claims no design-matching trigger — a design request would have nowhere to route`);
});

test('sub-skill descriptions say they are sub-skills', () => {
  // A sub-skill that reads like an entry point gets selected like one.
  for (const s of ['shesha-design-comprehension', 'shesha-design-system']) {
    const d = readDescription(s).toLowerCase();
    assert.match(d, /sub-skill/, `${s} should identify itself as a sub-skill`);
  }
});

test('descriptions are third person, not first or second', () => {
  // The description is injected into a system prompt; inconsistent point of
  // view degrades skill discovery.
  for (const s of DESIGN_SKILLS) {
    const d = readDescription(s);
    assert.doesNotMatch(d, /\bI can\b|\bI will\b/i, `${s} description uses first person`);
    assert.doesNotMatch(d, /\byou can use this\b/i, `${s} description uses second person`);
  }
});
