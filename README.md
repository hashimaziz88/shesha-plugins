# Shesha Plugins

Claude Code plugins, skills, and the SFS toolchain for Shesha framework development
(Shesha 0.45.x).

Two things live here, and they are joined at the hip:

- **`packages/`** — the SFS toolchain. SFS is a compact form-specification language; the
  compiler in `packages/sfs` is the only writer of Shesha form markup in this repository.
  A verifier ladder in `packages/verify` grades what it produces, and a registry in
  `packages/registry` is the ground truth about Shesha's components.
- **`plugins/`** — the Claude Code plugins and skills. Skills are **routers**: they state
  intent, route to a package command, and show worked examples. Deterministic rules,
  version integers, prop lists and enum domains live in `packages/registry` (data) or
  `packages/sfs` (code), never in a skill's prose.

## Repository layout

```
packages/registry/   L0 ground truth: component registry, capability matrix, tokens, probes, coverage
packages/sfs/        L1+L2: SFS schema, parser, compiler, decompiler, recipes, the `sfs` CLI
packages/verify/     L3: verifier tiers, every repo gate, mutation harness, gate evidence
packages/mcp/        L4: the `shesha-sfs` MCP tool surface
packages/precedent/  shape-indexed precedent retrieval over the corpus
plugins/             Claude Code plugins. Skills are thin routers over packages/**, never logic
.claude/hooks/       write-blocking and dispatch hooks
.githooks/           pre-commit runs green:fast; commit-msg runs the commit-format gate
docs/rebuild-brief/  the rebuild brief
```

Root documents: `CLAUDE.md` (the working contract), `DECISIONS.md` (the only decision
registry), `BACKLOG.md`, `BLOCKED.md`, `BUILD-LOG.md`, `HANDOFF.md`, `AUDIT.md`.

## Using the plugins

Three plugins are published from `.claude-plugin/marketplace.json`:

| Plugin | What it covers |
|---|---|
| `shesha-developer` | Application development against Shesha 0.45.x — domain model, application layer, forms, the design pipeline, configuration items |
| `framework-dev` | Work on the Shesha framework itself, not on an application built with it |
| `shesha-developer-0-43` | Version-pinned skill set for maintaining legacy v0.43 projects. Frozen; gates skip it and edits to it are forbidden |

Install through the Claude plugin marketplace:

1. From the repository root, run `/plugin marketplace add ./`.
2. Run `/plugin`, then use the arrow keys to reach the Marketplace tab.
3. Find "shesha-plugins", browse its plugins, and install the one you need.

An MCP server ships alongside them. `.mcp.json` registers `shesha-sfs`, whose seven tools
(`compile`, `decompile`, `verify`, `push`, `registry_lookup`, `metadata_entity`,
`precedent_search`) hold parity with the `sfs` CLI.

Skills live under `plugins/<plugin>/skills/<skill-name>/SKILL.md`. There is no top-level
`skills/` directory. A skill's folder name must equal its frontmatter `name`; the only
legal frontmatter keys are `name`, `description`, `allowed-tools` and `argument-hint`; and
`README.md`, `CHANGELOG.md` and `INSTALLATION_GUIDE.md` are never legal inside a skill
folder. `CLAUDE.md` carries the full skill conventions and the prose budget that enforces
them.

## Working on the toolchain

Node >= 22 is required, and `package-lock.json` is committed and authoritative.

```
npm ci                  install
npm run typecheck       tsc --noEmit
npm test                every test under packages/*/test/
npm run gates           every gate in packages/verify/src/gates/
npm run gates:mutate    proves every gate fails when its declared mutations are applied
npm run green:quick     typecheck + gates
npm run green:fast      typecheck + tests + gates. What .githooks/pre-commit runs
npm run green           green:fast + gates:mutate. What `npm run prove` runs
npm run sfs -- <args>   the compiler CLI, the only writer of form markup
npm run prove           the Scope A integration proof
npm run prove-b         the Scope B integration proof
npm run bless           re-record a blessed expected file
npm run hooks:install   git config core.hooksPath .githooks
```

`npm run green:fast` exiting 0 is the definition of a committable tree. `npm run green`
exiting 0 is the definition of a pushable tree. Nothing else is.

Every gate reports `walked / checked / notApplicable / uninspectable / failures` per
declared family. A family that walked 0 fails, and anything needing a live Shesha backend
degrades to `uninspectable` with a reason rather than passing. Completion is never a
self-report: it is a command's exit code recorded under `packages/verify/evidence/`.

## Contributing

1. Fork and clone, then branch: `git checkout -b feature/<short-name>`.
2. Make the change. If it touches `plugins/**`, bump
   `plugins/shesha-developer/.claude-plugin/plugin.json`.
3. Hold `npm run green` at exit 0 before you push. Never disable, skip, widen or downgrade
   a gate to make the tree green.
4. Commit subject `[type]- <imperative summary>`, types `[feature]`, `[fix]`, `[chore]`.
5. Open a pull request describing what changed and which command proves it.

`CLAUDE.md` is the authority on all of the above; this file is the front door.
