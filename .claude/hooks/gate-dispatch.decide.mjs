// gate-dispatch (§4.3.7): PreToolUse on Task. A subagent is dispatched by handing it a
// dispatch/<role>-<screen>-r<n>.json path, never a prose brief or inline markup. Enforces
// judge isolation (D-016), the paths-not-contents rule, and one-screen-per-specwriter.
// Pure over ctx = {root, fs, spawnNode}.

const DISPATCH_ROLES = ['sfs-planner', 'sfs-specwriter', 'sfs-evaluator', 'design-critic', 'fleet-transformer', 'fullstack-prereq-checker'];
const JUDGES = ['sfs-evaluator', 'design-critic'];
const LEAK = /(^|\/)logs\/|\.rationale\.|__SAA_RESULT__/;

/** @param {typeof import('node:fs')} fsx @param {string} p */
function readJson(fsx, p) { try { return JSON.parse(fsx.readFileSync(p, 'utf8')); } catch { return null; } }

/** @param {typeof import('node:fs')} fsx @param {string} dir */
function openSpecwriterScreens(fsx, dir) {
  /** @type {string[]} */
  const out = [];
  let names = [];
  try { names = fsx.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.lock')) continue;
    const j = readJson(fsx, `${dir}/${n}`);
    if (j && j.role === 'sfs-specwriter' && typeof j.screen === 'string') out.push(j.screen);
  }
  return out;
}

/**
 * @param {{tool_name?:string, tool_input?:any}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), spawnNode:(root:string, argv:string[])=>{status:number|null, stdout?:string}}} ctx
 * @returns {{event:string, decision:'allow'|'deny', code:string, reason:string, rule:string}}
 */
export function decide(payload, ctx) {
  const ev = (/** @type {'allow'|'deny'} */ decision, /** @type {string} */ code, /** @type {string} */ reason, /** @type {string} */ rule) =>
    ({ event: 'gate-dispatch', decision, code, reason, rule });
  const name = payload.tool_name;
  const input = payload.tool_input || {};
  if (name !== 'Task') return ev('allow', '', '', 'D0');
  const role = input.subagent_type;
  if (typeof role !== 'string' || !DISPATCH_ROLES.includes(role)) return ev('allow', '', '', 'D0');

  const root = ctx.root;
  if (!root) return ev('deny', 'HOOK-0001', 'repo root not found', 'D0');
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  // D1: a dispatch/<...>.json path must be present.
  const m = /(?:^|[\s"'`])((?:[A-Za-z0-9_./-]*\/)?dispatch\/[A-Za-z0-9._-]+\.json)/.exec(prompt);
  if (!m || !m[1]) return ev('deny', 'HOOK-0501', 'dispatch a subagent by handing it a dispatch/<role>-<screen>-r<n>.json path, not a prose brief', 'D1');
  const rel = m[1];
  const abs = /^([A-Za-z]:|\/)/.test(rel) ? rel : `${root}/${rel}`;

  // D2: the file must exist and validate against dispatch.schema.json.
  const dispatch = readJson(ctx.fs, abs);
  if (!dispatch) return ev('deny', 'HOOK-0502', `dispatch file missing or unparseable: ${rel}`, 'D2');
  const res = ctx.spawnNode(root, [`${root}/packages/sfs/bin/sfs.mjs`, 'validate', '--schema', 'dispatch', '--file', abs, '--json']);
  if (res && res.status !== 0) {
    let diag = [];
    try { diag = (JSON.parse(res.stdout || '{}').diagnostics) || []; } catch { /* none */ }
    return ev('deny', 'HOOK-0502', diag.join('\n') || 'dispatch fails dispatch.schema.json', 'D2');
  }

  /** @type {string[]} */
  const paths = Array.isArray(dispatch.paths) ? dispatch.paths.map((/** @type {any} */ x) => String(x)) : [];

  // D3: judge isolation — an evaluator/design-critic never receives logs, rationale or a self-report.
  if (JUDGES.includes(role) && paths.some((p) => LEAK.test(p))) {
    return ev('deny', 'HOOK-0503', 'judge isolation: the evaluator never receives the builder’s reasoning or self-report', 'D3');
  }

  // D4: handoffs carry paths, never contents.
  if (prompt.length > 2000 || /\{[\s\S]{0,200}"components"/.test(prompt) || /\{[\s\S]{0,200}"node"\s*:/.test(prompt)) {
    return ev('deny', 'HOOK-0504', 'handoffs carry paths, never contents', 'D4');
  }

  // D5: one screen per specwriter.
  if (role === 'sfs-specwriter') {
    const runId = typeof dispatch.runId === 'string' ? dispatch.runId : null;
    const screen = typeof dispatch.screen === 'string' ? dispatch.screen : null;
    if (runId && screen) {
      const held = openSpecwriterScreens(ctx.fs, `${root}/runs/${runId}/locks`);
      if (held.some((s) => s !== screen)) return ev('deny', 'HOOK-0505', 'one screen per specwriter', 'D5');
    }
  }

  return ev('allow', '', '', 'D6');
}
