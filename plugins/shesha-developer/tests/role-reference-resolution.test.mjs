import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: every `$role:`/`$palette.` reference actually USED as a value (not merely
 * mentioned in prose) in a block skeleton or its paired style overlay resolves against
 * every shipped brand.
 *
 * Phase 5 item 4 found two dangling `$role:` references that resolved against NO shipped
 * brand at all — `$role:progressAccent` (completeness-bar.block.json's strokeColor) and
 * `$role:addButtonText` (dashed-add-button.block.json's button item colour) — plus three
 * role names (`divider`, `mutedText`, `bodyInk`) that block-styles overlays reference and
 * that resolved fine against the shesha default brand but not against
 * requirements-studio.tokens.json, whose roles map was simply missing those entries even
 * though the backing palette values already existed there.
 *
 * Resolution: `progressAccent` was added to BOTH shipped brands' roles maps (->
 * palette.brand.primary, matching Ant Design's own default Progress-accent convention);
 * `divider`/`mutedText`/`bodyInk` were added to requirements-studio.tokens.json's roles
 * map (backed by that brand's own existing palette values); `addButtonText` was removed
 * entirely from dashed-add-button.block.json rather than given an invented role — the
 * channel it targeted (a buttonGroup item's per-item colour) is a documented no-op
 * (capability-matrix.json: "buttonType colour" -> renders-via-app-theme), so there was no
 * real colour decision to back with a token.
 *
 * This test is the guard against a repeat: it walks the actual VALUE positions of every
 * block skeleton (`subtree`/`$rowTemplate`) and every paired style overlay (`targets`) —
 * deliberately not a raw text/regex scan of the whole file, so a `$role:` NAME mentioned
 * only in a `_note`/`$note`/`notes` prose field (describing history, not a live value)
 * never gets treated as something that must resolve.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, '..', 'skills');
const BLOCKS_DIR = join(SKILLS_DIR, 'shesha-form-edit', 'assets', 'blocks');
const BLOCK_STYLES_DIR = join(SKILLS_DIR, 'shesha-design-system', 'assets', 'block-styles');
const THEMES_DIR = join(SKILLS_DIR, 'shesha-design-system', 'assets', 'themes');

// Deliberately a fixed list, not a directory glob — see resolve-role.test.mjs's identical
// convention. assets/themes/ may hold untracked, in-progress brand files (e.g.
// skyline.tokens.json) that are not yet "shipped" and may legitimately be incomplete.
const SHIPPED_BRAND_FILES = ['shesha.tokens.json', 'requirements-studio.tokens.json'];

// Keys that hold descriptive prose, not a live style/structure value. A `$role:` or
// `$palette.` name mentioned only inside one of these never has to resolve.
const PROSE_KEYS = new Set(['_note', '$note', 'notes', '$description', '$use', '$philosophy']);

function readJson(p) {
  let raw = readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

/** Collect every `$role:NAME` / `$palette.a.b.c` string found at a real value position. */
function collectReferences(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectReferences(v, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (PROSE_KEYS.has(k)) continue;
      collectReferences(v, out);
    }
    return;
  }
  if (typeof node === 'string') {
    const roleMatch = /^\$role:([A-Za-z][A-Za-z0-9]*)$/.exec(node);
    if (roleMatch) { out.roles.add(roleMatch[1]); return; }
    const paletteMatch = /^\$palette\.([A-Za-z0-9.]+)$/.exec(node);
    if (paletteMatch) { out.palettePaths.add(paletteMatch[1]); return; }
  }
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function gatherFromDir(dir, rootKeys) {
  const out = { roles: new Set(), palettePaths: new Set() };
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const doc = readJson(join(dir, file));
    for (const key of rootKeys) {
      if (doc[key] !== undefined) collectReferences(doc[key], out);
    }
  }
  return out;
}

test('at least one block and one overlay file exist to scan (sanity guard)', () => {
  assert.ok(readdirSync(BLOCKS_DIR).some((f) => f.endsWith('.json')));
  assert.ok(readdirSync(BLOCK_STYLES_DIR).some((f) => f.endsWith('.json')));
});

test('every $role: reference used as a real value in assets/blocks/** or block-styles/** resolves against every shipped brand', () => {
  const fromBlocks = gatherFromDir(BLOCKS_DIR, ['subtree', '$rowTemplate']);
  const fromOverlays = gatherFromDir(BLOCK_STYLES_DIR, ['targets']);
  const allRoles = new Set([...fromBlocks.roles, ...fromOverlays.roles]);
  assert.ok(allRoles.size > 0, 'expected at least one $role: reference to check');

  const missing = [];
  for (const brandFile of SHIPPED_BRAND_FILES) {
    const tokens = readJson(join(THEMES_DIR, brandFile));
    for (const roleName of allRoles) {
      if (tokens.roles?.[roleName] === undefined) {
        missing.push(`"${roleName}" not in ${brandFile}'s roles map`);
      }
    }
  }
  assert.deepEqual(
    missing, [],
    `these $role: references used by assets/blocks/** or block-styles/** do not resolve `
    + `against every shipped brand: ${missing.join('; ')}`,
  );
});

test('every $palette. reference used as a real value in assets/blocks/** or block-styles/** resolves against every shipped brand', () => {
  const fromBlocks = gatherFromDir(BLOCKS_DIR, ['subtree', '$rowTemplate']);
  const fromOverlays = gatherFromDir(BLOCK_STYLES_DIR, ['targets']);
  const allPaths = new Set([...fromBlocks.palettePaths, ...fromOverlays.palettePaths]);
  assert.ok(allPaths.size > 0, 'expected at least one $palette. reference to check');

  const missing = [];
  for (const brandFile of SHIPPED_BRAND_FILES) {
    const tokens = readJson(join(THEMES_DIR, brandFile));
    for (const path of allPaths) {
      if (getPath(tokens.palette, path) === undefined) {
        missing.push(`"$palette.${path}" not in ${brandFile}'s palette`);
      }
    }
  }
  assert.deepEqual(
    missing, [],
    `these $palette. references used by assets/blocks/** or block-styles/** do not resolve `
    + `against every shipped brand: ${missing.join('; ')}`,
  );
});
