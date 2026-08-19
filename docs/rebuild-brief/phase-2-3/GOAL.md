# GOAL — finish Scope B (Phase 2 + Phase 3) of the Shesha SFS rebuild

Paste this into Claude Code at `C:\Users\Hashim\Documents\GitHub\shesha-plugins` (branch
`hashim/sfs-rebuild-scope-a`). It is the standing directive for the second delivery. The plan it
executes is `docs/rebuild-brief/phase-2-3/PROPOSAL.md` — read that in full before acting.

---

## Mission

Scope A is complete and frozen (`npm run prove` → `SESSION COMPLETE — SCOPE A`). Deliver **Scope B**:
turn every `BACKLOG.md` row into a closed WP or an honest `BLOCKED.md` line, under the same
invariants, until `node packages/verify/src/prove-b.mjs` exits 0 with final line
`SESSION COMPLETE — SCOPE B`.

**Done = all of:** `prove-b` prints `SESSION COMPLETE — SCOPE B`; `npm run prove` **still** prints
`SESSION COMPLETE — SCOPE A` (it must, because you never touch `session-scope.json` or
`prove.expected.txt`); `npm run green` exits 0; every Phase-2/3 BACKLOG row is closed or has a
`BLOCKED.md` row; `HANDOFF.md` covers every new command with its expected output; git clean;
`CONTROL §11` items 1–15 pass before item 16.

## Binding rules (verbatim — a violation is a stop condition)

1. **Activate Node first, every session:** `fnm env --use-on-cd | Out-String | Invoke-Expression ; fnm use 22`. A bare `node` lies non-interactively (BLOCKED B13). Confirm `node --version` is v22+.
2. **One commit per completed WP.** Subject `[type]- WP-NN <imperative>`; the six body keys pass `g-commit-format`. Never commit with a failing gate; never disable/skip/widen/downgrade a gate to go green.
3. **Every new gate exports `mutations[]` with ≥ 2 entries, and `npm run gates:mutate` proves each flips the verdict.** A gate that cannot fail its own mutation is deleted, not committed. The mutation harness stages inputs with **no `.git`**, so anti-drift checks must be file/state-driven, not git-history-driven (see the four WP-10 gates for the pattern).
4. **Degrade to `uninspectable` (exit 3), never `pass`,** when a live backend or browser is absent.
5. **A self-report is not evidence.** The only proof is a command's exit code + printed output, recorded in `packages/verify/evidence/<WP>.json` by the pre-commit hook, with a matching `gitSha`.
6. **No weakening without a decision row.** Lowering a threshold, loosening a test's expected output, removing a gate, or narrowing scope requires a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row in the same commit. Silently adapting the artifact to make a check pass is the S7 failure the rebuild exists to prevent.
7. **Scope is data.** Scope-B ids live in `packages/verify/config/session-scope-b.json` (read only by `prove-b.mjs`). **`session-scope.json` stays frozen at its 12 Scope-A ids** — never add a Scope-B id to it, or you break the frozen Scope-A proof. Each WP enters `session-scope-b.json` via its `Scope change:` row (ids contiguous from D-100), and `wp-table.json` + `CONTROL §3` update in the same commit.
8. **Do NOT author anything under `.github/workflows/**`.** CI is the user's (ship only `packages/sfs/test/oracle.test.mjs`).
9. **Do NOT touch `prove.mjs` or re-bless `prove.expected.txt`.** Scope A's two `--bless` uses (WP-1, WP-10) are spent. Scope B's proof is the NEW `prove-b.mjs`, blessed exactly once into `prove-b.expected.txt`.
10. **Never carry an in-flight WP across a context reset.** `green:fast` green ⇒ resume at `stepGroup`; red ⇒ revert modified files not in `filesWrittenThisWp`, redo. Never `git reset --hard` past `lastGreenCommit`. Never disable a hook to recover.

## Step 0 — open Scope B (once, before any WP) — ENACTED as the WP-0b commit

*(Kept as the record of what opening Scope B entailed; a resuming session starts at WP-5c.)*
One `[chore]- WP-0b open Scope B` commit that:
1. Adds row **D-100** (drafted in `PROPOSAL.md §1`) to `DECISIONS.md`.
2. Creates `packages/verify/config/session-scope-b.json` = `{ "wps": [] }` (WPs are added as each lands its own Scope change row) and scaffolds `packages/verify/src/prove-b.mjs` + its enforcer `packages/verify/test/prove-b.contract.test.mjs`.
3. Adds `WP-0b/5c/5d/5e/2b/1c/16b` to `wp-table.json` (`inScope:false`; `WP-3b/3c/3d/6/7/8/9` already exist) and a Scope-B block to `CONTROL §3`.
4. **Reclaims byte headroom in the same commit** (both files were near their caps):
   - `DECISIONS.md`: `node packages/registry/src/gen-decisions.mjs --archive` moved 3 decided rows to the archive (16252 B < 16384 B target).
   - `CONTROL.md`: trimmed to fit the Scope-B block (25561 B < 25600 B cap — very tight; WP-16b's brief-split reclaims real room).
   - Verified `g-decisions` and `g-brief-budget` pass, then `npm run green`.

`npm run prove` is **unaffected** by Step 0 and still prints `SESSION COMPLETE — SCOPE A`. Scope-B
progress is shown by `npm run prove-b` (initially `SESSION INCOMPLETE — remaining …`).

## The WP ladder (details + acceptance in `PROPOSAL.md §2–§3`)

All thirteen ids are already seeded in `session-scope-b.json` in this priority order (the mining
run — 7.0% round-trip over 2,071 real forms, `MINING-REPORT.md §5` — set it). A later split needs a
`Scope change:` row; no per-WP scope row is needed to start one that is already listed.

The three highest-value gap-closers first:

1. **WP-5c** compiler robustness — the `reading 'hidden'` TypeError becomes a diagnostic, not a crash (498 forms). Start here.
2. **WP-5d** decompiler output hygiene — sanitise entity/form/label/hooks names, empty strings, child-node kinds, pad types so lifted SFS passes its own schema (~700 forms).
3. **WP-5e** IR nodes for the escaping constructs — `columns` (241), `buttonGroup` (153), `collapsiblePanel`, `tabs`, `statusTag`, `title`, `button`, … (BL-023 colour provenance folds in here). `columns` and `buttonGroup` are highest value.
4. **WP-2b** registry completeness ≥ 93/121 (BL-004/020/022) — uses the framework clone at `.build/framework`.
5. **WP-3b** T3 semantic tier (BL-003) — un-quarantine `t3-semantic.mjs`/`g-check-references.mjs`, a fixture per check, extend `g-mutation-coverage` + `defect-classes.json`.
6. **WP-1c** population hardening (BL-001/006/010/014).
7. **WP-6** corpus round-trip ≥ 0.90 over all 12 forms (BL-002).
8. **WP-9** precedent retrieval (BL-009).
9. **WP-7** thin the design skills + clear prose debt (BL-007/012).
10. **WP-16b** flip `g-brief-budget` bundle to `enforced:true` ≤ 61440 B (BL-011) — LAST offline; the flip is a `Threshold change:` row.

Then the gated WPs:

11. **WP-8** hooks/MCP/agents (BL-008) — **stop and ask the user for a session RESTART** to prove the `.form.json` write-block; until then `uninspectable`, recorded as a `BLOCKED.md` row.
12. **WP-3c / WP-3d** live tiers T4/T5 (BL-005) — need Playwright chromium + a live Shesha backend; absent, the tier degrades to `uninspectable` exit 3 (never pass) and gets a `BLOCKED.md` row.
13. **CI** (BL-015) — ship `packages/sfs/test/oracle.test.mjs` only; leave a `BLOCKED.md` row noting the workflow file is the user's to add.

Each WP: read the `CONTROL`/brief section its BACKLOG row cites (and `MINING-REPORT.md` for the
WP-5x trio), do the work, prove it with the acceptance command, add one deterministic step to
`prove-b.mjs`, add its BUILD-LOG block, and commit. Only after every id in `session-scope-b.json` is
complete: `node packages/verify/src/prove-b.mjs --bless` (the one permitted Scope-B bless), then
`npm run prove-b` → `SESSION COMPLETE — SCOPE B`, then the final commit.

## Reporting discipline

After each WP, report the acceptance command and its actual exit code + output — never a paraphrase.
At Step 0, and before WP-8 (the restart-gated one), surface the plan and wait for the user. Do not
fabricate or predict the mining report's contents; treat `MINING-REPORT.md` as data the moment it
exists, and quote from it rather than from memory.
