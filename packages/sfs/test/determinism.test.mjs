// Q5 — id determinism (§2.4.2, §5.2's determinism.test.mjs).
//
// The compiler is a pure function of (sfs bytes, registry, tokens, compilerVersion).
// Three independent claims:
//
//   1. 50 in-process compiles of every clean fixture are byte-identical. A clock or
//      a Math.random() anywhere in the path would break this within a handful of runs.
//   2. 3 SUBPROCESS compiles are byte-identical to the in-process one. A subprocess
//      shares no module state, so this catches a hidden module-level accumulator that
//      repeated in-process calls would not.
//   3. Every emitted id equals uuidv5(NS, "<module>/<form>|<sfsPath>") recomputed from
//      the meta sidecar, and every id matches the v5 pattern. The ids are not merely
//      stable — they are the declared hash of the declared path, so a rename is the
//      only thing that can move one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile/index.mjs';
import { nodeId, V5_PATTERN } from '../src/lib/ids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CLEAN = path.join(HERE, 'fixtures/clean');
const FIXTURES = fs.readdirSync(CLEAN).filter((f) => f.endsWith('.sfs.json')).sort();

/** Banned identifiers: a clock or randomness in the compiler path (§2.4.3). */
const BANNED = ['Date.now', 'Math.random', 'new Date', 'performance.now', 'crypto.randomUUID', 'randomBytes'];

test('the clean fixture set is not empty', () => {
  assert.ok(FIXTURES.length > 0, 'no clean fixtures — determinism would be vacuous');
});

test('no compiler source names a clock or a randomness primitive', () => {
  const dir = path.join(ROOT, 'packages/sfs/src/compile');
  /** @type {string[]} */
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.mjs')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const bad of BANNED) if (text.includes(bad)) offenders.push(`${f}: ${bad}`);
  }
  assert.equal(offenders.length, 0, `banned identifiers in the compiler path: ${offenders.join(', ')}`);
  console.log(`banned identifiers 0`);
});

for (const fixture of FIXTURES) {
  test(`Q5 ${fixture}: 50 in-process + 3 subprocess compiles are byte-identical, ids v5-recomputed`, () => {
    const sfsText = fs.readFileSync(path.join(CLEAN, fixture), 'utf8');
    const first = compile(sfsText);
    for (let i = 0; i < 50; i += 1) {
      assert.equal(compile(sfsText).markup, first.markup, `in-process compile #${i} diverged`);
    }

    for (let i = 0; i < 3; i += 1) {
      // A fresh process shares no module state with this one, so a hidden
      // module-level accumulator that repeated in-process calls would miss shows
      // up here. The real CLI writes the envelope; we read its Markup field.
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-det-'));
      // Exit 3 (partial) is expected on any form with an unverifiable binding and
      // is not a failure: the markup is still written. Any other non-zero is.
      try {
        execFileSync(process.execPath, [
          path.join(ROOT, 'packages/sfs/bin/sfs.mjs'), 'compile',
          path.join(CLEAN, fixture), '--out', outDir,
        ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const status = /** @type {{status?:number}} */ (e).status;
        assert.equal(status, 3, `subprocess compile #${i} exited ${status}, not 0 or 3`);
      }
      const form = fixture.replace(/\.sfs\.json$/, '');
      const envelope = JSON.parse(fs.readFileSync(path.join(outDir, `${form}.form.json`), 'utf8'));
      assert.equal(envelope.Markup, first.markup, `subprocess compile #${i} diverged from in-process`);
    }

    // Every id equals the declared hash of the declared path.
    const meta = /** @type {{form:string, nodes:{id:string, sfsPath:string}[]}} */ (first.meta);
    const [module, form] = meta.form.split('/');
    let recomputed = 0;
    for (const n of meta.nodes) {
      assert.match(n.id, V5_PATTERN, `id ${n.id} for ${n.sfsPath} is not a v5 uuid`);
      assert.equal(n.id, nodeId(/** @type {string} */ (module), /** @type {string} */ (form), n.sfsPath), `id for ${n.sfsPath} is not uuidv5 of its path`);
      recomputed += 1;
    }
    console.log(`Q5 ${fixture} · 50 in-process identical · 3 subprocess identical · ids v5-recomputed ${recomputed}/${meta.nodes.length} · banned identifiers 0`);
  });
}
