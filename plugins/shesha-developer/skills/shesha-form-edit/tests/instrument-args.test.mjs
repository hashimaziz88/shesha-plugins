// Pins render-instrument.js's argument contract: --form (single) and --forms
// (batch, ONE browser boot for the whole set). Parse-only — importing the module
// must NOT boot a browser, which is exactly what these tests also prove: if the
// direct-invocation guard regressed, the import below would try to launch
// Chromium and this file would hang/fail instead of asserting.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { parseArgs, USAGE } from '../scripts/render-instrument.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'render-instrument.js');

test('usage string advertises both --form and --forms', () => {
  assert.match(USAGE, /--form <module>\/<name>/);
  assert.match(USAGE, /--forms <module>\/<a>,<module>\/<b>/);
});

test('--form parses a single form', () => {
  const cfg = parseArgs(['--form', 'His.Facilities/facility-details']);
  assert.equal(cfg.error, undefined);
  assert.equal(cfg.forms.length, 1);
  assert.deepEqual(cfg.forms[0], {
    module: 'His.Facilities',
    formName: 'facility-details',
    key: 'His.Facilities/facility-details',
    slug: 'His.Facilities--facility-details',
  });
});

test('--forms parses a comma-separated batch, in order', () => {
  const cfg = parseArgs(['--forms', 'm/a,m/b , m/c']);
  assert.equal(cfg.error, undefined);
  assert.deepEqual(cfg.forms.map((f) => f.key), ['m/a', 'm/b', 'm/c']);
});

test('--forms de-dupes — one boot per form, never two passes over the same form', () => {
  const cfg = parseArgs(['--forms', 'm/a,m/b,m/a', '--form', 'm/b']);
  assert.deepEqual(cfg.forms.map((f) => f.key), ['m/a', 'm/b']);
});

test('--form and --forms combine into one set', () => {
  const cfg = parseArgs(['--forms', 'm/a,m/b', '--form', 'm/z']);
  assert.deepEqual(cfg.forms.map((f) => f.key), ['m/a', 'm/b', 'm/z']);
});

test('a form name with slashes keeps the tail as the name', () => {
  const cfg = parseArgs(['--form', 'mod/nested/name']);
  assert.equal(cfg.forms[0].module, 'mod');
  assert.equal(cfg.forms[0].formName, 'nested/name');
  assert.equal(cfg.forms[0].slug, 'mod--nested-name');
});

test('defaults: portal, backend, out, mode, flags', () => {
  const cfg = parseArgs(['--form', 'm/a']);
  assert.equal(cfg.portal, 'http://localhost:3000');
  assert.equal(cfg.backend, 'http://localhost:21021');
  assert.equal(cfg.mode, 'edit');
  assert.equal(cfg.outDir, path.join(process.cwd(), 'render-verdicts'));
  assert.equal(cfg.expectData, false);
  assert.equal(cfg.headed, false);
  assert.equal(cfg.stateReuse, true);
  assert.equal(cfg.tokenFile, null);
});

test('options are read: portal (trailing slash trimmed), token-file, flags', () => {
  const cfg = parseArgs([
    '--forms', 'm/a',
    '--portal', 'http://portal.test:3000/',
    '--backend', 'https://api.test',
    '--out', 'C:/tmp/verdicts',
    '--mode', 'readonly',
    '--token-file', 'C:/tmp/access-token',
    '--expect-data', '--headed', '--no-state-reuse',
  ]);
  assert.equal(cfg.portal, 'http://portal.test:3000');
  assert.equal(cfg.backend, 'https://api.test');
  assert.equal(cfg.outDir, 'C:/tmp/verdicts');
  assert.equal(cfg.mode, 'readonly');
  assert.equal(cfg.tokenFile, 'C:/tmp/access-token');
  assert.equal(cfg.expectData, true);
  assert.equal(cfg.headed, true);
  assert.equal(cfg.stateReuse, false);
});

test('no form at all is a usage error, not a default', () => {
  const cfg = parseArgs([]);
  assert.match(cfg.error, /no form given/);
  assert.equal(cfg.forms, undefined);
});

test('a value without a module is a usage error', () => {
  assert.match(parseArgs(['--form', 'facility-details']).error, /expected <module>\/<name>/);
  assert.match(parseArgs(['--forms', 'm/a,broken']).error, /expected <module>\/<name>/);
  assert.match(parseArgs(['--form', '/name']).error, /expected <module>\/<name>/);
});

test('a flag consumed as a value is not mistaken for a form', () => {
  // `--form --headed` must NOT read "--headed" as the form name
  assert.match(parseArgs(['--form', '--headed']).error, /no form given/);
});

test('--help prints the usage (advertising --forms) and exits 0 without a browser', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /--forms <module>\/<a>,<module>\/<b>/);
});

test('running the script with a bad argument exits 2 with the usage line', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--form', 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /expected <module>\/<name>/);
  assert.match(r.stderr, /--forms/);
});
