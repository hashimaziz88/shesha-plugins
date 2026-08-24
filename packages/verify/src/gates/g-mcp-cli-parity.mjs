// §4.5 / §4.8 row 12: two surfaces, one implementation, or they drift. The exported tool
// set (packages/mcp/src/tools/*.mjs) must equal the CLI subcommand set (server.mjs derives
// its subcommands from that same table), each tool's flag set is its inputSchema (server's
// parseFlags is schema-driven, so they cannot diverge), and the ESM export exists so an
// agent with Bash can batch calls. Static analysis — no import, so the gate stages only
// packages/mcp text and never needs the other packages' trees.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { readText, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-mcp-cli-parity';
export const describe = 'the exported MCP tool set equals the CLI subcommand set, each flag set is its inputSchema, and the ESM export exists';
export const inputPaths = ['packages/mcp', '.mcp.json'];

const TOOLS_DIR = 'packages/mcp/src/tools';
const INDEX = `${TOOLS_DIR}/index.mjs`;
const SERVER = 'packages/mcp/bin/server.mjs';

/** @param {string} root @returns {{names:string[], withSchema:number, bad:string[]}} */
function scanTools(root) {
  const dir = path.join(root, TOOLS_DIR);
  /** @type {string[]} */ const names = [];
  /** @type {string[]} */ const bad = [];
  let withSchema = 0;
  /** @type {string[]} */
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs'); } catch { /* absent */ }
  for (const f of files.sort()) {
    const text = readText(path.join(dir, f)) || '';
    const base = f.replace(/\.mjs$/, '');
    const nm = /export const name = '([a-z_]+)'/.exec(text);
    const name = nm ? nm[1] : null;
    if (name !== base) bad.push(`${f}: export const name "${name}" != basename "${base}"`);
    else names.push(base);
    if (/export const inputSchema = \{/.test(text)) withSchema += 1;
    else bad.push(`${f}: no inputSchema`);
    if (!/export (async )?function run|export const run/.test(text)) bad.push(`${f}: no run export`);
  }
  return { names: names.sort(), withSchema, bad };
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'tools', unit: 'file' },
    { name: 'parity', unit: 'assertion' },
    { name: 'wiring', unit: 'assertion' },
  ]);
  const toolsFam = fams.get('tools');
  const parityFam = fams.get('parity');
  const wireFam = fams.get('wiring');

  const scan = scanTools(root);
  for (const b of scan.bad) toolsFam.pointer(b.split(':')[0] || 'tool').fail(b);
  for (const n of scan.names) toolsFam.pointer(`${TOOLS_DIR}/${n}.mjs`).check();

  // parity: index imports every tool and exports the table; server derives subcommands from it.
  const indexText = readText(path.join(root, INDEX)) || '';
  const serverText = readText(path.join(root, SERVER)) || '';
  parityFam.pointer(`${INDEX}#seven`).assert(scan.names.length === 7, `${scan.names.length} tool modules, expected 7`);
  for (const n of scan.names) parityFam.pointer(`${INDEX}#imports:${n}`).assert(new RegExp(`import \\* as ${n} from './${n}.mjs'`).test(indexText), `index.mjs does not import ${n}`);
  parityFam.pointer(`${INDEX}#export`).assert(/export const tools =/.test(indexText) && /export const byName =/.test(indexText), 'tools/index.mjs must export both `tools` and `byName` (the ESM surface)');
  parityFam.pointer(`${SERVER}#subcommands`).assert(/export const subcommands = tools\.map\(/.test(serverText), 'server.mjs must derive `subcommands` from the tool table (parity by construction)');
  parityFam.pointer(`${SERVER}#schema-driven`).assert(/parseFlags\(t\.inputSchema/.test(serverText) && /schema && schema\.properties/.test(serverText), 'the CLI flag set must be derived from each tool inputSchema, or the flag set can drift from the schema');
  parityFam.pointer(`${SERVER}#imports-table`).assert(/from '\.\.\/src\/tools\/index\.mjs'/.test(serverText), 'server.mjs must adapt the one tool table, not a second copy');

  // wiring: /.mcp.json points node at the server over stdio.
  let mcp = /** @type {any} */ (null);
  try { mcp = JSON.parse(readText(path.join(root, '.mcp.json')) || ''); } catch { /* handled */ }
  const args = mcp && mcp.mcpServers && mcp.mcpServers['shesha-sfs'] ? mcp.mcpServers['shesha-sfs'].args || [] : null;
  wireFam.pointer('.mcp.json#shesha-sfs').assert(Array.isArray(args) && args.includes('packages/mcp/bin/server.mjs') && args.includes('--stdio'),
    '.mcp.json must launch node packages/mcp/bin/server.mjs --stdio for the shesha-sfs server');

  return fams.list;
}

export const mutations = [
  {
    name: 'a tool is dropped from the index, so the export set no longer matches the CLI',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, INDEX);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/import \* as push from '\.\/push\.mjs';\n/, '').replace(/, push\]/, ']'));
    },
    expect: 'fail',
  },
  {
    name: 'the server stops deriving subcommands from the tool table (a second, driftable copy)',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, SERVER);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/export const subcommands = tools\.map\(\(t\) => t\.name\);/, "export const subcommands = ['compile'];"));
    },
    expect: 'fail',
  },
];

/** The §4.8 row-12 JSON shape. @param {import('@shesha/registry/coverage').Family[]} fams */
function summary(fams) {
  const tools = fams.find((f) => f.name === 'tools');
  return { result: verdictOf(fams), tools: tools ? tools.checked : 0, subcommands: tools ? tools.checked : 0, schemaMismatches: 0 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    if (process.argv.includes('--json')) console.log(JSON.stringify(summary(fams)));
    else console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
