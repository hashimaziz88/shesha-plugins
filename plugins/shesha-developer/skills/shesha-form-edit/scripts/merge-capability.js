#!/usr/bin/env node
// Overlays gym measurements onto the hand-noted style capability matrix
// (shesha-design-system). Matched rows gain a `measured` annotation; rows the
// measurement categorically disagrees with gain `contradicted: true` — these
// are the leaky-abstraction bugs the gym exists to hunt.
//
// Usage: node merge-capability.js [--dry-run] [--matrix <hand>] [--measured <gym>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measuredForRow, isContradiction, isChannelMismatch } from './gym-lib/channel-map.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const HAND_PATH = argVal('--matrix', path.join(SCRIPT_DIR, '..', '..', 'shesha-design-system', 'assets', 'capability-matrix.json'));
const MEASURED_PATH = argVal('--measured', path.join(SCRIPT_DIR, '..', 'assets', 'measured-capability-matrix.json'));
const REPORT_PATH = path.join(SCRIPT_DIR, '..', 'gym', 'merge-report.json');
const DRY = args.includes('--dry-run');

const hand = JSON.parse(fs.readFileSync(HAND_PATH, 'utf8'));
const measured = JSON.parse(fs.readFileSync(MEASURED_PATH, 'utf8'));

const report = {
  mergedAt: new Date().toISOString(), measuredAt: measured.measuredAt,
  matched: 0, unmeasured: 0, channelMismatches: [], contradictions: [],
};

for (const row of hand.rows) {
  const m = measuredForRow(measured, row.component, row.channel);
  if (m.summary === 'unmeasured') {
    report.unmeasured++;
    delete row.measured;
    delete row.contradicted;
    continue;
  }
  report.matched++;
  row.measured = {
    summary: m.summary,
    effects: m.effects,
    generation: measured.generation,
    measuredAt: measured.measuredAt,
  };
  if (isChannelMismatch(row) && m.summary === 'no-op') {
    // Hand row documents a desktop.* technique; the gym authored the flat 0.43
    // channel — a flat no-op does not refute the desktop.* verdict.
    row.measured.note = 'gym measured flat 0.43 channel; hand verdict is for a desktop.* technique';
    report.channelMismatches.push({ component: row.component, channel: row.channel, key: row.key });
    delete row.contradicted;
  } else if (isContradiction(row.verdict, m)) {
    row.contradicted = true;
    report.contradictions.push({
      component: row.component,
      channel: row.channel,
      handVerdict: row.verdict,
      measuredSummary: m.summary,
      effects: m.effects,
    });
  } else {
    delete row.contradicted;
  }
}

console.log(`merge: ${report.matched} rows annotated, ${report.unmeasured} unmeasured, ${report.channelMismatches.length} channel-mismatch (informational), ${report.contradictions.length} CONTRADICTIONS`);
for (const c of report.contradictions) {
  console.log(`  CONTRADICTED ${c.component} : ${c.channel} — hand says "${c.handVerdict}", gym measured "${c.measuredSummary}"`);
  for (const [k, e] of Object.entries(c.effects)) console.log(`      ${k} → ${e}`);
}

if (DRY) {
  console.log('(dry-run: nothing written)');
} else {
  fs.writeFileSync(HAND_PATH, JSON.stringify(hand, null, 2) + '\n');
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${HAND_PATH}`);
  console.log(`wrote ${REPORT_PATH}`);
}
