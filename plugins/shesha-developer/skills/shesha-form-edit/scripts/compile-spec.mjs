#!/usr/bin/env node
/**
 * compile-spec.mjs — the deterministic blueprint -> markup compiler.
 *
 * `compileSpec(blueprint, {registry, roles, tokens, flows}) => {markup, report}`
 * is the centrepiece this whole phase exists to build (see the task brief):
 * a typed blueprint (../shesha-design-comprehension/assets/blueprint-examples/
 * *.blueprint.json) goes in, a complete, already-normalized Shesha form
 * config comes out — no hand-written per-form translation script standing
 * between a validated blueprint and pushable markup.
 *
 * Pipeline:
 *   1. Validate the blueprint against its own JSON Schema (reuses
 *      shesha-design-comprehension's validateBlueprint — this is what turns
 *      "an override is missing source/evidence" into a clear compile-time
 *      error rather than a silently-wrong T2-STYLE-OFF-TOKEN finding later).
 *   2. Complete the blueprint's node list against the archetype's flow
 *      manifest (flow-complete.mjs) — synthesizes any required node/child
 *      the blueprint itself omitted, tagged `addedBy: "flow-manifest"`.
 *   3. Walk the (now-complete) node tree into a raw component tree
 *      (tree.mjs) — resolves each node's concrete registry type, its full
 *      style (containers), its buttonGroup/dataContext/datatable/etc shape.
 *      Emits NO id/parentId/version — deliberately left for step 4.
 *   4. Run the raw tree through `normalize()` (scripts/normalize-form.mjs,
 *      reused verbatim, never reimplemented) — this is what mints
 *      deterministic ids (seeded from each node's tree path — see
 *      normalize-form.mjs's own deterministicUuid), stamps parentId/version,
 *      and canonicalizes key order. Because normalize() is pure and this
 *      module's own tree-building is pure, compiling the same blueprint
 *      twice is byte-identical (determinism), and because the returned
 *      `markup` IS normalize()'s own output, `normalize(compileSpec(bp).markup)`
 *      is a no-op by construction (idempotence, proven separately in
 *      normalize.test.mjs).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from './normalize-form.mjs';
import { loadFlow } from './lib/flow.mjs';
import { validateBlueprint } from '../../shesha-design-comprehension/scripts/lib/validate-blueprint.mjs';
import { buildTree } from './lib/compile/tree.mjs';
import { completeBlueprintNodes } from './lib/compile/flow-complete.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const DEFAULT_REGISTRY_PATH = join(HERE, '../assets/registry/registry-0.45.1.json');
const DEFAULT_ROLES_PATH = join(HERE, '../../shesha-design-system/assets/roles.styles.json');
const THEMES_DIR = join(HERE, '../../shesha-design-system/assets/themes');
const DEFAULT_THEME_ID = 'shesha';
const DEFAULT_TOKENS_PATH = join(THEMES_DIR, `${DEFAULT_THEME_ID}.tokens.json`);
const DEFAULT_FLOWS_DIR = join(HERE, '../assets/archetypes');
const DEFAULT_BLUEPRINT_SCHEMA_PATH = join(HERE, '../../shesha-design-comprehension/assets/blueprint.schema.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadDefaults() {
  return {
    registry: loadJson(DEFAULT_REGISTRY_PATH),
    roles: loadJson(DEFAULT_ROLES_PATH),
    tokens: loadJson(DEFAULT_TOKENS_PATH),
    blueprintSchema: loadJson(DEFAULT_BLUEPRINT_SCHEMA_PATH),
  };
}

/**
 * The theme is a COMPILE-TIME input [R-042] — tokens are baked into every node
 * as the tree is emitted, so a blueprint's `theme` id has to be honoured HERE
 * or a non-default brand silently compiles to the default one. Resolution
 * mirrors `shesha-design-system/scripts/resolve-brand.mjs`: a named theme with
 * a token file is used; anything else falls back to the shipped default and
 * says so in `report.defaults` (never a thrown error, and never a reason to
 * author a new brand file).
 */
function resolveThemeTokens(themeId) {
  const requested = typeof themeId === 'string' ? themeId.trim() : '';
  if (!requested || requested === DEFAULT_THEME_ID) {
    return { themeId: DEFAULT_THEME_ID, tokens: loadJson(DEFAULT_TOKENS_PATH), note: null };
  }
  const candidate = join(THEMES_DIR, `${requested}.tokens.json`);
  if (existsSync(candidate)) {
    return { themeId: requested, tokens: loadJson(candidate), note: null };
  }
  return {
    themeId: DEFAULT_THEME_ID,
    tokens: loadJson(DEFAULT_TOKENS_PATH),
    note: `theme: blueprint requested "${requested}", which has no token file in `
      + `shesha-design-system/assets/themes/ — compiled with the shipped default `
      + `"${DEFAULT_THEME_ID}" instead. Do NOT author a brand file for this; brand `
      + 'authoring is a separate, explicitly requested task.',
  };
}

function loadFlowForArchetype(archetype, flows) {
  if (flows && flows[archetype]) return flows[archetype];
  if (existsSync(join(DEFAULT_FLOWS_DIR, `${archetype}.flow.json`))) {
    return loadFlow(archetype, { dir: DEFAULT_FLOWS_DIR });
  }
  return null;
}

function pascalCase(raw) {
  return String(raw ?? '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * A "Start Edit"/shesha.form buttonGroup action anywhere in the blueprint
 * marks this as a detail-lifecycle form (see leaf.mjs's own header comment
 * and tier2.mjs's T2-EDITMODE-MISMATCH, which this mirrors exactly).
 */
function computeIsDetailForm(blueprintNodes) {
  return blueprintNodes.some((n) => Array.isArray(n.items) && n.items.some((it) => it?.action?.actionName === 'Start Edit' && it?.action?.actionOwner === 'shesha.form'));
}

/**
 * formSettings.modelType — required unconditionally by tier2.mjs's
 * T2-MODELTYPE-SHAPE, even for archetypes with no bound entity at all (hub,
 * dashboard — see the task report's "genuinely can't reach clean without a
 * compiler default" note). A real entity binding is used verbatim; when
 * none exists, a stable placeholder derived from the form's own identity is
 * synthesized purely to satisfy the check — flagged in `report.defaults`
 * every time this happens so nobody mistakes it for a real entity.
 */
function buildFormSettings(blueprint, defaults) {
  const modelType = blueprint.entity?.modelType;
  if (modelType && modelType.name && modelType.module) {
    return { modelType: { name: modelType.name, module: modelType.module } };
  }
  const synthetic = `${blueprint.form?.module ?? 'app'}.${pascalCase(blueprint.form?.name ?? blueprint.screen ?? 'Screen')}`;
  defaults.push(
    `formSettings.modelType: archetype "${blueprint.archetype}" has no bound entity in this blueprint, but `
    + 'T2-MODELTYPE-SHAPE requires a non-empty modelType unconditionally — synthesized the placeholder '
    + `"${synthetic}" (form module + PascalCase form name) solely to satisfy that check; it is not a real entity.`,
  );
  return { modelType: synthetic };
}

/**
 * @param {object} blueprint - a parsed *.blueprint.json document
 * @param {{registry?, roles?, tokens?, flows?, blueprintSchema?}} [opts]
 * @returns {{markup: object, report: object}}
 */
export function compileSpec(blueprint, opts = {}) {
  const needsDefaults = !opts.registry || !opts.roles || !opts.tokens || !opts.blueprintSchema;
  const defaultsBag = needsDefaults ? loadDefaults() : {};
  const registry = opts.registry ?? defaultsBag.registry;
  const roles = opts.roles ?? defaultsBag.roles;
  const blueprintSchema = opts.blueprintSchema ?? defaultsBag.blueprintSchema;

  // An explicitly-passed token set always wins (callers that already resolved a
  // brand); otherwise the blueprint's own `theme` id decides.
  const resolvedTheme = opts.tokens ? null : resolveThemeTokens(blueprint.theme);
  const tokens = opts.tokens ?? resolvedTheme.tokens;

  if (blueprintSchema) {
    const errors = validateBlueprint(blueprint, blueprintSchema);
    if (errors.length) {
      throw new Error(`compileSpec: blueprint failed schema validation:\n  - ${errors.join('\n  - ')}`);
    }
  }

  const flow = loadFlowForArchetype(blueprint.archetype, opts.flows);
  const { nodes: completedNodes, added } = completeBlueprintNodes(blueprint.nodes, flow);
  const completedBlueprint = { ...blueprint, nodes: completedNodes };

  const isDetailForm = computeIsDetailForm(completedNodes);
  const { components, report: treeReport } = buildTree(completedBlueprint, { registry, roles, tokens, isDetailForm });

  const defaults = [];
  const formSettings = buildFormSettings(blueprint, defaults);
  if (resolvedTheme?.note) defaults.push(resolvedTheme.note);
  for (const a of added) {
    defaults.push(`${a.node} (${a.type}): ${a.reason}`);
  }

  const rawMarkup = { formSettings, components };
  const markup = normalize(rawMarkup, { registry, roles, tokens });

  const report = {
    archetype: blueprint.archetype,
    screen: blueprint.screen,
    form: blueprint.form,
    theme: resolvedTheme ? resolvedTheme.themeId : 'caller-supplied',
    isDetailForm,
    nodes: treeReport,
    defaults,
  };

  return { markup, report };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { _: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--json') opts.json = true;
    else opts._.push(a);
  }
  return opts;
}

function runCli(argv) {
  const args = parseArgs(argv.slice(2));
  const inPath = args._[0];
  if (!inPath) {
    process.stderr.write('Usage: node scripts/compile-spec.mjs <blueprint.json> [--out <form.json>] [--json]\n');
    process.exit(1);
  }
  const blueprint = loadJson(resolve(inPath));
  const { markup, report } = compileSpec(blueprint);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ markup, report }, null, 2)}\n`);
  } else if (args.out) {
    writeFileSync(resolve(args.out), `${JSON.stringify(markup, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote ${args.out}\n`);
    process.stdout.write(`${report.nodes.length} node(s) emitted (${report.defaults.length} default(s) applied), theme "${report.theme}".\n`);
  } else {
    process.stdout.write(`${JSON.stringify(markup, null, 2)}\n`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv);
}
