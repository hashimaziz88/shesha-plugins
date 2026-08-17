## Section 5 — Single-session execution plan with gates, checkpoints and stop conditions

This section is the session's control program and the **only** part of the brief read at turn zero and after every context reset. Sections 1–4 say *what* to build; this section says *what is in scope, in what order, with what runnable proof, and when to stop*. Every rule here is a command the session runs, a file it writes, or a gate that fails.

**Authority:** strategy doc §6 (phase sequencing, go/no-go), §8 (falsification tests), §4/L4 (on parallel subagents), §1.4 (green without coverage), §1.7 (fifteen banned behaviours), §5 (disposition table). Cited inline as `[§x]`.

**DECISIONS ids reserved by this section: D-040 … D-058.** Section 1 uses D-001…D-037, Section 3 uses D-060…D-072. Do not renumber.

**The organising rule:** the riskiest claim is proven in the second work package, before the full compiler exists. The claim is "a model emits ~1 KB of intent and a program expands it to correct markup". Strategy doc Appendix B states there is **no published head-to-head** for it. WP-1 either produces agreement between two independently written programs on a real production form, or the session stops and reports.

---

### 5.0 Session preconditions

Run in order. Each is a command with an expected result. A failing hard precondition is stop condition **S0**: write nothing to the repo.

| # | Command | Expect | On failure |
|---|---|---|---|
| P1 | `node --version` | `v22.` or higher | **S0.** Install Node 22 [§1.3] |
| P2 | `git -C <repo> log --oneline -1` | `8a2d2f4 [chore]- Remove accidentally committed .tmp-negtest scratch file` | **S0.** `git fetch && git checkout claude/team-standup-4e3e21` |
| P3 | `git status --porcelain` | empty | Stash or commit first |
| P4 | `ls docs/rebuild-brief/*.md \| wc -l` | `>= 5`, including `50-session-plan.md` | **S0.** Copy the bundle in |
| P5 | `npm ping && npm view ajv@8.17.1 version` | `8.17.1` | **S0**, *unless* `test -d node_modules/ajv && test -f package-lock.json` both succeed — then record `BLOCKED.md` B7 "offline install", use `npm ci --offline` everywhere `npm ci` appears, and continue |
| P6 | `node packages/sfs/tools/measure-form.mjs plugins/shesha-developer/skills/shesha-form-edit/assets/examples/inline-editable-table.json` — after WP-0 writes that tool; before WP-0, `test -f <that path>` | exit 0 | **S0.** WP-1 has no target [§5.2 WP-1] |
| P7 | `node -e "fetch('https://github.com',{method:'HEAD'}).then(r=>console.log('net',r.status)).catch(()=>console.log('net none'))"` | either | Not a failure. `net none` changes WP-2a's provenance path only (§5.7 B3). Record in `BLOCKED.md` B3 |

Record all seven results in the first `BUILD-LOG.md` entry.

**There is no `bookings-table` artifact.** Strategy doc §1.1 decomposes it in prose; the JSON lived on a backend and is not in the tree. Every number derived from it (19,170 B, 8 defects, 12 components) is **baseline citation only** and is never an assertion target. WP-1's target is a named on-disk form (§5.2 WP-1). `g-no-gate-tampering` fails any test or gate that asserts a literal from that list.

---

### 5.1 Brief reconciliation — thirteen conflicts, resolved in WP-0

Resolve all thirteen in WP-0, write them into `/DECISIONS.md`, and treat the losing spelling as a typo everywhere it appears in Sections 1–4. D-009 applied to the brief itself: *delete the losing side, never annotate it.*

| # | Conflict | **Decision (binding)** | D-id |
|---|---|---|---|
| 1 | `bin/sfs.mjs` vs `bin/sfsc.mjs` | **`packages/sfs/bin/sfs.mjs`**, root script `npm run sfs -- <args>`. No alias, no shim | D-040 |
| 2 | Registry data location | **`packages/registry/data/0.45.1/{_meta,components,actions,enums,slots,limitations,formsettings,roles}.json`** plus `data/components-kb/**`, `capability-matrix.json`, `tokens/`, `action-owners.json`. `packages/sfs` reads it only through `@shesha/registry`'s export map | D-040 |
| 3 | Coverage library location | **All of §3.1.2 — `EXIT`, `families`, `verdictOf`, `report`, `exitFor`, `readJsonGuarded`, `runGuarded`, `reconcile`, `zeroCoverageReasons`, `CoverageArithmeticError`, `UndeclaredFamilyError` — is defined exactly once, in `packages/registry/src/coverage.mjs`** (zero dependencies, satisfies `registry <- sfs <- verify`). `packages/verify/src/coverage.mjs` and `packages/sfs/src/lib/coverage.mjs` each contain exactly one non-comment line: `export * from '@shesha/registry/coverage';`. **`walkComponents` is registry-data-driven and lives in `packages/verify/src/walk.mjs`; it is exempt from the re-export rule** and is covered instead by the single-definition assertion of §5.10 item 6 | D-041 |
| 4 | Fixture root | **`packages/sfs/test/fixtures/`**, exported as `"./test/fixtures/*"` | D-040 |
| 5 | Error catalogue | **`packages/sfs/src/errors/catalogue.json`**, beside `raise.mjs` | D-040 |
| 6 | Root `workspaces` | **`["packages/*"]`**. `plugins/**` contains no `package.json` after WP-0; `shesha-form-edit/package.json` is deleted in WP-0 and its script+test pairs move to `packages/verify` in the same commit | D-040 |
| 7 | The 15 `verify-artifact` tests | **`git mv` in WP-0, unchanged, all 15 passing after the move.** Any behaviour change to them is BL-003 | D-040 |
| 8 | Coverage authorship split | **WP-0 writes the whole of §3.1.2** in `packages/registry/src/coverage.mjs` with ≥ 14 tests. WP-3a adds `walk.mjs` and the unit-typed families, not a second copy | D-042 |
| 9 | Plugin version cadence | **Per commit touching `plugins/**`** (existing repo convention): minor for a new skill folder, patch otherwise, no bump for `packages/**`-only commits. **The end value is discovered, not asserted** — `g-plugin-version` requires the version to be strictly greater than its WP-0 value and the minor component to have been incremented **exactly once** across the session, computed from `git log -p -- plugins/shesha-developer/.claude-plugin/plugin.json` | D-040 |
| 10 | Where the brief lives | **`docs/rebuild-brief/`**, committed in WP-0. Outside `g-prose-budget`'s scope (skills + `CLAUDE.md`) and `g-commands-executable`'s scope (`plugins/**` + `packages/**`); inside `g-brief-budget`'s scope (§5.2 WP-0) | D-043 |
| 11 | Work-package ids | Section 3's `WP-3a`…`WP-3d` are kept verbatim. Execution order is §5.2's `Order` column. Out-of-scope WPs are BACKLOG rows and keep their ids | D-040 |
| 12 | Compiler depending on the verifier | The compiler imports `verdictOf` from `@shesha/registry/coverage` and **never** imports `packages/verify`. `g-workspace-hygiene` keeps that arrow | D-041 |
| 13 | **Compiled-artifact filenames** | Exactly four names, everywhere in Sections 2–5 and in every `$id`: markup envelope = **`<screen>.form.json`**; compile report = **`<screen>.compile.json`**; compiler-written provenance sidecar = **`<screen>.form.meta.json`**; author-written intent sidecar = **`<screen>.sfs.meta.json`**. Blessed fixtures are `<screen>.expected.form.json`. **`g-artifact-naming`: no path under `runs/**`, `.build/**` or `packages/sfs/test/fixtures/**` may match `\.compiled(\.meta)?\.json$`** | D-044 |

WP-0 is not complete until `node packages/verify/src/gates/g-decisions.mjs` exits 0 with D-040…D-044 present.

---

### 5.2 Scope A — the eight work packages of this session

**Scope is data, not prose.** `packages/verify/config/session-scope.json` lists exactly these eight WP ids. `prove.mjs` reads it. Narrowing it requires a `DECISIONS.md` row beginning `Scope change:`; `g-no-gate-tampering` fails any other edit to it.

Everything else that Sections 1–4 specify is a `BACKLOG.md` row (§5.11) carrying its acceptance command copied verbatim from the section that owns it. Nothing is "dropped later under budget pressure"; it is out of scope now, in writing.

**Effort is derived, not asserted.** `artifacts` = distinct files the session authors or regenerates in that WP, counted from the `Creates` list. `steps` = `4 × artifacts` (one Write plus three Edit/Bash iterations, which is what the mutation-flipping and typecheck work actually costs). Both columns are auditable against the tree.

| Order | WP | Goal | Depends on | Artifacts | Steps |
|---|---|---|---|---|---|
| 1 | **WP-0** | Workspace, coverage primitives, eight gates, the mutation harness, git hooks, the brief split, the deletions that need no new code | P1–P7 | 61 | 244 |
| 2 | **WP-1** | **GO/NO-GO.** Two independently written programs agree on the markup of a real production form | WP-0 | 25 | 100 |
| 3 | **WP-2** | `components-kb` → machine registry: names-only completeness for all 121, value types for the 13 priority types, honest provenance | WP-1 | 34 | 136 |
| 4 | **WP-4** | SFS JSON Schema v1 and the ten `clean/` fixtures | WP-2 | 18 | 72 |
| 5 | **WP-5** | Compiler v1 (all six stages, all node kinds, seven recipes, error catalogue) + decompiler over the six declared corpus forms | WP-4 | 40 | 160 |
| 6 | **WP-7a** | Delete `shesha-form-edit/**` and the 2.5 MB of seeds; ship one thin `shesha-spec` skill | WP-5 | 6 | 24 |
| 7 | **WP-3a** | Coverage full API + `walk.mjs`, T1 schema tier, T2 registry tier with 22 checks | WP-5 | 52 | 208 |
| 8 | **WP-10** | The integration proof and the anti-drift checklist | all | 28 | 112 |
| — | reserve | Unallocated | — | — | 144 |
| | | **Total envelope** | | **264** | **1,200 steps / 3.0 M tokens** |

**Order rationale, stated once.** WP-1 second because it is the go/no-go [§6 Phase 1]. WP-2 third because the compiler cannot stamp a version it cannot look up. WP-7a before WP-3a because `cost-delta`'s `preloadBytes` ratio is only real once the 322,816 B of prose is gone, and because the deletion is mechanical and cheap. WP-3a last of the build WPs because T2 needs both the registry and real compiler output.

---

#### WP-0 — Workspace, gate contract, brief split, deletions

**Creates (61 artifacts).** Section 1 §1.8 steps 1–12, plus:

- Root: `package.json` (workspaces `["packages/*"]`, the scripts below), `tsconfig.json`, `.gitignore`, `.githooks/pre-commit`, `.githooks/commit-msg`, `CLAUDE.md` edit.
- Five package skeletons (`packages/{registry,sfs,verify,mcp,precedent}/{package.json,src/index.mjs}`). Each `exports` entry carries a sibling `"types"` pointing at the same `.mjs`.
- `packages/registry/src/coverage.mjs` — the whole of §3.1.2 (D-041) + `packages/registry/test/coverage.test.mjs` with ≥ 14 tests.
- `packages/verify/src/coverage.mjs`, `packages/sfs/src/lib/coverage.mjs` — one line each.
- `packages/verify/src/run-gates.mjs`, `packages/verify/test/mutation-meta.test.mjs`.
- **Eight gates** (below) with their declared mutations.
- `packages/verify/config/{prose-budget,disposition,fanout,cost-baseline,session-scope,scheduled-enforcers,quarantine,gate-ratchet,fixture-floors,command-floor}.json`.
- `/DECISIONS.md`, `/BUILD-LOG.md`, `/BLOCKED.md`, `/BACKLOG.md`.
- `docs/rebuild-brief/**` — the five sections, `CONTROL.md` (a copy of this section), `data/*.json`, `artifacts/*`.
- `git mv` of `verify-artifact.mjs`, `check-references.mjs` and their tests into `packages/verify/src/` + `packages/verify/test/`.
- `packages/sfs/tools/measure-form.mjs`, `packages/sfs/tools/synthesise-envelope.mjs`.
- Deletions: `summarize.js`, `validate-blocks.js`, `bake-overlays.mjs`, `shesha-form-edit/package.json` (D-010…D-012).

**The eight gates, and why exactly eight.** *A gate ships in the work package that creates its subject.* At WP-0 the only subjects that exist are the workspace, the brief, the decision registry, the commit log, `coverage.mjs`, documented commands and the gate runner itself. Therefore WP-0 ships exactly: `g-decisions`, `g-brief-budget`, `g-prose-budget`, `g-commit-format`, `g-gate-contract`, `g-coverage-single-impl`, `g-commands-executable`, `g-workspace-hygiene`. Every other gate named anywhere in the brief lands in the WP that creates its subject, or in a BACKLOG row.

`g-gate-ratchet` (part of `run-gates.mjs`, not a gate) counts only gates whose declared `inputPaths[]` all exist and are non-empty **and** that have ≥ 1 verdict-flipping mutation. A gate that cannot fail was never in the count, so deleting it under S6 does not lower a floor. A deletion for any other reason lowers the floor only in a commit citing a `DECISIONS.md` row beginning `Gate removal:`.

**`Enforced by` has four legal forms** (D-045), all resolved by `g-decisions`:
1. a gate id with a file under `packages/verify/src/gates/`;
2. `structural:<path>` or `hook:<file>` — the path must exist;
3. `check:<tier-module>:<check-id>` — `g-decisions` imports the tier module and asserts the id is in its exported `checks[]`;
4. `scheduled:<WP-or-BL-id>:<enforcer-id>` — accepted only when `packages/verify/config/scheduled-enforcers.json` has a matching row, the id appears in `session-scope.json` or `BACKLOG.md`, and `BUILD-LOG.md` does not record that WP complete. A `scheduled:` row surviving its WP's completion is a hard failure.

**Brief split (D-046), enforced by `g-brief-budget`.** The pre-rebuild failure was 322,816 B of prose against a ~100–150 constraint adherence ceiling [§0, §1.2]. A 450 KB brief reproduces it. WP-0 therefore splits the bundle by reader and the gate holds the shape:
- `docs/rebuild-brief/CONTROL.md` ≤ 25,600 B — this section, verbatim. The only file read at turn zero and after every reset.
- All five `docs/rebuild-brief/*.md` together ≤ 61,440 B.
- Every table with > 8 data rows in Sections 1–4 becomes `docs/rebuild-brief/data/<name>.json` and the prose keeps one line naming the path. Mandatory extractions: `formsettings.json`, `error-catalogue.json`, `t2-checks.json`, `t3-checks.json`, `fixture-manifest.json`, `no-theatre.json`, `decisions-seed.json`, `defect-classes.json`, `disposition.json`.
- Every fenced block that is a file's literal contents (schemas, agent frontmatter, hook decision tables) becomes that file under `docs/rebuild-brief/artifacts/`.
- **0 fenced blocks longer than 40 lines** in any `docs/rebuild-brief/*.md`.

**The mutation harness cost protocol (D-047), enforced by `mutation-meta.test.mjs`.** A slow harness is a harness that gets bypassed with `--no-verify`.
- A mutation copies **only that gate's declared `inputPaths[]`** into `os.tmpdir()`. Never the repository.
- The temp root gets `fs.symlinkSync(<repoRoot>/node_modules, <tmp>/node_modules, 'junction')`. `'junction'` is required on Windows; `'dir'` fails without administrator rights.
- Never copied: `node_modules/`, `.git/`, `.build/`, `runs/`, `packages/sfs/corpus/`.
- The whole mutation suite must finish in **≤ 180 s**. `gates:mutate` measures it with `performance.now()` and prints it as its last line; exceeding it is a test failure attributed to the harness.

**Root scripts (exact).**
```json
"typecheck": "tsc -p tsconfig.json --noEmit",
"test":      "node --test packages/*/test*/ packages/*/tests/",
"gates":     "node packages/verify/src/run-gates.mjs",
"gates:mutate": "node --test packages/verify/test/mutation-meta.test.mjs",
"green:fast": "npm run typecheck && npm run test && npm run gates",
"green":      "npm run green:fast && npm run gates:mutate",
"bless":      "node packages/sfs/tools/bless.mjs",
"prove":      "node packages/verify/src/prove.mjs"
```
`.githooks/pre-commit` runs `npm run green:fast` plus the staged-file checks. `.githooks/commit-msg` — which is the hook git passes the message file to as `$1` — runs `node packages/verify/src/gates/g-commit-format.mjs --message-file "$1"`, and that gate exits 2 when `--message-file` is absent rather than defaulting to `.git/COMMIT_EDITMSG`. `npm run green` (with mutations) runs in `prove` and in CI only.

**`.gitignore`, literally.**
```
node_modules/
/runs/
/.build/
*.tmp
.sfs-cache/
.claude/settings.local.json
.claude/hooks.jsonl
packages/sfs/reports/
packages/precedent/data/
packages/precedent/models/
.vscode/
```

**Evidence, not self-report (D-048).** `npm run green` writes `packages/verify/evidence/<currentWp>.json` = `{wp, gitSha, tests, gates, mutations, perGateCoverage, exitCodes, greenSeconds, at}`, reading `currentWp` from `.build/state.json`. `g-commit-format` regenerates that file during `commit-msg` and fails if it is stale (`gitSha` mismatch) or if any number on the commit body's `Gates:` / `Coverage:` lines disagrees with it. **No acceptance criterion anywhere in this brief is satisfied by the agent typing a number into a commit body.** Where Sections 1, 3 and 4 say "record in the commit body", read "present in `packages/verify/evidence/<WP>.json`, which the gate wrote".

**Quarantine (D-049).** `verify-artifact.mjs` and `check-references.mjs` move unchanged and every documented invocation of them is deleted in the same commit. They are registered in `quarantine.json` as `{path, holes, liftedBy:"BL-003"}`. `g-quarantine` ships in BL-003; until then the enforcement is the deletion of every invocation, asserted by §5.10 item 3.

**Acceptance gate.**
```bash
npm ci && npm run green ; echo "green exit=$?"
node packages/verify/src/gates/g-decisions.mjs
node packages/verify/src/gates/g-brief-budget.mjs
node packages/verify/src/gates/g-coverage-single-impl.mjs
node packages/verify/src/gates/g-gate-contract.mjs
node -e "const s=require('./packages/verify/config/session-scope.json');if(s.wps.length!==8)throw new Error(s.wps.length);console.log('scope 8 wps')"
```
All exit **0**. `npm run green` prints, as its last five lines:
```
typecheck: 0 errors
tests: <T>=<T> pass 0 fail        (T >= 29: 15 moved verify-artifact + >=14 coverage)
gates: 8 run, 8 pass, 0 fail, 0 partial
mutations: 16 declared, 16 caught, 0 escaped
mutations: <S> seconds (ceiling 180)
```
`g-decisions` prints `rows=<R> enforcers=<R>/<R> resolved · scheduled=<N> · unresolved=0`. `g-brief-budget` prints `CONTROL.md <b1> <= 25600 · bundle <b2> <= 61440 · oversize fences 0 · unextracted tables 0`. `g-coverage-single-impl` prints `verdictOf defined 1x (packages/registry/src/coverage.mjs) · re-exports 2/2 single-line · walkComponents exempt`.

---

#### WP-1 — The decisive experiment (GO/NO-GO)

**Target, named and on disk:** `plugins/shesha-developer/skills/shesha-form-edit/assets/examples/inline-editable-table.json`. Measured from the tree: 12,032 B compact `{components, formSettings}`, 17 nodes, depth 5, component types `container`, `dataContext`, `datatable`, `datatable.quickSearch`, `datatable.pager`. It is the same archetype as strategy doc §1.1's decomposition (list screen, data context, toolbar, quick search, pager) and it is a production form from the estate.

**The seeds carry no envelope.** All 12 files under `assets/examples/` are bare `{components, formSettings}`; none has a `Markup` key. `tools/synthesise-envelope.mjs` builds the 23-field envelope with `Markup = JSON.stringify({components, formSettings})` (compact, key order as read), every identity field `null`, and `provenance: "ENVELOPE-SYNTHESISED"` in the sibling `.form.meta.json`. **T1's `file` family reports `uninspectable` on any artifact whose meta sidecar carries that flag** — partial, exit 3, never pass. The envelope's 23 fields are proven in BL-005 against a real backend export, not here.

**Two programs from opposite directions, and one of them is not the compiler.**
- `packages/sfs/src/compile/**` — narrow: the 5 types above. SFS → markup.
- `packages/sfs/tools/normalise-legacy.mjs` — standalone, ≤ 12 KB, takes the synthesised envelope and applies N1–N10 + canonical key order + id re-stamping through the same seeded namespace, **importing nothing under `src/compile/` or `src/decompile/`**. `g-oracle-independence` enforces both the import ban and the byte cap.

**The four properties WP-1 proves.** §2.5 states round-tripping does **not** require byte-equality with the original, and §2.4.2 derives ids from author-chosen names that markup cannot recover. So the assertions are:

| # | Property | Assertion |
|---|---|---|
| Q1 | Compiler self-consistency | `compile(decompile(compile(x))).Markup === compile(x).Markup`, byte-equal. Names are canonical on the compiler's own output, so ids are recoverable |
| Q2 | Independent agreement | `pnf(compile(x).Markup) === pnf(normaliseLegacy(envelope).Markup)`, byte-equal, where `pnf` (`packages/sfs/tools/pnf.mjs`) replaces every `id` with its dotted tree position and every `parentId` with its parent's position, and is the identity on everything else |
| Q3 | No structural escape | `structuralEscapes(decompile(envelope)) === 0` |
| Q4 | Clean under T2 | not asserted in WP-1 (T2 is WP-3a); asserted in `prove` step 6 |
| Q5 | Id determinism | `determinism.test.mjs`: 50 in-process + 3 subprocess compiles byte-identical; every id equals `uuidv5(NS, "<module>/<form>|<sfsPath>")` recomputed from the meta sidecar; 0 banned identifiers |

**Creates (25 artifacts).** `packages/sfs/schema/sfs.schema.json` (v0, fixture-scoped); `test/fixtures/clean/inline-editable-table.sfs.json` (≤ 1,400 B); `test/fixtures/legacy/inline-editable-table.seed.json` (`git mv` of the example) and `.envelope.json` (synthesised, committed); `src/compile/{index,s1-parse,s2-resolve,s3-normalise,s4-expand,s5-stamp,s6-serialise}.mjs`; `src/decompile/{index,detect}.mjs`; `src/lib/{ids,orderedJson,tokens}.mjs`; `bin/sfs.mjs`; `tools/{normalise-legacy,pnf,cost-delta}.mjs`; `tests/{oracle,golden-defects,determinism,selfconsistency}.test.mjs`; `packages/verify/src/gates/{g-oracle-independence,g-determinism,g-artifact-naming}.mjs`; `packages/verify/config/cost-baseline.json`.

**Golden defects, re-derived.** The eight defects of §1.1 belong to `bookings-table`, which is not in the tree. `golden-defects.test.mjs` asserts the **normalisation classes** N1–N10 against the target's own measured defect set, produced by `node packages/sfs/tools/measure-form.mjs <target> --defects --json` and committed as `test/fixtures/legacy/inline-editable-table.defects.json`. The count is discovered, printed, and ratcheted; it is never a literal copied from the strategy doc.

**Acceptance gate.**
```bash
node packages/sfs/tools/synthesise-envelope.mjs packages/sfs/test/fixtures/legacy/inline-editable-table.seed.json \
  --out packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json
node packages/sfs/bin/sfs.mjs compile packages/sfs/test/fixtures/clean/inline-editable-table.sfs.json \
  --brand shesha --registry 0.45.1 --out .build/wp1 --json
node packages/sfs/tools/normalise-legacy.mjs packages/sfs/test/fixtures/legacy/inline-editable-table.envelope.json \
  --out .build/wp1/oracle.form.json
node --test packages/sfs/tests/
node packages/sfs/tools/cost-delta.mjs --json
node packages/verify/src/gates/g-oracle-independence.mjs
node packages/verify/src/gates/g-artifact-naming.mjs
npm run green
```
All exit **0**. Required stdout:

| Producer | Must print |
|---|---|
| `selfconsistency.test.mjs` | `Q1 BYTE-EQUAL <n> bytes sha256=<12 hex>` and, on failure, the first divergent byte index plus 120 bytes of context from each side |
| `oracle.test.mjs` | `Q2 EQUAL-UNDER-ID-POSITION <n> bytes sha256=<12 hex>` · `Q3 structural escapes 0` |
| `golden-defects.test.mjs` | `defect classes present in target: <k> · all <k> absent from compiled output · # fail 0` |
| `determinism.test.mjs` | `Q5 50 in-process identical · 3 subprocess identical · ids v5-recomputed <n>/<n> · banned identifiers 0` |
| `cost-delta.mjs` | `emitted <M> -> <S> B (<Rx>x, floor 10) · preload 322816 -> <P> B (<Px>x, floor 5) · GATE PASS` |

**`cost-baseline.json` holds only recomputable byte counts (D-050).** `{"emittedBytes":12032,"source":"measured: compact {components,formSettings} of inline-editable-table.json"}` and `{"preloadBytes":322816,"source":"strategy §1.2: 46926 + 275890"}`. **`steps` and any token or tool-call ratio are deleted from the gate** — a step count extracted by a script the session wrote, from prose the session is deleting, is not a measurement [§1.7 T15]. The step/token claim is BL-001 alongside the three-arm harness run. `prove` prints `token cost: unmeasured in this session`.

**GO/NO-GO.** If Q1 or Q2 is not achieved after **3 repair rounds** (§5.8), execute **S1**: write `FINDINGS.md` naming the first divergent byte, the construct it belongs to, and which side is wrong; commit `[chore]- WP-1 record NO-GO: <construct> not expressible/normalisable`; **do not start WP-2** [§6 Phase 1 gate].

---

#### WP-2 — Registry hardening (L0)

**Creates (34 artifacts).** `packages/registry/data/0.45.1/{_meta,components,actions,enums,slots,formsettings,roles,limitations}.json`; `packages/registry/src/{extract,lookup,reconcile,validate}.mjs`; `packages/registry/schema/registry.schema.json`; `capability-matrix.json` hardened (per-row `id`, probe reference, own `measuredAt`; `matrix.versions` deleted; `tabs` and `collapsiblePanel` rows added) [§5 disposition]; `packages/verify/src/gates/{g-registry-provenance,g-registry-gap-ratchet}.mjs`; `packages/registry/test/*` (3).

**Scope, cut to what is mechanically derivable (D-051).** §2.8.2 states plainly that `settingsFields[].editorType` records the designer *widget* and says nothing about the value. Value types are recoverable only from the framework's TypeScript at a pinned ref. Therefore:
- **All 121 records reach `propsCompleteness: "names-only"`** via the `extends` / `resolvedProps` walk. That is the required floor.
- **`valueType` is filled for the 13 priority types of §2.8.4 only**, from two deterministic sources: `initModel.raw` literals (`typeof` the default) and observed JS types mined from the six corpus forms. Those 13 reach `propsCompleteness: "full"`.
- Without the framework source (P7 said `net none`): every prop is `valueType:null, valueTypeSource:"unknown"`, `propsCompleteness:"names-only"` for all 121, and T2.07/T2.08 dispose every affected prop site **`uninspectable`** — partial, exit 3, never pass, never fail.
- `full >= 93 of 121` is **BL-004**, not this session.

**Three sub-steps.** WP-2a provenance (`extract.mjs --from <path|git-url> --ref releases/0.45` writes `_meta.json` with `{ref, commit, extractorVersion, provenance}`, no `generatedAt`, no machine-local path); WP-2b the 121 records (**fan out, 4 agents**, §5.6); WP-2c the non-component data (`slots.json` — the 9 child channels the single walker must reach; `actions.json` — legal `(intent → actionName, actionOwner)` triples, lowercase owners, spaced names, D-034; `enums.json`; `formsettings.json` — one profile per `kind`, D-032/D-033; `roles.json`). WP-2c is sequential: five small artifacts that cross-reference each other.

**Never invent a version integer.** Unsourceable ⇒ `version:null, versionSource:"unknown"`, every node of that type `uninspectable`, verdict `partial`, exit 3 [D-006]. Inventing it is the `collapsiblePanel` 8-vs-9 defect [§1.2#11] recreated on purpose.

**Acceptance gate.**
```bash
node packages/registry/src/validate.mjs --all --json
node packages/verify/src/gates/g-registry-provenance.mjs
node packages/verify/src/gates/g-registry-gap-ratchet.mjs
npm run green
```
All exit **0**. `validate.mjs` prints exactly this shape, the numbers being constraints:
```
components: 121 records · names-only 121/121 · full >= 13 of 13 priority · priority partial 0
versions:   resolved <n> · unknown <u> (each versionSource:"unknown")
nested item schemas: datatable.items ok · buttonGroup.items ok · tabs.tabs ok · KeyInformationBar.columns ok
slots: 9 channels declared · actions: <n> legal pairs, 0 PascalCase owners, 0 unspaced names
enums: <n> domains · 0 empty domains
capability-matrix: 36+ rows · every row has id+probe+measuredAt · matrix.versions absent
verdict: pass
```
`g-registry-gap-ratchet` writes `unknown` and `names-only` counts to `packages/verify/config/registry-gaps.json` and **fails on any increase** in a later commit.

---

#### WP-4 — SFS schema v1 and the ten clean fixtures

**The fixture numbers, stated once here and derived everywhere else (D-052).** `packages/verify/config/fixture-floors.json` holds them; `g-fixture-manifest` reads it and carries no literals.
- **10 clean screens.** `clean/` therefore contains **30 files**: `<screen>.sfs.json` + `<screen>.expected.form.json` + `<screen>.form.meta.json`.
- Exactly **1** of the 10 (`raw-escape-demo`) has `structuralEscapes: 1`. The WP-5 escape ceiling is `floor(0.20 × 10) = 2`, so the gate reads `1/10 = 0.10 <= 0.20`.
- Per-directory byte caps, from the measured ~1.6 KB/component density [§1.1]: `clean/*.expected.form.json` ≤ 98,304; `clean/*.form.meta.json` ≤ 32,768; `legacy/*` ≤ 262,144; `t1|t2|coverage|envelope/*` ≤ 32,768. Each manifest entry records the `bytesCap` applied.
- Scope-A fixture floor = 30 clean + 8 t1 + 22 t2 + 6 coverage + 6 envelope = **72**.

**Sequential, single agent, no exceptions.** Two authors on one JSON Schema is the `refListStatus` incident [§4/L4] with a different file name.

**Creates (18 artifacts).** `packages/sfs/schema/{sfs,compile-report}.schema.json`; 10 `clean/*.sfs.json` (the 20 derived files are produced by `npm run bless`, not hand-authored); `test/fixtures/index.json`; `packages/sfs/tests/schema.test.mjs`; `packages/verify/src/gates/g-fixture-manifest.mjs`; `fixture-floors.json`.

**Acceptance gate.**
```bash
node -e "const A=require('ajv');new (A.default||A)({strict:true,allErrors:true}).compile(require('./packages/sfs/schema/sfs.schema.json'));console.log('schema compiles strict')"
npm run bless
node --test packages/sfs/tests/schema.test.mjs
node packages/verify/src/gates/g-fixture-manifest.mjs
npm run green
```
All exit **0**. Required prints: `schema compiles strict`; `schema.test.mjs` → `positive 10/10 · negative <n>/<n> rejected · forbidden keys 6/6 rejected · ajv strict compile ok` (the six are `id`, `parentId`, `version`, `actionName`, `actionOwner`, `componentName` [§2.3 s1]); `g-fixture-manifest` → `fixtures 72 · manifest 72 · orphans 0 · uncovered check ids 0 · oversize 0 · caps applied 5`.

---

#### WP-5 — Compiler v1 and the bounded decompiler

**Creates (40 artifacts).** `src/compile/**` widened; `src/compile/recipes/{pageShell,dataRegion,flexRow,columnTriplet,statusBadge,datalistRowCard,actionsGroup}.mjs`; `src/errors/{catalogue.json,raise.mjs}`; `src/lib/{metadata,paths}.mjs`; `src/decompile/{index,detect,liftStyles,liftResponsive,liftActions}.mjs`; `packages/sfs/corpus/**` (the six declared forms, `git mv`'d from `assets/examples/`) and `corpus-sfs/**`; `tests/{compile,errors,idempotence,roundtrip}.test.mjs`; `packages/verify/src/gates/{g-no-literal-hex,g-escape-budget,g-no-style-pass,g-corpus-immutable,g-markup-provenance}.mjs`. The 11 legacy blocks are read from `packages/sfs/recipes/_legacy/`, converted, and `_legacy/` deleted in this commit [§5 disposition].

**SFS node kinds must cover the estate (D-053).** §2.1.4's 17 kinds cover none of what the corpus is made of, so a decompile of any real form would be almost entirely structural `raw:` and `g-escape-budget` could not pass. WP-5 adds these kinds, with slot topology taken from `components-kb/*.json` `slots.customContainerNames`:

| Kind | Covers | Children channel |
|---|---|---|
| `childTable` | `childTable` | `items[]` |
| `kib` | `KeyInformationBar` | `columns[].components` |
| `tags` | `childEntitiesTagGroup` | none |
| `attachments` | `attachmentsEditor` | none |
| `picker` | `entityPicker` | `modalProps.components` |
| `select` | `dropdown`, `autocomplete` | none |
| `field` | **catch-all for every registry type with `isInput: true`**, discriminated by `_datatypeMap` | none |

`field` as the `isInput` catch-all is what keeps the escape rate bounded without enumerating 121 types. `componentType(kib) === "KeyInformationBar"` (§3.3.3 A6) is then expressible.

**Round-trip is scoped to a declared subset (D-054).** `packages/verify/config/roundtrip-scope.json` names the **six** smallest corpus forms and no others: `entity-datalist`, `standalone-create`, `entity-card`, `rs-link-add-dialog`, `inline-editable-table`, `employee-table` (3,268 / 4,221 / 7,126 / 10,657 / 12,032 / 45,912 B compact). The gate is **≥ 0.90 over those six** — i.e. at most one failure. The other six (`employee-create`, `employee-detail-with-child-tables`, `employee-detail-without-child-tables`, `rs-create-dialog`, `rs-detail-with-header`, `rs-table`) are decompiled, triaged, and reported **`uninspectable`** with a `BLOCKED.md` B8 row and a printed per-form escape count. Never `pass`. The full-corpus 0.90 gate is **BL-002**.

**`g-markup-provenance` is the real enforcer of "the compiler is the only writer of markup".** For every `*.expected.form.json` in fixtures and every `*.form.json` under `.build/**`, it recompiles the sibling `.sfs.json` under the registry and brand hashes recorded in the sibling `.compile.json` and hard-fails unless the bytes are identical. String-matching a command line cannot enforce this (a computed output path defeats it); recomputation can.

**Fan-out: partial, 3 agents, one bounded slice** — the 31 `debug.md` symptom rows → error-catalogue entries (§2.7.2). Stage code is sequential, one agent.

**`test.todo` carve-out.** A `compiler-gap` round-trip failure produces a failing fixture under `packages/sfs/tests/gaps/` marked `test.todo`, whose name begins with a `GAP-[0-9]{3}` id present in `BACKLOG.md`. `g-no-gate-tampering` permits `test.todo(` **only** under `packages/sfs/tests/gaps/` and **only** with a matching backlog id; everywhere else it is a hard fail and stop condition S7.

**Acceptance gate.**
```bash
node --test packages/sfs/tests/
node packages/verify/src/gates/g-determinism.mjs
node packages/verify/src/gates/g-no-literal-hex.mjs
node packages/verify/src/gates/g-escape-budget.mjs
node packages/verify/src/gates/g-markup-provenance.mjs
node packages/verify/src/gates/g-corpus-immutable.mjs
node packages/sfs/bin/sfs.mjs roundtrip --scope packages/verify/config/roundtrip-scope.json \
  --report packages/sfs/reports/roundtrip.json
npm run green
```
All exit **0**. Required prints:
```
compile.test.mjs:     fixtures 10/10 compiled · byte-equal to blessed 10/10
errors.test.mjs:      catalogue codes <n> · every code has {code,message,hint,cause,fix} · 31/31 debug.md rows mapped · 0 codes unreferenced by src
idempotence.test.mjs: compile(decompile(compile(x)))==compile(x) 10/10
roundtrip:            scope 6=6 · roundTripped <m> · rate 0.<xx> >= 0.90 · PASS · untriaged 0
                      out-of-scope 6 · uninspectable 6 · BLOCKED.md B8 present
g-determinism:        2 compiles per fixture, 20 outputs, 20 identical · banned identifiers 0
g-no-literal-hex:     scanned <n> files · hex sites 0
g-escape-budget:      structural raw 1/10 = 0.10 <= 0.20
g-markup-provenance:  recomputed 10/10 · byte-identical 10/10
```

---

#### WP-7a — The great deletion and one thin skill

**Creates (6 artifacts).** `plugins/shesha-developer/skills/shesha-spec/SKILL.md` (**new folder** → minor bump) ≤ 8,192 B with `references/` one level deep ≤ 24,576 B total; `prose-budget.json` updated to `{"tierA":{"paths":[shesha-claude-designer, shesha-design-comprehension, shesha-design-system, shesha-spec],"expectedCount":4}}`; `packages/verify/src/gates/{g-plugin-version,g-disposition}.mjs`; `disposition.json`. **Deleted:** `plugins/shesha-developer/skills/shesha-form-edit/**` entirely (SKILL.md 46,926 B + 32 reference files 276 KB + the 6 already-moved and 6 still-present example seeds), and its `prose-budget.json` waiver.

`g-prose-budget` hard-fails if the count of *existing* folders matched by `tierA.paths` ≠ `expectedCount`, so a rename that does not update the config fails the count check. The three pre-existing design skills keep their measured current byte counts as waived caps that may only ratchet **down**; their rewrite is BL-007.

**Acceptance gate.**
```bash
node packages/verify/src/gates/g-prose-budget.mjs
node packages/verify/src/gates/g-skill-purity.mjs
node packages/verify/src/gates/g-commands-executable.mjs
node packages/verify/src/gates/g-disposition.mjs
node packages/verify/src/gates/g-plugin-version.mjs
node packages/sfs/tools/cost-delta.mjs --json
npm run green
```
All exit **0**. `g-prose-budget` → `tierA matched 4 = expectedCount 4 · shesha-spec 8192 cap ok · waivers 3 ratchet-down-only · archaeology hits 0 · reference depth violations 0`. `g-skill-purity` → `version integers in plugins/**: 0 · prop lists: 0 · transcribe-and-run snippets: 0`. `g-disposition` → `required deletions <n>/<n> · unauthorised deletions 0`. `g-plugin-version` → `1.8.4 -> <V> · minor incremented 1x · every plugins/** commit bumped`. `cost-delta` → `preload 322816 -> <P> B (<Px>x, floor 5) · GATE PASS`.

---

#### WP-3a — Coverage full API, T1, T2

**Creates (52 artifacts).** `packages/verify/src/walk.mjs` (the single `walkComponents`, registry-data-driven over `slots.json`'s 9 channels); `packages/verify/src/{t1-schema,t2-registry,verify.mjs}`; `packages/registry/src/coverage.mjs` extended with unit-typed families; `packages/verify/test/{coverage,coverage.mutation,fixtures.contract}.test.mjs`; `packages/sfs/test/fixtures/{envelope,coverage,t1,t2}/**` (42 files); `packages/verify/src/gates/{g-mutation-coverage,g-exit-codes,g-defect-class-coverage}.mjs`; `packages/verify/config/defect-classes.json`.

**`g-exit-codes` replaces the greps that pretended to be semantics.** It imports every module under `packages/verify/src/` and `packages/sfs/src/` that exports a verdict and asserts: (a) every returned verdict is drawn from the frozen enum `{pass, fail, partial, notRun}` — there is no `warn` verdict, though warnings may be counted and printed for the operator; (b) no module reaches `process.exit(EXIT.pass)` on a path where any family has `failures.length > 0`. `g-no-gate-tampering` additionally flags any diff that converts a `failures.push(...)` into a counter increment.

**T1.08 is a v5 check, not v4.** §2.4.2 mandates `uuidv5`. On compiler output every `id` must match `^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` **and** equal `nodeId(module, form, sfsPath)` recomputed from the meta sidecar. Under `--legacy`, nanoid/v4 ids are `notApplicable`. A v4-shaped-id fixture lives in `t1/` so a mutation proves it.

**T2.20 `forbidden` means "forbidden with a non-null value" (D-055).** For each key in `form-settings.json`'s `forbidden` list, fail iff the key is present **and** its value is not `null`; fail on any key absent from `allowed ∪ forbidden`. Both fixtures ship: `T2.20-list-form-with-submit-pipeline.json` (non-null `dataSubmitterType`, fails) and a positive case carrying `onBeforeDataLoad: null` (passes).

**T2 registry-gap disposition (D-056).** A pointer is `uninspectable` only when its type is present in the artifact **and** its registry entry is incomplete **and** the type is not one of the 13 priority types. A **priority** type with an incomplete entry is a `fail` naming the registry gap. That function lives in `coverage.mjs`, so no consumer implements its own exception.

**`defect-classes.json` makes the ≥ 90% claim falsifiable.** It enumerates every defect class as `{id, source, describe}` with a stated total `N`. `g-defect-class-coverage` requires every id to name ≥ 1 manifest fixture whose expected verdict is `fail`, prints `covered/<N>`, and fails below `ceil(0.9 × N)`. Classes reachable only by T3/T4 are marked `tier:"t3"` and excluded from Scope A's denominator, which is printed separately.

**Fan-out: partial, 4 agents** — the 42 fixtures + manifest fragments, partitioned by check-id range. `t2-registry.mjs` is one file, sequential.

**Acceptance gate.**
```bash
node packages/verify/src/verify.mjs .build/wp3a --screen inline-editable-table --tiers t1,t2 --json ; echo "exit=$?"
node packages/verify/src/verify.mjs .build/wp3a --screen synthesised-envelope --tiers t1 --json ; echo "exit=$?"
node --test packages/verify/test/
node packages/verify/src/gates/g-mutation-coverage.mjs
node packages/verify/src/gates/g-exit-codes.mjs
node packages/verify/src/gates/g-defect-class-coverage.mjs
npm run green
```
First command exit **0**; second exit **3** with stdout containing `A partial verdict is NOT a pass` and `file: uninspectable (ENVELOPE-SYNTHESISED)`; the rest **0**. Required prints: `verify.mjs` → `t1 pass (families 5, walked/checked per family listed) · t2 pass · gate pass`; `coverage.test.mjs` → `# pass >= 22`; `fixtures.contract.test.mjs` → one line per fixture with verdict/exit/families asserted exactly; `g-mutation-coverage` → `checks 22 · fixtures per check min 1 · mutations per check min 1 · uncovered 0`; `g-exit-codes` → `modules <n> · verdict enum {pass,fail,partial,notRun} 4/4 · pass-with-failures paths 0`; `g-defect-class-coverage` → `scope-A classes <n>/<N> covered >= ceil(0.9*<N>)`.

---

### 5.3 The integration proof

**One command ends the session.** `npm run prove` → `node packages/verify/src/prove.mjs`. A program, not a checklist. It reads `session-scope.json`, performs the steps below in order, and aborts at the first failure with a non-zero exit and a named reason.

| Step | What it does | Fail exit |
|---|---|---|
| 1 | `npm run green` as a subprocess; capture the five summary lines | 1 |
| 2 | Compile `clean/inline-editable-table.sfs.json` into a temp dir; capture `Markup`, `markupSha256`, `markupBytes` | 1 |
| 3 | **Q1:** `compile(decompile(compile(x))).Markup === compile(x).Markup`, byte-equal | 1, printing the first divergent byte index + 120 bytes of context per side |
| 4 | **Q2:** `pnf(compile(x).Markup) === pnf(normaliseLegacy(envelope).Markup)`, byte-equal | 1, same diagnostic |
| 5 | **Q3:** `structuralEscapes(decompile(envelope)) === 0` | 1 |
| 6 | **Q4:** run T2 over `compile(decompile(envelope))`; require `pass`. Then run the normalisation-class predicates over `Markup`; every class in `inline-editable-table.defects.json` must be absent | 1 |
| 7 | `verify.mjs --tiers t1,t2` on the compiled artifact; require `gate: pass` | 1 |
| 8 | `verify.mjs --tiers t1` on the synthesised envelope; require exit **3** and the string `A partial verdict is NOT a pass` | 1 |
| 9 | `roundtrip --scope roundtrip-scope.json`; require rate ≥ 0.90 over 6 and `untriaged 0` | 1 |
| 10 | `cost-delta.mjs`; require both ratios above their floors; then byte-compare the whole stdout block against `packages/verify/test/prove.expected.txt` | 1 |

**Exact expected output.** `prove.mjs` prints this block and nothing else. Values in `<>` are discovered and frozen into `prove.expected.txt`; every other character is literal.

```
=== SHESHA SFS REBUILD — INTEGRATION PROOF (SCOPE A) ===
scope            WP-0 WP-1 WP-2 WP-4 WP-5 WP-7a WP-3a WP-10   8/8 complete
green            typecheck 0 errors · tests <T>=<T> pass 0 fail · gates <G> pass 0 fail · mutations <M>=<M> caught in <S>s
compile          inline-editable-table.sfs.json <s> B -> <m> B markup  sha256=<h1>
Q1 selfconsist   compile(decompile(compile(x))) == compile(x)   BYTE-EQUAL <m> B
Q2 oracle        pnf(compiler) == pnf(normalise-legacy(envelope))   EQUAL-UNDER-ID-POSITION <p> B
Q3 escapes       decompile(envelope) structural raw 0
Q4 defects       normalisation classes <k>/<k> absent from compiled output · T2 pass
tiers            t1 pass · t2 pass · gate pass
uninspectable    synthesised envelope -> t1 exit 3 partial · "A partial verdict is NOT a pass"
roundtrip        scope 6 · rate 0.<xx> >= 0.90 · untriaged 0 · out-of-scope 6 uninspectable
escapes          structural raw 1/10 = 0.10 <= 0.20
cost delta       emitted 12032 -> <s> B (<Rx>x, floor 10) · preload 322816 -> <P> B (<Px>x, floor 5)
                 token cost: unmeasured in this session (BL-001)
registry         0.45.1@<sha7> · names-only 121/121 · priority full 13/13 · unknown-version <u> · ratchet ok
skills           tierA 4 = expectedCount · shesha-form-edit deleted · waivers 3 ratchet-down-only
disposition      required deletions <n>/<n> · unauthorised 0
plugin           1.8.4 -> <V> · minor incremented 1x
backlog          BL-001..BL-010 present, all Blocks=No
SESSION COMPLETE — SCOPE A
```

**"Session complete" is defined as exactly this:** `npm run prove` exits **0** and its final line is `SESSION COMPLETE — SCOPE A`. A green `npm test`, a satisfied to-do list and a confident summary paragraph are explicitly insufficient — that combination is the state the pre-rebuild repo was already in [§1.4].

**Blessing.** `npm run prove -- --bless` regenerates `prove.expected.txt`. Permitted exactly twice: once in WP-1, once in WP-10. A third modification without a `DECISIONS.md` row beginning `Threshold change:` is `g-no-gate-tampering` failure and S7.

**Early end.** `npm run prove -- --partial` runs every step whose dependencies exist, prints the same block with `notRun` on the rest, prints `SESSION INCOMPLETE — completed <ids>; remaining <ids>` and exits **3**. No path prints `SESSION COMPLETE` from an incomplete scope.

---

### 5.4 Checkpointing and resume

**1. `/BUILD-LOG.md` — committed, append-only, one block per completed WP**, written as the last edit before that WP's commit.

```markdown
## WP-3a — Coverage v1, T1, T2 — 2026-08-17
Status: complete
Commit: pending
Created: packages/verify/src/{walk,t1-schema,t2-registry,verify}.mjs + 42 fixtures
Gate: `node packages/verify/src/verify.mjs .build/wp3a --screen inline-editable-table --tiers t1,t2` -> exit 0
Evidence: packages/verify/evidence/WP-3a.json
Decisions added: D-055, D-056
Blocked: none
Budget: steps 214/208 (103%) · cumulative 944/1200 (79%)
Next: WP-10
```

`g-build-state` (ships in WP-0's `run-gates.mjs` as a structural check) fails when: the WP id in the commit message has no block in the same commit; `Status` is not `complete` / `partial-blocked`; a `partial-blocked` block has no `BLOCKED.md` row; `Commit:` is anything but `pending` at commit time (back-filled by the next WP); `Evidence:` names a missing or stale file; or `Next:` names a WP absent from `session-scope.json`.

**2. `/.build/state.json` — gitignored, rewritten after every step group.**

```json
{"schemaVersion":1,"control":"docs/rebuild-brief/CONTROL.md","currentWp":"WP-5","wpOrder":5,
 "stepGroup":"s4-expand: breakpoint expansion + calc arithmetic",
 "stepGroupsDone":["s1-parse","s2-resolve","s3-normalise"],
 "stepGroupsRemaining":["s4-expand","s5-stamp","s6-serialise","recipes","error-catalogue","decompile"],
 "filesWrittenThisWp":["packages/sfs/src/compile/s1-parse.mjs"],
 "lastGreenCommit":"<sha>","repairRounds":{"g-determinism":1},
 "budget":{"stepsUsed":742,"stepsBudget":1200,"tokensUsedM":1.9,"tokensBudgetM":3.0},
 "blocked":["B3"],"fanoutOpen":[]}
```

**3. `/BLOCKED.md` and `/BACKLOG.md` — committed.** Formats in §5.7 and §5.11.

**The re-read rule (D-057).** After any context reset, compaction, crash, or any gap in which you are unsure what you were doing: **do not proceed from memory.** Run these, and act only on their output.

```bash
cat .build/state.json
tail -60 BUILD-LOG.md
cat BLOCKED.md
git log --oneline -8
npm run green:fast ; echo "green:fast exit=$?"
```

Then read `docs/rebuild-brief/CONTROL.md` (≤ 25 KB — the whole of it) and, only if the current step group needs a detail it does not carry, the single named section for the current WP: Section 1 for WP-0, Section 2 for WP-1/2/4/5, Section 3 for WP-3a, Section 4 for WP-7a. Never re-read the bundle whole.

**Mid-package resume protocol.** A WP is resumed, never restarted.
1. `npm run green:fast`. Exit 0 ⇒ the tree is consistent; resume at `stepGroup`.
2. Non-zero ⇒ the crash landed mid-write. `git status --porcelain`. For each modified file **not** in `filesWrittenThisWp`, `git checkout --` it. For each file that is, `node --check` it; a failure is a torn write — rewrite it from the brief.
3. Re-run. If it still fails inside a group listed in `stepGroupsDone`, that group's claim was false: move it to `stepGroupsRemaining` and redo it. Trusting `stepGroupsDone` over `green:fast` is banned.
4. Never `git reset --hard` past `lastGreenCommit`. Never commit a tree the pre-commit hook rejects; disabling the hook to recover is S7.

**Never half-commit a WP.** Either revert to `lastGreenCommit` and record in `BLOCKED.md`, or split it into WP-N.a / WP-N.b — **editing `session-scope.json` and CONTROL.md first, with a `Scope change:` DECISIONS row** — and commit the completed half under its own id with its own gate.

---

### 5.5 Fan-out

**The governing evidence, so this is not re-litigated mid-session.** Anthropic's multi-agent result is a 90.2% win for lead+subagents on breadth-first *research*, and it explicitly excludes shared context, heavy inter-agent dependencies, and "most coding tasks" [§4/L4]. This repo already shipped two mutually incompatible `refListStatus` shapes from two parallel authors. **D-058: fan out across independent artifacts; never within one.**

All four must hold: (1) disjoint write set, declared in advance in `packages/verify/config/fanout.json`; (2) no shared invariant; (3) a program, named below, decides correctness without a model; (4) bounded and enumerable.

| WP | Slice | Agents | Write set | **The accepting program** |
|---|---|---|---|---|
| WP-2b | 121 registry records | 4 | `packages/registry/data/0.45.1/components/<a–f\|g–m\|n–s\|t–z>/*.json` | `node packages/registry/src/validate.mjs --records <dir>` → exit 0, `records <n> · schema ok · names-only <n>/<n>` |
| WP-5 | 31 `debug.md` rows → catalogue entries | 3 | `packages/sfs/src/errors/entries/<slice>/*.json` | `node --test packages/sfs/tests/errors.test.mjs` → exit 0; every entry has all five fields and is referenced from `src/**` |
| WP-5 | round-trip failure triage | 3 (read-only) | `packages/sfs/reports/triage/<slice>.json` | `node --test packages/sfs/tests/roundtrip.test.mjs` asserts `failures.every(f => f.triage)` |
| WP-3a | 42 T1/T2/coverage/envelope fixtures | 4 | `packages/sfs/test/fixtures/{envelope,coverage,t1,t2}/<slice>` + manifest fragments | `node --test packages/verify/test/fixtures.contract.test.mjs` — every fixture's verdict/exit/family numbers assert **exactly** |

**Strictly sequential, one agent:** WP-0, WP-1, WP-4's schema, WP-5's stage code and decompiler, `t2-registry.mjs`, `walk.mjs`, `coverage.mjs`, WP-7a, WP-10.

**Hard rules.** Max **4** concurrent subagents. **No subagent commits** — subagents write files, the orchestrator runs the accepting program and commits (one commit per WP). No subagent runs `npm install`, `npm ci`, `git checkout`, `git commit`, `git reset`, or anything that mutates `node_modules/` or the git index. Every subagent prompt carries exactly: its exclusive write globs, the schema or manifest contract, the acceptance command, and "return the list of paths you wrote and nothing else" — not the brief. **A subagent's own report that its work is correct is not evidence** [§4/L3: false positives 0.719 → 0.012]. A failed slice is redone by the orchestrator, and counts as a repair round.

**`g-fanout-partition` is the only fan-out gate (D-058).** After every merge, `git diff --name-only` must be a subset of the union of that WP's declared globs in `fanout.json`, and the globs must be pairwise disjoint. **`g-fanout-discipline`'s "no commit may touch two of `compile/`, `verify/src/`, `.claude/hooks/`, `plugins/*/skills/`" rule is deleted** (`DECISIONS.md` row `Gate removal: g-fanout-discipline two-directory rule`): it forbids WP-1, WP-5, WP-7a and WP-3a, every one of which legitimately writes both an implementation and the gate that polices it, and the anti-pattern it targeted is already covered by the declared-glob partition proof.

---

### 5.6 Budget and scope guardrails

**Scope does not expand mid-session (D-051).** Anything not in `session-scope.json` goes to `/BACKLOG.md` and nowhere else: better ideas found while reading code, generalisations that "would only take a minute", a fifth tier, a second brand's token file, a nicer CLI, a refactor of a file the current WP merely reads.

`g-backlog` fails when a row's `Blocks anything?` is not `No` (a blocking item is either in scope or the session is stopped), when a row lacks `Raised in WP`, or when a row's `Acceptance` cell is empty.

**The 3-round repair cap (D-052).** At most 3 repair rounds per gate per WP. A round is: read the failure, form one hypothesis, make one change, re-run the gate. *Justification:* UI2Code^N measures visual-refinement gains saturating at N=3–5; SpecBench found more search iterations do not reliably remove reward hacking and sometimes amplify it [§4/L4]. A fourth round is where the session starts adapting the test to the code [§1.7 T7, T14].

At round-3 failure, choose exactly one and record it in `BUILD-LOG.md`:
- **(a)** the gate is right, the design is wrong → the WP is blocked: `BLOCKED.md` row, `Status: partial-blocked`, revert to `lastGreenCommit`, evaluate S2;
- **(b)** the gate is wrong → fix the gate **and its mutation** in the same commit, as a `[fix]` with its own DECISIONS row. Loosening a gate without a mutation proving the new boundary is illegal [§1.7 T2];
- **(c)** silence the gate → **banned**, S7.

Three gates at round 3 inside one WP is itself a checkpoint event: the WP is mis-specified, and the correct action is a split.

**Budget checkpoints.** Envelope **1,200 steps / 3.0 M tokens**. At 25 / 50 / 75 / 90% of either, run:
```bash
node -e "const s=JSON.parse(require('fs').readFileSync('.build/state.json','utf8'));const n=require('./packages/verify/config/session-scope.json').wps.length;const d=s.wpOrder;console.log('WP',d+'/'+n,'| steps',s.budget.stepsUsed+'/'+s.budget.stepsBudget,'| tokens',s.budget.tokensUsedM+'M/'+s.budget.tokensBudgetM+'M','| burn',((s.budget.stepsUsed/s.budget.stepsBudget)/(d/n)).toFixed(2))"
npm run green:fast ; echo "green:fast exit=$?"
```

| Burn ratio | Action |
|---|---|
| ≤ 1.15 | Continue |
| 1.15 – 1.40 | Continue, dropping optional scope inside remaining WPs in this order and no other: WP-3a's 6 `coverage/` fixtures beyond the 4 named → the 4 `clean/` fixtures beyond the 6 named → WP-2's `enums.json` beyond the domains the 13 priority types need. Each drop is a `BACKLOG.md` row |
| > 1.40 | **S4** |

**At 90% of either budget, S4 fires unconditionally.** The session's last act is always a commit plus `npm run prove` (or `--partial`) — never an in-flight WP.

**Never dropped, at any burn ratio:** WP-0's eight gates, WP-1's Q1/Q2, the mutation on any gate, the coverage rules, `BUILD-LOG.md` / `BLOCKED.md` upkeep, §5.10.

---

### 5.7 Blocked-path fallbacks

Every blocked path produces a `/BLOCKED.md` row. No exceptions, no silent degradation.

```markdown
| ID | WP | What is blocked | Evidence (command + observed output) | Degraded state (tier/gate + verdict) | Unblock action | Recorded |
|----|----|----|----|----|----|----|
| B3 | WP-2a | shesha-framework unreachable | `npm ping` -> `ENOTFOUND` | registry provenance=derived-from-kb; all 121 names-only; T2.07/T2.08 uninspectable | `extract.mjs --from .build/framework` | 2026-08-17 |
```

`g-blocked-honesty` (ships in WP-2, whose data first degrades) cross-checks both ways and fails on either asymmetry: every row must name a tier/gate **currently** reporting `uninspectable` / `notRun` / `pending-probe`; every such state in committed fixtures, `probes/results/**` and `DECISIONS.md` must have a row.

| ID | Blocked path | **Do this** | **Never do this** |
|---|---|---|---|
| **B3** | Framework source unreachable | (1) `git clone --filter=blob:none --depth 1 --branch releases/0.45 https://github.com/shesha-io/shesha-framework .build/framework` then `extract.mjs --from .build/framework`. (2) If P7 said `net none`: `extract.mjs --from-kb packages/registry/data/components-kb --provenance derived-from-kb-pending-BL-004`, `commit:null`. `g-registry-provenance` accepts a null commit only with that exact provenance string **and** a B3 row **and** DECISIONS `Status: pending-probe`. Every prop is `valueType:null, valueTypeSource:"unknown"`; `propsCompleteness:"names-only"` for all 121; T2.07/T2.08 dispose every affected site `uninspectable` | Never invent a version integer [§1.2#11]. Never write a machine-local `sourceDir` [§1.7 T12] — `g-registry-provenance` fails on `[A-Za-z]:/`. Never let a `null` version compile to a stamped node: `STM-5201` is a hard error, so the screen fails to compile rather than compiling wrong |
| **B7** | No registry access, warm `node_modules` present | Use `npm ci --offline` everywhere `npm ci` appears. Record the installed `ajv` / `typescript` versions from `node_modules/*/package.json` in the row's Evidence cell | Never proceed without a committed `package-lock.json` — that is S0 |
| **B8** | The six out-of-scope corpus forms | Decompile each, print its structural-escape count, triage each escape, report the form **`uninspectable`** in the round-trip report. They are outside `roundtrip-scope.json`, so they cannot move the rate | Never add them to `roundtrip-scope.json` to change the number. Never edit or delete a corpus form — `g-corpus-immutable` holds a SHA-256 manifest and fails on any change or removal |
| **B9** | A scoped corpus form will not round-trip | Triage into exactly one bucket with evidence: `compiler-gap` → a `BACKLOG.md` `GAP-<nnn>` row plus a failing fixture under `packages/sfs/tests/gaps/` marked `test.todo` naming that id; or `promote-to-sfs` → a `BACKLOG.md` row with prop names and the count of forms needing it. Then: rate ≥ 0.90 (≤ 1 failure of 6) ⇒ proceed. Rate < 0.90 ⇒ up to **2** repair rounds on the highest-count `compiler-gap`; still short ⇒ **S5** | Never lower the 0.90 constant [§6 Phase 2]. Never leave a failure untriaged — `roundtrip.test.mjs` fails on that. Never chase byte-equality with the original form: it carries the defects, and equality with it would enshrine them |
| **B10** | The 15 moved `verify-artifact` tests fail after a change | (1) `git stash` the change and confirm the 15 pass — this isolates cause. (2) Reproduce as a minimal fixture. (3) If the failing assertion encodes behaviour a `DECISIONS.md` row now forbids, that is the only legal path: add a row beginning `Test change:`, add the new behaviour as a **new** test, keep the old assertion alive behind `--legacy`, and let the count go 15 → 17. It never goes down. (4) Otherwise the change is wrong; fix it | Never `.skip`, `--test-skip-pattern`, `process.exitCode = 0`, `\|\| true`. Never `test.todo` outside `packages/sfs/tests/gaps/`. Never edit an assertion to match new output. Never delete a test to go green. All are `g-no-gate-tampering` and S7 |

**Ratchets count only artefacts with ≥ 1 verdict-flipping mutation.** A gate or test that cannot fail was never in the count, so a deletion under S6 lowers the floor in the same commit citing a `Gate removal:` row, and `g-no-gate-tampering` accepts it by that literal prefix. Any other lowering is S7.

---

### 5.8 Stop conditions

| ID | Condition | Action |
|---|---|---|
| **S0** | P1, P2, P4, P5 or P6 fails | Do not start. Report the failing precondition and the exact fixing command. Write nothing to the repo |
| **S1** | WP-1 Q1 or Q2 not achieved after 3 repair rounds | `FINDINGS.md`: first divergent byte index, the construct, which program is wrong and why, and whether it is a normalisation gap or an IR expressiveness gap. Commit `[chore]- WP-1 record NO-GO`. **Do not start WP-2** [§6 Phase 1] |
| **S2** | A WP is `partial-blocked` and a later in-scope WP depends on it | Stop. Commit the blocked state. `npm run prove -- --partial`. Report the severed chain. Do not attempt the dependent WP |
| **S3** | `green:fast` red on 3 consecutive commit attempts in one WP | `git reset --hard <lastGreenCommit>` — the only legal hard reset, and only to that sha. Record in `BLOCKED.md`. Re-approach as a split with `session-scope.json` edited first |
| **S4** | Either budget at 90%, or burn ratio > 1.40 at a checkpoint | Finish the current WP only. Commit. `npm run prove -- --partial` → exit 3, `SESSION INCOMPLETE`. Report completed and remaining ids |
| **S5** | Scoped round-trip rate < 0.90 after 2 repair rounds | Stop. This falsifies the IR's expressiveness at the level §8 row 1 cares about. `FINDINGS.md` with the `promote-to-sfs` list sorted by form count — that list is the redesign brief. Do not proceed to WP-7a |
| **S6** | A gate cannot be made to fail on its own declared mutation | The gate is theatre [§1.7 T2]. Either make the mutation flip it, or delete it in the discovering commit with a `Gate removal:` DECISIONS row. **Never commit it.** A gate that cannot fail is worse than no gate [§1.4] |
| **S7** | Any attempt to satisfy a gate by weakening it, skipping a test, bypassing a hook, or editing an expected-output file without a `Threshold change:` / `Test change:` / `Gate removal:` / `Scope change:` row | Revert immediately (`git checkout -- <paths>`), record it in `BLOCKED.md` with the reverted diff, re-approach under §5.6(a)/(b). This is the one failure mode the whole rebuild exists to make impossible |

---

### 5.9 The anti-drift checklist — run before the final commit

Sixteen verifications, every one a command. Run them in order in the repo root. Their observed output goes to `packages/verify/evidence/WP-10.json`, which `npm run green` writes and `g-commit-format` verifies — **not** into a commit body you typed.

```bash
# 1. Green from a clean install, with mutations. [§1.4: npm test ran only the positive suite]
npm ci && npm run green ; echo "1 exit=$?"                        # expect 0

# 2. green cannot have been quietly narrowed. [§1.7 T7]
node -e "const s=require('./package.json').scripts;for(const k of ['typecheck','test','gates'])if(!s['green:fast'].includes(k))throw new Error('green:fast missing '+k);if(!s.green.includes('gates:mutate'))throw new Error('green missing gates:mutate');console.log('2 ok')"

# 3. Every declared mutation is caught, within the time ceiling. [§5: the negative test generalised]
npm run gates:mutate 2>&1 | tail -2      # expect "mutations: N declared, N caught, 0 escaped" then "<S> seconds (ceiling 180)"

# 4. No documented command is unexecutable. [§1.7 T1: summarize.js died at line 15 on every call]
node packages/verify/src/gates/g-commands-executable.mjs ; echo "4 exit=$?"   # expect 0

# 5. No verdict may be "warn"; no module exits pass with failures recorded. [§1.4: 0 fails, 136 warns, exit 0]
node packages/verify/src/gates/g-exit-codes.mjs ; echo "5 exit=$?"            # expect 0

# 6. Coverage accounting and the walker are each defined exactly once. [§1.4: five walkers, three unwrappers]
git grep -ln 'function verdictOf' | tee /dev/stderr | wc -l                   # expect 1 = packages/registry/src/coverage.mjs
git grep -ln 'function walkComponents' | tee /dev/stderr | wc -l              # expect 1 = packages/verify/src/walk.mjs

# 7. Prose budgets hold, and the tier-A set is the declared cardinality. [§0: Anthropic caps at 500 lines; yours was 378 lines / 47KB]
node packages/verify/src/gates/g-prose-budget.mjs ; echo "7 exit=$?"          # expect 0
node packages/verify/src/gates/g-brief-budget.mjs ; echo "7b exit=$?"         # expect 0

# 8. References are one level deep. [§0: deeper nesting silently truncates]
git ls-files 'plugins/*/skills/*/references/**' | awk -F/ 'NF>6' | wc -l       # expect 0

# 9. No changelog archaeology in any instruction file, DECISIONS.md included. [§1.2: ~4KB in one SKILL.md + 12 passages]
git grep -nEi '(used to|previously|no longer|has been (fixed|corrected|removed)|in an earlier version|do not (correct|fix) (this|the above))' \
  -- 'plugins/shesha-developer/skills' 'plugins/framework-dev' DECISIONS.md | wc -l   # expect 0

# 10. No literal hex in authored source or skills. [§1.2#13: 48 literal hexes vs 10 $role: references]
git grep -nE '#[0-9a-fA-F]{3,8}' -- packages/sfs/src packages/sfs/recipes plugins \
  ':!*.md' ':!**/*.expected.form.json' ':!**/corpus/**' ':!**/fixtures/legacy/**' | wc -l   # expect 0

# 11. Every $role: in a clean fixture resolves in the token file. [§1.4: bake-overlays wrote "$role:doesNotExist" as a colour]
node -e "const fs=require('fs'),g=require('glob');const t=require('./packages/registry/data/tokens/shesha.json');let bad=[];for(const f of g.sync('packages/sfs/test/fixtures/clean/*.sfs.json')){for(const m of fs.readFileSync(f,'utf8').matchAll(/\\\$role:([A-Za-z0-9_.-]+)/g)){if(!m[1].split('.').reduce((o,k)=>o&&o[k],t))bad.push(f+' '+m[0])}}if(bad.length)throw new Error(bad.join('\n'));console.log('11 all $role: resolve')"

# 12. No version integer or prop list has leaked into an instruction file. [§1.2#11: collapsiblePanel 8-vs-9, gate said PASS]
node packages/verify/src/gates/g-skill-purity.mjs ; echo "12 exit=$?"          # expect 0

# 13. Every DECISIONS row names a resolvable enforcer; every gate has a mutation; every check id has a fixture. [§2 RC2, §1.7 T2/T11]
node packages/verify/src/gates/g-decisions.mjs && node packages/verify/src/gates/g-gate-contract.mjs \
  && node packages/verify/src/gates/g-mutation-coverage.mjs && node packages/verify/src/gates/g-fixture-manifest.mjs ; echo "13 exit=$?"   # expect 0

# 14. The compiler is deterministic, clock-free, and the only writer of markup. [§4 L2; §1.7]
node packages/verify/src/gates/g-determinism.mjs && node packages/verify/src/gates/g-markup-provenance.mjs \
  && node packages/verify/src/gates/g-artifact-naming.mjs ; echo "14 exit=$?"   # expect 0
git grep -nE 'Date\.now|new Date|Math\.random|randomUUID|randomBytes|performance\.now|process\.hrtime' -- packages/sfs/src | wc -l   # expect 0

# 15. Deletions exactly as §5's disposition table says; no dangling references; no machine-local paths; clean tree; every degrade declared.
node packages/verify/src/gates/g-disposition.mjs && node packages/verify/src/gates/g-blocked-honesty.mjs ; echo "15 exit=$?"  # expect 0
git grep -n 'summarize\.js\|validate-blocks\.js\|bake-overlays\.mjs\|shesha-form-edit' -- . ':!docs' ':!DECISIONS.md' ':!BUILD-LOG.md' ':!BACKLOG.md' | wc -l   # expect 0
git grep -nE '[A-Za-z]:/' -- . ':!docs' | wc -l                               # expect 0
git ls-files --error-unmatch .claude/settings.local.json 2>/dev/null ; echo "15d exit=$? (expect non-zero: not tracked)"
git status --porcelain | wc -l                                                # expect 0

# 16. The proof. [§5.3]
npm run prove ; echo "16 exit=$?"     # expect 0, last line "SESSION COMPLETE — SCOPE A"
```

**If any item 1–15 does not produce its expected output, item 16 is not run.** Fix the item, or record a `BLOCKED.md` row and accept a non-`SESSION COMPLETE` last line. There is no third option, and in particular no option where the session reports success on the strength of its own summary. The pre-rebuild repository passed every green signal it had [§1.4].

---

### 5.10 BACKLOG seed — written in WP-0, before any of it is tempting

`g-backlog` requires every row to carry `Raised in WP`, `Blocks anything? = No`, and a non-empty `Acceptance` cell copied verbatim from the section that owns it.

| ID | Item | Owner section | Why not this session |
|---|---|---|---|
| BL-001 | Three-arm SAA comparison (current pipeline vs SFS+frontier vs SFS+local, 8–10 cases) and the token/step cost claim | §6 Phase 1 item 3 | Needs a live backend and the pre-rebuild pipeline runnable side by side (B1). A step count parsed from prose the session is deleting is not a measurement [§1.7 T15] |
| BL-002 | Round-trip ≥ 0.90 over all 12 corpus forms | §2.5 | The 6 large forms (198–713 KB) need node kinds beyond WP-5's set; measured in WP-5 as `uninspectable` with per-form escape counts (B8) |
| BL-003 | WP-3b: T3's 22 checks, placement predicates, `verify-artifact.mjs` and `check-references.mjs` fixed and un-quarantined, `expectEmpty` family disposition for `overlays`/`versions` | §3.3, §3.4 | 52 artifacts; needs T2 landed first. `quarantine.json` names BL-003 as `liftedBy` |
| BL-004 | Registry `propsCompleteness: full >= 93 of 121` from framework TypeScript at a pinned ref | §2.8 | 2,400+ prop annotations; not derivable offline (B3) |
| BL-005 | WP-3c/3d: T4 live smoke, T4b DOM residue, T5 advisory. Requires `npx playwright install chromium` (no `--with-deps`; that flag is Linux-only) as an operator step | §3.5, §3.6 | No browser or backend in this session (B1/B2) |
| BL-006 | Real 23-field envelope validation against a backend export | §2.1.2 | Every seed on disk is bare `{components, formSettings}`; WP-1's envelope is `ENVELOPE-SYNTHESISED` and T1's `file` family reports it `uninspectable` |
| BL-007 | Rewrite the three existing design skills thin (`shesha-claude-designer` → `shesha-designer`, `shesha-design-comprehension`, `shesha-design-system`) | §4.4 | WP-7a ships the deletion and one new skill; the rewrites need T3's error vocabulary |
| BL-008 | WP-8: `.claude/hooks/**`, `.mcp.json`, the three agent roles, `enabledPlugins` wiring | §4.3, §4.1 | Claude Code reads hook and MCP configuration at session start; hooks written mid-session cannot govern the session that wrote them. Verification requires a **restart** |
| BL-009 | WP-9: precedent retrieval, shape-indexed. Store is one JSONL + a `Float32Array` `.bin` sidecar, brute-force scanned — **not** `node:sqlite`, which needs `--experimental-sqlite` on Node 22 | §4.7 | Depends on BL-002's corpus and BL-008's MCP surface |
| BL-010 | Restart verification checklist: plant a `.form.json` Write and observe the denial; call `mcp__shesha-sfs__registry_lookup`; dispatch `sfs-specwriter` | §4.8 | Requires a fresh session after BL-008; recorded in `BUILD-LOG.md` by the operator |
| GAP-nnn | Compiler gaps discovered in WP-5 triage | §2.5 | Each carries a `test.todo` fixture under `packages/sfs/tests/gaps/` naming its id |

---

### 5.11 DECISIONS.md rows this section adds

Eight-cell format per §1.4. Ids **D-040 … D-058**. Every `Enforced by` uses one of the four forms of §5.2.

| ID | Decision | Why | Enforced by |
|---|---|---|---|
| D-040 | §5.1's conflicts 1, 2, 4, 5, 6, 7, 9, 11 resolve as stated; the losing spelling is a typo wherever it appears in the brief | Two authors of one brief disagreed on thirteen paths and cadences; choosing at the point of use is how the three-way reflist split was created | `g-decisions`, `g-workspace-hygiene`, `g-plugin-version` |
| D-041 | All of §3.1.2 is defined once in `packages/registry/src/coverage.mjs`; `verify` and `sfs` re-export it with one `export *` line; `walkComponents` lives only in `packages/verify/src/walk.mjs` and is exempt from the re-export rule | §1.4's five walkers and three unwrappers; the arrow `registry <- sfs <- verify` forbids the compiler importing the verifier | `g-coverage-single-impl`, `g-workspace-hygiene` |
| D-042 | WP-0 writes the whole coverage API with ≥ 14 tests; WP-3a adds `walk.mjs` and unit-typed families, not a second copy | A partial API written twice is the drift generator this rebuild removes | `check:coverage.test:count-ratchet` |
| D-043 | The brief is committed under `docs/rebuild-brief/`, outside `g-prose-budget` and `g-commands-executable`, inside `g-brief-budget` | A session that loses the brief to a reset has no source of truth; `docs/**` is not prompt payload | `g-brief-budget` |
| D-044 | Exactly four artifact names: `<screen>.form.json`, `<screen>.compile.json`, `<screen>.form.meta.json`, `<screen>.sfs.meta.json`; blessed fixtures are `<screen>.expected.form.json`; `.compiled.json` is banned | Three names for two artifacts were embedded in command lines the session would paste | `g-artifact-naming` |
| D-045 | `Enforced by` has four legal forms: gate id, `structural:`/`hook:` path, `check:<tier>:<id>`, `scheduled:<WP\|BL>:<id>` — the last only while its WP is incomplete | A row naming a gate that cannot yet exist forced WP-0 to ship gates that check nothing — the exact pattern the brief exists to eliminate | `g-decisions` |
| D-046 | The brief is split by reader: `CONTROL.md` ≤ 25,600 B is the only turn-zero read; the bundle ≤ 61,440 B; every > 8-row table becomes `data/*.json`; every literal file becomes `artifacts/<file>`; 0 fenced blocks > 40 lines | 322,816 B of prose against a ~100–150 constraint ceiling is RC2; a 450 KB brief reproduces it one level up | `g-brief-budget` |
| D-047 | A mutation copies only that gate's declared `inputPaths[]` to a temp dir and junction-links the root `node_modules`; the suite has a 180 s asserted ceiling; `green:fast` (no mutations) runs in pre-commit, full `green` in `prove` and CI | 110+ full-repo copies on NTFS with Defender is tens of GB per commit; a slow gate is a gate bypassed with `--no-verify` | `check:mutation-meta:budget`, `g-gate-contract` |
| D-048 | `npm run green` writes `packages/verify/evidence/<WP>.json`; `g-commit-format` regenerates it in `commit-msg` and fails on staleness or on any commit-body number that disagrees. No criterion is satisfied by a typed number | A commit body a gate blesses is a self-report, which is the "agents over-praise their own outputs" failure the plan cites twice | `g-commit-format` |
| D-049 | `verify-artifact.mjs` and `check-references.mjs` move unchanged, are referenced by nothing, and are registered in `quarantine.json` with `liftedBy: BL-003` | §6 Phase 0 wants the bleeding stopped now, but the correct fixes need T2/T3; a holed gate must not emit a green signal meanwhile | `scheduled:BL-003:g-quarantine`, §5.9 item 15 |
| D-050 | `cost-delta` gates exactly two recomputable byte counts — `emittedBytes` (floor 10×) and `preloadBytes` (floor 5×). `steps`, tokens and tool calls are deleted from the gate and moved to BL-001; `prove` prints `token cost: unmeasured in this session` | §7's savings are hypotheses the harness will grade; a ratio derived from prose the session is deleting is §1.7 T15 | `g-cost-delta`, `g-backlog` (BL-001 exists) |
| D-051 | Scope is `packages/verify/config/session-scope.json`, eight WP ids; narrowing needs a `Scope change:` row; everything else is a `BACKLOG.md` row with its acceptance command copied verbatim | The alternative is discovering at 100% of budget that the compiler was never reachable — the maximal-theatre outcome: more green signals than the pre-rebuild repo and less working code | `g-backlog`, `g-no-gate-tampering`, `structural:packages/verify/src/prove.mjs` |
| D-052 | Repairs on one gate in one WP are capped at 3 rounds; at round 3 the choice is block the WP or fix the gate **with its mutation** — never silence it | UI2Code^N saturation at N=3–5; SpecBench found more iterations sometimes amplify reward hacking | `g-no-gate-tampering`; `repairRounds` in `BUILD-LOG.md` |
| D-053 | SFS gains the node kinds `childTable`, `kib`, `tags`, `attachments`, `picker`, `select`, and `field` as the catch-all for every registry type with `isInput: true` | §2.1.4's 17 kinds cover none of what the corpus is made of; without these, every real form is almost entirely structural `raw:` and the escape budget cannot pass | `g-escape-budget`, `check:t2-registry:T2.04` |
| D-054 | Round-trip is gated at ≥ 0.90 over the six declared forms in `roundtrip-scope.json`; the other six are decompiled, triaged and reported `uninspectable` with a B8 row; the full-corpus gate is BL-002 | A 0.90 gate over 12 forms whose kinds do not exist yet is unachievable, and an unachievable gate is either lowered under pressure or severs the dependency chain | `g-escape-budget`, `check:roundtrip:scope`, `g-corpus-immutable` |
| D-055 | `forbidden` in `form-settings.json` means "forbidden with a non-null value": fail iff the key is present and not `null`; fail on any key outside `allowed ∪ forbidden` | §2.1.3 emits `onBeforeDataLoad: null` for every kind, which a literal reading of T2.20 would fail on the one artifact everything is measured against | `check:t2-registry:T2.20` |
| D-056 | A pointer is `uninspectable` only when its type is in the artifact, its registry entry is incomplete, and the type is non-priority; a priority type with an incomplete entry is a `fail`. The predicate lives in `coverage.mjs` | Otherwise every screen containing a `datatable` is permanently `partial`, and the only release valve is widening the gate — the tampering path the plan bans | `check:t2-registry:T2.07`, `g-coverage-single-impl` |
| D-057 | After any context reset the session runs the five recovery commands and reads `CONTROL.md` before acting; `green:fast` outranks any recorded claim of completion | Memory after compaction is the least reliable input available | `structural:docs/rebuild-brief/CONTROL.md`, §5.9 item 1 |
| D-058 | Fan-out only for disjoint-write, no-shared-invariant, program-verifiable, enumerable slices, max 4 agents; subagents never commit and never mutate `node_modules` or the git index; a self-report is not evidence. `g-fanout-discipline`'s two-directory rule is deleted — see the `Gate removal:` row | §4/L4 excludes shared-context coding from multi-agent gains; two parallel authors already shipped two incompatible `refListStatus` shapes. The two-directory rule forbade four of the eight in-scope WPs | `g-fanout-partition` |
| — | `Gate removal: g-fanout-discipline two-directory rule` | It failed every commit that ships an implementation together with the gate policing it, i.e. WP-1, WP-5, WP-7a and WP-3a | `g-no-gate-tampering` (accepts by the literal prefix) |
