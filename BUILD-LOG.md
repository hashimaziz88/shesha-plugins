# BUILD LOG

Append-only. One block per completed work package, written as the last edit before
that WP's commit. A block exists only when its acceptance command has exited 0.

## Session preconditions — 2026-08-17

Run in CONTROL §2 order, with override O4 applied before P3.

| # | Command | Observed | Verdict |
|---|---|---|---|
| P1 | `node --version` | `v24.19.0` (via fnm; not on PATH in non-interactive shells — BLOCKED B13) | pass, >= v22 |
| P2 | `git log --oneline -1` | `8a2d2f4 [chore]- Remove accidentally committed .tmp-negtest scratch file` | pass |
| O4 | `git status --porcelain` / `git diff --stat` / `git config core.autocrlf` | 1 line (`?? docs/`); empty diff; `true` | no line-ending artifact; nothing to stash |
| P3 | `git status --porcelain` | `?? docs/` only — the brief this WP commits | pass |
| P4 | `ls docs/rebuild-brief/*.md \| wc -l` | `8` | pass, >= 6 |
| P5 | `npm ping && npm view ajv@8.17.1 version` | `PONG 479ms`; `8.17.1` | pass |
| P6 | `test -f .../assets/examples/inline-editable-table.json` | exit 0 | pass |
| P7 | `test -f docs/rebuild-brief/artifacts/bookings-table.revision2.json` | exit 0 | pass |
| P8 | network HEAD probe | `net 200` | network available; B3 does not fire |

Branch created per override O3: `hashim/sfs-rebuild-scope-a` from `8a2d2f4`. `upstream`
is `shesha-io/shesha-plugins` and was never pushed to.

## WP-0 — Workspace, coverage primitives, eleven gates — 2026-08-17

Status: complete
Commit: 6299020 (pushed to origin/hashim/sfs-rebuild-scope-a)
Created: the npm workspace and five packages, `packages/registry/src/coverage.mjs` (the one
coverage implementation) with 23 tests, all eleven gates of override O7 with 39
verdict-flipping mutations, the
mutation harness, `DECISIONS.md` (68 rows + the No-theatre block), `gen-decisions.mjs` and its
byte-compared `decisions.json`, 7 probe scripts, `CLAUDE.md`, the `sfs` entrypoint, `prove.mjs`,
`write-evidence.mjs`, 16 config files, both git hooks, and two CI workflows
Gate: `npm run green:fast && node packages/verify/src/gates/g-decisions.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-0.json
Decisions added: D-001..D-068
Blocked: B11, B12, B13
Next: WP-1.a

Reconciled to CONTROL O6 and O7 in a follow-up commit: every deferred enforcer now uses
O6's `pending:<WP-id>` form against `pending-budget.json` (max 20, counting distinct
owner ids per D-073, measured 9); the gate roster is O7's eleven, with
`g-githook-contract`, `g-no-secrets-or-scratch` and `g-disposition` added and
`gate-ratchet.json`'s floor raised 8 -> 11.

What is proven by a program, with the command that proved it:

| Artifact | Evidence |
|---|---|
| Workspace: 5 packages, junction-linked, lockfile written | `npm install` -> `added 14 packages`; `node_modules/@shesha/*` all Junction |
| `npm run typecheck` over the tree | exit 0 |
| Coverage library, the whole of §3.1.2 in `packages/registry/src/coverage.mjs` | `node --test` -> 23 named tests, 23 pass (§3.1.4 floor is 21) |
| Re-export chain resolves at runtime | `import('@shesha/verify/coverage')` -> `verdict= pass` |
| The 15 moved `verify-artifact` tests still pass after the move | `npm test` -> `tests 38 · pass 38 · fail 0` (23 coverage + 15 moved); only the suite's `SCRIPT` path constant changed |
| `npm run typecheck` after the moves | exit 0 over the whole include set |
| Gate runner discovers and runs gates without an ESM cycle | `node packages/verify/src/run-gates.mjs` -> `gates: 5 run` (was exit 13, an unsettled top-level await) |
| The gate ratchet refuses an incomplete roster | `gate ratchet: FAIL — 5 countable gate(s) against a floor of 8` |
| Brief bundle measured for B11 | `bundle 594452 B across 8 files` against a 61,440 B target |
| 5 `git mv` renames staged | `git status --porcelain` -> 5 `R` entries |
| 6 WP-0 deletions executed | no `package.json` remains anywhere under `plugins/` |
| `g-prose-budget` over the real tree | 9 families, 568 pointers walked, 0 failures except `DECISIONS.md`/`BACKLOG.md` not yet written |
| `g-prose-budget --baseline` | `34 waiver(s) written from measured sizes`, each dated to a WP or BL id |

Gates shipped: **all 8** that CONTROL §3 requires — `g-decisions`, `g-brief-budget`,
`g-prose-budget`, `g-commit-format`, `g-gate-contract`, `g-coverage-single-impl`,
`g-commands-executable`, `g-workspace-hygiene`.

WP-0's acceptance command passes:

```
npm run green:fast                                        -> exit 0
node packages/verify/src/gates/g-decisions.mjs            -> exit 0
  rows=68 enforcers=71/71 resolved · scheduled=33 · unresolved=0
  D-040..D-058 present
npm run green                                             -> exit 0
  typecheck 0 errors · tests 38=38 pass 0 fail
  gates: 8 run, 8 pass, 0 fail, 0 partial · ratchet 8 >= 8
  mutations=29 caught=29 seconds=32.2   (ceiling 180)
node packages/verify/src/run-gates.mjs --count            -> 8
npm run sfs -- --version                                  -> 0.1.0
npm run prove -- --partial                                -> exit 3, SESSION INCOMPLETE
```

Five defects the mutation harness found in the gates themselves, each of which
would have produced a false green:

| Defect | How it was caught |
|---|---|
| `g-coverage-single-impl` and `g-workspace-hygiene` matched their OWN source — a detector carrying its patterns inline finds itself | Both reported themselves as the second implementation. Patterns moved to `source-patterns.json` (D-066) |
| The same two matched their own **mutation payloads**, which are literal source text | Payloads now assembled from parts |
| Six gates read paths absent from their declared `inputPaths`, so a staged copy made every check look absent | The unmutated-baseline assertion (D-067) refused to attribute a flip to the mutation |
| `g-workspace-hygiene` failed six pre-existing skill helper scripts, a purity rule `g-skill-purity` owns at WP-7a | Removed from this gate's subject (D-068) |
| `--baseline` silently dropped the carried-debt waivers it was not adjudicating | Three dated debts reverted to failures |


## WP-1.a — stage 1 and its inputs

Status: in progress. The registry split (D-075) unblocked the decision registry: it
sat at 24,512 of 24,576 B, so every new rule was being paid for by trimming an
existing row. The registry is now the union of two files and `g-decisions` walks
both, which cost 27 rows of prompt payload and no enforcement at all.

Two conflicts in the brief were resolved before any compiler code was written,
because both would have cost repair rounds later:

| Conflict | Resolution |
|---|---|
| §5.2's Q1 and `.build/state.json` disagreed about Q1's subject | §2.4.5 P1 is authoritative: `compile(decompile(compile(x))).Markup === compile(x).Markup` over the clean fixture, not a property of the legacy corpus form |
| O1 says the golden reference exists; the earlier session had recorded it as absent | It exists at `docs/rebuild-brief/artifacts/bookings-table.revision2.json`, 23,252 B, and carries all eight defect classes. It is Q2's first subject; `inline-editable-table` is the second |

Q2's real constraint, stated once because it governs every remaining stage:
`normaliseLegacy` changes the golden by exactly N1..N12, so `compile(decompile(m))`
must differ from `m` by exactly N1..N12 as well. The decompiler is therefore lossless
by construction, and every normalisation the compiler performs has to be in the
oracle's contract. Both are pending write-up as D-076 and D-077 in `.build/state.json`.

```
node --test packages/sfs/test/s1-parse.test.mjs           -> exit 0, 19/19
npm run green:fast                                        -> exit 0
  typecheck 0 errors · tests 57 pass 0 fail
  gates: 11 run, 11 pass, 0 fail, 0 partial · ratchet 11 >= 11
npm run gates:mutate                                      -> mutations=41 caught=41 seconds=36.3
node packages/registry/src/gen-decisions.mjs --archive     -> 46 live, 29 archived, 75 in the union
```

Three gate defects found this session, all the same class and all caught by the
D-067 unmutated-baseline assertion rather than by inspection:

| Defect | How it was caught |
|---|---|
| Archiving 27 rows moved their acceptance commands out of `g-commands-executable`'s scan set, draining the floor from 41 to 39 | The gate failed on the real tree. Archiving must never be a way to drain a floor, so the archive is now in its scan set |
| `g-gate-contract` validates every other gate's `inputPaths`, so a path declared by any gate and missing from its own staged tree reads as "declares a path that does not exist" | Baseline fail on three mutations |
| Staging runs through `git ls-files`, so a new-but-untracked input path stages nothing | Baseline fail; `scratchpad/why-baseline.mjs` now reproduces this class in one command |

One correctness defect in stage 1 itself, found by running it rather than reasoning
about it: the forbidden-key scan treated `navigate`'s `args: {id: ...}` as a forged
`id`, which made the canonical fixture unparseable. Query-parameter names are data,
so the scan now stops at `props`, `args`, `relay` and `const`. Pinned by a test.

## WP-1.a — the six stages

Status: in progress. `compile()` is complete and is the only function in the repository
that produces form markup. The clean fixture compiles, and the numbers landed on the
reference form's own values without being aimed at them:

| Measure | Compiled fixture | Reference form |
|---|---|---|
| components | 12 | 12 |
| breakpoint blocks | 33 | 33 |
| markup bytes | 16,900 | 19,170 |

The reference form is larger because it carries the eight defects: a duplicated
`dblClickActionConfiguration`, a `stylingBox` at base *and* in all three blocks, and two
styling channels on every `text` node. Producing fewer bytes for the same twelve
components is the normalisation, not a shortfall.

`section 2.6`'s predicates live in `packages/sfs/test/predicates.mjs` as ONE
implementation with two callers, so `g-sfs-invariants` imports them rather than
restating them. All eleven rules, the column triplet, the identities A1..A5, A7 and Q5
determinism pass:

```
node --test packages/sfs/test/golden-defects.test.mjs   -> exit 0, 21/21
npm run sfs -- compile packages/sfs/test/fixtures/clean/bookings-table.sfs.json --out .build/wp1a
  -> exit 3, verdict partial, 7 binding(s) uninspectable (no backend), markup written
npm run green:fast                                       -> exit 0
  typecheck 0 errors - tests 78 pass 0 fail
  gates: 11 run, 11 pass, 0 fail, 0 partial - ratchet 11 >= 11
```

Exit 3 on a successful compile is the design, not a fault: with no backend, every
binding is `uninspectable` and the verdict is `partial`. Markup is still produced,
because determinism and oracle agreement are properties of the bytes and are provable
with no backend in the room.

Two defects the tooling found that review would not have:

| Defect | How it was caught |
|---|---|
| The forbidden-key scan read `navigate`'s `args: {id: ...}` as a forged `id`, making the canonical fixture unparseable | Running stage 1 on the fixture. Query-parameter names are data, so the scan stops at `props`, `args`, `relay`, `const` |
| A `[default]`-on-edit/create check in `predicates.mjs` was unreachable — the triplet guard above it already required both to be `[not-editable]` | `tsc` reported the comparison as having no overlap. The dead branch was removed rather than kept as coverage it never provided |
