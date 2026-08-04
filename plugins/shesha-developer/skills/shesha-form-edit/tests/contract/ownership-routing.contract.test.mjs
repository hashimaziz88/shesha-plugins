// CONTRACT TESTS — one owner per concern (lint-style source assertions, expected RED today).
//
// The designer family is four skills that all describe the same pipeline. Every
// duplicated statement in that prose is a future contradiction: two thresholds
// drift apart, two oracles both claim a browser, three scripts each resolve the
// session root their own way. These tests assert SINGLE OWNERSHIP, mechanically.
//
// Every assertion here is deliberately narrow and documented, because a grep-style
// lint is only useful if what it forbids is unambiguous.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');
const PLUGIN = path.join(SKILLS, '..');

const DESIGNER_FAMILY = ['shesha-claude-designer', 'shesha-form-edit', 'shesha-design-comprehension', 'shesha-design-system'];

/** Every authored .md under a skill — node_modules is vendored, never ours. */
function mdFiles(skill) {
  const root = path.join(SKILLS, skill);
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(p);
    }
  })(root);
  return out;
}
const DESIGNER_MD = DESIGNER_FAMILY.flatMap(mdFiles);
const rel = (p) => path.relative(SKILLS, p).replace(/\\/g, '/');

// ---- 1. one numeric fan-out threshold ---------------------------------------
// A file may CITE the threshold ("threshold: orchestration.md") freely. What
// exactly one file may do is STATE THE NUMERALS. The pattern below matches a
// numeric threshold statement: a "<=3" / "2-3" bound and a "4+" bound within the
// same sentence, in either order.
const NUMERIC_THRESHOLD = /(≤\s*3|<=\s*3|2\s*[–-]\s*3)[^.\n]{0,120}4\s*\+|4\s*\+[^.\n]{0,120}(≤\s*3|<=\s*3|2\s*[–-]\s*3)/;

test('CONTRACT: exactly ONE file states the fan-out threshold numerals', () => {
  const staters = DESIGNER_MD.filter((f) => NUMERIC_THRESHOLD.test(fs.readFileSync(f, 'utf8'))).map(rel);
  assert.equal(staters.length, 1,
    `${staters.length} designer files state the fan-out numerals; exactly one may (the canon file). ` +
    `Everyone else CITES it.\n  ${staters.join('\n  ')}`);
});

// ---- 2. no designer skill depends on Superpowers -----------------------------
// The designer family must be self-contained: its orchestration cannot require a
// skill pack that may not be installed. Any mention at all is a dependency in
// prose, so the bar is zero mentions across the family's authored docs.
test('CONTRACT: no designer skill doc references Superpowers', () => {
  const hits = DESIGNER_MD
    .map((f) => ({ f: rel(f), lines: fs.readFileSync(f, 'utf8').split('\n')
      .map((l, i) => [i + 1, l]).filter(([, l]) => /superpowers/i.test(l)) }))
    .filter((h) => h.lines.length);
  assert.deepEqual(hits.map((h) => h.f), [],
    'the designer family references Superpowers — orchestration must not depend on an external skill pack:\n' +
    hits.map((h) => h.lines.map(([n, l]) => `  ${h.f}:${n}: ${l.trim()}`).join('\n')).join('\n'));
});

// ---- 3. one owner of the per-form oracle -------------------------------------
// shesha-form-edit owns the browser: it runs render-instrument, and its verdict
// artifacts are what every later layer consumes. The conductor's job is to READ
// those artifacts. Narrow assertion: no shesha-claude-designer doc may name an
// executable oracle (render-instrument / verify-placement / layout-probe) or
// dispatch the critic itself — naming a script in the conductor's own steps is how
// a second browser pass per form gets authored back in.
const CONDUCTOR_FORBIDDEN = [
  [/render[-\s]instrument/i, 'render-instrument is shesha-form-edit\'s oracle; the conductor consumes its verdict artifact'],
  [/verify-placement|layout-probe/i, 'the placement probe belongs to shesha-design-comprehension'],
  [/`design-critic`\s*dispatch|dispatch(?:es|ing)?\s+(?:a\s+|the\s+)?`?design-critic/i,
    'the critic is dispatched by the skill that owns the form\'s verification, not by the conductor'],
];

test('CONTRACT: shesha-claude-designer does not run the per-form oracle itself', () => {
  const violations = [];
  for (const f of mdFiles('shesha-claude-designer')) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      for (const [re, why] of CONDUCTOR_FORBIDDEN) {
        if (re.test(line)) violations.push(`  ${rel(f)}:${i + 1}: ${line.trim()}\n      → ${why}`);
      }
    }
  }
  assert.deepEqual(violations, [],
    'the conductor names per-form oracle machinery in its own steps — one owner per oracle:\n' + violations.join('\n'));
});

// ---- 4. one session-root implementation -------------------------------------
// `git rev-parse --show-toplevel` is the session-root resolver. Three independent
// copies means three answers the day a worktree or submodule is involved.
test('CONTRACT: exactly ONE file implements git-toplevel session-root resolution', () => {
  const roots = [path.join(PLUGIN, 'hooks'), ...DESIGNER_FAMILY.map((s) => path.join(SKILLS, s, 'scripts'))]
    .filter((d) => fs.existsSync(d));
  const impls = [];
  for (const root of roots) {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|mjs|cjs)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('show-toplevel')) {
          impls.push(path.relative(PLUGIN, p).replace(/\\/g, '/'));
        }
      }
    })(root);
  }
  assert.equal(impls.length, 1,
    `${impls.length} files resolve the session root via \`git rev-parse --show-toplevel\`; exactly one may own it ` +
    `and the rest must import it.\n  ${impls.join('\n  ')}`);
});
