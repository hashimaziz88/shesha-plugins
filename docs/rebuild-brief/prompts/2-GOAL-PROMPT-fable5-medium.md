# Prompt 2 of 3 — /goal: complete the entire rebuild
### Tuned for Claude Fable 5 at medium effort

> Paste below the line (or after `/goal`) in Claude Code at `C:\Users\Hashim\Documents\GitHub\shesha-plugins`.
> Run prompt 1 (audit) first. Contains `ultracode`.

---

ultracode

**GOAL: take this rebuild to completion. Finish Scope A to `SESSION COMPLETE`, then formally extend scope and execute every backlog item achievable without a restart or a live backend, then leave a precise operator handoff for what genuinely cannot be verified in-session.**

You are resuming work in progress on branch `hashim/sfs-rebuild-scope-a`. Do not restart it, and do not trust any narrative summary of it — including this one.

## How to run this session (model-specific — read once, apply throughout)

**Effort.** You are at **medium** by default, which is right for the mechanical majority of this work. Raise it deliberately for the five places where the reasoning is load-bearing, and say in `BUILD-LOG.md` that you did:

| Raise to | For |
|---|---|
| **high** | WP-1.b's Q2 oracle contract — the N1…N12 normalisation set and the losslessness rule (D-076/D-077). Getting this wrong is the one thing that silently invalidates the whole proof |
| **high** | WP-5's decompiler, and BL-003's T3 semantic checks |
| **high** | Any gate that reaches repair round 2 — the second round is where a wrong hypothesis becomes an entrenched one |
| medium | everything else: fixtures, the brief split, deletions, registry records, the fuzzer, CI, `HANDOFF.md` |
| low | nothing. There is no step here cheap enough to justify it |

**Context.** You have a 1M window. **Do not use it to read the brief bundle whole** — it is 604,699 B, and the failure this rebuild exists to fix was 322,816 B of prose defeating instruction adherence. Capacity is not the constraint; the number of rules you hold at once is. Read `docs/rebuild-brief/CONTROL.md` in full, then **one detail section per phase** (not per work package — that concession is yours to take at 1M), and inside it only the subsections your current work package names. Use context editing / tool-result clearing to drop stale command output rather than carrying it.

**Refusals.** Your safety classifiers can decline a request and return a refusal. If that happens mid-work-package: do not retry the same phrasing in a loop. Record a `BLOCKED.md` row (`B14` onward) naming the work package, the step, and the refused action; move to the next **independent** work package; and report it in the final readout. A refusal is a blocked path like any other — it degrades to `uninspectable`, never to `pass`.

**Knowledge cutoff.** Yours is January 2026. Claude Code's hook, agent and skill schemas have changed since, and Phase 3 depends on them. For anything touching `.claude/settings.json`, `.claude/agents/*.md`, `SKILL.md` frontmatter or `.mcp.json`: `docs/rebuild-brief/40-harness.md` is authoritative, and where it is silent, check the live docs — never your recall. A hook written to a remembered schema fails silently, which is the exact defect class this repo already shipped once.

**Cost.** You are ~2× Opus 5 per token and slower per step. That does not change the token envelope below, but it does mean a wasted repair round is expensive: prefer one well-reasoned attempt at high effort over three at medium.

## Orient

```bash
fnm use 22 || fnm use v22.23.2 ; node --version     # B13: bare node is not on PATH here
git log --oneline -8 && git status --porcelain
cat .build/state.json ; tail -60 BUILD-LOG.md ; cat BLOCKED.md AUDIT.md
cat packages/verify/config/session-scope.json
npm run green ; echo "green exit=$?"
```

Read `CONTROL.md` in full — seven overrides, three invariants, seven stop conditions. It outranks the five detail sections.

Verify `stepGroupsRemaining` against the tree rather than believing it: for each entry, run the command that would prove it done, and correct the list before acting on it. Then report a one-screen state readout and proceed.

## Phase 1 — Finish Scope A

Complete the nine ids in `session-scope.json`: WP-1.a, WP-1.b, WP-2, WP-4, WP-5, WP-7a, WP-3a, WP-10. Every rule stays in force — one commit per work package, every new gate with ≥2 verdict-flipping mutations, a `BUILD-LOG.md` block in the same commit, three repair rounds then block-or-fix-the-gate-with-its-mutation, and the seven stop conditions.

**WP-1.b is a hard go/no-go, and it is the one place to spend high effort before writing code, not after.** Q1 is `compile(decompile(compile(x))).Markup === compile(x).Markup`, byte-equal. Q2 is `normalForm(compile(decompile(m))) deepEqual normalForm(normaliseLegacy(m))` against the real revision-2 envelope, plus the second legacy fixture so the proof does not rest on one artifact.

Before implementing: state the full N1…N12 normalisation set explicitly, and satisfy yourself that `normaliseLegacy` changes the golden by **exactly** that set and nothing else. Any compiler behaviour that alters the golden outside those rules breaks Q2, and the two consequences are already recorded — D-076 (the decompiler is lossless: lift every non-default prop or carry it in a typed raw block) and D-077 (N12, the action-item `editMode`). If either Q fails after three repair rounds: **S1** — write `FINDINGS.md` naming the first divergent byte index, the construct, which program is wrong, and whether the gap is normalisation or IR expressiveness. Commit `[chore]- WP-1 record NO-GO` and **stop**. Do not enter Phase 2 on a failed premise.

Phase 1 ends when `npm run prove` exits 0 with final line `SESSION COMPLETE — SCOPE A`. **Commit that state before touching Phase 2** — it is the fallback you return to.

## Phase 2 — Extend scope through the mechanism, then execute

Do not smuggle backlog work in. Add a `DECISIONS.md` row beginning `Scope change: extend to Scope B — <ids>`, add the ids to `session-scope.json`, update CONTROL §3's table, and raise the budget in the same commit. Then execute in this order, each as a work package with its acceptance command copied verbatim from its owning section:

| # | Item | Effort | Gate |
|---|---|---|---|
| 1 | **BL-011** brief split — every >8-row table to `data/*.json`, every literal file to `artifacts/`, no fenced block >40 lines | medium | `g-brief-budget` with `bundle.enforced: true` → exit 0 (bundle is 604,699 B against a 61,440 cap today) |
| 2 | **BL-004** registry `propsCompleteness: full` from framework TypeScript at a pinned ref — `git clone --filter=blob:none --depth 1 --branch releases/0.45 shesha-io/shesha-framework .build/framework`. P8 returned `net 200`, so B3 never fired | medium | `registry/src/validate.mjs` → `full >= 93 of 121`, provenance carries a commit SHA, no `[A-Za-z]:/` path anywhere |
| 3 | **BL-003** WP-3b — T3's 22 semantic checks, placement predicates over the compiled tree, `verify-artifact.mjs` and `check-references.mjs` fixed and un-quarantined | **high** | `verify.mjs --tiers t1,t2,t3` → exit 0; `quarantine.json` empty; the moved test count goes 15 → ≥17 and never down |
| 4 | **BL-002** round-trip ≥0.90 over all 12 corpus forms | medium, **high** on triage | `sfs -- roundtrip --scope all` → `rate >= 0.90 · untriaged 0` |
| 5 | **BL-007 + BL-012** rewrite the three design skills thin; clear the remaining prose waivers | medium | `g-prose-budget` → exit 0 with no waiver outside WP-2's two provenance files |
| 6 | **BL-009** precedent index — shape-keyed over the decompiled corpus, JSONL + `Float32Array` sidecar, brute-force scanned. Never used for correctness lookups; those are exact registry queries | medium | a fixture asserts the 3 nearest SFS for a held-out form — not a judgement |
| 7 | **New: property-based compiler fuzzer** — generate valid SFS from the schema, assert T1/T2 + determinism + idempotence | medium | `node --test packages/sfs/test/fuzz.test.mjs` → 0 failures over ≥500 generated specs |
| 8 | **New: permanent differential oracle + CI** — keep WP-1's second compiler as a standing test oracle; add `.github/workflows/green.yml` running `npm run green` | medium | workflow present and green on the pushed branch; `g-oracle-independence` still exit 0 |

## Phase 3 — Build Scope C, then hand it off honestly

These cannot be *verified* by the session that writes them. Build and commit them; **never mark them complete because the code exists.** Treat `40-harness.md` plus the live Claude Code docs as authoritative over recall throughout this phase — see the knowledge-cutoff rule above.

- **BL-008** — `.claude/hooks/**`, `.mcp.json`, and the three agent roles exactly as Section 4 specifies. Claude Code loads hooks and MCP at session start, so prove each hook the only way available: pipe literal stdin payloads to `node .claude/hooks/<h>.mjs` and assert exit code plus parsed decision. Live behaviour is restart-gated.
- **BL-005** — T4 live smoke and T4b DOM residue. Write them; every check disposes `uninspectable` with a `BLOCKED.md` row when no backend or browser is reachable. `npx playwright install chromium` is an operator step (no `--with-deps`; Linux-only flag).
- **BL-001** — the three-arm SAA comparison. Write the harness wiring and run script; the measurement is the operator's. `prove` keeps printing `token cost: unmeasured in this session`.
- **BL-010** — write `HANDOFF.md`: the exact commands an operator runs in a **fresh** session to verify what this one could not. Plant a `.form.json` Write and observe the denial; call `mcp__shesha-sfs__registry_lookup`; dispatch `sfs-specwriter`; run T4 against a live app. One numbered command per line with its expected output. Nothing in it is a judgement.

## Budget and discipline

Raise the envelope once, in the `Scope change:` row: Scope A keeps 1,200 steps / 3.0 M tokens; Scope B adds 1,500 / 3.5 M; Scope C adds 400 / 1.0 M. Keep burn-ratio checkpoints at 25/50/75/90% of the current phase's allocation. **S4 stands** — at 90% you finish the current work package, commit, run `prove --partial`, report. Never carry an in-flight work package into a context reset.

Everything else holds: no scope change outside the `Scope change:` mechanism; degrade to `uninspectable`, never to `pass`; a gate that cannot fail on its own mutation is deleted rather than committed (S6); weakening a gate, skipping a test, or editing an expected-output file without a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row is S7 — revert and record it. A self-report is not evidence, yours or a subagent's.

**Fan-out, adjusted.** CONTROL §7's four slices and its max of 4 remain the ceiling, but you are slower and dearer per token than the model the plan was sized for: use fan-out only for slice 1 (the 121 registry records) and slice 4 (the T1/T2 fixtures), where the accepting program is strongest and the work is genuinely mechanical. Do the error-catalogue entries and the round-trip triage yourself at high effort — they are judgement-shaped, and a subagent's self-report is not evidence. You run the accepting program and you commit; no subagent touches git or `node_modules`.

## Done means all three

1. `npm run prove` exits 0 with a final line naming the full scope, and `prove.expected.txt` was blessed no more than the permitted number of times.
2. `HANDOFF.md` exists and every line in it is a command with an expected output.
3. `git status --porcelain` empty, CI green on the pushed branch, and CONTROL §11's anti-drift checklist passes items 1–15 before item 16 runs.

Report at the end: work packages completed, stop conditions hit, blocked rows opened (including any refusal), effort raised and where, and the burn ratio per phase.

Reaching a stop condition and reporting it is a correct outcome. A `SESSION COMPLETE` line from a scope that was quietly narrowed is the one thing this rebuild exists to make impossible.

Begin by orienting.
