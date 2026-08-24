// @shesha/mcp — L4: the MCP tool surface exposing compile / decompile / verify /
// registry_lookup / push.
//
// The server itself, its @modelcontextprotocol/sdk pin and the .mcp.json wiring
// are BL-008: Claude Code reads MCP configuration at session start, so a server
// written mid-session cannot be verified by the session that wrote it.

export const MCP_API_VERSION = '0.1.0';

/**
 * The exported tool-name surface g-commands-executable resolves `mcp__<server>__<tool>`
 * references against. These seven names are the L4 tool surface the agent files (WP-8c.1)
 * reference; the server runtime that implements them — @modelcontextprotocol/sdk, the
 * three transports and the handlers — is WP-8d.
 * @type {string[]}
 */
export const tools = [
  'compile',
  'decompile',
  'verify',
  'registry_lookup',
  'metadata_entity',
  'precedent_search',
  'push',
];
