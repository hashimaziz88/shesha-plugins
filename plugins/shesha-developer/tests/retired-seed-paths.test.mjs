import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: no live instructional citation of a retired seed path
 * (docs/RECONCILIATION.md's "Guard tests to add", item 1).
 *
 * Two distinct one-way doors:
 *
 * 1. `assets/patterns/` — this directory was deleted; nothing under it can
 *    be opened any more, so no instructional file should send anyone there.
 *
 * 2. Bare pre-move seed filenames — `rs-detail-with-header.json`,
 *    `employee-detail-with-child-tables.json`,
 *    `employee-detail-without-child-tables.json` used to live directly under
 *    `assets/examples/`. The first was renamed into `assets/golden/` with an
 *    archetype prefix (`record-detail--rs-detail-with-header.json`); the
 *    other two were deleted outright (25,010 / ~14,300 / ~8,800 lines —
 *    unreadable by construction). A citation of the bare, unprefixed name is
 *    a dangling reference UNLESS it is explicit historical narration of the
 *    move/retirement itself.
 *
 * Scope is deliberately narrow: only the files an agent actually reads to
 * decide what to do — skill `SKILL.md` + `references/**`, `agents/**`,
 * `commands/**`. This is "instructional files" in the sense the plan uses
 * the term, and it is why the two known narrators of `assets/patterns/` are
 * exempt WITHOUT needing a special case:
 *   - `hooks/gate-policy.json` lives under `hooks/`, never walked here.
 *   - `skills/shesha-form-edit/docs/corpus-report.md` lives under a skill's
 *     `docs/` folder, not its `references/` folder, never walked here.
 * Both mention `assets/patterns/` deliberately, as calibration history, and
 * both say outright that the directory no longer exists — correct, and
 * exactly the kind of thing this test must not fail on, which is why they
 * are structurally out of its walk rather than string-matched around.
 *
 * The bare-filename check needs one further nuance the patterns needle
 * doesn't: `references/examples.md` itself explicitly narrates the
 * retirement ("Three seeds that used to live in `assets/examples/` — ... —
 * were retired ..."), inside a file this test DOES walk (it's exactly the
 * seed-discovery reference an agent reads). A blanket ban would fail on the
 * plan's own sanctioned historical record. So a bare mention is only a
 * violation when no retirement/rename marker word appears near it — the
 * same "historical record, says so explicitly" test the plan applies to
 * `assets/patterns/`, just applied locally instead of by file-exemption.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const SELF = fileURLToPath(import.meta.url);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** SKILL.md + references/** for every skill, plus agents/** and commands/**. */
function instructionalFiles() {
  const out = [];
  const skillsDir = join(PLUGIN_ROOT, 'skills');
  for (const entry of readdirSync(skillsDir)) {
    if (entry.startsWith('.')) continue;
    const skillMd = join(skillsDir, entry, 'SKILL.md');
    if (existsSync(skillMd)) out.push(skillMd);
    walk(join(skillsDir, entry, 'references'), out);
  }
  walk(join(PLUGIN_ROOT, 'agents'), out);
  walk(join(PLUGIN_ROOT, 'commands'), out);
  return out;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

test('no instructional file cites the retired assets/patterns/ directory', () => {
  const NEEDLE = 'assets/patterns/';
  const offenders = [];
  for (const file of instructionalFiles()) {
    if (file === SELF) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let idx = text.indexOf(NEEDLE);
    while (idx !== -1) {
      offenders.push(`${file}:${lineNumberAt(text, idx)}`);
      idx = text.indexOf(NEEDLE, idx + 1);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these instructional files cite the retired "${NEEDLE}" directory (it does not exist — `
    + `repoint at assets/exemplars/, assets/blocks/, or assets/golden/): ${offenders.join(', ')}`,
  );
});

/** Retired bare (unprefixed) seed filenames — see file header for the story. */
const RETIRED_BARE_FILENAMES = [
  'rs-detail-with-header.json',
  'employee-detail-with-child-tables.json',
  'employee-detail-without-child-tables.json',
];

const RETIREMENT_MARKER = /retired|renamed|used to live|no longer exists|moved to|folded into/i;

test('no instructional file cites a bare pre-move seed filename outside historical narration', () => {
  const offenders = [];
  for (const file of instructionalFiles()) {
    if (file === SELF) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const name of RETIRED_BARE_FILENAMES) {
      const re = new RegExp(`(?<!--)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      let m;
      while ((m = re.exec(text))) {
        const windowStart = Math.max(0, m.index - 150);
        const windowEnd = Math.min(text.length, m.index + name.length + 150);
        const window = text.slice(windowStart, windowEnd);
        if (!RETIREMENT_MARKER.test(window)) {
          offenders.push(`${file}:${lineNumberAt(text, m.index)} ("${name}")`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    `these citations of a retired bare seed filename have no nearby retirement/rename narration `
    + `(so they read as a live, dangling path rather than history): ${offenders.join(', ')}`,
  );
});
