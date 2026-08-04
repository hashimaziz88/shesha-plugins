// CONTRACT TESTS — theme resolution is FAIL-CLOSED (rebuild target, mostly RED today).
//
// R-042 says the active theme is the only styling input, and every form ships
// styled. Today compile-blueprint.js contradicts that in three ways:
//
//   * an unknown --theme name prints `WARN: theme "x" not found ... emitting
//     neutral defaults` and exits 0 — so a typo'd brand silently ships an
//     unbranded form that passes every gate;
//   * there is no way to pass a theme FILE at all (`--token-file` is the backend
//     auth token, not tokens), so an externally authored brand cannot be compiled
//     or validated;
//   * nothing validates a theme file, so a token file missing `roles.pageBg`, or
//     one whose role points at a token path that does not exist, compiles clean and
//     drops the value.
//
// Contract: a theme the compiler cannot fully resolve is a COMPILE ERROR.
// `--no-style` stays the single, explicit opt-out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..', '..');
const COMPILER = path.join(SKILL, 'scripts', 'compile-blueprint.js');
const FIXTURE = path.join(SKILL, 'tests', 'fixtures', 'asset-capture.blueprint.json');
const THEME_DIR = path.join(SKILL, '..', 'shesha-design-system', 'assets', 'themes');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-contract-'));

const compile = (extra) => {
  const out = path.join(WORK, `out-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [COMPILER, '--blueprint', FIXTURE, '--out', out, '--no-live', ...extra],
    { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, file: out };
};

const shesha = JSON.parse(fs.readFileSync(path.join(THEME_DIR, 'shesha.tokens.json'), 'utf8'));

test('CONTRACT: an unknown --theme name is a COMPILE ERROR, not a silent neutral fallback', () => {
  const r = compile(['--theme', 'definitely-not-a-theme']);
  assert.notEqual(r.code, 0,
    'compile exited 0 for theme "definitely-not-a-theme". A misspelled brand must not ship an unbranded form ' +
    `that passes every gate — fail closed and name the theme.\n${r.out}`);
  assert.match(r.out, /definitely-not-a-theme/, 'the error must name the theme that could not be resolved');
  assert.doesNotMatch(r.out, /emitting neutral defaults/,
    'a "neutral defaults" fallback for an unknown theme is exactly the silent-downgrade this contract forbids');
});

test('--no-style is the ONE explicit opt-out: exit 0, and no brand values in the output', () => {
  const r = compile(['--theme', 'shesha', '--no-style']);
  assert.equal(r.code, 0, `--no-style must remain a supported, successful compile:\n${r.out}`);
  const text = fs.readFileSync(r.file, 'utf8');
  for (const v of [shesha.palette.brand.primary, shesha.palette.surfaces.canvas, shesha.palette.lines.border]) {
    assert.doesNotMatch(text, new RegExp(v, 'i'), `--no-style output still carries the shesha brand value ${v}`);
  }
});

test('CONTRACT: a theme FILE missing a required role is rejected (--theme-file)', () => {
  // The interface the contract requires: a theme may be supplied as a FILE, and it
  // is VALIDATED before it is used. Spawned against the future interface on
  // purpose — today the flag is unknown, the compiler falls back to the default
  // theme and exits 0, which is the gap.
  const bad = JSON.parse(JSON.stringify(shesha));
  delete bad.roles.pageBg;
  const file = path.join(WORK, 'missing-role.tokens.json');
  fs.writeFileSync(file, JSON.stringify(bad, null, 2));

  const r = compile(['--theme-file', file]);
  assert.notEqual(r.code, 0,
    'a theme file with no roles.pageBg compiled successfully. Every role the compiler reads must be present, ' +
    `or the page ground silently disappears.\n${r.out}`);
  assert.match(r.out, /pageBg/, 'the error must name the missing role');
});

test('CONTRACT: a theme FILE with a dangling token reference is rejected (--theme-file)', () => {
  // roles.* are token PATHS into the same file. A path nothing resolves means the
  // role is dropped at compile time and the form ships missing that value.
  const bad = JSON.parse(JSON.stringify(shesha));
  bad.roles.pageBg = 'palette.surfaces.doesNotExist';
  const file = path.join(WORK, 'dangling-token.tokens.json');
  fs.writeFileSync(file, JSON.stringify(bad, null, 2));

  const r = compile(['--theme-file', file]);
  assert.notEqual(r.code, 0,
    'a theme file whose roles.pageBg points at palette.surfaces.doesNotExist compiled successfully. ' +
    `A dangling token reference must be a compile error naming the path [R-042].\n${r.out}`);
  assert.match(r.out, /palette\.surfaces\.doesNotExist/, 'the error must name the dangling token path');
});

test('CONTRACT: --theme-file selects the theme (a valid file compiles, and ITS tokens are baked in)', () => {
  // The positive half — proof the three tests above fail for VALIDATION reasons
  // once the interface exists, not merely because the flag is unrecognised. The
  // canvas is deliberately a value NO shipped theme uses, so the flag being
  // silently ignored (today: falls back to the default `shesha` theme) fails here.
  const custom = JSON.parse(JSON.stringify(shesha));
  custom.palette.surfaces.canvas = '#123456';
  const file = path.join(WORK, 'valid.tokens.json');
  fs.writeFileSync(file, JSON.stringify(custom, null, 2));
  const r = compile(['--theme-file', file]);
  assert.equal(r.code, 0, `a VALID theme file must compile cleanly through --theme-file:\n${r.out}`);
  const text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /#123456/i,
    '--theme-file did not bake in the file\'s own tokens — the flag must SELECT the theme, not be ignored ' +
    `in favour of the default one.\n${r.out}`);
  assert.doesNotMatch(text, new RegExp(shesha.palette.surfaces.canvas, 'i'),
    'the compiled output still carries the DEFAULT theme page ground — --theme-file was ignored');
});
