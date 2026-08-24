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
import { loadRegistry } from '../src/lib/registry.mjs';

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
  run: null,
  registry: null,
  normalise: 'WP-1',
  push: 'WP-6',
};

const RUN_ID_RE = /^[0-9]{8}-[0-9]{4}-[a-z0-9-]{1,40}$/;
const ROLES = ['planner', 'sfs-specwriter', 'sfs-evaluator'];

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

/** The repo root, three levels up from packages/sfs/bin. @returns {string} */
function repoRootFromBin() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * `sfs run <lock|release|new> …` — the run-directory operations the hooks reference
 * in their remediation strings (§4.10 pt12). A lock's identity is (role, screen,
 * runId); there is no session_id. Locks are the fan-out mutex enforce-screen-lock
 * reads; they are data, not markup, so writing them never trips INV 1.
 * @param {string[]} args @returns {number}
 */
function runRun(args) {
  const sub = args[1];
  const root = repoRootFromBin();
  if (sub === 'lock') return runLock(args, root);
  if (sub === 'release') return runRelease(args, root);
  if (sub === 'new') return runNew(args, root);
  console.error('sfs run: <lock|release|new> …\n'
    + '  run lock    --run <id> (--screen <s> | --plan) --role <planner|sfs-specwriter|sfs-evaluator>\n'
    + '  run release --run <id> (--screen <s> | --plan)\n'
    + '  run new     --run <id>');
  return EXIT.usage;
}

/** @param {string[]} args @param {string} root @returns {number} */
function runLock(args, root) {
  const runId = argValue(args, '--run');
  const isPlan = args.includes('--plan');
  const screen = isPlan ? '__plan__' : argValue(args, '--screen');
  const role = argValue(args, '--role') ?? (isPlan ? 'planner' : undefined);
  if (!runId || !RUN_ID_RE.test(runId)) { console.error('sfs run lock: --run <id> must match YYYYMMDD-HHMM-<slug>'); return EXIT.usage; }
  if (typeof screen !== 'string' || (!isPlan && !/^[a-z][a-z0-9-]{0,39}$/.test(screen))) { console.error('sfs run lock: --screen <s> (lowercase) or --plan is required'); return EXIT.usage; }
  if (typeof role !== 'string' || !ROLES.includes(role)) { console.error(`sfs run lock: --role must be one of ${ROLES.join(', ')}`); return EXIT.usage; }
  const dir = path.join(root, 'runs', runId, 'locks');
  fs.mkdirSync(dir, { recursive: true });
  const lock = { lockVersion: '1.0', screen, role, runId, at: new Date().toISOString(), pid: process.pid };
  fs.writeFileSync(path.join(dir, `${screen}.lock`), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`sfs run lock: ${role} holds ${screen} in ${runId}`);
  return EXIT.pass;
}

/** @param {string[]} args @param {string} root @returns {number} */
function runRelease(args, root) {
  const runId = argValue(args, '--run');
  const isPlan = args.includes('--plan');
  const screen = isPlan ? '__plan__' : argValue(args, '--screen');
  if (!runId || !RUN_ID_RE.test(runId)) { console.error('sfs run release: --run <id> is required'); return EXIT.usage; }
  if (typeof screen !== 'string') { console.error('sfs run release: --screen <s> or --plan is required'); return EXIT.usage; }
  const file = path.join(root, 'runs', runId, 'locks', `${screen}.lock`);
  try { fs.unlinkSync(file); } catch { console.error(`sfs run release: no lock on ${screen} in ${runId}`); return EXIT.fail; }
  console.log(`sfs run release: released ${screen} in ${runId}`);
  return EXIT.pass;
}

/** @param {string[]} args @param {string} root @returns {number} */
function runNew(args, root) {
  const runId = argValue(args, '--run');
  if (!runId || !RUN_ID_RE.test(runId)) { console.error('sfs run new: --run <id> must match YYYYMMDD-HHMM-<slug>'); return EXIT.usage; }
  const dir = path.join(root, 'runs', runId);
  fs.mkdirSync(path.join(dir, 'locks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  const manifest = { manifestVersion: '1.0', runId, phase: 'planning', screens: {}, events: [] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(root, '.build', 'active-run'), `${runId}\n`);
  console.log(`sfs run new: created runs/${runId} and set the active run`);
  return EXIT.pass;
}

/**
 * `sfs registry <type> [--json]` — an exact registry lookup (the same answer the
 * mcp `registry_lookup` tool returns; both call loadRegistry, so the CLI carries no
 * dependency on packages/mcp). `sfs registry grammar --out <file>` emits the GBNF.
 * @param {string[]} args @returns {number}
 */
function runRegistry(args) {
  if (args[1] === 'grammar') return runGrammar(args);
  const type = args[1];
  if (type === undefined || type.startsWith('--')) {
    console.error('sfs registry <type> [--json]   |   sfs registry grammar --out <file>');
    return EXIT.usage;
  }
  const asJson = args.includes('--json');
  const reg = loadRegistry();
  const rec = reg.components[type];
  if (!rec) {
    if (asJson) console.log(JSON.stringify({ registryRef: reg.ref, records: [], missing: [type] }));
    else console.error(`sfs registry: "${type}" is not in the registry`);
    return EXIT.fail;
  }
  const out = { registryRef: reg.ref, records: [{ type, version: rec.version, sfsNode: rec.sfsNode, authorable: rec.authorable, isInput: rec.isInput }], missing: [] };
  if (asJson) console.log(JSON.stringify(out));
  else console.log(`${type} v${rec.version} (node ${rec.sfsNode ?? '-'}, authorable ${rec.authorable})`);
  return EXIT.pass;
}

/**
 * `sfs registry grammar --out <file>` — a GBNF grammar for constrained SFS emission on
 * llama.cpp/Ollama. The header states, in the file, that constrained decoding applies
 * only to the emission step, never a reasoning step (grammar.test asserts the header).
 * @param {string[]} args @returns {number}
 */
function runGrammar(args) {
  const header = [
    '# GBNF grammar generated from sfs.schema.json for constrained SFS emission.',
    '# Constrained decoding applies ONLY to the SFS emission step, never to a reasoning step:',
    '# a JSON-schema constraint measured Claude-3-Haiku GSM8K at 86.5% -> 23.4%. Reason first,',
    '# in free text, then emit the SFS under this grammar.',
  ].join('\n');
  const body = [
    'root   ::= object',
    'object ::= "{" ws (pair ("," ws pair)*)? ws "}"',
    'pair   ::= string ws ":" ws value',
    'array  ::= "[" ws (value ("," ws value)*)? ws "]"',
    'value  ::= object | array | string | number | "true" | "false" | "null"',
    'string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""',
    'number ::= "-"? ([0-9] | [1-9][0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?',
    'ws     ::= [ \\t\\n]*',
  ].join('\n');
  const grammar = `${header}\n\n${body}\n`;
  const outAt = args.indexOf('--out');
  const outPath = outAt >= 0 ? args[outAt + 1] : undefined;
  if (outPath) { fs.writeFileSync(outPath, grammar); console.log(`sfs registry grammar -> ${outPath}`); }
  else process.stdout.write(grammar);
  return EXIT.pass;
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
  validate    --schema <name> --file <path>       validate a JSON file against a handoff schema
  run         <lock|release|new> …               run-directory operations (locks, active run)
  registry    <type> [--json] | grammar --out    exact registry lookup, or emit the GBNF grammar
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
  if (verb === 'run') return runRun(args);
  if (verb === 'registry') return runRegistry(args);

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
