import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards for the schema/archetype consolidation (docs/RECONCILIATION.md):
 * P1 is authoritative — one blueprint.schema.json
 * (shesha-design-comprehension/assets/blueprint.schema.json) and one
 * eight-archetype vocabulary (shesha-form-edit/references/archetypes.md).
 *
 * These are one-way doors: if a second blueprint.schema.json reappears, or a
 * P2-vocabulary archetype name (hub-as-detail, modal-dialog, capture,
 * capture-standalone, list-card-item, inline-card, solution-map) reappears in
 * any of the five surfaces this task swept, one of these tests fails loudly
 * instead of the drift being silent again.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..'); // tests/ -> plugins/shesha-developer

const EIGHT = new Set([
  'table-worklist',
  'record-detail',
  'capture-dialog',
  'standalone-capture',
  'list-card',
  'hub',
  'dashboard',
  'wizard',
]);

// The one documented exception: a P2-only archetype with no P1 equivalent,
// explicitly recorded as unsupported-for-now (references/archetypes.md's
// "Unsupported" section) rather than silently dropped or force-fitted into
// the eight. Anything else outside the eight is a real drift.
const DOCUMENTED_UNSUPPORTED = new Set(['auth-page']);

function walk(dir, out = [], skip = new Set(['node_modules', '.git'])) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out, skip);
    else out.push(p);
  }
  return out;
}

test('exactly one blueprint.schema.json exists in the plugin', () => {
  const hits = walk(PLUGIN_ROOT).filter((p) => basename(p) === 'blueprint.schema.json');
  assert.equal(
    hits.length, 1,
    `expected exactly one blueprint.schema.json, found ${hits.length}: ${hits.join(', ')}`,
  );
  assert.match(
    hits[0].replace(/\\/g, '/'),
    /shesha-design-comprehension\/assets\/blueprint\.schema\.json$/,
    `the one surviving blueprint.schema.json should be shesha-design-comprehension/assets/blueprint.schema.json, found ${hits[0]}`,
  );
});

test('assets/golden/ filenames all carry an archetype-prefix that is one of the eight, or is the documented unsupported exception', () => {
  const GOLDEN_DIR = join(PLUGIN_ROOT, 'skills', 'shesha-form-edit', 'assets', 'golden');
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json') && f !== '_index.json');
  assert.ok(files.length > 0, `expected golden fixtures under ${GOLDEN_DIR}`);
  const offenders = [];
  for (const file of files) {
    const prefix = file.split('--')[0];
    if (EIGHT.has(prefix) || DOCUMENTED_UNSUPPORTED.has(prefix)) continue;
    offenders.push(file);
  }
  assert.deepEqual(
    offenders, [],
    `these golden filenames carry an archetype-prefix outside the eight and outside the documented unsupported set: ${offenders.join(', ')}`,
  );
});

test('golden/_index.json "archetype" values are all one of the eight, except entries explicitly flagged "status": "unsupported"', () => {
  const idx = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'skills', 'shesha-form-edit', 'assets', 'golden', '_index.json'), 'utf8'));
  assert.ok(Array.isArray(idx.forms) && idx.forms.length > 0, '_index.json should list at least one form');
  const offenders = [];
  for (const entry of idx.forms) {
    if (EIGHT.has(entry.archetype)) continue;
    if (entry.status === 'unsupported' && DOCUMENTED_UNSUPPORTED.has(entry.archetype)) continue;
    offenders.push(`${entry.file}: archetype="${entry.archetype}"${entry.status ? ` status="${entry.status}"` : ''}`);
  }
  assert.deepEqual(
    offenders, [],
    `these _index.json entries use an archetype outside the eight without a documented "status": "unsupported" flag: ${offenders.join(', ')}`,
  );
});

test('every assets/archetypes/*.flow.json filename is one of the eight (no more, no less)', () => {
  const FLOWS_DIR = join(PLUGIN_ROOT, 'skills', 'shesha-form-edit', 'assets', 'archetypes');
  const names = readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.flow.json'))
    .map((f) => f.replace(/\.flow\.json$/, ''));
  const nameSet = new Set(names);
  assert.deepEqual(
    [...nameSet].sort(), [...EIGHT].sort(),
    `assets/archetypes/*.flow.json should ship exactly the eight archetype manifests, found: ${names.join(', ')}`,
  );
});

test('commands/shesha-build.md\'s archetype list is exactly the eight', () => {
  const doc = readFileSync(join(PLUGIN_ROOT, 'commands', 'shesha-build.md'), 'utf8');
  const m = doc.match(/archetypes\.md`:\s*([\s\S]*?)\)/);
  assert.ok(m, 'expected an "archetypes.md`: <list>)" archetype list in commands/shesha-build.md');
  const listed = m[1]
    .split('·')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  assert.deepEqual(
    listed.sort(), [...EIGHT].sort(),
    `commands/shesha-build.md's archetype list should be exactly the eight (this is what makes /shesha-build wizard and /shesha-build standalone-capture routable), found: ${listed.join(', ')}`,
  );
});

test('every evals/cases/*.json "archetype" is one of the eight', () => {
  const CASES_DIR = join(PLUGIN_ROOT, 'evals', 'cases');
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, `expected eval case files under ${CASES_DIR}`);
  const offenders = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8'));
    if (!Object.prototype.hasOwnProperty.call(parsed, 'archetype')) continue; // not every case is archetype-scoped
    if (!EIGHT.has(parsed.archetype)) offenders.push(`${file}: archetype="${parsed.archetype}"`);
  }
  assert.deepEqual(
    offenders, [],
    `these eval cases declare an archetype outside the eight: ${offenders.join(', ')}`,
  );
});

test('every evals/cases/*.json "archetype" is routable by commands/shesha-build.md', () => {
  const doc = readFileSync(join(PLUGIN_ROOT, 'commands', 'shesha-build.md'), 'utf8');
  const m = doc.match(/archetypes\.md`:\s*([\s\S]*?)\)/);
  assert.ok(m, 'expected an archetype list in commands/shesha-build.md');
  const routable = new Set(
    m[1].split('·').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean),
  );

  const CASES_DIR = join(PLUGIN_ROOT, 'evals', 'cases');
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const offenders = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8'));
    if (!Object.prototype.hasOwnProperty.call(parsed, 'archetype')) continue;
    if (!routable.has(parsed.archetype)) offenders.push(`${file}: archetype="${parsed.archetype}" not in commands/shesha-build.md's enum`);
  }
  assert.deepEqual(
    offenders, [],
    `these eval cases test an archetype that /shesha-build could not route to (e.g. the pre-fix enum made "wizard" and "standalone-capture" unroutable): ${offenders.join(', ')}`,
  );
});
