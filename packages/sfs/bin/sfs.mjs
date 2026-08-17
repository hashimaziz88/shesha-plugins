#!/usr/bin/env node
// The one SFS entrypoint (D-040 conflict 1): `npm run sfs -- <args>`.
// No alias, no shim. This file existing and starting is itself an acceptance
// criterion, because the defect class it answers is a documented command that
// died on every invocation.
//
// Scope A builds the subcommands in WP-5. Until then every verb exits 2 (usage)
// naming the work package that implements it — never 0, because a command that
// silently succeeds while doing nothing is worse than one that refuses.

import { pathToFileURL } from 'node:url';
import { SFS_LANGUAGE_VERSION } from '../src/index.mjs';

const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };

/** Subcommand -> the work package that implements it. */
const VERBS = {
  compile: 'WP-5',
  decompile: 'WP-5',
  roundtrip: 'WP-5',
  normalise: 'WP-1',
  push: 'WP-6',
};

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
  const wp = VERBS[/** @type {keyof typeof VERBS} */ (verb)];
  console.error(`sfs ${verb}: not implemented in this build — ${wp} ships it.`);
  console.error('Exiting 2 (usage) rather than 0: a command that reports success while doing nothing');
  console.error('is the defect this entrypoint exists to make impossible.');
  return EXIT.usage;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
