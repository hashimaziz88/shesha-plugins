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
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveFrameworkTruth, FrameworkError, resolveAppPaths } from './lib/framework.mjs';
import { BackendError, DEFAULT_BACKEND, deriveBackendTruth } from './lib/api.mjs';

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
  explain: 'Look up a symptom, rule or component in the derived ground truth  [Phase 1]',
  check: 'Run the offline gates over a form markup file                       [Phase 2]',
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
    ],
    harnessWarnings: framework.harnessWarnings,
    diagnostics: framework.probed.diagnostics,
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
  explain: unimplemented('explain', 1),
  check: unimplemented('check', 2),
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
