// block-form-writes (§4.3.3): the fast first line of INV 1 (the compiler is the only
// writer of form markup), the run-dir single-writer allowlist, Specwriter markup-
// blindness (R4) and Evaluator log-blindness (R6). Decision rules in order, first
// match wins. Pure over ctx = {root, fs, activeRunId}; g-markup-provenance is the
// decision procedure of last resort.

import { matchGlob, payloadPaths, bashPaths } from './lib.mjs';

const MARKUP = /(?:\.expected)?\.form\.json$/;

/** run-relative writable set (R5), anchored globs. */
const WRITABLE = [
  'plan.json', 'brief.md', 'screens/*.sfs.json', 'screens/*.sfs.meta.json',
  'logs/**', 'dispatch/**', 'blueprints/**', 'precedent/**', 'prereq/**', 'judge/**', 'design/**',
];
/** run-relative toolchain-only set (R3). */
const TOOLCHAIN_ONLY = ['manifest.json', 'screens/*.verdict.json', 'locks/**', 'hooks.jsonl'];

/** @param {string} root @param {string} p normalise to a repo-relative forward-slash path */
function toRel(root, p) {
  let s = String(p).replace(/\\/g, '/');
  const r = String(root).replace(/\\/g, '/').replace(/\/$/, '');
  if (s.startsWith(`${r}/`)) s = s.slice(r.length + 1);
  return s.replace(/^\.\//, '');
}

/** the run-relative remainder of a path under runs/<id>/, or null. @param {string} rel */
function runRel(rel) {
  const m = /^runs\/([^/]+)\/(.+)$/.exec(rel);
  return m ? { runId: m[1] ?? '', rest: m[2] ?? '' } : null;
}

/**
 * A Bash command may write a markup path iff it is a `npm run <script>` whose script's
 * first `node <path>` resolves under packages/, or a direct `node packages/{sfs,mcp,verify}/**`.
 * @param {string} root @param {typeof import('node:fs')} fsx @param {string} command
 */
function writerAllowed(root, fsx, command) {
  const cmd = String(command || '').trim();
  if (/^node\s+packages\/(?:sfs|mcp|verify)\//.test(cmd)) return true;
  const m = /^npm\s+run\s+([A-Za-z0-9:_-]+)\b/.exec(cmd);
  const key = m && m[1];
  if (!key) return false;
  try {
    const pj = JSON.parse(fsx.readFileSync(`${root}/package.json`, 'utf8'));
    const script = (pj.scripts || {})[key];
    if (typeof script !== 'string') return false;
    const nm = /node\s+(packages\/[A-Za-z0-9_./-]+)/.exec(script);
    return !!nm;
  } catch { return false; }
}

/** @param {string} rel @param {string[]} globs */
function anyGlob(rel, globs) { return globs.some((g) => matchGlob(g, rel)); }

/**
 * @param {{tool_name?:string, tool_input?:any}} payload
 * @param {{root:string|null, fs:typeof import('node:fs'), activeRunId:string|null}} ctx
 * @returns {{event:string, decision:'allow'|'deny', code:string, reason:string, rule:string}}
 */
export function decide(payload, ctx) {
  /** @param {'allow'|'deny'} decision @param {string} code @param {string} reason @param {string} rule */
  const ev = (decision, code, reason, rule) => ({ event: 'block-form-writes', decision, code, reason, rule });
  const root = ctx.root;
  if (!root) return ev('deny', 'HOOK-0001', 'repo root not found', 'R0');
  const fsx = ctx.fs;
  const runId = ctx.activeRunId;
  const name = payload.tool_name;
  const input = payload.tool_input || {};
  const isWrite = name === 'Write' || name === 'Edit' || name === 'NotebookEdit';
  const isRead = name === 'Read';
  const isBash = name === 'Bash';
  const rels = payloadPaths(payload).map((p) => toRel(root, p));

  const locks = (() => {
    if (!runId) return [];
    const dir = `${root}/runs/${runId}/locks`;
    try {
      return fsx.readdirSync(dir).filter((n) => n.endsWith('.lock')).map((n) => {
        try { return JSON.parse(fsx.readFileSync(`${dir}/${n}`, 'utf8')); } catch { return {}; }
      });
    } catch { return []; }
  })();
  const specwriterLock = locks.some((l) => l && l.role === 'sfs-specwriter');
  const evalLock = locks.some((l) => l && typeof l.screen === 'string' && (l.role === 'sfs-evaluator'))
    || (() => { try { return fsx.readdirSync(`${root}/runs/${runId}/locks`).some((n) => /^eval-.*\.lock$/.test(n)); } catch { return false; } })();

  // R1
  if (isWrite && rels.some((r) => MARKUP.test(r))) {
    return ev('deny', 'HOOK-0101', 'the compiler is the only writer of form markup. Write SFS and run: npm run sfs -- compile --run <runId> --screen <screen>; to refresh a fixture run: npm run bless', 'R1');
  }
  // R2
  if (isBash) {
    const targets = bashPaths(input.command);
    if (targets.some((t) => MARKUP.test(t.replace(/\\/g, '/'))) && !writerAllowed(root, fsx, input.command)) {
      return ev('deny', 'HOOK-0102', 'a Bash write to form markup is denied; only the compiler (npm run sfs -- compile / npm run bless) or a packages/ tool may emit it', 'R2');
    }
  }
  // R3
  if (isWrite) {
    for (const r of rels) {
      const rr = runRel(r);
      if (rr && anyGlob(rr.rest, TOOLCHAIN_ONLY)) {
        return ev('deny', 'HOOK-0103', `${rr.rest} is written only by the toolchain. Use: npm run sfs -- run …`, 'R3');
      }
    }
  }
  // R4
  if (isRead && specwriterLock && rels.some((r) => MARKUP.test(r) || matchGlob('packages/sfs/corpus/**/*.json', r))) {
    return ev('deny', 'HOOK-0104', 'markup is not readable while a spec is being written. The IR is the interface. See plugins/shesha-developer/skills/shesha-spec/', 'R4');
  }
  // R5
  if (isWrite) {
    for (const r of rels) {
      const rr = runRel(r);
      if (rr && !anyGlob(rr.rest, WRITABLE) && !anyGlob(rr.rest, TOOLCHAIN_ONLY)) {
        return ev('deny', 'HOOK-0105', `${rr.rest} is not in the run-dir writable set`, 'R5');
      }
    }
  }
  // R6
  if (evalLock) {
    const readsLog = isRead && rels.some((r) => /(^|\/)logs\//.test(r) || /\.rationale\./.test(r));
    const bashLog = isBash && /(^|\/)logs\/|\.rationale\.|__SAA_RESULT__/.test(String(input.command || ''));
    if (readsLog || bashLog) {
      return ev('deny', 'HOOK-0106', 'judge isolation: the evaluator never reads the builder\'s reasoning', 'R6');
    }
  }
  return ev('allow', 'HOOK-0000', 'allowed', 'R7');
}
