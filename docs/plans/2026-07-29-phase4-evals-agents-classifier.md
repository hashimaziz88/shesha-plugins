# Phase 4: Evals, Agents, and the Harness Classifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make the work measurable and make the pipeline actually execute. Phases 1–3 built ground truth, an oracle, and a compiler; none of it is *measured*, and the pipeline's required steps are still advisory prose that telemetry showed being skipped 10 times out of 10.

**Architecture:** An `evals/` harness per skill whose assertions are the validator's own exit codes, reporting pass rate **and standard deviation** across repeated runs — stddev is the operational definition of "inconsistent", which is the defect this whole project exists to fix. A `shesha-form-designer` subagent that *injects* skill content rather than hoping it is discovered. Description surgery to stop four skills claiming the same trigger. And a fix to the external test harness so it can grade design cases at all.

**Tech Stack:** Node 25, `node --test`, zero dependencies. The external harness is Python.

## Global Constraints

- Forward slashes only in paths written into files. Zero new dependencies in the plugin.
- Framework pinned to 0.45.1; never regenerate `assets/registry/registry-0.45.1.json`.
- Never emit a `columns` component; never set a proportional width on an input leaf.
- Test baseline that must not regress: hooks **33** · shesha-form-edit **293** · shesha-design-system **24** · shesha-design-comprehension **84**.
- Do not modify the framework repo at `C:/Users/Hashim/Documents/Git Repos/shesha-framework`.
- Do not commit corpus data or any `*.pushed.json`. Leave the untracked `shesha-design-system/assets/themes/skyline.tokens.json` alone.
- Plugin version bump per `CLAUDE.md`; currently `1.8.26`.
- **The external harness lives in a different repository** (`C:/Users/Hashim/Documents/Azure DevOps Repos/saa-testmanager`). Commit there locally; **do not push it.** Only `shesha-plugins` is pushed, to `origin` (the user's fork), branch `plugins-rework`.

## Evidence this phase acts on

| Finding | Source |
|---|---|
| **Zero `evals/` directories** across all four skills — every change to date has been unfalsifiable | repo audit |
| `shesha-design-comprehension` invoked **0 times in 10 designer sessions**, and 0 across the whole telemetry window, despite being a REQUIRED SUB-SKILL | ClaudeLog, 8k events |
| **13 of 15** harness design test cases auto-classify as `unknown`, so the eval that should catch design defects cannot grade them | ClaudeLog prompts |
| Three of four skill descriptions claim the same trigger phrasing ("match a design"), so which fires is nondeterministic | skill audit |
| A single design run loaded **110k–145k tokens** of instruction before any data | load-cost analysis |

---

### Task 1: The evals harness

**Files:** Create `plugins/shesha-developer/evals/evals.json`, `evals/run-evals.mjs`, `evals/README.md`, `evals/cases/*.json`; `evals/tests/run-evals.test.mjs`

**Interfaces produced:**
- `runEvals({cases, runs}) => {results, summary}` where `summary` carries per-case `passRate` and `stddev`, and an overall roll-up.
- CLI: `node evals/run-evals.mjs [--case <id>] [--runs 3] [--json]`. Exit 0 if every case meets its threshold, 1 otherwise.

**The design that makes this honest:** an eval case's assertion is **the validator's own verdict**, not a model's opinion. A case supplies a blueprint; the harness compiles it, validates it, and asserts zero Tier 1/Tier 2 findings plus a Tier 3 score at or above the case's threshold. That makes the grade objective and reproducible, which is the whole reason to have it.

Cases to ship, at minimum: one per archetype (8), reusing the committed blueprint fixtures; the `flight-details` forensic case; and one deliberately-broken blueprint that MUST fail, so a harness that passes everything is detectably wrong.

**Report stddev, not just mean.** A case that passes 3 of 3 and one that passes 3 of 3 with wildly different scores are different situations. The metric of record for this project is variance.

- [ ] **Step 1** Write the failing test: the runner reports per-case `passRate` and `stddev`; a deliberately-broken case fails; exit codes are correct; `--runs N` actually runs N times and aggregates.
- [ ] **Step 2** Run — fails.
- [ ] **Step 3** Implement. Compilation is deterministic, so stddev over identical inputs will be 0 — that is correct and expected, and it means this harness measures *tooling* variance today. Note in the README that measuring *model* variance requires driving a real agent per run, which this harness deliberately does not do; it is the objective floor, not the whole story.
- [ ] **Step 4** Run — green.
- [ ] **Step 5** Commit.

---

### Task 2: The `shesha-form-designer` agent and description surgery

**Files:** Create `plugins/shesha-developer/agents/shesha-form-designer.md`; modify the `description` frontmatter of `shesha-claude-designer`, `shesha-design-comprehension`, `shesha-design-system`, `shesha-form-edit`

**Why the agent:** telemetry showed the required comprehension step skipped in 10 of 10 designer sessions. A skill cannot force a sibling skill to run — `Skill(...)` in a step list is a probabilistic instruction. A subagent's `skills:` frontmatter **injects** the full skill content instead, and `model`/`effort` pin the run so results are comparable.

The agent definition must carry: `skills: [shesha-developer:shesha-design-comprehension, shesha-developer:shesha-form-edit]`, a pinned `model` and `effort`, a tools list narrow enough to keep it honest, and a prompt whose workflow is blueprint → compile → validate → push, with the placement gate as an exit code.

**Description surgery:** `shesha-claude-designer` keeps "match a design" as its trigger. The other three lose that phrasing and are described as sub-skills invoked by the orchestrator or the agent. Each description stays third-person, under 1,024 characters, and says both what the skill does and when to use it.

- [ ] **Step 1** Write the agent definition; verify its frontmatter fields against the Claude Code sub-agent docs rather than assuming.
- [ ] **Step 2** Rewrite the four descriptions so no two claim the same trigger.
- [ ] **Step 3** Add an eval case, or a test, asserting the four descriptions share no trigger phrase — trigger collision is measurable, so measure it.
- [ ] **Step 4** Commit.

---

### Task 3: Fix the harness form classifier

**Files:** Modify `<saa-testmanager>/harness/saa_harness/form_classifier.py` (+ its tests)

13 of 15 design cases classify as `unknown`, so the harness cannot grade the exact cases that were failing. The classifier infers form intent from `buttonGroup` item actions, which a design-oriented test case may not carry at all.

- [ ] **Step 1** Read `form_classifier.py` and `tests/test_evaluator.py`; run the existing Python tests to establish a baseline.
- [ ] **Step 2** Make the classifier read the declared form type from the **test-case metadata** when present, falling back to markup inference only when it is absent. A test case that says what it is should be believed.
- [ ] **Step 3** Add tests covering the previously-`unknown` design cases.
- [ ] **Step 4** Commit **in that repository only — do not push it.**

---

### Task 4: Release verification and hand-off

**Files:** Create `docs/RELEASE-phase4.md`

- [ ] **Step 1** Run all four plugin suites plus the evals harness; record the numbers.
- [ ] **Step 2** Compile all 8 archetypes and the forensic case; confirm zero Tier 1/2.
- [ ] **Step 3** Confirm: no corpus data in the repo, framework repo clean, plugin version bumped.
- [ ] **Step 4** Write `docs/RELEASE-phase4.md` for a reader who has not followed the work: what to test, the exact commands, what "good" looks like, and **every known limitation** — including the ones that are easy to trip over (`T1-PROP-UNKNOWN` at 89% so the gate is curated not blanket; `tab()` requires every tab to have been activated once before the final probe; the compiler owns authoring but not editing live forms).
- [ ] **Step 5** Merge to `plugins-rework` and push to `origin`.

---

## Phase gate

- [ ] Four suites green at or above baseline; evals harness green with a deliberately-broken case correctly failing.
- [ ] All 8 archetypes plus the forensic case compile to zero Tier 1/2.
- [ ] The four skill descriptions share no trigger phrase, asserted by a test.
- [ ] `agents/shesha-form-designer.md` exists with `skills:` injection and a pinned model.
- [ ] Harness classifies design cases; committed locally in its own repo, not pushed.
- [ ] `docs/RELEASE-phase4.md` written, honest about limitations.
- [ ] Pushed to `origin/plugins-rework`.

## Explicitly out of scope

- Widening the push gate — needs `T1-PROP-UNKNOWN` resolved, which needs registry work beyond this phase.
- Measuring real model variance — needs an agent driven per eval run; the harness here is the objective floor.
- A live-browser smoke test of `tab()` against a real form — the portal was unreachable during the unattended run.
