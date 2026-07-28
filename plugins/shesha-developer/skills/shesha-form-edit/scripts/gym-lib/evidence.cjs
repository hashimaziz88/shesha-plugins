/**
 * Evidence-bundle verification, defined ONCE.
 *
 * Two callers need identical rules, and they must not drift:
 *   - hooks/scripts/hook-verify-push.cjs   the Stop gate
 *   - scripts/verify-evidence.mjs          the aggregate check a caller runs after a fan-out
 *
 * CommonJS so the .cjs hook and the .mjs script share one implementation. The ledger-path
 * problem this release already fixed was caused by exactly this kind of duplication.
 *
 * The contract: a dispatched agent returns an evidence PATH and an EXIT CODE, never a prose
 * summary. The caller verifies the bundle. Nothing here trusts a claim — every field is
 * checked against the bundle on disk and its digest.
 */
const fs = require('fs');
const crypto = require('crypto');

/** Statuses that mean the work is genuinely settled. */
const SETTLED = new Set(['verified', 'abandoned']);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Verify one ledger entry against its bundle on disk.
 * @param {object} entry ledger entry — { module, form, evidence, evidenceSha256, markupSha256 }
 * @returns {{ok: boolean, at: string, problem?: string, status?: string, formId?: string}}
 */
function verifyEntry(entry) {
  const at = `${entry?.module ?? '?'}/${entry?.form ?? '?'}`;

  if (!entry?.evidence) {
    return { ok: false, at, problem: 'ledger entry has no evidence path — it was not written by apply-form.mjs' };
  }
  if (!fs.existsSync(entry.evidence)) {
    return { ok: false, at, problem: `evidence bundle missing at ${entry.evidence}` };
  }

  let body;
  try { body = fs.readFileSync(entry.evidence, 'utf8'); } catch (e) {
    return { ok: false, at, problem: `evidence bundle unreadable (${e.message})` };
  }

  if (entry.evidenceSha256 && sha256(body) !== entry.evidenceSha256) {
    return { ok: false, at, problem: 'evidence bundle does not match its recorded digest — it was modified after the run' };
  }

  let bundle;
  try { bundle = JSON.parse(body); } catch (e) {
    return { ok: false, at, problem: `evidence bundle is not valid JSON (${e.message})` };
  }

  if (bundle.markupSha256 && entry.markupSha256 && bundle.markupSha256 !== entry.markupSha256) {
    return { ok: false, at, problem: 'the bundle is evidence for different markup than the ledger claims' };
  }

  // A sidecar is written alongside every bundle; its absence means the bundle did not come
  // from apply-form, and a mismatch means one of the two was edited.
  const sidecar = `${entry.evidence}.sha256`;
  if (fs.existsSync(sidecar)) {
    const recorded = fs.readFileSync(sidecar, 'utf8').trim();
    if (recorded !== sha256(body)) {
      return { ok: false, at, problem: 'evidence bundle does not match its sidecar digest' };
    }
  }

  if (!SETTLED.has(bundle.status)) {
    const why = bundle.failure ? ` (${String(bundle.failure).slice(0, 140)})` : '';
    return { ok: false, at, problem: `evidence records status="${bundle.status}"${why}`, status: bundle.status };
  }

  return { ok: true, at, status: bundle.status, formId: bundle.form?.id ?? null };
}

/** Verify a bundle path directly, without a ledger entry (what an agent returns). */
function verifyBundlePath(bundlePath) {
  return verifyEntry({ evidence: bundlePath, module: '?', form: '?' });
}

/** Read a ledger file, tolerating both the v1 array and v2 { entries } shapes. */
function readLedger(ledgerPath) {
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.entries ?? [];
}

module.exports = { SETTLED, sha256, verifyEntry, verifyBundlePath, readLedger };
