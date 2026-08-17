# BLOCKED

Every blocked or degraded path has a row. No silent degradation. `g-blocked-honesty`
(ships WP-2) cross-checks both ways: every row must name a tier or gate **currently**
reporting `uninspectable` / `notRun` / `pending-probe`, and every such state in a
committed artifact must have a row here.

| ID | WP | What is blocked | Evidence (command + observed output) | Degraded state (tier/gate + verdict) | Unblock action | Recorded |
|----|----|----|----|----|----|----|
| B11 | WP-0 | The whole-brief 61,440 B budget of D-046 cannot be enforced in Scope A | `node -e` summing `docs/rebuild-brief/*.md` -> `bundle 594452 B across 8 files`, i.e. 9.7x the cap | `g-brief-budget` enforces `CONTROL.md <= 25600` only; `bundle.enforced: false` in `packages/verify/config/brief-budget.json`, paired with BL-011 | Execute BL-011: extract every >8-row table to `data/*.json` and every literal file to `artifacts/`, then set `bundle.enforced: true` | 2026-08-17 |
| B12 | WP-0 | 34 pre-existing prose-debt allowances carried as measured waivers | `node packages/verify/src/gates/g-prose-budget.mjs --baseline` -> `34 waiver(s) written from measured sizes` | `g-prose-budget` passes with 34 waivers, each dated to WP-7a / BL-007 / WP-2 / BL-012; caps ratchet down only and `--baseline` refuses to raise one | WP-7a deletes 22 of them with `shesha-form-edit/**`; BL-007 clears the design-skill 8; WP-2 regenerates the 2 `components-kb` provenance files; BL-012 clears the last 3 | 2026-08-17 |
| B13 | WP-0 | Node is not on PATH in any non-interactive shell on this machine | `node --version` -> `command not found`; `fnm list` -> `v20.20.2 v22.23.2 v24.19.0 default` | None. Every acceptance command in this session ran under an fnm-activated PATH and `g-commands-executable` resolves through `process.execPath`, not a bare `node` | Nothing required for correctness. A CI runner with Node 22+ on PATH satisfies it directly | 2026-08-17 |

| B14 | WP-0 | WP-0 shipped against a CONTROL.md that has since gained overrides O6 and O7, both of which supersede what was built and committed | `git log --oneline -1 docs/rebuild-brief/CONTROL.md` shows the file changed after 6299020 was made; O7 requires 11 WP-0 gates against the 8 on disk, and O6 replaces the `scheduled:`/`scheduled-enforcers.json` vocabulary with `pending:<WP-id>`/`pending-budget.json` (`max: 20`) | WP-0's `Status` withdrawn from `complete` to `partial-blocked`; `g-decisions` currently resolves a form O6 calls a typo, and `gate-ratchet.json`'s floor of 8 contradicts O7's eleven | Reconcile in this order: (1) rewrite every `scheduled:<WP\|BL>:<id>` entry in DECISIONS.md to `pending:<WP-id>`; (2) replace `scheduled-enforcers.json` with `pending-budget.json`; (3) teach `g-decisions` the five legal forms of O6; (4) ship `g-githook-contract`, `g-no-secrets-or-scratch` and `g-disposition`, each with >= 2 mutations; (5) raise `gate-ratchet.json` floor 8 -> 11; (6) resolve the pending-count conflict below | 2026-08-17 |

## Open conflict inside B14 — needs a decision, not a guess

O6 fixes `pending-budget.json` at `max: 20`, "ratcheting down only". That figure comes
from §1.4, where it counts the 20 deferred rows of a **37-row** seed set. The registry
now holds **69** rows, of which roughly **33** defer their enforcer, and O7 converts
only a handful back to live gate ids (`g-disposition` covers D-001 and D-011). So
`max: 20` against a measured ~33 fails `g-decisions` on arithmetic, and there is no
honest way to reach 20 by writing rules differently — the deferred work genuinely
exists. Either the baseline is the measured count at WP-0 (ratcheting down from there,
as `command-floor.json` and the prose waivers already do), or ~13 decisions must be
deleted from the registry. That is a scope judgement, so it is recorded here rather
than resolved silently.

## Environment note (not a block)

P8's network probe returned `net 200`, so B3 (framework source unreachable) did **not**
fire and the registry is not forced to names-only provenance. P5 reached the npm
registry and `ajv@8.17.1` resolved, so B7 (offline install) did not fire either.
