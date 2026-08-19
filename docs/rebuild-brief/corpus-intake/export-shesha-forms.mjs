#!/usr/bin/env node
/**
 * export-shesha-forms.mjs
 *
 * Extract Shesha form configurations from SQL Server into one JSON envelope per
 * form, plus a provenance manifest.
 *
 * Three commitments:
 *
 *   1. DISCOVERY, NOT ASSUMPTION. No table or column name is hardcoded. The
 *      form-configuration table is found by locating the base table that carries
 *      a `Markup` column; the sibling configuration-item table and the modules
 *      table are discovered the same way. The SELECT is built from the columns
 *      that actually exist.
 *
 *   2. ABSENT IS NEVER EMPTY. An envelope field that cannot be resolved is
 *      emitted as null AND recorded in the manifest under envelopeFieldsMissing,
 *      with provenance marked partial. A downstream tier can then dispose those
 *      fields uninspectable rather than mistaking a missing column for a blank
 *      value.
 *
 *   3. METADATA ONLY. It reads the discovered configuration-item tables and
 *      nothing else. Form configs are metadata; a production backup may hold
 *      client records and this program has no path to them.
 *
 * Every impure edge is injectable, so the whole extract runs against a mock in
 * `export-shesha-forms.test.mjs` with no database.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// The 23-field envelope, in the canonical order confirmed against a real 0.45
// export. Order matters: it is the order a reviewer reads and a differ diffs.
// ---------------------------------------------------------------------------

export const ENVELOPE_FIELDS = [
  'Markup', 'ModelType', 'TemplateId', 'IsTemplate', 'Access', 'Permissions',
  'ConfigurationForm', 'GenerationLogicTypeName', 'GenerationLogicExtensionJson',
  'PlaceholderIcon', 'Id', 'OriginId', 'Name', 'Label', 'ItemType', 'Description',
  'ModuleName', 'FrontEndApplication', 'Suppress', 'DateUpdated', 'BaseModules',
  'Comments', 'ConfigHash',
];

/** Fields whose natural empty value is a list rather than null. */
export const ARRAY_FIELDS = new Set(['Permissions', 'BaseModules']);

/** Alternate column spellings seen across Shesha versions. */
export const COLUMN_ALIASES = {
  OriginId: ['OriginId', 'Origin_Id'],
  TemplateId: ['TemplateId', 'Template_Id'],
  DateUpdated: ['DateUpdated', 'LastModificationTime', 'CreationTime'],
};

/** Version and soft-delete columns used for latest-only selection. Not envelope fields. */
export const CONTROL_COLUMNS = ['VersionNo', 'VersionStatusLkp', 'VersionStatus', 'IsLast', 'IsDeleted'];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function slugify(moduleName, formName) {
  return `${moduleName}.${formName}`.replace(/[^A-Za-z0-9._-]/g, '-');
}

/** Deterministic collision suffixing. Two forms can slug identically once
 *  invalid characters are replaced; never overwrite one with the other. */
export function makeUniqueName(slug, seen) {
  const n = (seen.get(slug) ?? 0) + 1;
  seen.set(slug, n);
  return n === 1 ? slug : `${slug}~${n}`;
}

export function resolveFieldExpression(schema, field) {
  if (field === 'ModuleName') {
    return schema.moduleTable ? 'm.[Name] AS [ModuleName]' : null;
  }
  const names = COLUMN_ALIASES[field] ?? [field];
  for (const n of names) if (schema.formColumns.includes(n)) return `f.[${n}] AS [${field}]`;
  for (const n of names) if (schema.baseColumns.includes(n)) return `b.[${n}] AS [${field}]`;
  return null;
}

export function buildExtractQuery(schema, { includeAllVersions = false } = {}) {
  const select = [];
  const presentFields = [];
  const missingFields = [];

  for (const field of ENVELOPE_FIELDS) {
    const expr = resolveFieldExpression(schema, field);
    if (expr) { select.push(expr); presentFields.push(field); }
    else { select.push(`CAST(NULL AS nvarchar(max)) AS [${field}]`); missingFields.push(field); }
  }
  for (const ctl of CONTROL_COLUMNS) {
    const expr = resolveFieldExpression(schema, ctl);
    if (expr) select.push(expr);
  }

  const from = [`FROM [${schema.formSchema}].[${schema.formTable}] f`];
  if (schema.baseTable) from.push(`JOIN [${schema.baseSchema}].[${schema.baseTable}] b ON b.[Id] = f.[Id]`);
  if (schema.moduleTable) {
    from.push(`LEFT JOIN [${schema.moduleSchema}].[${schema.moduleTable}] m ON m.[Id] = ${schema.moduleSide}.[Module_Id]`);
  }

  // Build predicates only over columns that exist on a side we actually joined.
  const has = (col) => schema.formColumns.includes(col) || (schema.baseTable && schema.baseColumns.includes(col));
  const ref = (col) => {
    const onForm = schema.formColumns.includes(col);
    const onBase = schema.baseTable && schema.baseColumns.includes(col);
    if (onForm && onBase) return `COALESCE(f.[${col}], b.[${col}])`;
    return onForm ? `f.[${col}]` : `b.[${col}]`;
  };

  const where = ['f.[Markup] IS NOT NULL', 'DATALENGTH(f.[Markup]) > 4'];
  if (has('ItemType')) where.push(`${ref('ItemType')} = 'form'`);
  if (has('IsDeleted')) where.push(`COALESCE(${ref('IsDeleted')}, 0) = 0`);

  let usedIsLast = false;
  if (!includeAllVersions && has('IsLast')) {
    where.push(`COALESCE(${ref('IsLast')}, 1) = 1`);
    usedIsLast = true;
  }

  const sql = [
    `SELECT ${select.join(',\n       ')}`,
    from.join('\n'),
    `WHERE ${where.join('\n  AND ')}`,
  ].join('\n');

  return { sql, presentFields, missingFields, usedIsLast };
}

/** Keep the highest VersionNo per module/name. Used when IsLast is unavailable. */
export function collapseToLatest(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = `${row.ModuleName ?? ''}/${row.Name ?? ''}`;
    const v = Number(row.VersionNo ?? 0) || 0;
    const held = best.get(key);
    if (!held || v > held.v) best.set(key, { v, row });
  }
  return [...best.values()].map((e) => e.row);
}

export function buildEnvelope(row) {
  const out = {};
  for (const field of ENVELOPE_FIELDS) {
    let value = Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
    if (value === undefined) value = null;
    if (value instanceof Date) value = value.toISOString();
    if (ARRAY_FIELDS.has(field)) {
      if (value === null) value = [];
      else if (typeof value === 'string') {
        const t = value.trim();
        if (t.startsWith('[')) { try { value = JSON.parse(t); } catch { value = []; } }
        else value = [];
      } else if (!Array.isArray(value)) value = [];
    }
    out[field] = value;
  }
  return out;
}

/** Structural sanity only. Parsing and tree walking belong to defect-census.mjs. */
export function checkMarkupShape(markup) {
  if (typeof markup !== 'string') return { ok: false, reason: `Markup is ${markup === null ? 'null' : typeof markup}, not a string` };
  const t = markup.trim();
  if (t.length <= 4) return { ok: false, reason: `Markup is ${t.length} chars, too short to be a form` };
  if (!t.startsWith('{') || !t.endsWith('}')) {
    return { ok: false, reason: `Markup is not a complete JSON object (chars=${t.length}, starts="${t.slice(0, 24)}")` };
  }
  return { ok: true };
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Discovery. `query` is injected, so this runs against a mock in tests.
// ---------------------------------------------------------------------------

export async function discoverSchema(query, { log = () => {} } = {}) {
  const candidates = await query(`
SELECT t.TABLE_SCHEMA AS SchemaName, t.TABLE_NAME AS TableName, COUNT(*) AS ColumnCount
FROM INFORMATION_SCHEMA.COLUMNS c
JOIN INFORMATION_SCHEMA.TABLES t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.COLUMN_NAME = 'Markup' AND t.TABLE_TYPE = 'BASE TABLE'
GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
ORDER BY COUNT(*) DESC`);

  if (!candidates.length) {
    throw new Error("No base table has a 'Markup' column. This does not look like a Shesha database. Run with --list-databases to check the name.");
  }
  log('tables carrying a Markup column:');
  for (const c of candidates) log(`    ${c.SchemaName}.${c.TableName}  (${c.ColumnCount} columns)`);

  const form = candidates[0];
  const columnsOf = async (schemaName, tableName) =>
    (await query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${tableName}'`))
      .map((r) => r.COLUMN_NAME);

  const formColumns = await columnsOf(form.SchemaName, form.TableName);

  const baseCandidates = await query(`
SELECT t.TABLE_SCHEMA AS SchemaName, t.TABLE_NAME AS TableName
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'Id')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'Name')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'ItemType')
ORDER BY t.TABLE_NAME`);

  let base = null;
  let baseColumns = [];
  for (const b of baseCandidates) {
    if (b.SchemaName === form.SchemaName && b.TableName === form.TableName) continue;
    base = b;
    baseColumns = await columnsOf(b.SchemaName, b.TableName);
    break;
  }
  if (base) log(`base configuration table: ${base.SchemaName}.${base.TableName}  (${baseColumns.length} columns)`);
  else log('no separate base configuration table found');

  let moduleTable = null;
  let moduleSide = null;
  if (formColumns.includes('Module_Id') || baseColumns.includes('Module_Id')) {
    const mods = await query(`
SELECT TOP 1 t.TABLE_SCHEMA AS SchemaName, t.TABLE_NAME AS TableName
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE' AND t.TABLE_NAME LIKE '%Module%'
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'Name')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'Id')
ORDER BY t.TABLE_NAME`);
    if (mods.length) {
      moduleTable = mods[0];
      moduleSide = formColumns.includes('Module_Id') ? 'f' : 'b';
      log(`modules table: ${moduleTable.SchemaName}.${moduleTable.TableName}  (joined from ${moduleSide}.Module_Id)`);
    }
  }
  if (!moduleTable) log('no modules table joinable - ModuleName will be null');

  return {
    formSchema: form.SchemaName, formTable: form.TableName, formColumns,
    baseSchema: base?.SchemaName ?? null, baseTable: base?.TableName ?? null, baseColumns,
    moduleSchema: moduleTable?.SchemaName ?? null, moduleTable: moduleTable?.TableName ?? null, moduleSide,
  };
}

// ---------------------------------------------------------------------------
// The extract itself. Injected `query` and `writeFile` keep it testable.
// ---------------------------------------------------------------------------

export async function runExtract({
  query,
  rows,
  schema,
  sourceTag,
  database,
  server,
  outDir,
  includeAllVersions = false,
  writeFile = (p, text) => fs.writeFileSync(p, text, 'utf8'),
  ensureDir = (p) => fs.mkdirSync(p, { recursive: true }),
  now = () => new Date(),
  log = () => {},
}) {
  const q = buildExtractQuery(schema, { includeAllVersions });
  let data = rows ?? await query(q.sql);

  if (!includeAllVersions && !q.usedIsLast && data.length && 'VersionNo' in data[0]) {
    const before = data.length;
    data = collapseToLatest(data);
    log(`collapsed ${before} rows to ${data.length} latest-version rows`);
  }

  const targetDir = path.join(outDir, sourceTag);
  ensureDir(targetDir);

  const written = [];
  const skipped = [];
  const seen = new Map();

  for (const row of data) {
    const moduleName = row.ModuleName ? String(row.ModuleName) : 'unknown-module';
    const formName = row.Name ? String(row.Name) : `form-${row.Id}`;

    const shape = checkMarkupShape(row.Markup);
    if (!shape.ok) {
      skipped.push({ module: moduleName, name: formName, reason: shape.reason });
      continue;
    }

    const unique = makeUniqueName(slugify(moduleName, formName), seen);
    const file = `${unique}.json`;
    const envelope = buildEnvelope(row);
    // Node's JSON.stringify has no size ceiling, unlike PowerShell 5.1's
    // ConvertTo-Json, which throws on payloads this large.
    const text = JSON.stringify(envelope, null, 2) + '\n';
    writeFile(path.join(targetDir, file), text);

    written.push({
      file, module: moduleName, name: formName,
      sha256: sha256(text),
      envelopeBytes: Buffer.byteLength(text, 'utf8'),
      markupBytes: Buffer.byteLength(String(row.Markup), 'utf8'),
      versionNo: row.VersionNo ?? null,
      componentCount: null,  // filled by defect-census.mjs
      maxDepth: null,        // filled by defect-census.mjs
    });
  }

  const manifest = {
    schemaVersion: 1,
    sourceTag,
    server,
    database,
    extractedAtUtc: now().toISOString(),
    extractedBy: `${os.userInfo().username}@${os.hostname()}`,
    formTable: `${schema.formSchema}.${schema.formTable}`,
    baseTable: schema.baseTable ? `${schema.baseSchema}.${schema.baseTable}` : null,
    modulesTable: schema.moduleTable ? `${schema.moduleSchema}.${schema.moduleTable}` : null,
    envelopeFieldsPresent: q.presentFields,
    envelopeFieldsMissing: q.missingFields,
    provenance: q.missingFields.length ? 'db-export-partial-envelope' : 'db-export-complete-envelope',
    latestVersionOnly: !includeAllVersions,
    latestVersionMethod: q.usedIsLast ? 'IsLast' : (includeAllVersions ? 'none' : 'maxVersionNo'),
    formCount: written.length,
    skippedCount: skipped.length,
    componentCountsFilledBy: 'defect-census.mjs',
    forms: written,
    skipped,
  };
  writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { manifest, query: q, targetDir };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    server: 'localhost,1433', user: 'sa', password: process.env.SFS_SQL_PASSWORD ?? null,
    database: null, sourceTag: null,
    outDir: path.join(os.homedir(), 'Documents', 'sfs-corpus-intake'),
    listDatabases: false, discoverOnly: false, includeAllVersions: false, timeout: 600,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--server': o.server = next(); break;
      case '--user': o.user = next(); break;
      case '--password': o.password = next(); break;
      case '--database': case '-d': o.database = next(); break;
      case '--source-tag': case '-t': o.sourceTag = next(); break;
      case '--out': o.outDir = next(); break;
      case '--list-databases': o.listDatabases = true; break;
      case '--discover-only': o.discoverOnly = true; break;
      case '--include-all-versions': o.includeAllVersions = true; break;
      case '--timeout': o.timeout = Number(next()); break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  return o;
}

const USAGE = `
export-shesha-forms.mjs - extract Shesha form configurations from SQL Server

  node export-shesha-forms.mjs --list-databases
  node export-shesha-forms.mjs -d <database> -t <source-tag> --discover-only
  node export-shesha-forms.mjs -d <database> -t <source-tag>

Options
  -d, --database <name>     database name as SQL Server sees it
  -t, --source-tag <tag>    short label: lowercase, digits, hyphens. Becomes the
                            output directory name and the manifest's sourceTag
      --server <host,port>  default localhost,1433 (a colon is normalised)
      --user <login>        default sa
      --password <pw>       or set SFS_SQL_PASSWORD, or be prompted
      --out <dir>           default ~/Documents/sfs-corpus-intake
      --list-databases      list databases and exit
      --discover-only       connect, discover, print the SQL, write nothing
      --include-all-versions  keep every version, not just the latest
      --timeout <seconds>   request timeout, default 600

Container SQL Server supports SQL logins only - the mssql/server images have no
Windows authentication. Requires the 'mssql' package: npm install mssql
`;

function promptPassword(prompt) {
  // readline with terminal:true echoes what you type, so the previous version
  // printed the password. Read raw and echo nothing.
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      // Piped input: read a line without any echo games.
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (line) => { rl.close(); resolve(line); });
      return;
    }
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let buffer = '';
    const done = (err, value) => {
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(null, buffer);
        if (ch === '\u0003') return done(new Error('cancelled'));           // Ctrl-C
        if (ch === '\u0008' || ch === '\u007f') {                          // Backspace / Delete
          if (buffer.length) { buffer = buffer.slice(0, -1); stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue;
        buffer += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function explainConnectionError(err, server) {
  const m = String(err.message ?? err);
  let hint = null;
  if (/Login failed/i.test(m)) {
    hint = "Login rejected. Container SQL Server images support SQL logins only - there is no Windows authentication.\n" +
           "  Recover the password with: nerdctl exec <container> printenv | Select-String SA_PASSWORD";
  } else if (/ESOCKET|ECONNREFUSED|getaddrinfo|Failed to connect/i.test(m)) {
    hint = `Cannot reach ${server}. Confirm the port is published - 'nerdctl ps' should show 0.0.0.0:1433->1433/tcp.`;
  } else if (/self.signed|certificate/i.test(m)) {
    hint = 'TLS trust failure. This tool sets trustServerCertificate, so check the mssql package version.';
  } else if (/Cannot open database|Login failed for user .* database/i.test(m)) {
    hint = 'Database name not found. Run with --list-databases to see the names SQL Server actually has - a restored backup is often named differently from its .bak file.';
  }
  return hint ? `${m}\n\nLIKELY CAUSE: ${hint}` : m;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  if (opts.help) { console.log(USAGE); process.exit(0); }

  if (/^(.+):(\d+)$/.test(opts.server)) {
    const fixed = opts.server.replace(/^(.+):(\d+)$/, '$1,$2');
    console.log(`   normalised '${opts.server}' to '${fixed}'`);
    opts.server = fixed;
  }

  if (!opts.listDatabases) {
    if (!opts.database || !opts.sourceTag) { console.error('--database and --source-tag are required.'); console.error(USAGE); process.exit(2); }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.sourceTag)) { console.error(`--source-tag must be lowercase letters, digits and hyphens (got "${opts.sourceTag}")`); process.exit(2); }
  }

  let sql;
  try { sql = (await import('mssql')).default; }
  catch { console.error("The 'mssql' package is required.\n  npm install mssql\n"); process.exit(2); }

  if (!opts.password) opts.password = await promptPassword(`Password for SQL login '${opts.user}' on ${opts.server}: `);

  const [host, port] = opts.server.split(',');
  const config = {
    server: host, port: port ? Number(port) : 1433,
    user: opts.user, password: opts.password,
    database: opts.listDatabases ? 'master' : opts.database,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: opts.timeout * 1000, connectionTimeout: 30000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
  };

  let pool;
  try { pool = await sql.connect(config); }
  catch (e) { console.error(`\nSQL connection failed: ${explainConnectionError(e, opts.server)}\n`); process.exit(2); }

  const query = async (text) => (await pool.request().query(text)).recordset ?? [];
  const log = (t) => console.log(`   ${t}`);

  try {
    if (opts.listDatabases) {
      console.log(`\n== databases on ${opts.server}\n`);
      const dbs = await query(`
SELECT d.name AS DatabaseName, d.state_desc AS State,
       CAST(SUM(mf.size) * 8.0 / 1024 AS decimal(18,1)) AS SizeMB
FROM sys.databases d LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id
GROUP BY d.name, d.state_desc ORDER BY d.name`);
      for (const d of dbs) console.log(`   ${String(d.DatabaseName).padEnd(64)} ${String(d.State).padEnd(10)} ${d.SizeMB} MB`);
      console.log('\nPass one of these names to --database.\n');
      return;
    }

    const ping = await query('SELECT @@VERSION AS V, DB_NAME() AS D');
    console.log(`\n== connected to [${ping[0].D}] on ${opts.server}`);
    log(String(ping[0].V).split('\n')[0].trim());

    console.log('\n== schema discovery');
    const schema = await discoverSchema(query, { log });

    console.log('\n== query');
    const q = buildExtractQuery(schema, { includeAllVersions: opts.includeAllVersions });
    console.log(q.sql);
    console.log('');
    log(`envelope fields resolved: ${q.presentFields.length}/23`);
    if (q.missingFields.length) log(`unresolved (null, recorded in manifest): ${q.missingFields.join(', ')}`);
    log(`latest-version filter: ${q.usedIsLast ? 'IsLast = 1' : (opts.includeAllVersions ? 'none' : 'max VersionNo per module/name, after fetch')}`);

    if (opts.discoverOnly) {
      console.log('\ndiscover-only: nothing written. Re-run without --discover-only to extract.\n');
      return;
    }

    console.log('\n== extracting');
    const result = await runExtract({
      query, schema, sourceTag: opts.sourceTag, database: opts.database, server: opts.server,
      outDir: opts.outDir, includeAllVersions: opts.includeAllVersions, log,
    });

    const m = result.manifest;
    console.log('\n== extract complete');
    console.log(`   forms written   : ${m.formCount}`);
    console.log(`   skipped         : ${m.skippedCount}`);
    console.log(`   envelope fields : ${m.envelopeFieldsPresent.length}/23 (${m.provenance})`);
    console.log(`   latest-version  : ${m.latestVersionMethod}`);
    console.log(`   output          : ${result.targetDir}`);
    for (const s of m.skipped) console.log(`   skipped ${s.module}/${s.name}: ${s.reason}`);
    console.log('\nNext: measure the corpus.');
    console.log(`   node defect-census.mjs "${result.targetDir}" --json census-${opts.sourceTag}.json --md census-${opts.sourceTag}.md\n`);
  } catch (e) {
    console.error(`\nfailed: ${explainConnectionError(e, opts.server)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

// pathToFileURL, not string concatenation. On Windows `file://` + a backslash
// path never equals import.meta.url (file:///C:/... with forward slashes), so a
// hand-built comparison silently skips main() and the process exits 0 with no
// output at all - which is exactly what it did.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
