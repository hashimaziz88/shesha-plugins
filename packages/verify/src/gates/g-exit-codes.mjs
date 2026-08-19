// §3.2.0 / §3.5.4: exit codes and the verdict enum are single-sourced. Two rules,
// each a false-green class the old scripts shipped:
//
//   verdict-enum — the ONLY verdict vocabulary is coverage.mjs's frozen RESULTS
//     {pass,fail,partial,notRun}. There is no `warn` verdict (a warn is how a gate
//     that should fail stays green). No other module defines a competing set.
//   exit-args   — every process.exit under packages/verify/src/ passes an EXIT.*
//     member, an exitFor(...)/runGuarded(...) result, or a computed variable —
//     never a raw numeric literal. A hand-picked `process.exit(0)` is how a run
//     with failures returns success (the summarize.js / verify-artifact.mjs class).
//
// The gate reads SOURCE TEXT (not an import), so a mutation to the staged copy of
// coverage.mjs or a planted raw-literal exit is actually seen.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { families, verdictOf, report, exitFor, runGuarded } from '@shesha/registry/coverage';
import { listFiles, readText, rel, repoRoot } from '../lib/fsx.mjs';

export const id = 'g-exit-codes';
export const describe = 'the verdict enum is the frozen {pass,fail,partial,notRun}; every verify/src process.exit uses EXIT/exitFor, never a raw literal';
export const inputPaths = [
  'packages/registry/src/coverage.mjs',
  'packages/verify/src',
  'packages/sfs/src',
  'package.json',
];

const FROZEN = ['pass', 'fail', 'partial', 'notRun'];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'verdict-enum', unit: 'module' },
    { name: 'exit-args', unit: 'call' },
  ]);
  const enumFam = fams.get('verdict-enum');
  const exitFam = fams.get('exit-args');

  // ---- verdict-enum: coverage.mjs owns the sole frozen RESULTS ------------
  const covText = readText(path.join(root, 'packages/registry/src/coverage.mjs'));
  const ep = enumFam.pointer('coverage.mjs#RESULTS');
  if (covText === null) {
    ep.fail('packages/registry/src/coverage.mjs is unreadable; the verdict enum has no home');
  } else {
    const m = /RESULTS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(covText);
    if (!m) ep.fail('coverage.mjs does not export a frozen RESULTS array');
    else {
      // Group 1 is mandatory in the pattern, so it is defined when m matched.
      const got = [...(/** @type {string} */ (m[1])).matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
      ep.assert(JSON.stringify(got) === JSON.stringify(FROZEN),
        `the verdict enum is ${JSON.stringify(got)}, not the frozen ${JSON.stringify(FROZEN)} — there is no fifth verdict, which would be a fail dressed as green`);
    }
  }
  // No file under verify/src or sfs/src may define a second RESULTS or introduce a
  // 'warn' verdict literal.
  for (const dir of ['packages/verify/src', 'packages/sfs/src']) {
    for (const f of listFiles(path.join(root, dir), { ext: ['.mjs'] })) {
      const r = rel(root, f);
      if (r === 'packages/registry/src/coverage.mjs') continue;
      const raw = readText(f);
      if (raw === null) continue;
      const text = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      const p = enumFam.pointer(r);
      const second = /export\s+const\s+RESULTS\s*=/.test(text);
      const warn = /\bverdict\b[^\n]*['"]warn['"]|return\s+['"]warn['"]/.test(text);
      p.assert(!second && !warn,
        `${r} ${second ? 'defines a second RESULTS enum' : 'introduces a "warn" verdict'}; the verdict vocabulary is coverage.mjs's alone`);
    }
  }

  // ---- exit-args: no raw numeric literal reaches process.exit -------------
  const files = listFiles(path.join(root, 'packages/verify/src'), { ext: ['.mjs'] });
  for (const f of files) {
    const r = rel(root, f);
    const text = readText(f);
    if (text === null) continue;
    // Strip `//` comments so a `process.exit(0)` mentioned in prose (like this
    // gate's own header) is never read as code.
    const code = text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const m of code.matchAll(/process\.exit\(([^)]*)\)/g)) {
      // Group 1 is mandatory in the pattern, so it is defined for every match.
      const arg = /** @type {string} */ (m[1]).trim();
      const p = exitFam.pointer(`${r} process.exit(${arg.slice(0, 30)})`);
      // A raw exit code is a leading digit, or a ternary branch that is a digit.
      const rawLiteral = /^[0-9]/.test(arg) || /[?:]\s*[0-9]/.test(arg);
      p.assert(!rawLiteral,
        `${r} calls process.exit(${arg}) with a raw numeric literal; exit only via EXIT.* / exitFor(...) so a failing run cannot hand-pick success`);
    }
  }
  if (exitFam.walked === 0) exitFam.pointer('exit-args#none').assert(false, 'no process.exit found under packages/verify/src — the gate would be vacuous');

  return fams.list;
}

export const mutations = [
  {
    // The trigger tokens are assembled from parts (D-066): a detector that carries
    // `process.exit(0)` or the fifth verdict literally in its own source finds itself.
    name: 'a verify/src module exits with a raw numeric literal',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/verify/src/planted-exit.mjs');
      fs.writeFileSync(f, `if (Math.min(1)) process.${'ex' + 'it'}(0);\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the verdict enum grows a fifth member',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/registry/src/coverage.mjs');
      const text = fs.readFileSync(f, 'utf8');
      const fifth = `'${'wa' + 'rn'}'`;
      fs.writeFileSync(f, text.replace(/RESULTS\s*=\s*Object\.freeze\(\[[^\]]*\]\)/,
        `RESULTS = Object.freeze(['pass', 'fail', 'partial', 'notRun', ${fifth}])`));
    },
    expect: 'fail',
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return exitFor(verdictOf(fams));
  }));
}
