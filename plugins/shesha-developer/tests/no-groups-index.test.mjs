import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: the hand-maintained "assets/groups" component index is retired.
 *
 * Phase 5 task 1 deleted plugins/shesha-developer/skills/shesha-form-edit/assets/groups/
 * and plugins/shesha-developer/skills/clean-form-config/assets/groups/ — the two
 * hand-maintained copies of the component-properties index — in favour of the
 * single generated registry (shesha-form-edit/assets/registry/registry-0.45.1.json).
 * The hand index carried 65 of 116 real component types, one type that does not
 * exist in the framework (`addressInput`), and roughly 15 props for `container`
 * against a real 99 — it was not merely redundant with the registry, it was wrong.
 *
 * This is a one-way door: nothing under plugins/ may reference "assets/groups"
 * again, whether as a live path or as new prose describing it (existing history
 * is written without the literal path — see component-registry.md's "why this
 * replaced the old hand-maintained index" section, and this skill's own commit
 * history, for that story instead). If this test fails, something has started
 * pointing at, or redescribing, the deleted index rather than the registry.
 *
 * Scope is `plugins/` only, by design: the top-level `docs/` folder (release
 * notes, the phase-5 plan itself, the phase-1 registry-generator design doc)
 * legitimately narrates this migration's history using the literal string, and
 * is intentionally outside this test's walk.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(HERE, '..', '..'); // tests/ -> shesha-developer -> plugins
const SELF = fileURLToPath(import.meta.url); // this file necessarily discusses the needle itself

const NEEDLE = 'assets/groups';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

test('no file under plugins/ references the retired assets/groups index', () => {
  const offenders = [];
  for (const file of walk(PLUGINS_DIR)) {
    if (file === SELF) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable/binary — not a text reference either way
    }
    if (text.includes(NEEDLE)) {
      const lineNo = text.slice(0, text.indexOf(NEEDLE)).split('\n').length;
      offenders.push(`${file}:${lineNo}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these files reference the retired "${NEEDLE}" index — repoint them at the `
    + `shesha-form-edit registry instead (assets/registry/registry-0.45.1.json): `
    + `${offenders.join(', ')}`,
  );
});
