// Keeps references/_rules.json honest about itself.
//
// The registry is the single source of mechanical fact and the validators cite its
// ids — so a rule that ADVERTISES a machine check ("check": "walker: …") but whose
// id appears in no script is a lie the reader cannot detect. Likewise a
// severity:"fail" rule with check:null claims to block a push that nothing blocks.
// Both drifted in the past; this test pins them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const registry = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', '_rules.json'), 'utf8'));

// Every id mentioned anywhere under scripts/ (comments count — a walker that cites
// its rule id in a code comment is still a traceable implementation).
const scriptText = (() => {
  let blob = '';
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(p); continue; }
      if (/\.(js|mjs|cjs)$/.test(entry.name)) blob += fs.readFileSync(p, 'utf8');
    }
  })(path.join(SKILL, 'scripts'));
  return blob;
})();

// Rules whose declared enforcement point is deliberately OUTSIDE scripts/ — each
// one named explicitly, so adding another is a conscious act, not drift.
// R-046: the push-ledger Stop hook is plugin-level harness config, not a script.
const ENFORCED_OUTSIDE_SCRIPTS = new Set(['R-046']);

test('_rules.json parses and every rule has the expected shape', () => {
  assert.ok(Array.isArray(registry.rules) && registry.rules.length > 0);
  const seen = new Set();
  for (const r of registry.rules) {
    assert.match(r.id, /^R-\d{3}$/, `bad rule id ${r.id}`);
    assert.equal(seen.has(r.id), false, `duplicate rule id ${r.id}`);
    seen.add(r.id);
    assert.equal(typeof r.group, 'string', `${r.id} has no group`);
    assert.ok(['fail', 'warn', 'process'].includes(r.severity), `${r.id} severity "${r.severity}"`);
    assert.ok(typeof r.statement === 'string' && r.statement.length > 20, `${r.id} statement too thin`);
    assert.ok(r.check === null || typeof r.check === 'string', `${r.id} check must be a string or null`);
  }
});

test('every severity:"fail" rule declares a check', () => {
  const unenforced = registry.rules.filter((r) => r.severity === 'fail' && !r.check).map((r) => r.id);
  assert.deepEqual(unenforced, [],
    `severity:"fail" claims the rule blocks a push — these declare no check: ${unenforced.join(', ')}`);
});

test('every declared check is cited by at least one script', () => {
  const uncited = registry.rules
    .filter((r) => r.check && !ENFORCED_OUTSIDE_SCRIPTS.has(r.id))
    .filter((r) => !scriptText.includes(r.id))
    .map((r) => `${r.id} (${r.severity})`);
  assert.deepEqual(uncited, [],
    `these rules advertise a machine check but no script under scripts/ cites them: ${uncited.join(', ')}`);
});

test('rules exempted from the citation requirement really do lack a check in scripts/', () => {
  // Guards the escape hatch: if someone implements R-046, the exemption must go.
  for (const id of ENFORCED_OUTSIDE_SCRIPTS) {
    assert.ok(registry.rules.some((r) => r.id === id), `${id} exempted but not in the registry`);
    assert.equal(scriptText.includes(id), false,
      `${id} is now cited by a script — remove it from ENFORCED_OUTSIDE_SCRIPTS`);
  }
});
