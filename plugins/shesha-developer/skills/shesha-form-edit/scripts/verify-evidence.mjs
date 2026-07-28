#!/usr/bin/env node
/**
 * verify-evidence.mjs — what the caller runs after a fan-out, instead of believing summaries.
 *
 * Each dispatched agent returns an evidence PATH and an EXIT CODE. This verifies those
 * bundles: they exist, they still hash to their recorded digests, and each records a settled
 * status. A screen whose agent reported success but whose bundle says otherwise fails here.
 *
 *   node scripts/verify-evidence.mjs <bundle.json> [<bundle.json> ...]
 *   node scripts/verify-evidence.mjs --ledger            verify every entry in the push ledger
 *   node scripts/verify-evidence.mjs --ledger --json     machine-readable envelope
 *
 * Exit 0 when every bundle is verified, 1 when any is not, 2 on usage error.
 *
 * This is the aggregate-report step: the report is generated FROM the evidence, never from
 * an agent's prose. An agent that returns a glowing summary and a bundle recording
 * status="failed" is caught by the bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import evidence from './gym-lib/evidence.cjs';
import paths from './gym-lib/paths.cjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const useLedger = args.includes('--ledger');
const bundlePaths = args.filter((a) => !a.startsWith('--'));

if (!useLedger && !bundlePaths.length) {
  console.error(`usage: node scripts/verify-evidence.mjs <bundle.json> [...] | --ledger [--json]

Verifies the evidence bundles a fan-out produced. Each dispatched agent returns the path
its apply-form.mjs run printed on stdout; pass those paths here, or use --ledger to check
every push recorded this session.`);
  process.exit(2);
}

let entries;
if (useLedger) {
  const ledgerPath = paths.ledgerPath();
  if (!fs.existsSync(ledgerPath)) {
    const msg = `no push ledger at ${ledgerPath} — nothing was pushed through apply-form.mjs`;
    if (asJson) console.log(JSON.stringify({ verified: false, reason: msg, screens: [] }, null, 2));
    else console.error(msg);
    // Nothing recorded is not the same as nothing outstanding: a caller expecting screens
    // gets a non-zero exit so "I built five screens" cannot pass with an empty ledger.
    process.exit(1);
  }
  try { entries = evidence.readLedger(ledgerPath); } catch (e) {
    console.error(`push ledger will not parse (${e.message}) — it cannot prove anything landed`);
    process.exit(1);
  }
} else {
  entries = bundlePaths.map((p) => ({ evidence: path.resolve(p), module: '?', form: '?' }));
}

const results = entries.map((e) => {
  const r = evidence.verifyEntry(e);
  // When verifying raw paths the ledger identity is unknown; recover it from the bundle.
  if (r.at === '?/?' && fs.existsSync(e.evidence)) {
    try {
      const b = JSON.parse(fs.readFileSync(e.evidence, 'utf8'));
      r.at = `${b.form?.module ?? '?'}/${b.form?.name ?? '?'}`;
    } catch { /* keep ?/? */ }
  }
  return r;
});

const failed = results.filter((r) => !r.ok);

if (asJson) {
  console.log(JSON.stringify({
    verified: failed.length === 0,
    total: results.length,
    screens: results.map((r) => ({ form: r.at, verified: r.ok, status: r.status ?? null, formId: r.formId ?? null, problem: r.problem ?? null })),
  }, null, 2));
} else {
  const w = Math.max(4, ...results.map((r) => r.at.length));
  console.log(`\n${'FORM'.padEnd(w)}  RESULT    STATUS`);
  console.log(`${'-'.repeat(w)}  --------  ------`);
  for (const r of results) {
    console.log(`${r.at.padEnd(w)}  ${(r.ok ? 'verified' : 'FAILED').padEnd(8)}  ${r.status ?? '-'}`);
  }
  console.log('');
  if (failed.length) {
    for (const r of failed) console.error(`  ${r.at}: ${r.problem}`);
    console.error('');
  }
  console.log(`${results.length - failed.length}/${results.length} screen(s) verified from evidence`);
}

if (failed.length) {
  if (!asJson) {
    console.error(
      'Report these as UNVERIFIED, not as done. Re-run the failing screens through\n'
      + 'scripts/apply-form.mjs — do not edit a bundle or the ledger by hand, which this detects.',
    );
  }
  process.exit(1);
}
