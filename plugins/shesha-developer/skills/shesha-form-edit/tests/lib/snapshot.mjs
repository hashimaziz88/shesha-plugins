// The ONE implementation of snapshot policy for this skill's test suite.
//
// The defect this replaces: pipeline.test.mjs used to write a snapshot whenever one
// was missing and then return GREEN. A snapshot that records itself on first run
// cannot fail, so a brand-new fixture — or a deleted snapshot, or a renamed theme —
// was never actually reviewed. The suite reported that the compiler agreed with
// itself.
//
// The policy, stated once and implemented once:
//
//   1. A MISSING snapshot FAILS. Loudly, with the command that would record it.
//   2. Recording is an explicit, opt-in act: UPDATE_SNAPSHOTS=1. Every file the run
//      wrote or changed is reported at the end of the run, so the recording is
//      visible rather than silent, and its git diff is the review artifact.
//   3. A plain run NEVER writes. Not a mkdir, not a file, not a newline.
//
// Usage:
//   import { compareSnapshot } from './lib/snapshot.mjs';
//   compareSnapshot('table-worklist--shesha', actualText, { dir: SNAPSHOTS });
//
// Re-record:  UPDATE_SNAPSHOTS=1 npm test

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** files this process wrote under UPDATE_SNAPSHOTS, reported once at exit */
const recorded = [];
let reporterInstalled = false;

const installReporter = () => {
  if (reporterInstalled) return;
  reporterInstalled = true;
  process.on('exit', () => {
    if (!recorded.length) return;
    // stderr on purpose: node --test owns stdout's TAP stream.
    process.stderr.write(
      `\nUPDATE_SNAPSHOTS: ${recorded.length} snapshot file(s) written — review the diff before committing:\n` +
      recorded.map((r) => `  ${r.verb.padEnd(7)} ${r.file}`).join('\n') + '\n');
  });
};

/** `name` may be bare ("table-worklist--shesha") or already carry its extension */
const snapshotPath = (dir, name) =>
  path.join(dir, /\.[a-z0-9]+$/i.test(name) ? name : `${name}.json`);

export const updatingSnapshots = () =>
  Boolean(process.env.UPDATE_SNAPSHOTS) && process.env.UPDATE_SNAPSHOTS !== '0';

/**
 * Compare `actual` against the committed snapshot `name`.
 *
 * @param {string} name    snapshot file name, with or without extension
 * @param {string} actual  the exact text to compare / record
 * @param {{ dir: string, hint?: string }} opts
 * @throws when the snapshot is missing (and UPDATE_SNAPSHOTS is unset), or differs
 */
export function compareSnapshot(name, actual, { dir, hint } = {}) {
  assert.ok(dir, 'compareSnapshot needs { dir } — the snapshot directory');
  assert.equal(typeof actual, 'string', `compareSnapshot(${name}): actual must be a string`);
  const file = snapshotPath(dir, name);
  const exists = fs.existsSync(file);

  if (updatingSnapshots()) {
    installReporter();
    const before = exists ? fs.readFileSync(file, 'utf8') : null;
    if (before !== actual) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, actual);
      recorded.push({ verb: exists ? 'changed' : 'new', file });
    }
    return;
  }

  if (!exists) {
    // NOT an auto-record. A missing snapshot is an unreviewed artifact.
    throw new Error(
      `MISSING snapshot "${path.basename(file)}" — nothing to compare against, so this test cannot pass.\n` +
      `  expected file: ${file}\n` +
      '  This is deliberate: a snapshot that records itself on first run can never fail.\n' +
      '  If this output is correct and NEW, record it explicitly and review the diff:\n' +
      '      UPDATE_SNAPSHOTS=1 npm test\n' +
      (hint ? `  ${hint}\n` : ''));
  }

  const expected = fs.readFileSync(file, 'utf8');
  if (actual === expected) return;
  assert.equal(actual, expected,
    `snapshot "${path.basename(file)}" no longer matches the produced output.\n` +
    '  Review the diff above. If the change is intended, re-record it explicitly:\n' +
    '      UPDATE_SNAPSHOTS=1 npm test\n' +
    (hint ? `  ${hint}\n` : ''));
}

export default compareSnapshot;
