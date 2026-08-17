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

## Environment note (not a block)

P8's network probe returned `net 200`, so B3 (framework source unreachable) did **not**
fire and the registry is not forced to names-only provenance. P5 reached the npm
registry and `ajv@8.17.1` resolved, so B7 (offline install) did not fire either.
