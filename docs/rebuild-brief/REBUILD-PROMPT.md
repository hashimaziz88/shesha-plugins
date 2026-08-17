# Paste this into Claude Code desktop (Opus 5) — one session, Scope A

> Open Claude Code in `C:\Users\Hashim\Documents\GitHub\shesha-plugins` first. Paste everything below the line as your first message. It contains the word `ultracode`, which opts the session into multi-agent orchestration.

---

ultracode

You are executing a planned re-architecture of this repository in a single session. The plan is already decided, adversarially reviewed, and committed to this repo. Your job is to execute it, prove it with programs, and stop honestly if it cannot be proven.

**Read `docs/rebuild-brief/CONTROL.md` in full, now, before anything else.** It is 20 KB and it is your control program: the three invariants, five overrides that supersede the detail sections, eight preconditions, the eight work packages with one acceptance command each, the definition of done, the checkpoint protocol, the fan-out rules, the budget, and seven stop conditions. Everything else in `docs/rebuild-brief/` is detail — read exactly one detail section per work package, named in CONTROL §3, and never read the bundle whole. `strategy.md` in that folder is the evidence base; consult it only when a section cites it and you need the citation.

## What you are building, in one paragraph

Today a language model emits ~19,000 bytes of Shesha form markup carrying ~768 bytes of actual design decisions — a 25× expansion, 44% of it responsive triplication — guided by 47 KB of `SKILL.md` plus 276 KB of references containing 13 verified mutual contradictions, policed by gates of which four of six are demonstrably theatre. You are replacing the expansion with a deterministic compiler over a typed IR called **SFS**, replacing the prose rules with a machine registry and executable gates, and replacing the model-judged verification with a tiered ladder whose bottom tiers are plain programs. Scope A of that work is eight work packages, ending in one command that either prints `SESSION COMPLETE — SCOPE A` or does not.

## The four rules that govern every decision you make

1. **The compiler is the only writer of form markup.** Never hand-author or hand-edit a form JSON. Enforced by recomputing markup from its sibling SFS and comparing bytes.
2. **No prose rule without a program that enforces it.** If you are about to write "remember to" or "be careful to", write the gate instead or delete the rule.
3. **Zero coverage is never a pass.** Every gate reports walked/checked/notApplicable/uninspectable/failures, those must reconcile, families are declared up front, and walking something while checking nothing is a failure. Degrade to `uninspectable`, never to `pass`.
4. **A self-report is not evidence** — not yours, not a subagent's. Every completion claim is a command's exit code and printed output, written to `packages/verify/evidence/<WP>.json` by a program, never a number you type into a commit message.

If you ever find yourself weakening a gate, skipping a test, or editing an expected-output file to make something pass: that is stop condition **S7**. Revert it, record it in `BLOCKED.md` with the reverted diff, and re-approach. That single behaviour is the failure mode this entire rebuild exists to make impossible.

## Start here, in this order

1. Read `docs/rebuild-brief/CONTROL.md` whole.
2. Run CONTROL §2's eight preconditions P1–P8. Apply override O4 **before** P3 — if `git status` shows a large number of modified files, check `git diff --stat | tail -3` and `git config core.autocrlf` first; a zero-insertion diff across many files is a line-ending artifact, so run `git update-index --refresh` rather than committing a mass rewrite. A failing hard precondition is **S0**: report it with its fixing command and write nothing.
3. `git checkout -b hashim/sfs-rebuild-scope-a` from the current commit. Never push to `upstream`.
4. Create your task list from CONTROL §3's eight work packages, in the Order column's sequence. Do not reorder them; the rationale is stated in §3 so it is not re-litigated.
5. Read `10-standards.md` and execute **WP-0**. Its acceptance command is `npm run green:fast && node packages/verify/src/gates/g-decisions.mjs` → exit 0.

Then proceed one work package at a time. Each ends in: acceptance command green, `green:fast` green, every new gate carrying a mutation that provably flips it, a `BUILD-LOG.md` block, `DECISIONS.md` rows for every choice, and exactly one commit in this repo's existing `[type]- Description` style.

## WP-1 is a go/no-go, and you must honour it

The second work package tests the one claim in the plan with no published head-to-head evidence: that a model can emit ~1 KB of intent and a program can expand it into correct markup. It proves this by having two independently written programs agree, byte-for-byte, on the markup of a real production form — with `docs/rebuild-brief/artifacts/bookings-table.revision2.json` as the oracle (override O1) and `inline-editable-table.json` as the on-disk target.

If Q1 or Q2 cannot be achieved after three repair rounds, that is **S1**: write `FINDINGS.md` with the first divergent byte index, the construct that diverged, which program is wrong, and whether the gap is normalisation or IR expressiveness. Commit `[chore]- WP-1 record NO-GO`. **Do not start WP-2.** A recorded NO-GO in one session is the correct and valuable outcome; a plausible-looking compiler built on a false premise is not.

## Orchestration

Fan out **across independent artifacts, never within one**. This repo has already shipped two mutually incompatible component shapes from two parallel authors writing one form. Only the four slices named in CONTROL §7 are legal, each with a declared disjoint write set and a named program that accepts or rejects it without a model in the loop. Maximum four concurrent subagents. Subagents write files and return only the list of paths they wrote; **you** run the accepting program and **you** commit. No subagent touches git or `node_modules`. WP-0, WP-1, the schema, the compiler stages, the decompiler, `walk.mjs`, `coverage.mjs`, WP-7a and WP-10 are strictly sequential, single-agent work.

## Budget and stopping

Envelope is 1,200 steps / 3.0 M tokens. Checkpoint at 25/50/75/90% with CONTROL §8's one-liner plus `green:fast`. Burn ratio over 1.40, or 90% of either budget, is **S4**: finish the current work package, commit, run `npm run prove -- --partial`, and report what is done and what remains. Your last act is always a commit plus a proof run — never an in-flight work package.

Scope does not expand. Anything not in `session-scope.json` goes to `BACKLOG.md` and nowhere else, including better ideas you find while reading code and generalisations that "would only take a minute".

## Definition of done

`npm run prove` exits 0 and its final line is `SESSION COMPLETE — SCOPE A`.

Nothing else counts. A green `npm test`, a fully-ticked task list, and a confident closing summary are explicitly insufficient — that exact combination is the state this repository was already in while shipping a script that could not execute, a gate that passed a deliberately-broken input, and a golden reference form containing eight defects nothing caught.

Before that final command, run CONTROL §11's sixteen verifications in order. If any of items 1–15 does not produce its expected output, item 16 is not run.

Begin with step 1.
