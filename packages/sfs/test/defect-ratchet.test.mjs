// The defect ratchet (§5.2, D-081).
//
// Two assertions, and the second is the one that matters:
//
//   1. The committed census of each legacy subject equals what `measure-form.mjs`
//      measures today. The census is generated, never hand-edited, so a drift here
//      means either the artifact changed or the census was adjusted by hand.
//   2. Every class PRESENT in a legacy subject is ABSENT from
//      compile(decompile(subject)) — the normalisation actually removed it. This is
//      the honest form of "the compiler fixes the defects": measured on the same
//      artifact, in both directions, by one predicate vocabulary.
//
// The count is discovered and printed, never a literal from a document. It
// ratchets: a class that was present and is now absent from the SUBJECT means the
// artifact was edited, which is a failure, not an improvement.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { decompile } from '../src/decompile/index.mjs';
import { measure, defectsOf } from '../tools/measure-form.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** subject -> its committed census. Both are generated artifacts. */
const SUBJECTS = [
  {
    envelope: 'docs/rebuild-brief/artifacts/bookings-table.revision2.json',
    census: 'packages/sfs/test/fixtures/legacy/bookings-table.defects.json',
  },
  {
    envelope: 'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
    census: 'packages/sfs/test/fixtures/legacy/inline-editable-table.defects.json',
  },
];

test('the subject set is not empty', () => {
  assert.ok(SUBJECTS.length > 0, 'no legacy subject: the ratchet would assert nothing');
});

for (const subject of SUBJECTS) {
  const name = path.basename(subject.envelope);

  test(`${name}: the committed census equals what measure-form.mjs measures today`, () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, subject.census), 'utf8'));
    const measured = measure(path.join(ROOT, subject.envelope));
    assert.deepEqual(measured.defects, committed.defects,
      'the census is generated; regenerate it rather than editing it');
    assert.equal(measured.defectClassesPresent, committed.defectClassesPresent);
    assert.equal(measured.markupBytes, committed.markupBytes);
  });

  test(`${name}: every defect class present in the subject is absent after normalisation`, () => {
    const envelopeText = fs.readFileSync(path.join(ROOT, subject.envelope), 'utf8');
    const before = measure(path.join(ROOT, subject.envelope)).defects;
    const present = before.filter((d) => d.present).map((d) => d.id);

    const compiled = compile(JSON.stringify(decompile(envelopeText).sfs));
    const after = defectsOf(JSON.parse(compiled.markup));
    const stillPresent = after.filter((d) => d.present && present.includes(d.id));

    assert.equal(stillPresent.length, 0,
      `classes surviving normalisation: ${stillPresent.map((d) => `${d.id} (${d.evidence})`).join('; ')}`);
    console.log(`defect classes present in ${name}: ${present.length} · all ${present.length} absent from compiled output`
      + `${present.length === 0 ? ' (this subject is already clean)' : ''}`);
  });
}

test('at least one subject carries defects, so the ratchet is not vacuous', () => {
  const counts = SUBJECTS.map((s) => measure(path.join(ROOT, s.envelope)).defectClassesPresent);
  assert.ok(counts.some((n) => n > 0),
    `no subject carries a single defect class (${counts.join(', ')}); the normalisation would be untested`);
  console.log(`defect ratchet: subjects ${counts.join(', ')} classes present`);
});
