/**
 * tests/card-collapsible-fixture.test.mjs — Phase 3, Task 6.
 *
 * A standing regression guard for the "slotted component" builder gap
 * (tree.mjs's card/collapsiblePanel branch): no shipped archetype blueprint
 * uses either type, which is exactly why defect 2 (see
 * tests/forensic-regression.test.mjs) survived undetected until a real
 * form (flight-details) used one. This fixture pins a `record-detail`
 * blueprint that genuinely uses BOTH slotted types — a "card" (statusPanel,
 * 2 children) and a "collapsiblePanel" (metaPanel, 2 children) — through
 * the same acceptance gate the 8 archetypes get in compile-spec.test.mjs:
 * zero Tier 1 + zero Tier 2, compile-then-normalize is a no-op, and
 * compiling twice is byte-identical. If this builder branch ever regresses
 * (or a future registry change alters card/collapsiblePanel's
 * customContainerNames), this file fails loudly instead of the gap going
 * unnoticed again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../scripts/compile-spec.mjs';
import { normalize } from '../scripts/normalize-form.mjs';
import { flatten } from '../scripts/lib/walk.mjs';
import { tier1 } from '../scripts/lib/tier1.mjs';
import { tier2 } from '../scripts/lib/tier2.mjs';
import { loadFlow } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FLOWS_DIR = join(ROOT, 'assets/archetypes');
const ARCHETYPE = 'record-detail';

const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));
const tokens = JSON.parse(readFileSync(join(ROOT, '../shesha-design-system/assets/themes/shesha.tokens.json'), 'utf8'));
const ctx = { registry, roles, tokens };

const blueprint = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/card-collapsible.blueprint.json'), 'utf8'));
const flow = loadFlow(ARCHETYPE, { dir: FLOWS_DIR });
const flows = { [ARCHETYPE]: flow };

const FLEX_PROPS = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];

test('card+collapsiblePanel fixture: compiles without throwing', () => {
  assert.doesNotThrow(() => compileSpec(blueprint, { ...ctx, flows }));
});

test('card+collapsiblePanel fixture: compiled output is Tier 1 + Tier 2 clean', () => {
  const { markup } = compileSpec(blueprint, { ...ctx, flows });
  const t1 = tier1(markup, { registry });
  const t2Raw = tier2(markup, { registry, roles, flows, archetype: ARCHETYPE });
  const t2 = t2Raw.filter((f) => f.severity !== 'skip');
  assert.deepStrictEqual(t1, [], `Tier 1 findings: ${JSON.stringify(t1, null, 2)}`);
  assert.deepStrictEqual(t2, [], `Tier 2 findings: ${JSON.stringify(t2, null, 2)}`);
});

test('card+collapsiblePanel fixture: normalize(compileSpec(bp).markup) is a no-op', () => {
  const { markup } = compileSpec(blueprint, ctx);
  const renormalized = normalize(markup, ctx);
  assert.deepStrictEqual(renormalized, markup);
});

test('card+collapsiblePanel fixture: compiling the same blueprint twice is byte-identical', () => {
  const a = compileSpec(blueprint, ctx);
  const b = compileSpec(blueprint, ctx);
  assert.equal(JSON.stringify(a.markup), JSON.stringify(b.markup));
});

test('card+collapsiblePanel fixture: the card places its 2 children in "content", never doubled into a top-level components[]', () => {
  const { markup } = compileSpec(blueprint, ctx);
  const entries = flatten(markup.components);
  const card = entries.find(({ node }) => node.componentName === 'statusPanel')?.node;
  assert.ok(card, 'statusPanel card missing from compiled output');
  assert.equal(card.type, 'card');
  assert.equal(Array.isArray(card.content?.components) ? card.content.components.length : 0, 2);
  assert.equal(Array.isArray(card.components) ? card.components.length : 0, 0, 'T1-DOUBLE-SLOT shape: children must not ALSO sit in components[]');

  // The layout style (2+ children, no blueprint-authored role/style) landed
  // on the slot, not stranded on the card itself — the whole point of
  // defect 2 (see forensic-regression.test.mjs).
  const slotHasLayoutStyle = FLEX_PROPS.some((p) => card.content[p] !== undefined);
  assert.ok(slotHasLayoutStyle, 'statusPanel.content should carry a layout style for its 2 children');
  const cardHasFlexPropOnItself = FLEX_PROPS.some((p) => card[p] !== undefined || card.desktop?.[p] !== undefined);
  assert.ok(!cardHasFlexPropOnItself, 'statusPanel itself should carry no flex/layout prop — card has no such registered prop (T1-PROP-UNKNOWN)');
});

test('card+collapsiblePanel fixture: the collapsiblePanel places its 2 children in "content" and stamps header/customHeader present-but-empty', () => {
  const { markup } = compileSpec(blueprint, ctx);
  const entries = flatten(markup.components);
  const panel = entries.find(({ node }) => node.componentName === 'metaPanel')?.node;
  assert.ok(panel, 'metaPanel collapsiblePanel missing from compiled output');
  assert.equal(panel.type, 'collapsiblePanel');
  assert.equal(panel.content.components.length, 2);
  assert.deepStrictEqual(panel.header.components, []);
  assert.deepStrictEqual(panel.customHeader.components, []);

  const slotHasLayoutStyle = FLEX_PROPS.some((p) => panel.content[p] !== undefined);
  assert.ok(slotHasLayoutStyle, 'metaPanel.content should carry a layout style for its 2 children');
});
