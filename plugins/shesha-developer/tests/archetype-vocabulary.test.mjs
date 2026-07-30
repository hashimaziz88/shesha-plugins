import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: the archetype vocabulary stays singular.
 *
 * `references/archetypes.md` (shesha-form-edit) defines exactly eight archetypes:
 * table-worklist, record-detail, capture-dialog, standalone-capture, list-card,
 * hub, dashboard, wizard. Before Phase 5 task 5, `assets/blocks/*.block.json`
 * carried an `$archetype` field whose values (`fragment`, `list`, `record-detail`)
 * mixed block *kinds* into the archetype vocabulary — three coexisting
 * vocabularies for the same idea. That field was renamed to `$kind` (see
 * block-library.md's $kind taxonomy: fragment / list / layout) and no block
 * carries `$archetype` any more.
 *
 * This is a one-way door: if `$archetype` reappears anywhere under
 * `assets/blocks/**`, its value must be one of the eight real archetype names —
 * never a block-kind word smuggled back in under the archetype field.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/ -> shesha-developer -> skills/shesha-form-edit/assets/blocks
const BLOCKS_DIR = join(HERE, '..', 'skills', 'shesha-form-edit', 'assets', 'blocks');

const REAL_ARCHETYPES = new Set([
  'table-worklist',
  'record-detail',
  'capture-dialog',
  'standalone-capture',
  'list-card',
  'hub',
  'dashboard',
  'wizard',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, out);
    } else if (entry.endsWith('.json')) {
      out.push(p);
    }
  }
  return out;
}

test('assets/blocks contains block files to check (sanity guard against an empty walk)', () => {
  const files = walk(BLOCKS_DIR);
  assert.ok(files.length > 0, `expected at least one .json file under ${BLOCKS_DIR}`);
});

test('every $archetype value under assets/blocks/** is one of the eight real archetypes, or the field is absent', () => {
  const offenders = [];
  for (const file of walk(BLOCKS_DIR)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // not a JSON block file — nothing to check
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, '$archetype')) continue;
    const value = parsed.$archetype;
    if (!REAL_ARCHETYPES.has(value)) {
      offenders.push(`${file}: $archetype="${value}"`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these block files carry an $archetype value that is not one of the eight real `
    + `archetypes (table-worklist, record-detail, capture-dialog, standalone-capture, `
    + `list-card, hub, dashboard, wizard) — block kinds (fragment/list/layout) belong `
    + `under $kind, not $archetype: ${offenders.join(', ')}`,
  );
});

test('no block file under assets/blocks/** uses $kind values other than fragment/list/layout', () => {
  const KNOWN_KINDS = new Set(['fragment', 'list', 'layout']);
  const offenders = [];
  for (const file of walk(BLOCKS_DIR)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, '$kind')) continue;
    if (!KNOWN_KINDS.has(parsed.$kind)) {
      offenders.push(`${file}: $kind="${parsed.$kind}"`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these block files carry a $kind value outside the documented taxonomy `
    + `(fragment/list/layout) — update block-library.md's $kind taxonomy if this is `
    + `a deliberate addition: ${offenders.join(', ')}`,
  );
});
