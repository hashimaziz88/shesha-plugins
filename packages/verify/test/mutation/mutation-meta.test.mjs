// The mutation harness (D-007, D-047). This is the program that makes a gate's
// claim falsifiable: for every declared mutation, break the input in exactly that
// way and require the gate's verdict to flip.
//
// Cost protocol, specified numerically because an unaffordable harness is one that
// gets bypassed with --no-verify:
//   1. Copy ONLY the paths that mutation's gate declares in inputPaths[], resolved
//      through `git ls-files` so untracked scratch never leaks in.
//   2. Junction-link the root node_modules into the temp root. 'junction' is
//      required on Windows; 'dir' fails without administrator rights.
//   3. Never copy node_modules/, .git/, .build/, runs/, or the SFS corpus.
//   4. Assert the verdict equals `expect`, and that `expect` is fail or partial —
//      a mutation expecting pass is a contract violation, not a passing test.
//   5. Print `mutations=<n> seconds=<s>` and fail if s exceeds the ceiling.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verdictOf } from '@shesha/registry/coverage';
import { repoRoot, readText } from '../../src/lib/fsx.mjs';
import { gateFiles, loadGate } from '../../src/lib/gate-loader.mjs';

const ROOT = repoRoot();
const NEVER_COPY = new Set(['node_modules', '.git', '.build', 'runs', 'corpus']);

/** @type {string[]} */
const tmpRoots = [];
let mutationsRun = 0;
let mutationsCaught = 0;
const startedAt = performance.now();

/**
 * The ceiling comes from the config, not from a literal in this file.
 * @returns {number}
 */
function ceilingSeconds() {
  const text = readText(path.join(ROOT, 'packages/verify/config/gate-ratchet.json'));
  if (text === null) return 180;
  try { return JSON.parse(text).mutationCeilingSeconds ?? 180; } catch { return 180; }
}

/**
 * Tracked files under a declared input path.
 * @param {string} inputPath
 * @returns {string[]} repo-relative POSIX paths
 */
function trackedUnder(inputPath) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', inputPath],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.split('\0').filter(Boolean);
  } catch { return []; }
}

/**
 * Build a temp tree carrying only this gate's declared inputs.
 * @param {import('../../src/lib/gate-loader.mjs').Gate} gate
 * @returns {string} temp root
 */
function stage(gate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shesha-mut-'));
  tmpRoots.push(tmp);

  /** @type {Set<string>} */
  const files = new Set();
  for (const declared of gate.inputPaths) {
    for (const f of trackedUnder(declared)) {
      if (f.split('/').some((seg) => NEVER_COPY.has(seg))) continue;
      files.add(f);
    }
  }
  // The gate modules themselves are never in inputPaths, but the harness runs the
  // gate in-process against the temp root, so only data has to be copied.
  for (const f of files) {
    const dest = path.join(tmp, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dest);
  }

  // 'junction' is the only link type that works on Windows without elevation.
  try {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
  } catch { /* the gates under test read data, not dependencies */ }

  return tmp;
}

after(() => {
  for (const t of tmpRoots) {
    try { fs.rmSync(t, { recursive: true, force: true, maxRetries: 2 }); } catch { /* best effort */ }
  }
  const seconds = (performance.now() - startedAt) / 1000;
  console.log(`mutations=${mutationsRun} caught=${mutationsCaught} seconds=${seconds.toFixed(1)}`);
  // Machine record for write-evidence.mjs (D-048), so the mutation numbers in a
  // commit's evidence file are the ones this run measured.
  try {
    const buildDir = path.join(ROOT, '.build');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'mutations.json'), `${JSON.stringify({
      declared: mutationsRun, caught: mutationsCaught, seconds: Number(seconds.toFixed(1)),
      ceiling: ceilingSeconds(),
    }, null, 2)}\n`);
  } catch { /* the assertion below is the real signal */ }
});

const files = gateFiles(ROOT);
assert.ok(files.length > 0, 'no gates were discovered; the harness would vacuously pass');

for (const file of files) {
  const gate = await loadGate(file);

  test(`${gate.id}: declares at least two verdict-flipping mutations`, () => {
    assert.ok(Array.isArray(gate.mutations), `${gate.id} exports no mutations array`);
    assert.ok(gate.mutations.length >= 2,
      `${gate.id} declares ${gate.mutations.length} mutation(s); the contract is >= 2`);
  });

  for (const mutation of gate.mutations) {
    test(`${gate.id}: "${mutation.name}" flips the verdict to ${mutation.expect}`, async () => {
      // A mutation expecting pass proves nothing about the gate.
      assert.ok(['fail', 'partial'].includes(mutation.expect),
        `${gate.id}/"${mutation.name}" expects "${mutation.expect}"; only fail or partial are legal`);

      const tmp = stage(gate);

      // Baseline: the gate must PASS on the unmutated copy, or the flip proves
      // nothing — a gate that already fails on its own inputs would "catch" every
      // mutation for the wrong reason.
      const before = verdictOf(await gate.run({ repoRoot: tmp }));
      assert.equal(before, 'pass',
        `${gate.id} does not pass on an unmutated copy of its own declared inputs (got "${before}"), ` +
        'so a flipped verdict would not be attributable to the mutation');

      await mutation.apply(tmp);

      const after_ = verdictOf(await gate.run({ repoRoot: tmp }));
      mutationsRun++;
      assert.equal(after_, mutation.expect,
        `${gate.id}/"${mutation.name}": expected the verdict to become "${mutation.expect}", got "${after_}". ` +
        'A gate that cannot be made to fail is theatre and must be deleted, not committed.');
      mutationsCaught++;
    });
  }
}

test('the whole mutation suite finishes inside its declared ceiling', () => {
  const seconds = (performance.now() - startedAt) / 1000;
  const ceiling = ceilingSeconds();
  assert.ok(seconds <= ceiling,
    `the mutation suite took ${seconds.toFixed(1)}s against a ${ceiling}s ceiling. ` +
    'A gate slow enough to be bypassed with --no-verify is not a gate.');
});
