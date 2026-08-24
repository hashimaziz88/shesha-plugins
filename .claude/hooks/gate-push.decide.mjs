// gate-push (§4.3.5): PreToolUse. Detection only — every admission rule lives in
// packages/verify/src/bin/push-admissible.mjs, which this spawns. The hook detects a
// push (including a raw curl to the FormConfiguration endpoints, the obvious bypass),
// runs the admission program, and maps its exit code. Pure over ctx = {root, fs, spawnNode}.

const CMD_PUSH = /(npm run sfs -- push|sfs\w*\.mjs push|run push)/;
const RAW_PUSH = /UpdateMarkup|ImportJson|FormConfiguration\/Create|\/api\/services\/Shesha\/FormConfiguration/;

/**
 * @param {{tool_name?:string, tool_input?:any}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), spawnNode:(root:string, argv:string[])=>{status:number|null, stdout?:string}}} ctx
 * @returns {{event:string, decision:'allow'|'deny', code:string, reason:string, rule:string}}
 */
export function decide(payload, ctx) {
  const ev = (/** @type {'allow'|'deny'} */ decision, /** @type {string} */ code, /** @type {string} */ reason, /** @type {string} */ rule) =>
    ({ event: 'gate-push', decision, code, reason, rule });
  const name = payload.tool_name;
  const input = payload.tool_input || {};

  let isPush = false;
  if (name === 'mcp__shesha-sfs__push') isPush = true;
  else if (name === 'Bash') {
    const cmd = String(input.command || '');
    isPush = CMD_PUSH.test(cmd.trim()) || RAW_PUSH.test(cmd);
  }
  if (!isPush) return ev('allow', '', '', 'G0');

  const root = ctx.root;
  if (!root) return ev('deny', 'HOOK-0001', 'repo root not found', 'G0');

  // Extract run/screen/allow-partial wherever they live (a Bash flag, or an mcp input field).
  const src = name === 'Bash' ? String(input.command || '') : JSON.stringify(input);
  const runId = (/--run\s+([0-9]{8}-[0-9]{4}-[a-z0-9-]{1,40})/.exec(src) || [])[1] ?? (typeof input.run === 'string' ? input.run : undefined);
  const screen = (/--screen\s+([a-z][a-z0-9-]{1,39})/.exec(src) || [])[1] ?? (typeof input.screen === 'string' ? input.screen : undefined);
  const allowPartial = /--allow-partial\b/.test(src) || input.allowPartial === true;

  const argv = [`${root}/packages/verify/src/bin/push-admissible.mjs`, '--json'];
  if (runId) argv.push('--run', runId);
  if (screen) argv.push('--screen', screen);
  if (allowPartial) argv.push('--allow-partial');

  const res = ctx.spawnNode(root, argv);
  if (!res || res.status === null || res.status === undefined || !res.stdout) {
    return ev('deny', 'HOOK-0002', 'push-admissible could not start — run npm ci', 'G1');
  }
  let out;
  try { out = JSON.parse(res.stdout); } catch { return ev('deny', 'HOOK-0002', 'push-admissible produced no verdict', 'G1'); }
  if (out.admissible) return ev('allow', '', '', 'G2');
  return ev('deny', out.code || 'HOOK-0307', out.reason || 'push refused', 'G3');
}
