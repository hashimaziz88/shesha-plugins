// packages/registry/src/coverage.mjs
//
// The ONLY coverage-accounting implementation in this repository (D-005, D-041).
// Four rules, each of which the audited repo violated or lacked:
//   R1 zero coverage is a hard fail
//   R2 families are declared up front and cannot be created later
//   R3 walked === checked + notApplicable + uninspectable, or the run errors
//   R4 a family whose population was deleted by decision declares expectEmpty
//
// Unit discipline: `walked` and `checked` count POINTERS. `assertions` counts
// assertions. Mixing the two produced "roles 7 walked / 14 checked".

import fs from 'node:fs';

export const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };

/** The complete tier/gate result union (D-008). Nothing else is legal. */
export const RESULTS = Object.freeze(['pass', 'fail', 'partial', 'notRun']);

export class CoverageArithmeticError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'CoverageArithmeticError'; }
}

export class UndeclaredFamilyError extends Error {
  /** @param {string} m */
  constructor(m) { super(m); this.name = 'UndeclaredFamilyError'; }
}

/**
 * @typedef {{where: string, reason: string, checkId?: string}} Note
 * @typedef {{
 *   where: string,
 *   check(n?: number): Pointer,
 *   assert(ok: boolean, reason: string): Pointer,
 *   fail(reason: string): Pointer,
 *   na(reason: string): Pointer,
 *   cannot(reason: string, checkId: string): Pointer
 * }} Pointer
 * @typedef {{
 *   name: string, unit: string, required: boolean,
 *   expectEmpty: boolean, decision: string|null,
 *   walked: number, checked: number, assertions: number,
 *   failures: Note[], uninspectable: Note[], notApplicable: Note[],
 *   pointer(where: string): Pointer, _open: Map<string, string>
 * }} Family
 * @typedef {{name:string, unit:string, required?:boolean, expectEmpty?:boolean, decision?:string}} FamilyDecl
 */

/**
 * Declare the COMPLETE family set. Families cannot be created later (R2).
 * @param {FamilyDecl[]} decls
 * @returns {{ list: Family[], get(name: string): Family }}
 */
export function families(decls) {
  if (!Array.isArray(decls) || decls.length === 0) {
    throw new UndeclaredFamilyError('families(): the family set must be declared non-empty up front');
  }
  /** @type {Map<string, Family>} */
  const byName = new Map();
  for (const d of decls) {
    if (!d || typeof d.name !== 'string' || !d.name) {
      throw new UndeclaredFamilyError('families(): every family needs a name');
    }
    if (typeof d.unit !== 'string' || !d.unit) {
      throw new UndeclaredFamilyError(`families(): family "${d.name}" must state its unit`);
    }
    if (d.expectEmpty === true && !/^D-\d{3}$/.test(d.decision || '')) {
      throw new UndeclaredFamilyError(
        `families(): family "${d.name}" declares expectEmpty and must cite the DECISIONS.md id that deleted its population`);
    }
    if (byName.has(d.name)) throw new UndeclaredFamilyError(`families(): duplicate family "${d.name}"`);
    byName.set(d.name, makeFamily(d));
  }
  const list = [...byName.values()];
  Object.freeze(list);
  return {
    list,
    /** @param {string} name @returns {Family} */
    get(name) {
      const f = byName.get(name);
      // R2: the lazy-family hole. A typo or a renamed family must be loud, not silent.
      if (!f) {
        throw new UndeclaredFamilyError(
          `undeclared family "${name}" — declare it in families() so it can never vanish from the report`);
      }
      return f;
    },
  };
}

/**
 * @param {FamilyDecl} decl
 * @returns {Family}
 */
function makeFamily(decl) {
  /** @type {Family} */
  const f = {
    name: decl.name,
    unit: decl.unit,
    required: decl.required !== false,
    expectEmpty: decl.expectEmpty === true,
    decision: decl.decision || null,
    walked: 0, checked: 0, assertions: 0,
    failures: [], uninspectable: [], notApplicable: [],
    _open: new Map(),
    pointer(where) {
      if (typeof where !== 'string' || !where) {
        throw new CoverageArithmeticError(`${f.name}: pointer() requires a non-empty location string`);
      }
      const key = `${f.walked}:${where}`;
      f.walked++;
      f._open.set(key, where);
      /** @type {null|'checked'|'notApplicable'|'uninspectable'} */
      let disposition = null;
      /** @param {'checked'|'notApplicable'|'uninspectable'} kind */
      const close = (kind) => {
        if (disposition === null) { disposition = kind; f._open.delete(key); return; }
        if (disposition === kind && kind === 'checked') return;
        throw new CoverageArithmeticError(
          `${f.name} at ${where}: pointer already disposed as "${disposition}", cannot re-dispose as "${kind}" — one pointer, one disposition (R3)`);
      };
      /** @type {Pointer} */
      const p = {
        where,
        check(n = 1) {
          const first = disposition === null;
          close('checked');
          if (first) f.checked++;
          f.assertions += n;
          return p;
        },
        assert(ok, reason) { return ok ? p.check() : p.fail(reason); },
        fail(reason) {
          if (disposition === null) { close('checked'); f.checked++; f.assertions++; }
          else if (disposition !== 'checked') {
            throw new CoverageArithmeticError(
              `${f.name} at ${where}: cannot fail a pointer disposed as "${disposition}"`);
          }
          f.failures.push({ where, reason });
          return p;
        },
        na(reason) { close('notApplicable'); f.notApplicable.push({ where, reason }); return p; },
        cannot(reason, checkId) {
          if (!/^T[1-5]b?\.[0-9]{2}[a-z]?$/.test(checkId || '')) {
            throw new CoverageArithmeticError(
              `${f.name} at ${where}: cannot() requires the check id that could not be evaluated — push admission reads it`);
          }
          close('uninspectable');
          f.uninspectable.push({ where, reason, checkId });
          return p;
        },
      };
      return p;
    },
  };
  return f;
}

/**
 * R3, as executable code. Called by verdictOf before any verdict exists.
 * Throws rather than returning: a run whose accounting does not add up has
 * produced no information and must not be reported as any verdict at all.
 * @param {Family[]} fams
 */
export function reconcile(fams) {
  for (const f of fams) {
    const accounted = f.checked + f.notApplicable.length + f.uninspectable.length;
    const openSample = [...f._open.values()].slice(0, 5).join(', ');
    if (f.walked !== accounted) {
      const short = f.walked - accounted;
      throw new CoverageArithmeticError(
        `${f.name}: coverage does not reconcile — walked ${f.walked} != checked ${f.checked} + n/a ${f.notApplicable.length} + uninspectable ${f.uninspectable.length} (= ${accounted}). ` +
        `Unit is "${f.unit}". ${short > 0 ? `${short} pointer(s) were walked and never disposed` : `${-short} disposition(s) exist for pointers never walked`}` +
        `${openSample ? ` — e.g. ${openSample}` : ''}.`);
    }
    if (f._open.size > 0) {
      throw new CoverageArithmeticError(
        `${f.name}: ${f._open.size} pointer(s) walked but never disposed — e.g. ${openSample}. ` +
        `A walked pointer with no disposition is territory claimed and never visited.`);
    }
    if (f.checked === 0 && f.assertions > 0) {
      throw new CoverageArithmeticError(
        `${f.name}: ${f.assertions} assertions against 0 checked pointers — assertion counting has leaked into pointer counting`);
    }
  }
}

/**
 * Ordered verdict rules. Do not add, remove or reorder a rule without adding a
 * mutation to the coverage mutation tests.
 * @param {Family[]} fams
 * @returns {'pass'|'fail'|'partial'}
 */
export function verdictOf(fams) {
  reconcile(fams);                                                                     // R3 — throws, no verdict
  if (fams.some((f) => f.failures.length > 0)) return 'fail';                          // 1
  if (fams.some((f) => f.expectEmpty && f.walked > 0)) return 'fail';                  // 2b — R4 inverted
  if (fams.some((f) => f.required && !f.expectEmpty && f.walked === 0)) return 'fail'; // 2  — R1
  if (fams.some((f) => f.walked > 0 && f.checked === 0)) return 'fail';                // 3  — R1
  if (fams.some((f) => f.uninspectable.length > 0)) return 'partial';                  // 4
  return 'pass';                                                                       // 5
}

/**
 * @param {Family[]} fams
 * @returns {Note[]}
 */
export function zeroCoverageReasons(fams) {
  /** @type {Note[]} */
  const out = [];
  for (const f of fams) {
    if (f.expectEmpty && f.walked > 0) {
      out.push({ where: f.name, reason: `walked ${f.walked} ${f.unit}(s) in a population deleted by ${f.decision} — it has returned (R4)` });
    }
    if (f.required && !f.expectEmpty && f.walked === 0) {
      out.push({ where: f.name, reason: `required family walked 0 ${f.unit}s — zero coverage is a hard fail, not a pass (R1)` });
    }
    if (f.walked > 0 && f.checked === 0) {
      out.push({ where: f.name, reason: `walked ${f.walked} ${f.unit}(s) and evaluated none (R1)` });
    }
  }
  return out;
}

/**
 * The exact output of the required report format. Prints nothing else.
 * @param {Family[]} fams
 * @param {{json?:boolean, title?:string}} [opts]
 * @returns {string}
 */
export function report(fams, opts = {}) {
  const title = opts.title || 'coverage';
  const result = verdictOf(fams);
  if (opts.json) {
    return JSON.stringify({
      target: title,
      result,
      families: fams.map((f) => ({
        name: f.name, unit: f.unit, required: f.required,
        expectEmpty: f.expectEmpty, decision: f.decision,
        walked: f.walked, checked: f.checked, assertions: f.assertions,
        failures: f.failures, uninspectable: f.uninspectable, notApplicable: f.notApplicable,
      })),
    }, null, 2);
  }
  const width = Math.max(...fams.map((f) => f.name.length));
  /** @type {string[]} */
  const lines = [title, ''];
  for (const f of fams) {
    let line = `  ${f.name.padEnd(width)}   walked ${String(f.walked).padStart(4)}` +
      `   checked ${String(f.checked).padStart(4)}` +
      `   assertions ${String(f.assertions).padStart(4)}` +
      `   n/a ${String(f.notApplicable.length).padStart(3)}` +
      `   uninspectable ${String(f.uninspectable.length).padStart(3)}` +
      `   failures ${String(f.failures.length).padStart(3)}`;
    if (f.expectEmpty) line += `   expectEmpty ${f.decision}`;
    lines.push(line);
  }
  lines.push('');
  for (const f of fams) {
    if (f.failures.length === 0) continue;
    lines.push(`  FAIL — ${f.name}`);
    for (const n of f.failures) lines.push(`    ${n.where}`, `      ${n.reason}`);
  }
  for (const z of zeroCoverageReasons(fams)) lines.push(`  NO COVERAGE — ${z.where} ${z.reason}`);
  for (const f of fams) {
    if (f.uninspectable.length === 0) continue;
    lines.push(`  NOT INSPECTED — ${f.name} (read these by hand; this run did not cover them)`);
    for (const n of f.uninspectable) lines.push(`    ${n.where}  [${n.checkId}]`, `      ${n.reason}`);
  }
  lines.push('', `  result: ${result.toUpperCase()}`);
  if (result === 'partial') {
    lines.push('  A partial verdict is NOT a pass. Something here was never checked — say so when reporting.');
  }
  return lines.join('\n');
}

/**
 * @param {'pass'|'fail'|'partial'} v
 * @returns {number}
 */
export function exitFor(v) { return EXIT[v]; }

/**
 * The single push-admission rule over T1–T3 (§4.3.5 P6), replacing three ad-hoc
 * checks so admission has one decision procedure. Pure over the verdict plus the
 * artifact's component-type set — push-admissible.mjs supplies `present`, the
 * verdict carries per-tier uninspectable pointers in `tier.detail.uninspectable`.
 * `result` is a function of T1–T3 only; T4/T5 never gate admission (D-015).
 * @param {any} verdict
 * @param {{allowPartial?:boolean, present?:Set<string>}} [opts]
 * @returns {{ok:boolean, tier?:string, result?:string, reason?:string}}
 */
export function pushAdmissible(verdict, opts = {}) {
  const present = opts.present instanceof Set ? opts.present : new Set();
  const allowPartial = !!opts.allowPartial;
  const t = (verdict && verdict.tiers) || {};
  /** @param {any} tier */
  const un = (tier) => (tier && tier.detail && Array.isArray(tier.detail.uninspectable) ? tier.detail.uninspectable : []);

  // T1: must pass outright — no partial is admissible.
  if (!t.T1 || t.T1.result !== 'pass') return { ok: false, tier: 'T1', result: t.T1 && t.T1.result, reason: t.T1 && t.T1.reason };
  // T2: pass, or partial where every uninspectable pointer's component type is absent from the artifact.
  if (t.T2.result !== 'pass') {
    if (t.T2.result !== 'partial') return { ok: false, tier: 'T2', result: t.T2.result, reason: t.T2.reason };
    const offending = un(t.T2).filter((/** @type {any} */ u) => present.has(u.componentType));
    if (offending.length) return { ok: false, tier: 'T2', result: 'partial', reason: `uninspectable ${offending[0].componentType} is present in the artifact` };
  }
  // T3: pass, or partial with --allow-partial and every uninspectable reason a backend/metadata outage.
  if (t.T3.result !== 'pass') {
    if (t.T3.result !== 'partial') return { ok: false, tier: 'T3', result: t.T3.result, reason: t.T3.reason };
    if (!allowPartial) return { ok: false, tier: 'T3', result: 'partial', reason: 'T3 is partial; pass --allow-partial to admit a backend/metadata-unavailable partial' };
    const bad = un(t.T3).filter((/** @type {any} */ u) => !/^(backend|metadata) unavailable/.test(String((u && u.reason) || '')));
    if (bad.length) return { ok: false, tier: 'T3', result: 'partial', reason: `uninspectable reason is not a backend/metadata outage: ${bad[0].reason}` };
  }
  return { ok: true };
}

/**
 * Every JSON read in packages/verify and packages/sfs goes through this. A
 * malformed data file is a domain failure on a named pointer, never an uncaught
 * SyntaxError with no verdict.
 * @param {string} file
 * @param {Family} fam
 * @param {string} where
 * @returns {{ok:true, value:unknown} | {ok:false}}
 */
export function readJsonGuarded(file, fam, where) {
  const p = fam.pointer(where);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // BOM: PowerShell writes these constantly
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    p.fail(err.code === 'ENOENT' ? `${file} does not exist` : `cannot read ${file}: ${err.message}`);
    return { ok: false };
  }
  try {
    const value = JSON.parse(raw);
    p.check();
    return { ok: true, value };
  } catch (e) {
    const err = /** @type {Error} */ (e);
    p.fail(`${file} is not valid JSON: ${err.message}`);
    return { ok: false };
  }
}

/**
 * Wrap a tier/gate main() so an unexpected throw exits 2 with a named reason,
 * never a bare stack trace.
 * @param {() => Promise<number>} main
 * @returns {Promise<number>}
 */
export async function runGuarded(main) {
  try {
    return await main();
  } catch (e) {
    if (e instanceof CoverageArithmeticError || e instanceof UndeclaredFamilyError) {
      console.error(`COVERAGE CONTRACT BREACH — no verdict was produced.\n  ${e.message}`);
      return EXIT.usage;
    }
    const err = /** @type {Error} */ (e);
    console.error(`unexpected error — no verdict was produced.\n  ${err && err.stack ? err.stack : String(e)}`);
    return EXIT.usage;
  }
}
