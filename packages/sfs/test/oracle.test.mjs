// Q2 — independent agreement (section 2.4.5 P3, D-074), and Q3.
//
//   normalForm(compile(decompile(m))) === normalForm(normaliseLegacy(m)), byte-equal
//
// The two arms are two PROGRAMS: this compiler, and tools/normalise-legacy.mjs,
// which was authored in a fresh context (D-071), imports nothing under src/compile
// or src/decompile (g-oracle-independence), and is run here as a SUBPROCESS so no
// in-process state can leak between the arms. Byte agreement of the normal forms
// is content agreement (D-078); ids and componentName are erased by normalForm
// because they are name-derived and markup cannot recover names.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { decompile } from '../src/decompile/index.mjs';
import { normalForm } from '../src/lib/normalForm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const ORACLE = path.join(repoRoot, 'packages/sfs/tools/normalise-legacy.mjs');

/** The two Q2 subjects: the real revision-2 envelope, and the on-disk corpus form
 *  so the proof does not rest on a single artifact (O1). */
const SUBJECTS = [
  'docs/rebuild-brief/artifacts/bookings-table.revision2.json',
  'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
];

/**
 * @param {string} subjectRel
 * @returns {string} the oracle arm's markup JSON text
 */
function runOracle(subjectRel) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-oracle-')), 'oracle.form.json');
  execFileSync(process.execPath, [ORACLE, path.join(repoRoot, subjectRel), '--out', out], {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return fs.readFileSync(out, 'utf8');
}

test('the oracle program exists and is the declared arm', () => {
  assert.ok(fs.existsSync(ORACLE), `${ORACLE} is missing — Q2 has only one arm, which proves nothing`);
});

for (const subject of SUBJECTS) {
  test(`Q2 ${path.basename(subject)}: normalForm(compile(decompile(m))) === normalForm(normaliseLegacy(m))`, () => {
    const envelopeText = fs.readFileSync(path.join(repoRoot, subject), 'utf8');

    const lifted = decompile(envelopeText);
    const compiled = compile(JSON.stringify(lifted.sfs));
    const arm1 = normalForm(compiled.markup);
    const arm2 = normalForm(runOracle(subject));

    if (arm1 !== arm2) {
      let i = 0;
      while (arm1[i] === arm2[i]) i += 1;
      const a = arm1.slice(Math.max(0, i - 60), i + 140);
      const b = arm2.slice(Math.max(0, i - 60), i + 140);
      assert.fail(`Q2 diverges at byte ${i} of the normal form\n  compiler arm: …${a}…\n  oracle arm:   …${b}…`);
    }
    const sha = createHash('sha256').update(arm1, 'utf8').digest('hex').slice(0, 12);
    console.log(`Q2 EQUAL-UNDER-ID-POSITION ${Buffer.byteLength(arm1, 'utf8')} bytes sha256=${sha}`);
  });
}

test('Q3: the declared corpus form decompiles with zero structural escapes', () => {
  // SUBJECTS is a two-element literal, so index 1 is in-bounds.
  const envelopeText = fs.readFileSync(path.join(repoRoot, /** @type {string} */ (SUBJECTS[1])), 'utf8');
  const lifted = decompile(envelopeText);
  assert.equal(lifted.structuralEscapes, 0);
  console.log(`Q3 structural escapes ${lifted.structuralEscapes}`);
});
