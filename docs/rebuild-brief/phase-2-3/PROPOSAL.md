# Phase 2 + Phase 3 — scope-extension proposal (Scope B)

Status: **OPENED** (D-100, the WP-0b commit). Scope A stays complete and frozen (`npm run prove` →
`SESSION COMPLETE — SCOPE A`). This is the plan for the second delivery, "Scope B", under the same
invariants; the authoritative WP order is `packages/verify/config/session-scope-b.json` and the §2
tables below are descriptive.

> Revised after an adversarial verification pass caught a fatal flaw in the first draft: adding
> Scope-B ids to `session-scope.json` would have permanently broken the Scope-A proof (`prove.mjs`
> byte-freezes its scope line against `prove.expected.txt`, whose bless budget is spent). The fix is
> a **separate** Scope-B scope file and proof, below.

> **Reshaped by the mining run.** `docs/rebuild-brief/corpus-intake/MINING-REPORT.md` measured
> **7.0% round-trip over 2,071 real production forms**. The single WP-5c of the first draft was too
> small: the failures split into three prioritized fronts that now lead the ladder — **WP-5c**
> compiler robustness (the `reading 'hidden'` crash, 498 forms), **WP-5d** decompiler output hygiene
> (~700 forms whose lifted SFS fails its own schema), and **WP-5e** the IR-node gaps (`columns` 241,
> `buttonGroup` 153, `collapsiblePanel`, `tabs`, …).

## 0. The three constraints that shape the plan

1. **The Scope-A proof is immutable and must never regress.** `prove.mjs` reads
   `packages/verify/config/session-scope.json` and byte-compares its whole stdout (including the
   `scope … 12/12 complete` line) against `packages/verify/test/prove.expected.txt`. `CONTROL §5`
   permits `--bless` **exactly twice — WP-1 and WP-10, both spent.** Therefore **`session-scope.json`
   stays frozen at its 12 Scope-A ids and `prove.mjs`/`prove.expected.txt` are never touched.** Scope
   B gets its **own** files: `packages/verify/config/session-scope-b.json` (the Scope-B id list) and
   `packages/verify/src/prove-b.mjs` (its proof), with its own single `--bless` of
   `prove-b.expected.txt`, granted additively by D-100. `npm run prove` keeps printing
   `SESSION COMPLETE — SCOPE A` unchanged, always.
2. **Scope changes are data, in one commit** (D-051). D-100's commit adds the row to `DECISIONS.md`,
   creates `session-scope-b.json`, adds the three new WP ids to `wp-table.json`, and adds a Scope-B
   table to `CONTROL §3`. Ids stay contiguous (next is **D-100**). Enforcer:
   `structural:packages/verify/test/prove-b.contract.test.mjs`.
3. **Two byte budgets are nearly full — Step 0 must reclaim headroom or it will not commit.**
   `DECISIONS.md` is 16373 B against a 16384 B `liveTargetBytes` (11 B free) with **no currently
   archivable rows**, and `CONTROL.md` is 24351 B against its 25600 B cap (1249 B free). Adding D-100
   (~700 B) and a Scope-B table (~1–1.5 KB) breaches both and fails `g-decisions` / `g-brief-budget`
   in the pre-commit `npm run green`. Step 0 therefore MUST, in the same commit, either archive
   now-closeable rows (`gen-decisions --archive`) or — if none qualify — raise `liveTargetBytes` via
   a `Threshold change:` row justified by Scope B's added decisions, and trim `CONTROL.md` prose to
   fit the Scope-B table. Verify both gates pass before committing.

## 1. The Scope change row (draft — D-100)

```
| D-100 | 2026-08-19 | decided | Scope change: open Scope B. Scope-B WP ids live in a NEW packages/verify/config/session-scope-b.json read only by a NEW packages/verify/src/prove-b.mjs; session-scope.json stays frozen at the 12 Scope-A ids so prove.mjs and prove.expected.txt never drift. Add WP-1c/WP-2b/WP-5c to wp-table.json and a Scope-B table to CONTROL §3. Scope B's done is prove-b.mjs printing `SESSION COMPLETE — SCOPE B`, granted exactly one --bless of prove-b.expected.txt, additive to CONTROL §5's two Scope-A blesses which stay spent | the backlog is real work the rebuild still owes; leaving it as prose is the failure invariant 2 forbids | Scope A's frozen proof and bless budget are untouched; Scope B carries its own | structural:packages/verify/test/prove-b.contract.test.mjs | n/a |
```

## 2. The WP ladder

Existing `wp-table.json` ids are reused; only three genuinely-new suffix ids are added (WP-1c/WP-2b/
WP-5c, following the WP-3a→WP-3b lettering). Every WP keeps the Scope-A invariants: one commit; each
new gate exports ≥2 verdict-flipping mutations proven by `gates:mutate`; live-backend/browser
absence degrades to `uninspectable` (exit 3), never pass; a self-report is not evidence; nothing
weakens without its own `Threshold change:`/`Gate removal:`/`Scope change:` row.

### Phase 2 — offline (no restart, no backend)

| WP | id status | Closes | Size | Acceptance (verbatim from BACKLOG where given) |
|---|---|---|---|---|
| **WP-2b** | new | BL-004, BL-020, BL-022 | M | `node packages/registry/src/validate.mjs` → `priority full 13/13 · full >= 93/121` **and** `deferredAuthorable < 8` |
| **WP-3b** | wp-table | BL-003 | L | `node packages/verify/src/verify.mjs .build/wp3b --screen inline-editable-table --tiers t1,t2,t3` → exit 0; un-quarantine `t3-semantic.mjs` + `g-check-references.mjs`; each T3 check carries a fixture; extend `g-mutation-coverage`/`defect-classes.json` |
| **WP-9** | wp-table | BL-009 | M–L | `node --test packages/precedent/test/` → exit 0 with retrieval tests, no `E_NOT_IMPLEMENTED` |
| **WP-1c** | new | BL-001, BL-006, BL-010, BL-014 | M | `node --test packages/sfs/test/fuzz.test.mjs` → `cases >= 200`, 0 predicate failures; `node .../t1-schema.mjs --envelope <real-export>.json`; typecheck with `noUncheckedIndexedAccess:true`; `node .../cost-delta.mjs --arms 3` |
| **WP-6** | wp-table | BL-002 | M | `npm run sfs -- roundtrip --scope all-12.json` → exit 0, `rate >= 0.90` over all 12 corpus forms |
| **WP-5c** | new | GAP-001, GAP-nnn, PROM-nnn, BL-023, + `MINING-REPORT.md` top round-trip failures | ? (report-sized) | `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` with employee-table MOVED to declaredSubset clean → rate ≥ 0.90; a hardcoded-hex fixture makes T2.17 **fail** (BL-023); one lifted-construct fixture per report item |
| **WP-7** | wp-table | BL-007, BL-012 | M (tedious) | `node .../g-prose-budget.mjs` → 0 waivers whose `until` is BL-007 or BL-012 |
| **WP-16b*** | new (see note) | BL-011 | M | `node .../g-brief-budget.mjs` → `bundle.enforced: true` and total ≤ 61440 B — **last**, and the flip to enforced is a `Threshold change:` row |

*Kept separate from WP-7 because flipping `g-brief-budget` to enforced is a distinct threshold change that must land only once the whole brief bundle is already ≤ 61440 B.

### Phase 3 — gated

| WP | Closes | Size | Gate | Acceptance |
|---|---|---|---|---|
| **WP-8** | BL-008 | L | **needs a session RESTART** | after RESTART, plant a `.form.json` Write and observe the denial; `node .../g-githook-contract.mjs` → exit 0 |
| **WP-3c** | BL-005 (T4) | L | **Playwright chromium + live backend**; absent → `uninspectable` | `npx playwright install chromium` then `node .../verify.mjs .build/wp3c --tiers t4` → exit 0 |
| **WP-3d** | BL-005 (T5) | M | same as WP-3c | T5 advisory visual; port `quarantine/layout-probe.js` to ESM |
| **CI** | BL-015 | S | **out of jurisdiction — you author `.github/workflows/**`** | I ship `packages/sfs/test/oracle.test.mjs` (exit 0 over 6 forms); you add the workflow whose only step is `npm run green` |

## 3. Ordering, dependencies, effort

```
WP-2b ─┐
WP-3b ─┼─ offline, no mining needed — run first
WP-9  ─┤
WP-1c ─┤
WP-6  ─┘
WP-5c ──── needs docs/rebuild-brief/corpus-intake/MINING-REPORT.md; slot in when the mining session lands it
WP-7  ──── prose thinning
WP-16b ─── LAST of Phase 2: flips g-brief-budget to enforced, so the bundle must already be trimmed ≤ 61440 B
WP-8  ──── RESTART-gated (you trigger the restart cycle)
WP-3c/3d ─ environment-gated (browser + live backend), else honest uninspectable
CI    ──── your workflow file; my oracle.test.mjs can land any time after WP-5c
```

- **Phase 2 (offline): ~5–6 WP-units** at the Scope-A effort scale. WP-5c is the wildcard
  (mining-shaped); WP-3b (T3, 22 checks + mutations) is the largest single unit.
- **Phase 3 (gated): ~3 units**, none agent-time-boxable — WP-8 needs your restart, WP-3c/3d need an
  environment that otherwise degrades honestly, CI's workflow file is yours.
- Rough aggregate: **8–9 more WP-units**, i.e. **several focused sessions**, with real uncertainty on
  WP-5c and no agent-only estimate for the gated items.

## 4. Definition of done (Scope B)

1. `node packages/verify/src/prove-b.mjs` → exit 0, final line `SESSION COMPLETE — SCOPE B`.
2. `npm run prove` **unchanged** → exit 0, `SESSION COMPLETE — SCOPE A` (guaranteed, because
   `session-scope.json`/`prove.expected.txt` are never touched).
3. `npm run green` exits 0 (now with T3 + the new gates + the fuzzer in the suite).
4. Every BACKLOG row above is closed (its acceptance command exits 0) or, if genuinely
   restart/environment-gated and not yet runnable, carries a `BLOCKED.md` row — never a silent skip.
5. `HANDOFF.md` extended so every Scope-B command has a line with its expected output.
6. Git clean; CI green (your workflow); `CONTROL §11` items 1–15 pass before item 16.

## 5. What I will NOT do without you

- Enact the Scope change (apply D-100 + create `session-scope-b.json` + `prove-b` + edit
  `wp-table.json`/`CONTROL §3`) — awaits your yes.
- Start WP-5c before `MINING-REPORT.md` exists.
- Author anything under `.github/workflows/**` (CI is yours; standing instruction).
- Re-bless `prove.expected.txt` (Scope A's budget is spent — that is why `prove-b` exists).
