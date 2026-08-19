// D-005, D-041: coverage accounting exists exactly once.
//
// The audited repo had five walkers and three metadata unwrappers. Two of them
// disagreed about whether a family that walked nothing was a pass. This gate is
// the reason there can only ever be one answer.

import fs from 'node:fs';
import path from 'node:path';
import { families, readJsonGuarded } from '@shesha/registry/coverage';
import { listFiles, readText, rel } from '../lib/fsx.mjs';

export const id = 'g-coverage-single-impl';
export const describe = 'exactly one verdictOf, one walked/checked pair, single-line re-exports, one walkComponents';
export const inputPaths = [
  'packages/registry/src/coverage.mjs',
  'packages/verify/src/coverage.mjs',
  'packages/sfs/src/lib/coverage.mjs',
  'packages/verify/config/source-patterns.json',
  'packages',
];

/** The one file allowed to define the accounting. */
const CANONICAL = 'packages/registry/src/coverage.mjs';
/** The two files allowed to re-export it, each with exactly one non-comment line. */
const REEXPORTS = ['packages/verify/src/coverage.mjs', 'packages/sfs/src/lib/coverage.mjs'];
/** walkComponents is registry-data-driven and exempt from the re-export rule (D-041). */
const WALKER = 'packages/verify/src/walk.mjs';

/**
 * Strip comments and blank lines so "one non-comment line" is measurable.
 * @param {string} text
 * @returns {string[]}
 */
function significantLines(text) {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*') && l !== '*/');
}

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'verdictOf-defs', unit: 'file' },
    { name: 'counter-pairs', unit: 'file' },
    { name: 're-exports', unit: 'file' },
    { name: 'walkComponents', unit: 'file' },
  ]);

  // Patterns come from config so this file does not contain the text it searches
  // for; a detector carrying its own patterns inline matches itself.
  const patternsGot = readJsonGuarded(path.join(root, 'packages/verify/config/source-patterns.json'),
    fams.get('re-exports'), 'source-patterns.json');
  if (!patternsGot.ok) return fams.list;
  const P = /** @type {{singleImpl:{verdictOfDefinition:string[], counterPairFields:string[], counterPairMutations:string[], walkComponentsDefinition:string[], reExportLine:string}}} */ (patternsGot.value).singleImpl;
  /** @param {string[]} pats @param {string} text @returns {boolean} */
  const anyMatch = (pats, text) => pats.some((p) => new RegExp(p).test(text));
  /** @param {string[]} pats @param {string} text @returns {boolean} */
  const allMatch = (pats, text) => pats.every((p) => new RegExp(p).test(text));

  /** @type {string[]} */
  const scanned = [];
  for (const dir of ['packages', '.claude/hooks']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of listFiles(abs, { ext: ['.mjs'] })) {
      const r = rel(root, f);
      // Test files assert ON the accounting; they do not define it.
      if (/\/test\//.test(r)) continue;
      scanned.push(r);
    }
  }

  const verdictFam = fams.get('verdictOf-defs');
  const counterFam = fams.get('counter-pairs');
  const walkFam = fams.get('walkComponents');

  /** @type {string[]} */
  const verdictDefs = [];
  /** @type {string[]} */
  const counterDefs = [];
  /** @type {string[]} */
  const walkerDefs = [];

  for (const r of scanned) {
    const text = readText(path.join(root, r)) || '';

    const vp = verdictFam.pointer(r);
    const definesVerdict = anyMatch(P.verdictOfDefinition, text);
    if (definesVerdict) verdictDefs.push(r);
    vp.assert(!definesVerdict || r === CANONICAL,
      `defines verdictOf, but only ${CANONICAL} may (D-005)`);

    const cp = counterFam.pointer(r);
    // A counter PAIR: both members initialised, or both mutated, in one file.
    const definesPair = allMatch(P.counterPairFields, text) || allMatch(P.counterPairMutations, text);
    if (definesPair) counterDefs.push(r);
    cp.assert(!definesPair || r === CANONICAL,
      `defines a walked/checked counter pair, but only ${CANONICAL} may (D-005)`);

    const wp = walkFam.pointer(r);
    const definesWalker = anyMatch(P.walkComponentsDefinition, text);
    if (definesWalker) walkerDefs.push(r);
    wp.assert(!definesWalker || r === WALKER,
      `defines walkComponents, but only ${WALKER} may (D-041)`);
  }

  // The canonical file must actually be present and actually define the accounting,
  // or this gate would pass over an empty repository.
  const canonPointer = verdictFam.pointer(`${CANONICAL}#present`);
  const canonText = readText(path.join(root, CANONICAL));
  canonPointer.assert(canonText !== null && anyMatch(P.verdictOfDefinition, canonText),
    `${CANONICAL} must exist and export verdictOf — otherwise there is no implementation to be single`);

  const reFam = fams.get('re-exports');
  for (const r of REEXPORTS) {
    const p = reFam.pointer(r);
    const text = readText(path.join(root, r));
    if (text === null) { p.fail(`${r} is missing — verify and sfs must re-export the one implementation`); continue; }
    const sig = significantLines(text);
    if (sig.length !== 1) {
      p.fail(`${r} has ${sig.length} non-comment lines, must have exactly 1 (D-041): ${JSON.stringify(sig.slice(0, 3))}`);
      continue;
    }
    // sig.length === 1 was just checked, so sig[0] is defined.
    p.assert(new RegExp(P.reExportLine).test(/** @type {string} */ (sig[0])),
      `${r}'s single line must re-export the one coverage implementation, found ${JSON.stringify(sig[0])}`);
  }

  // walkComponents lands in WP-3a. Until its file exists, zero definitions is
  // correct; once it exists, exactly one, and only there.
  const walkerExists = fs.existsSync(path.join(root, WALKER));
  const wtotal = walkFam.pointer('walkComponents#cardinality');
  if (walkerExists) {
    wtotal.assert(walkerDefs.length === 1 && walkerDefs[0] === WALKER,
      `walkComponents must be defined exactly once, in ${WALKER}; found ${walkerDefs.length} definition(s): ${walkerDefs.join(', ')}`);
  } else {
    wtotal.assert(walkerDefs.length === 0,
      `${WALKER} does not exist yet, so no file may define walkComponents; found: ${walkerDefs.join(', ')}`);
  }

  const vtotal = verdictFam.pointer('verdictOf#cardinality');
  vtotal.assert(verdictDefs.length === 1,
    `verdictOf must be defined exactly once; found ${verdictDefs.length}: ${verdictDefs.join(', ')}`);
  const ctotal = counterFam.pointer('counter-pair#cardinality');
  ctotal.assert(counterDefs.length === 1,
    `a walked/checked counter pair must be defined exactly once; found ${counterDefs.length}: ${counterDefs.join(', ')}`);

  return fams.list;
}

export const mutations = [
  {
    name: 'a second file defines verdictOf',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/second-opinion.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      // Assembled from parts: a literal here would make this gate match its own
      // source and report itself as the second implementation.
      fs.writeFileSync(f, `export ${'function'} ${'verdict'}${'Of'}(fams) { return fams.length ? "pass" : "pass"; }\n`);
    },
    expect: 'fail',
  },
  {
    name: 'a re-export file grows a second non-comment line',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/coverage.mjs');
      fs.appendFileSync(f, "export const SOFTENED = true;\n");
    },
    expect: 'fail',
  },
  {
    name: 'a second file defines a walked/checked counter pair',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/local-tally.mjs');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, `export const tally = { ${'walked'}: 0, ${'checked'}: 0 };\n`);
    },
    expect: 'fail',
  },
];
