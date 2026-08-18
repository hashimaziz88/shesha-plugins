// Q1 — compiler self-consistency (section 2.4.5 P1).
//
//   compile(decompile(compile(x))).Markup === compile(x).Markup, byte-equal
//
// This is the ONLY byte-equality property whose subject is raw markup, because its
// subject is the compiler's own output: names inside compile(x) are already
// canonical, so the decompiler can recover them and every derived id lands on the
// same bytes. On failure the first divergent byte index is printed with 120 bytes
// of context from each side, because "the strings differ" is not a diagnosis.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { decompile } from '../src/decompile/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cleanDir = path.join(here, 'fixtures', 'clean');
const fixtures = fs.readdirSync(cleanDir).filter((f) => f.endsWith('.sfs.json'));

test('the clean fixture set is not empty (zero coverage is never a pass)', () => {
  assert.ok(fixtures.length > 0, 'no *.sfs.json under fixtures/clean — Q1 would be vacuous');
});

for (const fixture of fixtures) {
  test(`Q1 ${fixture}: compile(decompile(compile(x))).Markup === compile(x).Markup`, () => {
    const sfsText = fs.readFileSync(path.join(cleanDir, fixture), 'utf8');
    const first = compile(sfsText);
    const lifted = decompile(first.envelope);
    assert.equal(lifted.structuralEscapes, 0,
      `decompiling the compiler's own output must need no structural escape, got ${lifted.structuralEscapes}`);
    const second = compile(JSON.stringify(lifted.sfs));

    if (first.markup !== second.markup) {
      let i = 0;
      while (first.markup[i] === second.markup[i]) i += 1;
      const a = first.markup.slice(Math.max(0, i - 40), i + 120);
      const b = second.markup.slice(Math.max(0, i - 40), i + 120);
      assert.fail(`Q1 diverges at byte ${i}\n  compile(x):              …${a}…\n  compile(decompile(...)):  …${b}…`);
    }
    const sha = createHash('sha256').update(first.markup, 'utf8').digest('hex').slice(0, 12);
    console.log(`Q1 BYTE-EQUAL ${Buffer.byteLength(first.markup, 'utf8')} bytes sha256=${sha}`);
  });
}
