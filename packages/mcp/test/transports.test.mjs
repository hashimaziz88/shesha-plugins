// §4.8 row 13: what is testable without an MCP client. Six cases: the ESM tool surface,
// ajv-strict input schemas, the stdio JSON-RPC pipe, the loopback-only HTTP refusal, an
// HTTP tool call, and CLI/tool parity of the answer. Whether Claude Code has connected is
// WP-11, not a WP-8 acceptance row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(REPO, 'packages/mcp/bin/server.mjs');
const SFS = path.join(REPO, 'packages/sfs/bin/sfs.mjs');
const { tools } = await import(pathToFileURL(path.join(REPO, 'packages/mcp/src/tools/index.mjs')).href);

/** The datatable version the HTTP call (e) observed, compared against the CLI (f). @type {number|undefined} */
let dtVersion;

test('a: the ESM tool surface exposes exactly seven names', () => {
  assert.equal(tools.length, 7);
  assert.deepEqual(tools.map((/** @type {any} */ t) => t.name).sort(),
    ['compile', 'decompile', 'metadata_entity', 'precedent_search', 'push', 'registry_lookup', 'verify']);
});

test('b: every tool inputSchema compiles under ajv strict', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const t of tools) assert.doesNotThrow(() => ajv.compile(t.inputSchema), `${t.name} inputSchema`);
});

test('c: stdio answers JSON-RPC initialize + tools/list with 7 tools', () => {
  const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pipe', version: '1' } } })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`;
  const r = spawnSync(process.execPath, [SERVER, '--stdio'], { input, encoding: 'utf8', timeout: 15000 });
  const listed = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((m) => m && m.result && Array.isArray(m.result.tools));
  assert.ok(listed, 'no tools/list response on stdout');
  assert.equal(listed.result.tools.length, 7);
});

test('d: --http --host 0.0.0.0 refuses with exit 2', () => {
  const r = spawnSync(process.execPath, [SERVER, '--http', '--host', '0.0.0.0', '--port', '7392'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 2);
});

test('e: --http --host 127.0.0.1 answers POST /tools/registry_lookup', async () => {
  const port = 7393;
  const srv = spawn(process.execPath, [SERVER, '--http', '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    let record = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/tools/registry_lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ types: ['datatable'] }) });
        const body = await res.json();
        record = (body.records || []).find((/** @type {any} */ x) => x.type === 'datatable');
        if (record) break;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(record, 'no datatable record from the http tool call');
    assert.equal(record.type, 'datatable');
    dtVersion = record.version;
  } finally { srv.kill(); }
});

test('f: the CLI subcommand returns the same version as the HTTP tool', () => {
  const r = spawnSync(process.execPath, [SFS, 'registry', 'datatable', '--json'], { encoding: 'utf8', timeout: 10000 });
  const out = JSON.parse(r.stdout);
  const version = (out.records || [])[0]?.version;
  assert.equal(version, dtVersion, 'CLI version disagrees with the HTTP tool version');
});
