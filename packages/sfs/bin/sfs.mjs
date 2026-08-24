#!/usr/bin/env node
// The one SFS entrypoint (D-040 conflict 1): `npm run sfs -- <args>`.
// No alias, no shim. This file existing and starting is itself an acceptance
// criterion, because the defect class it answers is a documented command that
// died on every invocation.
//
// Scope A builds the subcommands in WP-5. Until then every verb exits 2 (usage)
// naming the work package that implements it — never 0, because a command that
// silently succeeds while doing nothing is worse than one that refuses.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ajv2020 from 'ajv/dist/2020.js';
import addFormatsMod from 'ajv-formats';
import { SFS_LANGUAGE_VERSION } from '../src/index.mjs';
import { compile } from '../src/compile/index.mjs';
import { roundtrip } from '../src/roundtrip.mjs';

// ajv/dist/2020.js and ajv-formats are CJS; Node unwraps default to the callable.
const Ajv2020 = /** @type {any} */ (/** @type {any} */ (ajv2020).default ?? ajv2020);
const addFormats = /** @type {any} */ (/** @type {any} */ (addFormatsMod).default ?? addFormatsMod);

const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };

/** Subcommand -> the work package that implements it. `null` means it is live now. */
const VERBS = {
  compile: null,
  decompile: 'WP-6',
  roundtrip: null,
  validate: null,
  normalise: 'WP-1',
  push: 'WP-6',
};

/** @param {string[]} args @param {string} flag @returns {string|undefined} */
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `sfs validate --schema <name> --file <path> [--json]` — validate a JSON file against
 * one of the packages/sfs/schema/*.schema.json handoff schemas (§4.10 pt1). Writes
 * nothing. Exit 0 valid · 1 invalid · 2 usage. `--json` prints {ok, diagnostics}.
 * The hooks (validate-sfs-on-write) spawn this; the diagnostics are surfaced verbatim.
 * @param {string[]} args @returns {number}
 */
function runValidate(args) {
  const schemaName = argValue(args, '--schema');
  const file = argValue(args, '--file');
  const asJson = args.includes('--json');
  if (!schemaName || !file || !/^[a-z][a-z0-9-]*$/.test(schemaName)) {
    console.error('sfs validate: --schema <name> --file <path> required');
    return EXIT.usage;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const schemaPath = path.join(root, `packages/sfs/schema/${schemaName}.schema.json`);
  let schema;
  try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8').replace(/^﻿/, '')); } catch {
    console.error(`sfs validate: unknown schema "${schemaName}" (${schemaPath} not found)`);
    return EXIT.usage;
  }
  /** @param {{ok:boolean, diagnostics:string[]}} out @param {number} code */
  const done = (out, code) => {
    if (asJson) console.log(JSON.stringify(out));
    else if (!out.ok) console.error(out.diagnostics.join('\n'));
    return code;
  };
  let data;
  try { data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^﻿/, '')); } catch (e) {
    return done({ ok: false, diagnostics: [`cannot read or parse ${file}: ${(/** @type {Error} */ (e)).message}`] }, EXIT.fail);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = !!validate(data);
  const diagnostics = ok ? [] : (validate.errors || []).map((/** @type {any} */ e) => `${e.instancePath || '/'} ${e.message}`.trim());
  return done({ ok, diagnostics }, ok ? EXIT.pass : EXIT.fail);
}

/**
 * `sfs roundtrip --scope <scope.json>` — decompile the declared corpus subset and
 * assert the clean set matches exactly (§2.5). The measurement lives in
 * packages/sfs/src/roundtrip.mjs; this is the CLI shell.
 * @param {string[]} args
 * @returns {number}
 */
function runRoundtrip(args) {
  const i = args.indexOf('--scope');
  const scopeArg = args[i + 1];
  const scope = i >= 0 && scopeArg ? scopeArg : 'packages/sfs/config/roundtrip-expected.json';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  let result;
  try { result = roundtrip(root, scope); } catch (e) {
    console.error(`sfs roundtrip: ${/** @type {Error} */ (e).message}`);
    return EXIT.fail;
  }
  console.log('=== SFS round-trip over the declared corpus subset ===');
  for (const line of result.lines) console.log(line);
  return result.ok ? EXIT.pass : EXIT.fail;
}

/**
 * The four legal artifact names (D-044). `.compiled.json` is banned: three names for
 * two artifacts had been baked into command lines this session would paste.
 * @param {string} outDir
 * @param {string} form
 * @returns {{form:string, report:string, meta:string}}
 */
function artifactPaths(outDir, form) {
  return {
    form: path.join(outDir, `${form}.form.json`),
    report: path.join(outDir, `${form}.compile.json`),
    meta: path.join(outDir, `${form}.form.meta.json`),
  };
}

/**
 * `sfs compile <input.sfs.json> --out <dir>`.
 *
 * Exits 3 when the compile verdict is partial — an unverifiable binding is never
 * reported as a pass, and the markup is still written because determinism and oracle
 * agreement are properties of the bytes.
 * @param {string[]} args
 * @returns {number}
 */
function runCompile(args) {
  const input = args[1];
  if (input === undefined || input.startsWith('--')) {
    console.error('sfs compile: needs an input path\n  npm run sfs -- compile <input.sfs.json> --out <dir>');
    return EXIT.usage;
  }
  const outAt = args.indexOf('--out');
  const outDir = outAt >= 0 ? args[outAt + 1] : null;
  if (outDir === undefined || outDir === null) {
    console.error('sfs compile: --out <dir> is required; the compiler is the only writer of form markup');
    return EXIT.usage;
  }

  let text;
  try { text = fs.readFileSync(input, 'utf8'); } catch {
    console.error(`sfs compile: cannot read ${input}`);
    return EXIT.fail;
  }

  let result;
  try {
    result = compile(text, { source: input });
  } catch (e) {
    const err = /** @type {{code?:string, message:string}} */ (e);
    console.error(`sfs compile: ${err.message}`);
    console.error('No file was written: output is produced in stage 6 from an in-memory tree, and a stage that raises');
    console.error('halts the pipeline, so a failed compile cannot leave a partial artifact behind.');
    return EXIT.fail;
  }

  const paths = artifactPaths(outDir, String(result.envelope.Name));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(paths.form, `${JSON.stringify(result.envelope, null, 2)}\n`);
  fs.writeFileSync(paths.report, `${JSON.stringify(result.report, null, 2)}\n`);
  fs.writeFileSync(paths.meta, `${JSON.stringify(result.meta, null, 2)}\n`);

  const counts = /** @type {Record<string, number>} */ (result.report.counts);
  console.log(`sfs compile: ${String(result.report.form)} -> ${paths.form}`);
  console.log(`  markup ${String(result.report.markupBytes)} B · sha256 ${String(result.report.markupSha256).slice(0, 12)}`);
  console.log(`  components ${counts.components} · slots ${counts.slots} · items ${counts.items} · ids ${counts.ids} · blocks ${counts.breakpointBlocks}`);
  console.log(`  verdict ${String(result.report.verdict)}`);
  if (result.report.verdict === 'partial') {
    const cov = /** @type {{bindings:{walked:number, reason:string}}} */ (result.report.coverage);
    console.log(`  ${cov.bindings.walked} binding(s) uninspectable — ${cov.bindings.reason}. Exit 3, never pass.`);
    return EXIT.partial;
  }
  return EXIT.pass;
}

const USAGE = `usage: npm run sfs -- <command> [options]

commands
  compile     <input.sfs.json> --out <dir>        compile SFS to a form envelope
  decompile   <input.form.json> --out <file>      recover SFS from an envelope
  roundtrip   --scope <scope.json>               compile(decompile(x)) == x over a corpus
  normalise   <envelope.json>                    apply the legacy normalisation pass
  push        <input.sfs.json> --backend <url>   compile and push (the only write path)

  --version                                      print the SFS language version
  --help                                         this text
`;

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return args.length === 0 ? EXIT.usage : EXIT.pass;
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(SFS_LANGUAGE_VERSION);
    return EXIT.pass;
  }
  const verb = args[0];
  if (verb === undefined) return EXIT.usage;
  if (!(verb in VERBS)) {
    console.error(`sfs: unknown command "${verb}"\n`);
    process.stderr.write(USAGE);
    return EXIT.usage;
  }
  if (verb === 'compile') return runCompile(args);
  if (verb === 'roundtrip') return runRoundtrip(args);
  if (verb === 'validate') return runValidate(args);

  const wp = VERBS[/** @type {keyof typeof VERBS} */ (verb)];
  console.error(`sfs ${verb}: not implemented in this build — ${wp} ships it.`);
  console.error('Exiting 2 (usage) rather than 0: a command that reports success while doing nothing');
  console.error('is the defect this entrypoint exists to make impossible.');
  return EXIT.usage;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exit(main(process.argv));
}
