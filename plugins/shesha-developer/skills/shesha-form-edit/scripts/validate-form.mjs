#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tier1 } from './lib/tier1.mjs';
import { tier2 } from './lib/tier2.mjs';
import { tier3 } from './lib/tier3.mjs';
import { loadFlow } from './lib/flow.mjs';

// ---------------------------------------------------------------------------
// validate-form.mjs — the oracle's CLI face.
//
// Combines Tier 1 (renderability), Tier 2 (construction contract) and
// Tier 3 (appearance, observe-only) into one exit code. THE RULE THAT
// MATTERS MOST: only Tier 1 and Tier 2 findings (never T2-SKIPPED, never
// Tier 3) can make this process exit non-zero. Tier 3's score is reported
// for a human to read, never enforced — see scripts/lib/tier3.mjs for why.
//
// All default asset paths are resolved relative to THIS FILE, not the
// caller's cwd, so `node .../validate-form.mjs some/form.json` works
// identically no matter where it's invoked from.
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(SCRIPT_DIR);

const DEFAULT_REGISTRY = join(SKILL_ROOT, 'assets/registry/registry-0.45.1.json');
const DEFAULT_ROLES = join(SKILL_ROOT, '../shesha-design-system/assets/roles.styles.json');
const DEFAULT_FLOWS_DIR = join(SKILL_ROOT, 'assets/archetypes');
const DEFAULT_THRESHOLDS = join(SKILL_ROOT, 'assets/thresholds.json');

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`Could not read ${label} at "${path}" — ${err.code === 'ENOENT' ? 'file not found' : err.message}.`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Could not parse ${label} at "${path}" as JSON — ${err.message}.`);
  }
}

function parseArgs(argv) {
  const opts = { _: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--registry': opts.registry = argv[++i]; break;
      case '--roles': opts.roles = argv[++i]; break;
      case '--flows': opts.flows = argv[++i]; break;
      case '--archetype': opts.archetype = argv[++i]; break;
      case '--known-forms': opts.knownForms = argv[++i]; break;
      case '--json': opts.json = true; break;
      default: opts._.push(a);
    }
  }
  return opts;
}

function printTier(title, findings) {
  console.log(`${title}: ${findings.length} finding(s)`);
  for (const f of findings) {
    console.log(`  [${f.code}] ${f.path}`);
    console.log(`    ${f.message}`);
  }
  console.log();
}

function printHuman({ formPath, t1, t2, skipped, t3, exitCode }) {
  console.log(`Validating ${formPath}`);
  console.log();
  printTier('Tier 1 — renderability', t1);
  printTier('Tier 2 — construction contract', t2);

  if (skipped.length) {
    console.log(`Tier 2 — skipped (${skipped.length}, needs more input to run):`);
    for (const f of skipped) console.log(`  - ${f.message}`);
    console.log();
  }

  const calibrationNote = t3.uncalibrated ? ' [UNCALIBRATED — provisional thresholds, see assets/thresholds.json]' : '';
  console.log(`Tier 3 — appearance (observe-only, never blocks): score ${t3.score}/100${calibrationNote}`);
  for (const f of t3.findings) {
    console.log(`  [${f.code}] ${f.path}`);
    console.log(`    ${f.message}`);
  }
  console.log();

  const verdict = exitCode === 0
    ? 'PASS (exit 0) — no Tier 1/2 findings. Tier 3 score above is informational only and never affects this verdict.'
    : `FAIL (exit 1) — ${t1.length} Tier 1 and ${t2.length} Tier 2 finding(s) must be resolved.`;
  console.log(verdict);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const formPath = opts._[0];
  if (!formPath) {
    fail('Usage: node validate-form.mjs <form.json> [--registry p] [--roles p] [--flows dir] [--archetype a] [--known-forms p] [--json]');
  }

  const registryPath = opts.registry ?? DEFAULT_REGISTRY;
  const rolesPath = opts.roles ?? DEFAULT_ROLES;
  const flowsDir = opts.flows ?? DEFAULT_FLOWS_DIR;

  const registry = readJson(registryPath, 'registry');
  const roles = existsSync(rolesPath) ? readJson(rolesPath, 'roles') : {};
  const thresholds = existsSync(DEFAULT_THRESHOLDS) ? readJson(DEFAULT_THRESHOLDS, 'thresholds') : { calibrated: false };

  let flows;
  if (opts.archetype) {
    flows = {};
    if (existsSync(join(flowsDir, `${opts.archetype}.flow.json`))) {
      flows[opts.archetype] = loadFlow(opts.archetype, { dir: flowsDir });
    }
    // If the manifest isn't found, `flows` stays without that key — tier2
    // reports T2-SKIPPED with a "not found in the supplied flows catalogue"
    // reason rather than this CLI guessing or crashing.
  }

  let knownForms;
  if (opts.knownForms) {
    knownForms = readJson(opts.knownForms, 'known-forms list');
  }

  if (!existsSync(formPath)) {
    fail(`Form file not found: "${formPath}".`);
  }
  const markup = readJson(formPath, 'form');

  const t1 = tier1(markup, { registry });
  const t2Raw = tier2(markup, { registry, roles, flows, archetype: opts.archetype, knownForms });
  const t2 = t2Raw.filter((f) => f.severity !== 'skip');
  const skipped = t2Raw.filter((f) => f.severity === 'skip');
  const t3 = tier3(markup, { registry, thresholds });

  const exitCode = (t1.length === 0 && t2.length === 0) ? 0 : 1;

  if (opts.json) {
    console.log(JSON.stringify({ exitCode, tier1: t1, tier2: t2, tier3: t3, skipped }, null, 2));
  } else {
    printHuman({ formPath, t1, t2, skipped, t3, exitCode });
  }

  process.exit(exitCode);
}

try {
  main();
} catch (err) {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(`Error: ${err && err.message ? err.message : String(err)}`);
  }
  process.exit(1);
}
