#!/usr/bin/env node
/**
 * Stop hook: persistence gate. FAILS CLOSED.
 *
 * A validated file on disk is not a delivered form. Every entry in the push ledger must
 * resolve to a content-addressed evidence bundle written by scripts/apply-form.mjs, and
 * that bundle must still hash to its recorded digest.
 *
 * The previous version failed OPEN on a missing, stale (>12h) or unparseable ledger, and
 * the ledger itself was hand-authored by the model it was policing — so the gate could be
 * satisfied by writing a JSON file claiming success. Now the ledger only points at
 * evidence, and each of these BLOCKS:
 *
 *   - a ledger that will not parse
 *   - an entry whose evidence bundle is missing
 *   - an entry whose bundle does not match its recorded sha256 (hand-edited)
 *   - an entry whose bundle records a status other than verified/abandoned
 *   - an entry whose bundle is for different markup than the ledger claims
 *
 * Scope: no ledger at all means no push was recorded this session, so there is nothing to
 * verify and the stop is allowed. That is scoping, not failing open — the moment a push is
 * claimed, the evidence for it must exist and be intact.
 *
 * Honors stop_hook_active to avoid loops.
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../skills/shesha-form-edit/scripts/gym-lib/paths.cjs');
const evidence = require('../../skills/shesha-form-edit/scripts/gym-lib/evidence.cjs');

function main() {
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fall through */ }
  if (payload.stop_hook_active) return 0;

  // Same resolver the writer uses — anchoring both on cwd let a push run from a
  // subdirectory write a ledger this hook would never find, silently allowing the stop.
  const ledgerPath = paths.ledgerPath();
  if (!fs.existsSync(ledgerPath)) return 0;   // nothing claimed → nothing to verify

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    console.error(
      `[shesha hook] PERSISTENCE GATE: the push ledger will not parse (${e.message}).\n`
      + `An unreadable ledger cannot prove anything landed, so this blocks rather than allows.\n`
      + `Ledger: ${ledgerPath}\n`
      + `Re-run the push through scripts/apply-form.mjs, which is the only writer of this file.`,
    );
    return 2;
  }

  const entries = Array.isArray(ledger) ? ledger : ledger.entries || [];
  if (!entries.length) return 0;

  // The verification rules live in gym-lib/evidence.cjs so this gate and the aggregate
  // checker (scripts/verify-evidence.mjs) cannot drift apart.
  const problems = entries
    .map((e) => evidence.verifyEntry(e))
    .filter((r) => !r.ok)
    .map((r) => `${r.at}: ${r.problem}`);

  if (!problems.length) return 0;

  console.error(
    `[shesha hook] PERSISTENCE GATE — ${problems.length} form(s) cannot be shown to have landed:\n`
    + problems.map((p) => `  - ${p}`).join('\n')
    + `\n\nA validated local file is not a delivered form [R-046]. Before finishing:\n`
    + `  1. push through the one supported path:\n`
    + `       node scripts/apply-form.mjs --form <compiled.json> --module <mod> --name <form>\n`
    + `     it stages, gates, snapshots, pushes, re-fetches, diffs, renders, and writes the\n`
    + `     evidence bundle plus this ledger entry;\n`
    + `  2. if the work is genuinely abandoned, re-run with the reason recorded and say so\n`
    + `     in your summary — do not edit the ledger or a bundle by hand, which this gate detects;\n`
    + `  3. report anything unverified as UNVERIFIED rather than as done.\n`
    + `Ledger: ${ledgerPath}`,
  );
  return 2;
}

try { process.exit(main()); } catch (e) {
  // A crash in the gate must not silently permit an unverified stop.
  console.error(`[shesha hook] PERSISTENCE GATE could not complete (${e.message}) — blocking rather than assuming success.`);
  process.exit(2);
}
