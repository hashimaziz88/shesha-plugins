// D-071, D-076, D-077: the Q2 oracle is INDEPENDENT, the decompiler is LOSSLESS,
// and every compiler normalisation is in the declared contract.
//
// Three families, one per decision:
//   independence — tools/normalise-legacy.mjs imports nothing under src/compile or
//                  src/decompile and stays under its 12,288 B cap. One author
//                  writing both arms lets a shared misconception agree with itself;
//                  one ARM reading the other's code does the same thing at runtime.
//   lossless     — for both Q2 subjects, every base prop of every source node
//                  either survives value-equal into compile(decompile(m)) or is a
//                  normalisation-owned key. A dropped prop is exactly the failure
//                  D-076 exists to prevent: Q2 would then "agree" about a form
//                  that lost content.
//   editmode     — every emitted node whose registry record declares an
//                  editModeChannel carries the kind profile's value, and every
//                  buttonGroup item carries profile.editMode.actionsItem (N12).
//
// The lossless family reads the normalisation-owned key set from the decompiler's
// own export. That is deliberate, not circular: a key wrongly ADDED to that set
// makes the two arms diverge (the oracle keeps what the compiler dropped) and Q2
// fails in packages/sfs/test/oracle.test.mjs — the oracle is the guard on the set;
// this gate is the standing enforcer of independence, the cap, and the walk.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { families, report, runGuarded, verdictOf, EXIT } from '@shesha/registry/coverage';
import { repoRoot } from '../lib/fsx.mjs';

export const id = 'g-oracle-independence';
export const describe = 'oracle arm import-free of the compiler and under its byte cap; decompiler lossless over the Q2 subjects; editMode stamped from the kind profile';
export const inputPaths = [
  'packages/sfs/tools/normalise-legacy.mjs',
  'packages/verify/src/lib/oracle-eval.mjs',
  'packages/sfs/src',
  'packages/sfs/schema/sfs.schema.json',
  'packages/registry/data',
  'docs/rebuild-brief/artifacts/bookings-table.revision2.json',
  'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
  'package.json',
];

/** The oracle arm and its declared ceiling (§5.2). */
const ORACLE = 'packages/sfs/tools/normalise-legacy.mjs';
const BYTE_CAP = 12288;
/** Import specifiers the oracle may never reach. */
const BANNED = [/src\/compile\//, /src\/decompile\//];

/** The two Q2 subjects (O1). */
const SUBJECTS = [
  'docs/rebuild-brief/artifacts/bookings-table.revision2.json',
  'packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json',
];

/**
 * @param {{repoRoot:string}} ctx
 * @returns {Promise<import('@shesha/registry/coverage').Family[]>}
 */
export async function run(ctx) {
  const root = ctx.repoRoot;
  const fams = families([
    { name: 'independence', unit: 'check' },
    { name: 'lossless', unit: 'prop' },
    { name: 'editmode', unit: 'node' },
  ]);

  // --- independence -------------------------------------------------------------
  const indep = fams.get('independence');
  const oracleAbs = path.join(root, ORACLE);
  const imports = indep.pointer(`${ORACLE}#imports`);
  const cap = indep.pointer(`${ORACLE}#bytes`);
  if (!fs.existsSync(oracleAbs)) {
    imports.fail(`${ORACLE} is missing — Q2 has one arm, which proves nothing (D-071)`);
    cap.fail(`${ORACLE} is missing, so its byte cap cannot be measured`);
  } else {
    const text = fs.readFileSync(oracleAbs, 'utf8');
    const hits = BANNED.filter((re) => re.test(text)).map((re) => String(re));
    imports.assert(hits.length === 0,
      `${ORACLE} references the compiler it is supposed to be independent of: ${hits.join(', ')} (D-071)`);
    const bytes = Buffer.byteLength(text, 'utf8');
    cap.assert(bytes <= BYTE_CAP, `${ORACLE} is ${bytes} B against a ${BYTE_CAP} B cap (§5.2)`);
  }

  // --- lossless + editmode: measured in a SUBPROCESS (oracle-eval.mjs), so the
  // --- mutation harness's staged-and-mutated compiler is loaded fresh each run
  // --- instead of being served stale from this process's ESM cache.
  const lossless = fams.get('lossless');
  const editmode = fams.get('editmode');
  const load = lossless.pointer('pipeline#eval');
  /** @type {{subject:string, missing:boolean, missingNodes?:string[],
   *          props?:{name:string, key:string, source:unknown, emitted:unknown, equal:boolean}[],
   *          editmode?:{name:string, unit:string, actual:unknown, expected:unknown}[]}[]} */
  let rows;
  try {
    const stdout = execFileSync(process.execPath,
      [path.join(root, 'packages/verify/src/lib/oracle-eval.mjs'), root, ...SUBJECTS],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    rows = JSON.parse(stdout);
    load.check();
  } catch (e) {
    load.fail(`the compile/decompile pipeline failed to evaluate: ${/** @type {Error} */ (e).message}`);
    return fams.list;
  }

  for (const row of rows) {
    const sp = lossless.pointer(`${row.subject}#subject`);
    if (row.missing) { sp.fail(`Q2 subject missing: ${row.subject}`); continue; }
    sp.check();
    for (const name of row.missingNodes || []) {
      lossless.pointer(`${row.subject}:${name}#node`)
        .fail(`source node "${name}" has no counterpart in compile(decompile(m))`);
    }
    for (const prop of row.props || []) {
      lossless.pointer(`${row.subject}:${prop.name}.${prop.key}`).assert(prop.equal,
        `"${prop.key}" of "${prop.name}" was lost or altered outside the normalisation contract (D-076): `
        + `source ${JSON.stringify(prop.source ?? null).slice(0, 60)}, emitted ${JSON.stringify(prop.emitted ?? null).slice(0, 60)}`);
    }
    for (const em of row.editmode || []) {
      editmode.pointer(`${row.subject}:${em.name}#${em.unit}`).assert(
        JSON.stringify(em.actual) === JSON.stringify(em.expected),
        `${em.unit} "${em.name}" carries editMode ${JSON.stringify(em.actual)}; the kind profile stamps ${JSON.stringify(em.expected)} (D-077/N12)`);
    }
  }

  return fams.list;
}

export const mutations = [
  {
    name: 'the oracle arm imports the compiler',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, ORACLE);
      fs.appendFileSync(f, `\nimport '../${'src/compile'}/index.mjs';\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the oracle arm grows past its byte cap',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, ORACLE);
      fs.appendFileSync(f, `// ${'x'.repeat(BYTE_CAP)}\n`);
    },
    expect: 'fail',
  },
  {
    name: 'the residue pass is silenced, so the decompiler drops what it cannot lift',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/decompile/index.mjs');
      const text = fs.readFileSync(f, 'utf8');
      const needle = 'if (Object.keys(residue).length > 0) {';
      if (!text.includes(needle)) throw new Error('mutation anchor not found: the residue guard moved');
      fs.writeFileSync(f, text.replace(needle, 'if (false) {'));
    },
    expect: 'fail',
  },
  {
    name: 'the compiler stamps item editMode from a literal instead of the profile',
    kind: 'file',
    /** @param {string} tmp */
    apply: async (tmp) => {
      const f = path.join(tmp, 'packages/sfs/src/compile/s4-expand.mjs');
      const text = fs.readFileSync(f, 'utf8');
      const needle = 'editMode: ctx.profile.editMode.actionsItem,';
      if (!text.includes(needle)) throw new Error('mutation anchor not found: the item editMode stamp moved');
      fs.writeFileSync(f, text.replace(needle, "editMode: 'disabled',"));
    },
    expect: 'fail',
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runGuarded(async () => {
    const fams = await run({ repoRoot: repoRoot() });
    console.log(report(fams, { title: id }));
    return verdictOf(fams) === 'pass' ? EXIT.pass : EXIT.fail;
  }));
}
