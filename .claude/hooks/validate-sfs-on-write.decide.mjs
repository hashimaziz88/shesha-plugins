// validate-sfs-on-write (§4.3.4): PostToolUse on Write/Edit/NotebookEdit. Fires after
// the write, so the file exists to be validated. It spawns `sfs validate` (ajv lives in
// a dependency; a hook imports none), surfaces the compiler's diagnostics verbatim, and
// on any block RENAMES the file to *.rejected (V5) — a PostToolUse block does not undo
// the write, so an SFS that failed SFS-1002 must not stay on disk for a later compile.

/** @type {[RegExp, string][]} */
const SCHEMA_BY = [
  [/\.sfs\.meta\.json$/, 'sfs-meta'],
  [/\.sfs\.json$/, 'sfs'],
  [/(^|\/)plan\.json$/, 'plan'],
  [/(^|\/)dispatch\/[^/]*\.json$/, 'dispatch'],
];

/** @param {typeof import('node:fs')} fsx @param {string} p */
function readJson(fsx, p) { try { return JSON.parse(fsx.readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * @param {{tool_name?:string, tool_input?:any}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), spawnNode:(root:string, argv:string[])=>{status:number|null, stdout?:string}}} ctx
 * @returns {{event:string, decision:'allow'|'block', code:string, reason:string, rule:string}}
 */
export function decide(payload, ctx) {
  const ev = (/** @type {'allow'|'block'} */ decision, /** @type {string} */ code, /** @type {string} */ reason, /** @type {string} */ rule) =>
    ({ event: 'validate-sfs-on-write', decision, code, reason, rule });
  const root = ctx.root;
  const name = payload.tool_name;
  if (!root || (name !== 'Write' && name !== 'Edit' && name !== 'NotebookEdit')) return ev('allow', '', '', 'V0');
  const file = (payload.tool_input || {}).file_path;
  if (typeof file !== 'string') return ev('allow', '', '', 'V0');
  const rel = file.replace(/\\/g, '/');
  let schema = null;
  for (const [re, s] of SCHEMA_BY) if (re.test(rel)) { schema = s; break; }
  if (!schema) return ev('allow', '', '', 'V0');

  const fsx = ctx.fs;
  const full = /^([A-Za-z]:|\/)/.test(rel) ? rel : `${root}/${rel}`;
  const reject = () => { try { fsx.renameSync(full, `${full}.rejected`); } catch { /* nothing to reject */ } };

  const res = ctx.spawnNode(root, [`${root}/packages/sfs/bin/sfs.mjs`, 'validate', '--schema', schema, '--file', full, '--json']);
  // V1: spawn failed to start, or a non-zero exit with no JSON on stdout.
  if (!res || res.status === null || res.status === undefined || (res.status !== 0 && !res.stdout)) {
    return ev('block', 'HOOK-0002', 'toolchain unavailable — run npm ci', 'V1');
  }

  if (res.status === 0) {
    // V4: an SFS whose form/module disagree with its plan row is a two-author defect.
    if (schema === 'sfs') {
      const m = /^runs\/([^/]+)\/screens\/([a-z][a-z0-9-]{0,39})\.sfs\.json$/.exec(rel);
      const data = readJson(fsx, full);
      if (m && data) {
        const plan = readJson(fsx, `${root}/runs/${m[1]}/plan.json`);
        const row = plan && Array.isArray(plan.screens) ? plan.screens.find((/** @type {any} */ r) => r.name === m[2]) : null;
        if (row && (data.form !== row.formName || data.module !== row.module)) {
          reject();
          return ev('block', 'HOOK-0203', `sfs form/module disagrees with plan.json (form ${data.form}/${row.formName}, module ${data.module}/${row.module})`, 'V4');
        }
      }
    }
    return ev('allow', '', '', 'V2');
  }

  // V3: invalid → surface the validator's diagnostics verbatim, and reject the file.
  let diagnostics = [];
  try { diagnostics = (JSON.parse(res.stdout || '{}').diagnostics) || []; } catch { /* no JSON */ }
  reject();
  return ev('block', 'HOOK-0201', diagnostics.join('\n') || 'schema validation failed', 'V3');
}
