# BACKLOG

Out of scope for this session, in writing (D-051). Every row carries `Raised in WP`,
`Blocks = No`, and an `Acceptance` command copied verbatim from the section that owns it.
A row whose `Blocks` is not `No` means the item is either in scope or the session is stopped.

| ID | Item | Owner | Raised in WP | Blocks | Acceptance |
|---|---|---|---|---|---|
| BL-001 | Three-arm SAA comparison and the token/step cost claim | §6 P1.3 | WP-0 | No | `node packages/verify/src/cost-delta.mjs --arms 3` exits 0 with 8-10 cases per arm |
| BL-002 | Round-trip >= 0.90 over all 12 corpus forms | §2.5 | WP-0 | No | `npm run sfs -- roundtrip --scope all-12.json` -> exit 0, `rate >= 0.90` |
| BL-003 | WP-3b: T3's 22 checks, placement predicates, un-quarantine `t3-semantic.mjs` and `g-check-references.mjs` | §3.3, §3.4 | WP-0 | No | `node packages/verify/src/verify.mjs .build/wp3b --screen inline-editable-table --tiers t1,t2,t3` -> exit 0 |
| BL-004 | Registry `propsCompleteness: full >= 93 of 121` from framework TypeScript at a pinned ref | §2.8 | WP-0 | No | `node packages/registry/src/validate.mjs` -> `priority full 13/13 · full >= 93/121` |
| BL-005 | WP-3c/3d: T4 live smoke, T4b DOM residue, T5 advisory; port `quarantine/layout-probe.js` to ESM | §3.5, §3.6 | WP-0 | No | `npx playwright install chromium` then `node packages/verify/src/verify.mjs .build/wp3c --tiers t4` -> exit 0 |
| BL-006 | Real 23-field envelope validation against a backend export | §2.1.2 | WP-0 | No | `node packages/verify/src/tiers/t1-schema.mjs --envelope <real-export>.json` -> exit 0, `file family checked` |
| BL-007 | Rewrite the three design skills thin (`shesha-claude-designer` -> `shesha-designer`, `shesha-design-comprehension`, `shesha-design-system`) | §4.4 | WP-0 | No | `node packages/verify/src/gates/g-prose-budget.mjs` -> exit 0 with 0 waivers whose `until` is BL-007 |
| BL-008 | WP-8: `.claude/hooks/**`, `.mcp.json`, the three agent roles, `enabledPlugins` wiring | §4.3, §4.1 | WP-0 | No | After a session RESTART: plant a `.form.json` Write and observe the denial; `node packages/verify/src/gates/g-githook-contract.mjs` -> exit 0 |
| BL-009 | WP-9: precedent retrieval, shape-indexed (JSONL + Float32Array sidecar, not `node:sqlite`) | §4.7 | WP-0 | No | `node --test packages/precedent/test/` -> exit 0 with retrieval tests, no `E_NOT_IMPLEMENTED` |
| BL-010 | Re-enable `noUncheckedIndexedAccess` across the tree-walking modules | D-024 | WP-0 | No | `npm run typecheck` -> exit 0 with `noUncheckedIndexedAccess: true` in tsconfig.json |
| BL-011 | Split the brief bundle to <= 61440 B total: every >8-row table to `docs/rebuild-brief/data/*.json`, every literal file to `artifacts/`, 0 fenced blocks > 40 lines | §5.2 D-046 | WP-0 | No | `node packages/verify/src/gates/g-brief-budget.mjs` -> exit 0 with `bundle.enforced: true` and total <= 61440 |
| BL-012 | Clear the carried prose debt in the nine non-design skills: archaeology matches, and the `add-public-portal` folder/frontmatter-name mismatch | §1.1 | WP-0 | No | `node packages/verify/src/gates/g-prose-budget.mjs` -> exit 0 with 0 waivers whose `until` is BL-012 |
| BL-013 | `DECISIONS.md` is at 24512 of its 24,576 B cap. Implement `gen-decisions.mjs --archive`, which moves `superseded-by-D-0NN` rows to `docs/decisions-archive.md` so the registry stays under budget as rows accrue | §1.4 | WP-1.a | No | `node packages/registry/src/gen-decisions.mjs --archive && node packages/verify/src/gates/g-decisions.mjs` -> exit 0 with DECISIONS.md under 24576 B |
| GAP-nnn | Compiler gaps discovered in WP-5 triage | §2.5 | WP-5 | No | Each carries a `test.todo` fixture under `packages/sfs/test/fixtures/gaps/` naming its id |
| PROM-nnn | SFS promotions discovered in WP-5 triage | §2.5 | WP-5 | No | Each carries prop names and the count of forms needing it |

## Notes

BL-011 is the one deferral that changes a gate's declared scope rather than adding
work: `g-brief-budget` enforces `CONTROL.md <= 25600 B` in Scope A (D-060, override O2)
and measures the bundle against its 61440 B target without failing on it. The
brief bundle measures 594,452 B across 8 files today — 9.7x the cap — so enforcing it
now would either fail every commit or require deleting the detail sections that
WP-1..WP-10 still have to read. See BLOCKED.md B11.
