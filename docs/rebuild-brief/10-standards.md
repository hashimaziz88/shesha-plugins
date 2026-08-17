## Section 1 — Repo standards and definition of done

**Scope.** This section is Work Package **WP-0**. WP-0 establishes: the root instruction file, the repository layout, the npm workspace wiring, the decision registry, git discipline, and the gate contract every later work package is measured against. No later work package may begin until §1.9's commands print their expected output.

**Why first.** Strategy doc §2 RC2/RC3 and §5: the failure being rebuilt away is *prose rules with no enforcing program* and *gates that report green without coverage*. Standards after code means code written under the old regime.

**The one rule.** Every rule in this repository is either enforced by a program that fails loudly, or it does not exist. There is no third category. **A rule whose subject does not exist yet is registered as `pending:<WP-id>` and ratcheted (§1.4) — it is never written as prose and never stubbed as a no-op gate.**

---

### 1.1 File: `/CLAUDE.md` — write these exact contents

Overwrite the existing `/CLAUDE.md` completely. Do not merge.

````markdown
# Shesha Plugins

Claude Code plugins, skills, and the SFS toolchain for Shesha framework development (Shesha 0.45.x).

`/DECISIONS.md` is the only decision registry. Every architectural question here has a decided row
there or is not yet a question. `packages/sfs/registry/decisions.json` is generated from it.

## The three invariants

Each is enforced by a program named in brackets. A way to violate one without a gate failing is a P0
bug in the gate, not a loophole.

1. **The compiler is the only writer of form markup.** No agent, skill, script, or human hand-writes
   or hand-edits Shesha form JSON. All markup is produced by `packages/sfs` from a `*.sfs.json`
   input, through the single push path in `packages/sfs/src/push.mjs`.
   [`g-markup-provenance` recompiles every committed and every run-dir `*.form.json` from its sibling
   SFS and fails on any byte difference; `.claude/hooks/block-form-writes.mjs` is the fast first line]
2. **No prose rule without a program enforcing it.** A constraint expressed only in markdown is
   deleted, not annotated. A fourth restatement of a rule measurably lowers adherence (strategy doc
   §2 RC2). [`g-decisions` requires every DECISIONS.md row to name a live enforcer or a ratcheted
   `pending:<WP-id>`; `g-prose-budget` bans annotation and archaeology patterns]
3. **Zero coverage is a hard fail.** Every gate reports `walked / checked / uninspectable` per
   declared family. A family that walked 0 fails. A family that walked >0 and checked 0 fails. Any
   `uninspectable` entry yields `partial` (exit 3), which is never a pass.
   [`packages/registry/src/coverage.mjs` — one implementation; `packages/verify/src/coverage.mjs` and
   `packages/sfs/src/lib/coverage.mjs` are one-line re-exports, enforced by `g-coverage-single-impl`]

## Repository layout

Authoritative tree, one line per role (D-002):

```
packages/registry/   L0 ground truth: component registry, capability matrix, tokens, probes, coverage
packages/sfs/        L1+L2: SFS schema, parser, compiler, decompiler, normaliser, recipes, `sfs` CLI
packages/verify/     L3: T1-T4 verifier tiers, every repo gate, mutation harness, gate evidence
packages/mcp/        L4: MCP server exposing compile/decompile/verify/registry_lookup/push
plugins/             Claude Code plugins. Skills are thin routers over packages/**, never logic
.claude/hooks/       Enforcement hooks. Wired in committed .claude/settings.json
.githooks/           pre-commit: `npm run green:fast`. commit-msg: `g-commit-format`
```

## Commands

```
npm ci                  install (Node >= 22; package-lock.json is committed and authoritative)
npm run green:quick     typecheck + gates. Used by the SessionStart hook. Target <= 20 s
npm run green:fast      typecheck + tests + gates. Used by .githooks/pre-commit
npm run green           green:fast + gates:mutate. Used by CI and `npm run prove`
npm test                node --test in every workspace
npm run gates           every gate in packages/verify/src/gates/
npm run gates:mutate    proves every gate fails when its declared mutations are applied
npm run sfs -- <args>   the compiler CLI (the only writer of form markup)
```

`npm run green:fast` exiting 0 is the definition of a committable tree. `npm run green` exiting 0 is
the definition of a pushable tree. Nothing else is.

## Definition of Done (every work package)

All twelve hold, and all twelve are machine-checked. No number in a commit body is typed by hand.

1. `npm run green` exits 0 on a clean checkout after `npm ci`.
2. Every rule the WP introduces has a DECISIONS.md row naming a live enforcer, or a `pending:<WP-id>`
   whose WP is later than this one. [`g-decisions`]
3. Every gate the WP adds or touches exports `mutations[]` with >= 2 entries, and
   `npm run gates:mutate` proves each flips the verdict to `fail` or `partial`. [`g-gate-contract`]
4. Every gate and tier imports coverage accounting from `coverage.mjs`. Zero local
   reimplementations. [`g-coverage-single-impl`]
5. Declared family sets are module constants. No lazily-created families (D-005).
6. Anything requiring a live Shesha backend degrades to `uninspectable` + exit 3 with a reason
   string. No code path treats backend-absent as pass. [`g-exit-codes`]
7. `npm run typecheck` exits 0.
8. Every deleted path is listed in `disposition.json` against this WP id, and no reference to it
   survives. [`g-disposition`, `g-check-references`]
9. Prose budget respected. [`g-prose-budget`]
10. DECISIONS.md updated in the same commit for every decision the WP made. [`g-decisions`]
11. `packages/verify/evidence/<WP-id>.json` is in the commit, was written by the gate runner during
    this commit's pre-commit, and its `gitSha` equals the parent commit. [`g-commit-format`]
12. `plugins/shesha-developer/.claude-plugin/plugin.json` version bumped iff the commit touches
    `plugins/**`. [`g-plugin-version`]

## Prose budget

Instruction files are prompt payload, not documentation. Tier assignment, caps and waivers live in
`packages/verify/config/prose-budget.json`; the gate reads that file and carries no literals.

- Tier A (the design pipeline) caps `SKILL.md` at 500 lines / 8192 bytes. The gate hard-fails if the
  number of existing folders matching `tierA.paths` != `tierA.expectedCount`, so a rename that does
  not update the config fails.
- Tier B (every other skill in `shesha-developer` and `framework-dev`) caps `SKILL.md` at 500 lines /
  24576 bytes. `plugins/shesha-developer-0-43/**` is frozen and skipped; edits to it are forbidden.
- `/CLAUDE.md` <= 250 lines / 12288 B. `/DECISIONS.md` <= 24576 B. `/BACKLOG.md` <= 8192 B.
- **References one level deep.** `skills/<skill>/references/*.md` only. No subdirectories, no
  reference linking to another reference. Deeper nesting truncates under partial reads.
- **No changelog archaeology in any scanned file.** Hard failures with `file:line`: `used to`,
  `previously`, `no longer`, `has been (fixed|corrected|removed)`, `in an earlier version`,
  `as of v?\d`, `do not (correct|fix) (this|the above)`, `TODO|FIXME|XXX`. Commit history belongs in
  git, not in the runtime prompt.
- **No README.md, CHANGELOG.md, or INSTALLATION_GUIDE.md inside any skill folder.**
- Forward slashes only. No `[A-Za-z]:/` absolute path in any committed file. [`g-registry-provenance`]
- Waiver caps are written by `node packages/verify/src/gates/g-prose-budget.mjs --baseline` from the
  measured size. The gate refuses to raise a cap; `g-no-gate-tampering` fails any commit that does.

## Skill conventions

- Skill folder name must equal the frontmatter `name`; frontmatter carries `name` + `description`
  only; lowercase-with-hyphens. [`g-prose-budget`]
- Skills are **routers**. A skill may state intent, route to a package command, and show worked
  examples. A skill may not contain a deterministic rule, a version integer, a prop list, an enum
  domain, or a code snippet the model is asked to transcribe. Those live in `packages/registry`
  (data) or `packages/sfs` (code). [`g-skill-purity`]
- Worked input/output examples beat schema prose by 18 points on complex parameters (strategy doc §4
  L4). Spend the byte budget on examples.

## Backend conventions

- All entity properties must be `virtual` (NHibernate requirement).
- No changes to `shesha-framework`. Everything works against Shesha 0.45.x as shipped. [D-004]

## Git

- Branch `claude/sfs-rebuild`, cut from the PR #39 head (`claude/team-standup-4e3e21`, v1.8.4).
- Commit subject `[type]- WP-NN <summary>`; types `[feature]`, `[fix]`, `[chore]`. Body template and
  the six mandatory keys are enforced by `g-commit-format` from `.githooks/commit-msg`.
- One commit per completed work package. Never a commit with a failing gate, and never a commit that
  disables, skips, widens, or downgrades a gate to make the tree green. [`g-no-gate-tampering`]
- Never commit `.claude/settings.local.json`. [`.gitignore` + `g-no-secrets-or-scratch`]
````

---

### 1.2 Target repository layout after the rebuild

Move kept assets with `git mv` — history preservation is required, because the empirical assets are the ones strategy doc §3 Option B rejects re-earning.

```
shesha-plugins/
├── CLAUDE.md                          §1.1. <=250 lines / <=12288 B
├── DECISIONS.md                       The one decision registry (§1.4). <=24576 B
├── BUILD-LOG.md  BLOCKED.md  BACKLOG.md   Session state (Section 5 §5.3/§5.5/§5.6)
├── README.md                          Human orientation only. No rules, no procedure, no versions
├── package.json  package-lock.json  tsconfig.json  .gitignore
├── .githooks/{pre-commit,commit-msg}
├── .github/workflows/{ci.yml,registry.yml}
├── .claude/settings.json              Committed. enabledPlugins + ALL hook wiring
├── .claude/hooks/*.mjs                WP-8. Enforcement hooks
├── docs/rebuild-brief/                This brief + evidence.md + assets/. Not prompt payload (D-043)
├── packages/
│   ├── registry/                      L0. data/ (components-kb, capability-matrix, tokens,
│   │                                  action-owners, form-settings), src/ (extract, lookup,
│   │                                  coverage), probes/, test/
│   ├── sfs/                           L1+L2. schema/, src/, recipes/, corpus/, errors/, bin/sfs.mjs
│   ├── verify/                        L3. src/{coverage,walk,t1..t4}.mjs, src/gates/*, config/*,
│   │                                  evidence/*.json, test/ (+ mutation-meta.test.mjs)
│   ├── mcp/                           L4 tool surface
│   └── precedent/                     Scaffold only at WP-0; throws E_NOT_IMPLEMENTED
└── plugins/
    ├── shesha-developer/              .claude-plugin/plugin.json, agents/, skills/
    ├── shesha-developer-0-43/         FROZEN. Gates skip it. Do not edit
    └── framework-dev/                 Tier B prose budget applies
```

**Disposition is data, not prose.** WP-0 writes `packages/verify/config/disposition.json`: one row per path, `{path, action: "delete"|"move", to?, wp, reason}`. `g-disposition` reads it and `packages/verify/config/wp-table.json`, and hard-fails when:

- a row's `wp` is recorded complete in `BUILD-LOG.md` and a `delete` row's `path` still exists, or a `move` row's `to` does not exist;
- a `delete` row's `path` is absent while its `wp` is **not** yet complete (deleted early, off-plan);
- a tracked path was deleted in the staged diff and has no `disposition.json` row.

Seed rows (strategy doc §5 disposition table — nothing else is deleted):

| path | action | wp |
|---|---|---|
| `plugins/shesha-developer/skills/shesha-form-edit/scripts/summarize.js` + its two invocations | delete | WP-0 |
| `.../shesha-form-edit/scripts/validate-blocks.js` | delete | WP-0 |
| `.../shesha-form-edit/scripts/bake-overlays.mjs` | delete | WP-5 |
| `.../shesha-form-edit/assets/examples/*.json` (2.5 MB) | delete | WP-6 |
| `.../shesha-form-edit/SKILL.md` + its 32 references (276 KB) | delete | WP-7 |
| `.../shesha-design-comprehension/{package.json,scripts/layout-probe.js}` | delete | WP-0 |
| `.../shesha-claude-designer/README.md` | delete | WP-0 |
| `.../shesha-form-edit/scripts/verify-artifact.mjs` | move | WP-0 |
| `.../shesha-form-edit/tests/verify-artifact.test.mjs` | move | WP-0 |
| `.../shesha-form-edit/scripts/check-references.mjs` | move | WP-0 |
| `.../shesha-form-edit/tests/check-references.negative.mjs` | move | WP-0 |
| `.../shesha-form-edit/assets/components-kb/**` | move | WP-0 |
| `.../shesha-form-edit/assets/{blocks,patterns}/**` | move | WP-0 |
| `.../shesha-design-system/assets/capability-matrix.json` | move | WP-0 |
| `.../shesha-design-comprehension/scripts/layout-probe.js` | move | WP-0 |

`move` destinations, written into the `to` cell:

```
verify-artifact.mjs        -> packages/verify/src/t3-semantic.mjs        (split; Section 3)
verify-artifact.test.mjs   -> packages/verify/test/t3-semantic.test.mjs  (all 15 tests must pass)
check-references.mjs       -> packages/verify/src/gates/g-check-references.mjs
check-references.negative.mjs -> packages/verify/test/gates/g-check-references.mutation.test.mjs
components-kb/**           -> packages/registry/data/components-kb/**
blocks/**, patterns/**     -> packages/sfs/recipes/_legacy/**           (converted, then _legacy deleted at WP-5)
capability-matrix.json     -> packages/registry/data/capability-matrix.json
layout-probe.js            -> packages/verify/src/probe/layout-probe.mjs (CJS->ESM in the same commit)
```

---

### 1.3 npm workspace wiring — concrete files

**Decision (strategy doc §9 q4): the toolchain lives in this repo as npm workspace packages under `packages/`.** One `npm ci` serves Claude Code, the SAA harness, Copilot and CI; a second repository would need its registry pin, schema version and error catalogue kept in sync by hand.

**`/package.json`** — create exactly:

```json
{
  "name": "shesha-plugins",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "npm test --workspaces --if-present",
    "gates": "node packages/verify/src/run-gates.mjs",
    "gates:mutate": "node packages/verify/test/mutation-meta.test.mjs",
    "green:quick": "npm run typecheck && npm run gates",
    "green:fast": "npm run typecheck && npm run test && npm run gates",
    "green": "npm run green:fast && npm run gates:mutate",
    "sfs": "node packages/sfs/bin/sfs.mjs",
    "hooks:install": "git config core.hooksPath .githooks"
  },
  "devDependencies": { "@types/node": "22.14.0", "typescript": "5.9.2" }
}
```

**`/tsconfig.json`** — create exactly:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@shesha/registry": ["packages/registry/src/index.mjs"],
      "@shesha/sfs": ["packages/sfs/src/index.mjs"],
      "@shesha/verify": ["packages/verify/src/index.mjs"],
      "@shesha/mcp": ["packages/mcp/src/index.mjs"],
      "@shesha/precedent": ["packages/precedent/src/index.mjs"]
    },
    "types": ["node"]
  },
  "include": ["packages/*/src/**/*.mjs", "packages/*/bin/**/*.mjs", "packages/*/tools/**/*.mjs", "packages/*/test/**/*.mjs", ".claude/hooks/**/*.mjs"]
}
```

Three decisions baked into that file, each with a DECISIONS row:

1. `noUncheckedIndexedAccess` is **off** (D-024). `strict` without it is still a real gate; turning it on across ~200 tree-walking modules is multi-day work and is `BACKLOG` item **BL-010**. `g-workspace-hygiene` fails if `tsconfig.json` lacks `"strict": true`, or if it contains `noUncheckedIndexedAccess`, or if `module`/`moduleResolution` is anything but `nodenext`.
2. **No `import` of a `.json` file anywhere in `packages/**` or `.claude/hooks/**`** (D-025). Every JSON read goes through `readJsonGuarded` (§1.6), which is required anyway by D-006 and makes the registry hot-swappable in tests. `resolveJsonModule` is therefore absent. `g-workspace-hygiene` fails on any `from ['"][^'"]*\.json['"]` in a scanned file.
3. Cross-package types resolve through root `paths`, not through an `exports` `types` condition — one place, no per-package duplication.

No build step, no transpile. Types are JSDoc checked by `checkJs`. This satisfies the model-agnostic constraint literally: every program in `packages/**` is runnable by `node <file>` with no toolchain (strategy doc §3 Option C).

**Per-package manifests.** Five files, same shape. `packages/sfs/package.json`:

```json
{
  "name": "@shesha/sfs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "exports": { ".": "./src/index.mjs", "./schema": "./schema/sfs.schema.json" },
  "bin": { "sfs": "./bin/sfs.mjs" },
  "scripts": { "test": "node --test test/" },
  "dependencies": { "@shesha/registry": "*", "ajv": "8.17.1", "ajv-formats": "3.0.1" }
}
```

| Package | name | dependencies | Notes |
|---|---|---|---|
| `packages/registry` | `@shesha/registry` | none | Data, lookups, **and `src/coverage.mjs`** (the single implementation). Zero runtime deps so anything may import it |
| `packages/verify` | `@shesha/verify` | `@shesha/registry`, `@shesha/sfs`, `ajv` 8.17.1, `ajv-formats` 3.0.1; `playwright` 1.55.0 as **devDependency** | Browser install is an operator step: `npx playwright install chromium` (no `--with-deps`; that flag is Linux-only). T4 is `uninspectable` when the browser is absent |
| `packages/mcp` | `@shesha/mcp` | `@shesha/sfs`, `@shesha/verify`, `@shesha/registry`, `@modelcontextprotocol/sdk` (exact pin) | `bin: { "shesha-mcp": "./bin/server.mjs" }` |
| `packages/precedent` | `@shesha/precedent` | none | Scaffold: manifest, `src/index.mjs` throwing `E_NOT_IMPLEMENTED`, one test asserting that |

**Wiring rules, all enforced by `g-workspace-hygiene`:**

1. Cross-package deps use `"*"`. `npm ci` at the root is the only install command. The gate fails if any `packages/*/package.json` is missing from the root `workspaces` glob, if any non-`@shesha/*` dependency version is a range (`^`, `~`, `>=`, `*`), or if `package-lock.json` is absent or `npm ci --dry-run` exits non-zero.
2. `"private": true` on all five. Flipping it requires a new DECISIONS row.
3. Dependency direction is acyclic and one-way: `registry` <- `sfs` <- `verify` <- `mcp`. The gate fails on any import reversing an arrow. **`packages/sfs` may not import `packages/verify`** — a compiler that calls its own verifier cannot be audited by it.
4. `plugins/**` contains **no `package.json`**, no `node_modules`, no `scripts/` directory under `plugins/*/skills/*/`. [`g-skill-purity`]
5. `.claude/hooks/*.mjs` import from `packages/**` by relative path only and have zero external deps, so a hook cannot fail because `npm ci` was skipped.

**`/.gitignore`** — write exactly these lines, no others:

```
node_modules/
/.build/
/runs/
*.tmp
.sfs-cache/
.claude/settings.local.json
.claude/hooks.jsonl
.vscode/
packages/sfs/reports/
packages/precedent/data/
packages/precedent/models/
```

`packages/verify/evidence/` is **not** ignored — it is the commit-body evidence (§1.5). `g-no-secrets-or-scratch` fails on: any tracked path matching an ignore line; any untracked file under `packages/**`, `plugins/**`, `.claude/hooks/**`, or the repo root. Its two mandatory mutations: (a) create `.build/x` → the gate still passes, proving the ignore works; (b) create untracked `packages/sfs/src/scratch.mjs` → the gate fails.

---

### 1.4 `/DECISIONS.md` — the one registry

**One registry.** `/DECISIONS.md` is the only place a decision is recorded. `packages/sfs/registry/decisions.json` is **generated** from it by `node packages/registry/src/gen-decisions.mjs`; `g-decisions` regenerates and asserts byte equality with the committed file (D-029). There is no `OPEN-QUESTIONS.md`: compiler gaps and SFS promotions are rows in `/BACKLOG.md` with ids `GAP-0NN` and `PROM-0NN`; regenerated reports live in `packages/sfs/reports/` (gitignored).

**Format.** One table. Append-only: superseding adds a new row and edits only the old row's `Status` to `superseded-by-D-0NN`. A superseded row is moved to `docs/decisions-archive.md` by `gen-decisions.mjs --archive` once the superseding row is committed, so the registry stays under its 24576-byte cap. Columns, all eight mandatory, pipe-delimited:

```
| ID | Date | Status | Decision | Why | Consequence | Enforced by | Confirmation |
```

- **ID** — `D-0NN`, zero-padded, sequential with no gaps, never reused.
- **Status** — `decided` | `superseded-by-D-0NN` | `pending-probe`.
- **Decision** — imperative, one sentence. States what is true, not what is preferred.
- **Why** — a strategy-doc citation (`§1.2#2`) or a probe id. No narrative.
- **Consequence** — what becomes impossible or required.
- **Enforced by** — a comma-separated list of one or more entries, each in exactly one of five forms.
- **Confirmation** — `n/a`, or `probe:<name>` with a recorded result at `packages/registry/probes/results/<name>.json`, or `pending-probe` (which requires the probe script to exist and Status to be `pending-probe`).

**The five legal `Enforced by` forms.** `g-decisions` resolves each and hard-fails otherwise:

| Form | Resolution |
|---|---|
| `<gate-id>` | `packages/verify/src/gates/<gate-id>.mjs` exists and exports `id === <gate-id>` |
| `structural:<path>` | the path exists, and the violation is unrepresentable in it (e.g. the field is absent from a schema) |
| `hook:<path>` | the path exists under `.claude/hooks/` or `.githooks/` and is referenced by `.claude/settings.json` or `core.hooksPath` |
| `check:<tier-module>:<check-id>` | `import('../<tier-module>.mjs')` succeeds and `<check-id>` appears in its exported `checks[]` registry |
| `pending:<id>` | `<id>` is a WP id in `packages/verify/config/wp-table.json` **or** a row id in `/BACKLOG.md`, **and** — for a WP id — `BUILD-LOG.md` contains no `^## <id> — ` block. A `pending:` entry whose WP is recorded complete is a **hard failure** |

`pending:` is the `g-quarantine` ratchet (D-044) applied to decisions: a rule whose enforcer does not exist yet is registered, counted, and forced to become real in the WP that creates its subject. **Stub gates are illegal** — `g-gate-contract` requires >= 2 verdict-flipping mutations, which no no-op can satisfy.

`g-decisions` additionally hard-fails on: a row with != 8 cells; a non-sequential or duplicate ID; a Status outside the three legal values; a `pending-probe` row whose probe script is missing; any prose outside the table other than the two `##` headings this file may have (`## Decisions`, `## No theatre`); a mismatch between the regenerated and committed `decisions.json`; a `pending:` count that differs from `packages/verify/config/pending-budget.json`'s `max` (which only ratchets down — `g-no-gate-tampering` fails any commit that raises it).

**Backend-absent rule for the empirical rows.** Eight decisions (D-030..D-037) answer questions a 30-minute probe against a live backend would settle permanently (strategy doc §9 q5). A backend may not be available. Therefore each is **decided now with a stated value**, the compiler emits that value, a named T2/T3 check hard-fails the losing shape, Status is `pending-probe`, and a probe script is committed that exits 3 `uninspectable` when no backend is reachable. When the probe runs it either confirms (Status → `decided`, Confirmation → `probe:<name>`) or produces a superseding row. The question is never open, and no gate softens when the backend is absent.

**No `g-t2-*` gates exist.** The six empirical rules are implemented **once**, as checks inside the tier modules (Section 3), and D-030..D-037 point at them with `check:` once WP-3a lands. Two programs asserting one rule is the drift generator this rebuild removes.

#### Seed set — write all 37 rows in WP-0

`Enforced by` is given in full; `Why` and `Consequence` cells are written from the cited strategy-doc row. **20 rows carry a `pending:` entry at WP-0; `pending-budget.json` `max` is 20.**

| ID | Decision | Why | Enforced by |
|---|---|---|---|
| D-001 | Adopt compiler-first re-architecture on the PR #39 base (Option C); reject prose iteration and clean-sheet rebuild | §3 | `g-disposition` |
| D-002 | The toolchain lives in this repo as npm workspace packages under `packages/`; `packages/sfs` is the language + compiler | §9 q4 | `g-workspace-hygiene`, `g-skill-purity` |
| D-003 | The compiler is the only writer of form markup; direct writes are blocked, not discouraged | §4 L4 | `pending:WP-8` |
| D-004 | The registry is generated from a pinned `shesha-io/shesha-framework` `releases/0.45` commit SHA in `_meta.json`; `shesha-framework` is never modified | §4 L0 | `g-registry-provenance` |
| D-005 | Coverage accounting exists once, in `packages/registry/src/coverage.mjs`; family sets are module constants declared up front; `walkComponents` lives once, in `packages/verify/src/walk.mjs` | §1.4 | `g-coverage-single-impl` |
| D-006 | Zero coverage is a hard fail: `walked === 0` fails; `walked > 0 && checked === 0` fails; any `uninspectable` yields exit 3 `partial` | §1.4 | `structural:packages/registry/src/coverage.mjs` |
| D-007 | Every gate exports `mutations[]` with >= 2 entries and `npm run gates:mutate` proves each flips the verdict | §5 | `g-gate-contract` |
| D-008 | A missing backend degrades to `uninspectable` + exit 3, never pass; exit codes are `0 pass / 1 fail / 2 usage / 3 partial`; the verdict union is exactly `{pass,fail,partial,notRun}` — there is no `warn` verdict | §1.4 | `pending:WP-3a` |
| D-009 | Contradictions are resolved by deleting the losing side, never by adding a note explaining which side wins | §1.2#2 | `g-prose-budget` |
| D-010 | `bake-overlays.mjs` is deleted; `$role:` tokens resolve at compile time, per run, per brand | §1.2 | `g-disposition`, `pending:WP-5` |
| D-011 | `validate-blocks.js` is deleted; its checks become T2 hard failures with exact matching | §1.4 | `g-disposition` |
| D-012 | `summarize.js` and both of its invocations are deleted; no documented command in the repo is unexecutable | §1.4 | `g-commands-executable` |
| D-013 | Raw seed JSON under `assets/examples/` is deleted only after decompilation into `packages/sfs/corpus/`; `raw:` escapes are counted and reported per compile | §5 | `g-disposition`, `pending:WP-5` |
| D-014 | Placement assertions are executable predicates over the compiled tree (T3), not English sentences judged by a model; the DOM probe covers emergent residue only | §4 L3 | `pending:WP-3b` |
| D-015 | T5 visual is advisory: `verdict.result` is computed from T1-T4 only and is byte-identical whether T5 reports the best or worst score vector; no actor may downgrade a result from a T5 finding | §4 L3 | `pending:WP-3d` |
| D-016 | The judge never sees the builder's self-report or reasoning; the Evaluator has no `Bash` tool and its reads of `runs/*/logs/**` are denied by hook rule while an evaluator lock is held | §4 L3 | `pending:WP-8` |
| D-017 | Fan out across screens only; never run parallel agents within one form. Fan-out discipline is a declared-write-glob partition per WP, not a ban on co-locating directories in one commit | §4 L4 | `pending:WP-8` |
| D-018 | Styling is a compile-time concern; there is no separate styling pass and no styling sub-skill invocation | §1.2#5 | `pending:WP-7` |
| D-019 | Literal hex colours are banned in recipes, SFS, and compiler input; compiler *output* carries resolved colours, each with a `resolvedFrom: "$role:<name>"` provenance entry | §1.2#13 | `pending:WP-5` |
| D-020 | Branch `claude/sfs-rebuild`; one commit per work package; the numeric record of a commit is `packages/verify/evidence/<WP>.json`, written by the gate runner and never typed by the author | §1.4, §5 | `hook:.githooks/commit-msg`, `g-commit-format` |
| D-021 | Compilation is deterministic: no clock, no randomness; ids are `uuidv5(NS, "<module>/<form>\|<path>")` | §4 L2 | `pending:WP-5` |
| D-022 | Ambiguity in headless mode is resolved by an archetype default recorded in `plan.json`, never by asking the user and never by silently picking | §1.2#12 | `pending:WP-8` |
| D-023 | No TypeScript build step; types are JSDoc checked by `tsc --noEmit` with `checkJs` + `strict` | model-agnostic constraint | `g-workspace-hygiene` |
| D-024 | `noUncheckedIndexedAccess` is off; re-enabling it is `BACKLOG` BL-010 | measured cost over ~200 tree-walking modules exceeds one session | `g-workspace-hygiene` |
| D-025 | No `import` of a `.json` file in `packages/**` or `.claude/hooks/**`; all JSON is read at runtime through `readJsonGuarded` | D-006 requires guarded reads; import attributes also constrain `module` resolution | `g-workspace-hygiene` |
| D-026 | `npm run green` splits into `green:quick` (typecheck+gates), `green:fast` (+tests, used by pre-commit), and `green` (+mutations, used by CI and `prove`); the mutation suite must finish in <= 180 s | a gate slow enough to be bypassed with `--no-verify` is not a gate | `g-githook-contract`, `mutation-meta.test.mjs` budget assertion |
| D-027 | `test.todo(` is legal in exactly one place: files under `packages/sfs/test/fixtures/gaps/` or matching `*.gap.test.mjs`, whose todo name starts with a `GAP-0NN` id present in `/BACKLOG.md`. Everywhere else it is a hard failure | §5.5 B4 requires a visible failing fixture per compiler gap | `g-no-gate-tampering` |
| D-028 | Fifteen banned behaviours are recorded as one line each (`behaviour -> gate id`) in DECISIONS.md `## No theatre`; all evidence prose lives in `docs/rebuild-brief/evidence.md`, which nothing instructs anyone to read | prose whose only function is to explain a fixed defect is T10 | `g-prose-budget` (DECISIONS.md is in its scan set) |
| D-029 | `packages/sfs/registry/decisions.json` is generated from DECISIONS.md and byte-compared by the gate; there is no second decision registry and no `OPEN-QUESTIONS.md` | two registries with two id namespaces drift | `g-decisions` |

**The eight empirical rows (D-030..D-037).** Status `pending-probe`; `Enforced by` is `pending:WP-3a` at WP-0 and is rewritten to the `check:` form in the WP-3a commit — `g-decisions` forces that rewrite by hard-failing a `pending:WP-3a` row once WP-3a is in `BUILD-LOG.md`.

| ID | Decision | Why (§1.2 row) | WP-3a `Enforced by` | Confirmation |
|---|---|---|---|---|
| D-030 | `referenceListId` is always `{ module: "<Module>", name: "<BareListName>" }`. A module prefix inside `name` is illegal everywhere | #1 three-way split; documented failure is `ConfigurationLoadingError` blocking the whole form | `check:t2-registry:T2.05`, `structural:packages/sfs/src/resolve/reflist.mjs` | `pending-probe` → `probe:reflist-name-format` |
| D-031 | `refListStatus` carries `referenceListId: {module,name}` and nothing else; flat `module` / `referenceListName` keys hard-fail | #2 settled in one file while the routed-to file still shipped the flat keys with a warning not to correct it | `check:t2-registry:T2.05` | `pending-probe` → `probe:reflist-status-shape` |
| D-032 | `editMode` is emitted **only at form level**, derived from `kind`: `list`/`details` → `readOnly`, `create`/`edit` → `editable`. No component carries `editMode`; SFS has no component-level field for it | #7 three answers to one question | `check:t2-registry:T2.12`, `structural:packages/sfs/schema/sfs.schema.json` | `pending-probe` → `probe:editmode-create-edit` |
| D-033 | The single legal `formArguments` hydration hook is `onAfterDataLoad`; `onDataLoaded` is illegal in compiler output. A `formSettings` key listed `forbidden` for a kind fails **only when present with a non-null value**, so the base block's `onBeforeDataLoad: null` is legal and a submit pipeline on a `list` form is not | #8 three files, three hooks; `debug.md:49` records the observed `onDataLoaded` modal failure and observation outranks prose | `check:t2-registry:T2.20` | `pending-probe` → `probe:form-arguments-hook` |
| D-034 | `actionOwner` is lowercase dotted (`shesha.common`) or a compiler-resolved component id; `actionName` is the spaced form (`"Show Dialog"`). `"Shesha.Common"` / `"ExecuteScript"` are illegal. SFS never names an owner — the compiler derives the pair from the intent verb via `action-owners.json` | #9 `actions.md:83` shipped exactly the strings `debug.md:21` blames for silent no-op buttons | `check:t2-registry:T2.13`, `structural:packages/sfs/src/resolve/actions.mjs` | `pending-probe` → `probe:action-owner-casing` |
| D-035 | The `columns` component is banned unconditionally in SFS, recipes, corpus and compiler output; multi-column layout is a flex `container` row sized by `desktop.dimensions.width` | #4 banned in five places, mandated in a sixth 52 lines earlier, present in 7 seeds | `check:t2-registry:T2.06` | `pending-probe` → `probe:columns-alternative` |
| D-036 | Entity metadata is read from `Get` and unwrapped as `result.properties[]`; paths are PascalCase in metadata and camelCased by the compiler when emitted as `propertyName` | #10 wrong casing renders every cell blank | `check:t3-semantic:T3.02` | `pending-probe` → `probe:metadata-endpoint` |
| D-037 | Component versions, prop names and enum domains come from `packages/registry` only; no version integer or prop name appears in any instruction file | #11 `collapsiblePanel` documented `8`/`accent`/`isDefaultExpanded` vs reality `9`/`accentStyle`/`collapsedByDefault` with inverted polarity | `g-prose-budget`, `check:t2-registry:T2.02` | `n/a` |

---

### 1.5 Git discipline for one long session

**Branch.** `git checkout -b claude/sfs-rebuild` from `claude/team-standup-4e3e21` (v1.8.4, PR #39). No commits to the base branch. No rebase, squash, or force-push — the per-WP history is the evidence each WP was independently green.

**Install the hooks first, in WP-0, before the first commit:** `npm run hooks:install`.

**`/.githooks/pre-commit`** — commit exactly, mode 100755:

```bash
#!/usr/bin/env bash
set -euo pipefail
npm run green:fast
node packages/verify/src/write-evidence.mjs        # writes packages/verify/evidence/<WP>.json
git add packages/verify/evidence
node packages/verify/src/gates/g-no-secrets-or-scratch.mjs
if git diff --cached --name-only | grep -qx '\.claude/settings\.local\.json'; then
  echo "pre-commit: REFUSED - .claude/settings.local.json is staged" >&2; exit 1
fi
if git diff --cached --name-only | grep -q '^plugins/'; then
  if ! git diff --cached --name-only | grep -qx 'plugins/shesha-developer/\.claude-plugin/plugin\.json'; then
    echo "pre-commit: REFUSED - plugins/** changed without a plugin.json version bump" >&2; exit 1
  fi
fi
```

**`/.githooks/commit-msg`** — commit exactly, mode 100755. Git passes the message file as `$1` to `commit-msg` and **passes nothing to `pre-commit`**, which is why the format gate lives here:

```bash
#!/usr/bin/env bash
set -euo pipefail
node packages/verify/src/gates/g-commit-format.mjs --message-file "$1"
```

`g-githook-contract` (WP-0 gate) hard-fails unless: both hook files exist with git mode `100755`; `git config core.hooksPath` == `.githooks`; `commit-msg` contains `--message-file "$1"`; **no file under `.githooks/` mentions `COMMIT_EDITMSG`** (at pre-commit time that file holds the *previous* message); and `node packages/verify/src/gates/g-commit-format.mjs` invoked with no `--message-file` exits **2** (usage), never 0.

**`write-evidence.mjs`** reads `currentWp` from `.build/state.json` (Section 5 §5.3) and writes `packages/verify/evidence/<WP-id>.json`:

```json
{ "wp": "WP-0", "gitSha": "<git rev-parse HEAD>", "at": "<ISO>", "verdict": "pass",
  "tests": 0, "gates": 0, "mutations": 0, "greenSeconds": 0,
  "perGateCoverage": { "g-decisions": { "walked": 0, "checked": 0, "uninspectable": 0 } },
  "exitCodes": { "typecheck": 0, "test": 0, "gates": 0 } }
```

It exits 1 with `EVID-0001 no current WP` when `.build/state.json` is absent. **No number in a commit body is typed by a human or a model.**

**Commit cadence.** Exactly one commit per completed work package. Banned: a commit spanning two WPs; a commit leaving `npm run green:fast` non-zero; a "WIP" commit; a one-line body. A WP too large to commit is split into WP-N.a / WP-N.b **in Section 5's WP table and `wp-table.json` first**, then committed as two.

**Commit message template** — `g-commit-format` enforces every line:

```
[type]- WP-NN <imperative summary, <= 62 chars after the WP id>

Why: <1-2 lines. The decision or gap this closes.>
Evidence: packages/verify/evidence/WP-NN.json
Decisions: D-0NN[, D-0NN ...] | none
Deletes: <path>[, <path> ...] | none
Plugin: <old> -> <new> | unchanged (packages-only)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

`g-commit-format` hard-fails on: a `type` outside `feature|fix|chore`; a missing `WP-NN`; a subject over 62 characters after the id; any of the six body keys missing; an `Evidence:` path whose WP id differs from the subject's, or which is absent from the git index, or whose `gitSha` != `git rev-parse HEAD`, or whose `verdict` != `pass`, or whose `at` is more than 900 seconds old; a `Decisions:` id absent from DECISIONS.md; a `Deletes:` path that still exists or has no `disposition.json` row for this WP; a `Plugin:` claim disagreeing with the staged diff of `plugin.json`.

**What must be green before every commit,** in this order — `npm run green:fast` runs 1-3:

1. `npm run typecheck` → 0.
2. `npm test` → 0, test count **>= the previous commit's count** (read from the previous evidence file). A reduction requires a DECISIONS row whose Decision begins `Test removal:`. [`g-test-ratchet`]
3. `npm run gates` → 0, gate count **>= the previous commit's count**, counting only gates whose declared `inputPaths[]` all exist and are non-empty. [`g-gate-ratchet`]
4. `git status --porcelain` empty except staged files. [`g-no-secrets-or-scratch`]
5. `node packages/sfs/bin/sfs.mjs --version` runs — proves the single entrypoint starts, the class of defect that shipped `summarize.js`. From WP-5 onward this is a `g-commands-executable` pointer.

**The gate-tampering rule.** A failing gate is never committed disabled, skipped, widened, or downgraded. Concretely banned in any staged diff: adding an entry to a skip/allow/exempt list; raising a numeric threshold or a waived cap; changing a `fail` to a `warn`; adding `.skip(`, `--test-skip-pattern`, `t.skip`, `process.exitCode = 0`, `|| true`, a `continue` past a recorded failure, a `catch {}` around an assertion; deleting a test; adding `// @ts-ignore`, `// eslint-disable`, or `/* istanbul ignore */`.

`.todo(` is banned by the same rule **with exactly one carve-out (D-027):** `test.todo(` is permitted in a file under `packages/sfs/test/fixtures/gaps/` or matching `*.gap.test.mjs`, when the todo's name matches `^GAP-[0-9]{3}` and that id is a row in `/BACKLOG.md`. `g-no-gate-tampering` ships a mutation for each side: a `.todo(` outside the carve-out fails; a carve-out `.todo(` whose id is not in `BACKLOG.md` fails.

The gate diffs the staged tree against the merge-base and fails on any banned pattern **unless** the body's `Decisions:` line cites a row whose Decision begins `Threshold change:` or `Test removal:`. That row is a permanent public record. There is no other route. If a gate is wrong, fix the gate and its mutation test in the same commit — a `[fix]` WP with its own row, not a silencing.

**Push cadence.** Push after every WP commit. Version bump per §1.1: minor when the commit creates a new skill folder, patch otherwise, unchanged when the commit touches only `packages/**`. The **final version is a discovered value, not a target**: `g-plugin-version` reads `git log -p` of `plugin.json` on the branch and fails unless the version strictly increases on every commit touching `plugins/**` and the minor component is incremented **exactly once** across the branch. No document states a terminal version number.

---

### 1.6 The gate contract (WP-0 deliverable — every later WP depends on it)

**`packages/registry/src/coverage.mjs`** — the single implementation. `packages/verify/src/coverage.mjs` and `packages/sfs/src/lib/coverage.mjs` each contain exactly one non-comment line: `export * from '@shesha/registry/coverage';`. `walkComponents` is **not** here — it is registry-data-driven and lives once in `packages/verify/src/walk.mjs`, exempt from the re-export rule and covered by `g-coverage-single-impl`'s separate "exactly one file defines `function walkComponents`" assertion.

```js
export const EXIT = { pass: 0, fail: 1, usage: 2, partial: 3 };
export class CoverageArithmeticError extends Error {}
export class UndeclaredFamilyError extends Error {}

/** @typedef {{name:string, required:boolean, expectEmpty?:boolean, decision?:string,
 *             walked:number, checked:number,
 *             failures:{where:string,reason:string,code:string}[],
 *             uninspectable:{where:string,reason:string}[]}} Family */

/** Declare the complete family set up front. Families cannot be created later. */
export function families(/** @type {{name:string, required?:boolean, expectEmpty?:boolean, decision?:string}[]} */ decls) {}

/** Ordered verdict rules. The verdict union is exactly {pass,fail,partial,notRun}. */
export function verdictOf(/** @type {Family[]} */ fams) {
  // 1. any family with failures.length                   -> 'fail'
  // 2. any required family with walked === 0              -> 'fail'  ('zero coverage')
  // 3. any expectEmpty family with walked > 0             -> 'fail'  ('deleted population returned')
  // 4. any family with walked > 0 && checked === 0        -> 'fail'  ('walked but never checked')
  // 5. any family with uninspectable.length               -> 'partial'
  // 6. otherwise                                          -> 'pass'
}

export function reconcile(/** @type {Family} */ f) {}       // throws CoverageArithmeticError
export function zeroCoverageReasons(/** @type {Family[]} */ fams) {}
export function report(fams, /** @type {{json?:boolean}} */ opts) {}
export function exitFor(/** @type {'pass'|'fail'|'partial'|'notRun'} */ verdict) {}
/** Every JSON read goes through this. A parse error is a domain failure, never a stack trace. */
export function readJsonGuarded(path, fam, where) {}
/** Wraps a check so any throw becomes a family failure with a domain code. */
export function runGuarded(fam, where, fn) {}
```

`expectEmpty` closes the vanishing-family hole for populations this rebuild deliberately destroys: a family may be declared `{expectEmpty: true, decision: "D-0NN"}`, in which case `walked > 0` is the failure and `walked === 0` passes. It still always prints.

**Every gate** is one file `packages/verify/src/gates/g-<name>.mjs`, standalone-runnable, exporting:

```js
export const id = 'g-prose-budget';
export const describe = 'SKILL.md caps, tierA cardinality, reference depth, archaeology, hygiene';
export const inputPaths = ['packages/verify/config/prose-budget.json', 'plugins', 'CLAUDE.md', 'DECISIONS.md'];
/** @returns {Promise<Family[]>} */
export async function run(/** @type {{repoRoot:string}} */ ctx) {}
/** Each mutation must flip the verdict. This is the proof the gate works. */
export const mutations = [
  { name: 'oversize tierA SKILL.md', kind: 'file', apply: async (tmp) => {}, expect: 'fail' },
  { name: 'tierA folder renamed without config update', kind: 'repo', apply: async (tmp) => {}, expect: 'fail' },
];
```

`packages/verify/src/run-gates.mjs` discovers every `g-*.mjs`, runs each, prints one line per family, and exits with the worst verdict. **A gate whose `mutations` array has fewer than 2 entries fails `g-gate-contract`.**

**Mutation harness protocol** (`packages/verify/test/mutation-meta.test.mjs`) — specified numerically, because an unaffordable harness gets bypassed with `--no-verify`:

1. Per mutation, create a temp dir and copy **only the paths the mutation's gate declares in `inputPaths[]`**, resolved through `git ls-files` (tracked files only). Never copy the repository.
2. Junction-link the root `node_modules` into the temp root: `fs.symlinkSync(root+'/node_modules', tmp+'/node_modules', 'junction')`. `'junction'` is required on Windows; `'dir'` fails without admin.
3. Never copy `node_modules/`, `.git/`, `.build/`, `runs/`, `packages/sfs/corpus/`.
4. Apply the mutation, re-run that gate in the temp dir, assert the verdict equals `expect` and that `expect` is `fail` or `partial` — a mutation expecting `pass` is a contract violation.
5. Print, as the final line, `mutations=<n> seconds=<s>`. The suite **fails if `s > 180`**.

**WP-0's gate set — 14 gates here, plus the 3 session-state gates Section 5 owns (`g-quarantine`, `g-build-state`, `g-backlog`) = 17, each with >= 2 mutations.** A gate lands in the work package that creates its subject; WP-0 ships only gates whose subject exists at WP-0:

`g-decisions` · `g-prose-budget` · `g-skill-purity` · `g-workspace-hygiene` · `g-commit-format` · `g-githook-contract` · `g-gate-contract` · `g-coverage-single-impl` · `g-no-gate-tampering` · `g-plugin-version` · `g-no-secrets-or-scratch` · `g-commands-executable` · `g-registry-provenance` · `g-check-references` (the moved gate, its lazy-family hole closed per D-005, its existing negative test as `g-check-references.mutation.test.mjs`).

Every other gate named anywhere in this brief is registered in `packages/verify/config/gate-owner.json` as `{gate, wp}` and is the acceptance criterion of that WP. `g-gate-ratchet` counts only gates whose `inputPaths[]` all exist and are non-empty, so a gate cannot be created early to inflate the count.

**`g-prose-budget` config** — `packages/verify/config/prose-budget.json`, written in WP-0:

```json
{
  "tierA": {
    "paths": ["plugins/shesha-developer/skills/shesha-claude-designer",
              "plugins/shesha-developer/skills/shesha-design-comprehension",
              "plugins/shesha-developer/skills/shesha-design-system"],
    "expectedCount": 3,
    "cap": { "lines": 500, "bytes": 8192 }
  },
  "tierB": { "globs": ["plugins/shesha-developer/skills/*", "plugins/framework-dev/skills/*"],
             "cap": { "lines": 500, "bytes": 24576 } },
  "files": { "CLAUDE.md": { "lines": 250, "bytes": 12288 },
             "DECISIONS.md": { "lines": 400, "bytes": 24576 },
             "BACKLOG.md": { "lines": 200, "bytes": 8192 } },
  "skip": ["plugins/shesha-developer-0-43/**", "docs/**"],
  "waivers": []
}
```

The gate hard-fails if the count of **existing** folders in `tierA.paths` != `tierA.expectedCount`. WP-7 updates `paths` and `expectedCount` to 4 in the same commit as the `shesha-claude-designer` → `shesha-designer` rename and the `shesha-spec` creation; a rename that skips the config fails the cardinality check. `waivers` are populated by `--baseline` from measured sizes (currently 16462 B for `shesha-claude-designer/SKILL.md`, 9849 B for `shesha-design-comprehension/SKILL.md`, 46926 B for `shesha-form-edit/SKILL.md`); each carries `path`, `cap`, `until` (a WP id), `decision`. The gate fails if a waived file exceeds its cap, or if `until`'s WP is recorded complete in `BUILD-LOG.md` and the path still exists. Caps only ratchet down.

**`g-commands-executable`** is the direct answer to the `summarize.js` class (T1, D-012). It scans `CLAUDE.md`, `DECISIONS.md`, `BACKLOG.md` and every `.md` under `plugins/**` — never `docs/**` (D-043) — and extracts three command forms, resolving each:

| Form | Resolution |
|---|---|
| `node <path>` | `<path>` exists and `node --check <path>` exits 0 |
| `npm run <script>[ -- ...]` | `<script>` exists in the nearest `package.json`; its target file exists and `node --check`s |
| `mcp__<server>__<tool>` | `<tool>` appears in `<server>`'s exported tool list (`packages/mcp/src/tools.mjs`) |

The family is `required` with a floor read from `packages/verify/config/command-floor.json`, initialised from the measured count at WP-0 and ratcheted upward by the gate itself. Three mandatory mutations, one per form. This keeps the gate populated after WP-7 replaces `node <path>` lines with `npm run sfs --` and MCP tool names.

---

### 1.7 The `## No theatre` section of `/DECISIONS.md`

Fifteen banned behaviours, one line each, `behaviour -> enforcer`. Total <= 1536 bytes. **All evidence prose lives in `docs/rebuild-brief/evidence.md`**, which is outside every gate's scan set and which no instruction file tells anyone to read (D-028). A behaviour that has to be read is not enforced; the enforcer on each line is the enforcement. Committing any of these is a revert.

```
T1  Shipping a script that cannot execute -> g-commands-executable
T2  A gate that warns where the docs say it fails -> g-gate-contract (mutations flip verdicts, not warning counts)
T3  A program that writes despite declaring it refuses to -> D-010, pending:WP-5 (g-no-literal-hex), g-exit-codes
T4  A pass with zero coverage -> structural:packages/registry/src/coverage.mjs (D-006)
T5  Claiming coverage of territory never visited -> g-coverage-single-impl + walk.mjs tests over items/columns/tabs
T6  Lazily-created report families that can vanish -> families() declared up front (D-005) + expectEmpty
T7  A gate wired into nothing -> g-gate-ratchet (inputPaths must exist and be non-empty) + g-test-ratchet
T8  A documented MUST-strength gate that ships no code -> g-commands-executable + D-002
T9  Resolving a contradiction by annotating it -> D-009 + g-prose-budget
T10 Changelog archaeology in an instruction file -> g-prose-budget archaeology patterns
T11 A prose rule with no enforcing program -> g-decisions (every row names a live or pending: enforcer)
T12 An unreproducible generated asset -> g-registry-provenance (pinned remote ref; no [A-Za-z]:/ path)
T13 Feeding the builder's self-report to the judge -> D-016, pending:WP-8
T14 Fuzzy matchers with escape hatches that downgrade failures -> g-no-gate-tampering + exact registry matching
T15 Presenting an unmeasurable quantity as a measurement -> D-014, pending:WP-3b; unseeable is uninspectable
```

The meta-rule, stated once: a green signal with no coverage is worse than no signal, because it consumes the review budget that would otherwise go to reading the artifact. Any gate that cannot state its `walked / checked / uninspectable` numbers is deleted in the commit that discovers it.

---

### 1.8 Order of operations inside WP-0

1. `git checkout -b claude/sfs-rebuild`.
2. Write `/package.json`, `/tsconfig.json`, `/.gitignore` (§1.3, all three verbatim). `npm install` once to generate `package-lock.json`; `npm ci` thereafter.
3. Create the five package skeletons with their manifests and one passing test each, so `npm test` is meaningful from commit one.
4. Write `packages/registry/src/coverage.mjs`, `packages/verify/src/{coverage.mjs,walk.mjs,run-gates.mjs,write-evidence.mjs}`, `packages/sfs/src/lib/coverage.mjs`, and `packages/verify/test/mutation-meta.test.mjs`.
5. Write `packages/verify/config/{prose-budget,disposition,wp-table,gate-owner,command-floor,pending-budget}.json`, then the 14 gates of §1.6, each with >= 2 mutations.
6. Run `node packages/verify/src/gates/g-prose-budget.mjs --baseline` to populate `waivers` from measured sizes.
7. `git mv` the kept assets to the `to` cells of `disposition.json`. Port `layout-probe.js` to ESM in the same step.
8. Execute the WP-0 deletions in `disposition.json`: `summarize.js` + both invocations (D-012); `validate-blocks.js` (D-011); `shesha-design-comprehension/{package.json,scripts/}`; `shesha-claude-designer/README.md`; the archaeology prose in `shesha-form-edit/SKILL.md` (T10); the losing side of the eight contradictions in the reference files (D-030..D-037 + D-009 — delete, never annotate).
9. Write `/DECISIONS.md` (37 rows + the 15-line `## No theatre` block), `docs/rebuild-brief/evidence.md` (all evidence prose), `/BACKLOG.md` (with `BL-010` for `noUncheckedIndexedAccess`), and the eight probe scripts under `packages/registry/probes/` (each exits 3 `uninspectable` with a reason when no backend is reachable — D-008). Run `node packages/registry/src/gen-decisions.mjs`.
10. Write `/CLAUDE.md` from §1.1 verbatim; `/.githooks/pre-commit` and `/.githooks/commit-msg` from §1.5; `chmod +x` both; `npm run hooks:install`.
11. Write `.github/workflows/ci.yml` (`npm ci && npm run green`, Node 22, ubuntu) and `registry.yml` (regeneration from the pinned SHA in `_meta.json`).
12. Write the first `/BUILD-LOG.md` block for WP-0 and `.build/state.json` with `currentWp: "WP-0"`.
13. Run §1.9. Commit as WP-0. Push. `plugin.json` → 1.8.5 (step 8 touched `plugins/**`).

---

### 1.9 Acceptance criteria for WP-0

Run this block. Every line's expected output is given. A `<>` value is discovered and recorded by the command itself, not asserted against a literal.

```bash
npm ci && npm run green                     # exit 0; last line of gates:mutate: mutations=<n> seconds=<s>, s<=180
npm run typecheck                           # exit 0; prints "errors 0" over the 5 skeletons + 14 gates
node packages/verify/src/run-gates.mjs --count            # 17
node packages/verify/src/gates/g-gate-contract.mjs        # exit 0; "gates 17 · min mutations 2 · gates below 2: 0"
node packages/verify/src/gates/g-decisions.mjs            # exit 0; "rows 37 · cells 8/8 · pending 20 · no-theatre 15 · decisions.json identical"
node packages/verify/src/gates/g-prose-budget.mjs         # exit 0; "tierA matched 3/3 · over cap 0 · archaeology 0 · waivers <n>"
node packages/verify/src/gates/g-commands-executable.mjs  # exit 0; "node <a> · npm <b> · mcp <c> · unresolvable 0 · floor <a+b+c>"
node packages/verify/src/gates/g-registry-provenance.mjs  # exit 0; "machine-local paths 0 · pinned ref present"
node packages/verify/src/gates/g-workspace-hygiene.mjs    # exit 0; "packages 5 · cycles 0 · sfs->verify imports 0 · json imports 0 · ranged deps 0"
node packages/verify/src/gates/g-no-secrets-or-scratch.mjs # exit 0; "tracked-ignored 0 · untracked-scratch 0"
node packages/verify/src/gates/g-githook-contract.mjs     # exit 0; "hooksPath .githooks · pre-commit 100755 · commit-msg 100755 · COMMIT_EDITMSG refs 0"
node packages/verify/src/gates/g-commit-format.mjs        # exit 2; "usage: --message-file <path>"
node packages/verify/src/gates/g-disposition.mjs          # exit 0; "rows 15 · due-now 11 · satisfied 11 · early-deletions 0 · undeclared 0"
node packages/verify/src/gates/g-check-references.mjs     # exit 0; families all print walked>0 or expectEmpty
npm test 2>&1 | tail -1                     # exit 0; test count >= 15 (the moved verify-artifact suite)
node packages/sfs/bin/sfs.mjs --version     # exit 0; prints a semver
git status --porcelain | wc -l              # 0 after the commit
node -e "const v=require('./plugins/shesha-developer/.claude-plugin/plugin.json').version;if(v!=='1.8.5')process.exit(1)"   # exit 0
git log --oneline claude/team-standup-4e3e21..HEAD | wc -l   # 1
```

Two criteria are proved by planting a failure, not by a claim:

```bash
printf '\n%.0sx' {1..300} >> plugins/shesha-developer/skills/shesha-design-system/SKILL.md
git add -A && git commit -m "[chore]- WP-0 planted"   # expect exit 1 from pre-commit; then:
git reset && git checkout -- plugins/shesha-developer/skills/shesha-design-system/SKILL.md
printf '[chore]- WP-0 no body' > /tmp/m && node packages/verify/src/gates/g-commit-format.mjs --message-file /tmp/m   # exit 1
```

Both denials are recorded by the hook run itself in `packages/verify/evidence/WP-0.json` under `plantedDenials`. Neither is recorded as prose.

**If any line above does not produce its expected output, WP-0 is not done and no later work package may begin.** There is no partial WP-0. The three things WP-0 does **not** ship, because their subjects do not exist yet: any `g-t2-*` gate (there are none — the six empirical rules are single-implementation tier checks, §1.4); the tier modules; the `.claude/hooks/**` hooks. Their DECISIONS rows carry `pending:` and are ratcheted.
