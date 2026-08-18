# Shesha Plugins

Claude Code plugins, skills, and the SFS toolchain for Shesha framework development (Shesha 0.45.x).

`/DECISIONS.md` is the only decision registry. Every architectural question here has a decided row
there or is not yet a question. `packages/sfs/registry/decisions.json` is generated from it.

## The three invariants

Each is enforced by a program named in brackets. A way to violate one without a gate failing is a P0
bug in the gate, not a loophole.

1. **The compiler is the only writer of form markup.** No agent, skill, script, or human hand-writes
   or hand-edits Shesha form JSON. All markup is produced by `packages/sfs` from a `*.sfs.json`
   input. [`g-markup-provenance` recompiles every committed `*.form.json` from its sibling SFS and
   fails on any byte difference — scheduled at WP-5; a write-blocking hook is BL-008]
2. **No prose rule without a program enforcing it.** A constraint expressed only in markdown is
   deleted, not annotated. [`g-decisions` requires every DECISIONS.md row to name a live enforcer or
   a `pending:<WP-id>` one; `g-prose-budget` bans annotation and archaeology patterns]
3. **Zero coverage is a hard fail.** Every gate reports `walked / checked / notApplicable /
   uninspectable / failures` per declared family. A family that walked 0 fails. A family that walked
   more than 0 and checked 0 fails. Any `uninspectable` entry yields `partial` (exit 3), never a pass.
   [`packages/registry/src/coverage.mjs` is the one implementation; the two re-export files are held
   to a single line by `g-coverage-single-impl`]

A fourth rule governs reporting: **a self-report is not evidence.** Every completion claim is a
command's exit code recorded in `packages/verify/evidence/<WP>.json` by a program.

## Repository layout

```
packages/registry/   L0 ground truth: component registry, capability matrix, tokens, probes, coverage
packages/sfs/        L1+L2: SFS schema, parser, compiler, decompiler, recipes, the `sfs` CLI
packages/verify/     L3: verifier tiers, every repo gate, mutation harness, gate evidence
packages/mcp/        L4: MCP tool surface (the server itself is BL-008)
packages/precedent/  Scaffold; throws E_NOT_IMPLEMENTED until BL-009
quarantine/          Legacy gates with declared holes, awaiting BL-003. Referenced by nothing
plugins/             Claude Code plugins. Skills are thin routers over packages/**, never logic
.githooks/           pre-commit runs green:fast; commit-msg runs the commit-format gate
docs/rebuild-brief/  The rebuild brief. Not prompt payload; CONTROL.md is the turn-zero read
```

## Commands

```
npm ci                  install (Node >= 22; package-lock.json is committed and authoritative)
npm run green:quick     typecheck + gates
npm run green:fast      typecheck + tests + gates. What .githooks/pre-commit runs
npm run green           green:fast + gates:mutate. What CI and `npm run prove` run
npm test                every test under packages/*/test/ and quarantine/
npm run gates           every gate in packages/verify/src/gates/
npm run gates:mutate    proves every gate fails when its declared mutations are applied
npm run sfs -- <args>   the compiler CLI, the only writer of form markup
npm run prove           the integration proof; its last line is the definition of done
```

Useful single programs:

```
node packages/verify/src/run-gates.mjs            run every gate, exit with the worst verdict
node packages/registry/src/gen-decisions.mjs      regenerate decisions.json from DECISIONS.md
node packages/registry/src/gen-decisions.mjs --archive   move closed rows to docs/decisions-archive.md
node packages/verify/src/gates/g-decisions.mjs    prove every row's enforcer resolves across both files
node packages/sfs/bin/sfs.mjs --version           prove the single entrypoint starts
```

`npm run green:fast` exiting 0 is the definition of a committable tree. `npm run green` exiting 0 is
the definition of a pushable tree. Nothing else is.

## Definition of done (every work package)

All of these hold, and all are machine-checked. No number in a commit body is typed by hand.

1. `npm run green` exits 0 on a clean checkout after `npm ci`.
2. Every rule the WP introduces has a DECISIONS.md row naming a live enforcer, or a
   `pending:<WP-id>` whose owner is later than this WP. [`g-decisions`]
3. Every gate the WP adds or touches exports `mutations[]` with at least 2 entries, and
   `npm run gates:mutate` proves each flips the verdict. [`g-gate-contract`]
4. Every gate and tier imports coverage accounting from `coverage.mjs`, with zero local
   reimplementations. [`g-coverage-single-impl`]
5. Declared family sets are module constants. No lazily-created families.
6. Anything requiring a live Shesha backend degrades to `uninspectable` plus exit 3 with a reason
   string. No code path treats backend-absent as a pass.
7. `npm run typecheck` exits 0.
8. Every deleted path has a row in `packages/verify/config/disposition.json` against this WP id,
   and no reference to it survives.
9. Prose budget respected. [`g-prose-budget`]
10. `packages/verify/evidence/<WP-id>.json` is in the commit and its `gitSha` matches.
    [`g-commit-format`]
11. `plugins/shesha-developer/.claude-plugin/plugin.json` version bumped if and only if the commit
    touches `plugins/**`.

## Prose budget

Instruction files are prompt payload, not documentation. Tiers, caps and waivers live in
`packages/verify/config/prose-budget.json`; the gate reads that file and carries no literals.

- Tier A (the design pipeline) caps `SKILL.md` at 500 lines / 8192 bytes. The gate hard-fails if the
  number of existing folders matching `tierA.paths` differs from `tierA.expectedCount`, so a rename
  that does not update the config fails.
- Tier B (every other skill) caps `SKILL.md` at 500 lines / 24576 bytes.
  `plugins/shesha-developer-0-43/**` is frozen and skipped; edits to it are forbidden.
- `/CLAUDE.md` at most 250 lines / 12288 B. `/DECISIONS.md` at most 24576 B. `/BACKLOG.md` at most 8192 B.
- **References one level deep.** `skills/<skill>/references/*.md` only. Deeper nesting truncates
  under partial reads.
- **No changelog archaeology in any scanned file.** The banned patterns are data, in the config.
  Commit history belongs in git, not in the runtime prompt.
- **No README.md, CHANGELOG.md, or INSTALLATION_GUIDE.md inside any skill folder.**
- Forward slashes only. No drive-letter absolute path in any committed file.
- Caps only ratchet down. `g-prose-budget --baseline` writes waivers from measured sizes and refuses
  to raise one.

## Skill conventions

- Skill folder name equals the frontmatter `name`; legal frontmatter keys are `name`, `description`,
  `allowed-tools` and `argument-hint`; lowercase-with-hyphens.
- Skills are **routers**. A skill may state intent, route to a package command, and show worked
  examples. A skill may not contain a deterministic rule, a version integer, a prop list, an enum
  domain, or a code snippet the model is asked to transcribe. Those live in `packages/registry`
  (data) or `packages/sfs` (code).
- Worked input/output examples beat schema prose on complex parameters. Spend the byte budget on
  examples.

## Backend conventions

- All entity properties must be `virtual` (NHibernate requirement).
- No changes to `shesha-framework`. Everything works against Shesha 0.45.x as shipped.

## Git

- Branch `hashim/sfs-rebuild-scope-a`, cut from `8a2d2f4`. Never push to `upstream`.
- Commit subject `[type]- WP-NN <imperative summary>`; types `[feature]`, `[fix]`, `[chore]`.
  The body's six mandatory keys are enforced by `g-commit-format` from `.githooks/commit-msg`.
- One commit per completed work package. Never a commit with a failing gate, and never a commit that
  disables, skips, widens, or downgrades a gate to make the tree green.
- Never commit `.claude/settings.local.json`.
