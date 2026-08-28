# AUDIT — documents reconciled to the tree

> **This is a dated snapshot of commit `cccc9bb`, not a description of the tree today.**
> Every number below is what a command printed at that commit, and the tree has moved a
> long way since. The measured figures now: `packages/verify/src/gates/*.mjs` holds 41 gate
> files against a `gate-ratchet.json` floor of `minGates: 41`; `npm test` reports
> `# pass 593 # fail 0`; `session-scope.json` names twelve Scope-A ids, not nine, and
> `session-scope-b.json` names twenty-three Scope-B ids. Read the findings as the record
> of one reconciliation pass. Only the rows marked **SUPERSEDED** below are annotated;
> every other row still describes what it describes.

One pass, at `cccc9bb`, on branch `hashim/sfs-rebuild-scope-a`. Documents corrected;
no code, no gate threshold, no work package advanced.

`npm run green` exit 0 before the pass and exit 0 after, with identical family counts:
`78 tests · 11 gates run, 11 pass · mutations=41 caught=41`. That equality is the
guard on this pass: a document edit that moved a verdict would mean the edit changed
behaviour, and would be reverted.

Node was activated with `fnm` before every measurement below. Unactivated, `node`
resolves to nothing in a non-interactive shell here and every command reports
`command not found`, which is finding 4.

## Findings

| # | Command that produced it | Discrepancy | Correction | File corrected |
|---|---|---|---|---|
| 1 | `cat .build/state.json` → `decisionsPendingWriteUp` holds two entries | D-076 and D-077 existed only in a **gitignored** file. Both are prerequisites for Q2, and a context reset would destroy them | Wrote both rows. D-076: the decompiler is lossless by default. D-077: N12, the action-item `editMode` normalisation. Cleared `decisionsPendingWriteUp` | `DECISIONS.md`, `packages/sfs/registry/decisions.json`, `.build/state.json` |
| 1b | `node packages/verify/src/gates/g-decisions.mjs` → `enforcers=80/80 resolved` | The requested enforcer for D-076, `g-oracle-independence`, has no module under `packages/verify/src/gates/`. Naming it would fail `g-decisions` form 1 and turn green red | Both rows carry `pending:WP-1.a`, which is override O6's form for exactly this case. The ratchet forces a real enforcer before WP-1.a can be recorded complete | `DECISIONS.md` |
| 1b′ | **SUPERSEDED.** `ls packages/verify/src/gates/g-oracle-independence.mjs` → the file exists and the gate runs in the roster | The ratchet did its job. D-076 and D-077 are archived in `docs/decisions-archive.md`, both naming `g-oracle-independence` as a live enforcer, not `pending:WP-1.a` | none — the row above records how the deferral was held open; this records that it closed | — |
| 2 | `git log --oneline -1` → `cccc9bb`; `cat .build/state.json` → `lastGreenCommit: c6af856` | Green drift of two commits. The prompt recorded HEAD as `3d20dab`; `3d20dab` and `cccc9bb` both landed after `c6af856` | Ran `npm run green` → exit 0 at `cccc9bb`, so HEAD is green and no resume protocol was owed. Set `lastGreenCommit` to `cccc9bb` with the measured counts | `.build/state.json` |
| 3 | `ls packages/verify/src/gates/*.mjs \| wc -l` → `11` | `BUILD-LOG.md`'s WP-0 header and body counted eight gates and 29 mutations. Override O7 raised the roster to eleven and the reconciliation commit `6a3bd24` brought mutations to 39 | Header and body corrected to eleven gates and 39 mutations | `BUILD-LOG.md` |
| 3b | `cat packages/verify/config/gate-ratchet.json` → `minGates: 11`, `wpZeroGates` lists 11 | No discrepancy. The floor was already set from eleven | none — verified only | — |
| 4 | `node --version` in a fresh non-interactive shell → `command not found` | CONTROL's precondition P1 was `node --version` with no activation step. On this machine P1 cannot fail *correctly*: it reports a missing binary rather than a wrong version, so a genuinely wrong Node version and an unactivated shell are indistinguishable | Rewrote P1 to activate `fnm` first, cross-referenced B13, and stated that every §3 command inherits that activation — one sentence rather than nine edited rows | `docs/rebuild-brief/CONTROL.md` |
| 5a | `grep -rn "scheduled:" docs/rebuild-brief/*.md CLAUDE.md DECISIONS.md docs/decisions-archive.md` → 10 hits | Override O6 makes `pending:<WP-id>` the only deferred-enforcer form and D-009 says delete the losing side. The void spelling survived in six files, including `CLAUDE.md`, which is prompt payload, and in the `## No theatre` block, which asserted it as legal | Deleted and rewritten to `pending:<WP-id>` / `pending-budget.json` in all six. O6's and O7's own occurrences left untouched: they quote the losing side in order to void it | `20-sfs-compiler.md`, `50-session-plan.md`, `CLAUDE.md`, `DECISIONS.md`, `docs/decisions-archive.md` |
| 5b | `grep -rn "eight gates\|exactly eight" docs/rebuild-brief/*.md` → 6 hits | CONTROL contradicted **itself**: O7 declares eleven, while §3's table, §3's gate-shipping rationale and §4's never-dropped list all said eight. `50-session-plan.md` carried "why exactly eight" plus two more | All six rewritten to eleven with O7's full list. O7's own text untouched | `docs/rebuild-brief/CONTROL.md`, `docs/rebuild-brief/50-session-plan.md` |
| 5c | `grep -n "D-045" docs/decisions-archive.md` | The archived D-045 row enumerated four legal `Enforced by` forms including `scheduled:`, contradicting the enforcer that implements five with `pending:`. The decision itself stands; only its enumeration drifted | Enumeration corrected to the five forms `g-decisions` actually resolves | `docs/decisions-archive.md` |
| 6 | `wc -c docs/rebuild-brief/*.md` → `604699 total` | Bundle is 9.8× the 61,440 B cap and grows as prompts are added. The honesty is complete: `brief-budget.json` has `bundle.enforced: false` with `deferredTo: BL-011`; B11 names executing BL-011 as its unblock action; the four documents citing 61,440 all name it as a target or as BL-011's acceptance number, and none claims the cap holds | none — verified only. BL-011 is a work package and was not executed here | — |
| 6b | `wc -c docs/rebuild-brief/*.md` → `604699`; `BLOCKED.md` B11 → `594452` | B11's recorded measurement is stale by 10,247 B against the same command | Left as written. B11 records what the command printed on the date in its `Recorded` column; re-dating it every time a prompt lands would make the evidence column a moving claim rather than a measurement | none — recorded as accepted |
| 6′ | **SUPERSEDED.** `wc -c docs/rebuild-brief/*.md` → `607460` | Findings 6 and 6b both rest on the premise that BL-011 would eventually close and enforce the cap. D-114 decides otherwise: WP-16b is removed from Scope B and 61,440 B is declared unreachable by the sanctioned extraction, because roughly half the bundle is design prose that cannot move to `data/*.json` | `bundle.enforced: false` is now permanent, not pending. The honesty finding stands; the "BL-011 will fix it" premise does not | `BACKLOG.md`, `BLOCKED.md` B11 |
| 7 | `cat packages/verify/config/session-scope.json`; `grep -cE "^\| [0-9] \|" CONTROL.md` → `9` | No discrepancy. `session-scope.json`, CONTROL §3's table and `prove.mjs` (which reads that file rather than restating it) all name the same nine ids, and `prove --partial` prints exactly them | none — verified only | — |
| 7′ | **SUPERSEDED.** `node -e "…session-scope.json…"` → twelve ids; `…session-scope-b.json…` → twenty-three ids | Scope A grew from nine ids to twelve, and a second scope file was added. The finding's *method* holds — `prove.mjs` and `prove-b.mjs` still read the scope files rather than restating them, so the ids cannot drift from the proof — but the number nine is a dated reading. There is no third scope file; "Phase 2" and "Phase 3" are subdivisions of Scope B | none — the invariant that made this row a non-discrepancy is intact | — |
| 7b | `grep -n "D-070" DECISIONS.md` | The split is recorded as D-070 whose Decision cell begins `Scope change:`, satisfying the narrowing rule, and is enforced by `structural:packages/verify/config/session-scope.json` | none — verified only | — |
| 8 | `npm run green:fast && node packages/verify/src/gates/g-decisions.mjs` → exit 0, `D-040..D-058 present` | WP-0's CONTROL §3 acceptance command runs literally as written. `npm run prove -- --partial` → exit 0 printing `SESSION INCOMPLETE — completed WP-0; remaining WP-1.a,WP-1.b,WP-2,WP-4,WP-5,WP-7a,WP-3a,WP-10`. Every other row's command belongs to a work package that is not complete, so it is not yet runnable by design | none for the runnable rows | — |
| 8b | `grep -n inputPaths packages/verify/src/gates/g-commands-executable.mjs` | The gate's scan set is `CLAUDE.md`, `DECISIONS.md`, `BACKLOG.md`, `docs/decisions-archive.md` and `plugins/**/*.md`. CONTROL and the five sections are **outside** it, by D-043: the brief is not instruction payload and its command examples are illustrative | none. Recorded as a deliberate boundary, not a hole. Auditing CONTROL's commands is therefore a human pass, which is this row | — |
| 9 | `g-prose-budget --baseline` accounting over `prose-budget.json` | 34 waivers, owned `WP-7a` 25, `BL-007` 5, `BL-012` 4. Every owner resolves to a live scope id or a live BACKLOG row; **0 orphans**. B12's prose says 26/8/2/3 across four owners including `WP-2`, which the file does not carry | Corrected B12's distribution to the measured 25/5/4 and dropped the `WP-2` owner it does not have | `BLOCKED.md` |
| 10 | `grep -c "^| BL-" BACKLOG.md` | Twelve rows, BL-001…BL-012, each carrying `Raised in WP`, `Blocks = No` and a non-empty `Acceptance`. Two items decided in conversation were unfiled | Added BL-014 (property-based compiler fuzzer) and BL-015 (retain WP-1.a's second compiler as a permanent differential oracle, plus the CI job running `npm run green`) | `BACKLOG.md` |
| 10b | `git log --oneline -1 c6af856` | BL-013 is a retired id: it held the decision-registry archive mechanism, delivered in `c6af856` and struck from `BACKLOG.md` in that commit, which is why the new rows begin at BL-014. Reusing the number would make that commit body ambiguous | none — the gap is intentional and recorded here | — |
| 11 | `npm run green` mid-pass → `g-decisions` FAIL, `generated-json` failures 1 | Editing D-045's text in the archive left `packages/sfs/registry/decisions.json` stale, and the gate refused the tree. This is the only point in the pass where a verdict moved, and it moved because a **generated** artifact had a hand-edited source | Ran `node packages/registry/src/gen-decisions.mjs`, restoring exit 0. D-029's byte comparison did its job: the human-readable registry and its machine copy cannot drift apart silently | `packages/sfs/registry/decisions.json` |

## Promoted to work packages, not fixed here

| Item | Why it is not a document fix | Proposed owner | Outcome |
|---|---|---|---|
| `g-oracle-independence` does not exist, so D-076 and D-077 stand on `pending:WP-1.a` | Writing the gate is code | WP-1.a, before it may be recorded complete | **Closed.** The gate ships and both decisions are archived naming it |
| The brief bundle at 604,699 B against 61,440 B | Extracting tables and literals is a work package | BL-011 | **Permanently deferred** by D-114; WP-16b removed from Scope B |
| CONTROL and the five sections sit outside `g-commands-executable`'s reach | Widening a gate's declared subject changes what green means | BL-011, which is already the row that restructures the brief | Still open, and now unowned, since BL-011 will not execute |

## Not corrected, and why

`BUILD-LOG.md`'s WP-0 evidence table quotes intermediate observations from the day
WP-0 was built — `gates: 5 run`, a ratchet failure against a floor of 8, `bundle
594452 B`. These are measurements with a date, not claims about the tree today. The
header and the summary line were wrong about the shipped roster and are corrected;
the evidence rows stand as the record of what each command printed when it ran.
