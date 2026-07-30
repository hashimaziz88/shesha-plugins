import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../scripts/compile-spec.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));

/**
 * A doc that shows a blueprint has exactly one way to be wrong that matters:
 * showing a grammar the compiler does not accept. `designing-like-react.md` did
 * exactly that for a while — it taught a nested `{"kind": "stack", children:[…]}`
 * shape that appears nowhere in blueprint.schema.json, so anyone following it
 * authored something `compile-spec.mjs` rejects outright.
 *
 * Prose can't be tested, but the JSON block can: extract it from the doc and put
 * it through the real compiler and the real blocking gates. If someone edits the
 * example into something invalid, this fails.
 */
function jsonFencesOf(relPath) {
  const md = readFileSync(join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
  return [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
}

test('designing-like-react.md: every JSON fence is parseable', () => {
  const fences = jsonFencesOf('references/designing-like-react.md');
  assert.ok(fences.length >= 2, 'the doc should still carry its node-shape and worked-example blocks');
  for (const f of fences) assert.doesNotThrow(() => JSON.parse(f));
});

test('designing-like-react.md: the worked-example blueprint compiles and passes Tier 1 + Tier 2', () => {
  const fences = jsonFencesOf('references/designing-like-react.md');
  // The worked example is the largest fence; the other is a single-node snippet.
  const blueprint = JSON.parse(fences.reduce((a, b) => (b.length > a.length ? b : a)));

  // It must be a whole blueprint, not a fragment — otherwise this test would
  // silently start grading a snippet.
  for (const key of ['screen', 'archetype', 'nodes']) {
    assert.ok(blueprint[key] !== undefined, `the worked example must carry "${key}"`);
  }

  const { markup, report } = compileSpec(blueprint);
  assert.equal(report.theme, 'shesha', 'the documented theme id must resolve to a real token file');

  const flow = loadFlow(blueprint.archetype, { dir: join(ROOT, 'assets/archetypes') });
  const t1 = tier1(markup, { registry });
  // Same rule validate-form.mjs applies for its exit code: severity 'skip'
  // entries (T2-SKIPPED) report a check that could not run, not a defect.
  const t2 = tier2(markup, { registry, roles, flows: { [blueprint.archetype]: flow }, archetype: blueprint.archetype })
    .filter((f) => f.severity !== 'skip');

  assert.deepStrictEqual(t1.map((f) => f.code), [], 'documented example must have zero Tier 1 findings');
  assert.deepStrictEqual(t2.map((f) => f.code), [], 'documented example must have zero Tier 2 findings');
});

test('designing-like-react.md: no longer teaches the retired blueprint grammar', () => {
  const md = readFileSync(join(ROOT, 'references/designing-like-react.md'), 'utf8');
  // `kind` was the retired nested format's node discriminator; the current
  // schema has no such property anywhere.
  assert.ok(!/"kind"\s*:/.test(md), 'the retired "kind" node grammar must not reappear');
  assert.ok(!/compile-blueprint\.js/.test(md), 'the retired compiler must not be cited as the build command');
  assert.ok(!/--theme\s+<brand>/.test(md), 'compile-spec.mjs has no --theme flag; the theme comes from the blueprint');
});
