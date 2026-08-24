// The single implementation of the seven shesha-sfs tools (§4.5). The MCP server and the
// CLI are two thin adapters over this module; g-mcp-cli-parity asserts the two surfaces
// stay in lockstep. Importable as ESM so an agent with Bash can call compile on 12 screens
// in a 5-line script instead of issuing 12 tool calls (token economics, §4.5).
import * as compile from './compile.mjs';
import * as decompile from './decompile.mjs';
import * as verify from './verify.mjs';
import * as registry_lookup from './registry_lookup.mjs';
import * as metadata_entity from './metadata_entity.mjs';
import * as precedent_search from './precedent_search.mjs';
import * as push from './push.mjs';

/** @type {{name:string, summary:string, inputSchema:object, run:(input?:any)=>any}[]} */
export const tools = [compile, decompile, verify, registry_lookup, metadata_entity, precedent_search, push]
  .map((m) => ({ name: m.name, summary: m.summary, inputSchema: m.inputSchema, run: m.run }));

/** @type {Record<string, {name:string, summary:string, inputSchema:object, run:(input?:any)=>any}>} */
export const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
