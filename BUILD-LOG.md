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

## WP-0 — Workspace, coverage primitives, eight gates — 2026-08-17

Status: complete
Commit: 6299020 (pushed to origin/hashim/sfs-rebuild-scope-a)
Created: the npm workspace and five packages, `packages/registry/src/coverage.mjs` (the one
coverage implementation) with 23 tests, all eight gates with 29 verdict-flipping mutations, the
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

