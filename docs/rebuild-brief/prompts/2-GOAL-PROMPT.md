# Prompt 2 of 3 — /goal: complete the entire rebuild

> Paste below the line (or after `/goal`) in Claude Code at `C:\Users\Hashim\Documents\GitHub\shesha-plugins`.
> Run prompt 1 (audit) first. Contains `ultracode`.

---

ultracode

**GOAL: take this rebuild to completion. Finish Scope A to `SESSION COMPLETE`, then formally extend scope and execute every backlog item achievable without a restart or a live backend, then leave a precise operator handoff for what genuinely cannot be verified in-session.**

You are resuming work in progress on branch `hashim/sfs-rebuild-scope-a`. Do not restart it, and do not trust any narrative summary of it — including this one.

## Orient

```bash
fnm use 22 || fnm use v22.23.2 ; node --version     # B13: bare node is not on PATH here
git log --oneline -8 && git status --porcelain
cat .build/state.json ; tail -60 BUILD-LOG.md ; cat BLOCKED.md AUDIT.md
cat packages/verify/config/session-scope.json
npm run green ; echo "green exit=$?"
```

Read `docs/rebuild-brief/CONTROL.md` in full — seven overrides, three invariants, seven stop conditions. It outranks the five detail sections. Read exactly one detail section per work package, named in CONTROL §3, and never the bundle whole.

Verify `stepGroupsRemaining` against the tree rather than believing it. Then report a one-screen state readout and proceed.

## Phase 1 — Finish Scope A

Complete the nine ids in `session-scope.json`: WP-1.a, WP-1.b, WP-2, WP-4, WP-5, WP-7a, WP-3a, WP-10. Every rule stays in force — one commit per work package, every new gate with ≥2 verdict-flipping mutations, a `BUILD-LOG.md` block in the same commit, three repair rounds then block-or-fix-the-gate-with-its-mutation, and the seven stop conditions.

**WP-1.b is a hard go/no-go.** Q1 is `compile(decompile(compile(x))).Markup === compile(x).Markup`, byte-equal. Q2 is `normalForm(compile(decompile(m))) deepEqual normalForm(normaliseLegacy(m))` against the real revision-2 envelope, plus the second legacy fixture so the proof does not rest on one artifact. If either fails after three repair rounds: **S1** — write `FINDINGS.md` naming the first divergent byte index, the construct, which program is wrong, and whether the gap is normalisation or IR expressiveness. Commit `[chore]- WP-1 record NO-GO` and **stop**. Do not enter Phase 2 on a failed premise.

Phase 1 ends when `npm run prove` exits 0 with final line `SESSION COMPLETE — SCOPE A`. **Commit that state before touching Phase 2** — it is the fallback you return to.

## Phase 2 — Extend scope through the mechanism, then execute

Do not smuggle backlog work in. Add a `DECISIONS.md` row beginning `Scope change: extend to Scope B — <ids>`, add the ids to `session-scope.json`, update CONTROL §3's table, and raise the budget in the same commit. Then execute in this order, each as a work package with its acceptance command copied verbatim from its owning section:

| # | Item | Gate |
|---|---|---|
| 1 | **BL-011** brief split — every >8-row table to `data/*.json`, every literal file to `artifacts/`, no fenced block >40 lines | `g-brief-budget` with `bundle.enforced: true` → exit 0 (the bundle is 604,699 B against a 61,440 cap today) |
| 2 | **BL-004** registry `propsCompleteness: full` from framework TypeScript at a pinned ref — `git clone --filter=blob:none --depth 1 --branch releases/0.45 shesha-io/shesha-framework .build/framework`. P8 returned `net 200`, so B3 never fired and this is available | `registry/src/validate.mjs` → `full >= 93 of 121`, provenance carries a commit SHA, no `[A-Za-z]:/` path anywhere |
| 3 | **BL-003** WP-3b — T3's 22 semantic checks, placement predicates over the compiled tree, `verify-artifact.mjs` and `check-references.mjs` fixed and un-quarantined | `verify.mjs --tiers t1,t2,t3` → exit 0; `quarantine.json` empty; the moved test count goes 15 → ≥17 and never down |
| 4 | **BL-002** round-trip ≥0.90 over all 12 corpus forms | `sfs -- roundtrip --scope all` → `rate >= 0.90 · untriaged 0` |
| 5 | **BL-007 + BL-012** rewrite the three design skills thin; clear the remaining prose waivers | `g-prose-budget` → exit 0 with no waiver outside WP-2's two provenance files |
| 6 | **BL-009** precedent index — shape-keyed over the decompiled corpus, JSONL + `Float32Array` sidecar, brute-force scanned. Never used for correctness lookups; those are exact registry queries | a fixture asserts the 3 nearest SFS for a held-out form — not a judgement |
| 7 | **New: property-based compiler fuzzer** — generate valid SFS from the schema, assert T1/T2 + determinism + idempotence | `node --test packages/sfs/test/fuzz.test.mjs` → 0 failures over ≥500 generated specs |
| 8 | **New: permanent differential oracle + CI** — keep WP-1's second compiler as a standing test oracle; add `.github/workflows/green.yml` running `npm run green` | workflow present and green on the pushed branch; `g-oracle-independence` still exit 0 |

## Phase 3 — Build Scope C, then hand it off honestly

These cannot be *verified* by the session that writes them. Build and commit them; **never mark them complete because the code exists.**

- **BL-008** — `.claude/hooks/**`, `.mcp.json`, and the three agent roles exactly as Section 4 specifies. Claude Code loads hooks and MCP at session start, so prove each hook the only way available: pipe literal stdin payloads to `node .claude/hooks/<h>.mjs` and assert exit code plus parsed decision. Live behaviour is restart-gated.
- **BL-005** — T4 live smoke and T4b DOM residue. Write them; every check disposes `uninspectable` with a `BLOCKED.md` row when no backend or browser is reachable. `npx playwright install chromium` is an operator step (no `--with-deps`; Linux-only flag).
- **BL-001** — the three-arm SAA comparison. Write the harness wiring and run script; the measurement is the operator's. `prove` keeps printing `token cost: unmeasured in this session`.
- **BL-010** — write `HANDOFF.md`: the exact commands an operator runs in a **fresh** session to verify what this one could not. Plant a `.form.json` Write and observe the denial; call `mcp__shesha-sfs__registry_lookup`; dispatch `sfs-specwriter`; run T4 against a live app. One numbered command per line with its expected output. Nothing in it is a judgement.

## Budget and discipline

Raise the envelope once, in the `Scope change:` row: Scope A keeps 1,200 steps / 3.0 M tokens; Scope B adds 1,500 / 3.5 M; Scope C adds 400 / 1.0 M. Keep burn-ratio checkpoints at 25/50/75/90% of the current phase's allocation. **S4 stands** — at 90% you finish the current work package, commit, run `prove --partial`, report. Never carry an in-flight work package into a context reset.

Everything else holds: no scope change outside the `Scope change:` mechanism; degrade to `uninspectable`, never to `pass`; a gate that cannot fail on its own mutation is deleted rather than committed (S6); weakening a gate, skipping a test, or editing an expected-output file without a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row is S7 — revert and record it. A self-report is not evidence, yours or a subagent's. Fan out only across the disjoint-write slices CONTROL §7 names, max 4 agents; you run the accepting program and you commit.

## Done means all three

1. `npm run prove` exits 0 with a final line naming the full scope, and `prove.expected.txt` was blessed no more than the permitted number of times.
2. `HANDOFF.md` exists and every line in it is a command with an expected output.
3. `git status --porcelain` empty, CI green on the pushed branch, and CONTROL §11's anti-drift checklist passes items 1–15 before item 16 runs.

Reaching a stop condition and reporting it is a correct outcome. A `SESSION COMPLETE` line from a scope that was quietly narrowed is the one thing this rebuild exists to make impossible.

Begin by orienting.
