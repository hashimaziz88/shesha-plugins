// @shesha/mcp — L4: the MCP tool surface exposing compile / decompile / verify /
// registry_lookup / push.
//
// The server itself, its @modelcontextprotocol/sdk pin and the .mcp.json wiring
// are BL-008: Claude Code reads MCP configuration at session start, so a server
// written mid-session cannot be verified by the session that wrote it.

export const MCP_API_VERSION = '0.1.0';

/**
 * The exported tool list g-commands-executable resolves `mcp__<server>__<tool>`
 * references against. Empty until BL-008 lands the server.
 * @type {string[]}
 */
export const tools = [];
