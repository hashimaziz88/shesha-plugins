## Section 4 — Agent harness: .claude setup, hooks, agents, skills, MCP

This section specifies the **operating layer**: the three agent roles, the run directory, the handoff schemas, the hooks, the four rewritten skills, the MCP tool surface, the fan-out rule, and the precedent index.

Authority: strategy doc §4/L4 (three-role harness, thin skills, hooks, MCP surface, "on parallel subagents: don't"), §4/L3 (judge independence, 3-round cap, T5 anchor protocol), §4 "Where RAG belongs — and where it does not", §5 (disposition: handoff contract → schemas; `test-env-rules.md` amendment), §6 Phase 4, Appendix A items 2–5, Appendix B item 2. Cited inline as `[§x]`.

**The rule this section is written under.** Every constraint below is (a) a JSON Schema, (b) a `decide()` function in `.claude/hooks/*.decide.mjs` that returns `deny`, (c) a tool allowlist in agent frontmatter that Claude Code enforces, or (d) a gate in `packages/verify/src/gates/`. **This section contains no rule addressed to a model's memory.** Every "Hard stops" prose block in the previous draft of the agent files is deleted: a rule that has an enforcer does not need restating, and a rule that has no enforcer is not a rule.

**In-session vs out-of-session, decided once, because it governs every acceptance row below.** Claude Code reads `.claude/settings.json`, `/.mcp.json` and plugin registration **at session start**. A hook written in this session is not active in this session. An MCP server written in this session is not connected in this session. An agent added to `plugins/shesha-developer/agents/` in this session is not dispatchable in this session. Therefore:

- **In-session proof (WP-8)** = the hooks are proved as **programs**: `hooks.test.mjs` imports each `decide(payload, ctx)` and asserts the returned decision, and spawns each runner once with a literal stdin payload asserting exit code and stdout. The MCP tools are proved as **ESM modules** and as **CLI subcommands**. The agent files are proved as **files** (`g-agent-contract`).
- **Out-of-session proof (WP-11, §4.9)** = a written operator checklist run in a **fresh session after restart**, its observed output pasted into `BUILD-LOG.md`. Nothing in `npm run prove` reads WP-11.

There is no acceptance row anywhere in this section that requires a live hook, a connected MCP server, or a dispatched subagent inside the authoring session.

---

### 4.0 Work packages, scope, and what this section defers

WP numbering is §5.2's. One commit per WP, per §1.5.

| WP | Deliverable | Blocked by | Acceptance |
|---|---|---|---|
| **WP-7** | Four skills rewritten thin; `prose-budget.json` tier-A retargeted | Section 2 (compiler), Section 3 (tiers) | §4.8 rows 9–11 |
| **WP-8** | Run dir + 7 handoff schemas + 6 hooks (runner/decide split) + `.claude/settings.json` + `/.mcp.json` + 3 agent files + `packages/mcp` (7 tools, 3 transports) | WP-7 | §4.8 rows 1–8, 12–13 |
| **WP-9** | `packages/precedent` — Index A (deterministic shape index) only | WP-8 | §4.8 rows 14–15 |
| **WP-10** | Integration: one 3-screen run driven from the CLI (no subagents), `sfs run report` | WP-9 | §4.8 row 16 |
| **WP-11** | **Operator, out of session.** Restart verification checklist (§4.9) | WP-10 | §4.9; recorded in `BUILD-LOG.md` |

**Deferred to `BACKLOG.md` by this section** (each with its acceptance command copied verbatim into the BACKLOG row):

| Id | Deferred | Why |
|---|---|---|
| BL-H1 | Precedent **Index B** (embeddings): JSONL corpus + `Float32Array` `.bin` sidecar, brute-force cosine. **No `node:sqlite`** | `node:sqlite` requires `--experimental-sqlite` on the pinned Node 22.14 (`import { DatabaseSync }` throws `ERR_UNKNOWN_BUILTIN_MODULE` unflagged); and the model download is an operator step with no offline path. DECISIONS row required: `D-0NN node:sqlite rejected for the precedent store — flag-gated on Node 22; Index B is JSONL + .bin`. Index A answers every in-session call |
| BL-H2 | Error-catalogue RAG + retrospective ingestion + `g-retro-ingested` | `docs/retrospectives/` does not exist in the repo. A gate over an empty directory is banned behaviour T7. `g-retro-ingested` is **deleted from the brief**, not written and disabled |
| BL-H3 | T5 live judge protocol (`design-critic` invocation, anchor test, `judge/*.anchor.json` production) | Needs a second model and a restart. The `design-critic.md` **file** is still rewritten in WP-7; T5 is advisory-only (D-015) so nothing downstream waits on it |
| BL-H4 | The three-arm token measurement of a real run | Requires a live session with the harness connected. `report.md` prints `tokens: unmeasured in this session` |

---

#### 4.0.1 Three naming reconciliations, decided here

1. **CLI invocation.** Every command line in this section is `npm run sfs -- <subcommand>` at an operator prompt, and `node packages/sfs/bin/<bin>.mjs <subcommand>` inside any program (hooks and gates never spawn `npm`: on Windows `npm` is `npm.cmd` and `spawnSync('npm', …)` without `shell:true` fails, and `shell:true` in a hook is a command-injection surface). Hooks spawn `spawnSync(process.execPath, [<absolute script path>, …], {shell:false})`.
2. **Compiled artifacts.** `<screen>.form.json` (the markup envelope; only the compiler writes it) and `<screen>.compile.json` (Section 2's compile report). No third schema for compiled output. This section adds `plan.json`, `manifest.json`, `<screen>.sfs.meta.json`, `dispatch/*.json`, `<screen>.verdict.json`, `locks/*.lock`, `blueprints/*.blueprint.json`.
3. **Registry location.** Nothing in this section reads registry files by path — access is `registry_lookup` (MCP/ESM) or `npm run sfs -- registry <q> --json`.

**Two additions to Section 2's CLI surface this section requires:** `validate --schema <name> --file <path> --json` (schema-only; no registry, no backend, **writes nothing**) and `run <init|advance|lock|release|report>`.

---

### 4.1 The three-role harness

#### 4.1.1 Role boundaries and their enforcers

| Role | Writes | Enforced by |
|---|---|---|
| **Planner** | `plan.json`, `logs/planner-*.md` | `tools:` has no `Bash`; `enforce-screen-lock.mjs` L1 requires `locks/plan.lock` with `role: "planner"`; `block-form-writes.mjs` R5 denies every other run-dir path |
| **Specwriter** | `screens/<screen>.sfs.json`, `screens/<screen>.sfs.meta.json`, `logs/specwriter-*.md` | `tools:` has no `Bash`, no `push`; `enforce-screen-lock.mjs` L2/L3 bind the write to a lock naming that screen with `role: "sfs-specwriter"`; `block-form-writes.mjs` R1 denies markup writes, R4 denies markup **reads** while any specwriter lock is open |
| **Evaluator** | nothing directly; `verify` writes `<screen>.verdict.json` | `tools:` has no `Write`, no `Edit`, **no `Bash`**; `block-form-writes.mjs` R7 denies reads of `logs/**` and `*.rationale.*` while an evaluator lock is open; `gate-dispatch.mjs` D3 denies a dispatch naming those paths |

**Specwriter markup-blindness — three enforcements, and `session_id` plays no part in any of them.** Claude Code does not guarantee that a subagent's hook payload carries the conductor's `session_id`, so any rule keyed on `session_id` equality is a rule whose branch is never exercised. Removed from `lock.schema.json` and from every decision:

1. `tools:` excludes `Bash`, so it cannot `cat` a form file. Claude Code enforces this.
2. `block-form-writes.mjs` **R4**: while **any** lock file under `runs/<activeRunId>/locks/` has `role: "sfs-specwriter"`, a `Read` of `**/*.form.json`, `**/*.expected.form.json` or `packages/sfs/corpus/**/*.json` is denied `HOOK-0104`. Not scoped by session; scoped by "a spec is being written in this run".
3. `g-specwriter-purity` scans every `logs/specwriter-*.md` under `runs/**` and `packages/verify/test/fixtures/run/**` and hard-fails on any of `parentId`, `componentName`, `"desktop":`, `stylingBox`, `_type":"action-config`, or a `version:` integer within 40 characters of a `type:`. Findings are a `[fix]` WP, not a warning.

**Evaluator independence** — the measured 0.719 → 0.012 false-positive effect `[§4/L3]`, enforced by five mechanisms, **all programs**:

1. No `Bash` in `tools:`. It needs none: `verify` is an MCP/ESM tool and every input is a file it holds `Read` for.
2. `block-form-writes.mjs` **R7**: while any `runs/<activeRunId>/locks/eval-*.lock` exists, deny `Read` of any path matching `runs/[^/]+/logs/` or `\.rationale\.`, and deny `Bash` whose command contains a token matching either or the literal `__SAA_RESULT__`. Code `HOOK-0106`.
3. `gate-dispatch.mjs` D3 validates the dispatch against `dispatch.schema.json`, whose `paths[]` items carry `not: {pattern: "(^|/)logs/|\\.rationale\\.|__SAA_RESULT__"}`. A dispatch naming a log path cannot validate, so it cannot be issued.
4. `__SAA_RESULT__` is removed from the evaluator input path — the `test-env-rules.md` amendment `[§5]`. `g-judge-isolation` greps every file under `plugins/**` and `packages/**` for a string literal containing `__SAA_RESULT__` within 400 characters of `sfs-evaluator` or `design-critic` and fails on a hit.
5. `verify` seals: `sealedAt` + `inputs.{formSha256,sfsSha256,compileSha256}`, and `manifest.json.screens[<s>].verdictSha256`. `g-verdict-integrity` recomputes (§4.3.8).

**No contract ⇒ no SFS.** `enforce-screen-lock.mjs` L5 denies a write to `screens/<screen>.sfs.json` unless `plan.json` exists, validates, contains a screen with that `name`, and that screen has `contract.signedOffAt != null` and `contract.predicates.length >= 3` with ≥1 `tier: "T3"`.

#### 4.1.2 The three agent files — frontmatter, literally

Path: `plugins/shesha-developer/agents/<name>.md`. Each file ≤ **4096 bytes**, added as tier-B rows in `prose-budget.json`. `sfs-specwriter.md` is created by `git mv plugins/shesha-developer/agents/form-author.md …` and `sfs-evaluator.md` by `git mv …/form-auditor.md …`, then the body is replaced entirely.

| Field | `sfs-planner` | `sfs-specwriter` | `sfs-evaluator` |
|---|---|---|---|
| `name` | `sfs-planner` | `sfs-specwriter` | `sfs-evaluator` |
| `model` | `inherit` | `inherit` | `inherit` |
| `maxTurns` | `60` | `45` | `30` |
| `color` | `cyan` | `blue` | `yellow` |
| `tools` | `Read, Write, Grep, Glob, mcp__shesha-sfs__registry_lookup, mcp__shesha-sfs__metadata_entity, mcp__shesha-sfs__precedent_search` | `Read, Write, Grep, Glob, Skill, mcp__shesha-sfs__compile, mcp__shesha-sfs__registry_lookup, mcp__shesha-sfs__metadata_entity, mcp__shesha-sfs__precedent_search` | `Read, Grep, Glob, mcp__shesha-sfs__verify, mcp__shesha-sfs__registry_lookup, mcp__shesha-sfs__metadata_entity` |
| `disallowedTools` | `Bash, Edit, NotebookEdit, mcp__shesha-sfs__compile, mcp__shesha-sfs__push` | `Bash, Edit, NotebookEdit, WebFetch, WebSearch, mcp__shesha-sfs__push, mcp__shesha-sfs__decompile` | `Bash, Write, Edit, NotebookEdit, mcp__shesha-sfs__compile, mcp__shesha-sfs__push, mcp__shesha-sfs__precedent_search` |

`MultiEdit` appears in no list: it is not a tool in current Claude Code. `NotebookEdit` is, and is denied everywhere.

`g-agent-contract` walks **all 6** files in `plugins/shesha-developer/agents/` and asserts, for each: frontmatter `name` equals the basename; `tools` and `disallowedTools` are present and disjoint; no list contains `MultiEdit`; file size ≤ 4096 B; body contains no `## Hard stops` heading. Additionally, for the three roles: `sfs-specwriter.disallowedTools` contains `Bash` and `mcp__shesha-sfs__push`; `sfs-evaluator.disallowedTools` contains `Bash`, `Write` and `Edit`; `design-critic.tools` is exactly `Read`. `inputPaths`: `plugins/shesha-developer/agents/**`. Mutations: (a) add `Bash` to `sfs-evaluator.tools` → fail; (b) rename a file without renaming `name` → fail.

#### 4.1.3 Agent bodies — required content, by section, nothing else

Each body is a numbered procedure plus a fixed return block. **No "Hard stops" section, no restatement of a hook rule, no restatement of a schema constraint.** A denial arrives from the hook with its own corrective command in the reason string; that is the teaching channel.

**`sfs-planner`** — inputs `$RUN_DIR`, `brand`, `backend`. Procedure:

1. Read `brief.md` and every `blueprints/*.blueprint.json`.
2. Enumerate screens: one screen = one Shesha form = one `plan.json.screens[]` row. A dialog is a screen; a row template is not.
3. Set `kind` per screen from the `sfs.schema.json` enum. Record every non-obvious choice in `screens[].decisions[]` with `reason` (`minLength: 12`).
4. `metadata_entity` per entity. `source:"none"` ⇒ `entityStatus:"uninspectable"` and every binding-dependent predicate gets `blockedBy:"metadata"`.
5. `precedent_search` once per screen, `k:3` → `screens[].precedent[]`.
6. Write the contract: ≥3 predicates, ≥1 at `tier:"T3"`. Predicate names come from `registry_lookup {kind:"predicate"}`. A predicate you cannot name goes in `plan.json.gaps[]`.
7. Set `buildOrder` (ties = fan-out slots) and `dependsOn[]`. A navigated-to screen has a lower or equal `buildOrder`.
8. Set `contract.signedOffAt` per screen only after 4–7 are complete for that screen.
9. Write `plan.json`. `validate-sfs-on-write.mjs` validates it and blocks with the validator's diagnostics verbatim on any violation.

Return block, exactly three lines: `plan: <path>` / `screens: <name>:<kind>:<predicateCount>[ · …]` / `gaps: <n>`.

**`sfs-specwriter`** — inputs `$RUN_DIR`, `<screen>`, `round`. Procedure round 1:

1. `Skill` → `shesha-spec`. Open the worked example whose `kind` matches and whose region topology is nearest. That file is the starting point.
2. Read your screen's object in `plan.json`. Every `contract.predicates[]` entry is a thing your SFS must make true.
3. Read each `screens[].precedent[]` SFS. You are adapting a known-good spec.
4. `metadata_entity`. Every `bind` must be a property it returned.
5. `registry_lookup` once, batched: `{types:[…]}`. `authorable:false` ⇒ use the replacement the lookup names.
6. Write the SFS.
7. Write `<screen>.sfs.meta.json`: `round`, `basedOn`, `escapesIntended`, `decisions`, `uninspectable`.
8. `compile {runId, screen}`. Fix at the path each diagnostic names and recompile. Cap **6** compile attempts; at 6, return with the diagnostics verbatim.

Rounds ≥2: read `compile.json.diagnostics[]` and `verdict.json.findings[]` filtered to `owner == "specwriter"`; apply each at its `path`; increment `round`; if the same `code` recurs at the same `path` across two rounds, return `stuck: <code>@<path>`.

Return block: `sfs: <path>` / `compile: <pass|partial|fail> · bytes=<n> · escapes=<n> · structuralEscapes=<n>` / `uninspectable: <n> (<reason>|none)` / `stuck: <code>@<path>|none`.

**`sfs-evaluator`** — dispatched with a `dispatch/*.json` path allowlist. Procedure:

1. Re-open every path in `paths[]`. A missing or unreadable required input ⇒ `verify` is not run and you return `result: fail`, `reason: "input missing: <path>"`.
2. `verify {runId, screen, tiers:["T1","T2","T3"]}` — no backend needed.
3. `verify {tiers:["T4"]}`. Absent backend or absent chromium ⇒ T4 is `uninspectable`; confirm the returned value, do not compute it.
4. T5 runs only if `judge/<screen>.r<n>.anchor.json` exists with `anchorRankedFirst: true`; otherwise T5 is `uninspectable`, `reason:"judge not qualified"`. **T5 never changes `result`** — it lands in `verdict.advisory.t5` only (D-015).
5. **`verify` evaluates every predicate.** You report its results verbatim and may not author, alter or omit a verdict for any predicate the program evaluated. Your only authored field is `findings[].owner`, drawn from `specwriter|planner|compiler|registry|backend|harness`.
6. `verify` writes and seals `verdict.json`. Print the return block; do not restate findings in prose.

Return block: `verdict: <path>` / `result: <pass|partial|fail|refused>` / `tiers: T1=<v> T2=<v> T3=<v> T4=<v> T5=<v>` / `coverage: <family>=<walked>/<checked>/<uninspectable>[ · …]` / `findings: <n> (must=<n> should=<n>)` / `route: specwriter=<n> planner=<n> compiler=<n> registry=<n> backend=<n> harness=<n>`.

**There is no threshold table in the Evaluator body.** `result` is computed by `verify` from T1–T4 and coverage, in `packages/registry/src/coverage.mjs`. The thresholds are: any T1/T2 failure ⇒ `fail`; any T3 failure on a `severity:"must"` predicate ⇒ `fail`; any required family with `walked == 0` ⇒ `fail`; any family with `walked > 0 && checked == 0` ⇒ `fail`; T4 `uninspectable` ⇒ `partial`; all `must` pass with ≥1 `should` failing ⇒ `partial`; otherwise `pass`. They live in one function, `resultFor(tiers, coverage, predicates)`, and `g-verdict-integrity` recomputes them.

#### 4.1.4 The other three agents

| File | Action | Spec |
|---|---|---|
| `design-critic.md` | Keep, rewrite | The T5 judge, invoked by the Evaluator only. `tools: Read` only. Body: the anchor-reference list-wise protocol — the ground-truth design is embedded anonymously among candidates; the judge writes `judge/<screen>.r<n>.anchor.json` **first**; a judge that does not rank the anchor first is disqualified and its ranking discarded. Delete the line "It is measurement; prefer it over your eye" — the probe captures no appearance at all `[§1.3]`. Live operation is **BL-H3** |
| `fleet-transformer.md` | Keep, rewrite | Unit of work becomes the SFS transform: `decompile` → one scripted transform on the SFS → `compile` → diff compile reports. Pilot-first discipline retained verbatim. It has `Bash`; its transform script writing markup at a computed path is caught by `g-markup-provenance`, not by a sentence in this file |
| `fullstack-prereq-checker.md` | Keep, one edit | Output contract becomes `$RUN_DIR/prereq/<entity>.json` (`prereq.schema.json`: `entity`, `modelType`, `endpoints[]`, `refLists[]`, `permissions[]`, `verdict`). Everything else unchanged |

Three `DECISIONS.md` rows required (`agents/**` is absent from §5's disposition table): 3 rewritten with `git mv`, 2 kept-and-rewritten, 1 kept-with-one-edit, **0 deleted**. `Enforced by`: `g-agent-contract`.

---

### 4.2 Run directory and handoff schemas

#### 4.2.1 Layout

Run dirs live at `runs/<runId>/`. `runId` = `<YYYYMMDD>-<HHMM>-<brief-slug>`. `/runs/` and `/.build/` are gitignored (§1.8 step 2). `g-run-dir-location` fails if any file exists under `.claude/shesha/runs/` (the pre-rebuild location) with an mtime after the WP-8 commit.

```
runs/<runId>/
  manifest.json          index + state machine     manifest.schema.json    TOOLCHAIN-WRITABLE ONLY
  plan.json              Planner output            plan.schema.json
  brief.md               verbatim; never edited
  hooks.jsonl            append-only decision log (§4.3.9)
  design/                ingested design sources
  prereq/<entity>.json                             prereq.schema.json
  blueprints/<screen>.blueprint.json               blueprint.schema.json
  precedent/<screen>.candidates.json
  screens/<screen>.sfs.json        SPECWRITER      sfs.schema.json            [S2]
  screens/<screen>.sfs.meta.json   SPECWRITER      sfs-meta.schema.json
  screens/<screen>.form.json       COMPILER ONLY   (markup envelope)
  screens/<screen>.compile.json    COMPILER ONLY   compile-report.schema.json [S2]
  screens/<screen>.verdict.json    VERIFY ONLY     verdict.schema.json        [S3 owns findings]
  locks/<screen>.lock · locks/eval-<screen>.lock · locks/plan.lock  lock.schema.json
  dispatch/<role>-<screen>-r<n>.json               dispatch.schema.json
  probes/<screen>.r<n>.layout.json · shots/<screen>.r<n>.png
  judge/<screen>.r<n>.anchor.json
  push/<screen>.receipt.json
  logs/<role>-<screen>-r<n>.md     NEVER in an Evaluator allowlist
  report.md
```

`<root>/.build/active-run` holds one line, the active `runId`, written by `sfs run init` and `sfs run advance`. `lib.mjs`'s `activeRunId()` reads it; absent ⇒ `null` ⇒ R4/R7 do not apply and `hooks.jsonl` lines go to `.claude/hooks.jsonl` (gitignored).

Two rules, both enforced:

- **Every handoff carries paths, never contents.** `gate-dispatch.mjs` D4 denies a `Task` whose `prompt` exceeds 2000 characters or contains `"components"` or `"node":` within 200 characters of a `{`.
- **One writer per artifact.** The table names the sole writer. `block-form-writes.mjs` R1/R3/R5 enforce it as an allowlist. Two writers on one file is how the two incompatible `refListStatus` shapes happened `[§1.2#2]`.

#### 4.2.2 Schemas — constraint tables, not fenced blobs

Seven schemas in `packages/sfs/schema/`: `plan`, `manifest`, `verdict`, `dispatch`, `sfs-meta`, `lock`, `blueprint`. **Global rules, applied to all seven and asserted by `schemas.test.mjs`:** draft `2020-12`; `$id` = `https://boxfusion.io/shesha/sfs/<name>.schema.json`; `additionalProperties: false` on **every** object level; no `pattern` containing an inline flag group `(?i)` (ECMAScript rejects it and `ajv` compiles patterns eagerly, so it throws at `compile()` time, not at validate time); every `*Version` field is a `const`. `schemas.test.mjs` case 1: `new Ajv({strict:true, allErrors:true}).addFormats().compile(schema)` does not throw, for each of the seven.

**`plan.schema.json`** — required top level: `planVersion` (`const "1.0"`), `runId` (`^[0-9]{8}-[0-9]{4}-[a-z0-9-]{1,40}$`), `briefSha256` (`^[0-9a-f]{64}$`), `brand` (`^[a-z][a-z0-9-]{1,31}$`), `backend`, `screens`, `repairPolicy`, `fanout`. Optional: `createdAt` (date-time), `designTier` (`A|B|C|D`), `gaps[]`, `signoff`.

| Path | Constraint |
|---|---|
| `backend.mode` | required, `live|none` |
| `backend.baseUrl` / `tokenPath` / `probedAt` | `uri` / string / date-time-or-null |
| `repairPolicy.maxRounds` | required, **`const: 3`** |
| `fanout.maxConcurrentScreens` | required, integer 1–3 |
| `fanout.withinScreen` | required, **`const: 1`** |
| `gaps[]` | `{what, why}` required, each `minLength: 8`; optional `blocksScreens[]` |
| `screens` | array, `minItems: 1` |
| `screens[]` required | `name`, `module`, `formName`, `kind`, `buildOrder`, `contract` |
| `screens[].name` | `^[a-z][a-z0-9-]{1,39}$` |
| `screens[].module` | `^[a-z][a-z0-9.]{1,63}$`; `formName` `^[a-z][a-z0-9-]{1,63}$` |
| `screens[].kind` | `list|detail|create|edit|modal|dashboard|custom` |
| `screens[].entityStatus` | `resolved|uninspectable|notApplicable` |
| `screens[].buildOrder` | integer ≥ 1; `dependsOn[]` strings |
| `screens[].precedent[]` | `maxItems: 3`; `{sfsPath, score, method}` required, `method` ∈ `shape|embedding`, optional `why` |
| `screens[].decisions[]` | `{what, chose, reason}` required, `reason` `minLength: 12`; optional `confidence` ∈ `verified|assumed` |
| `screens[].contract` | required `predicates`, `signedOffAt` (date-time or null); optional `thresholds` |
| `…contract.predicates` | array, `minItems: 3`, **`contains: {required:["tier"], properties:{tier:{const:"T3"}}}`** |
| `…predicates[]` required | `id` (`^[A-Z][0-9]{1,2}$`), `tier` (`T1`–`T5`), `predicate` (`^[a-z][A-Za-z0-9]{2,39}$`), `args` (object), `expect` (any), `severity` (`must|should`) |
| `…predicates[]` optional | `blockedBy` ∈ `metadata|backend|playwright|judge|none`, `source` |
| `…contract.thresholds` | `t5MinRank` ∈ `excellent|acceptable`; `maxStructuralEscapes` integer 0–2 |
| `screens[].status` | `planned|specced|compiled|verified|pushed|blocked|abandoned` |

Five things this schema makes structurally impossible, each of which happened `[§1.2, §1.3, §4/L4]`: a screen with no acceptance contract; a contract that is entirely visual; a **prose** assertion (`predicate` must be an identifier — the string `"body is a 2-column split; left:right ratio ≈ 18:6"` cannot validate); a repair loop above 3 rounds; two authors on one form. `schemas.test.mjs` asserts each of the five as an explicit rejection case.

**`manifest.schema.json`** — written **only** by `sfs run <init|advance|lock|release>`; a direct `Write` is denied by R3. Required: `manifestVersion` (`const "1.0"`), `runId`, `phase` (`init|comprehend|plan|build|verify|push|report|done|aborted`), `toolchain`, `screens`, `events`. `toolchain` requires `compilerVersion`, `schemaVersion`, `registryRef`, `registrySha256` (`^[0-9a-f]{64}$`), `nodeVersion`; optional `chromium` (`present|absent`), `backend` (`live|none`), `judge` (`qualified|disqualified|untested`). `screens` is an object keyed `^[a-z][a-z0-9-]{1,39}$` → `{state, round}` required (`state` as above, `round` integer 0–3), optional `artifacts.{sfs,sfsMeta,form,compile,verdict,receipt}` each `{path, sha256, bytes, at}`, `verdictSha256`, `blockedBy`, `tokens`. `events[]`: `{at, kind, detail}` required, `kind` ∈ `init|lock|release|advance|denied|compile|verify|push|abort`, optional `screen`. Plus `hookDenials` integer ≥ 0.

**Legal state transitions** — a table in `packages/sfs/src/run/states.mjs`, not `if`s, asserted by `run.test.mjs`:

```
planned  -> specced | blocked | abandoned
specced  -> compiled | specced (round+1, max 3) | blocked
compiled -> verified | specced (round+1, max 3) | blocked
verified -> pushed | specced (round+1, max 3) | blocked
pushed   -> (terminal)
blocked  -> specced | abandoned
```

`round` may only increase. A transition to `specced` at `round == 3` is refused `RUN-9003 repair cap reached`. The 3-round cap `[§4/L3]` is the state machine, not an agent counting.

**`verdict.schema.json` — the envelope.** Section 3 owns `findings[].code` vocabulary, `findings[].evidence`, and `tiers[].detail`. This section owns the envelope, because `push-admissible.mjs` and `g-verdict-integrity` read it; Section 3 must not rename these fields. Required: `verdictVersion` (`const "1.0"`), `runId`, `screen`, `round` (1–3), `result` (`pass|partial|fail|refused`), `tiers`, `coverage`, `findings`, `sealedAt`.

| Path | Constraint |
|---|---|
| `inputs` | required `formSha256`, `sfsSha256`, `compileSha256`, each `^[0-9a-f]{64}$`; optional `probe`, `shot` |
| `tiers` | required keys `T1`–`T5`; each requires `result` ∈ `pass|fail|partial|skipped|uninspectable`, `walked`, `checked`, `uninspectable`, `ms` (integers ≥ 0); optional `reason`, `detail` (S3), `backend` (the base URL T3/T4 ran against, or `null`) |
| `coverage` | `additionalProperties` = `{required: bool, walked, checked, uninspectable}` all required. **Produced by `coverage.mjs`, never recomputed in this section** |
| `predicates[]` | `{id, result}` required, `result` ∈ `pass|fail|uninspectable`; optional `actual`, `expect`, `reason` |
| `findings[]` | `{code, severity, owner, path, message}` required. `code` `^[A-Z]{3,4}-[0-9]{4}$`; `severity` ∈ `must|should|info`; `owner` ∈ `specwriter|planner|compiler|registry|backend|harness`; `message` **`minLength: 40`**; optional `hint`, `predicateId`, `evidence` (S3) |
| `route` | integer counts per owner |
| **`advisory`** | optional object, `additionalProperties: false`, one key `t5`: `{rank ∈ excellent|acceptable|generic|broken, model, rubricVersion, anchorRankedFirst, qualified, anchorRecord, notes (maxLength 600)}`. **`result` is not a function of `advisory`.** D-015 |
| `notes` | `maxLength: 600`. Never fed back to the Specwriter; findings are the channel |

`findings[].message` has `minLength: 40` and `path` is required for the same reason the compiler's catalogue does `[§2.7.1 rule 5]`: an agent self-corrects against a domain error naming the value, the path and the corrective shape, not against "layout is wrong".

**`dispatch.schema.json`** — the only legal way to brief a subagent. Required: `dispatchVersion` (`const "1.0"`), `role` (`sfs-planner|sfs-specwriter|sfs-evaluator|design-critic|fleet-transformer|fullstack-prereq-checker`), `runId`, `screen` (string or null), `round` (1–3), `paths` (array, `minItems: 1`, `maxItems: 12`, items are strings with `not: {pattern: "(^|/)(logs)/|\\.rationale\\.|__SAA_RESULT__"}`). Optional `notes` (`maxLength: 240`), `lock`. The `not.pattern` **is** the judge-isolation rule, as a regex in a schema; `notes` is capped so a builder's self-report cannot be smuggled through free text `[§4/L3]`.

**`sfs-meta.schema.json`** — exists because SFS forbids unknown top-level keys (`SFS-1002`), so provenance cannot live in the spec. Required: `metaVersion` (`const "1.0"`), `screen`, `round` (1–3), `basedOn[]` (empty array = authored blind; legal, recorded). Optional `escapesIntended[]` (`{path, reason (minLength 12)}` required, optional `structural`), `decisions[]`, `uninspectable[]`.

**`lock.schema.json`** — `{lockVersion: const "1.0", screen, role, runId, at, pid}`, all required, `additionalProperties: false`. **No `session_id`.** `role` ∈ `planner|sfs-specwriter|sfs-evaluator`. For `locks/plan.lock`, `screen` is the literal `"__plan__"`.

**`blueprint.schema.json`** — required: `blueprintVersion` (`const "1.0"`), `screen`, `tier` (`A|B|C|D`), `archetype`, `regions`, `assertions`. `regions[]`: `{name, role}` required, optional `parent`, `tab`, `widthIntent` ∈ `fill|fixed|auto`, `widthPx`. `assertions[]`: `minItems: 1`, `{id (^A[0-9]{1,2}$), predicate (^[a-z][A-Za-z0-9]{2,39}$), args, expect, severity}` required, optional `tier` ∈ `T3|T5`. Optional `source`, `viewport`, `bindings[]`, `uninspectable[]` (`{what, why (minLength 12)}`). **An English assertion is unrepresentable**: `A1` becomes `{"id":"A1","predicate":"widthRatio","args":{"a":"main","b":"rail"},"expect":{"min":2.5},"severity":"must","tier":"T3"}`. 95% of what the old assertions stated is a property of the compiled tree, not the rendered DOM `[§4/L3]`, so `tier` defaults to `T3`.

#### 4.2.3 `sfs run` — the run-directory CLI

```bash
npm run sfs -- run init    --brief <path> --brand shesha [--backend <url>|--backend none] --json
npm run sfs -- run lock    --run <runId> (--screen <name>|--plan) --role <role> --json
npm run sfs -- run release --run <runId> (--screen <name>|--plan) --json
npm run sfs -- run advance --run <runId> --screen <name> --to <state> --json
npm run sfs -- run report  --run <runId> --json      # writes report.md, prints the summary block
```

Exit codes are `coverage.mjs`'s `EXIT` (`0 pass · 1 fail · 2 usage · 3 partial`). `run init` creates the tree, copies the brief, computes `briefSha256`, records `toolchain` (probing chromium and the backend; an unreachable backend sets `backend:"none"`, never a silent retry), writes `.build/active-run`. `run lock --role sfs-evaluator --screen <s>` creates `locks/eval-<s>.lock`. `run report` is the only thing that reads `logs/**`, and only for token accounting.

---

### 4.3 Hooks

The case for hooks is **architectural, not empirical**: there is no published measurement of hook-based enforcement versus prompt-based instruction — practitioner blogs only `[Appendix B item 2]`. The argument is that a hook cannot be forgotten, which is a property, not a claim. The *alternative* is measured to fail: instruction adherence collapses from 100% to 52.7% between 10 and 500 simultaneous instructions `[§0]`. Record exactly that framing in the `DECISIONS.md` row; do not claim a measurement that does not exist.

Every decision appends one line to `hooks.jsonl` and increments `manifest.json.hookDenials`. `sfs run report` publishes invocations, denials by hook, denials by rule, and the ratio. **A run reporting 0 denials is a suspicious run**: `g-hook-liveness` fails if `hooks.jsonl` has fewer lines than `manifest.json.events.length`.

#### 4.3.1 File layout — runner / decide split

Six hooks. Each is **two files**:

```
.claude/hooks/lib.mjs                    findRepoRoot, matchGlob, activeRunId, readStdin, emit, appendJsonl, spawnNode
.claude/hooks/<name>.mjs                 the runner
.claude/hooks/<name>.decide.mjs          export async function decide(payload, ctx)
```

The runner, literally, for every hook (substitute `<name>`):

```js
#!/usr/bin/env node
import { decide } from './<name>.decide.mjs';
import { readStdin, emit, defaultCtx } from './lib.mjs';
let payload = {};
try { payload = JSON.parse((await readStdin()) || '{}'); } catch { payload = {}; }
try { emit(await decide(payload, defaultCtx())); }
catch (e) { emit({ event: payload.hook_event_name, decision: 'deny', code: 'HOOK-0999', reason: `HOOK-0999 ${e.message}` }); }
```

`decide(payload, ctx)` returns `{event, decision: 'allow'|'deny'|'block', code, reason, rule, ms}`. `ctx` is `{root, now, fs, spawnNode, activeRunId}` — injected, so `hooks.test.mjs` runs `decide` **in-process** against a temp root with no child processes and no Node cold start. `emit()` prints the event-shaped JSON and `process.exit(0)`; if `process.stdout.write` throws, it writes the reason to stderr and exits **2**.

**Five facts the session must not get wrong:**

1. `matcher` matches the **tool name**. There is no path matcher; every path decision happens inside `decide`. A hook registered on `Write` fires on every `Write`, and must return `allow` fast. Budget: **p95 ≤ 5 ms** over 500 in-process `decide` calls on non-matching payloads, asserted by `hooks.test.mjs`. Node cold start on Windows is 40–120 ms before the first line of the script, so a spawn-based latency budget is unmeasurable; each hook additionally gets **one** spawned end-to-end case asserting exit code and stdout within its declared `timeout`.
2. Commands are relative (`node .claude/hooks/x.mjs`), not `$CLAUDE_PROJECT_DIR`-prefixed — `$VAR` expansion depends on the host shell, and a hook that fails to start protects nothing. `findRepoRoot()` walks up from `process.cwd()` for a `package.json` whose `name` is `shesha-plugins`. **Not found ⇒ deny** `HOOK-0001 repo root not found`. Fail closed.
3. `.claude/settings.json` is committed. `.claude/settings.local.json` is never committed.
4. Hooks import only `node:*`, `./lib.mjs` and their own `.decide.mjs`. Validation needs `ajv`, which is a dependency, so a hook **spawns** `spawnSync(process.execPath, [join(root,'packages/sfs/bin/<bin>.mjs'), 'validate', …], {shell:false})`. Spawn failure or non-zero-with-no-JSON ⇒ **deny** `HOOK-0002 toolchain unavailable — run npm ci`. A missing install produces a block, never a silent pass `[§1.3 rule 5]`.
5. Exactly two exit codes are legal: **0** (decision on stdout) and **2** (stdout unwritable; reason on stderr). **`exit(1)` is banned in every hook file.** A non-zero exit that is not 2 is a *non-blocking error* in Claude Code: the tool call proceeds and the model never learns why — the same defect class as `bake-overlays.mjs` writing despite failure `[§1.4]`. `g-hook-contract` greps for `exit(1)` / `exitCode = 1` and hard-fails.

#### 4.3.2 `.claude/settings.json` — write literally

```json
{
  "enabledPlugins": { "shesha-developer@shesha-plugins": true },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|NotebookEdit|Read|Bash",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/block-form-writes.mjs", "timeout": 15 }] },
      { "matcher": "Write|Edit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/enforce-screen-lock.mjs", "timeout": 15 }] },
      { "matcher": "Bash|mcp__shesha-sfs__push",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/gate-push.mjs", "timeout": 30 }] },
      { "matcher": "Task",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/gate-dispatch.mjs", "timeout": 15 }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/validate-sfs-on-write.mjs", "timeout": 45 }] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/session-start.mjs", "timeout": 30 }] }
    ]
  }
}
```

`compact` is in the `SessionStart` matcher because §5.3 treats compaction as a certainty and the ground-truth block must be re-injected after it.

`enabledPlugins` is **not** `{}`. An empty map means `plugins/shesha-developer/agents/*` is not registered and `Task(subagent_type:"sfs-specwriter")` resolves to nothing. `g-plugin-enabled`: `.claude/settings.json` parses, `enabledPlugins` has ≥1 key containing `shesha-developer` whose value is `true`. Mutations: (a) `enabledPlugins: {}` → fail; (b) key present with value `false` → fail. If WP-11 step 0 shows the plugin **not** enabled after restart, the operator runs `/plugin marketplace add .` then `/plugin install shesha-developer@shesha-plugins`, which rewrites the key in the format Claude Code actually reads, and commits the resulting file — the tool is the authority on the key format, not this brief.

#### 4.3.3 `block-form-writes.decide.mjs` — the invariant hook

Enforces INV 1 (*the compiler is the only writer of form markup*), the run-dir single-writer allowlist, Specwriter markup-blindness, and Evaluator log-blindness. **It is the fast first line, not the enforcer of last resort** — `g-markup-provenance` (§4.3.8) is what makes INV 1 decidable.

**Glob semantics, specified because the whole hook depends on them.** `matchGlob(pattern, path)` in `lib.mjs`: paths are normalised to `/` and made relative to the stated root (repo root, or run-dir root where the pattern is declared as run-relative); patterns are anchored at both ends; `*` matches `[^/]*` and **never crosses `/`**; `**` matches anything including `/`; `?` throws `Error('matchGlob: ? unsupported')`. `hooks.test.mjs` asserts 12 matcher cases including `screens/*.sfs.json` vs `screens/x.sfs.json` (match) and vs `screens/nested/x.sfs.json` (no match).

Field extraction, by `tool_name` — implement exactly this, nothing more clever:

| `tool_name` | Paths to inspect |
|---|---|
| `Write`, `Edit`, `NotebookEdit`, `Read` | `tool_input.file_path` |
| `Bash` | every path-shaped token in `tool_input.command` (`[A-Za-z0-9_./\\-]+\.(json|mjs|js|md|png)`), plus every redirect target (`>`, `>>`, `tee`) |

**Decision rules, in order. First match wins.**

| # | Condition | Decision · code |
|---|---|---|
| R0 | `findRepoRoot()` failed | `deny` `HOOK-0001` |
| R1 | `Write`/`Edit`/`NotebookEdit` and path matches `\.form\.json$` or `\.expected\.form\.json$` | `deny` `HOOK-0101 the compiler is the only writer of form markup. Write SFS and run: npm run sfs -- compile --run <runId> --screen <screen>; to refresh a fixture run: npm run bless` |
| R2 | `Bash` and a redirect target or `writeFile`/`writeFileSync` argument matches R1's patterns, **and** the command is not on the writer allowlist below | `deny` `HOOK-0102` |
| R3 | `Write`/`Edit`/`NotebookEdit` and the run-relative path matches `manifest.json`, `screens/*.verdict.json`, `locks/**`, or `hooks.jsonl` | `deny` `HOOK-0103 <file> is written only by the toolchain. Use: npm run sfs -- run …` |
| R4 | `Read` and path matches `\.form\.json$`, `\.expected\.form\.json$` or `packages/sfs/corpus/**/*.json`, **and** any `runs/<activeRunId>/locks/*.lock` has `role: "sfs-specwriter"` | `deny` `HOOK-0104 markup is not readable while a spec is being written. The IR is the interface. See plugins/shesha-developer/skills/shesha-spec/` |
| R5 | `Write`/`Edit`/`NotebookEdit`, path is under `runs/<runId>/`, and the run-relative path matches **none** of the writable set | `deny` `HOOK-0105` |
| R6 | `Read` and path matches `runs/[^/]+/logs/` or `\.rationale\.`, **or** `Bash` and the command contains a token matching either or the literal `__SAA_RESULT__`, **and** any `runs/<activeRunId>/locks/eval-*.lock` exists | `deny` `HOOK-0106 judge isolation: the evaluator never reads the builder's reasoning` |
| R7 | otherwise | `allow` |

**The writable set (R5)** — run-relative, anchored, exhaustive: `plan.json`, `brief.md`, `screens/*.sfs.json`, `screens/*.sfs.meta.json`, `logs/**`, `dispatch/**`, `blueprints/**`, `precedent/**`, `prereq/**`, `judge/**`, `design/**`. Anything else under a run dir is denied.

**The writer allowlist (R2)** — one rule, not four prefixes. A `Bash` command may write a path matching R1's patterns iff, after trimming, it matches one of:

- `npm run <script>` where `<script>` is a key of the **root `package.json`'s `scripts`** whose value's first `node <path>` argument resolves under `packages/`. `decide` reads the root `package.json` (zero dependencies, one `readFileSync`) and computes the set; it is not a hard-coded list. This admits `npm run sfs -- …`, `npm run bless`, `npm run gates`, `npm run prove`.
- `node packages/sfs/**`, `node packages/mcp/**`, `node packages/verify/**` — which admits `node packages/sfs/tools/normalise-legacy.mjs … --out .build/wp1/oracle.form.json` (WP-1's acceptance command), `node packages/sfs/tools/gen-registry.mjs` and `node packages/sfs/tools/fill-gaps.mjs`.

**Blessing is Bash-only.** `packages/sfs/test/fixtures/**/*.expected.form.json` is denied to `Write`/`Edit` by R1 with no exception; the only way to produce one is `npm run bless` (= `node packages/sfs/tools/bless.mjs`), which recompiles and writes. **Being on the allowlist does not exempt the output from `g-markup-provenance`** — the allowlist decides who may run; the gate decides whether the bytes are compiler output.

**stdout.** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<code> <text>"}}` then exit 0. For `allow`, the same shape with `"permissionDecision":"allow"`.

**`hooks.test.mjs` cases for this hook (≥14):** (a) `Write runs/r/screens/s.form.json` → deny `HOOK-0101`; (b) `Bash echo x > runs/r/screens/s.form.json` → deny `HOOK-0102`; (c) `Bash npm run sfs -- compile …` writing that path → allow; (d) **`Bash npm run bless` → allow**; (e) **`Bash node packages/sfs/tools/normalise-legacy.mjs --in x --out .build/wp1/oracle.form.json` → allow**; (f) **`Bash node packages/sfs/tools/gen-registry.mjs --out packages/registry/data/components.json` → allow**; (g) `Bash node scratch.mjs` writing a markup path via a redirect → deny `HOOK-0102`; (h) `Write packages/sfs/test/fixtures/clean/x.expected.form.json` → deny `HOOK-0101`; (i) `Read s.form.json` with a specwriter lock open → deny `HOOK-0104`; (j) same read with no lock → allow; (k) `Read runs/r/logs/specwriter-x-r1.md` with `locks/eval-x.lock` present → deny `HOOK-0106`; (l) the same read with no eval lock → allow; (m) `Write runs/r/screens/x.sfs.json` → allow; (n) `Write runs/r/screens/nested/x.sfs.json` → deny `HOOK-0105`; (o) repo root not found → deny `HOOK-0001`; (p) `Edit packages/sfs/src/index.mjs` with `replace_all: true` → allow.

#### 4.3.4 `validate-sfs-on-write.decide.mjs`

**PostToolUse** on `Write`/`Edit`/`NotebookEdit`. Fires after the write, because the file must exist to be validated.

| # | Condition | Action |
|---|---|---|
| V0 | path matches none of `\.sfs\.json$`, `\.sfs\.meta\.json$`, `plan\.json$`, `dispatch/.*\.json$` | exit 0 silently |
| V1 | `spawnNode(['packages/sfs/bin/<bin>.mjs','validate','--schema',<schema>,'--file',<path>,'--json'])` fails to start | **block** `HOOK-0002 toolchain unavailable — run npm ci` |
| V2 | validator exits 0 | exit 0, empty stdout |
| V3 | validator exits non-zero | **V5 first**, then **block** with the validator's `diagnostics[]` rendered as text |
| V4 | path is `*.sfs.json`, validator passed, and the run's `plan.json` exists, and the SFS's `form`/`module` disagree with that screen's plan row | **V5 first**, then **block** `HOOK-0203 sfs form/module disagrees with plan.json` |
| V5 | any block from V3/V4 | **`fs.renameSync(path, path + '.rejected')` before returning the block.** A PostToolUse block does not undo the write; without V5 an SFS that failed `SFS-1002` stays on disk and a later step compiles it |

`<schema>` is selected from the filename: `*.sfs.json` → `sfs`, `*.sfs.meta.json` → `sfs-meta`, `plan.json` → `plan`, `dispatch/*.json` → `dispatch`. Response shape: `{"decision":"block","reason":"<validator diagnostics verbatim>"}` then exit 0. `reason` **must be the compiler's own diagnostic strings verbatim** — the value of the error catalogue `[§2.7]` is that an agent self-corrects against a domain error; a hook that paraphrases destroys it.

**Cases (≥6):** (a) unknown top-level key → block containing `SFS-1002` **and** `x.sfs.json.rejected` exists **and** `x.sfs.json` does not; (b) valid → exit 0, empty stdout, no rename; (c) validator binary missing → block containing `HOOK-0002`, no rename; (d) `plan.json` with `repairPolicy.maxRounds: 5` → block; (e) `form`/`module` mismatch → block `HOOK-0203` + rename; (f) a `.md` write → V0 fast path.

#### 4.3.5 `gate-push.decide.mjs` — detection only; admission is a program

The hook does three things: detect that the call is a push, spawn the admission program, map its exit code. **Every admission rule lives in `packages/verify/src/bin/push-admissible.mjs`**, which imports `coverage.mjs` — so the rules are unit-testable without a hook, and there is exactly one implementation.

Detection for `Bash`: the trimmed command matches `/(npm run sfs -- push|sfs\w*\.mjs push|run push)/` **or** contains `UpdateMarkup`, `ImportJson`, `FormConfiguration/Create`, or `/api/services/Shesha/FormConfiguration`. That last set catches a raw `curl` push, the obvious bypass. Detection for `mcp__shesha-sfs__push`: always.

`node packages/verify/src/bin/push-admissible.mjs --run <runId> --screen <s> [--allow-partial] --json` prints `{"admissible":bool,"code":"HOOK-03NN","reason":"…"}` and exits `0` admissible / `1` refused / `2` usage. The hook denies on exit ≠ 0 with the printed `code` + `reason`, and denies `HOOK-0002` if the program cannot start.

**Admission conditions, evaluated in order, first failure refuses:**

| # | Condition | Code |
|---|---|---|
| P0 | `--run` and `--screen` are determinable | `HOOK-0301 push must name a run and a screen` |
| P1 | `screens/<s>.form.json` exists | `HOOK-0302 no compiled artifact` |
| P2 | `screens/<s>.compile.json` exists, validates, `verdict` ∈ {`pass`,`partial`} | `HOOK-0303` |
| P3 | `compile.json.markupSha256` == sha256 of `<s>.form.json` on disk | `HOOK-0304 compiled artifact has been modified since compile` |
| P4 | `screens/<s>.verdict.json` exists, validates, `sealedAt` set | `HOOK-0305 no sealed verdict` |
| P5 | `verdict.inputs.formSha256` == P3's hash | `HOOK-0306 verdict does not correspond to this artifact` |
| P5a | `now - verdict.sealedAt <= 30 min` **and** `verdict.tiers.T3.backend` equals the push target's base URL (or both are `null`) | `HOOK-0312 verdict was produced against a different backend or is stale` |
| P6 | `pushAdmissible(verdict, {allowPartial})` from `coverage.mjs` returns `true`. **One rule, replacing three:** T1 `pass`; T2 `pass`, or `partial` with every `uninspectable` pointer's component type absent from the artifact; T3 `pass`, or `partial` with `--allow-partial` present **and** every uninspectable reason matching `^(backend|metadata) unavailable` | `HOOK-0307 T1-T3 not admissible: <tier>=<result> (<reason>)` |
| P7 | no `findings[]` entry with `severity:"must"` | `HOOK-0308 <n> must-findings outstanding: <codes>` |
| P8 | every `coverage` family with `required:true` has `walked > 0`, and none has `walked > 0 && checked == 0` | `HOOK-0309 zero coverage on <family>` |
| P9 | `manifest.screens[<s>].state == "verified"` | `HOOK-0310 state is <state>, expected verified` |

`--allow-partial` is the one escape: explicit, per-invocation, logged in `hooks.jsonl`, impossible to set once and forget. There is no config flag, environment variable or allowlist that turns off P0–P9. **There is no T3 re-run inside the hook** — re-verifying inside a 30-second PreToolUse duplicates the Evaluator and doubles the backend dependency; P5/P5a bind the verdict to the artifact and the target instead.

**Cases:** in `push-admissible.test.mjs`, one per P0–P9 (10 refusals) plus one fully-green admission; in `hooks.test.mjs`, three detection cases (`npm run sfs -- push …` → spawn; `curl -X POST …/UpdateMarkup` → spawn with no `--run` → deny `HOOK-0301`; `npm run lint` → allow without spawning) and one `HOOK-0002` case.

#### 4.3.6 `enforce-screen-lock.decide.mjs`

**PreToolUse** on `Write`/`Edit`/`NotebookEdit`. Fan-out mutex plus contract precondition. **No `session_id` anywhere:** a lock's identity is `(role, screen, runId)`.

| # | Condition | Decision |
|---|---|---|
| L0 | run-relative path matches neither `screens/*.sfs.json`, `screens/*.sfs.meta.json` nor `plan.json` | `allow` (fast path) |
| L1 | path is `plan.json` and `locks/plan.lock` is absent or its `role != "planner"` | `deny` `HOOK-0401 plan.json requires a planner lock. Acquire: npm run sfs -- run lock --run <runId> --plan --role planner` |
| L2 | path is `screens/<s>.sfs*.json` and no open lock names `<s>` with `role: "sfs-specwriter"` | `deny` `HOOK-0402 no lock on <s>. Acquire: npm run sfs -- run lock --run <runId> --screen <s> --role sfs-specwriter` |
| L3 | an open lock with `role: "sfs-specwriter"` names a **different** screen and its `mtime` is under 30 minutes old | `deny` `HOOK-0403 <other> is held by another author since <at>. Fan out across screens, never within one screen.` |
| L4 | that lock's `mtime` is over 30 minutes old | `deny` `HOOK-0404 stale lock on <other> (<age>). Release it explicitly: npm run sfs -- run release --run <runId> --screen <other>` |
| L5 | `plan.json` absent, invalid, has no screen `<s>`, or that screen's `contract.signedOffAt` is null or `contract.predicates.length < 3` | `deny` `HOOK-0405 no signed acceptance contract for <s>. The Planner negotiates the contract before implementation.` |
| L6 | `manifest.screens[<s>].round >= 3` and the target file already exists | `deny` `HOOK-0406 repair cap reached (3 rounds). Escalate; do not iterate.` |
| L7 | otherwise | `allow` |

L4 requires an explicit release rather than auto-expiring, because auto-expiry is how two writers end up on one file.

**Cases (≥6):** (a) no lock → deny `HOOK-0402`; (b) lock names another screen, fresh → deny `HOOK-0403`; (c) same, stale → deny `HOOK-0404`; (d) `signedOffAt: null` → deny `HOOK-0405`; (e) `round: 3` and file exists → deny `HOOK-0406`; (f) own lock + signed contract → allow.

#### 4.3.7 `gate-dispatch.decide.mjs` and `session-start.decide.mjs`

`gate-dispatch` — **PreToolUse** on `Task`.

| # | Condition | Decision |
|---|---|---|
| D0 | `tool_input.subagent_type` is not one of the six known roles | `allow` |
| D1 | `tool_input.prompt` contains no `dispatch/*.json` path | `deny` `HOOK-0501 dispatch a subagent by handing it a dispatch/<role>-<screen>-r<n>.json path, not a prose brief` |
| D2 | that file is absent or fails `dispatch.schema.json` | `deny` `HOOK-0502` + the validator's diagnostics |
| D3 | `subagent_type` ∈ {`sfs-evaluator`,`design-critic`} and any `paths[]` entry matches `(^|/)logs/`, `\.rationale\.` or `__SAA_RESULT__` | `deny` `HOOK-0503 judge isolation: the evaluator never receives the builder's reasoning or self-report` |
| D4 | `prompt` length > 2000, or contains `"components"` or `"node":` within 200 chars of a `{` | `deny` `HOOK-0504 handoffs carry paths, never contents` |
| D5 | `subagent_type` is `sfs-specwriter` and an open specwriter lock names a different screen | `deny` `HOOK-0505 one screen per specwriter` |
| D6 | otherwise | `allow` |

`session-start` — **SessionStart** on `startup|resume|clear|compact`. It gates nothing; it makes the ground truth explicit at turn zero and after every compaction. Prints, as `additionalContext`, exactly **six** lines:

```
toolchain: node <v> · sfs <compilerVersion> · registry <registryRef> · ajv <v>
green: <exit 0|exit <n>|not measured (timeout)>
backend: <live <url>|none>  chromium: <present|absent>
active run: <runId|none>  phase: <phase>  screens: <n> (<states>)
invariants: compiler is the only writer of markup · no push without an admissible sealed verdict · one author per screen
read this first: plugins/shesha-developer/skills/shesha-designer/SKILL.md
```

Line 2 runs `spawnNode(['packages/verify/src/bin/green-quick.mjs','--json'], {timeout: 20000})`, backed by the root script `"green:quick": "node packages/verify/src/bin/green-quick.mjs"` which runs **typecheck + gates only** — no `test`, no `gates:mutate`. `npm run green -- --quick` is **not** used: `--quick` appends to the last command of the `&&` chain only, so it would run the full four stages including the mutation suite. On timeout or spawn failure line 2 is `green: not measured (timeout)` — never a verdict. It **never blocks**: a SessionStart hook that blocks makes the repo unopenable.

**Cases:** `gate-dispatch` one per D1–D5 plus one D0 allow (6). `session-start`: (a) prints exactly 6 lines and exits 0 against a healthy temp root; (b) prints exactly 6 lines with `green: not measured (timeout)` and exits 0 in **under 20 s** against a temp root whose `packages/` is empty.

#### 4.3.8 `g-markup-provenance` — the real enforcer of INV 1

String-matching a `Bash` command line cannot enforce "the compiler is the only writer of markup": any indirection — a helper script with a computed path, a program that builds its output path from a variable — never puts the path on the command line. The hook is the fast first line. This gate is the decision procedure.

**Subjects:** every `runs/**/screens/*.form.json`, every `packages/verify/test/fixtures/run/screens/*.form.json`, and every `packages/sfs/test/fixtures/**/*.expected.form.json`.

**For each subject:** locate the sibling `<base>.sfs.json` and the sibling meta (`<base>.compile.json` for run artifacts, `<base>.compiled.meta.json` for fixtures); read `registrySha256`, `brand` and `compilerVersion` from it; recompile the SFS under exactly those; **hard-fail unless the emitted bytes are byte-identical.** D-021 (deterministic compilation) makes this decidable. A subject with no sibling SFS, or whose sibling meta is missing a hash, is a hard failure — not `uninspectable`.

Family `markup-provenance`, `required: true`, floor read from `packages/verify/config/fixture-floors.json` (`clean/` contributes 10, the fixture run contributes 1). `inputPaths`: `packages/sfs/test/fixtures/**`, `packages/verify/test/fixtures/run/**`, `packages/sfs/src/compile/**`, `packages/registry/data/**`.

**Mutations (≥3):** (a) flip one byte in a `*.expected.form.json` → fail; (b) delete a sibling `*.sfs.json` → fail; (c) `packages/verify/test/fixtures/mutation/computed-writer.mjs` writes a valid-looking `form.json` to `packages/verify/test/fixtures/run/screens/` at a path assembled from variables — the hook allows the command, the gate fails. (c) is the mutation that proves the hook's hole is closed by the gate.

#### 4.3.9 `g-verdict-integrity`, `hooks.jsonl`, and the hook gates

**`hooks.jsonl`** — every decision, allow or deny, appends one line:

```json
{"at":"2026-08-17T14:31:02.118Z","hook":"block-form-writes","tool":"Write","path":"runs/…/screens/x.form.json","decision":"deny","rule":"R1","code":"HOOK-0101","ms":3}
```

Logging failure never changes the decision. No active run ⇒ `.claude/hooks.jsonl` (gitignored).

**A committed synthetic run is required**, because six gates read `runs/**`, which is gitignored and empty until WP-10. `packages/verify/test/fixtures/run/` ships: `manifest.json`, `plan.json`, `hooks.jsonl` (≥ `events.length` lines), `screens/x.{sfs.json,sfs.meta.json,form.json,compile.json,verdict.json}`, `logs/specwriter-x-r1.md` (clean), `locks/` (empty), `report.md`. `packages/verify/test/fixtures/run-dirty/logs/specwriter-x-r1.md` carries markup fingerprints and is used **only** by the mutation harness. Every gate below reads `[the fixture run] ∪ [runs/*]`, declares its family `required: true` with floor 1, and prints its coverage.

| Gate | Asserts | Mutations (≥2) |
|---|---|---|
| `g-hook-contract` | For each of 6 hooks: the runner matches the §4.3.1 template and **exports nothing**; `<name>.decide.mjs` exports **exactly** `decide`; no `exit(1)`/`exitCode = 1` anywhere in `.claude/hooks/**`; imports restricted to `node:*`, `./lib.mjs`, `./<name>.decide.mjs`; the runner is listed in `.claude/settings.json`; ≥2 `hooks.test.mjs` cases name the module. **Subsumes `g-hooks-wired`, which is deleted** | (a) remove a hook from `settings.json` → fail; (b) add `process.exit(1)` to a hook → fail |
| `g-hook-liveness` | For every subject run dir, `hooks.jsonl` line count ≥ `manifest.json.events.length` | (a) truncate `hooks.jsonl` → fail; (b) append an event with no hook line → fail |
| `g-judge-isolation` | No file under `plugins/**` or `packages/**` contains `__SAA_RESULT__` within 400 chars of `sfs-evaluator`/`design-critic`; `dispatch.schema.json`'s `paths[].not.pattern` is present and byte-equal to the §4.2.2 value; `sfs-evaluator.md` `tools:` contains no `Bash` | (a) add `Bash` to the evaluator → fail; (b) weaken `not.pattern` → fail |
| `g-specwriter-purity` | Every `logs/specwriter-*.md` in the subject set is free of the 6 markup fingerprints (§4.1.1) | (a) point the gate at `run-dirty` → fail; (b) add `"desktop":` to a clean log → fail |
| `g-verdict-integrity` | For each subject verdict: `sha256(verdict.json) == manifest.screens[<s>].verdictSha256`; `inputs.*Sha256` match the files on disk; **every `predicates[].result` recomputed from `<s>.form.json` + the meta sidecar + the contract equals the recorded value**; `result == resultFor(tiers, coverage, predicates)`; `result` is unchanged when `advisory.t5` is replaced by the best or the worst possible vector | (a) flip one `predicates[].result` → fail; (b) edit `notes` after sealing without updating `verdictSha256` → fail |
| `g-run-dir-location` | No file under `.claude/shesha/runs/` with mtime after the WP-8 commit | (a) create one → fail; (b) create one with an older mtime → pass |

`packages/verify/test/hooks.test.mjs` — one `node --test` file, **40 in-process decision cases** (16 + 6 + 4 + 6 + 6 + 2, exactly as enumerated in §4.3.3–4.3.7) **+ 12 `matchGlob` cases** **+ 6 spawned end-to-end cases** (one per hook: pipe a literal stdin payload to `node .claude/hooks/<name>.mjs`, assert exit code, parsed stdout decision, reason-code substring, and that `hooks.jsonl` gained exactly one line) **+ 2 performance cases** (p95 ≤ 5 ms over 500 in-process non-matching `decide` calls; each spawned case completes within its declared `timeout`). **Total 60.**

---

### 4.4 The skills rewrite

**Budget, all four: `SKILL.md` < 500 lines AND < 8192 bytes; `references/` exactly one level deep; no `scripts/`, no `package.json`, no `README.md`, no `CHANGELOG.md`, 0 bytes of `assets/`.** `[§4/L4, §1.1]` Enforced by `g-prose-budget` and `g-skill-purity`. Compressing rather than adding is the evidenced direction: SkillReducer found 39–48% compression *improved* functional quality by 2.8% `[§0]`.

**`prose-budget.json` tier-A is a committed config with an asserted cardinality**, per the Section 1 fix: `{"tierA": {"paths": [...], "expectedCount": N}}`, and the gate hard-fails when the number of matched **existing** folders ≠ `expectedCount`. At WP-0 tier A is the three existing design skills (`shesha-claude-designer`, `shesha-design-comprehension`, `shesha-design-system`) with `expectedCount: 3` and their measured current bytes as waived caps that may only ratchet down. **WP-7 updates `paths` and `expectedCount` to 4 in the same commit as the rename**, and sets `{lines: 500, bytes: 8192, refDepth: 1}` plus the per-skill `refBytesTotal` below. A rename that does not update the config fails the count check.

The before/after byte totals are **emitted by the gate** into `packages/verify/evidence/WP-7.json` (`skillBytes`, `refBytes`, `refFiles`, `assetBytes`). No number in this table is typed into a commit body by the session.

| Measure | Cap after WP-7 |
|---|---|
| Each `SKILL.md` | < 8192 B and < 500 lines |
| `refBytesTotal` | `shesha-designer` 8 KB · `shesha-spec` 32 KB · `shesha-design-comprehension` 8 KB · `shesha-design-system` 4 KB |
| `assetBytes` under `plugins/*/skills/**` | **0** |

**Plugin version.** No literal target version appears in this section. `g-plugin-version` enforces: every commit touching `plugins/**` bumps `plugins/shesha-developer/.claude-plugin/plugin.json`'s `version`; across the session's commits the **minor** component increments exactly once (the new `shesha-spec` folder) and never decreases, checked over `git log -p -- plugins/shesha-developer/.claude-plugin/plugin.json`.

#### 4.4.1 `shesha-designer` — the conductor

`git mv plugins/shesha-developer/skills/shesha-claude-designer plugins/shesha-developer/skills/shesha-designer`. Folder name must match frontmatter `name` (`CLAUDE.md`). Delete `README.md` from the folder.

`SKILL.md` ≤ 8192 B, ≤ 160 lines, sections in this order: **What this does** (4 lines: conductor; owns the run dir; writes no SFS and no markup) · **The pipeline** (one fenced block, below, the skill's entire procedural content) · **The three roles** (3-row table: role, dispatch file, what it returns; links to `agents/*.md`) · **Gates you cannot skip** (4-row table: hook, what it refuses, the command that satisfies it) · **When something is blocked** (6-row table: `verdict.route` owner → next action) · **Degraded modes** (3 rows: no backend / no chromium / no design source, each stating what becomes `uninspectable`, never what to assume). Description keeps the current trigger set — it is measured good and re-earning it is pointless.

```bash
npm run sfs -- run init --brief <brief.md> --brand <brand> [--backend <url>|--backend none] --json
#   per screen with a design source: dispatch shesha-design-comprehension
npm run sfs -- run lock --run <runId> --plan --role planner
#   dispatch sfs-planner with dispatch/sfs-planner-run-r1.json  -> plan.json
npm run sfs -- run release --run <runId> --plan
#   for each buildOrder tier, for each screen in the tier (max 3 concurrent):
npm run sfs -- run lock --run <runId> --screen <screen> --role sfs-specwriter
#     dispatch sfs-specwriter with dispatch/sfs-specwriter-<screen>-r<n>.json
npm run sfs -- compile --run <runId> --screen <screen> --json
npm run sfs -- run advance --run <runId> --screen <screen> --to compiled
npm run sfs -- run release --run <runId> --screen <screen>
npm run sfs -- run lock --run <runId> --screen <screen> --role sfs-evaluator
#     dispatch sfs-evaluator with dispatch/sfs-evaluator-<screen>-r<n>.json  -> verdict.json
npm run sfs -- run release --run <runId> --screen <screen>
npm run sfs -- run advance --run <runId> --screen <screen> --to verified
npm run sfs -- push --run <runId> --screen <screen> --json
npm run sfs -- run report --run <runId> --json
```

**What moves out:**

| Content | Destination |
|---|---|
| `references/handoff-contract.md` | **Deleted.** Replaced by `plan.schema.json` + `manifest.schema.json` + `dispatch.schema.json` + the state table. A contract expressed as a schema cannot drift from its enforcement `[§5]` |
| `references/design-ingestion.md` | **Keep**, ≤ 6 KB, one level deep. Design-source detection and the four fidelity tiers are genuinely fuzzy judgement — the one item on this list that belongs in prose |
| Gate-ordering prose (`5a → 5a.5 → 5b → 5c`), the 2-cycle caps, "one push path", "verify the disk before accepting an agent's verdict" | **Deleted as prose.** Now the state machine (§4.2.2), `repairPolicy.maxRounds`, `push-admissible.mjs` P0–P9, and P3/P5 respectively |
| "Brand resolved first, once" | **Deleted.** `brand` is required on `plan.json` and an input to `run init`; compile-time role resolution makes a separate brand pass meaningless `[§4/L1]` |
| Style-pass sequencing (contradiction #5) | **Deleted entirely.** There is no style pass. Appearance compiles from `$role:` tokens `[§1.2#5, §4/L1]` |

#### 4.4.2 `shesha-spec` — new, replaces `shesha-form-edit`

New folder `plugins/shesha-developer/skills/shesha-spec/`. `SKILL.md` ≤ 8192 B, ≤ 190 lines, sections: **What SFS is** (6 lines: a typed IR; ~800 bytes of intent compiles to ~19,000 bytes of markup; you never write markup) · **The 10 examples** (10-row table: file · kind · what it teaches — the core of the skill) · **Two inlined examples** (~1.4 KB) · **The 8 things you cannot write** (one line each, each mapping to a schema constraint and an error code) · **The escape hatch** (8 lines: `raw` needs a `reason` ≥ 12 chars; escapes are counted and published; >20% structural escape rate means the IR is wrong) · **The loop** (5 lines: compile → read diagnostics → fix at the named path → recompile; cap 6 compiles, 3 rounds; same code twice at the same path = stuck, escalate) · **Where the truth is** (4 paths: `sfs.schema.json`, `registry_lookup`, `metadata_entity`, `errors/catalogue.json` — no prose copy of any of them exists).

`description`, written literally (it must inherit `shesha-form-edit`'s triggers, which are load-bearing for existing users):

> Write or repair the SFS spec for one Shesha form. Use when the user asks to create or change a form's structure, fields, columns, actions, validation or layout — "add a sector dropdown above the email field", "make the address tab conditional on AccountType=PBF", "wire the Save button to Submit", "build a bookings list with search and an add dialog". You author a small typed spec (SFS), never Shesha markup: the compiler stamps every id, parentId, version, breakpoint block and envelope field. Carries 10 worked examples, the escape hatch, and the compile-diagnostic loop. Never edit form JSON by hand — the compiler is the only writer.

**The 10 worked examples.** Worked input/output examples beat schema descriptions by **18 points** (72% → 90%) on complex parameter handling `[§4/L4]`. They are **real fixtures** at `packages/sfs/test/fixtures/clean/<name>.sfs.json`, each with a blessed `<name>.expected.form.json` and `<name>.compiled.meta.json` — **30 files**, the count declared in `packages/verify/config/fixture-floors.json`, not in prose. `references/examples.md` reproduces all 10 inline with a one-line teaching label. `g-skill-examples-compile` compiles all 10 on every `npm run gates` and fails on any byte difference from the blessed output, and fails if any of the 10 is absent from `examples.md` — so a documented example cannot rot, which is the mechanism that let `containers.md` ship `version: 8` for a `version: 9` component `[§1.2#11]`.

| # | Fixture | `kind` | Teaches | Must exercise |
|---|---|---|---|---|
| 1 | `bookings-table` | `list` | The canonical screen: table + toolbar + dialog action + status column + pager | `data`/`row`/`col`/`search`/`actions`/`table`/`pager`; `responsive.fill`+`fixed`; `openDialog`+`onSuccess: refresh`; `render.statusBadge`; `onRowClick: navigate`. Authored in Section 2 §2.1.10 |
| 2 | `booking-create` | `create` | Inputs from metadata, required fields, the errors node, submit/cancel | `field` ×6 via `_datatypeMap`; `required:true` ⇒ auto `errors` node; `submit` intent; two-column `row` with `responsive.stack:"at:tablet"` |
| 3 | `booking-details` | `detail` | The main/rail split — the 332px idiom as one `responsive` line | `card`; `row` with `fill:"main"`, `fixed:{rail:"332px"}`; read-only `field`s; `text` headings via `$type:`/`$role:` |
| 4 | `booking-edit-modal` | `modal` | A dialog: no page shell, form arguments, submit pipeline | no `page` key; `hooks.onAfterDataLoad`; `submits:true`; `openDialog.args` static only |
| 5 | `requirement-detail-tabs` | `detail` | Tabs and panels, and tab assignment as a T3 predicate | `tabs` ×3; `panel` with `collapsedByDefault`; predicate `tab(endpointsTable)=="Endpoints"` — the thing the DOM probe cannot see `[§1.3]` |
| 6 | `fleet-dashboard` | `dashboard` | A screen with no entity; KPI row; no submit, no loader | `entity` absent; `row` of 4 `card`s; `text` bound to `{code:…}`; both loaders `none` |
| 7 | `passengers-datalist` | `list` | `datalist` + row template, and why actions cannot live in a row template | `list` with `rowTemplate`; the `SFS-1301` case as a commented-out wrong version plus the correct hoist to `onListItemClick` |
| 8 | `crew-inline-table` | `edit` | Inline editing: the auto-inserted crud column and the editor triplet | `table.inline:"all"`; no hand-written `crud-operations` column; `columns[].editComponent` never hand-written |
| 9 | `link-existing-crew` | `modal` | Junction linking and the one supported dynamic-arg path | `entityPicker` `field`; `openDialog` with `args.relay`; `onSuccess: refresh` targeting the parent's `data` region by name |
| 10 | `raw-escape-demo` | `custom` | The escape hatch, used correctly, exactly once, and counted | `raw` with a 20-char `reason`; `render.kind:"custom"`; **the only fixture with `structuralEscapes: 1`**, so the WP-5 escape ceiling reads `1/10 = 0.10 ≤ 0.20`. Deliberately last |

Inlined in `SKILL.md`: #2 and #4, the two shortest complete specs, which together exercise fields, required, actions, hooks and the absence of a page shell. #1 is one `Read` away.

**What moves where — the 47 KB `SKILL.md` + 32 references (276 KB), split `[§5]`:**

| Old content | Destination |
|---|---|
| `references/components/*.md` (16 files) | **Registry data** (`components.json` props/versions/enums/slots/`_datatypeMap`) + **compiler recipes** (`src/compile/recipes/`). All 16 deleted. The 9-row datatype→component table becomes `_datatypeMap`. `edit-mode.md`'s three-way contradiction resolves by `editMode` becoming a compiler **output** derived from `kind` `[§2.1.3, §2.1.7]` |
| `references/debug.md` (15 KB, 31 symptom rows) | **`packages/sfs/src/errors/catalogue.json`**; `errors.test.mjs` asserts rows 1–31 are covered or explicitly marked not-compiler-detectable `[§2.7.2]`. Then deleted |
| `references/verification.md`, `form-quality.md`, `blueprint-consumption.md` | **T1–T3 checks** + contract predicates. Deleted |
| `references/examples.md`, `assets/examples/*.json` (2.5 MB) | **Decompiled to `packages/sfs/corpus/`**, then the raw seeds deleted; `examples.md` rewritten as the 10-fixture index. Deletion gated on the round-trip report existing `[§2.10 item 7]` |
| `references/block-library.md`, `assets/blocks/*` (11 blocks, 152 KB) | **`packages/sfs/src/compile/recipes/`** as parameterised macros. The knowledge is precious (the datalist collapse fix, the 332/`calc(100% - 348px)` idiom, page-shell `hideHeading`+`className`); the format is unusable as a machine contract `[§5]` |
| `references/orchestration.md`, `bulk-operations.md`, `navigation-menu.md`, `full-stack-prereqs.md`, `backend-restart.md`, `api.md`, `patterns.md`, `component-cheatsheet.md` | **Deleted** (8 files, ~60 KB). Orchestration → §4.4.1's block + the state machine. Bulk → `fleet-transformer`. Menu/prereqs/restart → `fullstack-prereq-checker` + `prereq.schema.json`. API → the single push path. Cheatsheet → `registry_lookup` |
| `references/archetypes.md` | **`plan.json.screens[].archetype`** + the precedent index (§4.7) |
| The `stampTree` snippet at `SKILL.md:173` and the four places re-specifying it | **Deleted.** Stage 5 of the compiler `[§4/L1]` |
| ~4 KB of changelog archaeology | **Deleted in WP-0** (§1.8 step 6) |

`references/` after the rewrite is exactly **2 files**: `examples.md` (≤ 28 KB) and `errors.md` (a 20-line index mapping error-code *prefixes* to what to do, ≤ 4 KB — not the catalogue, which is data).

`clean-form-config` is **deleted as a skill** — a MUST-strength every-push gate that ships zero scripts `[§1.7 T8]`. Its eight `assets/groups/*.json` move to `packages/registry/data/prop-groups/` and its function becomes T2's prop-legality check. A gate that exists only as JSON for a model to read is not a gate. Needs a `DECISIONS.md` row and an entry in Section 1's `disposition.json`, or `g-disposition` fails the commit.

#### 4.4.3 `shesha-design-comprehension`

`SKILL.md` ≤ 8192 B, ≤ 170 lines. Job: **design source → screen inventory + target facts**; DOM probe for the emergent residue only `[§4/L4]`. Sections: **What this produces** (`blueprints/<screen>.blueprint.json`, schema'd, one per screen) · **The four fidelity tiers** (A/B/C/D table, 8 lines; Tier D is a documented path with a stated consequence, not a shortcut) · **From source to facts** (10 lines; ends at facts, never at assertions) · **Assertions are predicates** (12 lines: every target fact becomes a `{predicate,args,expect}` row the Planner copies into the contract; you never write an English assertion) · **The probe, narrowed** (10 lines: 3 things it can measure, 4 it cannot; the 4 are reported `uninspectable`, never asserted).

**Assertions stop being English.** Today placement assertions are numbered English sentences (`A1 body is a 2-column split; left:right width ratio ≈ 18:6 …`), there is no diff program, the gate is a model reading a geometry JSON against a prose document, and two of its five dimensions are unmeasurable `[§1.3]`. `blueprint.schema.json` (§4.2.2) makes an English assertion unrepresentable.

**What moves:** `references/blueprint-ir.md` → the schema (deleted). `references/verification-loop.md` → T3 predicates + `resultFor` (deleted). `references/capture-pipeline.md` → keep, ≤ 8 KB. `scripts/layout-probe.js` + its `package.json` → `packages/verify/src/probe/layout-probe.mjs`, ported to ESM. Two documented probe additions `[§5]`: capture `data-sha-c-name` (the only handle back to a form component; currently not captured) and a `--summary` mode, because 313 bytes/node × 800–2,500 nodes is 63–195K tokens if read whole. The `rowBand = round(y/14)` quantisation on viewport-absolute y is **deleted, not fixed**: two controls on one visual row land in different bands whenever they straddle a 14px boundary, and unrelated containers at the same absolute y always share a band `[§1.3]`. Row membership is a tree property now.

**Chromium is an operator step, never an npm script.** The deleted `shesha-form-edit/package.json` shipped `"setup": "npm install && npx playwright install chromium --with-deps"`; `--with-deps` shells out to `apt` and fails on the Windows host. `packages/verify` keeps `playwright` as a devDependency with **no install script**. The install command is `npx playwright install chromium` (no `--with-deps`), recorded as the operator action in the **WP-3c `BLOCKED.md` B2 row**. When chromium is absent, `layout-probe.mjs` exits 3 and T4 is `uninspectable`; nothing degrades to a pass.

**The four things the probe cannot measure, reported `uninspectable` and never asserted** `[§1.3, T15]`: tab assignment of any non-active tab (no `tabKey`; inactive antd panels are `display:none` and filtered out); `1fr`-vs-fixed intent (`getComputedStyle().gridTemplateColumns` resolves to pixels, so `minmax(0,1fr) 332px` reads as `962px 332px`); any appearance property (colour, font, background, border, radius, shadow, gap, padding — the probe captures none); node identity beyond a truncated 80-char text label. Delete the instruction "It is measurement; prefer it over your eye" wherever it appears — instructing a model to trust an instrument that cannot see the thing being judged is banned behaviour T15 `[§1.7]`.

#### 4.4.4 `shesha-design-system`

`SKILL.md` ≤ 8192 B, ≤ 120 lines. Job: **brand tokens and recipes as data; resolution is the compiler's job** `[§4/L4]`. Sections: **What this owns** (4 lines: token files and the role map, as DATA; it applies nothing) · **Adding a brand** (12 lines: copy the token file, edit values, run one command, run one gate — the command and the gate, literally) · **The role map** (12-row table: role → token path → what uses it) · **What the compiler does** (6 lines: `$role:`/`$type:`/`$space:`/`$radius:`/`$shadow:` resolve at compile time, per run, per brand; a literal hex is `TOK-2010`) · **The capability matrix** (6 lines: what it is, where it lives, per-row `id` + `measuredAt`, how to add a row — a probe form, not an inference).

**The brand-genericity claim becomes true here, and it is checked three ways that cannot be gamed by editing a token file.** Today: `bake-overlays.mjs` resolves `$role:` at *build* time into plugin source; **48 literal hexes vs 10 `$role:` references** across the overlays; all 11 blocks contain 0 `$role:` tokens and 2–6 hexes each; baking under the LandBank-green token file moved **10 of 58 colour sites**; two apps on different brands cannot share an installed plugin `[§1.2]`. The old test — "compile fixture #1 under two brands and assert every colour site differs" — is **deleted**: it is satisfied by editing the second token file until every value differs, and it is wrong in principle, because two brands legitimately share values (`#ffffff` = `surfaces.surface` at 8 sites). Replaced by:

1. **`g-no-literal-hex`** — 0 occurrences of `#rrggbb`, `#rgb`, `rgb(`, `rgba(`, `hsl(`, `hsla(` or a CSS colour name under `packages/sfs/src/compile/**`, `packages/sfs/recipes/**` and `plugins/**`. No allowlist, no exceptions. Excludes `packages/sfs/test/fixtures/**` (compiler output legitimately contains resolved hex) and `packages/registry/data/tokens/**` (the token values themselves).
2. **Provenance completeness** — the compile report carries `colourSites[]` = `[{jsonPointer, value, resolvedFrom}]`, `resolvedFrom` being `"$role:<name>"` / `"$type:<name>"` or `null`. `tokens.test.mjs` compiles fixture #1 and asserts **`colourSites.filter(s => s.resolvedFrom === null).length === 0`**, printing `<n>/<n> colour sites resolved`. `n` is read from `packages/registry/config/colour-sites.json` and ratcheted upward by the test; it is never a literal in this brief.
3. **Per-role isolation** — for each role in `roles.json`: copy `tokens/shesha.json` to a temp file, change **that one role's value**, recompile fixture #1, and assert the set of changed `colourSites[].jsonPointer` equals exactly the set whose `resolvedFrom` names that role. A role whose change leaks to another role's sites, or whose change moves nothing, fails.

**What moves:** `assets/capability-matrix.json` + `references/capability-matrix.md` → `packages/registry/data/capability-matrix.json`, hardened with per-row `id`, probe-form reference and per-row `measuredAt` (today all 36 rows share one header date, several inferences are labelled "production-confirmed", `tabs`/`collapsiblePanel` have **zero** rows, and `matrix.versions` re-introduces the drifting version list its own doc bans — `dataContext` 7 vs KB 8) `[§5]`. **`matrix.versions` is deleted**; the registry is the only version source. `assets/themes/*.tokens.json` → `packages/registry/data/tokens/`. `assets/block-styles/*` → `packages/sfs/recipes/`. `references/styling-v7-mechanics.md`, `style-channels.md`, `token-to-prop-mapping.md`, `component-recipes.md`, `shesha-design-standards.md`, `appearance-quality.md` → the compiler's emission mapping table `[§2.1.8]` + `roles.json` + the T5 rubric. **All six deleted.** `references/app-theme.md` → keep, ≤ 4 KB (the app-level antd theme is a real, separate, one-time backend action the compiler does not perform).

---

### 4.5 The MCP tool surface

Server name **`shesha-sfs`**. Package `packages/mcp`, bin `packages/mcp/bin/server.mjs`. Seven tools. This is **the concrete form of model-agnosticism** `[§4/L4]`: the same seven operations reachable from Claude Code, from CI, from the SAA harness, from a local model, with no model in the loop inside any of them.

Tool names use underscores (`registry_lookup`), 1:1 with the strategy doc's dotted names. Every tool: returns **paths plus a small summary**, never a large blob; is deterministic given the same run dir and registry; reports `walked/checked/uninspectable` where it inspects anything; returns `partial` rather than `pass` when it could not inspect something.

| Tool | Input (sketch) | Output (sketch) | Notes |
|---|---|---|---|
| `compile` | `{runId, screen, sfsPath?, brand?, backend?, out?}` | `{verdict, exit, formPath, reportPath, counts, coverage, escapes[], structuralEscapeRate, colourSites[], diagnostics[]}` | **The only writer of `*.form.json`.** Writes nothing on any error at stage ≤ 2 `[§2.1.8]` |
| `decompile` | `{form: path\|{module,name}, out?}` | `{sfsPath, diagnostics[], unlifted[]}` | Absent from the Specwriter's tool list — decompiling live markup is a corpus/migration operation |
| `verify` | `{runId, screen, tiers[], contractPath?}` | `{verdictPath, result, tiers{}, predicates[], findings[], route, advisory}` | **The only writer of `*.verdict.json`.** Seals with `sealedAt` + input hashes. Computes `result` from T1–T4 via `resultFor` |
| `registry_lookup` | `{types?, props?, intents?, datatypes?, enums?, kind?}` | `{registryRef, records[], missing[]}` | **Exact lookup, never similarity.** `missing[]` is populated, never silently empty. Replaces 16 reference files |
| `metadata_entity` | `{entity, refresh?}` | `{entity, modelType, source: live\|cache\|none, properties[], refLists[], cachedAt}` | `source:"none"` ⇒ every consumer marks the binding `uninspectable`. **Never** returns empty `properties[]` with `source:"live"` |
| `precedent_search` | `{kind?, archetype?, componentTypes?, regions?, text?, k?}` | `{method, results[], indexedAt, corpusSize, degraded?}` | §4.7. **Never used for correctness** — `g-rag-isolation` |
| `push` | `{runId, screen, confirm: true, allowPartial?: false}` | `{receiptPath, formId, module, name, revision, publishedAt, markupSha256}` | `push-admissible.mjs` runs P0–P9 inside the tool as well as in the hook — the hook is a fast pre-check, the tool is the authority. `confirm:true` required |

**Three wirings.** (1) `/.mcp.json` at the repo root, committed:

```json
{
  "mcpServers": {
    "shesha-sfs": {
      "command": "node",
      "args": ["packages/mcp/bin/server.mjs", "--stdio"],
      "env": { "SHESHA_REGISTRY_REF": "0.45.1" }
    }
  }
}
```

(2) **CLI / CI / any model with a shell** — the same seven operations, `--json` on every one, exit codes `0 pass · 1 fail · 2 usage · 3 partial`. `packages/mcp/src/tools/*.mjs` is the single implementation; the MCP server and the CLI are two thin adapters. `g-mcp-cli-parity` asserts the exported tool-name set equals the CLI subcommand set and each tool's input schema equals its subcommand's flag set. **Two surfaces, one implementation, or they drift.** (3) **A local model** — `--stdio` for MCP clients; `--http --port 7371 --host 127.0.0.1` for HTTP clients, loopback only, refusing any other `--host` with exit 2; and `npm run sfs -- registry grammar --out sfs.gbnf`, a **GBNF grammar generated from `sfs.schema.json`** for `llama.cpp`/Ollama constrained emission `[Appendix A item 4]`. Constrained decoding applies **only to the SFS emission step, never to a reasoning step** — Claude-3-Haiku GSM8K measured 86.5% → 23.4% under a JSON schema `[§4/L1]`; the generator emits a comment header saying so, and `grammar.test.mjs` asserts the header is present.

**In-session testability.** `packages/mcp/test/transports.test.mjs` covers what is testable without a client: (a) `import { tools } from '../src/tools/index.mjs'` exposes exactly 7 names; (b) each tool's `inputSchema` compiles under `ajv` strict; (c) `node packages/mcp/bin/server.mjs --stdio` answers a hand-written JSON-RPC `initialize` + `tools/list` written to its stdin, returning 7 tools (this is a pipe, not an MCP client, and it is a real test); (d) `--http --host 0.0.0.0` exits 2; (e) `--http --host 127.0.0.1` answers `POST /tools/registry_lookup {"types":["datatable"]}` with a record whose `type` is `datatable`; (f) the CLI subcommand `npm run sfs -- registry datatable --json` returns the same `version` as (e). **Whether Claude Code has *connected* to the server is WP-11 step 2**, not a WP-8 acceptance row.

**Token economics.** Tool search gives 85% reduction with accuracy up (79.5% → 88.1%); programmatic tool calling 37%; MCP-via-code-execution up to 98.7% (150K → 2K tokens) `[§4/L4]`. So: keep the surface at **seven** tools, and additionally export `packages/mcp/src/tools/index.mjs` as importable ESM so an agent with `Bash` can call `compile` on 12 screens in a 5-line script instead of issuing 12 tool calls. The Specwriter has no `Bash` and uses tool calls; `fleet-transformer` has `Bash` and must use the ESM import — `g-mcp-cli-parity` asserts the ESM export exists.

**Deliberately absent:** no `read_form`, no `write_form`, no `get_markup`. **There is no MCP operation that returns markup to a model.** `verify` returns findings; `compile` returns counts and a path. If a human needs the markup, they open the file.

---

### 4.6 Fan-out policy

**Fan out ACROSS screens. Never within one screen.** `[§4/L4]`

The evidence, from this repository: `shesha-form-edit/SKILL.md:165` records **two parallel authoring agents producing two mutually incompatible `refListStatus` shapes**, and the resolution shipped as a note in one file declaring the shape settled while `dropdowns.md:112-124` — the file the topic table actually routes to — kept shipping the flat `module` + `referenceListName` keys with an explicit warning not to correct it `[§1.2#2]`. Neither key exists in `refListStatus.json`'s `ownProps`. Anthropic's multi-agent post reports a 90.2% win for lead+subagents on breadth-first *research* and **explicitly excludes** tasks with shared context, heavy inter-agent dependencies, and "most coding tasks" `[§4/L4]`. A Shesha form is one tightly-coupled document.

| Situation | Policy |
|---|---|
| SFS for N screens in one run | Up to **3** concurrent `sfs-specwriter`, one per screen, each holding `locks/<screen>.lock`. Schema: `maxConcurrentScreens ≤ 3`, `withinScreen == 1` (`const`) |
| One screen's SFS | **One** agent. Repair is sequential rounds by the same role, never parallel attempts |
| Writing the compiler, tiers, hooks | **One** agent per file-disjoint package, ≤ 3 concurrent, and never two inside `packages/sfs/src/compile/` — one tightly-coupled program, the same shape as one form |
| Authoring the 10 fixtures (WP-7) | One agent per fixture, ≤ 3 concurrent. Independent documents with independent blessed outputs — the legitimate case |
| Authoring `SKILL.md` files (WP-7) | **One** agent for all four. Four parallel authors is exactly how five documents came to disagree about the block styling pass `[§1.2#5]` |
| Reading/auditing (registry gap survey, corpus triage, contradiction hunts) | Fan out freely, ≤ 5. Read-only work has no write conflict — the breadth-first case where 90.2% applies |
| `DECISIONS.md`, `CLAUDE.md`, `.claude/settings.json`, root `package.json` | **One** agent, serialised. A merge conflict in `settings.json` disables the hooks |

**Enforcement.** `enforce-screen-lock.mjs` L1–L4 makes a second writer on a screen or on `plan.json` structurally impossible.

For the rebuild's own source files, **`g-fanout-discipline` polices concurrency, not co-location.** The previous definition — "fails if a single commit touches two or more of `packages/sfs/src/compile/`, `packages/verify/src/`, `.claude/hooks/`, `plugins/*/skills/`" — is **deleted**, with a `DECISIONS.md` row recording the deletion: it forbade WP-1, WP-5, WP-7 and WP-8, each of which ships a compiler or skill change **and** the gate that enforces it, in one commit, by §5.2's own declared write sets. The replacement reads `packages/verify/config/fanout.json` (`{"<WP-id>": ["<glob>", …]}`) and the current WP from `.build/state.json`, and fails only when the staged diff contains a path outside the union of that WP's declared globs. The anti-pattern the old rule targeted (uncoordinated parallel authoring) is covered by that declared-glob partition. Mutations: (a) stage a file outside the current WP's globs → fail; (b) stage a file inside two of the old directories but inside the WP's globs → pass.

**The repair loop is capped at 3 rounds and the cap is in the state machine** (§4.2.2, `RUN-9003`), not in an agent's memory. Visual-refinement gains saturate at N=3–5 (66.0 → 73.0 from N=1→4), and SpecBench found more search iterations do **not** reliably remove reward hacking and sometimes amplify it `[§4/L4]`. A screen not green at round 3 is escalated with its verdict, not retried.

---

### 4.7 The precedent index

`packages/precedent/`. Section 1 scaffolds it in WP-0 throwing `E_NOT_IMPLEMENTED`; WP-9 implements **Index A only**. `[§4 "Where RAG belongs"]`

#### 4.7.1 The prohibition, enforced

**RAG is never used for correctness lookups.** "Which props are legal on `datatable` in 0.45.1?" needs an **exact** answer from an index, not a nearest-neighbour answer from an embedding; retrieval over the KB would reintroduce, probabilistically, the ambiguity the registry removes `[§4]`.

`g-rag-isolation` (required, ≥3 mutations): (1) no file under `packages/sfs/src/**` or `packages/verify/src/**` imports `@shesha/precedent` or references `precedent_search` — static scan, and a dynamic `import()` of a string containing `precedent` also fails; (2) no file under `packages/precedent/**` imports `packages/sfs/src/compile/**`; (3) `packages/mcp/src/tools/registry_lookup.mjs` contains no `cosine|embed|similarity|nearest|topK`; (4) no file under `plugins/shesha-developer/skills/**/*.md` matches any of the 6 patterns in `packages/verify/config/rag-forbidden.json` (each pairing `precedent_search` with a props/versions/enums question).

**RAG is used for exactly three things**, and nothing else may be added without a `DECISIONS.md` row: precedent retrieval over the decompiled corpus; design→archetype grounding; the error catalogue keyed by error code. The second and third are **BL-H2**; only the first ships in WP-9.

#### 4.7.2 Index A — shape, deterministic, zero dependencies

**Decision: the primary index is a deterministic SHAPE index, not an embedding index.** The strategy doc's instruction is to index by *shape* — archetype, entity cardinality, component multiset, region topology — not by prose similarity `[§4]`. Shape similarity is computable exactly, needs no GPU, no model download and no network, and is reproducible across machines and across CI.

For every SFS in `packages/sfs/corpus/` and every accepted `runs/*/screens/*.sfs.json`:

```js
/** @typedef {{kind:string, archetype:string, entityDepth:number,
 *   nodeMultiset:Record<string,number>, regionTopology:string,
 *   columnCount:number, actionIntents:string[], hasTabs:boolean,
 *   responsiveShape:string, escapeCount:number}} Shape */
```

`regionTopology` is the node-kind tree serialised depth-first with names stripped (`data(row(col(search),col(actions)),table,pager)`) — the same normalisation the compiler already performs, so it is free. Similarity = `0.5·jaccard(nodeMultiset) + 0.3·(1 - normalised tree edit distance of regionTopology) + 0.2·(kind equal ? 1 : 0)`. Brute-force scan: 5,000 forms of the above is under 8 MB, and `shape.test.mjs` asserts a full scan of a synthetic 5,000-row corpus completes in **≤ 50 ms** — there is no case for a vector extension at this corpus size.

**Storage is one file, `packages/precedent/data/shapes.jsonl`** — one JSON object per line, gitignored. No database. `node:sqlite` is rejected (BL-H1's DECISIONS row): on the pinned Node 22.14 it requires `--experimental-sqlite`, and an unflagged `import { DatabaseSync } from 'node:sqlite'` throws `ERR_UNKNOWN_BUILTIN_MODULE`, so a store built on it does not load. BL-H1's Index B, when it lands, uses the same JSONL plus a `Float32Array` `.bin` sidecar scanned brute-force.

`npm run sfs -- precedent index --corpus packages/sfs/corpus --runs runs --json` rebuilds. It records `corpusSize` and **refuses to build an index of size 0 with exit 3** rather than exit 0 — an empty index reporting success is the same defect as a gate with zero coverage. `precedent_search` always returns `method` (`"shape"` in WP-9; `degraded` is set when a requested `"embedding"` method is unavailable) — `precedent.test.mjs` asserts `method` is present on every response.

The Planner calls it once per screen (`k:3`) and writes the results into `plan.json.screens[].precedent[]`; the Specwriter reads the SFS files at those paths. **The Specwriter is adapting a known-good spec, not inventing one** — that is the mechanism that makes 768-byte specs reliable, and it compounds: every accepted screen enlarges the index `[§4]`.

---

### 4.8 Section 4 acceptance criteria

Every row is a literal command run from the repo root. The row passes iff the command exits 0 **and** its stdout contains the expected string. Values in `<>` are discovered by the command and written to `packages/verify/evidence/<WP>.json` by the gate runner; **no number below is typed into a commit body by the session.**

| # | Command | Expected in stdout |
|---|---|---|
| 1 | `node packages/verify/src/gates/g-agent-contract.mjs --json` | `"result":"pass"` and `"walked":6` |
| 2 | `node --test packages/verify/test/schemas.test.mjs` | `# pass <n>` with `# fail 0`; includes 7 ajv-strict-compile cases |
| 3 | `node --test packages/verify/test/schemas.test.mjs --test-name-pattern "plan rejects"` | `# pass 5` `# fail 0` — no contract · 2 predicates · no T3 predicate · `maxRounds: 5` · `withinScreen: 2` |
| 4 | `node packages/verify/src/gates/g-hook-contract.mjs --json` | `"result":"pass"`, `"hooks":6`, `"exit1Occurrences":0` |
| 5 | `node --test packages/verify/test/hooks.test.mjs` | `# fail 0`, `# pass <n>` with `n >= 60`; includes `p95 <= 5ms` |
| 6 | `node packages/verify/src/gates/g-markup-provenance.mjs --json` | `"result":"pass"`, `"walked":<n>` with `n >= 11`, `"unverified":0` |
| 7 | `node --test packages/verify/test/push-admissible.test.mjs` | `# pass 11` `# fail 0` — one refusal per P0–P9 plus one admission |
| 8 | `node --test packages/verify/test/hooks.test.mjs --test-name-pattern "enforce-screen-lock"` | `# pass 6` `# fail 0`; includes `HOOK-0403` and `HOOK-0405` |
| 9 | `node packages/verify/src/gates/g-prose-budget.mjs --json && node packages/verify/src/gates/g-skill-purity.mjs --json` | both `"result":"pass"`; `"tierAMatched":4`, `"tierAExpected":4`, `"assetBytes":0`, `"scripts":0`, `"readmes":0` |
| 10 | `node packages/verify/src/gates/g-skill-examples-compile.mjs --json` | `"result":"pass"`, `"compiled":10`, `"byteDifferences":0`, `"missingFromExamplesMd":0` |
| 11 | `node --test packages/registry/test/tokens.test.mjs` | `# fail 0`; `<n>/<n> colour sites resolved`, `unresolved: 0`, and `roles isolated: <r>/<r>` |
| 12 | `node packages/verify/src/gates/g-mcp-cli-parity.mjs --json` | `"result":"pass"`, `"tools":7`, `"subcommands":7`, `"schemaMismatches":0` |
| 13 | `node --test packages/mcp/test/transports.test.mjs` | `# pass 6` `# fail 0`; includes `tools/list -> 7` and `--host 0.0.0.0 -> exit 2` |
| 14 | `node packages/verify/src/gates/g-rag-isolation.mjs --json` | `"result":"pass"`, `"precedentReferencesInCompiler":0`, `"similarityCallsInRegistryLookup":0` |
| 15 | `node --test packages/precedent/test/shape.test.mjs` | `# fail 0`; `scan 5000 rows in <ms>ms` with `ms <= 50`; `empty index exit: 3` |
| 16 | `node packages/verify/src/gates/g-verdict-integrity.mjs --json && node packages/verify/src/gates/g-hook-liveness.mjs --json && node packages/verify/src/gates/g-specwriter-purity.mjs --json && node packages/verify/src/gates/g-judge-isolation.mjs --json && node packages/verify/src/gates/g-plugin-enabled.mjs --json && node packages/verify/src/gates/g-run-dir-location.mjs --json` | six `"result":"pass"`, each with `"walked":>=1` |
| 17 | `npm run sfs -- run report --run <runId> --json` (WP-10, the 3-screen CLI-driven run) | `"screens":{"verified":3}`, `"mustFindings":0`, `"hookDenials":<n>`, `"tokens":"unmeasured in this session"` |

Row 17 is the **in-session** half of the strategy doc's Phase 4 gate `[§6]`: three screens planned, specced, compiled and verified by driving `npm run sfs --` directly, with no subagent dispatch and no live hooks. It asserts the toolchain composes. **The subagent half is WP-11 (§4.9)** and is not read by `npm run prove`. Treat the token target as a hypothesis, not a result: the METR calibration (experienced developers 19% slower while believing they were 20% faster) applies to this session's own estimates `[§8]`, which is why `tokens` prints `unmeasured` (BL-H4).

---

### 4.9 WP-11 — restart verification (operator, out of session)

Run after the WP-10 commit, in a **fresh Claude Code session** on the Windows host, at `C:/Users/Hashim/Documents/GitHub/shesha-plugins`. Paste the observed output of each step into `BUILD-LOG.md` under `## WP-11`. This is the only place in the brief where an observation, not a program, is the evidence — because hook activation, MCP connection and plugin registration are properties of session startup and cannot be exercised by the session that authors them.

| Step | Action | Record |
|---|---|---|
| 0 | `/plugins` (or `/plugin`) in the fresh session | `shesha-developer` listed as enabled. If not: `/plugin marketplace add .` then `/plugin install shesha-developer@shesha-plugins`, re-observe, and commit the `.claude/settings.json` the tool wrote |
| 1 | Read the injected SessionStart context | The six lines of §4.3.7, verbatim |
| 2 | Call `mcp__shesha-sfs__registry_lookup` with `{"types":["datatable"]}` | The returned `registryRef` and the record's `version` |
| 3 | `Write` to `runs/<runId>/screens/<screen>.form.json` | The denial string, verbatim. Expected to start `HOOK-0101`. Then confirm the file was not created |
| 4 | `Read` `runs/<runId>/screens/<screen>.form.json` while `locks/<screen>.lock` has `role: "sfs-specwriter"` | The denial string. Expected `HOOK-0104` |
| 5 | `Read` `runs/<runId>/logs/specwriter-<screen>-r1.md` while `locks/eval-<screen>.lock` exists | The denial string. Expected `HOOK-0106` |
| 6 | `Task(subagent_type: "sfs-specwriter")` handing it `dispatch/sfs-specwriter-<screen>-r1.json` | (i) its SFS write succeeds; (ii) its `Read` of `<screen>.form.json` is denied `HOOK-0104`; (iii) a second concurrent `sfs-specwriter` on the same screen is denied `HOOK-0403`. Paste all three observed denials |
| 7 | `Task(subagent_type: "sfs-evaluator")` with a dispatch whose `paths[]` includes `logs/specwriter-<screen>-r1.md` | The denial string. Expected `HOOK-0503` |
| 8 | Drive the 3-screen brief end to end through the three agents, then `npm run sfs -- run report` | `report.md`, and `runs/<runId>/hooks.jsonl` committed as `packages/verify/test/fixtures/run/hooks.jsonl` if it is richer than the synthetic one |

A step that fails is a `[fix]` work package with the observed output as its evidence, not a reason to re-open WP-8's acceptance rows.

---

### 4.10 Assumptions other sections must honour

1. **Section 2's CLI gains two subcommands:** `validate --schema <name> --file <path> --json` (schema-only, writes nothing) and `run <init|lock|release|advance|report>`. `validate-sfs-on-write` and `enforce-screen-lock` are unimplementable without them.
2. **Section 2's compile report gains `colourSites[]`** = `[{jsonPointer, value, resolvedFrom}]`, `resolvedFrom` ∈ `"$role:<name>"|"$type:<name>"|null`. §4.4.4's checks 2 and 3 read it, and `g-no-literal-hex` alone cannot prove resolution happened.
3. **Section 3 owns `verdict.json`'s `tiers[].detail`, `findings[].evidence`, the `findings[].code` vocabulary, and the predicate library** at `packages/verify/src/predicates/index.mjs`. This section owns the envelope: `tiers.T*.{result,walked,checked,uninspectable,ms,backend}`, `findings[].{severity,owner,path,message}`, `coverage[].{required,walked,checked,uninspectable}`, `predicates[].{id,result}`, `sealedAt`, `inputs.*Sha256`, `advisory.t5`. Section 3 must not rename these.
4. **`resultFor(tiers, coverage, predicates)` and `pushAdmissible(verdict, opts)` live in `packages/registry/src/coverage.mjs`** — one implementation, imported by `verify`, `push-admissible.mjs` and `g-verdict-integrity`. Per Section 1's D-041 fix, `packages/verify/src/coverage.mjs` and `packages/sfs/src/lib/coverage.mjs` are one-line re-exports.
5. **T5 never contributes to `result`.** Section 3's §3.8 must contain the test: `verdict.result` is byte-identical whether `t5.json` reports the best or the worst possible score vector. `g-verdict-integrity` asserts the same thing from the other side.
6. **`registry_lookup` must answer `{kind:"predicate"}`** with the predicate registry, so the Planner can only write names that exist. Section 3 exports that list.
7. **Run dirs live at `runs/<runId>/`, not `.claude/shesha/runs/`.** `/runs/`, `/.build/`, `.claude/hooks.jsonl` and `packages/precedent/data/` are in `.gitignore` (§1.8 step 2). `g-run-dir-location` fails on new files at the old path.
8. **`plugins/shesha-developer/agents/**` is absent from §5's disposition table.** Decided here: 3 rewritten with `git mv`, 2 kept-and-rewritten, 1 kept-with-one-edit, **0 deleted**. Three `DECISIONS.md` rows required, `Enforced by: g-agent-contract`.
9. **`clean-form-config` is deleted as a skill** — a deletion not in §5's table. It needs a `DECISIONS.md` row citing §1.7 T8, and Section 1's `disposition.json` must be extended or `g-disposition` fails the commit.
10. **`packages/mcp` gets one external dependency**, `@modelcontextprotocol/sdk`, exact pin. `packages/precedent` gets **zero** for Index A. `packages/verify` keeps `playwright` as a devDependency with **no install script**; `npx playwright install chromium` is a WP-3c operator step.
11. **Gate ids deleted from the brief by this section**, so no other section may cite them: `g-hooks-wired` (subsumed by `g-hook-contract`), `g-plan-schema` (subsumed by `schemas.test.mjs` rows 2–3), `g-retro-ingested` (BL-H2), and the co-location definition of `g-fanout-discipline` (redefined in §4.6). **Gate ids added:** `g-markup-provenance`, `g-plugin-enabled`, `g-agent-contract`.
12. **`.build/state.json` and `.build/active-run`** are written by the session's own tooling and read by `g-fanout-discipline` and `lib.mjs`. Section 5 owns their contents.
