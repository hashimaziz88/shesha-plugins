#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * shesha-design-comprehension / scripts/verify-placement.mjs
 *
 * Gate 5a.5's executable form: evaluate a blueprint's typed `assertions[]`
 * (scripts/lib/assertions.mjs) against a layout-probe.js measurement of the
 * BUILT form. Exit 0 only if every assertion passes.
 *
 * Usage:
 *   node verify-placement.mjs <blueprint.json> <built.probe.json> [--design <design.probe.json>]
 *
 * <blueprint.json>    a *.blueprint.json conforming to assets/blueprint.schema.json;
 *                     its `assertions[]` is what gets evaluated.
 * <built.probe.json>  the layout-probe.js JSON captured from the rendered,
 *                     published, table→details-navigated Shesha form — the
 *                     thing being verified.
 * --design <file>     optional: the layout-probe.js JSON captured from the
 *                     design source itself (Tier B), if available. Not
 *                     required by any predicate today; carried through for
 *                     future cross-checks (e.g. confirming a `ratio` window
 *                     was derived from a real design measurement rather than
 *                     guessed) rather than silently ignored if supplied.
 * ───────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluate } from './lib/assertions.mjs';

function parseArgs(argv) {
  var positional = [];
  var opts = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--design') { opts.design = argv[++i]; }
    else { positional.push(a); }
  }
  opts.positional = positional;
  return opts;
}

function loadJson(filePath, label) {
  var text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error('Could not read ' + label + ' at "' + filePath + '": ' + err.message);
    process.exit(2);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Could not parse ' + label + ' at "' + filePath + '" as JSON: ' + err.message);
    process.exit(2);
  }
}

function usage() {
  console.error(
    'Usage: node verify-placement.mjs <blueprint.json> <built.probe.json> [--design <design.probe.json>]'
  );
}

export function main(argv) {
  var args = parseArgs(argv);
  var blueprintPath = args.positional[0];
  var builtProbePath = args.positional[1];
  if (!blueprintPath || !builtProbePath) {
    usage();
    return 2;
  }

  var blueprint = loadJson(blueprintPath, 'blueprint');
  var builtProbe = loadJson(builtProbePath, 'built probe');
  if (args.design) {
    // Loaded for future cross-checks; not consumed by any predicate yet —
    // see file header. Still validated eagerly so a bad --design path fails
    // fast rather than silently being ignored.
    loadJson(args.design, 'design probe');
  }

  var assertions = blueprint.assertions || [];
  var results = evaluate(assertions, builtProbe);

  results.forEach(function (r) {
    var status = r.pass ? 'PASS' : 'FAIL';
    var line = '[' + status + '] ' + r.assertion;
    if (!r.pass) line += '\n       ' + r.message;
    console.log(line);
  });

  var passCount = results.filter(function (r) { return r.pass; }).length;
  console.log(passCount + '/' + results.length + ' assertions passed');

  return results.every(function (r) { return r.pass; }) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
