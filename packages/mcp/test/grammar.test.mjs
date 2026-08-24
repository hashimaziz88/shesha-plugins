// §4.5: `sfs registry grammar` emits a GBNF whose header states that constrained decoding
// applies only to the emission step, never a reasoning step. The header is the point — a
// grammar without it invites constraining a reasoning step, which collapses accuracy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SFS = path.join(REPO, 'packages/sfs/bin/sfs.mjs');

test('the GBNF grammar carries the emission-only header and a root rule', () => {
  const r = spawnSync(process.execPath, [SFS, 'registry', 'grammar'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ONLY to the SFS emission step, never to a reasoning step/);
  assert.match(r.stdout, /^root\s+::=/m);
});
