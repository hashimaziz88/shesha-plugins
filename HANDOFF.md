# HANDOFF — Shesha SFS rebuild

Every line below is a command and the output that proves it. Nothing here is a
judgement; run the command and compare. Node must be v22+ (`fnm use v22.23.2`
first — a bare `node` does not resolve non-interactively here, BLOCKED B13).

Two scopes, two proofs, and no third one. Scope A is the twelve ids in
`packages/verify/config/session-scope.json`, proved by `npm run prove`. Scope B is the
twenty-three ids in `packages/verify/config/session-scope-b.json`, proved by
`npm run prove-b`. "Phase 2" and "Phase 3" name subdivisions of Scope B, not scopes of
their own; there is no `session-scope-c.json`.

## The standing definition of done

| Command | Expected |
|---|---|
| `node --version` | `v22.23.2` (or any v22+; `package.json` engines is `>=22.0.0`) |
| `npm ci` | installs from the committed `package-lock.json`; `node_modules/@shesha/*` present |
| `npm run typecheck` | exit 0, no output |
| `npm test` | exit 0; `# fail 0` (593 passing at this writing) |
| `npm run gates` | `0 fail, 0 partial`, and `gate ratchet: <countable> >= floor`. The floor is `minGates` in `packages/verify/config/gate-ratchet.json`, currently 41, and it ratchets up with each gate a WP adds — read the file rather than trusting this line |
| `npm run gates:mutate` | exit 0, `# fail 0`; every declared mutation flips its gate's verdict |
| `npm run green` | exit 0 — typecheck + tests + gates + mutations. The pushable tree |
| `npm run prove` | exit 0, final line `SESSION COMPLETE — SCOPE A` |
| `npm run prove-b` | `22/23 complete`, then `SESSION INCOMPLETE — … remaining WP-3d` |
| `grep -c '^Status: complete' BUILD-LOG.md` | 34 (12 Scope-A + 22 Scope-B blocks) |

## The invariants, each by its own program

| Command | Expected |
|---|---|
| `node packages/verify/src/gates/g-decisions.mjs` | `PASS` · every DECISIONS.md row's enforcer resolves across both files |
| `node packages/verify/src/gates/g-gate-contract.mjs` | `PASS` · every gate exports id/inputPaths/run/mutations (>= 2) and the on-disk roster matches the declared one |
| `node packages/verify/src/gates/g-markup-provenance.mjs` | `PASS` · every committed `*.form.json` recompiles byte-identically from its sibling SFS (INV 1) |
| `node packages/verify/src/gates/g-blocked-honesty.mjs` | exit 0 · every BLOCKED row names a real degradation, and no gate promises code it does not ship |
| `node packages/verify/src/gates/g-coverage-single-impl.mjs` | `PASS` · one coverage implementation, two one-line re-exports |
| `node packages/verify/src/gates/g-exit-codes.mjs` | `PASS` · verdict enum {pass,fail,partial,notRun} · no raw-literal exit |
| `node packages/registry/src/validate.mjs` | `full 93/121 · names-only 121/121 · priority full 13/13 (value-typed 13/13) · deferredAuthorable 7 · frameworkPresent true` |

## The compiler and the verifier ladder

| Command | Expected |
|---|---|
| `npm run sfs -- --version` | the SFS language version |
| `npm run sfs -- compile packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json --out .build/h` | `verdict pass`; writes `.form.json` + `.form.meta.json` + `.compile.json` |
| `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` | exit 0, `7 of 12 forms clean+stable at rate 1.00`, 1 documented escape (BL-021), 4 triage-only (BL-024) |
| `node packages/verify/src/verify.mjs .build/h --screen inline-editable-table --tiers t1,t2` | exit 0, `t1 pass · t2 pass` |
| `node packages/sfs/tools/cost-delta.mjs --json` | `emitted` ratio >= 10 (measured 15.00), `preload` ratio >= 5 (measured 76.44), `gate: true` |

## T4 and T4b — the ladder's last two offline tiers (WP-3c)

These seven are the standing acceptance for WP-3c and must keep printing this. `capture()`
drives a page and records it; `t4Smoke()` asserts over the recording, so only the recording
needs a browser and `npm run green` launches nothing. `playwright` 1.55.0 is a
`packages/verify` devDependency; `npx playwright install chromium` stays an operator step
and is needed only for the live path (BL-033).

| Command | Expected |
|---|---|
| `node packages/verify/src/tiers/t4-smoke.mjs --selftest --json` | exit 0 · all six checks pass against the `node:http` ABP stub backend |
| `node packages/verify/src/tiers/t4b-residue.mjs packages/sfs/test/fixtures/probe/login.probe.overflow.json --json` | exit 1 · the overflow probe fails |
| `node packages/verify/src/tiers/t4b-residue.mjs packages/sfs/test/fixtures/probe/login.probe.no-name.json --json` | exit 3 · every finding `uninspectable` — residue on a node with no `data-sha-c-name` self-or-ancestor is unattributable, never a pass |
| `node packages/verify/src/verify.mjs .build/wp3c --screen inline-editable-table --tiers t1,t2,t3,t4 --metadata packages/sfs/test/fixtures/metadata/inline-editable-table.metadata.json --json` | exit 3 · `result: "pass"` · `tiers.T4 = {"result":"notRun","reason":"no --base-url given"}` |
| `node --test packages/verify/test/probe.test.mjs` | exit 0 · prints `data-sha-c-name captured on 17/17 named nodes · summary bytes 8139 <= 8192 · rowBand parent-relative true` |
| `node packages/verify/src/gates/g-blocked-honesty.mjs` | exit 0 |
| `npm run prove-b` | `22/23` |

`quarantine/` is gone. Its last file, the CJS DOM probe, is superseded by
`packages/verify/src/probe/layout-probe.mjs` carrying all six §3.2.5 changes, and
`packages/verify/config/quarantine.json` is deleted. Nothing references either.

## The one remaining work package

| WP | Acceptance command | What it needs |
|---|---|---|
| **WP-3d** — T5 advisory visual (BL-005 §3.6) | `node packages/verify/src/verify.mjs <run> --screen <s> --tiers t5` -> T5 reports advisory findings and never enters `result` | Nothing external. T5 is advisory by D-015: it never contributes to the verdict, so it degrades to `notRun` with a reason rather than blocking. `g-t5-advisory` must ship with >= 2 mutations, join the declared roster, and raise the gate-ratchet floor |

When WP-3d is `Status: complete` and every prove-b step passes:
`node packages/verify/src/prove-b.mjs --bless` once, then `npm run prove-b` ->
`SESSION COMPLETE — SCOPE B`, and commit the blessed expected file.

## What is out of scope, and where it is written

Everything else is a `BACKLOG.md` row with its own acceptance command. Genuinely open today:

| Row | Item |
|---|---|
| BL-001 | three-arm SAA comparison behind `packages/sfs/tools/cost-delta.mjs --arms 3` |
| BL-002 / BL-024 | round-trip over all 12 corpus forms; the three container node-types the four triage-only forms escape on (`sectionSeparator`, `collapsiblePanel`->`panel`, `tabs`) |
| BL-006 | real 23-field envelope validation against a backend export |
| BL-011 | brief bundle <= 61440 B — **permanently deferred** by D-114, not pending: infeasible by the sanctioned extraction. `bundle.enforced` stays `false` |
| BL-014 | property-based compiler fuzzer over generated SFS documents |
| BL-015 | half shipped. `packages/sfs/test/oracle.test.mjs` exists; the `.github/workflows/` CI job does not, and authoring it is out of bounds here |
| BL-021 | lift legacy `columns`/`sizableColumns` to `row` + `responsive.fixed`; `standalone-create` is the one declared structural escape |
| BL-022 | framework versions for the 7 authorable-but-version-unknown types |
| BL-023 | compiler emits `resolvedFrom` colour provenance so T2.17 verifies at the output tier |
| BL-033 | the live T4/T4b path against a running Shesha frontend + backend. `--selftest` proves the assertions, not the transport (BLOCKED B14) |
| BL-034 | qualify a judge model on 10 anchors — needs 10 accepted screens with design sources, which do not exist as a committed set |

BL-008 stays as a row for one reason only: D-017 and D-022 still carry `pending:BL-008`,
and deleting the row hard-fails `g-decisions`. Its implementation shipped across
WP-8a..WP-8d — hooks, `.mcp.json`, the six agent roles and the `shesha-sfs` MCP surface.

## To resume

1. `fnm env --use-on-cd | Out-String | Invoke-Expression ; fnm use 22` (a bare `node` lies
   non-interactively — B13). `cd` into the repo can auto-switch Node; re-check `node --version`.
2. `npm ci`, then confirm the standing-definition-of-done table above.
3. Set `.build/state.json` to `WP-3d`, build it, and hold `npm run green` at exit 0.
4. WP-3d lands as ONE main-loop commit (subject `[type]- WP-NN …`, six body keys), with
   `packages/verify/evidence/WP-3d.json` in the commit and its `gitSha` matching.
