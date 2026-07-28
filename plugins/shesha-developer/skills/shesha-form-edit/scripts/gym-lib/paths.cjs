/**
 * Where runtime output goes. CommonJS so the ESM scripts and the .cjs hooks can share
 * ONE definition — the ledger path in particular must resolve identically in
 * apply-form.mjs and hook-verify-push.cjs, or the gate silently finds nothing and
 * allows a stop it should have blocked.
 *
 * Two rules:
 *   1. Never write into the repository or the skill tree. Scratch belongs in the session
 *      workdir (contracts.md §3). A live run previously left render-verdicts/ inside the
 *      skill folder because the instrument defaulted to process.cwd().
 *   2. Anchor session state on the PROJECT, not on cwd. process.cwd() differs between a
 *      script the model runs from a skill subdirectory and a hook the harness runs from
 *      the project root, so anchoring on cwd made the push gate bypassable by running
 *      apply-form from somewhere else.
 */
const path = require('path');
const os = require('os');

/** The project root, when the harness tells us. */
function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || null;
}

/**
 * Session scratch: SHESHA_WORKDIR (set by an orchestrator), else a per-project cache,
 * else the system temp dir. Never cwd, never the skill tree.
 */
function sessionWorkdir() {
  if (process.env.SHESHA_WORKDIR) return process.env.SHESHA_WORKDIR;
  const proj = projectDir();
  if (proj) return path.join(proj, '.claude', 'cache', 'shesha-form-edit');
  const tmp = process.env.TMPDIR || process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(tmp, 'shesha-form-edit');
}

/**
 * The push ledger. Anchored on the project so the writer (apply-form.mjs) and the reader
 * (hook-verify-push.cjs) agree regardless of the cwd either was launched from.
 */
function ledgerPath() {
  const base = projectDir() || process.cwd();
  return path.join(base, '.claude', 'cache', 'shesha-form-edit', 'push-ledger.json');
}

/** Generated run evidence — render verdicts, screenshots, apply bundles. */
function evidenceDir() {
  return path.join(sessionWorkdir(), 'evidence');
}

function renderVerdictDir() {
  return path.join(sessionWorkdir(), 'render-verdicts');
}

module.exports = { projectDir, sessionWorkdir, ledgerPath, evidenceDir, renderVerdictDir };
