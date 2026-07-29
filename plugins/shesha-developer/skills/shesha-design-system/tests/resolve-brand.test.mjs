import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrand, DEFAULT_BRAND } from '../scripts/resolve-brand.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('no brand requested resolves to the shipped default', () => {
  const r = resolveBrand(undefined);
  assert.equal(r.brand, DEFAULT_BRAND);
  assert.equal(r.fellBack, false);
});

test('an existing brand resolves to itself', () => {
  const r = resolveBrand('requirements-studio');
  assert.equal(r.brand, 'requirements-studio');
  assert.equal(r.fellBack, false);
});

test('an UNKNOWN brand falls back to the default instead of demanding authoring', () => {
  // The whole point: a blueprint carrying `theme: "skyline"` with no such file
  // must be a no-op, not a trigger to write ~290 keys of brand tokens.
  const r = resolveBrand('skyline-does-not-exist');
  assert.equal(r.brand, DEFAULT_BRAND);
  assert.equal(r.fellBack, true);
  assert.equal(r.requested, 'skyline-does-not-exist');
});

test('the fallback note explicitly forbids authoring a brand file', () => {
  const r = resolveBrand('no-such-brand');
  assert.match(r.note, /do NOT author/i);
  assert.match(r.note, /separate, explicitly requested task/i);
});

test('an unknown brand is not an error — it must never throw', () => {
  assert.doesNotThrow(() => resolveBrand('nope'));
  assert.doesNotThrow(() => resolveBrand(''));
  assert.doesNotThrow(() => resolveBrand(null));
});

test('whitespace-only brand is treated as unspecified', () => {
  const r = resolveBrand('   ');
  assert.equal(r.brand, DEFAULT_BRAND);
  assert.equal(r.fellBack, false, 'blank is "unspecified", not a failed lookup');
});

test('the default brand token file actually exists on disk', () => {
  const r = resolveBrand(undefined);
  assert.ok(r.available.includes(DEFAULT_BRAND), `available: ${r.available.join(', ')}`);
});

test('CLI exits 0 for an unknown brand and names the default', () => {
  const out = execFileSync(process.execPath,
    [join(ROOT, 'scripts/resolve-brand.mjs'), 'totally-made-up'], { encoding: 'utf8' });
  assert.match(out, new RegExp(`brand: ${DEFAULT_BRAND}`));
  assert.match(out, /do NOT author/i);
});

test('CLI exits 0 with no argument', () => {
  const out = execFileSync(process.execPath,
    [join(ROOT, 'scripts/resolve-brand.mjs')], { encoding: 'utf8' });
  assert.match(out, new RegExp(`brand: ${DEFAULT_BRAND}`));
});

test('resolved path uses forward slashes when printed by the CLI', () => {
  const out = execFileSync(process.execPath,
    [join(ROOT, 'scripts/resolve-brand.mjs')], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('path:'));
  assert.ok(line, 'no path line');
  assert.ok(!line.includes('\\'), `path line contains backslashes: ${line}`);
});
