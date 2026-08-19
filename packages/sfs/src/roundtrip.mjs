// The round-trip harness (§2.5). Decompiles a declared corpus subset and decides,
// per form, whether it round-trips:
//
//   roundTrips(f) ⇔ decompile(f) validates (it compiled — DEC-7001 is a fail)
//                   AND structuralEscapes(decompile(f)) === 0
//                   AND compile(decompile(f)).Markup === compile(decompile(compile(decompile(f)))).Markup
//
// The CLEAN set (roundTrips true) must equal EXACTLY the set marked expect:"clean"
// (setMustMatchExactly): an expected-clean form that is not is a fail, and an
// expected-escape that comes out clean is also a fail. triageOnly forms are
// decompiled and reported `uninspectable` — they never contribute to pass or fail.
// Byte-equality with the ORIGINAL is never required; the corpus carries the defects.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from './compile/index.mjs';
import { decompile } from './decompile/index.mjs';

/**
 * @param {string} root
 * @param {string} absPath
 * @returns {{form:string, roundTrips:boolean, structuralEscapes:number, validated:boolean, stable:boolean, reason:string}}
 */
function evaluate(root, absPath) {
  const form = path.basename(absPath).replace(/\.json$/, '');
  const raw = fs.readFileSync(absPath, 'utf8');
  try {
    const d = decompile(raw);
    // A first compile proves the decompiled SFS is valid; the second proves the
    // decompile↔compile loop is a fixed point (stable), which is the honest
    // round-trip when names — and therefore ids — cannot be recovered from markup.
    const c1 = compile(JSON.stringify(d.sfs));
    const c2 = compile(JSON.stringify(decompile(c1.envelope).sfs));
    const stable = c1.markup === c2.markup;
    const rt = d.structuralEscapes === 0 && stable;
    return { form, roundTrips: rt, structuralEscapes: d.structuralEscapes, validated: true, stable, reason: '' };
  } catch (e) {
    return { form, roundTrips: false, structuralEscapes: -1, validated: false, stable: false, reason: /** @type {Error} */ (e).message.slice(0, 120) };
  }
}

/**
 * @param {string} root
 * @param {string} scopePath repo-relative scope file
 * @returns {{ok:boolean, lines:string[], report:Record<string, unknown>}}
 */
export function roundtrip(root, scopePath) {
  const scope = JSON.parse(fs.readFileSync(path.join(root, scopePath), 'utf8'));
  /** @type {string[]} */
  const lines = [];
  /** @type {{form:string, verdict:string}[]} */
  const triaged = [];
  /** @type {string[]} */
  const problems = [];

  const declared = /** @type {{form:string, path:string, expect:string}[]} */ (scope.declaredSubset);
  /** @type {Set<string>} */
  const cleanActual = new Set();
  const expectedClean = new Set(declared.filter((d) => d.expect === 'clean').map((d) => d.form));
  let validated = 0;
  /** @type {{form:string, structuralEscapes:number}[]} */
  const escapes = [];

  for (const entry of declared) {
    const abs = path.join(root, entry.path);
    if (!fs.existsSync(abs)) { problems.push(`declared form missing on disk: ${entry.path}`); continue; }
    const r = evaluate(root, abs);
    escapes.push({ form: entry.form, structuralEscapes: r.structuralEscapes });
    if (r.validated) validated += 1;
    if (r.roundTrips) cleanActual.add(entry.form);
    // A validation failure is always a fail — never a skip.
    if (!r.validated) problems.push(`${entry.form}: decompile failed — ${r.reason}`);
    else if (entry.expect === 'clean' && !r.roundTrips) problems.push(`${entry.form}: expected clean but escapes=${r.structuralEscapes} stable=${r.stable}`);
    else if (entry.expect === 'structural-escape' && r.roundTrips) problems.push(`${entry.form}: expected a structural escape but round-trips clean — move its row to "clean"`);
    lines.push(`  ${entry.form.padEnd(26)} ${entry.expect.padEnd(18)} escapes=${r.structuralEscapes} ${r.roundTrips ? 'CLEAN' : 'escape'}`);
  }

  // setMustMatchExactly: the clean SET equals the expected-clean SET, not merely the count.
  const cleanMatch = expectedClean.size === cleanActual.size && [...expectedClean].every((f) => cleanActual.has(f));
  if (!cleanMatch) {
    problems.push(`clean set ${[...cleanActual].sort().join(',') || '(none)'} != expected ${[...expectedClean].sort().join(',')}`);
  }

  // triageOnly: decompiled, recorded uninspectable, never pass/fail.
  for (const entry of /** @type {{form:string, path:string}[]} */ (scope.triageOnly || [])) {
    const abs = path.join(root, entry.path);
    const r = fs.existsSync(abs) ? evaluate(root, abs) : { validated: false, structuralEscapes: -1, reason: 'missing' };
    triaged.push({ form: entry.form, verdict: 'uninspectable' });
    lines.push(`  ${entry.form.padEnd(26)} triageOnly         escapes=${r.structuralEscapes} uninspectable`);
  }

  const rate = expectedClean.size === 0 ? 0 : cleanActual.size / expectedClean.size;
  const minRate = scope.gate && typeof scope.gate.minRate === 'number' ? scope.gate.minRate : 0.90;
  const ok = problems.length === 0 && rate >= minRate;
  const summary = `rate ${rate.toFixed(2)} (clean ${cleanActual.size}/${expectedClean.size}) · validated ${validated}/${declared.length} · triaged ${triaged.length} · untriaged 0`;
  return {
    ok,
    lines: [...lines, summary, ...problems.map((p) => `  FAIL ${p}`)],
    report: { rate, cleanActual: [...cleanActual], expectedClean: [...expectedClean], validated, triaged, problems, escapes },
  };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const i = process.argv.indexOf('--scope');
  const scopeArg = process.argv[i + 1];
  const scopePath = i >= 0 && scopeArg ? scopeArg : 'packages/sfs/config/roundtrip-expected.json';
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..', '..', '..');
  const r = roundtrip(root, scopePath);
  for (const l of r.lines) console.log(l);
  process.exit(r.ok ? 0 : 1);
}
