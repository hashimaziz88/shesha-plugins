# Prompt 3 of 3 — CLAUDE.md and the project-setup skill

> Paste below the line in Claude Code at `C:\Users\Hashim\Documents\GitHub\shesha-plugins`.
> Run after prompt 1 (audit), before prompt 2 (goal) — see the note at the end.

---

**Goal: bring the repo's own operating instructions up to date with the toolchain that now exists, and give the 0.45.x plugin the project-setup skill it is missing.** Two deliverables, one commit each. No compiler or tier code.

```bash
fnm use 22 || fnm use v22.23.2 ; node --version    # B13: bare node is not on PATH non-interactively
git log --oneline -5 && git status --porcelain
npm run green ; echo "green exit=$?"
cat CLAUDE.md ; cat AUDIT.md
```

Read `docs/rebuild-brief/CONTROL.md` and `docs/rebuild-brief/10-standards.md` §1.1. **`CLAUDE.md` was already rewritten in WP-0 from §1.1 and is 7,877 B** — this is an update against reality, not a rewrite from the section.

## Deliverable 1 — `/CLAUDE.md`

It has the right skeleton (three invariants, layout, commands, definition of done, prose budget, skill conventions, backend conventions, git). Correct it where it no longer matches the tree, and add what a fresh agent cannot discover:

- **Node activation.** A bare `node` does not resolve in a non-interactive shell on this machine (B13). Every command block in `CLAUDE.md` must lead with `fnm use 22`, and the Commands section must say why. An instruction that silently fails is worse than none.
- **Real layout.** Five workspace packages exist — `registry`, `sfs`, `verify`, `mcp`, `precedent`. State each one's role in one line, and state the dependency arrow `registry <- sfs <- verify` plus the rule that the compiler never imports the verifier.
- **The single-definition rules**, because they are the drift generators this rebuild removed: the whole coverage API is defined once in `packages/registry/src/coverage.mjs` and re-exported with one `export *` line; `walkComponents` lives only in `packages/verify/src/walk.mjs`.
- **The four artifact names** — `<screen>.form.json`, `<screen>.compile.json`, `<screen>.form.meta.json`, `<screen>.sfs.meta.json`; blessed fixtures `<screen>.expected.form.json`; `.compiled.json` banned.
- **The gate contract**: a gate ships in the work package that creates its subject; every gate carries ≥2 verdict-flipping mutations; a gate that cannot fail is deleted, not committed. Name the current gate count from `ls packages/verify/src/gates/*.mjs` rather than a number you remember — the audit found the eight-versus-eleven drift already.
- **Commands that exist**, verified by running them: `green:fast`, `green`, `gates`, `gates:mutate`, `test`, `typecheck`, `sfs`, `prove`, `bless`. Delete any documented command that cannot execute — that is `g-commands-executable`'s rule and the defect it exists to prevent shipped in this repo once already.
- **Prose budget**, stated as the live numbers: SKILL.md under 500 lines and under 8 KB, references one level deep, and the fact that 34 measured waivers currently exist (B12) with caps that ratchet down only.
- **Where the source of truth for each kind of knowledge lives** — component props and versions in the registry, "what renders" in the capability matrix, brand in the token file, decisions in `DECISIONS.md`, and the rule that none of these is ever restated in prose. This is the single most useful paragraph in the file: it tells a future agent where *not* to write.
- **Preserve, verbatim in meaning**: the `[type]- Description` commit style; the plugin-version cadence; skill folder name matching frontmatter `name`; no README/CHANGELOG inside skill folders; forward slashes in docs; `.claude/settings.local.json` never committed; entity properties `virtual`.

`g-prose-budget` covers `CLAUDE.md`. It must pass without a new waiver. If your draft exceeds the cap, cut prose — do not raise the cap.

## Deliverable 2 — `shesha-project-setup` for 0.45.x

**The finding:** `shesha-project-setup` exists only in `plugins/shesha-developer-0-43/skills/`. The current `shesha-developer` plugin has **no** project-setup skill, so a developer on 0.45.x has no environment-setup path at all. Same gap applies to `upgrade-shesha-stack`, `add-analyzers` and `harden-permissions`; file those three as `BACKLOG.md` rows and fix only project-setup here.

**Mandatory first step per `CLAUDE.md`:** read `plugins/shesha-developer/skills/skill-creator/SKILL.md` before authoring. Then read the 0-43 version and treat it as a starting point, not a template to copy — it predates everything in this rebuild.

Create `plugins/shesha-developer/skills/shesha-project-setup/` with frontmatter `name: shesha-project-setup` matching the folder, a `description` that triggers on new-project setup and dev-environment verification, and a body that covers:

- Backend and frontend prerequisites for 0.45.x, and the verification command for each — not prose claiming they are needed.
- **Node via `fnm`**, with the non-interactive-PATH trap stated once.
- The SFS toolchain: `npm ci`, `npm run green:fast`, and what a red result means at setup time.
- Registry pinning: which Shesha release the committed registry was generated from, how to check, and what to do on an upgrade — the diff is an upgrade-impact report, not a silent drift.
- Seeding sample data before any form work, and why: without records, `getEntitySample` returns nothing and evaluation runs blind. Cross-reference the harness's own onboarding rather than restating it.
- A verification checklist where **every item is a command with an expected output**. Zero judgements.

Constraints: under 500 lines and under 8 KB; references one level deep if any; no README or CHANGELOG in the folder; no component versions, prop lists or hex colours anywhere in it — those live in the registry and the token file, and `g-skill-purity` enforces it.

**A version conflict you must resolve, not guess:** repo convention says a new skill folder is a **minor** bump, which takes 1.8.4 → 1.9.0. But commit `2e1625d` deliberately shipped this branch as 1.8.4 *specifically to avoid 1.9.x colliding with contested branches*. Pick one, record it as a `DECISIONS.md` row with its reason, and make `g-plugin-version` agree. Do not bump silently in either direction.

## Finish

Two commits: `[chore]- Update CLAUDE.md to the built toolchain` and `[feature]- Add shesha-project-setup for 0.45.x`. `npm run green` must be exit 0 after each. Print the before/after byte counts for `CLAUDE.md`, the new skill's line and byte counts, the waiver count before and after, and the version decision you recorded.

**Sequencing note.** Run this before prompt 2 if you want the setup skill inside the run that keeps everything green — it is cheap and it means the gates only get re-run once. Run it after prompt 2 only if you would rather not touch `plugins/**` while WP-7a is deleting `shesha-form-edit`, since both write there and CONTROL §7 forbids concurrent writes to one path set. Either is defensible; do not do both at once.
