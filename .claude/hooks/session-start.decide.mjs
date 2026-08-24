// session-start (§4.3.7): SessionStart on startup|resume|clear|compact. It gates nothing
// — a SessionStart hook that blocks makes the repo unopenable. It makes the ground truth
// explicit at turn zero and after every compaction, as exactly six lines of
// additionalContext. Pure over an injected ctx so the test asserts the six lines without a
// cold start; the runner fills the real node version, clock and probes.

/** @param {typeof import('node:fs')} fsx @param {string} p */
function readJson(fsx, p) { try { return JSON.parse(fsx.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } }
/** @param {typeof import('node:fs')} fsx @param {string} p */
function readText(fsx, p) { try { return fsx.readFileSync(p, 'utf8').trim(); } catch { return ''; } }

/**
 * @param {{hook_event_name?:string, source?:string}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), spawnNode:(root:string, argv:string[], opts?:any)=>{status:number|null}, nodeVersion?:string, backend?:string|null, chromium?:boolean}} ctx
 * @returns {{event:string, decision:'allow', lines:string[], additionalContext:string}}
 */
export function decide(payload, ctx) {
  const root = ctx.root;
  const fsx = ctx.fs;
  const nodeV = ctx.nodeVersion || 'unknown';

  const meta = root ? readJson(fsx, `${root}/packages/registry/data/0.45.1/_meta.json`) : null;
  const sfsPkg = root ? readJson(fsx, `${root}/packages/sfs/package.json`) : null;
  const ajvPkg = root ? readJson(fsx, `${root}/node_modules/ajv/package.json`) : null;
  const registryRef = (meta && (meta.registryRef || meta.ref || meta.version)) || '?';
  const line1 = `toolchain: node ${nodeV} · sfs ${(sfsPkg && sfsPkg.version) || '?'} · registry ${registryRef} · ajv ${(ajvPkg && ajvPkg.version) || '?'}`;

  // green: never a verdict on timeout or spawn failure — typecheck + gates only, 20 s cap.
  let green = 'not measured (timeout)';
  if (root) {
    let res = null;
    try { res = ctx.spawnNode(root, [`${root}/packages/verify/src/bin/green-quick.mjs`, '--json'], { timeout: 20000 }); } catch { res = null; }
    if (res && res.status === 0) green = 'exit 0';
    else if (res && typeof res.status === 'number') green = `exit ${res.status}`;
  }
  const line2 = `green: ${green}`;

  const line3 = `backend: ${ctx.backend ? `live ${ctx.backend}` : 'none'}  chromium: ${ctx.chromium ? 'present' : 'absent'}`;

  const runId = root ? (readText(fsx, `${root}/.build/active-run`) || null) : null;
  let phase = 'none';
  let screens = '0';
  if (root && runId) {
    const manifest = readJson(fsx, `${root}/runs/${runId}/manifest.json`);
    if (manifest) {
      phase = manifest.phase || '?';
      const s = manifest.screens || {};
      const keys = Object.keys(s);
      screens = `${keys.length} (${keys.map((k) => (s[k] && s[k].state) || '?').join(',')})`;
    }
  }
  const line4 = `active run: ${runId || 'none'}  phase: ${phase}  screens: ${screens}`;

  const line5 = 'invariants: compiler is the only writer of markup · no push without an admissible sealed verdict · one author per screen';
  const line6 = 'read this first: plugins/shesha-developer/skills/shesha-designer/SKILL.md';

  const lines = [line1, line2, line3, line4, line5, line6];
  return { event: 'session-start', decision: 'allow', lines, additionalContext: lines.join('\n') };
}
