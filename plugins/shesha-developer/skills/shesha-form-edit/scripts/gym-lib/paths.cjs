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
const crypto = require('crypto');

/** The project root, when the harness tells us. */
function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || null;
}

/**
 * Runtime state lives OUTSIDE the user's repository. The plugin does not control the
 * consuming project's .gitignore, so anything it writes into the tree shows up as
 * untracked noise in someone else's diff. Everything therefore goes under the system
 * temp dir, namespaced by a digest of the project path so two checkouts never collide
 * and so the writer and the reader derive the same directory without being told.
 */
function stateRoot() {
  if (process.env.SHESHA_WORKDIR) return process.env.SHESHA_WORKDIR;
  const tmp = process.env.TMPDIR || process.env.TEMP || process.env.TMP || os.tmpdir();
  const key = projectDir() || process.cwd();
  const slug = crypto.createHash('sha1').update(path.resolve(key)).digest('hex').slice(0, 12);
  return path.join(tmp, 'shesha-form-edit', slug);
}

/** Session scratch. Never cwd, never the skill tree, never the user's project. */
function sessionWorkdir() {
  return stateRoot();
}

/**
 * The push ledger. Derived from the project path rather than stored in it, so the writer
 * (apply-form.mjs) and the reader (hook-verify-push.cjs) agree regardless of the cwd
 * either was launched from — while leaving the repository untouched.
 */
function ledgerPath() {
  return path.join(stateRoot(), 'push-ledger.json');
}

/** Generated run evidence — render verdicts, screenshots, apply bundles. */
function evidenceDir() {
  return path.join(sessionWorkdir(), 'evidence');
}

function renderVerdictDir() {
  return path.join(sessionWorkdir(), 'render-verdicts');
}

module.exports = { projectDir, sessionWorkdir, ledgerPath, evidenceDir, renderVerdictDir };
