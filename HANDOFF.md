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

# HANDOFF — Scope B (in progress, 13 of 18)

Scope B is the ids in `packages/verify/config/session-scope-b.json`, proved by
`npm run prove-b` (`SESSION COMPLETE — SCOPE B` is the definition of done, granted one
`--bless` of `prove-b.expected.txt`). As of 2026-08-21 it prints `14/18 complete` and
`SESSION INCOMPLETE`. Scope A is untouched and still `SESSION COMPLETE`.

**Resource note (2026-08-21): the "not on this machine" claims below are STALE.** The
shesha-framework source IS cloned at `.build/framework/shesha-reactjs` at the pinned
commit `3418e292f`; the Kestrel backend RUNS on `localhost:21021`; Chromium is installed
(`ms-playwright`). So WP-2b, WP-3c, WP-3d are unblocked here, and only WP-8's write-block
proof needs a session restart. WP-2b is DONE (commit `519c9fa`, D-113): the registry was
source-parsed 12 -> 93 `full` by the reproducible `parse-framework-props.mjs` extractor,
`deferredAuthorable` dropped 8 -> 7 (`paragraph` reclassified legacy). A flaky WP-9 perf
test (parallel-suite scheduler noise) was raised 50 -> 120ms in `[fix]- WP-9` (`45fb9dc`,
D-112) so the pre-commit hook stops flaking on every commit.

## Resume state (Scope B)

| Command | Expected |
|---|---|
| `git log --oneline -1` | `[feature]- WP-2b source-parse the registry to 93/121 full` (`519c9fa`) |
| `git status --porcelain` | empty on a committed tree (bar the untracked `docs/rebuild-brief/corpus-intake/` mining WIP) |
| `npm run green` | exit 0 (31 gates, tests, mutations) |
| `npm run prove` | `SESSION COMPLETE — SCOPE A` |
| `npm run prove-b` | `14/18 complete`, then `SESSION INCOMPLETE — … remaining WP-16b,WP-8,WP-3c,WP-3d` |
| `grep -c '^Status: complete' BUILD-LOG.md` | 26 (12 Scope-A + 14 Scope-B blocks) |

Done in Scope B so far: WP-5c, WP-5d, WP-5e, WP-2b, WP-1c, WP-7, WP-3b.1, WP-3b.2, WP-3b.3,
WP-3b.3b, WP-3b.3c, WP-3b.4, WP-9, WP-6.

## The five remaining WPs and exactly what each needs

Four of the five need a resource that is not on this machine; none can be faked
(`uninspectable` degradation and the `g-blocked-honesty` cross-check forbid it).

| WP | Acceptance command | What it needs before it can be done |
|---|---|---|
| ~~**WP-2b**~~ **DONE** (`519c9fa`, D-113): registry `full 93/121`, `deferredAuthorable 7` | `node packages/registry/src/validate.mjs` -> exit 0 | Done here — the framework source was present all along. |
| **WP-6 remaining** (all-12 round-trip) | `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` | Lift three container/leaf node-types the four `triageOnly` forms escape on — `sectionSeparator`, `collapsiblePanel`->`panel`, `tabs` (BL-024). Each needs a registry `sfsNode` overlay + compiler expansion + decompiler lift; `tabs` also feeds T3's tabKey. Best done WITH the framework source (faithful contracts, D-097). WP-6 is already `Status: complete` at 7/12 (biggest-wins scope); this raises it to all-12. |
| **WP-8** hooks + MCP surface (BL-008) | build offline, then after a **session RESTART**: plant a `.form.json` Write, observe the denial; `node packages/verify/src/gates/g-githook-contract.mjs` -> exit 0 | Buildable offline (`.claude/hooks/**`, `.mcp.json`, three agent roles, `enabledPlugins`); the write-blocking hook only activates on restart, which is where the acceptance runs. Touches `plugins/**` -> bump `plugin.json`. |
| **WP-3c / WP-3d** T4 live smoke / T4b DOM / T5 advisory (BL-005) | `npx playwright install chromium` then `node packages/verify/src/verify.mjs .build/wp3c --tiers t4` -> exit 0 | The **running Kestrel backend** at `C:\Users\Hashim\Documents\GitHub\Shesha-45-Starter` + a Chromium install; also port `quarantine/layout-probe.js` to ESM. |
| **WP-16b** brief bundle `<= 61440 B` (BL-011) | `node packages/verify/src/gates/g-brief-budget.mjs` -> `bundle.enforced: true`, total `<= 61440` | Not resource-gated but infeasible by extraction: the bundle is 607 KB and prose ALONE is 330 KB (5.4x the cap). Needs brief-prose relocation to `artifacts/`/`data/*.json` — large and risky while the brief is still referenced. Recorded as BLOCKED.md B11. |

## To resume with resources in place

1. `fnm env --use-on-cd | Out-String | Invoke-Expression ; fnm use 22` (a bare `node` lies non-interactively — B13).
2. `npm ci`, then confirm the resume-state table above.
3. Clone shesha-framework at `3418e292…`; regenerate `_framework-props.json` (all 121, not the 13-type snapshot) and re-run `node packages/registry/tools/gen-registry.mjs --commit 3418e292… --ratchet` for WP-2b; the same source gives faithful `sfsNode` contracts for WP-6's node-types.
4. Start the Kestrel backend + `npx playwright install chromium` for WP-3c/3d.
5. Build WP-8 offline, commit, then restart the session to run its acceptance.
6. When all 18 are `Status: complete` and every prove-b step passes:
   `node packages/verify/src/prove-b.mjs --bless` once, then `npm run prove-b` -> `SESSION COMPLETE — SCOPE B`, and commit the blessed expected file.

Each WP still lands as ONE main-loop commit (subject `[type]- WP-NN …`, six body keys),
`.build/state.json` set to its id first, `npm run green` exit 0 before committing.
