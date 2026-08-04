#!/usr/bin/env node
/**
 * THE CLI. One entry point, subcommands — not fifteen scripts.
 *
 * Contract every subcommand honours:
 *   - JSON to stdout, human diagnostics to stderr, so output is pipeable
 *   - --help on every subcommand (this IS the interface an agent learns from)
 *   - distinct, documented exit codes
 *   - no interactive prompts, ever (an agent shell has no TTY; a prompt hangs forever)
 *   - bounded stdout: a summary by default, --output <file> for the full artefact
 *
 * Exit codes (Phase 0 subset; later phases add to this table, never reuse):
 *   0   success
 *   1   gate failure               (check)
 *   2   target app is not Shesha 0.45
 *   3   backend unreachable / auth refused
 *   4   no match                   (explain)
 *   20  ground-truth harness failed (esbuild or in-page evaluation)
 *   64  usage error
 *   70  not implemented in this phase
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveFrameworkTruth, FrameworkError, resolveAppPaths, runRoundTrip } from './lib/framework.mjs';
import { BackendError, DEFAULT_BACKEND, deriveBackendTruth } from './lib/api.mjs';
import { loadRules, renderManifest, TRIAGE } from './lib/rules.mjs';
import { normaliseMarkup, runGates } from './lib/gates.mjs';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXIT = {
  OK: 0,
  GATE: 1,
  NOT_045: 2,
  BACKEND: 3,
  NO_MATCH: 4,
  HARNESS: 20,
  USAGE: 64,
  UNIMPLEMENTED: 70,
};

const SUBCOMMANDS = {
  probe: 'Derive Shesha 0.45 ground truth from the target app and write .shesha/ground-truth.json',
  explain: 'Look up a symptom, rule or component — replaces reading documents',
  check: 'Run the offline gate chain over a form markup file',
  preview: 'Render a mirror-kit JSX spec to mock.png                           [Phase 3]',
  compile: 'Compile a mirror-kit JSX spec to Shesha form JSON                 [Phase 4]',
  push: 'Push a form and verify it by re-fetch diff                        [Phase 5]',
  render: 'Render a live form and run the rendered gates                     [Phase 6]',
  fidelity: 'Compare the approved mock render against the Shesha render        [Phase 7]',
  smoke: 'Post-push binding smoke test                                      [Phase 6]',
  ledger: 'Read or repair the persistence ledger                             [Phase 5]',
  build: 'Supervised multi-screen build from a manifest                     [Phase 11]',
};

/** Minimal, dependency-free flag parser. Supports --k v, --k=v and boolean --k. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[a.slice(2)] = true;
        } else {
          flags[a.slice(2)] = next;
          i += 1;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function topHelp() {
  const rows = Object.entries(SUBCOMMANDS)
    .map(([k, v]) => `  ${k.padEnd(9)} ${v}`)
    .join('\n');
  return `shesha — Shesha 0.45 form toolchain

Usage: node shesha.mjs <subcommand> [options]
       node shesha.mjs <subcommand> --help

Subcommands:
${rows}

Exit codes:
  0 ok · 1 gate failure · 2 not 0.45 · 3 backend down · 4 no match
  20 harness failed · 64 usage error · 70 not implemented in this phase
`;
}

const PROBE_HELP = `shesha probe — derive ground truth from the target app's own installed framework

Usage:
  node shesha.mjs probe --app <path> [--backend <url>] [--output <file>] [options]

What it does:
  Bundles the target app's OWN @shesha-io/reactjs for the browser, renders a bare React
  tree that calls the exported useFormDesignerComponents() hook, and serialises the
  toolbox registry — component types, names, container slots, settings property surface,
  dataTypeSupported truth table, and the latest migration version derived from each
  component's own migrator chain. Then, if a backend is reachable, adds the live half:
  modules, entities, per-entity metadata, reference lists (with item colours) and the
  app theme setting.

  Writes <app>/.shesha/ground-truth.json, plus <app>/.shesha/.gitignore containing "*"
  so the derived artefacts are never committed.

Options:
  --app <path>        Shesha app root (containing adminportal/) or the adminportal itself.  REQUIRED
  --backend <url>     Backend base URL. Default: ${DEFAULT_BACKEND}
                      Pass --no-backend to derive the framework half only.
  --no-backend        Skip the live half entirely. Exits 0 without contacting a server.
  --user <name>       Backend username. Default: \$SHESHA_USER or "admin".
  --password <pass>   Backend password. Default: \$SHESHA_PASSWORD or the Shesha dev seed.
  --max-entities <n>  Probe metadata for only the first n entities (faster smoke runs).
  --output <file>     Also write the full artefact here.
  --no-cache          Rebuild the harness bundle instead of reusing the cached one.
                      The cache is keyed on the installed framework version + the sha256
                      of its dist entry + the harness source + the esbuild version, so a
                      stale bundle is unreachable by construction; use this only to
                      measure a cold build.
  --keep-harness      Leave the transient esbuild bundle on disk for debugging.
  --verbose           Print esbuild output and per-entity progress to stderr.
  --emit-kit          [Phase 3] generate the mirror kit. Not implemented yet.
  --emit-fingerprint  [Phase 6] capture the vanilla fingerprint. Not implemented yet.

Exit codes:
  0   ground truth written (framework half always; live half when reachable)
  2   the target app is not Shesha 0.45
  3   backend unreachable or auth refused — the framework half is still written
  20  the harness failed to build or evaluate
  64  usage error
`;

async function cmdProbe(flags) {
  if (flags.help) {
    process.stdout.write(PROBE_HELP);
    return EXIT.OK;
  }
  if (!flags.app || flags.app === true) {
    process.stderr.write('probe: --app <path> is required.\n\n' + PROBE_HELP);
    return EXIT.USAGE;
  }
  for (const [flag, phase] of [['emit-kit', 3], ['emit-fingerprint', 6]]) {
    if (flags[flag]) {
      process.stderr.write(
        `probe: --${flag} is not implemented until Phase ${phase}. ` +
          `Refusing to pretend it ran.\n`
      );
      return EXIT.UNIMPLEMENTED;
    }
  }

  const verbose = !!flags.verbose;
  const log = (m) => verbose && process.stderr.write(`  ${m}\n`);
  const started = Date.now();

  // ---- resolve + assert generation before doing any expensive work -------------
  let paths;
  try {
    paths = resolveAppPaths(flags.app);
  } catch (e) {
    process.stderr.write(`probe: ${e.message}\n`);
    return e.exitCode || EXIT.NOT_045;
  }
  const shesha = join(paths.appRoot, '.shesha');
  mkdirSync(shesha, { recursive: true });
  // Hard constraint 5: nothing generated is ever committed. The target app's own
  // .gitignore does not cover .shesha/, so the directory ignores itself.
  writeFileSync(
    join(shesha, '.gitignore'),
    '# Generated by the shesha-frontend-forms toolchain. Never commit.\n*\n',
    'utf8'
  );

  // ---- the live half first, when wanted, because it supplies the sampling grid --
  const wantBackend = !flags['no-backend'];
  const backendUrl = typeof flags.backend === 'string' ? flags.backend : DEFAULT_BACKEND;
  let backend = null;
  let backendError = null;

  if (wantBackend) {
    process.stderr.write(`probe: reading live backend at ${backendUrl}\n`);
    try {
      backend = await deriveBackendTruth(backendUrl, {
        cacheDir: shesha,
        user: typeof flags.user === 'string' ? flags.user : undefined,
        password: typeof flags.password === 'string' ? flags.password : undefined,
        maxEntities: Number(flags['max-entities']) || 0,
        onProgress: log,
      });
      process.stderr.write(
        `probe: backend ok — ${backend.entitiesTotal} entities, ` +
          `${Object.keys(backend.referenceLists).length} reference lists, ` +
          `${backend.dataTypeGrid.length} dataType pairs\n`
      );
    } catch (e) {
      if (!(e instanceof BackendError)) throw e;
      backendError = e.message;
      process.stderr.write(`probe: backend UNAVAILABLE — ${e.message}\n`);
      process.stderr.write('probe: continuing with the framework half only.\n');
    }
  } else {
    process.stderr.write('probe: --no-backend, skipping the live half\n');
  }

  // ---- the framework half ------------------------------------------------------
  process.stderr.write(`probe: deriving framework truth from ${paths.adminportal}\n`);
  let framework;
  try {
    framework = await deriveFrameworkTruth(paths.appRoot, {
      grid: backend ? backend.dataTypeGrid : undefined,
      keepHarness: !!flags['keep-harness'],
      cache: !flags['no-cache'],
      verbose,
    });
  } catch (e) {
    if (!(e instanceof FrameworkError)) throw e;
    process.stderr.write(`probe: ${e.message}\n`);
    return e.exitCode || EXIT.HARNESS;
  }

  const registry = framework.probed.registry;
  const types = Object.keys(registry).sort();
  const noMigrator = types.filter((t) => registry[t].lastVersion === null);

  const groundTruth = {
    $schema: 'shesha-frontend-forms/ground-truth/1',
    generatedAt: new Date().toISOString(),
    derivedBy: 'browser harness over the app\'s own @shesha-io/reactjs (useFormDesignerComponents)',
    app: { root: paths.appRoot, adminportal: paths.adminportal },
    framework: framework.identity,
    peers: framework.peers,
    react: framework.probed.react,
    registry,
    registrySummary: {
      types: types.length,
      devOnly: framework.probed.devOnlyTypes,
      withoutMigrator: noMigrator,
      containersByType: Object.fromEntries(
        types
          .filter((t) => registry[t].customContainerNames)
          .map((t) => [t, registry[t].customContainerNames])
      ),
      versions: Object.fromEntries(types.map((t) => [t, registry[t].lastVersion])),
    },
    backend: backend || { reachable: false, error: backendError, backend: wantBackend ? backendUrl : null },
    // Facts that could NOT be derived by execution. This list is the honest roadmap;
    // it must never be quietly padded with prose.
    gaps: [
      {
        id: 'defaultStyles',
        what: 'per-component default style objects',
        why:
          'getDefaultStyles() does not exist in 0.45 and defaultStyles is not a member of ' +
          'IToolboxComponent — it is a separate per-component module export ' +
          '(designer-components/<x>/util.d.ts) that is not reachable from the package root.',
        blocks: 'Phase 3 (mirror-kit appearance defaults)',
      },
      {
        id: 'formSettingsVersion',
        what: 'the latest formSettings migration version',
        why:
          'migrateFormSettings is not a runtime export, so the form-settings chain cannot ' +
          'be walked with the same recorder trick used for components.',
        blocks: 'Phase 4 (what to stamp on formSettings.version)',
      },
      {
        id: 'componentGroup',
        what: 'which toolbox group each component belongs to',
        why:
          'IToolboxComponent has no `group` member — grouping lives on IToolboxComponentGroup, ' +
          'and neither getToolboxComponents nor useFormDesignerComponentGroups is a runtime ' +
          'export. useFormDesignerComponents flattens groups away before we can see them.',
        blocks: 'nothing in v1.0 — recorded because the brief expected `group` to be derivable',
      },
    ],
    // Findings that are only visible by executing the framework, and that contradict a
    // reasonable reading of the source. Data, not prose: `explain` will serve these.
    observations: [
      {
        id: 'devMode-does-not-gate-the-dictionary',
        finding:
          'The resolved component dictionary is identical with isDevMode false and true ' +
          `(${framework.probed.counts.prod} vs ${framework.probed.counts.dev} types).`,
        why:
          'getToolboxComponents sets `visible: devMode` on the "Dev" GROUP, and ' +
          'toolbarGroupsToComponents flattens every group without consulting group.visible. ' +
          'So dev mode affects the designer palette UI only — the renderer and the upgrade ' +
          'path resolve Dev-group components regardless.',
        consequence:
          'A compiler may emit any registered type and it will resolve, including types a ' +
          'user could never drag from the toolbox in production.',
      },
      {
        id: 'dataTypeSupported-mostly-ignores-dataFormat',
        finding:
          'Most components matching on dataType accept ANY dataFormat — e.g. checkbox ' +
          'reports support for boolean:emailAddress. Only textField, textArea, slider and ' +
          'passwordCombo actually discriminate on format.',
        consequence:
          'dataTypeSupported returns MULTIPLE candidate components per property, so it is a ' +
          'filter, not a selector. Phase 4 needs an explicit tie-break; using the first match ' +
          'would be arbitrary.',
      },
    ],
    harnessWarnings: framework.harnessWarnings,
    diagnostics: framework.probed.diagnostics,
    // Split out because Phase 3's `preview` shares the bundle path and has a sub-10s
    // budget. bundleMs on a cache hit is the number that budget actually depends on.
    timing: framework.timing,
    elapsedMs: Date.now() - started,
  };

  const outPath = join(shesha, 'ground-truth.json');
  writeFileSync(outPath, JSON.stringify(groundTruth, null, 2) + '\n', 'utf8');
  if (typeof flags.output === 'string') {
    writeFileSync(resolve(flags.output), JSON.stringify(groundTruth, null, 2) + '\n', 'utf8');
  }

  // Bounded stdout: the summary, plus where the full artefact lives.
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        groundTruth: outPath,
        framework: { version: framework.identity.version, react: framework.probed.react },
        registry: {
          types: types.length,
          withoutMigrator: noMigrator.length,
          devOnly: framework.probed.devOnlyTypes.length,
        },
        backend: backend
          ? {
              reachable: true,
              url: backendUrl,
              entities: backend.entitiesTotal,
              entitiesProbed: backend.entitiesProbed,
              referenceLists: Object.keys(backend.referenceLists).length,
              dataTypePairs: backend.dataTypeGrid.length,
              themeKeys: backend.themeTopLevelKeys,
              notes: backend.notes,
            }
          : { reachable: false, url: wantBackend ? backendUrl : null },
        gaps: groundTruth.gaps.map((g) => g.id),
        timing: framework.timing,
        elapsedMs: groundTruth.elapsedMs,
      },
      null,
      2
    ) + '\n'
  );

  // The framework half succeeded, so the artefact exists either way; a missing live half
  // is still reported as exit 3 so callers cannot mistake it for a complete probe.
  if (wantBackend && !backend) return EXIT.BACKEND;
  return EXIT.OK;
}

const EXPLAIN_HELP = `shesha explain — look something up instead of reading a document

Usage:
  node shesha.mjs explain --symptom "<text>"      what you are seeing, in your own words
  node shesha.mjs explain --rule R-0xx            one rule: statement, disposition, validator
  node shesha.mjs explain --component <type>      what this app's framework says about a type
  node shesha.mjs explain --manifest [--write]    the rule triage table (regenerates MANIFEST.md)
  node shesha.mjs explain --rules                 every rule id with its disposition

This exists so that diagnosing a failure is a query, not a document read. The catalogue is
symptom-first because that is the only thing you actually have when a form misbehaves.

Options:
  --app <path>   include facts derived from this app's ground-truth.json (needed by --component)
  --json         machine-readable output

Exit codes:
  0 a match was found · 4 no match · 64 usage error
`;

function loadSymptoms() {
  const p = join(SKILL_ROOT, 'assets', 'symptoms.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')).symptoms || [];
  } catch {
    return [];
  }
}

function loadGroundTruth(appPath) {
  if (!appPath || appPath === true) return null;
  const p = join(resolve(appPath), '.shesha', 'ground-truth.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Token-overlap scoring. Deliberately dumb and dependency-free; ranking beats precision here. */
function scoreSymptom(entry, queryTokens) {
  const haystack = `${entry.symptom} ${(entry.tags || []).join(' ')} ${(entry.causes || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (!t) continue;
    if ((entry.tags || []).some((tag) => tag.toLowerCase().includes(t))) score += 3;
    else if (entry.symptom.toLowerCase().includes(t)) score += 2;
    else if (haystack.includes(t)) score += 1;
  }
  return score;
}

async function cmdExplain(flags) {
  if (flags.help || Object.keys(flags).length === 0) {
    process.stdout.write(EXPLAIN_HELP);
    return flags.help ? EXIT.OK : EXIT.USAGE;
  }
  const asJson = !!flags.json;
  const emit = (obj, text) => {
    process.stdout.write(asJson ? JSON.stringify(obj, null, 2) + '\n' : text);
  };

  // ---- --manifest -------------------------------------------------------------
  if (flags.manifest) {
    const md = renderManifest();
    if (flags.write) {
      const out = join(SKILL_ROOT, 'scripts', 'rules', 'MANIFEST.md');
      writeFileSync(out, md, 'utf8');
      process.stderr.write(`wrote ${out}\n`);
    }
    process.stdout.write(md);
    return EXIT.OK;
  }

  // ---- --rules ----------------------------------------------------------------
  if (flags.rules) {
    const rows = [...TRIAGE].sort((a, b) => a.id.localeCompare(b.id));
    emit(
      rows,
      rows.map((t) => `${t.id}  ${t.disposition.padEnd(12)} ${t.group.padEnd(11)} ${t.reason || t.note || ''}`).join('\n') + '\n'
    );
    return EXIT.OK;
  }

  // ---- --rule R-0xx -----------------------------------------------------------
  if (typeof flags.rule === 'string') {
    const id = flags.rule.toUpperCase().startsWith('R-') ? flags.rule.toUpperCase() : `R-${flags.rule.padStart(3, '0')}`;
    const row = TRIAGE.find((t) => t.id === id);
    if (!row) {
      process.stderr.write(`explain: no rule "${id}". Try --rules for the full list.\n`);
      return EXIT.NO_MATCH;
    }
    const impl = loadRules().find((r) => r.id === id);
    const symptoms = loadSymptoms().filter((s) => (s.ruleIds || []).includes(id));
    const payload = {
      id,
      group: row.group,
      disposition: row.disposition,
      severity: impl?.severity ?? null,
      statement: impl?.statement ?? null,
      note: row.note ?? null,
      reason: row.reason ?? null,
      movedTo: row.movedTo ?? null,
      validator: impl ? `scripts/rules/${row.group === 'process' ? 'structure' : row.group}.mjs` : null,
      relatedSymptoms: symptoms.map((s) => ({ id: s.id, symptom: s.symptom })),
    };
    let text = `${id}  [${row.group}/${payload.severity ?? row.disposition}]  disposition: ${row.disposition}\n\n`;
    if (payload.statement) text += `${payload.statement}\n\n`;
    if (row.reason) text += `STALE — ${row.reason}\n`;
    if (row.movedTo) text += `moved to: ${row.movedTo}\n`;
    if (row.note) text += `note: ${row.note}\n`;
    if (payload.validator) text += `validator: ${payload.validator}\n`;
    if (symptoms.length) {
      text += `\nrelated symptoms:\n` + symptoms.map((s) => `  ${s.id}  ${s.symptom}`).join('\n') + '\n';
    }
    emit(payload, text);
    return EXIT.OK;
  }

  // ---- --component <type> -----------------------------------------------------
  if (typeof flags.component === 'string') {
    const gt = loadGroundTruth(flags.app);
    if (!gt) {
      process.stderr.write(
        'explain --component needs derived ground truth. Run:\n' +
          '  node shesha.mjs probe --app <path>\n' +
          'then pass the same --app here.\n'
      );
      return EXIT.NO_MATCH;
    }
    const type = flags.component;
    const def = gt.registry[type];
    if (!def) {
      const near = Object.keys(gt.registry)
        .filter((t) => t.toLowerCase().includes(type.toLowerCase()))
        .slice(0, 10);
      process.stderr.write(
        `explain: "${type}" is not a registered component type in this app.\n` +
          (near.length ? `did you mean: ${near.join(', ')}\n` : '')
      );
      return EXIT.NO_MATCH;
    }
    let text = `${def.type}  "${def.name}"\n`;
    text += `  version        ${def.lastVersion === null ? 'none (no migrator)' : def.lastVersion}`;
    if (def.lastVersion !== null) text += `  (chain of ${def.migrationVersions.length})`;
    text += '\n';
    text += `  isInput        ${def.isInput}\n`;
    text += `  containers     ${def.customContainerNames ? def.customContainerNames.join(', ') : '(none — not a container)'}\n`;
    if (def.dataTypeSupported) text += `  binds          ${def.dataTypeSupported.join(', ')}\n`;
    text += `  settings props ${def.settings.propertyNames.length}${def.settings.source === 'absent' ? ' (no settings markup)' : ''}\n`;
    if (def.settings.propertyNames.length) {
      text += `                 ${def.settings.propertyNames.slice(0, 24).join(' ')}\n`;
    }
    text += `  framework      ${gt.framework.version} (derived ${gt.generatedAt})\n`;
    emit(def, text);
    return EXIT.OK;
  }

  // ---- --symptom "<text>" -----------------------------------------------------
  if (typeof flags.symptom === 'string') {
    const q = flags.symptom.toLowerCase();
    const tokens = q.split(/[^a-z0-9.]+/).filter((t) => t.length > 2);
    const scored = loadSymptoms()
      .map((s) => ({ s, score: scoreSymptom(s, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (!scored.length) {
      process.stderr.write(
        `explain: nothing in the catalogue matches "${flags.symptom}".\n` +
          'This is a knowledge-base miss, which is a gap to report — not a cue to go read the\n' +
          'compiled @shesha-io bundle. Try fewer, more distinctive words first.\n'
      );
      return EXIT.NO_MATCH;
    }

    let text = '';
    for (const { s, score } of scored) {
      text += `${s.id}  (match ${score})  ${s.symptom}\n`;
      for (const c of s.causes || []) text += `  cause: ${c}\n`;
      text += `  fix:   ${s.fix}\n`;
      if (s.note) text += `  note:  ${s.note}\n`;
      if ((s.ruleIds || []).length) text += `  rules: ${s.ruleIds.join(', ')}\n`;
      text += '\n';
    }
    emit(scored.map((x) => x.s), text);
    return EXIT.OK;
  }

  process.stderr.write(EXPLAIN_HELP);
  return EXIT.USAGE;
}

const CHECK_HELP = `shesha check — the offline gate chain over a form markup file

Usage:
  node shesha.mjs check --file <f.json> [--app <path>] [options]

Five gates, in order, ALL of them run:
  1 structural    is this a form? required formSettings, ids, types, deprecated fields
  2 round-trip    the framework's OWN componentsTreeToFlatStructure -> upgradeComponents
                  -> componentsFlatStructureToTree, diffed against the input. Needs --app
                  because those functions require a toolbox dictionary only reachable in a
                  browser render.
  3 rules         the 41 enforceable validators (see \`explain --manifest\`)
  4 bindings      every bound propertyName against live metadata; LOUD when metadata is
                  absent, because a binding check that did not run looks like one that passed
  5 dead-channel  narrow, derived: a style channel the component's own settings form does
                  not expose

Every failure is reported together. This command does NOT judge whether the form looks
styled — that is a rendered gate in Phase 6. A pass here means "structurally sound and
correctly wired", never "looks right".

Options:
  --file <f>       the markup file to check.  REQUIRED
                   Accepts raw {formSettings, components}, an UpdateMarkup wrapper with a
                   stringified \`markup\` blob, or an ABP {result} envelope.
  --app <path>     the Shesha app, for the derived registry and the round-trip gate
  --form <m>/<n>   the form's module/name, used by rules that key off the form name (R-022)
  --baseline <f>   a previously fetched version, to enforce id preservation (R-025)
  --fast           skip the round-trip gate (no browser). Use in hooks where 5s per write
                   matters; \`push\` always runs the full chain.
  --json           machine-readable report
  --output <f>     write the full report here

Exit codes:
  0 no failures (warnings may still be present) · 1 one or more failures · 64 usage error
`;

/** Resolve the check context from derived ground truth, when available. */
function buildCheckContext(gt, markup, flags) {
  const ctx = {};
  if (gt) {
    ctx.registry = gt.registry;
    if (gt.backend && gt.backend.reachable) {
      ctx.referenceLists = gt.backend.referenceLists;
      ctx.metadata = gt.backend.metadata;

      // Resolve the form's model to its property list. modelType is either the
      // {name, module} object 0.45 expects or a fullClassName string (which the shipped
      // PBF form uses), so both shapes have to resolve.
      const mt = markup?.formSettings?.modelType;
      let fullClassName = null;
      if (typeof mt === 'string') fullClassName = mt;
      else if (mt && mt.name) {
        const hit = (gt.backend.entities || []).find(
          (e) => e.name === mt.name && (!mt.module || e.module === mt.module)
        );
        fullClassName = hit ? hit.fullClassName : null;
      }
      if (fullClassName && gt.backend.metadata[fullClassName]) {
        ctx.modelTypeName = fullClassName;
        ctx.modelProperties = gt.backend.metadata[fullClassName].properties;
      } else if (fullClassName) {
        ctx.modelTypeName = fullClassName;
      }
    }
  }
  if (typeof flags.form === 'string' && flags.form.includes('/')) {
    const [mod, name] = flags.form.split('/');
    ctx.formModule = mod;
    ctx.formName = name;
  } else if (typeof flags.file === 'string') {
    ctx.formName = flags.file.split(/[\\/]/).pop().replace(/\.json$/i, '');
  }
  if (typeof flags.baseline === 'string') {
    const { doc } = normaliseMarkup(JSON.parse(readFileSync(resolve(flags.baseline), 'utf8')));
    if (doc) ctx.baseline = doc;
  }
  return ctx;
}

function formatReport(report, meta) {
  const lines = [];
  const icon = { fail: 'FAIL', warn: 'warn' };
  lines.push(`check ${meta.file}`);
  if (meta.notes.length) for (const n of meta.notes) lines.push(`  (${n})`);
  lines.push('');

  const order = ['structural', 'round-trip', 'rules', 'bindings', 'dead-channel'];
  for (const gate of order) {
    const vs = report.violations.filter((v) => v.gate === gate);
    const fails = vs.filter((v) => v.severity === 'fail').length;
    const warns = vs.length - fails;
    const status = fails > 0 ? 'FAIL' : warns > 0 ? 'warn' : ' ok ';
    lines.push(`[${status}] ${gate}${vs.length ? `  (${fails} fail, ${warns} warn)` : ''}`);
    for (const v of vs) {
      lines.push(`   ${icon[v.severity]}${v.ruleId ? ` ${v.ruleId}` : ''}  ${v.message}`);
      if (v.fixPointer) lines.push(`         at ${v.fixPointer}`);
    }
  }

  lines.push('');
  lines.push(`${report.counts.failures} failure(s), ${report.counts.warnings} warning(s); ${report.rulesRan.length} rules ran, ${report.rulesSkipped.length} skipped`);
  if (report.rulesSkipped.length) {
    lines.push('skipped rules (each with a reason, so nothing passes silently):');
    for (const s of report.rulesSkipped) lines.push(`   ${s.ruleId}  ${s.reason}`);
  }
  lines.push('');
  lines.push('NOT checked here:');
  for (const n of report.notChecked) lines.push(`   - ${n}`);
  return lines.join('\n') + '\n';
}

async function cmdCheck(flags) {
  if (flags.help) {
    process.stdout.write(CHECK_HELP);
    return EXIT.OK;
  }
  if (!flags.file || flags.file === true) {
    process.stderr.write('check: --file <f.json> is required.\n\n' + CHECK_HELP);
    return EXIT.USAGE;
  }
  const filePath = resolve(flags.file);
  if (!existsSync(filePath)) {
    process.stderr.write(`check: no such file: ${filePath}\n`);
    return EXIT.USAGE;
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    process.stderr.write(`check: cannot read ${filePath}: ${(e && e.message) || e}\n`);
    return EXIT.USAGE;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    process.stderr.write(`check: ${filePath} is not valid JSON: ${(e && e.message) || e}\n`);
    return EXIT.GATE;
  }

  const { doc: markup, notes, error } = normaliseMarkup(parsed);
  if (error || !markup) {
    process.stderr.write(`check: ${filePath} is not a form markup document — ${error}\n`);
    return EXIT.GATE;
  }

  const gt = loadGroundTruth(flags.app);
  if (flags.app && !gt) {
    process.stderr.write(
      `check: no ground truth at ${join(resolve(flags.app), '.shesha', 'ground-truth.json')}\n` +
        '       run `probe --app <path>` first; continuing without the registry.\n'
    );
  }
  const ctx = buildCheckContext(gt, markup, flags);

  // Gate 2 needs the framework itself. Without --app, or with --fast, it degrades to a
  // warning rather than silently passing.
  let roundTripResult = null;
  if (!flags.app) {
    roundTripResult = { skipReason: 'no --app supplied' };
  } else if (flags.fast) {
    roundTripResult = { skipReason: '--fast was passed' };
  } else {
    try {
      const rt = await runRoundTrip(flags.app, markup, { verbose: !!flags.verbose });
      roundTripResult = rt.result;
    } catch (e) {
      roundTripResult = { error: (e && e.message) || String(e) };
    }
  }

  const report = runGates(markup, ctx, roundTripResult);
  const meta = { file: filePath, notes };

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...report, file: filePath, notes }, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(report, meta));
  }
  if (typeof flags.output === 'string') {
    writeFileSync(resolve(flags.output), JSON.stringify({ ...report, file: filePath, notes }, null, 2) + '\n', 'utf8');
  }

  return report.ok ? EXIT.OK : EXIT.GATE;
}

function unimplemented(name, phase) {
  return async (flags) => {
    const help = `shesha ${name} — ${SUBCOMMANDS[name]}\n\nNot implemented until Phase ${phase}.\n`;
    if (flags.help) {
      process.stdout.write(help);
      return EXIT.OK;
    }
    process.stderr.write(help);
    return EXIT.UNIMPLEMENTED;
  };
}

const HANDLERS = {
  probe: cmdProbe,
  explain: cmdExplain,
  check: cmdCheck,
  preview: unimplemented('preview', 3),
  compile: unimplemented('compile', 4),
  push: unimplemented('push', 5),
  render: unimplemented('render', 6),
  fidelity: unimplemented('fidelity', 7),
  smoke: unimplemented('smoke', 6),
  ledger: unimplemented('ledger', 5),
  build: unimplemented('build', 11),
};

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const sub = positional[0];

  if (!sub || flags.help === true && !sub) {
    process.stdout.write(topHelp());
    return sub ? EXIT.OK : EXIT.USAGE;
  }
  if (sub === 'help') {
    process.stdout.write(topHelp());
    return EXIT.OK;
  }
  const handler = HANDLERS[sub];
  if (!handler) {
    process.stderr.write(`Unknown subcommand "${sub}".\n\n${topHelp()}`);
    return EXIT.USAGE;
  }
  return handler(flags);
}

main()
  .then((code) => process.exit(code ?? EXIT.OK))
  .catch((e) => {
    // Never swallow an unexpected failure. Make it loud, with the stack.
    process.stderr.write(`shesha: unhandled error\n${(e && e.stack) || e}\n`);
    process.exit(1);
  });
