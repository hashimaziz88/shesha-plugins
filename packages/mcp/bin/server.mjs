#!/usr/bin/env node
// The shesha-sfs server: three thin adapters over packages/mcp/src/tools (§4.5). One
// implementation, three surfaces — MCP stdio for Claude Code, loopback HTTP for a local
// model, and a CLI subcommand per tool for CI / any shell. g-mcp-cli-parity asserts the
// subcommand set equals the tool-name set and each flag set equals the tool's inputSchema.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tools, byName } from '../src/tools/index.mjs';

/** The CLI subcommand set IS the tool-name set, by construction (parity, §4.5). */
export const subcommands = tools.map((t) => t.name);
const SERVER_INFO = { name: 'shesha-sfs', version: '0.1.0' };

const toolList = () => tools.map((t) => ({ name: t.name, description: t.summary, inputSchema: t.inputSchema }));
/** @param {string} name @param {any} args */
async function callTool(name, args) {
  const t = byName[name];
  if (!t) throw new Error(`unknown tool ${name}`);
  return t.run(args || {});
}

async function runStdio() {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (/** @type {any} */ req) => ({
    content: [{ type: 'text', text: JSON.stringify(await callTool(req.params.name, req.params.arguments)) }],
  }));
  await server.connect(new StdioServerTransport());
}

/** @param {string} host @param {number} port */
function runHttp(host, port) {
  // Loopback only. Any other host is a hard refusal (exit 2), never a silent 0.0.0.0 bind.
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write(`shesha-sfs: --http binds loopback only; refusing --host ${host}\n`);
    process.exit(2);
  }
  const srv = http.createServer((req, res) => {
    const m = /^\/tools\/([a-z_]+)$/.exec(req.url || '');
    if (req.method !== 'POST' || !m) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const out = await callTool(/** @type {string} */ (m[1]), body ? JSON.parse(body) : {});
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(/** @type {Error} */ (e).message) })); }
    });
  });
  srv.listen(port, host, () => process.stderr.write(`shesha-sfs http on ${host}:${port}\n`));
}

/** Build the tool input from --flags, derived entirely from the tool's inputSchema (parity). @param {any} schema @param {string[]} args */
function parseFlags(schema, args) {
  /** @type {Record<string, any>} */
  const input = {};
  const props = (schema && schema.properties) || {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === undefined || !a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'json') continue;
    const prop = props[key];
    if (prop && prop.type === 'boolean') { input[key] = true; continue; }
    if (prop && prop.const === true) { input[key] = true; continue; }
    if (prop && prop.type === 'array') { input[key] = String(args[i + 1] || '').split(',').filter(Boolean); i += 1; continue; }
    if (prop && prop.type === 'integer') { input[key] = Number(args[i + 1]); i += 1; continue; }
    input[key] = args[i + 1]; i += 1;
  }
  return input;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function runCli(argv) {
  const name = argv[0];
  const t = name === undefined ? undefined : byName[name];
  if (!t) { process.stderr.write(`shesha-sfs: unknown tool "${name}"; one of ${subcommands.join(', ')}\n`); return 2; }
  const asJson = argv.includes('--json');
  let out;
  try { out = await t.run(parseFlags(t.inputSchema, argv.slice(1))); } catch (e) { process.stderr.write(`${name}: ${String(/** @type {Error} */ (e).message).split('\n')[0]}\n`); return 1; }
  if (asJson) process.stdout.write(`${JSON.stringify(out)}\n`);
  else process.stdout.write(`${name}: ok\n`);
  return typeof out.exit === 'number' ? out.exit : 0;
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--stdio')) { await runStdio(); return 0; }
  if (args.includes('--http')) {
    const host = args[args.indexOf('--host') + 1] || '127.0.0.1';
    const port = Number(args[args.indexOf('--port') + 1] || 7371);
    runHttp(host, port);
    return 0;
  }
  const first = args[0];
  if (first !== undefined && !first.startsWith('--')) return runCli(args);
  process.stderr.write('usage: server.mjs (--stdio | --http --host 127.0.0.1 --port 7371 | <tool> [--flags] [--json])\n');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => { if (code) process.exit(code); }).catch((e) => { process.stderr.write(`${e}\n`); process.exit(1); });
}
