## Section 3 — Verifier ladder, coverage library, mutation-test standard

This section defines what "green" means. Every rule below is implemented by a file this section names, with a mutation that proves it fires. A rule with neither is not in this section.

**Source of requirements:** strategy doc §4 L3 (the five-tier table), §1.3 (the placement gate has no comparator program), §1.4 (what actually runs, and the closing list of *what is never checked on any form*), §5 (disposition rows for `verify-artifact.mjs`, `check-references.mjs`, `tests/check-references.negative.mjs`, `layout-probe.js`), §6 Phase 0 items 1–2 and 5, Phase 3 gate, and §1.7 T4/T5/T6/T13/T15.

**Placement decisions this section makes (do not re-litigate):**

| # | Decision | Reason |
|---|---|---|
| P1 | The coverage library is **`packages/registry/src/coverage.mjs`**. `packages/verify/src/coverage.mjs` and `packages/sfs/src/lib/coverage.mjs` are each exactly one line: `export * from '@shesha/registry/coverage';` | Section 2's canonical-path table. `registry` has zero dependencies, so the `registry <- sfs <- verify` arrow (Section 1 §1.3 rule 3) holds and `g-coverage-single-impl`'s "one non-comment line" rule on the re-exports holds verbatim |
| P2 | `walkComponents` lives in **`packages/verify/src/walk.mjs`** and is **exempt** from `g-coverage-single-impl`'s re-export rule | It is registry-data-driven, not arithmetic. Its own single-implementation assertion is §3.8 row 4 |
| P3 | Test fixtures are **`packages/sfs/test/fixtures/`**, exported to `packages/verify` via the `sfs` export map | Section 2's canonical test root. Fixtures are compiler inputs and outputs; consumed downstream is the legal direction. One copy, one manifest |
| P4 | `verify-artifact.mjs` splits **`file` + `structure` -> T1**, **`references` -> T3** | §3.4. Section 1 §1.2 records the destination as "t3-semantic.mjs (split)"; this is that split |
| P5 | The predicate library is **`packages/verify/src/predicates/index.mjs`** (the table) + **`packages/verify/src/predicates/tree.mjs`** (the accessors) | Section 4 §4.9 assigns Section 3 that exact path, and `registry_lookup {kind:"predicate"}` advertises it to the Planner. There is no `src/placement/` directory |
| P6 | Section 3 reserves DECISIONS.md ids **D-060 … D-075** and BACKLOG ids **BL-030 … BL-034** | BL-001/002/010/021 are taken by Sections 5 and 2 |
| P7 | Work packages: **WP-3a** (coverage library + T1 + T2), **WP-3b** (T3 + predicates + the two script fixes), **WP-3c** (T4 + probe residue), **WP-3d** (T5). One commit each | Each ends in a literal runnable gate (§3.8) |
| P8 | The **verdict envelope is Section 4's** (`packages/sfs/schema/verdict.schema.json`, §4.2.4, `additionalProperties: false`). Section 3 owns `tiers.T*.detail`, `predicates[]`, `findings[].code`, and the evaluation semantics. **There is no `gate` key and no `advisory` key**; top-level `result` *is* the gate | Two shapes for one file is the drift generator this rebuild exists to remove |

**Cross-section dependency, stated once:** T2, T3 and every placement predicate read the compiler's provenance sidecar `<screen>.compiled.meta.json` (Section 2 §2.4.2). Its schema is `packages/sfs/schema/compiled-meta.schema.json`, **whose content Section 3 owns and fixes in §3.3.1**. Without the sidecar, fill-vs-fixed intent, tab membership and id provenance are unrecoverable from markup, and the central claim — placement moves from T5 to T3 (strategy doc §4 L3) — does not hold.

**Registry data access.** Every registry data file is read **only** through `@shesha/registry`'s `load(ref)`, never by path. Where this section names a data file (`slots.json`, `deny.json`, `form-settings.json`, `action-owners.json`, `datatype-components.json`, `required-props.json`), the file is `packages/registry/data/0.45.1/<name>.json` and the accessor is `load('0.45.1').<name>`. A `fs.readFileSync` of any path under `packages/registry/data/` from `packages/verify/**` is a `g-registry-provenance` failure.

---

### 3.1 The coverage-accounting library

**File: `packages/registry/src/coverage.mjs`.** Section 1 §1.6 gave the skeleton; this is the specification it is filled out to. The only additions to §1.6's typedef are `notApplicable`, `assertions`, `unit` and `expectEmpty`; every other name is preserved exactly.

`g-coverage-single-impl` fails the build if any file other than this one defines a `walked`/`checked` counter pair or a function named `verdictOf` (D-005), and if either re-export file has more than one non-comment line.

#### 3.1.1 The four rules

| Rule | Statement | Evidence (strategy doc §1.4) | Implemented by |
|---|---|---|---|
| **R1 — zero coverage is a hard fail** | A `required` family with `walked === 0` is `fail`. A family with `walked > 0 && checked === 0` is `fail`. Never `pass`, never `partial` | `verify-artifact.mjs`'s `verdictOf` had no zero-coverage rule; a `formId` that is `""`/`null`/absent is never walked → `walked 0, checked 0, verdict: pass, exit 0` — the exact false-green its own header says it prevents | `verdictOf` rules 2–3 |
| **R2 — families are declared up front** | `families()` takes the complete declaration list and freezes it. Requesting an undeclared family **throws**. A declared family that matches nothing still prints | `check-references.mjs` created families lazily; rewording two files moved 9 agent-dispatch pointers from `checked 9` to **unmentioned**, still `PASS` | `families()` + `UndeclaredFamilyError` |
| **R3 — the arithmetic must reconcile or the run errors** | For every family, `walked === checked + notApplicable.length + uninspectable.length`, and no pointer may be left undisposed. A breach throws `CoverageArithmeticError`; the runner prints it and exits **2** with **no verdict** | `skills` 40 walked / 29 checked / 11 unaccounted; `roles` 7 walked / 14 checked, a unit mismatch | `reconcile()`, called first by `verdictOf` |
| **R4 — a deleted pointer population is declared, not tolerated** | A family may declare `expectEmpty: true` with a mandatory `decision: "D-0NN"`. The R1 test **inverts**: `walked > 0` is `fail` ("a population deleted by decision has returned"), `walked === 0` is `pass`. The family still always prints | The alternative valve is flipping `required: false`, which re-creates the vanishing-family hole (§1.7 T6) R2 exists to close | `verdictOf` rule 2b; `g-family-declaration` |

R3 needs a unit discipline or it is unenforceable:

- **`walked`** counts **pointers** — one per thing the family visited. One `pointer()` call, one increment.
- **`checked`** counts **pointers that received at least one evaluated assertion**. It is not an assertion count.
- **`assertions`** counts assertions and is free-running. `roles` walking 7 tokens across 2 themes reports `walked 7, checked 7, assertions 14` — the exact §1.4 mismatch, made impossible.
- Every walked pointer receives **exactly one disposition**: `checked`, `notApplicable`, or `uninspectable`, recorded on the pointer, so the arithmetic holds by construction.
- `failures[]` is unbounded and independent: one pointer may accumulate several failures.
- Every `uninspectable` note carries a `checkId`. `pushAdmissible` (§3.2.0) reads it. A `cannot()` call without a `checkId` throws.

#### 3.1.2 Full API

```js
// packages/registry/src/coverage.mjs
//
// The ONLY coverage-accounting implementation in this repository (D-005).
// Four rules, each of which the audited repo violated or lacked (strategy doc §1.4):
//   R1 zero coverage is a hard fail
//   R2 families are declared up front and cannot be created later
//   R3 walked === checked + notApplicable + uninspectable, or the run errors
//   R4 a family whose population was deleted by decision declares expectEmpty
//
// Unit discipline: `walked` and `checked` count POINTERS. `assertions` counts
// assertions. Mixing the two produced "roles 7 walked / 14 checked".

import fs from 'node:fs';

export const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };
/** The complete tier/gate result union (Section 1 D-008). Nothing else is legal. */
export const RESULTS = Object.freeze(['pass', 'fail', 'partial', 'notRun']);

export class CoverageArithmeticError extends Error {
  constructor(/** @type {string} */ m) { super(m); this.name = 'CoverageArithmeticError'; }
}
export class UndeclaredFamilyError extends Error {
  constructor(/** @type {string} */ m) { super(m); this.name = 'UndeclaredFamilyError'; }
}

/**
 * @typedef {{where: string, reason: string, checkId?: string}} Note
 * @typedef {{
 *   name: string, unit: string, required: boolean,
 *   expectEmpty: boolean, decision: string|null,
 *   walked: number, checked: number, assertions: number,
 *   failures: Note[], uninspectable: Note[], notApplicable: Note[],
 *   pointer(where: string): Pointer, _open: Map<string, string>
 * }} Family
 * @typedef {{
 *   where: string,
 *   check(n?: number): Pointer,
 *   assert(ok: boolean, reason: string): Pointer,
 *   fail(reason: string): Pointer,
 *   na(reason: string): Pointer,
 *   cannot(reason: string, checkId: string): Pointer
 * }} Pointer
 */

/**
 * Declare the COMPLETE family set. Families cannot be created later (R2).
 * @param {{name:string, unit:string, required?:boolean, expectEmpty?:boolean, decision?:string}[]} decls
 * @returns {{ list: Family[], get(name: string): Family }}
 */
export function families(decls) {
  if (!Array.isArray(decls) || decls.length === 0) {
    throw new UndeclaredFamilyError('families(): the family set must be declared non-empty up front');
  }
  const byName = new Map();
  for (const d of decls) {
    if (!d || typeof d.name !== 'string' || !d.name) throw new UndeclaredFamilyError('families(): every family needs a name');
    if (typeof d.unit !== 'string' || !d.unit) throw new UndeclaredFamilyError(`families(): family "${d.name}" must state its unit`);
    if (d.expectEmpty === true && !/^D-\d{3}$/.test(d.decision || '')) {
      throw new UndeclaredFamilyError(`families(): family "${d.name}" declares expectEmpty and must cite the DECISIONS.md id that deleted its population`);
    }
    if (byName.has(d.name)) throw new UndeclaredFamilyError(`families(): duplicate family "${d.name}"`);
    byName.set(d.name, makeFamily(d));
  }
  const list = [...byName.values()];
  Object.freeze(list);
  return {
    list,
    get(name) {
      const f = byName.get(name);
      // R2: the lazy-family hole. A typo or a renamed family must be loud, not silent.
      if (!f) throw new UndeclaredFamilyError(`undeclared family "${name}" — declare it in families() so it can never vanish from the report`);
      return f;
    },
  };
}

function makeFamily(decl) {
  /** @type {Family} */
  const f = {
    name: decl.name, unit: decl.unit,
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
            throw new CoverageArithmeticError(`${f.name} at ${where}: cannot fail a pointer disposed as "${disposition}"`);
          }
          f.failures.push({ where, reason });
          return p;
        },
        na(reason) { close('notApplicable'); f.notApplicable.push({ where, reason }); return p; },
        cannot(reason, checkId) {
          if (!/^T[1-5]b?\.[0-9]{2}[a-z]?$/.test(checkId || '')) {
            throw new CoverageArithmeticError(`${f.name} at ${where}: cannot() requires the check id that could not be evaluated — push admission reads it`);
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
    if (f.walked !== accounted) {
      throw new CoverageArithmeticError(
        `${f.name}: coverage does not reconcile — walked ${f.walked} != checked ${f.checked} + n/a ${f.notApplicable.length} + uninspectable ${f.uninspectable.length} (= ${accounted}). ` +
        `Unit is "${f.unit}". ${f.walked - accounted > 0 ? `${f.walked - accounted} pointer(s) were walked and never disposed` : `${accounted - f.walked} disposition(s) exist for pointers never walked`}.`);
    }
    if (f._open.size > 0) {
      const sample = [...f._open.values()].slice(0, 5).join(', ');
      throw new CoverageArithmeticError(
        `${f.name}: ${f._open.size} pointer(s) walked but never disposed — e.g. ${sample}. ` +
        `A walked pointer with no disposition is territory claimed and never visited (§1.7 T5).`);
    }
    if (f.checked === 0 && f.assertions > 0) {
      throw new CoverageArithmeticError(`${f.name}: ${f.assertions} assertions against 0 checked pointers — assertion counting has leaked into pointer counting`);
    }
  }
}

/**
 * Ordered verdict rules. Do not add, remove or reorder a rule without adding a
 * mutation to packages/verify/test/coverage.mutation.test.mjs.
 * @param {Family[]} fams @returns {'pass'|'fail'|'partial'}
 */
export function verdictOf(fams) {
  reconcile(fams);                                                            // R3 — throws, no verdict
  if (fams.some((f) => f.failures.length > 0)) return 'fail';                 // 1
  if (fams.some((f) => f.expectEmpty && f.walked > 0)) return 'fail';         // 2b — R4 inverted
  if (fams.some((f) => f.required && !f.expectEmpty && f.walked === 0)) return 'fail'; // 2 — R1
  if (fams.some((f) => f.walked > 0 && f.checked === 0)) return 'fail';       // 3 — R1
  if (fams.some((f) => f.uninspectable.length > 0)) return 'partial';         // 4
  return 'pass';                                                             // 5
}

/** @param {Family[]} fams @returns {Note[]} */
export function zeroCoverageReasons(fams) {
  const out = [];
  for (const f of fams) {
    if (f.expectEmpty && f.walked > 0) out.push({ where: f.name, reason: `walked ${f.walked} ${f.unit}(s) in a population deleted by ${f.decision} — it has returned (R4)` });
    if (f.required && !f.expectEmpty && f.walked === 0) out.push({ where: f.name, reason: `required family walked 0 ${f.unit}s — zero coverage is a hard fail, not a pass (R1)` });
    if (f.walked > 0 && f.checked === 0) out.push({ where: f.name, reason: `walked ${f.walked} ${f.unit}(s) and evaluated none (R1)` });
  }
  return out;
}

/** @param {Family[]} fams @param {{json?:boolean,title?:string}} opts @returns {string} */
export function report(fams, opts = {}) { /* the exact output of §3.1.3 */ }

/** @param {'pass'|'fail'|'partial'} v @returns {number} */
export function exitFor(v) { return EXIT[v]; }

/**
 * Every JSON read in packages/verify and packages/sfs goes through this. A
 * malformed data file is a domain failure on a named pointer, never an uncaught
 * SyntaxError with no verdict (§1.4: check-references.mjs crashed with an
 * uncaught SyntaxError, indistinguishable by exit code from a real failure).
 * @param {string} file @param {Family} fam @param {string} where
 * @returns {{ok:true, value:unknown} | {ok:false}}
 */
export function readJsonGuarded(file, fam, where) {
  const p = fam.pointer(where);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } // BOM: PowerShell writes these constantly
  catch (e) { p.fail(e.code === 'ENOENT' ? `${file} does not exist` : `cannot read ${file}: ${e.message}`); return { ok: false }; }
  try { const value = JSON.parse(raw); p.check(); return { ok: true, value }; }
  catch (e) { p.fail(`${file} is not valid JSON: ${e.message}`); return { ok: false }; }
}

/** Wrap a tier/gate main() so an unexpected throw exits 2 with a named reason, never a bare stack trace. */
export async function runGuarded(/** @type {() => Promise<number>} */ main) {
  try { return await main(); }
  catch (e) {
    if (e instanceof CoverageArithmeticError || e instanceof UndeclaredFamilyError) {
      console.error(`COVERAGE CONTRACT BREACH — no verdict was produced.\n  ${e.message}`);
      return EXIT.usage;
    }
    console.error(`unexpected error — no verdict was produced.\n  ${e && e.stack ? e.stack : e}`);
    return EXIT.usage;
  }
}
```

#### 3.1.3 Required report output

`report()` prints, in this order, and nothing else:

```
<title>

  <family>   walked NNNN   checked NNNN   assertions NNNN   n/a NNN   uninspectable NNN   failures NNN
  ...
                                        (one line per DECLARED family, always, even at 0; expectEmpty families print "expectEmpty D-0NN")

  FAIL — <family>
    <where>
      <reason>
  NO COVERAGE — <family> walked N <unit>(s) and evaluated none.        (from zeroCoverageReasons)
  NOT INSPECTED — <family> (read these by hand; this run did not cover them)
    <where>  [<checkId>]
      <reason>

  result: PASS|FAIL|PARTIAL
  A partial verdict is NOT a pass. Something here was never checked — say so when reporting.   (partial only)
```

With `--json`: `{ target, result, families: [{name, unit, required, expectEmpty, decision, walked, checked, assertions, failures, uninspectable, notApplicable}] }`. The JSON shape is frozen — the MCP surface, `pushAdmissible` and `mutation-meta.test.mjs` all parse it. Any change requires a DECISIONS.md row.

#### 3.1.4 Tests that must exist (`packages/verify/test/coverage.test.mjs`)

Minimum **21** named tests.

| # | Test name | Asserts |
|---|---|---|
| 1 | `a required family that walked nothing is fail, not pass` | R1 |
| 2 | `a family that walked pointers and checked none is fail` | R1 |
| 3 | `an optional family that walked nothing does not fail the run` | `required:false` honoured and still printed |
| 4 | `requesting an undeclared family throws UndeclaredFamilyError` | R2 |
| 5 | `a declared family that matches nothing still appears in the report` | R2 — the vanishing-family hole |
| 6 | `families() rejects a family declared without a unit` | R3 precondition |
| 7 | `walked minus dispositions is a CoverageArithmeticError, not a verdict` | R3 |
| 8 | `an undisposed pointer throws naming the location` | R3 |
| 9 | `disposing one pointer twice throws` | R3 |
| 10 | `failing a pointer already marked notApplicable throws` | R3 |
| 11 | `seven role tokens across two themes reconcile as walked 7 checked 7 assertions 14` | the exact §1.4 unit mismatch |
| 12 | `two failures on one pointer still reconcile` | failures independent of dispositions |
| 13 | `uninspectable alone yields partial and exit 3` | tier semantics |
| 14 | `failures outrank uninspectable` | rule order |
| 15 | `zero coverage outranks uninspectable` | a partial must not mask a zero |
| 16 | `readJsonGuarded turns a malformed JSON file into one named failure and no throw` | §1.4 crash class |
| 17 | `readJsonGuarded strips a BOM` | PowerShell |
| 18 | `runGuarded converts a CoverageArithmeticError into exit 2 with no verdict line` | exit semantics |
| 19 | `an expectEmpty family with walked 0 passes and still prints its decision id` | R4 |
| 20 | `an expectEmpty family with walked 1 fails naming the decision that deleted the population` | R4 |
| 21 | `families() rejects expectEmpty without a D-0NN decision id, and cannot() without a checkId` | R4 + admission precondition |

---

### 3.2 The ladder: T1–T5

#### 3.2.0 Ladder driver, exit codes, verdict, push admission

**Driver: `packages/verify/src/verify.mjs`.**

```
node packages/verify/src/verify.mjs <run-dir> --screen <name> [--tiers t1,t2,t3] [--metadata <snapshot.json>]
     [--backend <url> --token <file>] [--base-url <url>] [--legacy] [--json]
```

Rules:

1. Tiers run in order. **A `fail` at T1 or T2 stops the ladder.** T3 `fail` does not stop T4/T5 (their findings are routing information), but `result` is already `fail`.
2. `result = worst(T1, T2, T3)` over the lattice `pass < partial < fail`. A tier among T1–T3 that did not run is `notRun`, and `notRun` among T1–T3 forces `result = fail`. **T4 and T5 never enter `result`** (D-015): T4 needs a browser the reference host does not have, so making it verdict-bearing makes every verdict permanently `partial`, and an always-amber gate gets muted (§1.7 T4).
3. A tier that did not run records `{"result":"notRun","reason":"<non-empty>"}`. `g-exit-codes` asserts no code path maps `notRun` to `pass` and that every tier `result` is drawn from `RESULTS`.
4. **Driver exit code:** `exitFor(result)`, except that when `result === 'pass'` and any **requested** tier reported `notRun`, the exit is **3**. Asking for T4 and not getting it is partial information about what you asked for; not asking for it is not.
5. `<run-dir>/screens/<screen>.verdict.json` is written to Section 4's envelope (§4.2.4). Tier keys are **`T1`…`T5`** and the tier field is **`result`**. There is no `gate` key, no `advisory` key and no `verdict` key. `sealedAt` is set at write time. `tiers.T3.backend` is set to the normalised base URL of the metadata source actually used (`--backend`'s value, or `"snapshot:<sha256-12>"` for `--metadata`, or `null`).
6. **Push admission is one function, in one file, with one rule.** `packages/verify/src/admission.mjs` exports `pushAdmissible(verdict, budget, {allowPartial, target, now})`. `.claude/hooks/gate-push.mjs` P6/P10 call it and print its `code` + `reason` verbatim; the hook contains no tier logic of its own and **never re-runs a tier** — re-verifying inside a PreToolUse hook duplicates the Evaluator, doubles the backend dependency and cannot fit the 30 s timeout.

```js
// packages/verify/src/admission.mjs  — the ONLY definition of "may this be pushed"
export function pushAdmissible(verdict, budget, opts) {
  for (const t of ['T1', 'T2', 'T3']) {
    const r = verdict.tiers[t].result;
    if (r === 'pass') continue;
    if (r !== 'partial') return { ok: false, code: 'HOOK-0307', reason: `T1-T3 not green: ${t}=${r}` };
    if (opts.allowPartial !== true) {
      return { ok: false, code: 'HOOK-0311', reason: `${t} is partial. A partial verdict is NOT a pass. Re-run with --allow-partial to push knowingly.` };
    }
    for (const u of verdict.tiers[t].detail.uninspectable) {
      const entry = budget.classA[u.checkId];
      if (!entry || !new RegExp(entry.reasonPattern).test(u.reason)) {
        return { ok: false, code: 'HOOK-0311', reason: `${t} uninspectable at ${u.where} (${u.checkId || 'no check id'}) is outside the declared uninspectable budget` };
      }
    }
  }
  const ageMs = opts.now - Date.parse(verdict.sealedAt);
  if (!(ageMs >= 0 && ageMs <= 30 * 60 * 1000)) {
    return { ok: false, code: 'HOOK-0312', reason: `verdict sealed ${Math.round(ageMs / 60000)} min ago; re-verify (max 30 min)` };
  }
  const norm = (u) => String(u || '').replace(/\/+$/, '');
  if (verdict.tiers.T3.backend !== null && norm(verdict.tiers.T3.backend) !== norm(opts.target)) {
    return { ok: false, code: 'HOOK-0312', reason: `verdict was produced against a different backend (${verdict.tiers.T3.backend} != ${opts.target})` };
  }
  return { ok: true };
}
```

**The uninspectable budget: `packages/verify/config/uninspectable-budget.json`.** This is the complete set of check ids whose `uninspectable` disposition may survive to a knowing push. Anything else uninspectable blocks the push regardless of flags.

```json
{
  "max": 7,
  "classA": {
    "T2.08": { "reasonPattern": "^registry valueType unknown for non-priority type ", "decision": "D-070" },
    "T3.01": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" },
    "T3.02": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" },
    "T3.05": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" },
    "T3.06": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" },
    "T3.07": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" },
    "T3.09": { "reasonPattern": "^(backend|metadata) unavailable", "decision": "D-068" }
  }
}
```

`g-uninspectable-budget` fails when: a `classA` key is not in the union of the tiers' exported `checks[].id`; an entry cites a `decision` absent from `/DECISIONS.md`; `Object.keys(classA).length > max`; or `max` rises. `max` is a ratchet-down number — `g-no-gate-tampering` fails any commit that raises it without a `Gate removal:`-prefixed DECISIONS row. **T1 has no class-A entry: a compiled artifact whose `file` family is uninspectable can never be pushed.**

**Exit codes, identical for every tier and every gate** (inherited from `verify-artifact.mjs`, which had this right — §1.4):

| Exit | Meaning | Emitted when |
|---|---|---|
| 0 | `pass` | every declared family covered, no failures, no uninspectable |
| 1 | `fail` | ≥1 failure, **or** zero coverage on a required family, **or** walked-but-never-checked, **or** an `expectEmpty` family that walked something |
| 2 | `usage` / no verdict | bad arguments, unreadable target, or a `CoverageArithmeticError`. **No result line is printed on exit 2** |
| 3 | `partial` | no failures, but ≥1 uninspectable pointer, or a requested tier reported `notRun` |

`g-exit-codes` asserts every file under `packages/verify/src/` that calls `process.exit` uses only `EXIT` from `coverage.mjs`, and that no file exits `EXIT.pass` on a path where any family has `failures.length > 0`.

#### 3.2.1 Tier summary

| Tier | File | Needs backend | Needs browser | Needs model | Enters `result` | Acceptance threshold |
|---|---|---|---|---|---|---|
| **T1 Schema** | `src/t1-schema.mjs` | no | no | no | yes | 0 failures on compiler output; 0 uninspectable unless the artifact's provenance is `ENVELOPE-SYNTHESISED`. < 500 ms for a 500-component form |
| **T2 Registry** | `src/t2-registry.mjs` | no | no | no | yes | 0 failures. Uninspectable permitted **only** for `T2.08` on a non-priority type (§3.2.3) |
| **T3 Semantic/graph** | `src/t3-semantic.mjs` | for 6 of 22 checks | no | no | yes | 0 failures. Every declared predicate evaluated. Uninspectable permitted only for the 6 backend-dependent checks with neither `--backend` nor `--metadata` |
| **T4 Live smoke** | `src/t4-smoke.mjs` | yes | yes (Playwright) | no | **no** | every action site clicked and its consequence asserted by a raw backend GET; `checked === walked`; 0 console errors |
| **T4b DOM residue** | `src/probe/layout-probe.mjs` + `src/t4b-residue.mjs` | yes | yes | no | **no** | 0 overflow-clip, 0 painted-overlap findings on the target viewport |
| **T5 Visual** | `src/t5-visual.mjs` | no | yes (screenshots) | yes | **never** | judge anchor accuracy ≥ 0.9 or the tier reports `notRun`; ≤ 3 rounds; 5-axis vector, never blended |

Every tier declares its family set with `families()` at the top of `run()`, exports `checks` (§3.5.2) and exports `mutations` (§3.5).

#### 3.2.2 T1 — Schema

**Inputs:** `<screen>.sfs.json` (optional), the compiled form (required), `<screen>.compiled.meta.json` (required unless `--legacy`).
**Command:** `node packages/verify/src/t1-schema.mjs <form.json> [--sfs <f>] [--meta <f>] [--legacy] [--seed] [--json]`
**Families:** `file` (unit: artifact, required), `sfsSchema` (SFS node, `required:false`), `markupSchema` (component, required), `structure` (component, required), `meta` (node, `required:false`).

| id | Check | Detail | Verdict on breach |
|---|---|---|---|
| T1.01 | artifact exists, non-empty, parses | Unwrap ABP envelope, double-stringified `Markup`, bare `{components,formSettings}`, bare array — max 4 hops (existing `readArtifact` logic, kept verbatim) | terminal; exit 2 |
| T1.01b | envelope provenance | If the meta sidecar or compile report records `provenance === "ENVELOPE-SYNTHESISED"` (Section 2 §2.5 `detect.mjs`), the `file` family pointer is `cannot("envelope was synthesised by detect.mjs; the 23 envelope fields are defaults, not observed", "T1.01b")` — never pass, never fail | uninspectable → partial |
| T1.02 | SFS validates against `packages/sfs/schema/sfs.schema.json` | ajv 8.17.1 + ajv-formats, `strict:true`, `allErrors:true`. One pointer per SFS node | fail |
| T1.03 | compiled markup validates against `packages/verify/schema/markup.schema.json` | Envelope: 23 top-level fields, `Id === OriginId`, `Access` mirrored in `formSettings.access`, `Markup` is a JSON **string** parsing to `{components, formSettings}` (§1.1 contract table). Skipped with `na("provenance ENVELOPE-SYNTHESISED")` on a synthesised envelope | fail |
| T1.04 | every component has a non-empty `id` | Renderer silently drops components without one | fail |
| T1.05 | no `id` is an unreplaced `{{TOKEN}}` | Under `--seed` these become one `notApplicable` note | fail |
| T1.06 | `id`s are unique, both sites named | | fail |
| T1.07 | every component has a non-empty `parentId`; every `parentId` resolves to an in-tree `id` or the literal `"root"` | The orphan-parentId case is new; the old script checked presence only | fail |
| **T1.08** | **ids are the stamped v5 hash, recomputed** | Two assertions per id, on compiler output: (a) it matches `^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` — RFC 4122 **version 5**, per Section 2 §2.4.2, which standardises on v5 because v5 is a hash and v4 is randomness; (b) it equals `nodeId(module, form, path)` recomputed from the sidecar's `sfsPath` for that node, using `SFS_ID_NAMESPACE` from `@shesha/sfs`. **A v4-shaped id, a nanoid, and a hand-edited hex digit all fail.** Under `--legacy` both assertions become one `notApplicable` note with the same explanatory text | fail (compiler output) / `notApplicable` (`--legacy`) |
| T1.09 | ≥1 component exists | zero components is a failure, never an empty pass | fail |
| T1.10 | the sidecar covers every component id, and every sidecar node id exists in the markup | Bidirectional. A sidecar that has drifted from its markup makes T2, T3 and every predicate untrustworthy | fail |

**Walker.** T1, T2 and T3 use **one** walker, `packages/verify/src/walk.mjs`, exporting `walkComponents(doc)`. It yields `{node, where, slot, parentNode}` for every component, reached through **every** container channel, not the literal key `components`:

```
components[]            any object
content.components[]    card, collapsiblePanel  (the single most-cited crash in the corpus)
header.components[]     card
items[]                 buttonGroup, datatable (columns), KeyInformationBar, tabs (when items-shaped)
columns[]               datatable, KeyInformationBar
tabs[]                  tabs
panels[]                collapsiblePanel groups
displayComponent / editComponent / createComponent   datatable column triplets — {type, settings:{…}}
```

The slot list is **data**: `load('0.45.1').slots`, generated from the registry, never hard-coded in the walker. `g-coverage-single-impl` fails on any second tree walker under `packages/verify/src/`. This closes §1.7 T5 (three broken nodes under `items`/`columns` produced `structure walked 3, checked 6, failures 0`) and §1.4's "five mutually inconsistent tree walkers".

#### 3.2.3 T2 — Registry (exhaustive, 22 checks)

**Inputs:** the compiled form, the sidecar, `load('0.45.1')`. **No backend. No network. No model.**
**Command:** `node packages/verify/src/t2-registry.mjs <form.json> [--meta <f>] [--ref 0.45.1] [--legacy] [--json]`
**Families:** `types` (component), `versions` (component), `props` (prop site), `valueTypes` (prop site), `enums` (enum site), `required` (required-prop slot), `slots` (component), `nested` (item), `deny` (prop site), `styling` (prop site), `breakpoints` (component), `formSettings` (setting key).

T2 replaces `validate-blocks.js` (deleted per §5) with exact registry matching and hard failures — §1.7 T2/T14: the old matcher was fuzzy free-text with two escape hatches that downgraded failures to warnings, and read Shesha style descriptors (`{type:'color'}`) as components.

**Registry-gap disposition, decided once and mechanically.** Each registry record carries `propsCompleteness ∈ {full, names-only, none}`, per-prop `valueType: string|null` and `authorable: boolean`. The **priority set** is the 13 types of Section 2 §2.8.4: `datatable`, `datalist`, `dropdown`, `button`, `buttonGroup`, `datatable.pager`, `checkbox`, `checkboxGroup`, `radio`, `timePicker`, `section`, `formAutocomplete`, `referenceListAutocomplete`. `load('0.45.1').priorityTypes` is that list; `g-registry-completeness` (Section 2, WP-2) asserts `length === 13`, all 13 `propsCompleteness !== "none"`, and every prop on all 13 carries a non-null `valueType`.

| Situation | Disposition |
|---|---|
| `propsCompleteness === "none"` on a **priority** type | `fail` — `registry gap on priority type <t>: propsCompleteness none. Fix the registry, do not widen the check.` |
| `propsCompleteness === "none"` on a non-priority type | `cannot("registry entry for <t> is propsCompleteness:none", "T2.04")` — **and** `T2.04` is *not* in the uninspectable budget, so it blocks a push |
| `valueType === null` on a prop of a **priority** type | `fail` |
| `valueType === null` on a prop of a non-priority type | `cannot("registry valueType unknown for non-priority type <t>.<prop>", "T2.08")` — class A |

| id | Check | Requirement source | Verdict on breach |
|---|---|---|---|
| T2.01 | every component `type` exists in `load(ref).components` | §1.4 "component `type` existence — never checked" | fail |
| T2.02 | every component `version` equals the registry's current version for that type | §1.4 "component `version` correctness — never checked"; §1.2#11 `collapsiblePanel` documented 8, reality 9 (D-037, D-110) | fail |
| T2.03 | `version` is an integer, not a string | §5: `standalone-create.json` ships `version: "1"` and 7 of 10 components versionless | fail |
| T2.04 | every prop key is legal for its type | Legal set = `ownProps ∪ resolvedProps ∪ IConfigurableFormComponent standard set`. Needs prop **names** only, which the `extends`/`resolvedProps` walk supplies for all 121 records — so this check is fully evaluated after WP-2 except on `propsCompleteness:none` (see the table above) | fail |
| **T2.05** | **`referenceListId` shape** | Exactly `{module, name}` with `name` a **bare** list name; a `.`-containing `name` fails; flat `module` / `referenceListName` keys on `refListStatus` fail (D-030, D-031; §1.2#1/#2; documented consequence `ConfigurationLoadingError` blocking the whole form) | fail |
| T2.06 | every `authorable:false` type is absent from the artifact | `columns`, `sizableColumns` and every record with `authorable:false` (D-035, D-112). §1.2#4: `columns` banned in 5 places, mandated in a 6th, present in 7 seeds | fail |
| T2.07 | declared required props present | `load(ref).requiredProps[type][]` — hand-authored in WP-2 from corpus mining (a prop present on 100% of corpus instances of that type), **not** inferred from framework `required` flags, which are unobtainable offline. One pointer per (component, declared required prop). A type with no record is `na("no declared required-prop record for <t>")`; `g-registry-completeness` asserts all 13 priority types have one and the `na` type count only falls | fail |
| T2.08 | prop **value types** correct | booleans are `true`/`false` not `"true"`; integers not numeric strings; `stylingBox` is an escaped JSON **string** that parses; code-mode props are `{_mode:"code",_code:string}`. Disposition per the gap table above | fail / uninspectable (class A) |
| T2.09 | every enum-valued prop's value is in domain | `load(ref).enums` | fail |
| T2.10 | slot placement legal | Children appear only in slots the registry declares. A `components[]` array on a type whose only child slot is `content.components` fails (`card`). §1.1: the single most-cited crash in the corpus | fail |
| T2.11 | nested item schemas satisfied | `datatable.items[]` require `columnType`, `propertyName`, `caption`, `sortOrder`; `width`/`minWidth` numeric; `displayComponent`/`editComponent`/`createComponent` are `{type, settings:{…version}}` with a legal type and current version. `buttonGroup.items[]` require `actionConfiguration`. `tabs.tabs[]` require key + title. `KeyInformationBar.columns[]` require a width channel | fail |
| **T2.12** | **deny list** | `load(ref).deny.props`: component-level `editMode` (D-032 — `editMode` is form-level only); `referenceListName` on any component; `customStyle.flex` (inert, §1.1); `fontSize`/`fontWeight` when `desktop.font` is present. Enforced regardless of `propsCompleteness` | fail |
| T2.13 | `(actionOwner, actionName)` is a legal pair | `load(ref).actionOwners`; `actionOwner` lowercase dotted or a component id; `actionName` spaced (`"Show Dialog"`). `"Shesha.Common"`/`"ExecuteScript"` fail (D-034, §1.2#9 — the exact strings `debug.md:21` blames for "button click fires nothing") | fail |
| T2.14 | single styling channel | A component carrying both legacy (`fontSize`, `fontWeight`) and v7 (`desktop.font.*`) channels for the same property fails. Defect class DC-05 | fail |
| T2.15 | no duplicated `stylingBox` | Present at base level **and** inside a breakpoint block fails. DC-06 | fail |
| T2.16 | breakpoint consistency | For each styling key: present in all three of `desktop`/`tablet`/`mobile` or in none; where the base level also carries the key, the three must not contradict it. DC-02, DC-03 | fail |
| T2.17 | no literal hex colours in compiler output | Colours arrive as resolved brand tokens with a `resolvedFrom` provenance entry; a literal hex means role resolution was bypassed. §1.2#13 measured 48 literal hexes vs 10 `$role:` references. Under `--legacy`, `notApplicable` | fail |
| T2.18 | no unresolved `$role:` token in output | The `bake-overlays.mjs` defect class: the literal string `"$role:doesNotExist"` written as a colour value (§1.4) | fail |
| T2.19 | flex containers declare `display` | A container with `flexDirection`/`gap` and no `display:"flex"` — the case three docs claimed `validate-blocks.js` failed and it warned | fail |
| **T2.20** | **`formSettings` key set legal for the form `kind`** | `load(ref).formSettings` maps `kind -> {allowed, forbidden}`. **`forbidden` means "present with a non-null value"** (D-033): for each key in `forbidden`, fail iff the key is present **and** `value !== null`. So the base block's `onBeforeDataLoad: null` on a `kind:list` form is legal, and a submit pipeline on the same form is not. Additionally fail on any key in neither `allowed` nor `forbidden`. `kind:list` forbids `dataSubmitterType`, `dataSubmittersSettings`, `onBeforeDataLoad`. DC-08 | fail |
| T2.21 | no stray `label` without `hideLabel` on non-input containers | DC-01 (`label: "Card1"` on the page shell) | fail |
| T2.22 | no fixed `height` on a page-shell card | DC-04 (`dimensions.height: "30px"` wrapping the whole page). A node whose sidecar `region === "page"` may not carry a `height` other than `auto`/unset | fail |

#### 3.2.4 T3 — Semantic / graph (exhaustive, 22 checks)

**Inputs:** the compiled form, the sidecar, optional SFS, an optional acceptance contract, and **one** metadata source: `--backend <url> --token <file>` (live) or `--metadata <snapshot.json>` (recorded — used by every test and every offline run). With neither, the six backend-dependent checks are `uninspectable` and the tier is `partial`.
**Command:** `node packages/verify/src/t3-semantic.mjs <form.json> --meta <f> [--sfs <f>] [--contract <plan.json>] [--metadata <snap>] [--backend <url> --token <f>] [--module <m>] [--json]`
**Families:** `bindings` (binding site), `references` (formId site), `reflists` (reference-list site), `actions` (action site), `data` (data component), `scripts` (script site), `templating` (mustache site), `formSemantics` (setting), `placement` (predicate), `tabs` (node), `columns` (column), `wiring` (node).

| id | Check | Needs backend | Verdict on breach |
|---|---|---|---|
| T3.01 | every binding `propertyName` exists on the bound entity | yes | fail; uninspectable without a metadata source |
| T3.02 | every binding is camelCase as the metadata spells it | yes | fail (D-036; §1.2#10: PascalCase `path` renders every cell blank) |
| T3.03 | datatype → component pairing legal | no (`load(ref).datatypeComponents` — the 9-row total function that lived in prose) | fail |
| T3.04 | no duplicate `propertyName` within one binding scope | no | fail. §1.4 named this explicitly as never checked |
| T3.05 | required entity properties for the form `kind` are present as inputs | yes | fail; uninspectable without a source |
| T3.06 | every `referenceListId` resolves | yes | fail; uninspectable without a source |
| T3.07 | every `formId: {name, module}` resolves via `FormConfiguration/GetByName`; an empty ABP `result` is a hard failure | yes | fail. **The moved `references` family of `verify-artifact.mjs`, with its retrospective test intact** |
| T3.08 | absent/empty/null `formId` on a component whose registry entry requires one (`datalist` row template, dialog actions) | no | fail. Where the registry does *not* require one, the site is walked and `cannot(...)` (§3.4 F3) |
| T3.09 | a `datalist` row-template form exists and is not the datalist's own form | yes | fail; uninspectable without a source |
| T3.10 | every `actionConfiguration.onSuccess` target resolves to an in-tree component id or a legal global action | no | fail. §1.4 "`onSuccess` targets — never checked" |
| T3.11 | every `actionOwner` that is an id resolves to an in-tree component of a type that owns that action | no | fail |
| T3.12 | every data component (`datatable`, `datalist`) has a `dataContext` ancestor carrying `entityType`, `sourceType`, `dataFetchingMode`, `defaultPageSize` | no | fail |
| T3.13 | `dataContext.entityType` equals the SFS `entity` | no | fail |
| T3.14 | exactly one primary action per action zone | no | fail |
| T3.15 | `validationErrors` present when the form has ≥1 required input and `kind ∈ {create, edit}` | no | fail |
| T3.16 | submit+exit pair correct for the hosting mode | dialog-hosted `create`/`edit` needs a submit and a cancel wired to the dialog close; page-hosted needs a navigate-away; `kind:list` must have neither | no | fail |
| T3.17 | every embedded script parses | `node --check` per script string, in a temp file, wrapped in the same async signature Shesha uses | no | fail. §1.4 "embedded script syntax — never checked" |
| T3.18 | every mustache expression's root is a known scope | `selectedRow`, `form`, `formArguments`, `globalState`, `data`, `contexts`; an unknown root fails | no | fail |
| T3.19 | exactly one navigation wiring per row-click surface | `onRowClick` code-mode **xor** `rowClickActionConfiguration`; a byte-identical `dblClickActionConfiguration` duplicate fails. DC-07 | no | fail |
| T3.20 | the compiled column set equals the contract's declared column set (order- and caption-sensitive) | no | fail. §1.4 "wrong column set" |
| T3.21 | **every contract predicate evaluates true** | no | fail (§3.3) |
| T3.22 | **tab assignment** — every node the contract assigns to a tab is under that tab in the compiled tree | no | fail. Moved here from T5 because the DOM probe cannot see inactive tabs (§3.3.4) |

**Backend degradation rule, and the only permitted form.** T3.01, T3.02, T3.05, T3.06, T3.07 and T3.09 are backend-dependent. Without `--backend` and without `--metadata`, each affected pointer is disposed `cannot("backend unavailable: <what was not resolved>", "<checkId>")`, the tier is `partial`, exit 3, and the report prints `A partial verdict is NOT a pass.` There is **no** flag that turns a backend-dependent check into a pass; the only thing a flag can do is let a human push knowingly, through `pushAdmissible`, whose reason patterns admit exactly these six ids.

#### 3.2.5 T4 — Live smoke, and T4b — DOM residue

**T4 command:** `node packages/verify/src/t4-smoke.mjs <run-dir>/screens/<screen>.verdict.json --base-url <url> --backend <url> --token <file> [--viewport 1440x900] [--selftest]`
**Needs:** Playwright (a `packages/verify` devDependency; installed by the operator with `npx playwright install chromium`, never by an npm script) + a live frontend + a live backend. When `playwright` is absent or `--base-url` is missing, T4 records `{"result":"notRun","reason":"…"}` and exits 3. It never exits 0 without having run.
**Families:** `render` (screen), `console` (message), `actions` (action site), `consequences` (action site), `reflistOptions` (control), `readOnlyValues` (control).

| id | Check | Detail |
|---|---|---|
| T4.01 | the screen renders at the target viewport, navigated the real way | table row → details, never a pasted `?id=` (documented 500 on subtable Crud/Create). Clear IndexedDB `form`/`form_lookup` before load, or a ghost of the previous build is measured |
| T4.02 | console is clean | 0 `error`-level messages; `consoleWarnings` is counted and printed and never affects the result |
| T4.03 | every action site in the compiled tree is clicked | `walked` = action sites from the sidecar. `checked` must equal `walked`; an unreachable control is `uninspectable`, never skipped |
| T4.04 | each action's **consequence** is asserted against a raw backend GET, never a toast | dialog opens → the dialog's form name is in the DOM; row navigates → URL and fetched entity id match; save persists → `GET /api/.../Get?id=` returns the written value. §4 L3 states this explicitly |
| T4.05 | every reference-list control's options populate | option count > 0 |
| T4.06 | read-only fields render values, not blanks | the `editMode: inherited` blank-render class |

**T4b DOM residue.** `layout-probe.mjs` (moved and ported to ESM per Section 1 §1.2) is a measurement instrument and asserts nothing. `t4b-residue.mjs` asserts over its output, and only over emergent residue:

| id | Check | Why it cannot be a tree predicate |
|---|---|---|
| T4b.01 | no overflow clipping | `scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1` on any container — the only observable of the `height: 30px` page-shell defect class in the rendered document |
| T4b.02 | no painted overlap between siblings | rect intersection area > 4 px² between two nodes sharing a parent, neither absolutely positioned |
| T4b.03 | no unintended wrap at the target viewport | a declared single-row container whose children occupy > 1 parent-relative y-band |
| T4b.04 | no text truncation on labels or captions | `scrollWidth > clientWidth` on a text node |

**Required changes to `layout-probe.mjs`** (§5 "keep, narrow"), each a hard requirement of WP-3c:

1. Capture `data-sha-c-name` on every node and emit it as `name`. Without it there is no handle back to a form component; node identity was a truncated 80-char text label.
2. Add `--summary`: ≤ 200 rows, ≤ 8 KB, containers and named nodes only. Unfiltered reads were 63–195K tokens (§1.3) and are now never fed to a model.
3. Emit `tabKey: null` with an explicit uninspectable reason (`"inactive antd tab panels are display:none and filtered by the visibility test"`) rather than omitting the field. §1.7 T15: an unmeasurable quantity is reported as unmeasurable, never asserted.
4. Delete `colSpan24`. The 24-grid is banned by the blueprint's own line 71 and the field invites the `ratio ≈ 18:6` contradiction (§1.3).
5. Replace `rowBand = round(y / 14)` on viewport-absolute `y` with **parent-relative** y clustering: bands are computed within one parent's direct children only. The old form split two controls on one visual row whenever they straddled a 14 px boundary, and merged unrelated containers at the same absolute y (§1.3).
6. Emit a `capabilities` block naming what the instrument cannot see: `{"tabAssignment": false, "fillVsFixedIntent": false, "appearance": false}`. `t4b-residue.mjs` refuses to evaluate any assertion whose dimension is `false` there, disposing it `uninspectable`.

**Fixture-driven, no browser:** T4b's tests run against recorded probe JSON in `fixtures/probe/`. T4's `--selftest` runs against the stub HTTP backend (the pattern already in `verify-artifact.test.mjs`) plus a recorded DOM snapshot. A real browser is required only in CI's optional `smoke` job, never in `npm run green`.

---

### 3.3 Placement as executable predicates

Today the placement gate is a model reading a 63–195K-token DOM probe against seven numbered English sentences, with no diff program anywhere in the repo (`layout-tree` appears in exactly one non-markdown file, a comment — §1.3). Strategy doc §4 L3: **95% of what those assertions state is a property of the compiled tree.** They become predicates, evaluated in milliseconds, at zero token cost, with no model and no browser.

#### 3.3.1 The provenance sidecar (compiler contract)

`<screen>.compiled.meta.json`, emitted by the compiler on every compile, validated against `packages/sfs/schema/compiled-meta.schema.json` (Section 3 owns the content). Section 2 §2.4.2 fixes the container shape as `{form, nodes: [...]}`; the fields below are the **complete required member set** of each `nodes[]` element.

```json
{
  "schemaVersion": 1,
  "form": "booking-details",
  "module": "boxfusion.test",
  "sfs": "booking-details.sfs.json",
  "provenance": "COMPILED",
  "registry": { "ref": "0.45.1", "commit": "3418e292f4422c1b515b78a16d67f20a4bae7db3" },
  "nodes": [
    {
      "id": "a1b2c3d4-1111-5222-8333-444444444444",
      "name": "notesPanel",
      "sfsPath": "/pageShell/booking-details/body/rail/notesPanel",
      "type": "card",
      "parent": "e5f6a7b8-1111-5222-8333-444444444444",
      "depth": 3,
      "region": "body",
      "tabKey": null,
      "cell": { "row": "rail", "index": 1, "count": 3, "sizing": "auto", "px": null, "reservePx": null },
      "rowGroup": { "row": "rail", "index": 1, "members": ["detailsPanel", "paymentsPanel", "notesPanel"] },
      "align": "start"
    }
  ]
}
```

- `name` is the stable SFS-level name and the join key for everything: predicates, contracts, T4 action sites, the DOM probe's `data-sha-c-name`.
- `sfsPath` is the exact string `nodeId()` hashes (Section 2 §2.4.2), which is what makes T1.08 a check on the stamping rather than on the format.
- `cell.sizing ∈ {fill, fixed, auto}` is **declared by the compiler, not inferred from CSS**. This is what makes ratio predicates sound: `getComputedStyle().gridTemplateColumns` resolves `minmax(0,1fr) 332px` to `962px 332px` and the `1fr` intent is unrecoverable from the DOM (§1.3). The compiler knows it because it wrote it.
- `cell.reservePx` records the `calc(100% - Npx)` reserve for a fill cell, so `ratio` is computable without parsing CSS strings.
- `tabKey` is the tab a node lives under, or `null`. The tree knows it exactly; the DOM cannot see it.
- `provenance ∈ {COMPILED, ENVELOPE-SYNTHESISED, LEGACY-RECONSTRUCTED}`. T1.01b reads it.

`--legacy` mode (decompiled corpus forms, no sidecar) reconstructs a partial sidecar by parsing `desktop.dimensions.width`: `calc(100% - Npx)` → `{sizing:"fill", reservePx:N}`, `Npx` → `{sizing:"fixed", px:N}`, `100%`/unset → `{sizing:"auto"}`, and sets `provenance: "LEGACY-RECONSTRUCTED"`. Any node whose sizing cannot be reconstructed is `uninspectable`, never assumed.

#### 3.3.2 Predicate API

**File: `packages/verify/src/predicates/tree.mjs`** — the accessors. **`packages/verify/src/predicates/index.mjs`** — the frozen predicate table, exporting `PREDICATES` (name → `(tree, args) => value`) and `evaluate(contract, tree, fam)`.

`openTree({markup, meta})` returns a `Tree` indexing the sidecar by `name`. The **18 predicate names** are the complete table. `registry_lookup {kind:"predicate"}` returns exactly these; a contract naming anything else is rejected by `assertions.schema.json`.

| Predicate | `args` | Returns |
|---|---|---|
| `cellCount` | `{row}` | number of cells in the row |
| `cellRow` | `{node}` | the row name the node is a cell of |
| `cellIndex` | `{node}` | its index within that row |
| `cellSizing` | `{node}` | `fill` \| `fixed` \| `auto` |
| `cellPx` | `{node}` | declared px for a `fixed` cell |
| `cellsEqual` | `{row}` | true when every cell has the same `sizing` and, for `fixed`, the same `px` |
| `ratio` | `{a, b}` | declared-intent width ratio (below) |
| `parent` | `{node}` | parent's `name` |
| `ancestors` | `{node}` | `name[]`, nearest first |
| `depth` | `{node}` | integer |
| `region` | `{node}` | `page` \| `header` \| `body` \| `rail` \| … |
| `tab` | `{node}` | `tabKey` or `null` |
| `rowGroupSizes` | `{container}` | `number[]`, one per row group of the container's direct children |
| `rowGroupMembers` | `{node}` | `name[]` sharing the node's row group |
| `nextSibling` | `{node}` | next sibling's `name` |
| `align` | `{node}` | `start` \| `center` \| `end` \| `between` |
| `componentType` | `{node}` | compiled component `type` |
| `count` | `{type}` | number of components of that type in the tree |

Semantics, fixed:

- A predicate on an **absent node** returns the sentinel `ABSENT`, and the evaluator disposes that pointer `fail` with `node "<name>" is not in the compiled tree`. A named node that does not exist is a failed assertion, never an uninspectable one — the design says it must exist.
- Only a **dimension the tree does not model** is `uninspectable`. In the compiled tree that set is exactly: painted geometry, overflow, colour fidelity. Nothing else.
- `ratio(a, b)` computes from `cell.sizing` at a reference container width of **1440 px** (the pinned capture viewport): `fixed` → `px`; `fill` → `1440 − Σ(fixed siblings) − reservePx`; `auto` → equal share of the remainder. Returns `ABSENT` if either node is not a cell of the same row. **It is a declared-intent ratio, never a measured one.**

#### 3.3.3 Contract format and the eighteen predicate rows

A contract predicate is **declarative data**, authored by the Planner into `plan.json` at `screens[].acceptance[]` in Section 4 §4.2's shape `{id, tier, predicate, args, expect, severity, blockedBy}`, schema-validated by `packages/verify/schema/assertions.schema.json`, and evaluated by `PREDICATES`. There is no `eval`, no dynamic import and no free-text matching. **One predicate row is one pointer in the `placement` family and one entry in `verdict.predicates[]`** — compound `all:[]` clauses do not exist, because they make one pointer carry several independent truths and destroy the arithmetic's meaning.

`expect` is exactly one comparator: `{eq}`, `{neq}`, `{gte}`, `{lte}`, `{within:[lo,hi]}`, `{oneOf:[]}`, `{includes}`, `{includesAll:[]}`, `{everyEq}`, `{isNull:true}`, `{notNull:true}`.

**`verify` evaluates every predicate.** No agent authors, alters or omits a predicate result; the Evaluator reports them verbatim and its only authored field is `findings[].owner` (Section 4 §4.1.4). `g-verdict-integrity` recomputes every `verdict.predicates[]` entry from the form + sidecar + contract and fails on any difference.

The seven English sentences of `blueprint-ir.md:144–150` become **18** predicate rows over `clean/booking-details` (the main/rail screen) and `clean/requirement-detail-tabs` (tabs). Node names are fixed by the fixtures: `page`, `headerBand`, `pageTitle`, `headerActions`, `kib`, `body`, `main`, `rail`, `detailsCard`, `paymentsPanel`, `notesPanel`, `requirementsCard`.

| id | Old English sentence | Predicate row |
|---|---|---|
| A1.1 | *body is a 2-column split* | `{"predicate":"cellCount","args":{"row":"body"},"expect":{"eq":2}}` |
| A1.2 | *left:right ratio ≈ 18:6 (left ≥ 2.5× right)* | `{"predicate":"ratio","args":{"a":"main","b":"rail"},"expect":{"gte":2.5}}` — the `18:6` 24-grid expression is **deleted, not translated**: it is the contradiction the blueprint bans at its own line 71 |
| A1.3 | *right rail ≈ 332px fixed* | `{"predicate":"cellSizing","args":{"node":"rail"},"expect":{"eq":"fixed"}}` |
| A1.4 | (same) | `{"predicate":"cellPx","args":{"node":"rail"},"expect":{"within":[292,372]}}` |
| A1.5 | *left fills* | `{"predicate":"cellSizing","args":{"node":"main"},"expect":{"eq":"fill"}}` |
| A2.1 | *the related panels are BOTH in the RIGHT column* | `{"predicate":"cellRow","args":{"node":"paymentsPanel"},"expect":{"eq":"rail"}}` |
| A2.2 | (same) | `{"predicate":"cellRow","args":{"node":"notesPanel"},"expect":{"eq":"rail"}}` — "same x-cluster" becomes exact row identity |
| A2.3 | *stacked vertically* | `{"predicate":"rowGroupMembers","args":{"node":"notesPanel"},"expect":{"neq":"paymentsPanel"}}` — distinct row groups in one column |
| A3 | *the capture card is in the LEFT column, not the rail* | `{"predicate":"ancestors","args":{"node":"requirementsCard"},"expect":{"includes":"main"}}` |
| A4 | *the Details card rows are 2-cell, not full-width stacked* | `{"predicate":"rowGroupSizes","args":{"container":"detailsCard"},"expect":{"everyEq":2}}` — replaces `rowBand` y-quantisation, which could not distinguish "two controls on one row" from "two controls straddling a 14 px boundary" (§1.3) |
| A5 | *nesting: the panels are children of the rail, not of the page root* | `{"predicate":"parent","args":{"node":"notesPanel"},"expect":{"eq":"rail"}}` |
| A6.1 | *the KIB is a single flex row of 6 equal cells* | `{"predicate":"cellCount","args":{"row":"kib"},"expect":{"eq":6}}` + `{"predicate":"cellsEqual","args":{"row":"kib"},"expect":{"eq":true}}` + `{"predicate":"componentType","args":{"node":"kib"},"expect":{"eq":"KeyInformationBar"}}` (three rows: A6.1–A6.3) |
| A6.4 | *directly under the header band* | `{"predicate":"nextSibling","args":{"node":"headerBand"},"expect":{"eq":"kib"}}` |
| A7 | *header actions right-aligned on the title row* | `{"predicate":"align","args":{"node":"headerActions"},"expect":{"eq":"end"}}` + `{"predicate":"rowGroupMembers","args":{"node":"headerActions"},"expect":{"includes":"pageTitle"}}` |
| A8 | *(new — the thing the DOM cannot see)* | `{"predicate":"tab","args":{"node":"endpointsTable"},"expect":{"eq":"Endpoints"}}` on `requirement-detail-tabs` |

Two rules follow and are enforced by `assertions.schema.json`:

1. **No absolute-pixel `eq`.** A pixel-valued predicate (`cellPx`) accepts only `within`. `verification-loop.md`'s "never assert absolute pixels" survives as the comparator: `within [292, 372]` is the machine form of "≈ 332 px ± 40".
2. **Fuzziness is deleted, not translated.** "same x-cluster", "≈ 18:6", "wrong cluster / wrong parent / wrong tab / ratio out of range" become exact identities on declared structure. There is no tolerance parameter anywhere except `within`.

`g-no-prose-assertions` fails on any `.md` under `plugins/**` containing a fenced ` ```assertions ` block, and on any contract predicate whose `predicate` is not a key of `PREDICATES`.

#### 3.3.4 What remains for the DOM probe, and what moves

**Moves to T3 (tree):** cell membership, parent/ancestor chain, nesting depth, row grouping, declared split ratio, fill-vs-fixed intent, equal-cell rows, sibling order, alignment, and — decisively — **tab assignment**. Tab assignment moves because the probe **cannot** see it: it has no `tabKey` field and an inactive antd tab panel is `display:none`, filtered out by its own visibility test (§1.3). `tabs` and `collapsiblePanel` also have zero rows in the capability matrix, so there is no measured basis for a DOM-side rule.

**Remains with the DOM probe (T4b, advisory, never enters `result`):** exactly the four checks of §3.2.5 — overflow clipping, painted overlap, unintended wrap, text truncation. These depend on rendered text metrics and the browser's box model, which no tree predicate can compute.

**Never asserted by either instrument:** colour, font rendering, background, border, radius, shadow, gap and padding fidelity — the probe captures **no appearance at all** (§1.3), yet the critic agent was instructed to read it for "exact gaps, widths… It is measurement; prefer it over your eye." Appearance goes to T5, as a ranked signal, and nowhere else.

---

### 3.4 Fixes to the two scripts being kept

Both are kept per §5, moved per Section 1 §1.2, and un-quarantined by the WP that fixes them (`quarantine.json`, Section 5 §5.2). Neither is rewritten; each fix names the test that proves it.

#### 3.4.1 `verify-artifact.mjs` → `t1-schema.mjs` + `t3-semantic.mjs`

All 15 existing tests survive: 13 move unchanged, and exactly 2 (`nanoid ids are accepted…`, `an empty-string formId…`) are re-pointed under a `Test change:` DECISIONS row with their old assertions kept alive behind `--legacy`. The count goes 15 → 17 and never down (`g-test-ratchet`). `file`/`structure` tests → `packages/verify/test/t1-schema.test.mjs`; `references` tests → `packages/verify/test/t3-semantic.test.mjs`.

| Fix | Current defect (strategy doc) | Change | Test that must be added |
|---|---|---|---|
| **F1 — zero-coverage rule in `verdictOf`** | §1.4: `verdictOf` has three lines and no coverage rule. A form whose `formId` is `""`, `null` or absent is never walked → `walked 0, checked 0, verdict: pass, exit 0` | Delete the local `verdictOf`. Import it from `coverage.mjs`, which carries R1. Declare `references` `required: true` | `t3-semantic.test.mjs`: `test('a form with no resolvable references reports fail, not a zero-coverage pass')` — 3 fixtures (`formid-absent`, `formid-empty-string`, `formid-null`), each asserting `result === 'fail'`, exit 1, and a `NO COVERAGE — references` line |
| **F2 — walk every child channel** | §1.4: `collectComponents` reads arrays under the literal key `components` only; three broken nodes under `items` (buttonGroup) and `columns` (datatable) produced `structure walked 3, checked 6, failures 0` — coverage claimed for territory never visited | Delete `collectComponents`. Use `walkComponents` from `walk.mjs`, driven by `load(ref).slots` | `t1-schema.test.mjs`: `test('broken nodes under items and columns are walked, not invisible')` — the exact reproduction, asserting `structure.walked >= 6` and `failures.length === 3`; plus `test('a card child in components instead of content.components is a slot failure')` |
| **F3 — absent/empty `formId` is walked** | §1.4: `collectFormRefs` skips `formId` when the value is `null`, `undefined` or `""`, so the site is never walked at all — the pointer vanishes and the family reports nothing | Walk **every** `formId` key occurrence. Where the registry does not require one: `cannot('formId is absent/empty — nothing to resolve; the component that needs it renders empty', 'T3.08')`. Where it does: `fail` | `t3-semantic.test.mjs`: `test('an empty-string formId is walked and reported uninspectable, never skipped')` (`references.walked === 1`, `uninspectable.length === 1`, `partial`, exit 3) and `test('a datalist with an absent formId fails because its registry entry requires one')` (`fail`) |
| **F4 — the non-UUID note stops producing permanent partial** | The `nonUuid` note calls `cannotInspect`, so every real form with nanoid ids reads `partial` forever; a gate that is always amber gets muted | On compiler output, T1.08 is a **fail** with both the v5-shape and the recomputed-`nodeId` assertions. Under `--legacy` it is `notApplicable` with the old explanatory text | `t1-schema.test.mjs`: the existing `test('nanoid ids are accepted as legitimate, only reported as unjudged coverage')` is re-pointed at `--legacy`, asserting `notApplicable.length === 1` and `pass`; new `test('a nanoid id in compiler output is a hard failure')`; new `test('a v4-shaped id in compiler output is a hard failure')`; new `test('an id differing from nodeId(sfsPath) by one hex digit fails in family structure')` |
| **F5 — one guarded JSON reader** | The script's own read path was fine; its siblings' were not | Route the artifact read through `readJsonGuarded` so failure text is uniform across tiers | `t1-schema.test.mjs`: existing `test('a non-JSON file is an error naming the parse problem')` extended to assert exit 2 and zero `result:` lines in output |

#### 3.4.2 `check-references.mjs` → `packages/verify/src/gates/g-check-references.mjs`

Kept because it catches doc rot, which still exists for the thin skills (§5).

| Fix | Current defect | Change | Test that must be added |
|---|---|---|---|
| **C1 — declare the 8 families up front, with two `expectEmpty`** | §1.4: families are created lazily by `fam(name)`; rewording two files moved 9 agent-dispatch pointers from `checked 9` to **unmentioned**, still `PASS` | Delete the lazy `fam()`. One `families([...])` call at the top: `links`(link), `paths`(path), `skills`(skill id), `agents`(dispatch), `roles`(role token), `groups`(type) all `required:true`; **`overlays`(block) and `versions`(version claim) `expectEmpty:true`** citing `D-010`/`D-018` and `D-037` — block overlays are absorbed into compiler recipes and `bake-overlays.mjs` is deleted, and no version integer may appear in any instruction file, so a walked pointer in either family means a deleted population has returned (R4) | `test('a family whose pattern stops matching reports walked 0 and fails, never vanishes')` (delete the 9 `` `shesha-developer:x` agent `` dispatch phrases; assert `agents` present with `walked === 0` and `fail`); `test('re-introducing a version integer into a skill doc fails the versions family')`; `test('re-introducing a block overlay file fails the overlays family')` |
| **C2 — reconcile the arithmetic** | §1.4: `skills` 40/29 with 11 unaccounted; `roles` 7 walked / 14 checked (one token, two themes) | Convert every family to `pointer()`. `skills`: the 11 unaccounted become explicit `na()`. `roles`: one pointer per token, `p.check()` per theme, so `assertions` is 14 and `checked` is 7 | `test('roles coverage reconciles as walked 7 checked 7 assertions 14')`; `test('every skills pointer receives a disposition')` (R3 on live repo data) |
| **C3 — guard `readJson`** | §1.4: crashes with an uncaught `SyntaxError` and **no verdict** on a malformed data JSON, indistinguishable by exit code from a real failure | Replace all 9 `readJson` call sites with `readJsonGuarded(file, fam, where)`. A malformed data file is one named `failures[]` entry → exit 1 **with** a result. Only `CoverageArithmeticError` or bad arguments exit 2 | `test('a malformed groups/index.json is a named failure with a verdict, not an uncaught SyntaxError')` — exit 1, a `groups` failure naming the file, stdout contains `result: FAIL` |
| **C4 — keep `notApplicable` out of the verdict, in the report** | Already correct; preserve it | unchanged | existing `test('a markdown-syntax example link is notApplicable, not a failure')` |
| **C5 — conform to the gate contract** | It was a standalone script, not a gate | Export `id`, `describe`, `inputPaths`, `run(ctx)`, `mutations` (the 8 existing injections, each gaining `covers`) | `g-gate-contract`; `mutation-meta.test.mjs` runs the 10 (8 + the two R4 mutations) |

`tests/check-references.negative.mjs` becomes `packages/verify/test/gates/g-check-references.mutation.test.mjs` and its 8 injection cases become the gate's `mutations[]`. Its temp-dir copy discipline, baseline-clean precondition and `reset()`-per-case determinism are the pattern the whole repo follows.

#### 3.4.3 The six run-dir gates

`g-specwriter-purity`, `g-hook-liveness`, `g-verdict-integrity`, `g-run-dir-location` and `g-blocked-honesty` read `runs/**`, which is gitignored and empty until WP-8. A gate wired into nothing is banned behaviour T7. Therefore:

- **One synthetic run is committed as a fixture:** `packages/sfs/test/fixtures/run/` (5 files, §3.7). Every one of the five gates declares `inputPaths = ['packages/sfs/test/fixtures/run', 'runs']`, walks the fixture run **plus** any real runs, declares its family `required: true` with floor 1, and ships ≥ 2 mutations over the fixture. Each gate's `describe` ends with `real-run coverage is additive`.
- **`g-retro-ingested` is deleted.** Its subject, `docs/retrospectives/`, is Phase 5 and does not exist. Re-creating it is `BL-030`.

---

### 3.5 The mutation-test standard

Generalised from `tests/check-references.negative.mjs`, the only artifact in the repo that proves a gate fails when it should (§5).

#### 3.5.1 The rule

**Every gate and every tier ships a negative test that injects one real defect per check class and asserts the gate FAILS.** A check class with no mutation does not exist as far as the repo is concerned: `g-mutation-coverage` fails when any id in a tier's exported `checks` is absent from the union of that tier's `mutations[].covers`.

#### 3.5.2 Declaration contract

```js
export const id = 't2-registry';
export const describe = 'types, versions, props, enums, slots, nested items, styling channels, breakpoints, formSettings';
/** Paths this module reads. mutation-meta.test.mjs copies only these plus the repo's tracked source. */
export const inputPaths = ['packages/sfs/test/fixtures', 'packages/registry/data'];

/** The check registry. Every id here must be covered by >= 1 mutation and >= 1 fixture. */
export const checks = [
  { id: 'T2.01', family: 'types',    describe: 'component type exists in the registry' },
  { id: 'T2.02', family: 'versions', describe: 'component version is current' },
  // …one row per check in §3.2.3. Exactly 22 rows.
];

/** @returns {Promise<Family[]>} */
export async function run(ctx) { /* ... */ }

/**
 * Each mutation must flip the result. `expect` may only be 'fail' or 'partial';
 * `expect:'pass'` is rejected by g-gate-contract — a mutation that leaves a gate
 * green is not a test, it is a demonstration that the check is absent.
 */
export const mutations = [
  {
    name: 'unknown component type',
    kind: 'fixture',                              // 'fixture' | 'repo'
    covers: ['T2.01'],
    fixture: 'clean/bookings-table.expected.form.json',
    apply: async (tmpFile) => { /* set components[0].type = 'ghostField' */ },
    expect: 'fail',
    expectFamily: 'types',
  },
];
```

#### 3.5.3 Harness shape and the copy protocol

**File: `packages/verify/test/mutation-meta.test.mjs`** — a `node --test` file, so it runs under both `npm test` and `npm run gates:mutate`.

```js
// 1. Discover every module under src/gates/g-*.mjs and src/t{1,2,3,4,5}*.mjs.
// 2. For each module:
//      a. mutations.length >= 2                              (g-gate-contract also asserts this)
//      b. every checks[].id appears in some mutations[].covers
//      c. run unmutated against its baseline; assert result === 'pass'
//         -> a dirty baseline aborts with exit 2 and "BASELINE NOT CLEAN — fix that before trusting this test"
//      d. per mutation: fresh temp workspace -> apply -> run -> assert
//            result === mutation.expect
//            the named expectFamily carries >= 1 failure (or uninspectable, for expect:'partial')
//            exit code === EXIT[mutation.expect]
// 3. Print one line per mutation: `caught | MISSED  <module> <mutation.name> covers=[…] exit=N`
// 4. Print `<caught>/<total> defect classes caught` and `mutation suite <N>s / budget 180s`.
//    caught < total  -> fail.   N > 180 -> fail.
```

**The temp workspace, specified numerically because the naive form is unaffordable on NTFS with Defender.** `kind:'fixture'` copies **one file**. `kind:'repo'` builds the workspace as:

1. `git ls-files -z` → copy only tracked files, with these exclusions: `node_modules/`, `.git/`, `.build/`, `runs/`, `packages/sfs/corpus/`, `packages/verify/anchors/`.
2. `fs.symlinkSync(<root>/node_modules, <tmp>/node_modules, 'junction')`. **`'junction'` is mandatory on Windows**; `'dir'` requires administrator. Without it `ajv` and `@shesha/*` do not resolve, because Node resolves upward from the file and `os.tmpdir()` has no ancestor `node_modules`.
3. Temp dirs go to `os.tmpdir()`, never inside the tree being copied.

Rules the harness enforces, each a hard failure:

1. Fresh workspace **per mutation**. No mutation may observe another's edit.
2. Baseline clean before any mutation runs.
3. `expect ∈ {'fail','partial'}` only.
4. `mutations.length >= 2` per module.
5. Every `checks[].id` covered.
6. The mutation must be caught **by the named family**. A mutation that fails the run for an unrelated reason is a MISSED, not a caught. This is what stops the harness certifying a gate that fails everything.
7. `git status --porcelain` byte-identical before and after the whole suite.
8. Whole-suite wall clock ≤ **180 s**, printed as the last line (Section 1 D-026).

#### 3.5.4 Where the suites run

- `packages/verify/package.json` → `"test": "node --test test/"`, and `test/mutation-meta.test.mjs` + `test/gates/*.mutation.test.mjs` live under `test/`. So `npm test --workspaces` runs the negative suites.
- `npm run gates:mutate` runs the same file directly for a standalone signal.
- `npm run green:fast` (pre-commit) = typecheck + tests + gates. `npm run green` = `green:fast` + `gates:mutate`, used by CI and `npm run prove` (Section 1 D-026).
- `g-gate-ratchet` and `g-test-ratchet` count only artefacts with ≥ 1 verdict-flipping mutation, so a gate that cannot fail was never in the count.

**Gates this section adds to Section 1's WP-0 set:** `g-mutation-coverage`, `g-fixture-manifest`, `g-defect-class-coverage`, `g-uninspectable-budget`, `g-family-declaration`, `g-no-prose-assertions`, `g-judge-isolation`, `g-t5-advisory`. Each ships ≥ 2 mutations. Each is registered in `packages/verify/config/gate-owner.json` with the WP that creates it; no gate in this list exists before its subject does.

---

### 3.6 T5 — Visual: rules

**File: `packages/verify/src/t5-visual.mjs`. Needs:** screenshots + a model. **Never enters `result`, never blocks a merge, never blocks a push.** Exit code is always 0 unless arguments are bad (2). Output: `<run-dir>/screens/<screen>.t5.json`, and `verdict.tiers.T5` records only `{result, reason}` plus `detail.advisory`.

| Rule | Specification | Source |
|---|---|---|
| **T5-R1 — anchor-reference list-wise protocol** | Before any candidate is judged, the judge sees K = 4 candidates for a screen whose ground-truth design exists. The anchor is embedded **anonymously**: same naming (`candidate-1.png`…`candidate-4.png`), same metadata, random position, no provenance in the prompt. The judge ranks list-wise. **A judge that fails to rank the anchor first is DISQUALIFIED** and produces no score: T5 writes `{"result":"notRun","reason":"judge <model> anchor accuracy X < 0.9"}` | §4 L3; measured spread between two frontier models ~100% vs ~35% |
| **T5-R2 — qualification threshold and cadence** | 10 anchor trials from `packages/verify/anchors/`. Qualification requires anchor-first in **≥ 9 of 10**. Re-qualify on a change of judge model, a change of `rubric.v1.json`, or a new anchor. Result written to `packages/verify/anchors/qualification.json` with model id, date and per-trial rank | §4 L3; §8 risk row: if no available model passes the anchor test on your designs, T5 stays advisory and visual sign-off stays human — state that honestly |
| **T5-R3 — rubric binding** | Every score is produced against `packages/verify/config/rubric.v1.json`: explicit axes, level descriptors 1–5 per axis, an evidence requirement per score. The judge emits `{score, evidence}` per axis; an empty `evidence` discards the score and the axis is `uninspectable` | §4 L3: human agreement 77–87% with rubrics vs 59–67% without |
| **T5-R4 — judge independence** | The judge runs in a **fresh context** and commits its assessment to `t5.round<N>.judge.json` **before** any builder claim is read. The builder's `__SAA_RESULT__` self-report never enters the judge's context — not as text, not as a path, not summarised. The judge's input is a whitelist: the screenshot(s), the anchor set, `rubric.v1.json`, the target design source. Nothing else. `g-judge-isolation` fails on any occurrence of `__SAA_RESULT__`, `self-report`, `selfVerification` or `builderClaim` in the judge prompt-assembly path (`src/t5-visual.mjs`, `plugins/**` judge/critic agent definitions) and on any judge input outside the whitelist | §4 L3 and §5: false positives 0.719 → 0.012 with independence; §1.7 T13 records the current harness feeding the self-report to the evaluator |
| **T5-R5 — 3-round cap** | ≤ **3** judge rounds per screen. Round N+1 only if round N produced ≥ 1 actionable finding routed to an owner. The fourth invocation exits 2 with `round cap 3 exceeded`. Rounds are recorded, never overwritten | §4 L4: visual refinement saturates at N = 3–5; more search iterations do not reliably remove reward hacking and sometimes amplify it |
| **T5-R6 — a vector, never a blend** | 5 orthogonal axes stored as a vector. No weighted total is computed, stored or printed. Regression on any axis is reported individually | §4 L5: MobileForge's axes surfaced an *inverse* correlation between visual quality and maintainability that a blended score would have hidden |
| **T5-R7 — no pixel diffing** | Naive pixel diff scores 0.00% no-change accuracy, 6.72% with anti-aliasing tolerance. T5 uses the rubric-bound judge plus structural diffing over the compiled tree (T1–T3's job) | §4 L3 |
| **T5-R8 — ranking signal only** | T5 feeds (a) the run report, (b) the judge–truth gap ledger, (c) routing of visual findings to an owner. It never sets `result`. `gate-push.mjs` contains no reference to `t5`. **No actor may downgrade a recorded result from a T5 finding** (D-015) | §4 L3: "T5 is a ranking signal, never a gate" |
| **T5-R9 — publish the judge–truth gap** | `packages/verify/anchors/judge-truth-gap.json` records, per release, N hand-verified screens, the judge verdict, the hand verdict, and the gap. A release with no entry for the current version makes `g-t5-advisory` print `judge-truth gap: unrecorded for <version>` and fail | §4 L5: "If you cannot state that number, you do not know whether your gates work" |

**Tests (`packages/verify/test/t5.test.mjs`), no model required** — the judge is injected as a function and stubbed:

1. `test('a judge that ranks the anchor second is disqualified and T5 reports notRun')`
2. `test('anchor position is randomised and carries no provenance in the prompt')`
3. `test('an axis score with empty evidence is discarded as uninspectable')`
4. `test('the judge prompt never contains __SAA_RESULT__ even when the run dir has one')`
5. `test('a fourth round exits 2')`
6. `test('no blended total appears anywhere in t5.json')`
7. `test('t5 exits 0 on a fail-grade score')`
8. `test('verdict.result is byte-identical whether t5 reports the best or the worst possible score vector')` — the D-015 property

---

### 3.7 Fixtures plan

**Location: `packages/sfs/test/fixtures/`** (Section 2's canonical test root), exported from `packages/sfs/package.json` as `"./test/fixtures/*": "./test/fixtures/*"` so `packages/verify` imports by package path (legal direction).

**The requirement this satisfies: everything in §3.1–§3.6 is testable with NO backend, NO browser, NO model and NO network.** Achieved by four recordings — a metadata snapshot, a form-existence snapshot, a probe snapshot and a synthetic run — plus a stub HTTP server for the paths where the real HTTP shape matters.

**Every count in this section lives in `packages/verify/config/fixture-floors.json` and nowhere else.** `g-fixture-manifest` reads that file; no count is repeated as a literal in prose, in a gate, or in an acceptance command.

```json
{
  "screens": 10,
  "artifactsPerScreen": 4,
  "structuralEscapeScreens": ["raw-escape-demo"],
  "dirs": {
    "clean":     { "files": 40, "bytesCap": 98304  },
    "envelope":  { "files": 6,  "bytesCap": 32768  },
    "coverage":  { "files": 8,  "bytesCap": 32768  },
    "t1":        { "files": 7,  "bytesCap": 32768  },
    "t2":        { "files": 23, "bytesCap": 32768  },
    "t3":        { "files": 22, "bytesCap": 32768  },
    "placement": { "files": 9,  "bytesCap": 32768  },
    "metadata":  { "files": 4,  "bytesCap": 65536  },
    "probe":     { "files": 5,  "bytesCap": 16384  },
    "legacy":    { "files": 2,  "bytesCap": 262144 },
    "run":       { "files": 5,  "bytesCap": 32768  }
  },
  "total": 131
}
```

The caps are set from the measured production density (§1.1: 19,170 B for 12 components ≈ 1.6 KB/component including three breakpoint blocks), not from a round number: a ~40-component screen is ~64 KB of markup, so `clean/` is 96 KB; `legacy/` holds full envelopes with double-stringified `Markup` and is 256 KB; `t1|t2|t3|coverage|envelope|placement|run` are hand-minimised single-defect fixtures and are 32 KB, which is a design constraint on them, not an accident; `probe/` is 16 KB because `--summary`'s own budget is 8 KB.

```
packages/sfs/test/fixtures/
  index.json                     the manifest. Machine-checked by g-fixture-manifest
  clean/                         10 screens x 4 artifacts = 40 files.
                                 The 10 screens ARE Section 4 §4.4.2's 10 worked examples — one set, not two:
                                 bookings-table booking-create booking-details booking-edit-modal
                                 requirement-detail-tabs fleet-dashboard passengers-datalist
                                 crew-inline-table link-existing-crew raw-escape-demo
                                 per screen: <s>.sfs.json  <s>.expected.form.json
                                             <s>.expected.meta.json  <s>.expected.counts.json
                                 booking-details carries headerBand/headerActions/pageTitle, a kib band of
                                 6 equal cells, body[main:fill, rail:332px] and a rail of 3 panels — it is
                                 the A1-A7 subject. requirement-detail-tabs is the A8 (tab) subject.
                                 raw-escape-demo is the ONLY screen whose expected.counts.json reports
                                 structuralEscapes >= 1.
  envelope/                      T1.01 - 6 files
    abp-double-stringified.json  bare-array.json  bom-prefixed.json  empty.json
    not-json.json  nested-markup-broken.json
  coverage/                      the R1/R3/R4 and walker holes - 8 files
    formid-absent.json  formid-empty-string.json  formid-null.json
    formid-bare-guid.json  formid-code-mode.json
    broken-under-items.json      3 defective nodes under buttonGroup.items
    broken-under-columns.json    3 defective nodes under datatable.items + column triplets
    zero-components.json
  t1/                            7 files
    missing-id.json  duplicate-id.json  missing-parentid.json  orphan-parentid.json
    unstamped-token.json  legacy-nanoid-ids.json  v4-shaped-id.json
  t2/                            one per T2 check id + 1 positive - 23 files
    T2.01-unknown-type.json           T2.02-stale-version.json      T2.03-version-as-string.json
    T2.04-unknown-prop.json           T2.05-reflist-qualified-name.json
    T2.06-banned-columns.json         T2.07-missing-required-prop.json
    T2.08-boolean-as-string.json      T2.09-enum-out-of-domain.json
    T2.10-card-children-in-components.json   T2.11-column-missing-columntype.json
    T2.12-component-editmode.json     T2.13-actionowner-pascalcase.json
    T2.14-dual-styling-channel.json   T2.15-duplicated-stylingbox.json
    T2.16-breakpoint-divergence.json  T2.17-literal-hex.json
    T2.18-unresolved-role-token.json  T2.19-flex-without-display.json
    T2.20-list-form-with-submit-pipeline.json   (non-null dataSubmitterType -> fail)
    T2.20b-list-form-null-hooks.json            (onBeforeDataLoad: null -> PASS; proves D-033)
    T2.21-stray-label-no-hidelabel.json  T2.22-page-shell-fixed-height.json
  t3/                            one per T3 check id - 22 files, T3.01..T3.22, named <id>-<slug>.json
                                 T3.21's subject is placement/ ; its file is T3.21-predicate-fails.json
  placement/                     9 files
    booking-details.acceptance.json         A1.1-A7 + A8 as declarative rows
    A1-fail-ratio.expected.meta.json        rail changed to sizing:"auto"
    A2-fail-cellrow.expected.meta.json      notesPanel moved to row "body" index 0
    A3-fail-rail.expected.meta.json         requirementsCard moved into the rail
    A4-fail-rowgroup.expected.meta.json     detailsCard row groups of size 1
    A5-fail-parent.expected.meta.json       panels reparented to "page"
    A6-fail-cellcount.expected.meta.json    kib with 5 cells
    A7-fail-align.expected.meta.json        headerActions align "start"
    absent-node.expected.meta.json          a predicate naming a node not in the tree
  metadata/                      the NO-BACKEND substrate - 4 files
    boxfusion.test.snapshot.json   entities: Booking, ViewDefinition, ViewRequirement - names, datatypes,
                                   required flags, FK targets
    reflists.snapshot.json         boxfusion.test/BookingStatus + 3 others, with options
    forms.snapshot.json            the {module,name}[] that exist - the offline FormConfiguration/GetByName
    snapshot.meta.json             {recordedAt, backend, registryRef} - so a stale snapshot is visible
  probe/                         the NO-BROWSER substrate for T4b - 5 files
    booking-details.probe.json           recorded layout-probe --summary output, clean
    booking-details.probe.overflow.json  scrollWidth > clientWidth on the page-shell card
    booking-details.probe.overlap.json   two siblings with intersecting rects
    booking-details.probe.wrap.json      a declared single-row container across 2 y-bands
    booking-details.probe.no-name.json   nodes missing data-sha-c-name -> uninspectable, not a pass
  legacy/                        the golden reference - 2 files
    golden.legacy.json           the golden envelope WP-1 recorded. If the backend was unreachable and
                                 WP-1 fell back to an on-disk form, this file carries
                                 provenance ENVELOPE-SYNTHESISED and T1.01b makes the file family
                                 uninspectable. T2 is unaffected: it reads components, not the envelope.
    golden.legacy.expected.json  the blessed T2 --json failure list, regenerated ONLY by
                                 `npm run bless -- --golden`, with a defectClasses[] array mapping each
                                 failure to a DC id. The number of failures is a reviewable diff,
                                 never a memorised constant.
  run/                           the synthetic run - 5 files, §3.4.3
    manifest.json                one screen, state "verified", verdictSha256 set
    hooks.jsonl                  3 lines: one allow, one HOOK-0101 deny, one HOOK-0104 deny
    screens/booking-details.verdict.json   a sealed verdict, T1-T3 pass, T4/T5 notRun
    logs/specwriter-clean.md     no markup, no hex, no __SAA_RESULT__
    logs/specwriter-dirty.md     contains a `"Markup"` blob and a `__SAA_RESULT__` line
```

**Manifest `index.json`** — what makes fixtures a gate rather than a pile of files:

```json
{
  "schemaVersion": 1,
  "fixtures": [
    {
      "path": "coverage/formid-absent.json",
      "tiers": ["t3"],
      "covers": ["T3.08"],
      "defectClasses": ["DC-26"],
      "args": ["--metadata", "metadata/forms.snapshot.json"],
      "bytesCap": 32768,
      "expect": {
        "result": "fail",
        "exit": 1,
        "families": { "references": { "walked": 1, "checked": 0, "failures": 1 } }
      }
    }
  ]
}
```

`packages/verify/test/fixtures.contract.test.mjs` is table-driven over the manifest: for each entry, run the named tier(s) with the named args and assert the result, the exit code and every stated family number **exactly**. One test per fixture, so `g-test-ratchet` grows with the fixture set.

`g-fixture-manifest` fails when: a fixture file exists that is absent from the manifest; a manifest entry names a missing file; any registered check id in any tier's `checks` has **zero** fixtures covering it; a directory's file count differs from `fixture-floors.json`; any fixture exceeds its `bytesCap` (the entry's own value, defaulting to its directory's) — and it **prints the cap it applied** per over-size file; or any screen outside `structuralEscapeScreens` reports `structuralEscapes > 0` in its `.expected.counts.json`. Its two mandatory mutations: inflate one `t2/` fixture past 32 KB (fail); delete one manifest entry's `covers` (fail).

**Defect-class coverage: `packages/verify/config/defect-classes.json`.** The strategy doc §6 Phase 3 gate — "T1–T3 catch ≥ 90% of the defect classes the audit enumerated" — is a real gate only if the denominator is enumerated in advance. **N = 30.** `g-defect-class-coverage` requires every id to be named by ≥ 1 manifest fixture whose expected result matches the class's `catchAs`, prints `covered/30`, and fails below `ceil(0.9 * 30) = 27`. Its two mutations: remove a fixture's `defectClasses` entry (fail); add a 31st class with no fixture (fail). There is no commit-body table.

| id | Source | Class | `catchAs` | Check |
|---|---|---|---|---|
| DC-01 | §1.1#1 | stray `label`/`labelAlign` with `hideLabel` unset on a container | fail | T2.21 |
| DC-02 | §1.1#2 | three-way breakpoint divergence on one styling key | fail | T2.16 |
| DC-03 | §1.1#3 | a styling key present at one breakpoint only | fail | T2.16 |
| DC-04 | §1.1#4 | fixed `height` on the page-shell card | fail | T2.22 |
| DC-05 | §1.1#5 | legacy and v7 styling channels for the same property | fail | T2.14 |
| DC-06 | §1.1#6 | `stylingBox` duplicated at base and breakpoint level | fail | T2.15 |
| DC-07 | §1.1#7 | row navigation wired more than one way | fail | T3.19 |
| DC-08 | §1.1#8 | submit/argument pipeline on a `kind:list` form | fail | T2.20 |
| DC-09 | §1.4 bindings | binding `propertyName` absent from entity metadata | fail | T3.01 |
| DC-10 | §1.4 bindings | binding case wrong (PascalCase path) | fail | T3.02 |
| DC-11 | §1.4 types | component `type` does not exist | fail | T2.01 |
| DC-12 | §1.4 versions | component `version` wrong or stale | fail | T2.02 |
| DC-13 | §1.4 reflists | reference list does not resolve | fail | T3.06 |
| DC-14 | §1.4 reflists | `referenceListId` shape wrong | fail | T2.05 |
| DC-15 | §1.4 actions | `actionName` illegal for its owner | fail | T2.13 |
| DC-16 | §1.4 actions | `actionOwner` casing or identity wrong | fail | T2.13 |
| DC-17 | §1.4 actions | `onSuccess` target does not resolve | fail | T3.10 |
| DC-18 | §1.4 scripts | embedded script does not parse | fail | T3.17 |
| DC-19 | §1.4 formSettings | `formSettings` key illegal for the `kind` | fail | T2.20 |
| DC-20 | §1.4 placement | placement wrong at the JSON level | fail | T3.21 |
| DC-21 | §1.4 appearance | appearance asserted from an instrument that cannot see it | partial | T4b (`capabilities.appearance:false`) |
| DC-22 | §1.4 semantics | wrong column set | fail | T3.20 |
| DC-23 | §1.4 semantics | missing required input field | fail | T3.05 |
| DC-24 | §1.4 semantics | wrong tab grouping | fail | T3.22 |
| DC-25 | §1.4 semantics | duplicate `propertyName` in one scope | fail | T3.04 |
| DC-26 | §1.4 gates | zero-coverage pass (`formId` `""`/`null`/absent never walked) | fail | T3.08 + R1 |
| DC-27 | §1.4 gates | nodes under `items`/`columns` invisible to the walker | fail | T1.04 via `walkComponents` |
| DC-28 | §1.4 gates | a lazily created family vanishes from the report | fail | R2 |
| DC-29 | §1.4 gates | unreconciled coverage arithmetic reported as a verdict | fail | R3 |
| DC-30 | §1.4 gates | malformed data JSON crashes with no verdict | fail | `readJsonGuarded` |

**The stub HTTP backend** (already in `verify-artifact.test.mjs`: a `node:http` server on an ephemeral port returning ABP envelopes, `result: null` for unknown forms) is kept and moved to `packages/verify/test/helpers/stub-backend.mjs`. It covers the four HTTP-shape cases the snapshots cannot express: 401/403 → uninspectable, transport failure → uninspectable, non-JSON body → uninspectable, `result: null` → fail. Those four are exactly what `verify-artifact.mjs` already got right; their tests move unchanged.

---

### 3.8 Acceptance criteria for Section 3

Every row is a literal command with a literal expected result. The session runs them; `npm run green` writes `packages/verify/evidence/<WP>.json` and `g-commit-format` compares the commit body's numbers against that file (Section 1). **No criterion is satisfied by the agent typing a number.**

| # | WP | Command | Expected |
|---|---|---|---|
| 1 | 3a | `node packages/verify/src/gates/g-coverage-single-impl.mjs` | exit 0; prints `coverage implementations 1 · re-exports 2 (1 line each) · walkComponents definitions 1` |
| 2 | 3a | `node --test packages/verify/test/coverage.test.mjs` | exit 0; `# pass` ≥ 21 |
| 3 | 3a | `node packages/verify/src/gates/g-family-declaration.mjs` | exit 0; prints `families declared <n> · lazily created 0 · expectEmpty 2 (D-010, D-037)` |
| 4 | 3a | `node --test packages/verify/test/walk.test.mjs` | exit 0; prints `slots walked 9 / 9 in registry slots.json` |
| 5 | 3a | `node packages/verify/src/t1-schema.mjs packages/sfs/test/fixtures/clean/bookings-table.expected.form.json --meta packages/sfs/test/fixtures/clean/bookings-table.expected.meta.json --json` | exit 0; `result: "pass"`; `families.structure.checked === families.structure.walked` |
| 6 | 3a | `node packages/verify/src/t1-schema.mjs packages/sfs/test/fixtures/t1/v4-shaped-id.json --meta packages/sfs/test/fixtures/clean/bookings-table.expected.meta.json --json` | exit **1**; one `structure` failure whose reason contains `version 5` |
| 7 | 3a | `node packages/verify/src/t2-registry.mjs packages/sfs/test/fixtures/t2/T2.20b-list-form-null-hooks.json --json` | exit **0** — `forbidden` means "present with a non-null value" (D-033) |
| 8 | 3a | `node packages/verify/src/t2-registry.mjs packages/sfs/test/fixtures/t2/T2.20-list-form-with-submit-pipeline.json --json` | exit **1**; a `formSettings` failure naming `dataSubmitterType` |
| 9 | 3a | `node packages/verify/src/gates/g-mutation-coverage.mjs` | exit 0; prints `t2-registry checks 22 · uncovered 0` and `t1-schema checks 11 · uncovered 0` |
| 10 | 3a | `node packages/verify/src/gates/g-uninspectable-budget.mjs` | exit 0; prints `classA 7 / max 7 · unknown check ids 0 · undecided entries 0` |
| 11 | 3a | `node packages/verify/src/gates/g-fixture-manifest.mjs` | exit 0; prints `fixtures <total from fixture-floors.json> · unmanifested 0 · missing 0 · uncovered check ids 0 · over cap 0` |
| 12 | 3a | `node --test packages/verify/test/mutation-meta.test.mjs` | exit 0; last two lines `<n>/<n> defect classes caught` and `mutation suite <N>s / budget 180s` with `N <= 180` |
| 13 | 3a | `git status --porcelain > /tmp/a && npm run gates:mutate && git status --porcelain > /tmp/b && diff /tmp/a /tmp/b` | exit 0 from `diff` |
| 14 | 3a | `node packages/verify/src/gates/g-registry-completeness.mjs` | exit 0; prints `priority types 13/13 propsCompleteness != none · priority props with null valueType 0 · requiredProps records: priority 13/13` (Section 2's gate; Section 3 adds no second registry gate) |
| 15 | 3b | `node packages/verify/src/verify.mjs .build/wp3b --screen bookings-table --tiers t1,t2,t3 --metadata packages/sfs/test/fixtures/metadata/boxfusion.test.snapshot.json --json` | exit 0; `result: "pass"`; `tiers.T1.result`/`T2`/`T3` all `pass` |
| 16 | 3b | `node packages/verify/src/verify.mjs .build/wp3b --screen bookings-table --tiers t1,t2,t3 --json` | exit **3**; `tiers.T3.result === "partial"`; stdout contains `A partial verdict is NOT a pass`; exactly 6 distinct `checkId`s among T3's uninspectable notes, all present in `uninspectable-budget.json` |
| 17 | 3b | `node packages/verify/src/t2-registry.mjs packages/sfs/test/fixtures/legacy/golden.legacy.json --json > /tmp/g.json; node -e "const a=require('/tmp/g.json'),b=require('./packages/sfs/test/fixtures/legacy/golden.legacy.expected.json');if(JSON.stringify(a.families)!==JSON.stringify(b.families))process.exit(1)"` | `t2-registry` exits 1; the `node -e` exits 0 — the golden failure set equals the blessed set exactly |
| 18 | 3b | `node packages/verify/src/gates/g-defect-class-coverage.mjs` | exit 0; prints `defect classes covered 30/30 (floor 27)` |
| 19 | 3b | `node packages/verify/src/gates/g-no-prose-assertions.mjs` | exit 0; prints `fenced assertion blocks under plugins/**: 0 · contract predicates 18 · unknown predicate names 0` |
| 20 | 3b | `node --test packages/verify/test/predicates.test.mjs` | exit 0; prints one line per predicate row proving each mutated sidecar in `placement/` fails **exactly** its own row and no other; `absent-node` fails with `is not in the compiled tree` |
| 21 | 3b | `node packages/verify/src/gates/g-quarantine.mjs` | exit 0; prints `quarantined 0 · lifted by WP-3b: 2` |
| 22 | 3b | `node --test packages/verify/test/` | exit 0; `# pass` ≥ the previous WP's count + 1; the 15 inherited `verify-artifact` tests all present (13 unchanged, 2 re-pointed under a `Test change:` row) |
| 23 | 3b | `node packages/verify/src/gates/g-verdict-integrity.mjs` | exit 0; prints `runs walked 1 (fixture) + <n> real · predicate results recomputed <m> · mismatches 0` |
| 24 | 3c | `node packages/verify/src/t4-smoke.mjs --selftest --json` | exit 0 |
| 25 | 3c | `node packages/verify/src/t4b-residue.mjs packages/sfs/test/fixtures/probe/booking-details.probe.overflow.json --json` | exit **1** |
| 26 | 3c | `node packages/verify/src/t4b-residue.mjs packages/sfs/test/fixtures/probe/booking-details.probe.no-name.json --json` | exit **3**; every finding `uninspectable` with a reason |
| 27 | 3c | `node packages/verify/src/verify.mjs .build/wp3c --screen bookings-table --tiers t1,t2,t3,t4 --metadata packages/sfs/test/fixtures/metadata/boxfusion.test.snapshot.json --json` | exit **3** (a requested tier reported `notRun`); `result === "pass"`; `tiers.T4 === {"result":"notRun","reason":"playwright not installed; no --base-url given"}` — proving `notRun` is never green and never enters `result` |
| 28 | 3c | `node -e "const j=require('./packages/verify/src/probe/layout-probe.mjs');if('colSpan24' in j.FIELDS)process.exit(1)"` and `node --test packages/verify/test/probe.test.mjs` | both exit 0; `probe.test.mjs` prints `data-sha-c-name captured on <n>/<n> named nodes · summary bytes <= 8192 · rowBand parent-relative` |
| 29 | 3d | `node packages/verify/src/t5-visual.mjs --selftest --json` | exit 0 on every score, including the worst |
| 30 | 3d | `node --test packages/verify/test/t5.test.mjs` | exit 0; 8 tests pass, including `verdict.result is byte-identical whether t5 reports the best or the worst possible score vector` |
| 31 | 3d | `node packages/verify/src/gates/g-judge-isolation.mjs` and `node packages/verify/src/gates/g-t5-advisory.mjs` | both exit 0; `g-t5-advisory` prints `t5 references in gate-push.mjs: 0 · t5 references in result computation: 0 · judge-truth gap recorded for <version>` |
| 32 | 3a–3d | `npm run green` with the network interface disabled | exit 0; stdout contains no `ENOTFOUND`, `ECONNREFUSED` or `EAI_AGAIN` |

If any row fails, the work package is not done. There is no partial work package (Section 1 §1.9).

---

### 3.9 DECISIONS.md rows this section adds

Ids D-060…D-075. Eight-cell format per Section 1 §1.4; the `Enforced by` cell uses only the five legal forms of Section 1 §1.4.

| ID | Decision | Why (strategy doc) | Enforced by |
|---|---|---|---|
| D-060 | Coverage accounting lives only in `packages/registry/src/coverage.mjs`; `walked`/`checked` count pointers, `assertions` counts assertions; `walkComponents` lives in `packages/verify/src/walk.mjs` and is exempt from the re-export rule | §1.4 `roles` 7 walked / 14 checked unit mismatch | `g-coverage-single-impl` |
| D-061 | Zero coverage on a required family is `fail`. No flag, mode or argument makes it `pass` | §1.4 `verdictOf` had no zero-coverage rule | `g-family-declaration` |
| D-062 | Families are declared up front; requesting an undeclared family throws | §1.4 vanishing agent-dispatch family | `g-family-declaration` |
| D-063 | A coverage-arithmetic breach exits 2 and prints no result line | §1.4 unreconciled arithmetic | `g-exit-codes` |
| D-064 | One tree walker, `walk.mjs`, driven by `load(ref).slots`, reaching all 9 child channels | §1.4 five inconsistent walkers; §1.7 T5 | `g-coverage-single-impl` |
| D-065 | Placement is declarative predicate rows over the compiled tree, one row per pointer, evaluated by the frozen 18-name table in `packages/verify/src/predicates/index.mjs`. Prose assertions are deleted, not translated. `verify` evaluates every predicate; no agent authors or alters a predicate result | §1.3 no diff program exists; §4 L3 | `g-no-prose-assertions`, `g-verdict-integrity` |
| D-066 | The compiler emits `<screen>.compiled.meta.json` on every compile, validated against `packages/sfs/schema/compiled-meta.schema.json`; T2, T3 and every predicate read it | §1.3 fill-vs-fixed and tab intent are unrecoverable from the DOM | `check:t1-schema:T1.10` |
| D-067 | Tab assignment is a T3 check. The DOM probe reports it `uninspectable`, never asserts it | §1.3 inactive antd panels are `display:none` and filtered | `check:t3-semantic:T3.22` |
| D-068 | Backend-dependent checks degrade to `uninspectable`/`partial`. No flag turns one into a pass; the only thing a flag can do is let a human push knowingly through `pushAdmissible` | §4 L3; the "no live backend" constraint | `check:t3-semantic:T3.01`, `g-uninspectable-budget` |
| D-069 | Every gate and tier exports `checks[]`, `inputPaths[]` and `mutations[]`; every check id is covered by ≥ 1 mutation and ≥ 1 fixture; `expect:'pass'` is illegal | §5 generalise the negative test | `g-mutation-coverage`, `g-gate-contract` |
| D-070 | Registry incompleteness on one of the 13 priority types is a `fail` naming the gap, never an `uninspectable`. Incompleteness on a non-priority type is `uninspectable` at `T2.08` only, and is the only class-A entry T2 may produce | §4 L0: 28 components with empty `ownProps`; a permanently amber T2 is a muted T2 (§1.7 T4) | `check:t2-registry:T2.08`, `g-registry-completeness`, `g-uninspectable-budget` |
| D-071 | T5 never enters `result`; a judge below 0.9 anchor accuracy is disqualified and T5 reports `notRun`; `verdict.result` is byte-identical for the best and worst score vectors | §4 L3 anchor spread 100% vs 35% | `g-t5-advisory` |
| D-072 | The builder's `__SAA_RESULT__` self-report never enters the judge's context; the judge's input is a whitelist | §4 L3 false positives 0.719 → 0.012; §1.7 T13 | `g-judge-isolation` |
| D-073 | Push admission is one function, `pushAdmissible` in `packages/verify/src/admission.mjs`: `T1..T3` all `pass`, **or** `partial` with `--allow-partial` on the invocation and every uninspectable `checkId` inside `uninspectable-budget.json`'s class A; plus `sealedAt` within 30 minutes and `tiers.T3.backend` equal to the push target. No hook re-runs a tier | Three admission rules for one tier is contradiction #5's shape; re-verifying inside a PreToolUse hook cannot fit 30 s and doubles the backend dependency | `structural:packages/verify/src/admission.mjs`, `g-uninspectable-budget` |
| D-074 | A family whose pointer population was deleted by decision declares `expectEmpty: true` with the deciding D-id; `walked > 0` then fails. `required: false` is never used to silence a vanished population | §1.7 T6: the vanishing-family hole; `overlays` (D-010/D-018) and `versions` (D-037) both go to 0 by design | `g-family-declaration` |
| D-075 | The Phase 3 gate's denominator is the 30 enumerated ids of `packages/verify/config/defect-classes.json`; coverage is computed by a gate, never asserted in a commit body | §6 Phase 3; an agent that chooses its own partition, count and mapping is grading itself | `g-defect-class-coverage` |

---

### 3.10 BACKLOG rows this section adds

| ID | Origin | Item | Why not this session | Acceptance when done |
|---|---|---|---|---|
| BL-030 | §3.4.3 | Re-create `g-retro-ingested` over `docs/retrospectives/**` | The directory is a Phase 5 artifact and does not exist; a gate over an empty subject is banned behaviour T7 | `node packages/verify/src/gates/g-retro-ingested.mjs` exits 0 printing `retrospectives walked >= 1 · uningested 0` |
| BL-031 | §3.2.3 T2.07 | Derive framework `required` flags by parsing the pinned `shesha-framework` TS interfaces, replacing the corpus-mined `requiredProps` table | The framework clone may be unavailable (Section 5 B3); `editorType` records the designer widget, not the value contract | `load(ref).requiredProps` is generated with `provenance: "source-parsed"` for ≥ 40 authorable types and `g-registry-completeness` prints `requiredProps source-parsed >= 40` |
| BL-032 | §3.2.3 T2.08 | Fill `valueType` for every authorable non-priority type, removing T2.08 from the uninspectable budget | Needs BL-031's source parse; the class-A entry is the honest interim | `uninspectable-budget.json` `classA` has 6 entries and `max: 6`, and the ratchet forbids re-adding T2.08 |
| BL-033 | §3.2.5 | The live T4/T4b path against a running Shesha frontend + backend | No browser, no backend on the reference host (Section 5 B1/B2); `--selftest` proves the assertions, not the transport | `node packages/verify/src/t4-smoke.mjs <verdict> --base-url <url> --backend <url> --token <f>` exits 0 with `actions checked === walked` and `console errors 0` |
| BL-034 | §3.6 T5-R2 | Qualify a judge model on 10 Boxfusion anchors | Requires 10 accepted screens with their design sources, which do not exist as a committed set | `packages/verify/anchors/qualification.json` records anchor-first ≥ 9/10 for a named model, and `judge-truth-gap.json` has an entry for the current version |
