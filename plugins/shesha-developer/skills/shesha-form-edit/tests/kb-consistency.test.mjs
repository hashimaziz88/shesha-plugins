// Keeps assets/components-kb/_index.json honest about the component tree it indexes.
//
// The compiler and every capability lookup read _index.json, not the directory —
// so a component file that exists on disk but has no index row is invisible to the
// pipeline, and an index row pointing at a deleted file is a crash waiting for the
// first consumer that follows it. Both drifted in the past (6 component files sat
// un-indexed because generate-component-kb.js writes both artefacts from one
// in-memory map and never re-read the directory), so this test pins the bijection.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KB = path.join(HERE, '..', 'assets', 'components-kb');
const INDEX_PATH = path.join(KB, '_index.json');

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
// Underscore-prefixed files are the KB's own metadata (_index/_meta/_gaps/_enums),
// not component entries.
const componentFiles = fs
  .readdirSync(KB)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

test('_index.json is a non-empty object of component rows', () => {
  assert.ok(index && typeof index === 'object' && !Array.isArray(index));
  assert.ok(Object.keys(index).length > 0, '_index.json has no entries');
  assert.ok(componentFiles.length > 0, 'no component *.json files found in components-kb/');
});

test('every component *.json on disk has an _index.json row', () => {
  const indexedFiles = new Set(Object.values(index).map((row) => row.file));
  const missing = componentFiles.filter((f) => !indexedFiles.has(f));
  assert.deepEqual(
    missing,
    [],
    `component files present on disk but absent from _index.json: ${missing.join(', ')}`
  );
});

test("every _index.json row's file exists on disk", () => {
  const onDisk = new Set(componentFiles);
  const dangling = Object.entries(index)
    .filter(([, row]) => !onDisk.has(row.file))
    .map(([type, row]) => `${type} -> ${row.file}`);
  assert.deepEqual(
    dangling,
    [],
    `_index.json rows pointing at missing files: ${dangling.join(', ')}`
  );
});

test('index keys and component files are a bijection (counts match, no dupes)', () => {
  const files = Object.values(index).map((row) => row.file);
  assert.equal(
    new Set(files).size,
    files.length,
    'two _index.json rows claim the same file'
  );
  assert.equal(
    files.length,
    componentFiles.length,
    `_index.json has ${files.length} rows but ${componentFiles.length} component files exist on disk`
  );
});

test('each index row carries the full row shape and matches its KB file', () => {
  for (const [type, row] of Object.entries(index)) {
    const label = `_index.json["${type}"]`;
    for (const key of [
      'version',
      'name',
      'isInput',
      'file',
      'settingsParseQuality',
      'settingsFieldCount',
      'hasStandardAppearance',
    ]) {
      assert.ok(key in row, `${label} is missing "${key}"`);
    }
    assert.equal(typeof row.file, 'string', `${label}.file is not a string`);
    assert.equal(typeof row.settingsFieldCount, 'number', `${label}.settingsFieldCount is not a number`);
    assert.equal(typeof row.hasStandardAppearance, 'boolean', `${label}.hasStandardAppearance is not a boolean`);

    const entry = JSON.parse(fs.readFileSync(path.join(KB, row.file), 'utf8'));
    assert.equal(entry.type, type, `${label} indexes a file whose own type is "${entry.type}"`);
    assert.equal(row.name, entry.name ?? null, `${label}.name disagrees with ${row.file}`);
    assert.equal(row.version, entry.version ?? null, `${label}.version disagrees with ${row.file}`);
    assert.equal(row.isInput, entry.isInput ?? null, `${label}.isInput disagrees with ${row.file}`);
    assert.equal(
      row.hasStandardAppearance,
      !!entry.hasStandardAppearance,
      `${label}.hasStandardAppearance disagrees with ${row.file}`
    );
    assert.equal(
      row.settingsParseQuality,
      entry.settingsForm ? entry.settingsForm.parseQuality : 'none',
      `${label}.settingsParseQuality disagrees with ${row.file}`
    );
    // Same formula the generator uses when it emits the index row.
    const expectedCount =
      (entry.settingsFields ? entry.settingsFields.length : 0) +
      (entry.hasStandardAppearance ? entry.appearanceFieldPaths.length : 0);
    assert.equal(
      row.settingsFieldCount,
      expectedCount,
      `${label}.settingsFieldCount disagrees with ${row.file}`
    );
  }
});
