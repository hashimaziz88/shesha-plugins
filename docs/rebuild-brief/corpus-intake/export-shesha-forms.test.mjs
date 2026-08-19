import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  ENVELOPE_FIELDS, slugify, makeUniqueName, resolveFieldExpression, buildExtractQuery,
  collapseToLatest, buildEnvelope, checkMarkupShape, sha256, discoverSchema, runExtract,
} from './export-shesha-forms.mjs';

// The real golden form, used as the row payload so the extract is exercised
// against production-shaped markup rather than a toy. Resolved relative to this
// file so the suite runs from any checkout on any platform.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_CANDIDATES = [
  path.join(HERE, '..', 'artifacts', 'bookings-table.revision2.json'),
  path.join(HERE, 'fixtures', 'bookings-table.revision2.json'),
];
const GOLDEN_PATH = GOLDEN_CANDIDATES.find((p) => fs.existsSync(p));
if (!GOLDEN_PATH) {
  throw new Error(
    'Golden reference not found. Expected one of:\n  ' + GOLDEN_CANDIDATES.join('\n  ') +
    '\nThe suite needs the real bookings-table envelope as its row payload.');
}
const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

const FULL_SCHEMA = {
  formSchema: 'dbo', formTable: 'Frwk_FormConfigurations',
  formColumns: ['Id', 'Markup', 'ModelType', 'TemplateId', 'IsTemplate', 'Access', 'Permissions',
    'ConfigurationForm', 'GenerationLogicTypeName', 'GenerationLogicExtensionJson', 'PlaceholderIcon',
    'ConfigHash', 'IsLast'],
  baseSchema: 'dbo', baseTable: 'Frwk_ConfigurationItems',
  baseColumns: ['Id', 'OriginId', 'Name', 'Label', 'ItemType', 'Description', 'Module_Id',
    'FrontEndApplication', 'Suppress', 'LastModificationTime', 'Comments', 'BaseModules',
    'VersionNo', 'IsLast', 'IsDeleted'],
  moduleSchema: 'dbo', moduleTable: 'Frwk_Modules', moduleSide: 'b',
};

// ------------------------------------------------------------------ pure bits --

test('slugify replaces filesystem-hostile characters', () => {
  assert.equal(slugify('boxfusion.test', 'bookings-table'), 'boxfusion.test.bookings-table');
  assert.equal(slugify('My Module', 'form/name?'), 'My-Module.form-name-');
});

test('makeUniqueName never lets two forms collide', () => {
  const seen = new Map();
  assert.equal(makeUniqueName('a.b', seen), 'a.b');
  assert.equal(makeUniqueName('a.b', seen), 'a.b~2');
  assert.equal(makeUniqueName('a.b', seen), 'a.b~3');
  assert.equal(makeUniqueName('c.d', seen), 'c.d');
});

test('resolveFieldExpression prefers the form table, then base, then aliases', () => {
  assert.equal(resolveFieldExpression(FULL_SCHEMA, 'Markup'), 'f.[Markup] AS [Markup]');
  assert.equal(resolveFieldExpression(FULL_SCHEMA, 'Name'), 'b.[Name] AS [Name]');
  assert.equal(resolveFieldExpression(FULL_SCHEMA, 'DateUpdated'), 'b.[LastModificationTime] AS [DateUpdated]');
  assert.equal(resolveFieldExpression(FULL_SCHEMA, 'ModuleName'), 'm.[Name] AS [ModuleName]');
  assert.equal(resolveFieldExpression({ ...FULL_SCHEMA, moduleTable: null }, 'ModuleName'), null);
});

test('buildExtractQuery resolves all 23 fields against a full schema', () => {
  const q = buildExtractQuery(FULL_SCHEMA);
  assert.equal(q.presentFields.length, 23, `missing: ${q.missingFields.join(', ')}`);
  assert.equal(q.missingFields.length, 0);
  assert.equal(q.usedIsLast, true);
  assert.match(q.sql, /FROM \[dbo\]\.\[Frwk_FormConfigurations\] f/);
  assert.match(q.sql, /JOIN \[dbo\]\.\[Frwk_ConfigurationItems\] b ON b\.\[Id\] = f\.\[Id\]/);
  assert.match(q.sql, /LEFT JOIN \[dbo\]\.\[Frwk_Modules\] m ON m\.\[Id\] = b\.\[Module_Id\]/);
});

test('buildExtractQuery records unresolved fields instead of inventing them', () => {
  const thin = { ...FULL_SCHEMA, baseTable: null, baseColumns: [], moduleTable: null };
  const q = buildExtractQuery(thin);
  assert.ok(q.missingFields.includes('Name'), 'Name should be unresolved without a base table');
  assert.ok(q.missingFields.includes('ModuleName'));
  assert.match(q.sql, /CAST\(NULL AS nvarchar\(max\)\) AS \[Name\]/);
  assert.ok(!q.sql.includes(' b.'), 'must not reference an unjoined alias');
  assert.ok(!q.sql.includes('JOIN'), 'no joins when there is nothing to join');
});

test('COALESCE is used only when a column exists on both sides', () => {
  const bothSides = buildExtractQuery(FULL_SCHEMA);
  assert.match(bothSides.sql, /COALESCE\(f\.\[IsLast\], b\.\[IsLast\]\), 1\) = 1|COALESCE\(COALESCE\(f\.\[IsLast\], b\.\[IsLast\]\), 1\) = 1/);
  const baseOnly = buildExtractQuery({ ...FULL_SCHEMA, formColumns: FULL_SCHEMA.formColumns.filter((c) => c !== 'IsLast') });
  assert.match(baseOnly.sql, /COALESCE\(b\.\[IsLast\], 1\) = 1/);
  assert.ok(!baseOnly.sql.includes('COALESCE(f.[IsLast]'));
});

test('includeAllVersions drops the latest-version predicate but still selects it', () => {
  const q = buildExtractQuery(FULL_SCHEMA, { includeAllVersions: true });
  assert.equal(q.usedIsLast, false);
  const whereClause = q.sql.slice(q.sql.indexOf('WHERE'));
  assert.ok(!whereClause.includes('IsLast'), 'IsLast must not be a predicate');
  assert.match(q.sql, /f\.\[IsLast\] AS \[IsLast\]/, 'but it is still selected: the manifest reports on it');
});

test('collapseToLatest keeps the highest VersionNo per module and name', () => {
  const rows = [
    { ModuleName: 'm', Name: 'f', VersionNo: 1, Id: 'a' },
    { ModuleName: 'm', Name: 'f', VersionNo: 3, Id: 'c' },
    { ModuleName: 'm', Name: 'f', VersionNo: 2, Id: 'b' },
    { ModuleName: 'm', Name: 'g', VersionNo: 1, Id: 'd' },
  ];
  const kept = collapseToLatest(rows);
  assert.equal(kept.length, 2);
  assert.equal(kept.find((r) => r.Name === 'f').Id, 'c');
});

test('buildEnvelope emits all 23 fields in canonical order', () => {
  const env = buildEnvelope({ Markup: '{}', Name: 'x' });
  assert.deepEqual(Object.keys(env), ENVELOPE_FIELDS);
  assert.equal(env.ModelType, null, 'absent becomes null, never omitted');
});

test('buildEnvelope normalises array fields and dates', () => {
  const when = new Date('2026-06-22T10:27:00.000Z');
  const env = buildEnvelope({ Markup: '{}', Permissions: null, BaseModules: '["a","b"]', DateUpdated: when });
  assert.deepEqual(env.Permissions, []);
  assert.deepEqual(env.BaseModules, ['a', 'b']);
  assert.equal(env.DateUpdated, '2026-06-22T10:27:00.000Z');
  assert.deepEqual(buildEnvelope({ Markup: '{}', BaseModules: 'not-json' }).BaseModules, []);
});

test('checkMarkupShape rejects what it should and accepts real markup', () => {
  assert.equal(checkMarkupShape(GOLDEN.Markup).ok, true);
  assert.equal(checkMarkupShape(null).ok, false);
  assert.equal(checkMarkupShape('{}').ok, false);
  assert.equal(checkMarkupShape('<html>truncated').ok, false);
  assert.match(checkMarkupShape('{"components":[').reason, /not a complete JSON object/);
});

// ------------------------------------------------------------------ discovery --

function mockQuery(responses) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      for (const [pattern, rows] of responses) if (pattern.test(sql)) return rows;
      return [];
    },
  };
}

test('discoverSchema finds form, base and modules tables', async () => {
  const { query } = mockQuery([
    [/COLUMN_NAME = 'Markup'/, [{ SchemaName: 'dbo', TableName: 'Frwk_FormConfigurations', ColumnCount: 13 }]],
    [/TABLE_NAME = 'Frwk_FormConfigurations'/, FULL_SCHEMA.formColumns.map((c) => ({ COLUMN_NAME: c }))],
    [/COLUMN_NAME = 'ItemType'\)\nORDER BY/, [
      { SchemaName: 'dbo', TableName: 'Frwk_ConfigurationItems' },
      { SchemaName: 'dbo', TableName: 'Frwk_FormConfigurations' },
    ]],
    [/TABLE_NAME = 'Frwk_ConfigurationItems'/, FULL_SCHEMA.baseColumns.map((c) => ({ COLUMN_NAME: c }))],
    [/LIKE '%Module%'/, [{ SchemaName: 'dbo', TableName: 'Frwk_Modules' }]],
  ]);
  const schema = await discoverSchema(query);
  assert.equal(schema.formTable, 'Frwk_FormConfigurations');
  assert.equal(schema.baseTable, 'Frwk_ConfigurationItems');
  assert.equal(schema.moduleTable, 'Frwk_Modules');
  assert.equal(schema.moduleSide, 'b');
});

test('discoverSchema throws a useful error on a non-Shesha database', async () => {
  const { query } = mockQuery([[/COLUMN_NAME = 'Markup'/, []]]);
  await assert.rejects(() => discoverSchema(query), /does not look like a Shesha database/);
});

test('discoverSchema tolerates a missing modules table', async () => {
  const { query } = mockQuery([
    [/COLUMN_NAME = 'Markup'/, [{ SchemaName: 'dbo', TableName: 'Forms', ColumnCount: 5 }]],
    [/TABLE_NAME = 'Forms'/, [{ COLUMN_NAME: 'Id' }, { COLUMN_NAME: 'Markup' }, { COLUMN_NAME: 'Name' }, { COLUMN_NAME: 'ItemType' }]],
    [/COLUMN_NAME = 'ItemType'\)\nORDER BY/, [{ SchemaName: 'dbo', TableName: 'Forms' }]],
  ]);
  const schema = await discoverSchema(query);
  assert.equal(schema.baseTable, null);
  assert.equal(schema.moduleTable, null);
});

// -------------------------------------------------------------- full extract --

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-extract-')); }

test('runExtract writes real envelopes and an honest manifest', async () => {
  const out = tmpdir();
  const rows = [
    { ...GOLDEN, ModuleName: 'boxfusion.test', VersionNo: 3, IsLast: true },
    { ...GOLDEN, Name: 'booking-details', ModuleName: 'boxfusion.test', VersionNo: 1, IsLast: true },
  ];
  const { manifest, targetDir } = await runExtract({
    rows, schema: FULL_SCHEMA, sourceTag: 'requirements-studio-045',
    database: 'RS-45upgrade', server: 'localhost,1433', outDir: out,
    now: () => new Date('2026-08-18T06:00:00.000Z'),
  });

  assert.equal(manifest.formCount, 2);
  assert.equal(manifest.skippedCount, 0);
  assert.equal(manifest.provenance, 'db-export-complete-envelope');
  assert.equal(manifest.latestVersionMethod, 'IsLast');
  assert.equal(manifest.envelopeFieldsMissing.length, 0);
  assert.equal(manifest.componentCountsFilledBy, 'defect-census.mjs');

  const written = fs.readdirSync(targetDir).sort();
  assert.deepEqual(written, ['boxfusion.test.booking-details.json', 'boxfusion.test.bookings-table.json', 'manifest.json']);

  // The written envelope must be valid, complete, and carry the real markup.
  const env = JSON.parse(fs.readFileSync(path.join(targetDir, 'boxfusion.test.bookings-table.json'), 'utf8'));
  assert.deepEqual(Object.keys(env), ENVELOPE_FIELDS);
  const markup = JSON.parse(env.Markup);
  assert.equal(markup.components.length, 1);
  assert.equal(Buffer.byteLength(env.Markup, 'utf8'), 19170, 'markup must survive the round trip byte-for-byte');

  const entry = manifest.forms.find((f) => f.name === 'bookings-table');
  assert.equal(entry.markupBytes, 19170);
  assert.equal(entry.componentCount, null, 'component counts are the census tool\'s job');
  assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(targetDir, entry.file), 'utf8')));

  fs.rmSync(out, { recursive: true, force: true });
});

test('runExtract marks a partial envelope partial', async () => {
  const out = tmpdir();
  const thin = { ...FULL_SCHEMA, baseTable: null, baseColumns: [], moduleTable: null };
  const { manifest } = await runExtract({
    rows: [{ Markup: GOLDEN.Markup, Id: 'x' }], schema: thin,
    sourceTag: 'thin', database: 'db', server: 's', outDir: out,
  });
  assert.equal(manifest.provenance, 'db-export-partial-envelope');
  assert.ok(manifest.envelopeFieldsMissing.includes('Name'));
  assert.equal(manifest.formCount, 1);
  assert.equal(manifest.forms[0].module, 'unknown-module', 'no module column means unknown, not invented');
  fs.rmSync(out, { recursive: true, force: true });
});

test('runExtract skips unusable markup with a reason and keeps going', async () => {
  const out = tmpdir();
  const { manifest } = await runExtract({
    rows: [
      { ...GOLDEN, ModuleName: 'm', Name: 'good' },
      { Markup: '<html>oops', Id: '2', ModuleName: 'm', Name: 'truncated' },
      { Markup: null, Id: '3', ModuleName: 'm', Name: 'nullmarkup' },
    ],
    schema: FULL_SCHEMA, sourceTag: 'mixed', database: 'db', server: 's', outDir: out,
  });
  assert.equal(manifest.formCount, 1);
  assert.equal(manifest.skippedCount, 2);
  assert.deepEqual(manifest.skipped.map((s) => s.name).sort(), ['nullmarkup', 'truncated']);
  assert.match(manifest.skipped.find((s) => s.name === 'nullmarkup').reason, /Markup is null/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('runExtract collapses versions when IsLast is unavailable', async () => {
  const out = tmpdir();
  const noIsLast = {
    ...FULL_SCHEMA,
    formColumns: FULL_SCHEMA.formColumns.filter((c) => c !== 'IsLast'),
    baseColumns: FULL_SCHEMA.baseColumns.filter((c) => c !== 'IsLast'),
  };
  const { manifest } = await runExtract({
    rows: [
      { ...GOLDEN, ModuleName: 'm', Name: 'f', VersionNo: 1 },
      { ...GOLDEN, ModuleName: 'm', Name: 'f', VersionNo: 7 },
    ],
    schema: noIsLast, sourceTag: 'versions', database: 'db', server: 's', outDir: out,
  });
  assert.equal(manifest.latestVersionMethod, 'maxVersionNo');
  assert.equal(manifest.formCount, 1);
  assert.equal(manifest.forms[0].versionNo, 7);
  fs.rmSync(out, { recursive: true, force: true });
});

test('two forms that slug identically both survive', async () => {
  const out = tmpdir();
  const { manifest, targetDir } = await runExtract({
    rows: [
      { ...GOLDEN, ModuleName: 'm', Name: 'a/b' },
      { ...GOLDEN, ModuleName: 'm', Name: 'a?b' },
    ],
    schema: FULL_SCHEMA, sourceTag: 'collide', database: 'db', server: 's', outDir: out,
  });
  assert.equal(manifest.formCount, 2);
  const files = fs.readdirSync(targetDir).filter((f) => f !== 'manifest.json').sort();
  assert.deepEqual(files, ['m.a-b.json', 'm.a-b~2.json']);
  fs.rmSync(out, { recursive: true, force: true });
});

test('the extract output is readable by defect-census.mjs', async () => {
  const out = tmpdir();
  const { targetDir } = await runExtract({
    rows: [{ ...GOLDEN, ModuleName: 'boxfusion.test' }],
    schema: FULL_SCHEMA, sourceTag: 'census', database: 'db', server: 's', outDir: out,
  });
  const { execFileSync } = await import('node:child_process');
  const stdout = execFileSync(process.execPath, [path.join(HERE, 'defect-census.mjs'), targetDir, '--detail', '0'], { encoding: 'utf8' });
  assert.match(stdout, /markup bytes\s+19170/);
  assert.match(stdout, /breakpoint-block bytes\s+8422/);
  assert.match(stdout, /defect instances\s+13/);
  fs.rmSync(out, { recursive: true, force: true });
});
