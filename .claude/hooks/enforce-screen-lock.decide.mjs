// enforce-screen-lock (§4.3.6): PreToolUse on Write/Edit/NotebookEdit. Fan-out mutex
// (one author per screen) plus the contract precondition (no implementation before a
// signed acceptance contract). A lock's identity is (role, screen, runId) — no
// session_id. Pure over ctx = {root, fs}: the run id and screen come from the path.

const THIRTY_MIN = 30 * 60 * 1000;

/** @param {string} root @param {string} p */
function toRel(root, p) {
  let s = String(p).replace(/\\/g, '/');
  const r = String(root).replace(/\\/g, '/').replace(/\/$/, '');
  if (s.startsWith(`${r}/`)) s = s.slice(r.length + 1);
  return s.replace(/^\.\//, '');
}

/** @param {string} rel @returns {{runId:string, kind:'plan'|'screen'|'other', screen?:string}|null} */
function classify(rel) {
  const m = /^runs\/([^/]+)\/(.+)$/.exec(rel);
  if (!m) return null;
  const runId = m[1] ?? '';
  const rest = m[2] ?? '';
  if (rest === 'plan.json') return { runId, kind: 'plan' };
  const sm = /^screens\/([a-z][a-z0-9-]{0,39})\.sfs(?:\.meta)?\.json$/.exec(rest);
  if (sm) return { runId, kind: 'screen', screen: sm[1] };
  return { runId, kind: 'other' };
}

/** @param {typeof import('node:fs')} fsx @param {string} dir */
function readLocks(fsx, dir) {
  /** @type {{screen:string, role:string, at?:string, mtimeMs:number}[]} */
  const out = [];
  let names = [];
  try { names = fsx.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.lock')) continue;
    try {
      const j = JSON.parse(fsx.readFileSync(`${dir}/${n}`, 'utf8'));
      const st = fsx.statSync(`${dir}/${n}`);
      out.push({ screen: j.screen, role: j.role, at: j.at, mtimeMs: st.mtimeMs });
    } catch { /* malformed lock ignored */ }
  }
  return out;
}

/** @param {typeof import('node:fs')} fsx @param {string} p */
function readJson(fsx, p) { try { return JSON.parse(fsx.readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * @param {{tool_name?:string, tool_input?:any}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), now?:number}} ctx
 * @returns {{event:string, decision:'allow'|'deny', code:string, reason:string, rule:string}}
 */
export function decide(payload, ctx) {
  const ev = (/** @type {'allow'|'deny'} */ decision, /** @type {string} */ code, /** @type {string} */ reason, /** @type {string} */ rule) =>
    ({ event: 'enforce-screen-lock', decision, code, reason, rule });
  const root = ctx.root;
  if (!root) return ev('deny', 'HOOK-0001', 'repo root not found', 'R0');
  const fsx = ctx.fs;
  const now = ctx.now ?? Date.now();
  const name = payload.tool_name;
  if (name !== 'Write' && name !== 'Edit' && name !== 'NotebookEdit') return ev('allow', '', '', 'L0');
  const file = (payload.tool_input || {}).file_path;
  if (typeof file !== 'string') return ev('allow', '', '', 'L0');
  const info = classify(toRel(root, file));
  if (!info || info.kind === 'other') return ev('allow', '', '', 'L0');

  const runDir = `${root}/runs/${info.runId}`;
  const locks = readLocks(fsx, `${runDir}/locks`);

  // L1: plan.json requires a planner lock.
  if (info.kind === 'plan') {
    const planLock = locks.find((l) => l.screen === '__plan__');
    if (!planLock || planLock.role !== 'planner') {
      return ev('deny', 'HOOK-0401', 'plan.json requires a planner lock. Acquire: npm run sfs -- run lock --run <runId> --plan --role planner', 'L1');
    }
    return ev('allow', '', '', 'L7');
  }

  const s = info.screen;
  if (typeof s !== 'string') return ev('allow', '', '', 'L0');
  const own = locks.find((l) => l.role === 'sfs-specwriter' && l.screen === s);
  const other = locks.find((l) => l.role === 'sfs-specwriter' && l.screen !== s);
  if (!own) {
    if (other) {
      const age = now - other.mtimeMs;
      if (age <= THIRTY_MIN) return ev('deny', 'HOOK-0403', `${other.screen} is held by another author since ${other.at}. Fan out across screens, never within one screen.`, 'L3');
      return ev('deny', 'HOOK-0404', `stale lock on ${other.screen} (${Math.round(age / 60000)}m). Release it explicitly: npm run sfs -- run release --run ${info.runId} --screen ${other.screen}`, 'L4');
    }
    return ev('deny', 'HOOK-0402', `no lock on ${s}. Acquire: npm run sfs -- run lock --run ${info.runId} --screen ${s} --role sfs-specwriter`, 'L2');
  }

  // L5: a signed acceptance contract must exist for <s>.
  const plan = readJson(fsx, `${runDir}/plan.json`);
  const screenRow = plan && Array.isArray(plan.screens) ? plan.screens.find((/** @type {any} */ r) => r.name === s) : null;
  const contract = screenRow && screenRow.contract;
  if (!contract || contract.signedOffAt == null || !Array.isArray(contract.predicates) || contract.predicates.length < 3) {
    return ev('deny', 'HOOK-0405', `no signed acceptance contract for ${s}. The Planner negotiates the contract before implementation.`, 'L5');
  }

  // L6: the 3-round repair cap.
  const manifest = readJson(fsx, `${runDir}/manifest.json`);
  const round = manifest && manifest.screens && manifest.screens[s] ? manifest.screens[s].round : 0;
  if (round >= 3 && fsx.existsSync(`${root}/${toRel(root, file)}`)) {
    return ev('deny', 'HOOK-0406', 'repair cap reached (3 rounds). Escalate; do not iterate.', 'L6');
  }
  return ev('allow', '', '', 'L7');
}
