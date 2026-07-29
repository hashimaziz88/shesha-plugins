import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { compileSpec } from '../scripts/compile-spec.mjs';
import { normalize } from '../scripts/normalize-form.mjs';
import { flatten } from '../scripts/lib/walk.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow, requiredNodes } from '../scripts/lib/flow.mjs';
import { isSplitWidthValue } from '../scripts/lib/expand-style.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BP_DIR = join(ROOT, '../shesha-design-comprehension/assets/blueprint-examples');
const FLOWS_DIR = join(ROOT, 'assets/archetypes');
const CLI = join(ROOT, 'scripts/compile-spec.mjs');

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

function loadFlowFor(archetype) {
  return loadFlow(archetype, { dir: FLOWS_DIR });
}

// ---------------------------------------------------------------------------
// One case per archetype: compiled output has zero Tier 1 and zero Tier 2
// findings (the whole task's acceptance criterion).
// ---------------------------------------------------------------------------

for (const archetype of ARCHETYPES) {
  test(`${archetype}: compiled output is Tier 1 + Tier 2 clean`, () => {
    const blueprint = loadBlueprint(archetype);
    const flow = loadFlowFor(archetype);
    const { markup, report } = compileSpec(blueprint, { ...ctx, flows: { [archetype]: flow } });

    const t1 = tier1(markup, { registry });
    const t2Raw = tier2(markup, { registry, roles, flows: { [archetype]: flow }, archetype });
    const t2 = t2Raw.filter((f) => f.severity !== 'skip');

    assert.deepStrictEqual(t1, [], `Tier 1 findings for ${archetype}: ${JSON.stringify(t1, null, 2)}`);
    assert.deepStrictEqual(t2, [], `Tier 2 findings for ${archetype}: ${JSON.stringify(t2, null, 2)}`);

    // Report sanity: every emitted node is named, and the archetype/report
    // shape a human would rely on to see the compiler's own decisions.
    assert.equal(report.archetype, archetype);
    assert.ok(Array.isArray(report.nodes) && report.nodes.length > 0);
    assert.ok(Array.isArray(report.defaults));
    for (const n of report.nodes) {
      assert.ok(['blueprint', 'flow-manifest'].includes(n.source), `node "${n.node}" has an unrecognized report source "${n.source}"`);
    }
  });
}

// ---------------------------------------------------------------------------
// Determinism: compiling the same blueprint twice, independently, is
// byte-identical. Ids must therefore be derived deterministically from the
// blueprint (a stable hash of each node's tree path — see
// scripts/lib/compile/ids.mjs and normalize-form.mjs's own deterministicUuid,
// which mints the container/leaf ids compile-spec itself leaves for
// normalize() to fill in), never crypto.randomUUID().
// ---------------------------------------------------------------------------

for (const archetype of ARCHETYPES) {
  test(`${archetype}: compiling the same blueprint twice is byte-identical`, () => {
    const blueprint = loadBlueprint(archetype);
    const a = compileSpec(blueprint, ctx);
    const b = compileSpec(blueprint, ctx);
    assert.equal(JSON.stringify(a.markup), JSON.stringify(b.markup));
  });
}

// ---------------------------------------------------------------------------
// compile(bp) then normalize(...) is a no-op — the strongest available
// statement that the compiler and the normalizer agree on what "normalized"
// means, and the fastest way to catch the compiler emitting something the
// normalizer would still rewrite.
// ---------------------------------------------------------------------------

for (const archetype of ARCHETYPES) {
  test(`${archetype}: normalize(compileSpec(bp).markup) is a no-op`, () => {
    const blueprint = loadBlueprint(archetype);
    const { markup } = compileSpec(blueprint, ctx);
    const renormalized = normalize(markup, ctx);
    assert.deepStrictEqual(renormalized, markup);
  });
}

// ---------------------------------------------------------------------------
// Every node in the archetype's requiredNodes(flow) appears in the output —
// mirrors tier2.mjs's own T2-FLOW-INCOMPLETE notion of "present" (a required
// node's TYPE exists somewhere in the tree; buttonGroup action wiring is
// exercised separately by the Tier 2 clean assertion above).
// ---------------------------------------------------------------------------

for (const archetype of ARCHETYPES) {
  test(`${archetype}: every requiredNodes(flow) type is present in the compiled tree`, () => {
    const blueprint = loadBlueprint(archetype);
    const flow = loadFlowFor(archetype);
    const { markup } = compileSpec(blueprint, ctx);
    const entries = flatten(markup.components);
    const presentTypes = new Set(entries.map(({ node }) => node.type));

    for (const req of requiredNodes(flow)) {
      assert.ok(presentTypes.has(req.type), `${archetype}: required node "${req.node}" (type "${req.type}") is missing from the compiled output`);
    }
  });
}

// ---------------------------------------------------------------------------
// No "columns" component anywhere; no proportional width on any input leaf —
// the two hard-won rules the whole compiler exists to never violate.
// ---------------------------------------------------------------------------

const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];

for (const archetype of ARCHETYPES) {
  test(`${archetype}: no "columns" component and no split width on any leaf`, () => {
    const blueprint = loadBlueprint(archetype);
    const { markup } = compileSpec(blueprint, ctx);
    const entries = flatten(markup.components);

    for (const { node, ctx: nodeCtx } of entries) {
      assert.notEqual(node.type, 'columns', `${archetype}: found a "columns" component at ${nodeCtx.path}`);
      if (node.type !== 'container') {
        for (const bp of BREAKPOINTS) {
          const w = node[bp]?.dimensions?.width;
          assert.ok(!isSplitWidthValue(w), `${archetype}: leaf "${node.type}" at ${nodeCtx.path} carries a proportional ${bp} width (${JSON.stringify(w)})`);
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// An override carrying {prop, value, source, evidence} survives into the
// markup; one missing source/evidence is rejected with a clear error.
// ---------------------------------------------------------------------------

test('a well-formed container override survives compilation into the markup', () => {
  const blueprint = loadBlueprint('standalone-capture');
  const withOverride = {
    ...blueprint,
    nodes: blueprint.nodes.map((n) => (n.node === 'page'
      ? {
        ...n,
        overrides: [
          { prop: 'desktop.background.color', value: '#123456', source: 'design token override', evidence: 'brand palette v3, row 12' },
        ],
      }
      : n)),
  };

  const { markup } = compileSpec(withOverride, ctx);
  const page = markup.components.find((c) => c.componentName === 'page');
  const ov = (page.overrides ?? []).find((o) => o.prop === 'desktop.background.color');
  assert.ok(ov, 'the override did not survive into the compiled markup');
  assert.equal(ov.value, '#123456');
  assert.equal(ov.source, 'design token override');
  assert.equal(ov.evidence, 'brand palette v3, row 12');
});

test('an override missing "evidence" is rejected with a clear error', () => {
  const blueprint = loadBlueprint('standalone-capture');
  const broken = {
    ...blueprint,
    nodes: blueprint.nodes.map((n) => (n.node === 'page'
      ? { ...n, overrides: [{ prop: 'desktop.background.color', value: '#123456', source: 'design token override' }] }
      : n)),
  };

  assert.throws(
    () => compileSpec(broken, ctx),
    (err) => err instanceof Error && /evidence/.test(err.message) && /schema validation/.test(err.message),
  );
});

test('an override missing "source" is rejected with a clear error', () => {
  const blueprint = loadBlueprint('standalone-capture');
  const broken = {
    ...blueprint,
    nodes: blueprint.nodes.map((n) => (n.node === 'page'
      ? { ...n, overrides: [{ prop: 'desktop.background.color', value: '#123456', evidence: 'brand palette v3, row 12' }] }
      : n)),
  };

  assert.throws(
    () => compileSpec(broken, ctx),
    (err) => err instanceof Error && /source/.test(err.message) && /schema validation/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Flow-manifest-added nodes are correctly tagged in the report (table-worklist
// and list-card's blueprints both omit the "subtitle" text node their flow
// requires; dashboard's blueprint stops at two of the three required metric
// tiles) — a human reading the report must be able to see the compiler
// invented these, not the blueprint author.
// ---------------------------------------------------------------------------

test('table-worklist: the flow-required "subtitle" node missing from the blueprint is added and reported', () => {
  const blueprint = loadBlueprint('table-worklist');
  assert.ok(!blueprint.nodes.some((n) => n.node === 'subtitle'), 'fixture assumption changed: table-worklist blueprint now defines its own subtitle');

  const { markup, report } = compileSpec(blueprint, ctx);
  const entry = report.nodes.find((n) => n.node === 'subtitle');
  assert.ok(entry, 'subtitle node missing from the report');
  assert.equal(entry.source, 'flow-manifest');
  assert.ok(report.defaults.some((d) => d.includes('subtitle')));

  const entries = flatten(markup.components);
  assert.ok(entries.some(({ node }) => node.type === 'text' && node.componentName === 'subtitle'));
});

test('dashboard: the third flow-required metric tile missing from the blueprint is added and reported', () => {
  const blueprint = loadBlueprint('dashboard');
  assert.ok(!blueprint.nodes.some((n) => n.node === 'metric3'), 'fixture assumption changed: dashboard blueprint now defines its own metric3');

  const { report } = compileSpec(blueprint, ctx);
  for (const name of ['metric3', 'metric3Label', 'metric3Value']) {
    const entry = report.nodes.find((n) => n.node === name);
    assert.ok(entry, `${name} missing from the report`);
    assert.equal(entry.source, 'flow-manifest');
  }
});

// ---------------------------------------------------------------------------
// CLI smoke test
// ---------------------------------------------------------------------------

test('CLI: compiles a blueprint file and writes a form.json with --out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compile-spec-cli-'));
  const bpPath = join(dir, 'bp.json');
  const outPath = join(dir, 'form.json');
  writeFileSync(bpPath, JSON.stringify(loadBlueprint('standalone-capture')), 'utf8');

  const stdout = execFileSync(process.execPath, [CLI, bpPath, '--out', outPath], { encoding: 'utf8' });
  assert.match(stdout, /Wrote/);

  const written = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.ok(Array.isArray(written.components) && written.components.length > 0);
  assert.ok(written.formSettings?.modelType);
});

test('CLI: --json prints both markup and report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compile-spec-cli-'));
  const bpPath = join(dir, 'bp.json');
  writeFileSync(bpPath, JSON.stringify(loadBlueprint('capture-dialog')), 'utf8');

  const stdout = execFileSync(process.execPath, [CLI, bpPath, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.markup?.components);
  assert.ok(parsed.report?.nodes);
});
