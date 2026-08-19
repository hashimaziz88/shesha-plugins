# Resume prompt — finish the entire rebuild

> Paste everything below the line into Claude Code in `C:\Users\Hashim\Documents\GitHub\shesha-plugins`.
> Contains `ultracode`.

---

ultracode

**Goal: complete the entire Shesha SFS rebuild — Scope A to `SESSION COMPLETE`, then the backlog that is achievable without a restart or a live backend, then a precise operator handoff for what genuinely cannot be verified in-session.** You are resuming work already in progress on branch `hashim/sfs-rebuild-scope-a`. Do not restart it and do not trust any summary of it, including this one.

## Phase 0 — Orient from evidence, not memory

`node` is **not on PATH in non-interactive shells on this machine** (BLOCKED B13). Activate it first or every command lies to you:

```bash
fnm use 22 || fnm use v22.23.2
node --version   # must print v22.x
```

Then, in this order, and read the output before deciding anything:

```bash
git branch --show-current && git log --oneline -10
cat .build/state.json
tail -80 BUILD-LOG.md
cat BLOCKED.md BACKLOG.md
cat packages/verify/config/session-scope.json
npm run green ; echo "green exit=$?"
```

Now read `docs/rebuild-brief/CONTROL.md` in full — all seven overrides, the invariants, the stop conditions. It is your control program and it supersedes the detail sections.

**Three things to reconcile before you write any new code:**

1. `.build/state.json` is **gitignored** and carries two decisions that exist nowhere else: `decisionsPendingWriteUp` D-076 (the decompiler is lossless by default; a prop is dropped only when the compiler provably regenerates it byte-identically) and D-077 (the twelfth normalisation, N12 action-item `editMode`). Both are load-bearing for Q2. **Write them into `DECISIONS.md` now**, with `g-oracle-independence` as D-076's enforcer, before continuing. A context reset would otherwise lose them.
2. `lastGreenCommit` is `c6af856` but HEAD is `3d20dab`. If `npm run green` is red at HEAD, you are mid-write: follow CONTROL §6's mid-package resume protocol — `green:fast` outranks any recorded claim of completion. If green, update `lastGreenCommit` to HEAD.
3. Confirm what `stepGroupsRemaining` says is left of WP-1.a: `s2b-part2` (compile stages s2–s6 + index), `s3-decompiler`, `s4-oracle`, `s5-proof`. Verify each claim against the tree rather than the list.

Report a one-screen state readout — WP complete / in progress / remaining, green status, open blocks — then proceed.

## Phase 1 — Finish Scope A unchanged

Complete the nine work packages already in `session-scope.json`: WP-1.a, WP-1.b, WP-2, WP-4, WP-5, WP-7a, WP-3a, WP-10. Every rule already in force stays in force: one commit per work package, every new gate carrying ≥2 verdict-flipping mutations, `BUILD-LOG.md` block in the same commit, three repair rounds per gate then block-or-fix-the-gate-with-its-mutation, and the seven stop conditions.

**WP-1.b remains a hard go/no-go.** If Q1 or Q2 cannot be achieved after three repair rounds, that is **S1**: write `FINDINGS.md`, commit `[chore]- WP-1 record NO-GO`, and stop. Do not proceed to Phase 2 on a failed premise. A recorded NO-GO is a valid, valuable end state for this session.

Scope A ends when `npm run prove` exits 0 with final line `SESSION COMPLETE — SCOPE A`. **Commit that state before touching Phase 2.** It is the fallback you return to if anything later goes wrong.

## Phase 2 — Extend scope properly, then execute it

Do **not** sneak backlog work in. Use the mechanism the brief defines: add a `DECISIONS.md` row beginning `Scope change: extend to Scope B — <ids>`, edit `session-scope.json` to add the new ids, update CONTROL §3's table in the same commit, and raise the budget envelope in one place (see Phase 4). Then execute, in this order — each is a work package with the acceptance command copied verbatim from its owning section:

| Order | Item | Why now | Gate |
|---|---|---|---|
| 1 | **BL-011** — brief split: extract every >8-row table to `docs/rebuild-brief/data/*.json`, every literal file to `artifacts/`, no fenced block >40 lines | B11 says the 61,440 B bundle cap is currently unenforceable at 594,452 B; the fix removes a standing lie | `g-brief-budget` with `bundle.enforced: true` → exit 0 |
| 2 | **BL-004** — registry `propsCompleteness: full` from framework TypeScript at a pinned ref | P8 returned `net 200`, so B3 never fired: `git clone --filter=blob:none --depth 1 --branch releases/0.45 shesha-io/shesha-framework .build/framework` is available. This is the only chance to get real value types | `packages/registry/src/validate.mjs` → `full >= 93 of 121`, provenance carries a commit SHA, no `[A-Za-z]:/` path |
| 3 | **BL-003** — WP-3b: T3's 22 semantic checks, placement predicates over the compiled tree, `verify-artifact.mjs` and `check-references.mjs` fixed and un-quarantined | The largest correctness gain left. T3 is where wrong bindings, dead actions and unresolvable reflists get caught | `verify.mjs --tiers t1,t2,t3` → exit 0; `quarantine.json` empty; the 15 moved tests are now ≥17 and never fewer |
| 4 | **BL-002** — round-trip ≥0.90 over all 12 corpus forms, not the 6 declared | Falsifies or confirms the IR's expressiveness against the real estate | `sfs -- roundtrip --scope all` → `rate >= 0.90 · untriaged 0` |
| 5 | **BL-007 + BL-012** — rewrite the three design skills thin (`shesha-designer`, `shesha-design-comprehension`, `shesha-design-system`); clear the remaining prose waivers | Needs T3's error vocabulary, which now exists. Clears 11 of B12's 34 waivers | `g-prose-budget` with ≤0 waivers outside WP-2's two provenance files → exit 0 |
| 6 | **BL-009** — precedent index: shape-keyed over the decompiled corpus, JSONL + `Float32Array` sidecar, brute-force scanned | Only meaningful now that the corpus is normalised. Never used for correctness lookups — those are exact registry queries | `precedent.search` returns the 3 nearest SFS for a held-out form, asserted by a fixture, not by judgement |
| 7 | **New — property-based compiler fuzzer** | Ten fixtures test the paths you thought of. Generate valid SFS from the schema and assert T1/T2 + determinism + idempotence. ~100 lines, highest yield per line in the whole plan | `node --test packages/sfs/test/fuzz.test.mjs` → 0 failures over ≥500 generated specs |
| 8 | **New — keep WP-1's second compiler as a permanent differential oracle**, and add CI | The naive implementation makes normalisation drift structurally impossible, forever. A GitHub Action running `npm run green` is what makes every gate matter beyond this session | `.github/workflows/green.yml` present; `g-oracle-independence` still exit 0 |

## Phase 3 — Scope C: build it, then hand it off honestly

These cannot be *verified* in the session that writes them. Build and commit them; **never mark them complete on the strength of the code existing.**

- **BL-008** — `.claude/hooks/**`, `.mcp.json`, the three agent roles (`sfs-planner`, `sfs-specwriter`, `sfs-evaluator`) exactly as Section 4 specifies. Claude Code loads hooks and MCP at session start, so prove each hook the only way available in-session: pipe literal stdin payloads to `node .claude/hooks/<h>.mjs` and assert exit code plus parsed decision. Live behaviour is restart-gated.
- **BL-005** — T4 live smoke and T4b DOM residue: write them, and let every check dispose `uninspectable` with a `BLOCKED.md` row when no backend or browser is reachable. `npx playwright install chromium` is an operator step (no `--with-deps`, that flag is Linux-only).
- **BL-001** — the three-arm SAA comparison. Needs a live backend and the pre-rebuild pipeline runnable side by side. Write the harness wiring and the run script; leave the measurement to the operator. `prove` continues to print `token cost: unmeasured in this session`.
- **BL-010** — write `HANDOFF.md`: the exact commands the operator runs in a **fresh** session to verify what this one could not — plant a `.form.json` Write and observe the denial, call `mcp__shesha-sfs__registry_lookup`, dispatch `sfs-specwriter`, run T4 against a live app. One numbered command per line with its expected output.

## Phase 4 — Budget, discipline, and what "done" means

**Raise the envelope once, explicitly, in the `Scope change:` row:** Scope A keeps 1,200 steps / 3.0 M tokens; Scope B adds 1,500 / 3.5 M; Scope C adds 400 / 1.0 M. Keep the burn-ratio checkpoints at 25/50/75/90% of the *current phase's* allocation, and keep S4 — at 90% you finish the current work package, commit, run `prove --partial`, and report. **Never** carry an in-flight work package into a context reset.

Everything else stands: no scope expansion outside the `Scope change:` mechanism; degrade to `uninspectable`, never to `pass`; a gate that cannot fail on its own mutation is deleted, not committed (S6); weakening a gate, skipping a test or editing an expected-output file without a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row is S7 — revert and record. A self-report is not evidence, yours or a subagent's. Fan out only across the disjoint-write slices CONTROL §7 names, max 4 agents, and you run the accepting program and you commit.

**The entire task is complete when all three hold:**

1. `npm run prove` exits 0 with a final line naming the full scope, and `prove.expected.txt` was blessed at most the permitted number of times.
2. `HANDOFF.md` exists and every item in it is a command with an expected output — nothing in it is a judgement.
3. `git status --porcelain` is empty, CI is green on the pushed branch, and CONTROL §11's anti-drift checklist passes items 1–15 before item 16 is run.

If you reach any stop condition, stop there and report it. Finishing honestly short is the correct outcome; a `SESSION COMPLETE` line from a scope that was quietly narrowed is the one thing this rebuild exists to make impossible.

Begin with Phase 0.
