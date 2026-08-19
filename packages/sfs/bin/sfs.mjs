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
import { SFS_LANGUAGE_VERSION } from '../src/index.mjs';
import { compile } from '../src/compile/index.mjs';
import { roundtrip } from '../src/roundtrip.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };

/** Subcommand -> the work package that implements it. `null` means it is live now. */
const VERBS = {
  compile: null,
  decompile: 'WP-6',
  roundtrip: null,
  normalise: 'WP-1',
  push: 'WP-6',
};

/**
 * `sfs roundtrip --scope <scope.json>` — decompile the declared corpus subset and
 * assert the clean set matches exactly (§2.5). The measurement lives in
 * packages/sfs/src/roundtrip.mjs; this is the CLI shell.
 * @param {string[]} args
 * @returns {number}
 */
function runRoundtrip(args) {
  const i = args.indexOf('--scope');
  const scope = i >= 0 && args[i + 1] ? args[i + 1] : 'packages/sfs/config/roundtrip-expected.json';
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
  if (!(verb in VERBS)) {
    console.error(`sfs: unknown command "${verb}"\n`);
    process.stderr.write(USAGE);
    return EXIT.usage;
  }
  if (verb === 'compile') return runCompile(args);
  if (verb === 'roundtrip') return runRoundtrip(args);

  const wp = VERBS[/** @type {keyof typeof VERBS} */ (verb)];
  console.error(`sfs ${verb}: not implemented in this build — ${wp} ships it.`);
  console.error('Exiting 2 (usage) rather than 0: a command that reports success while doing nothing');
  console.error('is the defect this entrypoint exists to make impossible.');
  return EXIT.usage;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
