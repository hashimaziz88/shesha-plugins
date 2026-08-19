# HANDOFF — Shesha SFS rebuild, Scope A

Every line below is a command and the output that proves it. Nothing here is a
judgement; run the command and compare. Node must be v22+ (`fnm use v22.23.2`
first — a bare `node` does not resolve non-interactively here, BLOCKED B13).

## Verify the whole of Scope A

| Command | Expected |
|---|---|
| `node --version` | `v22.23.2` (or any v22+) |
| `npm ci` | installs; `node_modules/@shesha/*` present |
| `npm run typecheck` | exit 0, no output |
| `npm test` | exit 0; `pass` count > 0, `fail 0` |
| `npm run gates` | `gates: 24 run, 24 pass, 0 fail, 0 partial` · `gate ratchet: 24 countable >= floor 24` |
| `npm run gates:mutate` | `mutations=74 caught=74`, under the 180 s ceiling |
| `npm run green` | exit 0 (typecheck + tests + 24 gates + 74 mutations) |
| `npm run prove` | exit 0, final line `SESSION COMPLETE — SCOPE A` |

## The invariants, each by its own program

| Command | Expected |
|---|---|
| `node packages/verify/src/gates/g-decisions.mjs` | `PASS` · every enforcer resolves · `D-040..D-058 present` |
| `node packages/verify/src/gates/g-gate-contract.mjs` | `PASS` · every gate exports id/inputPaths/run/mutations (>= 2) |
| `node packages/verify/src/gates/g-mutation-coverage.mjs` | `PASS` · every tier check id covered or subsumed |
| `node packages/verify/src/gates/g-defect-class-coverage.mjs` | `PASS` · scope-A defect classes >= ceil(0.9*N) |
| `node packages/verify/src/gates/g-exit-codes.mjs` | `PASS` · verdict enum {pass,fail,partial,notRun} · no raw-literal exit |
| `node packages/registry/src/validate.mjs` | `names-only 121/121 · priority value-typed 13/13` |

## The compiler and the verifier ladder

| Command | Expected |
|---|---|
| `npm run sfs -- --version` | the SFS language version |
| `npm run sfs -- compile packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json --out .build/h` | `verdict pass`; writes `.form.json` + `.form.meta.json` + `.compile.json` |
| `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` | exit 0, `rate 1.00 (clean 4/4) · untriaged 0` |
| `node packages/verify/src/verify.mjs .build/h --screen inline-editable-table --tiers t1,t2` | exit 0, `t1 pass · t2 pass` |
| `node packages/sfs/tools/cost-delta.mjs --json` | `emitted` ratio >= 10, `preload` ratio >= 5, `gate: true` |

## Resume state

| Command | Expected |
|---|---|
| `git status --porcelain` | empty on a committed tree |
| `git log --oneline -1` | the WP-10 commit `[feature]- WP-10 ...` |
| `grep -c '^Status: complete' BUILD-LOG.md` | 12 (every scoped WP) |

## What is out of scope, and where it is written

Scope A is the twelve ids in `packages/verify/config/session-scope.json`. Everything
else is a `BACKLOG.md` row with its own acceptance command — T3/T4/T5 (BL-003/BL-005),
the hooks + MCP surface (BL-008), precedent retrieval (BL-009), the full-registry parse
(BL-004/BL-020), colour provenance (BL-023), and the rest. None is started here; each
becomes live the moment its row leaves `BACKLOG.md`.
