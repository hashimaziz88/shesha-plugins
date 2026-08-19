# Prompt 1 of 2 — Audit and documentation reconciliation

> Paste below the line in Claude Code at `C:\Users\Hashim\Documents\GitHub\shesha-plugins`.
> Run this to completion and commit it **before** running prompt 2.

---

**Goal: reconcile every document in this repo with what the code actually is, and commit the corrections. Advance no work package.** This is an audit, not a build. If you find yourself writing compiler or tier code, you have left the task.

`node` is not on PATH in non-interactive shells here (BLOCKED B13). Activate it first or every measurement lies:

```bash
fnm use 22 || fnm use v22.23.2
node --version    # must print v22.x
```

Then establish ground truth from evidence, not from `BUILD-LOG.md` or from memory:

```bash
git branch --show-current && git log --oneline -12 && git status --porcelain
cat .build/state.json
cat BUILD-LOG.md BLOCKED.md BACKLOG.md DECISIONS.md
cat packages/verify/config/session-scope.json
npm run green ; echo "green exit=$?"
npm run gates:mutate ; echo "mutate exit=$?"
```

Read `docs/rebuild-brief/CONTROL.md` in full. It is the control program and it outranks the five detail sections.

## What to audit, and the finding I already have for each

Produce one `AUDIT.md` at the repo root. Every row is a finding with the command that produced it, the discrepancy, the correction, and the file corrected. No row is a judgement.

1. **Two decisions exist only in a gitignored file.** `.build/state.json` → `decisionsPendingWriteUp` holds D-076 (the decompiler is lossless by default — a prop is dropped only where the compiler provably regenerates it byte-identically) and D-077 (N12, the action-item `editMode` normalisation). Both are prerequisites for Q2 and neither is in `DECISIONS.md`. **Write both rows now**, D-076 enforced by `g-oracle-independence`, and remove them from `decisionsPendingWriteUp`. A context reset would otherwise destroy them.

2. **Green drift.** `lastGreenCommit` is `c6af856`; HEAD is `3d20dab`. Determine which is true by running `npm run green`, then either update `lastGreenCommit` to HEAD or follow CONTROL §6's mid-package resume protocol. `green` outranks any recorded claim.

3. **`BUILD-LOG.md`'s WP-0 header says "eight gates"; eleven shipped.** Override O7 raised it to eleven and the tree agrees (`ls packages/verify/src/gates/*.mjs` → 11). Correct the header and any body text that counts eight, and confirm `gate-ratchet.json`'s floor is set from eleven.

4. **CONTROL's precondition P1 does not mention `fnm`.** On this machine a bare `node` is not resolvable non-interactively, which makes P1 as written unable to fail correctly. Rewrite P1 to activate `fnm` first, and cross-reference B13. Check every other acceptance command in CONTROL §3 and in the five sections for the same assumption.

5. **The voided spellings are still live in the detail sections.** `scheduled:` survives in `20-sfs-compiler.md` and `50-session-plan.md`; "exactly eight" survives in `50-session-plan.md`. D-009 says delete the losing side, never annotate it — so delete them and rewrite those passages to `pending:<WP-id>` and to eleven gates. **Do not touch the occurrences inside CONTROL's O6 and O7**: those quote the losing side in order to void it, which is their job.

6. **The brief bundle is 604,699 B against a 61,440 B cap** — 9.8×, and growing as prompts are added. B11 records this as unenforceable. Do not execute BL-011 here (that is a work package). Instead verify that the honesty is complete: `brief-budget.json` carries `bundle.enforced: false`, B11 names BL-011 as its unblock action, and no document anywhere claims the bundle cap holds.

7. **Scope drift between documents.** `session-scope.json` lists nine ids (WP-1 split into 1.a/1.b under D-070). Confirm CONTROL §3's table, `prove.mjs`'s scope line, and `BUILD-LOG.md` all name the same nine, and that the split is recorded as a `Scope change:` row or as D-070 explicitly.

8. **Every acceptance command in CONTROL §3 must be literally runnable today.** Run each one for the completed work packages and record its exit code and first line of output. Any command that cannot run as written is a documentation defect, not a code defect — fix the document. This is `g-commands-executable`'s job; confirm the gate's `inputPaths` actually cover CONTROL and the sections.

9. **The 34 prose waivers of B12.** Verify each waiver's dated owner (WP-7a / BL-007 / WP-2 / BL-012) still corresponds to a live scope or backlog id, and that `--baseline` genuinely refuses to raise a cap. A waiver whose owner no longer exists is an orphan and must be re-dated or deleted.

10. **`BACKLOG.md` completeness.** Twelve ids exist (BL-001…BL-012). Confirm every one carries `Raised in WP`, `Blocks anything? = No`, and a non-empty `Acceptance` cell copied verbatim from its owning section — `g-backlog`'s contract. Add rows for the two items decided in conversation and not yet filed: a property-based compiler fuzzer, and keeping WP-1's second compiler as a permanent differential oracle plus a CI workflow running `npm run green`.

## Rules for this audit

Correct documents, never code, and never a gate threshold. If a document and the code disagree and the **code** is wrong, that is a finding in `AUDIT.md` with a proposed work package — not a fix you make here. Nothing in this pass may change a gate's verdict on any existing artifact; if `npm run green` result changes as a consequence of your edits, you have exceeded the task and must revert.

Commit as one `[chore]- Reconcile brief and state documents to the tree` with `AUDIT.md` in the same commit. Then print: the number of findings, the number corrected, the number promoted to work packages, and `npm run green` exit code before and after.

Stop there. Do not start prompt 2's work.
