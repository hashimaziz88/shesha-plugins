# CONTROL — Shesha SFS Rebuild, Scope A

**This file is the session's control program.** It is the only brief file read at turn zero and after every context reset. Sections 1–5 in this folder are detail, read one at a time, per work package, never whole.

**Authority:** `docs/rebuild-brief/strategy.md` (the decision), Option C approved. Cited as `[§x]`.
**Detail sections:** `10-standards.md` (WP-0) · `20-sfs-compiler.md` (WP-1/2/4/5) · `30-verifier.md` (WP-3a) · `40-harness.md` (WP-7a, and BL-008) · `50-session-plan.md` (the full execution detail behind this card).

---

## 0. The three invariants

**INV-1 — The compiler is the only writer of form markup.** No hand-authored or hand-edited form JSON, ever. Enforced by `g-markup-provenance`: for every `*.form.json` under `runs/**` and every `*.expected.form.json` under fixtures, recompiling its sibling `.sfs.json` under the recorded registry+brand hash must reproduce it byte-for-byte. Provenance, not string-matching, is the enforcer.

**INV-2 — No prose rule without a program that enforces it.** If you find yourself writing "remember to", "be careful to", or "prefer", either write the gate or delete the rule. `[§2 RC2]`

**INV-3 — Zero coverage is never a pass.** Every gate and tier reports `walked / checked / notApplicable / uninspectable / failures[]`, those five must reconcile arithmetically, families are declared up front so none can silently vanish, and a family that walked something and checked nothing **fails**. `[§1.4]`

A fourth rule governs your own behaviour: **a self-report is not evidence.** Not yours, not a subagent's. Every claim of completion is a command's exit code and printed output, recorded in `packages/verify/evidence/<WP>.json` by a program — never a number you typed into a commit body. `[§4/L3]`

---

## 1. Overrides — read before anything else

These supersede the detail sections wherever they disagree.

**O1 — The golden reference exists.** `docs/rebuild-brief/artifacts/bookings-table.revision2.json` is the real `boxfusion.test/bookings-table` revision 2 envelope (23 envelope fields, `Markup` as a JSON string, 12 components, 19,170 B compact markup). §5.0's paragraph "There is no `bookings-table` artifact" is **void**. Consequences: WP-1's Q2 oracle runs against this file; the eight normalisation defect classes of `[§1.1]` are real assertion targets, recorded in `packages/verify/config/defect-classes.json`; and `19170`, `8422`, `43.9%`, `12` are legitimate assertion constants for this one file only. WP-1 additionally proves against one on-disk corpus form (`inline-editable-table.json`) so the proof does not rest on a single artifact.

**O2 — `CONTROL.md` is this file, not a copy of Section 5.** §5.2's WP-0 line "`CONTROL.md` (a copy of this section)" is void — Section 5 is 77 KB and would violate its own 25,600 B budget (D-046). WP-0 commits this file as-is and does not regenerate it. `g-brief-budget` measures this file against 25,600 B.

**O3 — Local branch.** The repo is on `hashim/test/local-file-state` at `8a2d2f4`, 13 commits ahead of `origin`. P2 asserts the **commit**, not the branch name. Create the work branch from here: `git checkout -b hashim/sfs-rebuild-scope-a`. Never push to `upstream`.

**O4 — Tree-state sanity precedes P3.** If `git status --porcelain` reports a large number of modified files, do not stash or commit. Run `git diff --stat | tail -3` and `git config core.autocrlf`. A diff of 0 insertions/deletions across many files is a line-ending or index-staleness artifact, not real work: run `git update-index --refresh` and re-check. Only a genuine diff is stashed. Committing a mass line-ending rewrite is stop condition **S7** territory — it destroys the review value of every later diff.

**O5 — Hooks, MCP and the agent roles are out of scope (BL-008).** Claude Code loads `.claude/settings.json` hooks and `.mcp.json` at session start; anything this session writes cannot govern this session, so its acceptance cannot be verified here. Section 4's hook and MCP specs are authoritative for BL-008 and are **not** built now. What Section 4 *does* contribute to Scope A is WP-7a: the deletion and the one thin skill.

**O6 — The deferred-enforcer form is `pending:<WP-id>`.** Sections 1 and 5 fixed the same blocker with two vocabularies: `pending:<WP-id>` + `pending-budget.json` (§1.4) and `scheduled:<WP|BL-id>:<enforcer-id>` + `scheduled-enforcers.json` (§5.2). **Section 1's spelling wins**, because Section 1 owns `g-decisions` and the budget config. Everywhere Section 5 says `scheduled:` or `scheduled-enforcers.json`, read `pending:` and `packages/verify/config/pending-budget.json` — treat the losing spelling as a typo and delete it, per D-009. There is exactly one config, `max: 20`, ratcheting down only. `g-decisions` accepts a `pending:<WP-id>` entry only while that WP has no `complete` block in `BUILD-LOG.md`; a `pending:` row surviving its WP's completion is a hard failure. So `Enforced by` has **five** legal forms: a gate id with a file under `packages/verify/src/gates/`; `structural:<path>`; `hook:<file>`; `check:<tier-module>:<check-id>`; `pending:<WP-id>`.

**O7 — WP-0 ships eleven gates, not eight and not twelve.** §5.2 says "exactly eight" and §1.9 names twelve; the two lists differ in both directions. The governing rule is §5.2's — *a gate ships in the work package that creates its subject* — applied to §1.9's list. WP-0 therefore ships: `g-decisions`, `g-brief-budget`, `g-prose-budget`, `g-commit-format`, `g-gate-contract`, `g-coverage-single-impl`, `g-commands-executable`, `g-workspace-hygiene`, `g-githook-contract`, `g-no-secrets-or-scratch`, and `g-disposition` — the last with `disposition.json` covering only WP-0's four deletions (`summarize.js`, `validate-blocks.js`, `bake-overlays.mjs`, `shesha-form-edit/package.json`), extended by WP-7a. **Deferred with their subjects:** `g-registry-provenance` → WP-2; `g-check-references` → not a WP-0 gate at all, because D-049 quarantines `check-references.mjs` with `liftedBy: BL-003` and a quarantined script must emit no green signal. §5.2's "exactly eight" phrasing is void; the count is eleven and `gate-ratchet.json`'s floor is set from that.

---

## 2. Preconditions

Run in order. Record all results in the first `BUILD-LOG.md` entry. A failing hard precondition is **S0**: write nothing.

| # | Command | Expect | On failure |
|---|---|---|---|
| P1 | `node --version` | `v22.` or higher | **S0** |
| P2 | `git log --oneline -1` | `8a2d2f4 [chore]- Remove accidentally committed .tmp-negtest scratch file` | **S0** — you are on the wrong commit |
| P3 | O4 first, then `git status --porcelain` | empty, or a genuine diff you have stashed | — |
| P4 | `ls docs/rebuild-brief/*.md \| wc -l` | `>= 6` (CONTROL + 5 sections) | **S0** — bundle missing |
| P5 | `npm ping && npm view ajv@8.17.1 version` | `8.17.1` | **S0**, unless `node_modules/ajv` and `package-lock.json` both exist → record `BLOCKED.md` B7, use `npm ci --offline`, continue |
| P6 | `test -f plugins/shesha-developer/skills/shesha-form-edit/assets/examples/inline-editable-table.json` | exit 0 | **S0** — WP-1 has no on-disk target |
| P7 | `test -f docs/rebuild-brief/artifacts/bookings-table.revision2.json` | exit 0 | **S0** — O1's oracle is missing |
| P8 | `node -e "fetch('https://github.com',{method:'HEAD'}).then(r=>console.log('net',r.status)).catch(()=>console.log('net none'))"` | either | Not a failure. `net none` → `BLOCKED.md` B3, changes WP-2's provenance path only |

---

## 3. Scope A — eight work packages

Scope is **data**: `packages/verify/config/session-scope.json` lists exactly these eight ids and `prove.mjs` reads it. Narrowing requires a `DECISIONS.md` row beginning `Scope change:`. Everything else any section specifies is a `BACKLOG.md` row carrying its acceptance command verbatim. Nothing is "dropped later under budget pressure" — it is out of scope now, in writing.

| Order | WP | Goal | Detail | Acceptance command → expected |
|---|---|---|---|---|
| 1 | **WP-0** | Workspace, coverage primitives, eight gates, mutation harness, git hooks, brief commit, the deletions needing no new code | §1 all, §5.2 | `npm run green:fast && node packages/verify/src/gates/g-decisions.mjs` → exit 0, `D-040..D-058 present` |
| 2 | **WP-1** | **GO/NO-GO.** Two independently written programs agree on the markup of a real form | §2.0–2.5, §5.2 | `node packages/verify/src/prove.mjs --only Q1,Q2` → exit 0, `BYTE-EQUAL` on both |
| 3 | **WP-2** | `components-kb` → machine registry: names-only for all 121, value types for the 13 priority types, honest provenance | §2.8 | `node packages/registry/src/validate.mjs` → exit 0, `names-only 121/121 · priority full 13/13` |
| 4 | **WP-4** | SFS JSON Schema v1 + the ten `clean/` fixtures | §2.1, §2.2 | `node packages/verify/src/tiers/t1-schema.mjs packages/sfs/test/fixtures/clean` → exit 0, `10/10 valid` |
| 5 | **WP-5** | Compiler v1 (six stages, all node kinds, seven recipes, error catalogue) + decompiler over the six declared corpus forms | §2.3–2.7 | `npm run sfs -- roundtrip --scope roundtrip-scope.json` → exit 0, `rate >= 0.90 · untriaged 0` |
| 6 | **WP-7a** | Delete `shesha-form-edit/**` and the 2.5 MB of seeds; ship one thin `shesha-spec` skill | §4.4.2, §5.2 | `node packages/verify/src/gates/g-disposition.mjs && node packages/verify/src/gates/g-prose-budget.mjs` → exit 0 |
| 7 | **WP-3a** | Coverage full API + `walk.mjs`, T1 schema tier, T2 registry tier (22 checks) | §3.1, §3.2.2, §3.2.3 | `node packages/verify/src/verify.mjs .build/wp3a --screen inline-editable-table --tiers t1,t2` → exit 0 |
| 8 | **WP-10** | The integration proof and the anti-drift checklist | §5.3, §5.9 | `npm run prove` → exit 0, last line `SESSION COMPLETE — SCOPE A` |

**Envelope: 1,200 steps / 3.0 M tokens.** Per-WP artifact and step allocations are in §5.2's table; they are derived from the `Creates` lists, not asserted.

**Order rationale, stated once so it is not re-litigated.** WP-1 second because it is the go/no-go and there is no published head-to-head for the claim `[§6 Phase 1]`. WP-2 third because the compiler cannot stamp a version it cannot look up. WP-7a before WP-3a because the `preloadBytes` ratio is only real once the 322,816 B of prose is gone, and the deletion is mechanical. WP-3a last of the build WPs because T2 needs both the registry and real compiler output.

**A gate ships in the work package that creates its subject.** WP-0 therefore ships exactly eight: `g-decisions`, `g-brief-budget`, `g-prose-budget`, `g-commit-format`, `g-gate-contract`, `g-coverage-single-impl`, `g-commands-executable`, `g-workspace-hygiene`. Every other gate named anywhere in the brief lands with its subject, or is a BACKLOG row. A gate written before its subject exists is a gate that checks nothing — the exact pattern this rebuild exists to remove.

---

## 4. The thirteen brief reconciliations

Two authors wrote five sections and disagreed on thirteen paths, names and cadences. Resolve **all thirteen in WP-0**, write them to `DECISIONS.md` as D-040…D-044, and treat the losing spelling as a typo everywhere it appears in Sections 1–4 — **delete the losing side, never annotate it.** The binding table is §5.1. The four that will bite you first:

- CLI: **`packages/sfs/bin/sfs.mjs`**, root script `npm run sfs -- <args>`. No alias, no shim.
- Coverage: the whole API is defined **once**, in `packages/registry/src/coverage.mjs`. `verify` and `sfs` each contain exactly one line: `export * from '@shesha/registry/coverage';`. `walkComponents` lives only in `packages/verify/src/walk.mjs`.
- Artifact names: exactly four — `<screen>.form.json`, `<screen>.compile.json`, `<screen>.form.meta.json`, `<screen>.sfs.meta.json`. Blessed fixtures are `<screen>.expected.form.json`. `.compiled.json` is banned.
- Workspaces: root `["packages/*"]`. `plugins/**` contains no `package.json` after WP-0.

---

## 5. Definition of done

**Per work package.** All of: its acceptance command exits 0 with the expected output; `npm run green:fast` exits 0; every new gate has ≥1 declared mutation that flips its verdict; a `BUILD-LOG.md` block is written in the same commit; `DECISIONS.md` rows added for every choice made; one commit, message `[type]- Description` per repo convention, plugin version bumped only if the commit touches `plugins/**`.

**Session complete** is exactly this: `npm run prove` exits **0** and its final line is `SESSION COMPLETE — SCOPE A`. The proof is a program (§5.3) that runs `green`, compiles a fixture, checks the four properties Q1–Q4, runs the tiers, asserts a synthesised envelope produces exit 3 with `A partial verdict is NOT a pass`, checks the round-trip rate, and byte-compares its own output block against `prove.expected.txt`.

A green `npm test`, a satisfied to-do list and a confident summary paragraph are **explicitly insufficient** — that combination is precisely the state the pre-rebuild repo was already in. `[§1.4]`

`npm run prove -- --partial` runs what it can, prints `SESSION INCOMPLETE — completed <ids>; remaining <ids>` and exits 3. No path prints `SESSION COMPLETE` from an incomplete scope. `--bless` regenerates `prove.expected.txt` and is permitted exactly twice: once in WP-1, once in WP-10.

---

## 6. Checkpoint and resume

Three committed files plus one gitignored: `BUILD-LOG.md` (append-only, one block per completed WP), `BLOCKED.md`, `BACKLOG.md`, `DECISIONS.md`, and `.build/state.json` (rewritten after every step group — current WP, step group, groups done/remaining, files written this WP, `lastGreenCommit`, repair rounds, budget).

**The re-read rule (D-057).** After any context reset, compaction, crash, or any gap where you are unsure what you were doing — **do not proceed from memory:**

```bash
cat .build/state.json
tail -60 BUILD-LOG.md
cat BLOCKED.md
git log --oneline -8
npm run green:fast ; echo "green:fast exit=$?"
```

Then read this file whole, and only the one named detail section for the current WP if the step group needs a detail this card does not carry. Never re-read the bundle whole.

**Mid-package resume.** A WP is resumed, never restarted. `green:fast` green ⇒ resume at `stepGroup`. Red ⇒ the crash landed mid-write: for each modified file **not** in `filesWrittenThisWp`, `git checkout --` it; for each that is, `node --check` it and rewrite a torn file from the brief. If it still fails inside a group listed as done, that group's claim was false — move it back to remaining and redo it. **`green:fast` outranks any recorded claim of completion.** Never `git reset --hard` past `lastGreenCommit`. Never disable a hook to recover.

**Never half-commit a WP.** Either revert to `lastGreenCommit` and record it, or split into WP-N.a / WP-N.b — editing `session-scope.json` and this file first, with a `Scope change:` row.

---

## 7. Fan-out

**D-058: fan out across independent artifacts; never within one.** Anthropic's multi-agent result is a 90.2% win on breadth-first *research* and explicitly excludes shared context, heavy inter-agent dependencies and "most coding tasks". This repo already shipped two mutually incompatible `refListStatus` shapes from two parallel authors. `[§4/L4]`

All four must hold: disjoint write set declared in advance in `packages/verify/config/fanout.json`; no shared invariant; a **named program** decides correctness without a model; bounded and enumerable. The four legal slices (registry records ×4, error-catalogue entries ×3, round-trip triage ×3 read-only, T1/T2 fixtures ×4) and their accepting programs are §5.5's table.

**Strictly sequential, one agent:** WP-0, WP-1, WP-4's schema, WP-5's stage code and decompiler, `t2-registry.mjs`, `walk.mjs`, `coverage.mjs`, WP-7a, WP-10.

**Hard rules.** Max 4 concurrent subagents. No subagent commits — subagents write files, you run the accepting program and commit. No subagent runs `npm install`, `npm ci`, `git checkout`, `git commit`, `git reset`, or anything mutating `node_modules/` or the index. Every subagent prompt carries exactly four things: its exclusive write globs, the schema or manifest contract, the acceptance command, and "return the list of paths you wrote and nothing else" — never the brief. A failed slice is redone by you and counts as a repair round.

---

## 8. Budget, repair cap, scope discipline

**Scope does not expand mid-session (D-051).** Anything not in `session-scope.json` goes to `BACKLOG.md` and nowhere else — better ideas found while reading code, generalisations that "would only take a minute", a fifth tier, a second brand's tokens, a nicer CLI, a refactor of a file the current WP merely reads.

**Three repair rounds per gate per WP (D-052).** A round is: read the failure, form one hypothesis, make one change, re-run. At round-3 failure choose exactly one and record it: **(a)** the gate is right and the design is wrong → the WP is blocked, revert to `lastGreenCommit`, evaluate S2; **(b)** the gate is wrong → fix the gate **and its mutation** in the same commit with its own DECISIONS row; **(c)** silence the gate → **banned, S7**. Three gates at round 3 inside one WP means the WP is mis-specified: split it.

**Budget checkpoints at 25 / 50 / 75 / 90%** of either envelope: print WP progress, steps, tokens and burn ratio (§5.6's one-liner), then `green:fast`. Burn ≤1.15 continue; 1.15–1.40 continue while dropping optional scope in §5.6's stated order only, each drop a BACKLOG row; >1.40 → **S4**. At 90% of either, S4 fires unconditionally. The session's last act is always a commit plus `prove` (or `--partial`) — never an in-flight WP.

**Never dropped at any burn ratio:** WP-0's eight gates, WP-1's Q1/Q2, the mutation on any gate, the coverage rules, `BUILD-LOG.md`/`BLOCKED.md` upkeep, and the anti-drift checklist.

---

## 9. Stop conditions

| ID | Condition | Action |
|---|---|---|
| **S0** | P1, P2, P4, P5, P6 or P7 fails | Do not start. Report the failing precondition and its fixing command. Write nothing |
| **S1** | WP-1 Q1 or Q2 not achieved after 3 repair rounds | `FINDINGS.md`: first divergent byte index, the construct, which program is wrong, and whether it is a normalisation gap or an IR expressiveness gap. Commit `[chore]- WP-1 record NO-GO`. **Do not start WP-2** |
| **S2** | A WP is `partial-blocked` and a later in-scope WP depends on it | Stop. Commit the blocked state. `prove --partial`. Report the severed chain |
| **S3** | `green:fast` red on 3 consecutive commit attempts in one WP | `git reset --hard <lastGreenCommit>` — the only legal hard reset, and only to that sha. Record it. Re-approach as a split |
| **S4** | Either budget at 90%, or burn ratio >1.40 at a checkpoint | Finish the current WP only. Commit. `prove --partial` → exit 3 |
| **S5** | Scoped round-trip rate <0.90 after 2 repair rounds | Stop. This falsifies the IR's expressiveness. `FINDINGS.md` with the `promote-to-sfs` list sorted by form count — that list is the redesign brief. Do not proceed to WP-7a |
| **S6** | A gate cannot be made to fail on its own declared mutation | The gate is theatre. Either make the mutation flip it, or delete it in the discovering commit with a `Gate removal:` row. **Never commit it.** A gate that cannot fail is worse than no gate |
| **S7** | Any attempt to satisfy a gate by weakening it, skipping a test, bypassing a hook, or editing an expected-output file without a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row | Revert immediately, record it in `BLOCKED.md` with the reverted diff, re-approach under §8(a)/(b). **This is the one failure mode the whole rebuild exists to make impossible** |

---

## 10. Blocked-path discipline

Every blocked path produces a `BLOCKED.md` row: ID, WP, what is blocked, the command and its observed output, the degraded state as a named tier/gate verdict, the unblock action, the date. `g-blocked-honesty` cross-checks both ways: every row must name a tier or gate **currently** reporting `uninspectable` / `notRun` / `pending-probe`, and every such state in committed artifacts must have a row.

The four you will most likely hit are §5.7's B3 (framework source unreachable — registry goes names-only, provenance `derived-from-kb-pending-BL-004`, T2.07/T2.08 dispose `uninspectable`, never invent a version integer, never write a machine-local `sourceDir`), B7 (offline install), B8 (the six out-of-scope corpus forms — decompile, triage, report `uninspectable`, never add them to the scope file to move the number), B9 (a scoped form will not round-trip — triage into `compiler-gap` or `promote-to-sfs`, never lower the 0.90 constant, never chase byte-equality with a form that carries defects) and B10 (a moved `verify-artifact` test fails — the count goes 15 → 17, never down; never `.skip`, `|| true`, or an edited assertion).

**Degrade to `uninspectable`, never to `pass`.** That single rule is the difference between this rebuild and the thing it replaces.

---

## 11. Before the final commit

Run §5.9's sixteen verifications **in order**. Every one is a command, not a judgement, and their observed output goes to `packages/verify/evidence/WP-10.json`, written by `npm run green` and checked by `g-commit-format`. In summary they prove: green from a clean install with mutations; `green` has not been quietly narrowed; every declared mutation is caught inside the 180 s ceiling; no documented command is unexecutable; no verdict is `warn` and no module exits `pass` with failures recorded; coverage and the walker are each defined exactly once; prose and brief budgets hold; references are one level deep; no changelog archaeology anywhere; no literal hex in authored source; every `$role:` resolves; no version integer has leaked into an instruction file; every DECISIONS row names a resolvable enforcer, every gate has a mutation, every check id has a fixture; the compiler is deterministic and clock-free and the only writer of markup; the disposition deletions are exact with no dangling references, no machine-local paths, a clean tree; and finally the proof.

**If any of items 1–15 does not produce its expected output, item 16 is not run.** Fix it, or record a `BLOCKED.md` row and accept a last line that is not `SESSION COMPLETE`. There is no third option — and specifically no option in which the session reports success on the strength of its own summary. The pre-rebuild repository passed every green signal it had.
