#!/usr/bin/env node
/**
 * Generate the Shesha component registry from framework source.
 *
 * Usage:
 *   node scripts/gen-registry.mjs --framework <path-to-shesha-framework> [--version 0.45.1]
 *   SHESHA_FRAMEWORK_PATH=... node scripts/gen-registry.mjs
 *
 * Copies the Jest harness into <framework>/shesha-reactjs/.shesha-registry-gen/,
 * runs it, post-processes the raw extraction, writes the registry, and removes
 * the scratch directory. The framework repo is never left modified.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postprocess } from './lib/postprocess.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');
const SCRATCH_DIR_NAME = '.shesha-registry-gen';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(`gen-registry: ${message}`);
  process.exit(1);
}

/** Read the framework's branch and commit so the registry records its provenance. */
function gitInfo(repoPath) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    sourceBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sourceCommit: git(['rev-parse', '--short', 'HEAD']),
  };
}

const frameworkPath = resolve(
  arg('--framework', process.env.SHESHA_FRAMEWORK_PATH ?? ''),
);
if (!frameworkPath || !existsSync(frameworkPath)) {
  fail('pass --framework <path> or set SHESHA_FRAMEWORK_PATH to the shesha-framework checkout');
}

const reactjsPath = join(frameworkPath, 'shesha-reactjs');
if (!existsSync(join(reactjsPath, 'package.json'))) {
  fail(`no shesha-reactjs package at ${reactjsPath}`);
}
if (!existsSync(join(reactjsPath, 'node_modules'))) {
  fail(`${reactjsPath}/node_modules is missing — run npm install there first`);
}

const scratch = join(reactjsPath, SCRATCH_DIR_NAME);
const rawOut = join(scratch, 'raw-extraction.json');

try {
  rmSync(scratch, { recursive: true, force: true });
  cpSync(join(HERE, 'harness'), scratch, { recursive: true });

  console.log('gen-registry: extracting from framework source (this takes ~60s)…');
  execFileSync(
    'npx',
    ['jest', '--config', join(SCRATCH_DIR_NAME, 'jest.config.cjs'), '--runTestsByPath',
     join(SCRATCH_DIR_NAME, 'extract.test.ts')],
    {
      cwd: reactjsPath,
      stdio: 'inherit',
      env: { ...process.env, SHESHA_REGISTRY_OUT: rawOut },
      shell: process.platform === 'win32',
    },
  );

  if (!existsSync(rawOut)) fail('the harness produced no output file');

  const raw = JSON.parse(readFileSync(rawOut, 'utf8'));
  const frameworkVersion = arg('--version', '0.45.1');
  const { registry, stats } = postprocess(raw, { frameworkVersion });

  const outDir = join(SKILL_ROOT, 'assets', 'registry');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, `registry-${frameworkVersion}.json`),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(outDir, 'registry.meta.json'),
    `${JSON.stringify({
      frameworkVersion,
      sourceRepo: 'shesha-io/shesha-framework',
      ...gitInfo(frameworkPath),
      generatedAtUtc: new Date().toISOString(),
      generatorVersion: 1,
      counts: {
        total: stats.total,
        authorable: stats.authorable,
        withoutVersion: stats.withoutVersion,
        withoutProps: stats.withoutProps,
      },
      droppedScaffoldingProps: stats.droppedScaffoldingProps,
      rawSummary: raw.summary ?? null,
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `gen-registry: ${stats.total} components ` +
    `(${stats.authorable} authorable, ${stats.withoutVersion} without version, ` +
    `${stats.withoutProps} without props); dropped ${stats.droppedScaffoldingProps} scaffolding props`,
  );
} finally {
  // Always clean up, including on failure, so the framework repo stays clean.
  rmSync(scratch, { recursive: true, force: true });
}
