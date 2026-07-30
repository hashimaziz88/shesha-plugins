import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
 *
 * Widened per docs/RECONCILIATION.md's "Guard tests to add" (P1 #11's own
 * fix showed the collision surface is bigger than "the four design skills"):
 * every skill's SKILL.md, every agents/*.md, and every commands/*.md is now
 * scanned — a trigger phrase can be claimed just as wrongly by an agent or a
 * slash command as by a sub-skill. The reserved design-matching phrase is no
 * longer six hard-coded strings; it is derived at test time from the
 * orchestrator's own quoted examples, so a future edit to those examples
 * automatically updates what this test watches for instead of silently
 * going stale.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..'); // tests/ -> plugins/shesha-developer
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');
const AGENTS_DIR = join(PLUGIN_ROOT, 'agents');
const COMMANDS_DIR = join(PLUGIN_ROOT, 'commands');

const OWNER_ID = 'shesha-claude-designer';
const OWNER_REL = 'skills/shesha-claude-designer/SKILL.md';

/**
 * The two skills whose descriptions must self-identify as sub-skills (they
 * are execution layers under the orchestrator, not entry points, and a
 * description that reads like an entry point gets selected like one). This
 * list is intentionally NOT widened to every skill: most skills in the repo
 * (domain-model, shesha-settings, ...) are standalone entry points and have
 * no "sub-skill" concept to assert.
 */
const REQUIRED_SUB_SKILLS = ['shesha-design-comprehension', 'shesha-design-system'];

/** Every skill's SKILL.md (skip non-skill dirs such as .claude-designer-logs/). */
function listSkillFiles() {
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    if (entry.startsWith('.')) continue;
    const p = join(SKILLS_DIR, entry, 'SKILL.md');
    if (existsSync(p)) out.push({ id: entry, rel: `skills/${entry}/SKILL.md`, path: p });
  }
  return out;
}

function listMdFiles(dir, relPrefix) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    out.push({ id: entry.replace(/\.md$/, ''), rel: `${relPrefix}/${entry}`, path: join(dir, entry) });
  }
  return out;
}

/** Every SKILL.md / agents/*.md / commands/*.md this plugin ships. */
function allSurfaces() {
  return [
    ...listSkillFiles(),
    ...listMdFiles(AGENTS_DIR, 'agents'),
    ...listMdFiles(COMMANDS_DIR, 'commands'),
  ];
}

/**
 * Frontmatter `description:` reader. Handles both forms actually in use in
 * this plugin:
 *   description: <text that may keep going on the next physical line(s),
 *     ending at the next top-level frontmatter key>
 * and the YAML folded/literal block scalar form (skills/add-public-portal
 * uses `description: >-` with the real text indented on following lines).
 */
function readDescription(surface) {
  const text = readFileSync(surface.path, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, `${surface.rel} has no YAML frontmatter`);
  const lines = fm[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^description:/.test(l));
  assert.ok(idx !== -1, `${surface.rel} frontmatter has no description`);
  const firstLine = lines[idx].replace(/^description:\s*/, '');
  if (/^[>|][-+0-9]*$/.test(firstLine.trim()) || firstLine.trim() === '') {
    // Block scalar: consume indented (or blank) lines until dedent.
    const block = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\s+\S/.test(lines[i]) || lines[i].trim() === '') block.push(lines[i]);
      else break;
    }
    return block.join(' ').replace(/\s+/g, ' ').trim();
  }
  const rest = [firstLine];
  for (let i = idx + 1; i < lines.length; i++) {
    // Next frontmatter key. The `(\s|$)` alternation matters: a key introducing
    // a block list has NOTHING after its colon (`allowed-tools:` then an
    // indented `- Bash` list), so a bare `:\s` never matched it and the whole
    // tool list was swallowed into the description — which measured
    // shesha-form-edit at 1092 chars instead of its real 977 and produced a
    // false over-limit exception below.
    if (/^[a-zA-Z][a-zA-Z-]*:(\s|$)/.test(lines[i])) break;
    rest.push(lines[i]);
  }
  return rest.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * TWO surfaces pre-date this guard test and genuinely exceed the 1024-char
 * frontmatter limit. Both are outside the edit scope the user set for the
 * designer rework, so they are recorded rather than silently passed: the
 * allowance is keyed by exact rel path so a NEW offender still fails loudly,
 * and so does any further growth of these two beyond the length recorded here.
 *
 * `shesha-form-edit` was originally listed here at 1092 — that was a
 * measurement artefact of the swallowed `allowed-tools:` block above, not a
 * real violation. It measures 977 and is held to the normal limit.
 */
const KNOWN_OVER_LIMIT = {
  'skills/shesha-domain-events/SKILL.md': 1253,
  'skills/clean-form-config/SKILL.md': 1167,
};

test('every skill, agent, and command has a description', () => {
  for (const surface of allSurfaces()) {
    const d = readDescription(surface);
    assert.ok(d.length > 0, `${surface.rel} has an empty description`);
  }
});

test('descriptions stay within the 1024-character frontmatter limit (or are a recorded pre-existing exception)', () => {
  for (const surface of allSurfaces()) {
    const d = readDescription(surface);
    const known = KNOWN_OVER_LIMIT[surface.rel];
    if (known !== undefined) {
      assert.ok(
        d.length <= known,
        `${surface.rel} grew from its recorded ${known} chars to ${d.length} — it was already `
        + `over the 1024 limit and out of this task's edit scope; it must not get worse`,
      );
      continue;
    }
    assert.ok(d.length <= 1024, `${surface.rel} description is ${d.length} chars, limit is 1024`);
  }
});

test('descriptions are third person, not first or second', () => {
  // The description is injected into a system prompt; inconsistent point of
  // view degrades skill discovery.
  for (const surface of allSurfaces()) {
    const d = readDescription(surface);
    assert.doesNotMatch(d, /\bI can\b|\bI will\b/i, `${surface.rel} description uses first person`);
    assert.doesNotMatch(d, /\byou can use this\b/i, `${surface.rel} description uses second person`);
  }
});

test('sub-skill descriptions say they are sub-skills', () => {
  for (const id of REQUIRED_SUB_SKILLS) {
    const surface = { id, rel: `skills/${id}/SKILL.md`, path: join(SKILLS_DIR, id, 'SKILL.md') };
    const d = readDescription(surface).toLowerCase();
    assert.match(d, /sub-skill/, `${surface.rel} should identify itself as a sub-skill`);
  }
});

/**
 * Derive the reserved design-matching phrase from the orchestrator's own
 * quoted trigger examples, instead of hard-coding six phrasings by hand.
 * shesha-claude-designer/SKILL.md's description quotes several trigger
 * examples in double quotes; exactly one of them is about matching an
 * existing design (as opposed to building/implementing one). We reduce that
 * quote to its content-bearing keywords (dropping stopwords and generic
 * verbs that would make the check trivially over-broad) and treat any other
 * surface that uses those same keywords in close proximity as claiming the
 * same trigger — this catches paraphrases ("match a specific visual
 * design", "looks like the design") without a fixed string list.
 */
function deriveDesignMatchKeywords() {
  const ownerSurface = { id: OWNER_ID, rel: OWNER_REL, path: join(SKILLS_DIR, OWNER_ID, 'SKILL.md') };
  const ownerDesc = readDescription(ownerSurface);
  const quotes = [...ownerDesc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(quotes.length > 0, `${OWNER_REL}'s description no longer quotes any trigger examples — this test can't derive a reserved phrase from it`);
  const designMatchQuote = quotes.find((q) => /\bmatch\w*\b/i.test(q) && /\bdesign\b/i.test(q));
  assert.ok(
    designMatchQuote,
    `${OWNER_REL}'s description no longer has a quoted example about matching an existing design `
    + `(e.g. "make it match the design") — this test can't derive the reserved phrase without it. `
    + `Quoted examples found: ${JSON.stringify(quotes)}`,
  );
  const STOPWORDS = new Set(['a', 'an', 'the', 'it', 'this', 'that', 'to', 'in', 'on', 'of', 'for', 'and', 'or', 'is', 'are', 'with', 'across']);
  // Generic verbs that would make the phrase-match trivially over-broad if
  // kept — the concept this test protects is "design" + "match(es/ing)",
  // not the sentence's incidental main verb.
  const GENERIC_VERBS = new Set(['make', 'build', 'get', 'have', 'do', 'use', 'need', 'want', 'create', 'implement']);
  const keywords = designMatchQuote
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w && !STOPWORDS.has(w) && !GENERIC_VERBS.has(w));
  assert.ok(
    keywords.length >= 2,
    `derived too few keywords (${JSON.stringify(keywords)}) from "${designMatchQuote}" to reserve a phrase`,
  );
  return keywords;
}

/**
 * True if `desc` claims the design-matching trigger — every derived keyword
 * appears within a short window of a "match*" occurrence — UNLESS that same
 * window explicitly names the owner (an explicit deferral, e.g.
 * shesha-custom-page-designer's "to match a specific multi-screen design,
 * use shesha-claude-designer" is routing advice, not a claim).
 */
function claimsDesignMatch(desc, keywords) {
  const dl = desc.toLowerCase();
  const matchRe = /\bmatch\w*\b/g;
  let m;
  while ((m = matchRe.exec(dl))) {
    const window = dl.slice(m.index, Math.min(dl.length, m.index + 120));
    if (keywords.every((k) => window.includes(k))) {
      if (window.includes(OWNER_ID)) continue; // explicit deferral to the owner, not a claim
      return true;
    }
  }
  return false;
}

test('no reserved design-matching trigger is claimed by more than one surface', () => {
  const keywords = deriveDesignMatchKeywords();
  const claimants = [];
  for (const surface of allSurfaces()) {
    const d = readDescription(surface);
    if (claimsDesignMatch(d, keywords)) claimants.push(surface.rel);
  }
  assert.deepEqual(
    claimants, [OWNER_REL],
    `expected only ${OWNER_REL} to claim the design-matching trigger (derived keywords: `
    + `${JSON.stringify(keywords)}), but found: ${claimants.join(', ')}`,
  );
});

test('only the orchestrator claims a design-matching trigger', () => {
  const keywords = deriveDesignMatchKeywords();
  for (const surface of allSurfaces()) {
    if (surface.rel === OWNER_REL) continue;
    const d = readDescription(surface);
    assert.ok(
      !claimsDesignMatch(d, keywords),
      `${surface.rel} claims the design-matching trigger (derived keywords: ${JSON.stringify(keywords)}) `
      + `— that trigger belongs to ${OWNER_ID}. Describe it by what it owns, not by the phrasing `
      + 'that reaches the orchestrator.',
    );
  }
});

test('the orchestrator does still claim its trigger', () => {
  // Guards the opposite failure: stripping the collision by stripping every
  // claim would leave nothing to route a design request to.
  const keywords = deriveDesignMatchKeywords();
  const ownerSurface = { id: OWNER_ID, rel: OWNER_REL, path: join(SKILLS_DIR, OWNER_ID, 'SKILL.md') };
  const d = readDescription(ownerSurface);
  assert.ok(claimsDesignMatch(d, keywords), `${OWNER_REL} claims no design-matching trigger — a design request would have nowhere to route`);
});

/**
 * docs/RECONCILIATION.md P1 #12: shesha-claude-designer/SKILL.md used to
 * assert that /shesha-build, /shesha-audit, and /shesha-gym "each enter this
 * pipeline at the right step" — false for all three. The fix rewrote that
 * paragraph to state, per command, what each one actually does. This test
 * pins the corrected claim text (so a future edit reintroducing the false
 * claim fails loudly) and cross-checks it against each command's own
 * frontmatter description for an obvious contradiction.
 */
const COMMAND_CLAIMS = [
  {
    rel: 'commands/shesha-audit.md',
    // The orchestrator's claim about this command (SKILL.md's "Slash commands" paragraph):
    orchestratorSubstring: 'does not build or push anything',
    // A description claiming to build/compile/push would directly contradict that.
    contradicts: /\b(build|compile|push)\b/i,
  },
  {
    rel: 'commands/shesha-gym.md',
    orchestratorSubstring: "doesn't touch this pipeline either",
    // A description claiming to act on a "form" would contradict "doesn't touch this [form] pipeline".
    contradicts: /\bform\b/i,
  },
  {
    rel: 'commands/shesha-build.md',
    orchestratorSubstring: 'skips this conductor entirely',
    // A description claiming design comprehension/measurement would contradict skipping the conductor.
    contradicts: /\b(comprehension|blueprint measure|measured blueprint)\b/i,
  },
];

test("no command's own description contradicts the orchestrator's claim about it", () => {
  const orchestratorText = readFileSync(join(SKILLS_DIR, OWNER_ID, 'SKILL.md'), 'utf8');
  for (const claim of COMMAND_CLAIMS) {
    assert.ok(
      orchestratorText.includes(claim.orchestratorSubstring),
      `expected ${OWNER_REL} to still claim "${claim.orchestratorSubstring}" about ${claim.rel} `
      + '— update this test if that claim\'s wording changed',
    );
    const surface = { id: claim.rel, rel: claim.rel, path: join(PLUGIN_ROOT, claim.rel) };
    const d = readDescription(surface);
    assert.doesNotMatch(
      d, claim.contradicts,
      `${claim.rel}'s own description contradicts ${OWNER_REL}'s claim ("${claim.orchestratorSubstring}"): "${d}"`,
    );
  }
});
