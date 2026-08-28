// The ladder driver's own guarantees (§3.2.0). These are the properties a caller relies
// on when it reads `result` or the exit code, and each of them was violated by a real
// defect this file now pins:
//
//   * `result` starts at `pass` and is only ever raised, so a tier name the driver does
//     not recognise ran nothing while the sealed verdict still claimed `pass`.
//   * `verify` reached over MCP passed its tier names through in the schema's upper case,
//     matched none of them, and returned that same green verdict having run nothing.
//   * A probe recorded from one screen satisfied any other screen's T4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runLadder, KNOWN_TIERS } from '../src/verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCREEN = 'inline-editable-table';
const METADATA = 'packages/sfs/test/fixtures/metadata/inline-editable-table.metadata.json';
const PROBE = 'packages/sfs/test/fixtures/probe/login.probe.json';

/** A fresh run-dir per case, so nothing carries between them. @param {string} tag */
function runDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ladder-${tag}-`));
}
/** @param {any} over */
const ladder = (over) => runLadder({
  root: ROOT, runDir: runDir('x'), screen: SCREEN, tiers: ['t1', 't2', 't3'],
  legacy: false, metadata: METADATA, ...over,
});

test('an unrecognised tier name is refused, not silently skipped', async () => {
  await assert.rejects(() => ladder({ tiers: ['banana'] }), /unknown tier/);
  await assert.rejects(() => ladder({ tiers: ['t1', 'T4'] }), /unknown tier/);
  for (const t of KNOWN_TIERS) assert.equal(typeof t, 'string');
});

test('a requested tier that did not run forces exit 3 even though it never enters result', async () => {
  const r = await ladder({ tiers: ['t1', 't2', 't3', 't4'] });
  assert.equal(r.verdict.result, 'pass');
  assert.deepEqual(r.verdict.tiers.T4, { result: 'notRun', reason: 'no --base-url given' });
  assert.equal(r.exit, 3);
});

test('T4 does not change result or the exit code, and says so on the line below', async () => {
  // The probe is relabelled for the screen under test: the recorded capture is of the
  // login screen, and the screen-binding rule below refuses a mismatch outright.
  const relabel = (/** @type {string} */ src) => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, src), 'utf8'));
    p.screen = SCREEN;
    const f = path.join(runDir('probe'), path.basename(src));
    fs.writeFileSync(f, JSON.stringify(p));
    return f;
  };
  const clean = await ladder({ tiers: ['t1', 't2', 't3', 't4b'], probe: relabel(PROBE) });
  const dirty = await ladder({ tiers: ['t1', 't2', 't3', 't4b'], probe: relabel('packages/sfs/test/fixtures/probe/login.probe.overflow.json') });
  assert.equal(dirty.verdict.tiers.T4.result, 'fail');
  assert.equal(clean.verdict.result, dirty.verdict.result);
  assert.equal(clean.exit, dirty.exit);
  assert.ok(dirty.lines.some((l) => /ADVISORY/.test(l)), 'a failing T4 was reported without saying it is advisory');
});

test('a probe recorded from another screen is refused as evidence', async () => {
  await assert.rejects(
    () => ladder({ tiers: ['t1', 't4b'], probe: PROBE, screen: SCREEN }),
    /recorded from screen "login", not "inline-editable-table"/,
  );
});

test('the MCP verify tool lower-cases its tier names, so its default actually runs', async () => {
  const { run } = await import('../../mcp/src/tools/verify.mjs');
  const out = /** @type {any} */ (await run({ screen: SCREEN, metadata: METADATA }));
  assert.equal(out.result, 'pass');
  for (const t of ['T1', 'T2', 'T3']) {
    assert.equal(out.tiers[t].result, 'pass', `${t} did not run: the tool returned a verdict over nothing`);
  }
  assert.equal(out.exit, 0);
});
