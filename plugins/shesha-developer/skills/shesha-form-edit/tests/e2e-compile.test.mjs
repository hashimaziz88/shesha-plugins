/**
 * tests/e2e-compile.test.mjs — Phase 3, Task 5, deliverable 1.
 *
 * The per-archetype end-to-end chain: for each of the 8 archetypes,
 *   compile -> validate (zero Tier 1 + zero Tier 2) -> render the ASCII mock
 *   from the SAME (flow-completed) blueprint the compiler consumed -> assert
 *   the mock's node set matches the compiled tree's node set.
 *
 * The mock (render-mock.mjs, shesha-design-comprehension) and the compiled
 * tree (tree.mjs, this skill) are two INDEPENDENT pieces of traversal logic
 * walking the same completed blueprint. If they ever disagree on which
 * nodes exist, one of the two has drifted from the blueprint — this test
 * exists to make that drift loud rather than silent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../scripts/compile-spec.mjs';
import { flatten } from '../scripts/lib/walk.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';
import { completeBlueprintNodes } from '../scripts/lib/compile/flow-complete.mjs';
import { renderMock } from '../../shesha-design-comprehension/scripts/lib/render-mock.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BP_DIR = join(ROOT, '../shesha-design-comprehension/assets/blueprint-examples');
const FLOWS_DIR = join(ROOT, 'assets/archetypes');

const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const tokens = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json'), 'utf8'));
const ctx = { registry, roles, tokens };

const ARCHETYPES = [
  'standalone-capture', 'capture-dialog', 'record-detail', 'table-worklist',
  'list-card', 'hub', 'dashboard', 'wizard',
];

function loadBlueprint(archetype) {
  return JSON.parse(readFileSync(join(BP_DIR, `${archetype}.blueprint.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// Extracting the "node set" a rendered ASCII mock actually shows.
//
// render-mock.mjs's line shapes (see its own renderNode()):
//   - box header:  "<indent>┌─ <headerPrefix><node.node>[ ─── role: x][ (added by flow)]"
//   - box footer:  "<indent>└─"                                            (no node)
//   - column hdr:  "<indent>│ col | col │"                                 (no node)
//   - override:    "<indent>Δ prop=value [source]"                        (no node)
//   - tab marker:  "<indent>▤ tab: key (\"title\")"                       (no node)
//   - datalist:    "<indent>╭ card ╮ ..." / "row-template → ..."          (no node)
//   - style summary (formatSummary output, immediately under a box header):
//       always starts with one of "flex ", "wrap", "gap ", "justify:",
//       "align:", "w:", "minH:" (only ever paired with "w:"), "pad ",
//       or a bare display value ("block"/"inline"/"grid"/"none"/...).
//   - leaf line:   "<indent><headerPrefix><node.node>[ ─── role: x][ \"content\"]
//                   [ ─── buttonGroup: ...][ ⟨...⟩][ (added by flow)]"
// `headerPrefix` is only ever "Step N: " (wizard steps), applied to box AND
// leaf children alike.
// ---------------------------------------------------------------------------

const SUMMARY_FIRST_TOKEN_RE = /^(flex\s|wrap$|gap\s|justify:|align:|w:|minH:|pad\s|block$|inline$|inline-block$|none$|grid$|flow$|flow-root$|contents$|table)/;

function extractMockNodeNames(mockText, blueprint) {
  const screenLine = blueprint.screen
    ? `${blueprint.screen}${blueprint.archetype ? ` (${blueprint.archetype})` : ''}`
    : null;
  const names = new Set();
  for (const raw of mockText.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (screenLine && line === screenLine) continue;
    if (line === '└─') continue;
    if (line.startsWith('▤ tab:')) continue;
    if (line.startsWith('│')) continue;
    if (line.startsWith('Δ ')) continue;
    if (line.startsWith('╭')) continue;
    if (line.startsWith('row-template')) continue;
    if (line.startsWith('viewport ')) continue;
    const firstPart = line.split(' · ')[0];
    if (SUMMARY_FIRST_TOKEN_RE.test(firstPart)) continue;
    let rest = line.startsWith('┌─ ') ? line.slice(3) : line;
    rest = rest.replace(/^Step \d+: /, '');
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * Nodes that appear only in the compiled tree, never in the mock, are
 * expected ONLY when they are a normalize()-synthesized structural wrapper
 * (A3's wrapFlexChild names them "<propertyName-or-componentName>Wrap") —
 * the blueprint author never named these, normalize() invents them
 * mechanically to satisfy the universal-container rule, so render-mock.mjs
 * (which walks the pre-normalize blueprint) has no way to know about them.
 * Any OTHER tree-only name is genuine drift.
 */
function isExpectedSyntheticWrapper(name) {
  return /Wrap$/.test(name);
}

for (const archetype of ARCHETYPES) {
  test(`${archetype}: end-to-end — compile, validate clean, mock matches compiled tree`, () => {
    const blueprint = loadBlueprint(archetype);
    const flow = loadFlow(archetype, { dir: FLOWS_DIR });

    // 1. Compile.
    const { markup, report } = compileSpec(blueprint, { ...ctx, flows: { [archetype]: flow } });
    assert.ok(markup && Array.isArray(markup.components) && markup.components.length > 0, `${archetype}: compileSpec produced no components`);

    // 2. Validate: zero Tier 1, zero Tier 2 (T2-SKIPPED excluded, same as
    //    the task's own acceptance gate).
    const t1 = tier1(markup, { registry });
    const t2Raw = tier2(markup, { registry, roles, flows: { [archetype]: flow }, archetype });
    const t2 = t2Raw.filter((f) => f.severity !== 'skip');
    assert.deepStrictEqual(t1, [], `${archetype}: expected zero Tier 1 findings, got:\n${JSON.stringify(t1, null, 2)}`);
    assert.deepStrictEqual(t2, [], `${archetype}: expected zero Tier 2 findings, got:\n${JSON.stringify(t2, null, 2)}`);

    // 3. Render the ASCII mock from the SAME completed blueprint (flow gaps
    //    filled) the compiler itself built from — report.nodes already
    //    proves every entry is 'blueprint' or 'flow-manifest' sourced.
    const { nodes: completedNodes } = completeBlueprintNodes(blueprint.nodes, flow);
    const completedBlueprint = { ...blueprint, nodes: completedNodes };
    const mock = renderMock(completedBlueprint);
    assert.equal(typeof mock, 'string');
    assert.ok(mock.length > 0, `${archetype}: renderMock produced an empty mock`);

    // Determinism: renderMock must be pure (no clock/randomness/Object.keys order).
    assert.equal(renderMock(completedBlueprint), mock, `${archetype}: renderMock is not deterministic`);

    // 4. The mock's node set vs. the compiled tree's node set. componentName
    //    is set to the blueprint's own node name for every buildable type
    //    (container/tabs/buttonGroup/dataContext/datatable/datalist/wizard/
    //    leaf — see tree.mjs/leaf.mjs/datacontext.mjs), so any name the mock
    //    shows must also appear as a componentName somewhere in the compiled
    //    tree, and vice versa (modulo normalize()'s own synthetic wrappers).
    const mockNames = extractMockNodeNames(mock, completedBlueprint);
    const entries = flatten(markup.components);
    const treeNames = new Set(entries.map(({ node }) => node.componentName).filter(Boolean));

    const onlyInMock = [...mockNames].filter((n) => !treeNames.has(n));
    assert.deepStrictEqual(
      onlyInMock,
      [],
      `${archetype}: the mock renders node(s) [${onlyInMock.join(', ')}] that do not appear anywhere in the compiled tree — the mock and the compiler have drifted on what this blueprint contains.`,
    );

    const onlyInTree = [...treeNames].filter((n) => !mockNames.has(n) && !isExpectedSyntheticWrapper(n));
    assert.deepStrictEqual(
      onlyInTree,
      [],
      `${archetype}: the compiled tree contains node(s) [${onlyInTree.join(', ')}] that never appear in the mock and are not normalize()-synthesized "*Wrap" wrappers — the mock and the compiler have drifted on what this blueprint contains.`,
    );

    // Report sanity, mirroring compile-spec.test.mjs's own acceptance check.
    assert.equal(report.archetype, archetype);
    assert.ok(Array.isArray(report.nodes) && report.nodes.length > 0);
  });
}
