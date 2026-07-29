# Shesha designer consistency — design spec

**Date:** 2026-07-29
**Branch:** `claude/shesha-designer-fs-watcher-0550e8`
**Scope:** `plugins/shesha-developer/skills/{shesha-claude-designer, shesha-design-comprehension, shesha-design-system, shesha-form-edit, clean-form-config}`
**Status:** Approved for spec review

---

## Contents

- [1. Problem](#1-problem)
- [2. Evidence](#2-evidence)
- [3. Root causes](#3-root-causes)
- [4. Decisions taken](#4-decisions-taken)
- [5. Architecture](#5-architecture)
- [6. Stage 1 components](#6-stage-1-components)
- [7. Stage 2 components](#7-stage-2-components)
- [8. Contradiction resolution table](#8-contradiction-resolution-table)
- [9. What gets deleted](#9-what-gets-deleted)
- [10. Testing and evals](#10-testing-and-evals)
- [11. Risks](#11-risks)
- [12. Out of scope](#12-out-of-scope)
- [13. Sequencing](#13-sequencing)
- [14. Success criteria](#14-success-criteria)

---

## 1. Problem

Backend skills in `shesha-developer` (`domain-model`, `shesha-app-layer`) produce reliable output. The four design/form skills produce inconsistent, non-production-quality form layouts run to run. The same prompt yields materially different structure on different runs, and forms still reach the browser with render-crashing markup.

The goal is **consistency**, defined operationally as: *low variance in validator score and Tier-1/2 pass rate across repeated runs of the same eval case.* Variance, not average quality, is the target metric.

## 2. Evidence

### 2.1 Telemetry — the documented pipeline does not execute

Source: ClaudeLog API (`saa-testmanager-api-test.shesha.app`), window 2026-07-20 → 2026-07-22, 8,000 events, 345 sessions, $282.53 spend over the preceding 6 days. Isolating the 10 sessions that invoked `shesha-claude-designer`:

| Required pipeline step | Executions in 10 designer sessions |
|---|---|
| `shesha-design-comprehension` (REQUIRED SUB-SKILL, Step 2) | **0** (also 0 across the entire window) |
| Layout blueprint produced | **0** |
| `layout-probe.js` run | **0** |
| Gate 5a.5 placement re-measure | **0** |
| `Metadata/GetProperties` (Step 4.5, "mandatory") | **0** (window-wide: 56 auth calls, 2 metadata fetches) |
| Pushes per session | 2–18 |

Blueprint and probe activity does exist window-wide (190 and 23 references) but only inside plugin-authoring sessions, never inside a form build. The "measure, don't guess" spine has never run in a real build.

Other signals in the same window: 32 render-crash signatures (`e.match is not a function`, `reading 'migrator'`, `reading 'version'`); `clean-form-config` invoked from **two** plugins (`shesha-developer:` and `shesha-utils:`) so version selection was nondeterministic; 16 `form-auditor` and 6 `fullstack-prereq-checker` dispatches; harness test cases auto-classified `unknown` in **13 of 15** design cases.

### 2.2 Corpus census — real production forms do not follow the stated rules

Source: `frwk.form_configurations` in `RequirementsStudio` on `localhost,1433`. 100 forms parsed, 3,068 components.

| Rule the skills state | Reality |
|---|---|
| `validationErrors` always present | 47/100 forms |
| No loose `button` nodes ("highest-leverage rule") | 35/100 forms contain one; 76 instances |
| Every component carries its version | 164/3,068 versionless; `container` versions span [1,3,4,5,6,7,∅]; `datatable` [2,6,10,11,17,29] |
| Fields grouped into sections | 49/100 forms have neither `columns` nor a flex row |
| `columns` is banned | Live in 22/100 forms, 98 instances, all v5 |
| `customStyle` is a component prop | **0 occurrences** in 3,068 components |
| `dimensions.width` sizes split children | 1,132 non-container components carry `desktop.dimensions.width` |

**Consequence for the corpus plan:** this is a mixed-quality corpus, not a golden one. It must be *graded* before any of it is used as exemplars.

### 2.3 Internal audit

- **~250 distinct normative rules** across 430 rule-bearing lines; average restatement factor ≈1.7×.
- `shesha-form-edit/SKILL.md`: 389 lines / ~14k tokens, always loaded; the Non-negotiables block alone is ~5.5k tokens sitting at lines 313–364 of 389.
- A single "build one form to match a design" run loads **≈110,000–145,000 tokens** of instruction and asset text before any entity metadata, probe output, or form JSON.
- **33 rules (13%) are subjective** and cannot be verified by the model that follows them ("reads as machine-generated", "looks cheap", "component count matches the request's complexity").
- **14 contradictions.** Independently re-verified by hand: `columns` banned in 21 places / mandated in 6 / present in 12 spots across 6 seeds including `standalone-create.json`; section trigger stated two incompatible ways 40 lines apart in one file; label casing `"First Name"` vs sentence case `"First name"`; `editMode` has 4 mutually exclusive specs; `dataContext` version given as both 7 and 8.
- **No deterministic gate on design quality anywhere.** `validate-blocks.js` covers 10 static block files (0 fails, 18 warns; warnings never fail exit code). `clean-form-config` is prose an LLM performs, with 9 pre-declared false-positive classes it is told to ignore. `layout-probe.js` measures but emits no verdict or exit code. Gate 5a.5 is the model grading itself against assertions it authored, and is explicitly forbidden from asserting the one machine-comparable quantity.
- **Missing assets:** `shesha-form-edit/references/archetypes.md` (cited as the definition of the eight archetypes; does not exist — only 1 of 8 archetypes has block coverage, and three incompatible archetype vocabularies are in use); `shesha-design-system/assets/block-styles/page-header-band.style.json`; `shesha-form-edit/test-log/` (breaks 3 `package.json` scripts); probe field `multiColumnContainers[].childWidths` (three docs depend on it; never emitted).
- **Broken relative links:** 9, mostly a missing `components/` path prefix.
- **The 3-way ownership split is not real.** `form-edit` ships 24 hexes and ~8 files of v7 style authoring; `design-system` ships re-parenting instructions and CRUD wiring scripts; `assets/block-styles/*` contain 43 literal hexes against 10 token references, so "brand lives entirely in one token file" is false. `requirements-studio.tokens.json` is missing 198 of the default's 290 keys including `$antdTheme`, so `$role:bodyInk` is unresolvable under the brand every worked example uses.

### 2.4 Framework ground truth

Source: local checkout `shesha-framework/shesha-reactjs` on `releases/0.45`, plus a working extraction harness.

- **No JSON Schema, zod, yup or ajv exists** in the framework. TS types are too loose to codegen from: `IConfigurableFormComponent` declares `desktop?: any; tablet?: any; mobile?: any`.
- **The real machine-readable contract is each component's `settingsFormMarkup`.** Extraction proved out: **116 types, 116 settings forms parsed, 0 failures.** Mechanism: `getComponentDefinitions()` → `def.settingsFormMarkup({fbf})` → walk for `propertyName` leaves (dotted paths included); `def.migrator(new Migrator()).lastVersion` → current version.
- **The hand index is materially wrong:** 65 types vs 116; `addressInput` is a phantom; 52 missing including `datatableContext`; `container` documented with ~15 props against a real 71.
- **The framework's own `validateConfigurableComponentSettings` early-returns for factory-based settings forms**, so 79 of 116 components validate nothing upstream. A custom validator is the only available oracle.
- **`columns` is not deprecated** — antd `<Row gutter>`/`<Col md={flex}>`, v5, still registered in the Layout group, documented, overflow past 24 only warns.
- **A flex `container` has two DOM nodes.** `dimensions`/`border`/`background`/`shadow` → outer div (`wrapperStyle`); `display`/`flexDirection`/`gap`/`justifyContent`/`alignItems` → inner div (`getAlignmentStyle`). A *container* child of a flex row is therefore correctly sized by its own `dimensions.width`.
- **A plain input is not.** It is wrapped in an antd `Form.Item` whose chain (`.ant-row`, `.ant-form-item-row`, `.ant-form-item-control*`) is forced `width: 100% !important`. `desktop.dimensions.width: "50%"` on a `textField` inside a flex container gives 50% of the already-resolved flex item — it does not create a 50/50 split.
- **Two further traps:** `noDefaultStyling: true` collapses to one div and drops `wrapperStyle` entirely (silently discarding dimensions/border/background/shadow); `getAlignmentStyle` only emits `gap`/`justifyContent`/`alignItems` when `direction === 'horizontal' || display !== 'block'`, and `flexDirection`/`flexWrap` only when `display === 'flex'` — so `gap` without `display` is a no-op.
- **Styling precedence** (no documented order exists; derived from source): device-block shallow merge (`{...model, ...model[device]}`, `desktop` default, breakpoints >724 / >599) → code-mode settings resolution → structured appearance in spread order `stylingBox → dimensions → border → font → background → shadow → overflow` → **legacy `style` JS string wins over everything** → margins stripped and routed to the `Form.Item` wrapper. On a container's outer div, `wrapperStyle` JS is the ultimate winner.
- **`customStyle` is not a model prop.** It is a `collapsiblePanel` label inside settings forms; no factory reads `model.customStyle`. Corroborated by the corpus census (0 occurrences).
- **Migration hazard:** `migratePrevStyles` rewrites all three device blocks from top-level legacy fields, and `upgradeComponent` treats absent `version` as `-1` and runs every migration. Markup emitted without a correct version has its device blocks overwritten.
- **Version reality:** npm `latest` = **0.43.36** (2026-07-21); highest published = **0.45.1** (2026-06-01); NuGet `Shesha.Framework` = 0.45.1; newest release branch = `releases/0.45`; no 0.46 exists. Recent churn in the form/designer/styling area is active (TextField/TextArea/Checkbox rewrite in flight on `main`; `main` has moved to React 19 / antd 6 / Next 16).

## 3. Root causes

Ranked by contribution to observed inconsistency.

1. **The pipeline's required steps are advisory prose in a sibling skill, and nothing forces them.** `Skill(...)` in a step list is a probabilistic instruction. 0/10 compliance. Anthropic's own position: a "never do this" instruction is the wrong tool; hooks and permissions are the enforcement mechanisms, and hooks are the only mechanism they classify as deterministic.
2. **No external oracle.** A wrong layout renders, throws nothing, and produces no feedback signal — so the rules governing it are unfalsifiable and drift freely. `domain-model` works because the C# compiler and CRUD tests reject wrong output.
3. **Rule-count collapse.** ManyIFEval measures joint instruction compliance against instruction count: 94% at n=1 → 21% at n=10 (Claude 3.5 Sonnet 95% → 48%). At ~250 rules, "follow all the rules" is not an achievable target and *which* rules survive each run is effectively random. Compounded by the rules sitting at lines 313–364 of a 389-line file — the position "Lost in the Middle" identifies as worst-retrieved.
4. **Self-contradiction.** Where two rules conflict and neither is enforced, the outcome is a per-run coin flip. 14 such sites.
5. **Trigger collision.** Three of four skill descriptions claim the same phrasing ("match a design"); which fires is nondeterministic.
6. **No evals.** Zero `evals/` directories, so every change to date has been unfalsifiable. The existing harness cannot grade design cases (13/15 classified `unknown`).

## 4. Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Route | **A staged** — Stage 1 = cut/enforce + corpus, Stage 2 = typed spec + compiler | Evals are the prerequisite for knowing anything worked; the subtractive work is nearly free |
| `columns` | **Strict ban + mandatory container wrapping.** Every flex-row child MUST be a `container`; fields go inside it. `dimensions.width` on a non-container is a validator **error** | One mechanism, enforced by code. The unamended ban is unimplementable (§2.4): following it literally on bare inputs produces a broken layout |
| Version pin | **0.45.1** | Matches the local checkout, NuGet packages, and the published doc tree |
| Corpus source | **SQL Server `localhost,1433`**, graded before use | Direct access to all four real project DBs; the running backend is currently empty |

## 5. Architecture

Two layers and one oracle.

```
                    ┌──────────────────────────────┐
                    │  registry.0.45.1.json        │  generated from framework source
                    │  (116 types, props, versions)│
                    └───────────────┬──────────────┘
                                    │
   model output ──► normalize-form ──► validate-form ──► PreToolUse hook ──► push
   (or compile-spec, Stage 2)   │            │                  │
                                │            │                  └─ deny on Tier 1/2 fail
                        fixes ~40 rules   Tier 1 renderability (fail)
                        deterministically Tier 2 contract      (fail)
                                          Tier 3 layout/appearance (score 0-100)
                                                 │
                                                 └──► corpus grading ──► curated exemplars
                                                 └──► eval assertions ──► pass_rate + stddev
```

**Principle:** a rule the normalizer can *fix* is deleted from the prose. A rule the validator can *check* becomes a one-line pointer, not an argument. Only rules that are neither fixable nor checkable stay as prose — and there should be very few.

## 6. Stage 1 components

### 6.1 Generated registry

**Location:** `plugins/shesha-developer/skills/shesha-form-edit/scripts/gen-registry.mjs` → `assets/registry/registry.0.45.1.json` + `registry.meta.json`

Runs against the pinned framework (local `releases/0.45` checkout, or a pinned `@shesha-io/reactjs@0.45.1` install — the published package ships full typings and JS).

Emitted per component `type`:

```jsonc
{
  "textField": {
    "version": 6,
    "group": "Data entry",
    "isInput": true,
    "isOutput": true,
    "props": ["propertyName", "label", "hideLabel", "desktop.dimensions.width", "..."],
    "customContainerNames": []
  },
  "collapsiblePanel": { "version": 9, "customContainerNames": ["header", "content", "customHeader"], "...": "..." }
}
```

`registry.meta.json` records the framework version, source (git SHA or npm version), and generation timestamp so drift is visible.

Implementation notes:
- Needs 6 shims to run: jsdom `matchMedia` + `ResizeObserver`; `nanoid` and `redux-actions` are ESM-only; `?raw` and `.css` import stubs; `antd/es/*` → `antd/lib/*`.
- Call `getToolboxComponents(devMode: true, ...)` to enumerate the Dev group and Header Components.
- **Scaffolding denylist required:** extraction currently also picks up settings-form panel/tab node names (`settingsTabs`, `propertyRouter1`, `pnlDimensions`, `pnlBorderStyle`, `bordericon`). Filter by the emitting node's `isInput`.
- Commit the generated file. Regenerate deliberately on version bump, never silently.

**Replaces:** the 7 hand-maintained `assets/groups/*.json` + `index.json` in `shesha-form-edit`, and the parallel copies in `clean-form-config`.

### 6.2 The validator

**Location:** `shesha-form-edit/scripts/validate-form.mjs`

**Contract:** `node validate-form.mjs <form.json> [--registry <path>] [--json]`. Exit **0** if no Tier 1/2 findings, **1** otherwise. Emits machine-readable findings: `{tier, code, severity, path, message, expected, actual}` plus a Tier 3 `score` 0–100.

**Tier 1 — renderability (hard fail).** Each of these has a real crash story in the telemetry or the audit:

| Code | Check |
|---|---|
| `T1-VERSION-MISSING` | every component has an integer `version` (pure layout slots exempt) |
| `T1-VERSION-STALE` | `version` matches the registry's `lastVersion` for that type |
| `T1-TYPE-UNKNOWN` | `type` exists in the registry |
| `T1-PROP-UNKNOWN` | every prop key exists in the registry's `props` for that type |
| `T1-ID-NOT-UUID` | `id` is a real UUID |
| `T1-ID-DUPLICATE` | ids unique tree-wide |
| `T1-PARENT-MISSING` | `parentId` present and resolves (root-level = `"root"`) |
| `T1-DEFAULTVALUE-NONSTRING` | `defaultValue` is a string (never array/number/object) |
| `T1-EDITCOMPONENT-SHAPE` | datatable `editComponent`/`createComponent` is `{type:"[not-editable]"}` or `{type,settings}` — never `[default]`, never a flat model |
| `T1-DOUBLE-SLOT` | no `card`/`collapsiblePanel` with children in both `content.components` and `components[]` |
| `T1-SCRIPT-SYNTAX` | every script string passes `node --check` |
| `T1-JSON-ROUNDTRIP` | `JSON.parse(JSON.stringify(markup))` succeeds; no template literals or literal newlines in script/endpoint values |

**Tier 2 — contract (hard fail).**

| Code | Check |
|---|---|
| `T2-COLUMNS-PRESENT` | no `columns` component |
| `T2-FLEXCHILD-NOT-CONTAINER` | every direct child of a flex-row container is itself a `container` |
| `T2-WIDTH-ON-NONCONTAINER` | no `dimensions.width` on a non-container component |
| `T2-FLEX-NO-DISPLAY` | any container setting `gap`/`flexDirection`/`justifyContent`/`alignItems` also sets `display:"flex"` |
| `T2-NODEFAULTSTYLING-DROPS-STYLE` | no `noDefaultStyling:true` on a container that also carries `dimensions`/`border`/`background`/`shadow` |
| `T2-VALIDATIONERRORS-MISSING` | `validationErrors` present when any input has `validate.required` |
| `T2-SUBMIT-WIRING` | Save/Submit item is `actionName:"Submit"`, `actionOwner:"shesha.form"` |
| `T2-EXIT-MISSING` | paired exit action per host type: standalone → `Navigate`/`shesha.common`; modal → `Close Dialog`; detail → `Cancel Edit` |
| `T2-LOOSE-BUTTON` | no standalone `button` in an action row (inline-beside-content allowed) |
| `T2-PROPERTYNAME-CASE` | every `propertyName` camelCase, including datatable column `propertyName`s |
| `T2-DROPDOWN-SOURCE` | `dataSourceType` present and its mandatory config matches (`referenceListId` as `{module,name}`; `entityType`; `values[]` with all three keys) |
| `T2-DATE-COMPONENT` | date/date-time properties use `dateField` |
| `T2-MODELTYPE-SHAPE` | `formSettings.modelType` is `{name, module}` |
| `T2-EDITMODE-MISMATCH` | `editMode` matches the form-type table (§8) |
| `T2-DATACONTEXT-PROPS` | `dataContext` carries `entityType`, `sourceType`, `dataFetchingMode`, `defaultPageSize`, `uniqueStateId` |

**Tier 3 — layout and appearance (score, never blocks).** Weighted 0–100: label casing canonical · section count vs blueprint region count · one `primary` per action zone · destructive never `primary` · header `text` has explicit `fontSize` + `fontWeight` · no raw hex outside theme tokens · component-count ratio · no orphan wrapper containers.

Two values in Tier 3 are **calibrated from the corpus, not guessed** — they are set once in step 4 of the sequencing and recorded in `registry.meta.json`:

- **Component-count budget.** Expressed as `components / bindings`. The threshold is the 75th percentile of that ratio across corpus forms scoring in the top quartile on the other Tier 3 checks — i.e. what good real forms actually do, not an invented constant.
- **Eval pass threshold.** The Tier 3 score an eval case must reach. Set at the median score of the curated exemplars, so "as good as our own best forms" is the bar. Recorded per eval case so it can be raised deliberately over time.

**Tier 3 must never gate a push.** Its purpose is to make quality a number, so the corpus can be ranked and runs compared.

### 6.3 The normalizer

**Location:** `shesha-form-edit/scripts/normalize-form.mjs`

**Contract:** `node normalize-form.mjs <in.json> [--out <out.json>] [--registry <path>]`. Deterministic and **idempotent** — `normalize(normalize(x)) === normalize(x)` is a test.

Transforms:

| Transform | Deletes this prose rule |
|---|---|
| Stamp `version` from registry per type | "every authored component carries its version" + the hardcoded version list |
| `stampTree` for `parentId` (incl. `columns`/`tabs`/`content`/`header` slots) | the `parentId` rule + the inline `stampTree` snippet |
| Mint UUIDs for non-UUID ids; de-duplicate colliding ids | the UUID rule |
| Canonicalise label casing → **sentence case** | the label-casing contradiction |
| Rewrite `columns` → flex `container` + one child `container` per col, widths derived from `flex`/24 | the `columns` ban restated 21× |
| Wrap bare non-container children of a flex row in a `container`; move their `dimensions.width` to the wrapper | the "sized via `dimensions.width`" rule and its 348/356 constants |
| Strip `dimensions.width` from remaining non-containers | — |
| Strip `customStyle` | 7 discussions of a prop that does not exist |
| Add `display:"flex"` where `gap`/`flexDirection` present | that rule, restated 6× |
| Replace hardcoded `calc(100% - 348px)` / `356px` with derived `calc(100% - <rail+gap>px)` | the magic constants in 8 files |
| Canonical prop ordering | — |

Everything the normalizer does is a decision taken *once*, in code. That is the point: an option left open is an option the model resolves differently next run.

### 6.4 Blocking hooks

**Location:** `plugins/shesha-developer/hooks/hooks.json`

Two hooks:

1. **`PreToolUse`** matching `Bash|PowerShell` where the command contains `UpdateMarkup` or `ImportJson`. Resolve the staged markup path from the command, run normalize → validate. On any Tier 1/2 finding, return `permissionDecision: "deny"` with the findings as `reason`. On pass, allow.
2. **`Stop`** — if a form push occurred this session and no passing validation record exists in `${CLAUDE_PLUGIN_DATA}/validation-log.jsonl`, return `decision: "block"` with a reason naming the unvalidated form.

This is the mechanism that makes "you cannot push an invalid form" a fact rather than an aspiration, and it holds *regardless of which pipeline steps ran* — which is why it is the highest-leverage single item in Stage 1.

**Escape hatch:** `SHESHA_SKIP_FORM_VALIDATION=1` bypasses both, for debugging only. Hooks log every bypass.

**Enablement order (non-negotiable):** the hook is only switched on after the validator has been run against all 233 corpus forms and its false-positive rate assessed. A false-positive validator behind a blocking hook is worse than no hook.

### 6.5 Rule surgery

**`shesha-form-edit/SKILL.md`: 389 lines / ~14k tokens → ≤120 lines / ≤4k tokens.** It becomes a workflow plus pointers. Specifically:
- Delete every rule now enforced by the validator or fixed by the normalizer (~150 of ~250).
- Delete the 52-line Non-negotiables block; what survives moves into the step where it applies.
- Delete the hardcoded version list (registry owns it), the `stampTree` snippet (normalizer owns it), the `customStyle` discussion (does not exist), and the Step 5.5 JSON safety snippet (validator owns it).
- One authority per surviving fact; every other location becomes a one-line pointer.

**Boundary repair.** Move out of `form-edit` → `design-system`: the 24 hexes and v7 style blocks in `components/containers.md`, `components/detail-page-pattern.md`, `references/form-quality.md:186-190`, and the whole of `references/design.md` (a fourth styling authority). Move out of `design-system` → `form-edit`: the re-parenting and CRUD-wiring instructions in `component-recipes.md:48-62`, `capability-matrix.md:66`, `style-channels.md:64,103`.

**Missing assets.** Write `references/archetypes.md` — the eight archetype names, each with its seed *and* its block set — and reconcile the three archetype vocabularies into one. Ship `page-header-band.style.json` and make `validate-blocks.js` fail when `$styleOverlay` does not resolve. Either bring `requirements-studio.tokens.json` to key-parity with the default (198 missing keys incl. `$antdTheme` and `bodyInk`) or delete it and stop citing it. Convert the 43 hardcoded hexes in `assets/block-styles/*` to `$role:` tokens, or retract the "brand lives entirely in one token file" claim.

**Housekeeping.** Fix the 9 broken relative links. Delete the dead `test`/`iterate`/`auto` scripts from `package.json`. Retire `rs-detail-with-header.json` (25,010 lines ≈ 189k tokens), `employee-detail-with-child-tables.json` (~175k tokens) and `employee-detail-without-child-tables.json` (~99k tokens) — the skill forbids reading them while requiring you copy them. Rewrite the 12 `columns` instances across the 6 remaining seeds. De-duplicate `clean-form-config` to one plugin.

### 6.6 Corpus grading and exemplar curation

**Location:** `shesha-form-edit/scripts/mine-corpus.mjs`, `scripts/grade-corpus.mjs`

1. Mine `frwk.form_configurations` joined through `frwk.configuration_item_revisions` → `frwk.configuration_items` → `frwk.modules` across `RequirementsStudio`, `AssetManagement2`, `MembershipManagement`, `UtilityManagement`. Emit JSONL: `{module, form, label, modelType, markup}`. Corpus artifacts go to the scratchpad or a gitignored path — **never** into the plugin tree.
2. Normalize + validate every form → `corpus-report.md`, ranked by Tier 3 score with Tier 1/2 findings listed.
3. Curate into `assets/exemplars/`: highest-scoring form per `(archetype, form-type)`, **deterministic tie-breaking** — score, then fewest components, then name ascending. Normalized and validator-clean by construction. Small: an exemplar over ~400 lines is a curation failure.
4. Exemplar **ordering** in any prompt is fixed and recorded, because exemplar order alone can swing output.

Byproduct: `corpus-report.md` is a prioritised list of real forms worth fixing.

### 6.7 Agents and descriptions

**`plugins/shesha-developer/agents/shesha-form-designer.md`** — frontmatter carries `skills: [shesha-developer:shesha-design-comprehension, shesha-developer:shesha-form-edit]` so the skill content is **injected, not discovered**; `model` and `effort` pinned so runs are comparable; fresh context so the 145k-token pile-up cannot recur. `shesha-claude-designer` dispatches one per screen instead of relying on a sibling `Skill()` call firing.

**Description surgery.** `shesha-claude-designer` keeps "match a design" as its trigger. `shesha-design-comprehension`, `shesha-design-system` and `shesha-form-edit` lose that phrasing and are described as sub-skills invoked by the orchestrator or the agent. Trigger rate is then measured over ≥3 runs per eval case.

## 7. Stage 2 components

Deferred until Stage 1 shows a measurable stddev reduction on evals.

- **`form-spec.schema.json`** — the blueprint becomes JSON, not Markdown prose: `{archetype, entity, formIdentity, regions[{name, recipe, rows[{children[{kind, width}]}]}], bindings[], assertions[]}`.
- **`compile-spec.mjs`** — spec → Shesha form JSON. Emits parentIds, versions, editMode-by-form-type, buttonGroup shape, `validationErrors`, flex containers with container children, camelCase propertyNames. The model authors the spec; it never authors markup. This is what makes ~100 further shape rules unrepresentable rather than merely forbidden.
- **`verify-placement.mjs`** — evaluates spec assertions against two probe runs, with a real exit code. Prerequisites: fix `layout-probe.js` to emit `multiColumnContainers[].childWidths` and drop the `colSpan24` /24 normalisation its own spec forbids; fix the column-count heuristic that counts a vertically-stacked indented pair as two columns.
- **Typed assertion grammar** — `same-cluster(a,b)`, `parent-of(a,b)`, `ratio(a,b,min,max)`, `same-rowband(a,b)`, `tab(a,key)`: exactly the five dimensions `verification-loop.md` already tabulates, made executable.

## 8. Contradiction resolution table

| # | Contradiction | Resolution | Enforced by |
|---|---|---|---|
| 1 | `columns` banned (21×) vs mandated (6×) vs present in 6 seeds | Banned. Flex row whose children are all `container`s. Seeds rewritten | `T2-COLUMNS-PRESENT`, normalizer rewrite, `validate-blocks` fails (not warns) |
| 2 | Section trigger: ">1 logical group, not a field count" vs ">5 inputs" | Design/IA only. Delete the field-count rule | Tier 3 score vs blueprint regions |
| 3 | Label casing `"First Name"` vs `"First name"` | Sentence case | normalizer |
| 4 | `editMode` — 4 specs | One 5-row table: detail-with-lifecycle `inherited` · read-only rail `readOnly` · create/edit dialog `editable` · action/anonymous page `editable` · visual components omit | `T2-EDITMODE-MISMATCH` |
| 5 | `dataContext` version 7 vs 8 | Registry | `T1-VERSION-STALE` |
| 6 | `calc(100% - 348px)` vs `356px` for the same example | Derived `calc(100% - <rail+gap>px)`; no hardcoded constants | normalizer |
| 7 | Eight archetypes undefined; 3 vocabularies | Write `archetypes.md`; one vocabulary; blocks tagged to match | doc + `validate-blocks` |
| 8 | `validationErrors` unconditional vs "when required input exists" | When any input has `validate.required` | `T2-VALIDATIONERRORS-MISSING` |
| 9 | "a single `buttonGroup`" vs "MAY carry more than one" | Multiple allowed across distinct zones; one `primary` per zone | `T2-LOOSE-BUTTON` + Tier 3 |
| 10 | Card shadow: mandatory vs brand-conditional vs flat | Brand-conditional — present only if the brand defines `shadow.card` | design-system, single statement |
| 11 | `KeyInformationBar` canonical vs deprecated | Flex row of N cells; mark the component deprecated in one place | doc |
| 12 | design-system "never restructure" vs recipes that restructure | Structural instructions move to form-edit | boundary repair |
| 13 | Minimalism vs required floor | Floor = inputs + `validationErrors` + Submit + exit + structural wrappers. Wrappers inserted by the normalizer are exempt from the count | Tier 3 component-count check |
| 14 | Seed priority: `examples/` first (line 22) vs `blocks/` first (line 147) | Exemplars first, then blocks, then examples. Stated once | SKILL.md |

## 9. What gets deleted

- ~150 of ~250 prose rules (enforced by code or fixed by the normalizer).
- ~10k tokens from `shesha-form-edit/SKILL.md`.
- 7 hand `assets/groups/*.json` + `index.json` in form-edit, and the duplicate set in clean-form-config.
- 3 unreadable seeds (~460k tokens of assets that cannot be read).
- The `customStyle` discussion in 7 places.
- The hardcoded version list, the `stampTree` snippet, the JSON-safety snippet.
- 33 subjective rules — either restated as a Tier 3 predicate or removed.
- One duplicate `clean-form-config`.

Target: instruction load for a single design run drops from **110–145k tokens to under 40k**.

## 10. Testing and evals

**Unit tests** (`scripts/__tests__/`):
- `normalize-form` idempotence: `normalize(normalize(x)) === normalize(x)` over the whole corpus.
- `normalize-form` preservation: component count, ids and bindings preserved except where a transform is specified.
- `validate-form` fixtures: one minimal failing fixture per Tier 1/2 code, plus a passing fixture.
- `gen-registry` snapshot: 116 types, 0 settings-form failures, no scaffolding ids in `props`.

**Corpus regression:** validator run over all 233+ forms; the report is committed so a change in findings is a reviewable diff. This is also how the false-positive rate is assessed before the hook is enabled.

**Evals** (`evals/evals.json` per skill): each case = prompt + fixture + assertions. For design cases the assertion is **Tier 1/2 pass + Tier 3 score ≥ the case's calibrated threshold** (§6.2), so grading is objective rather than model-judged. Report `pass_rate` **and stddev** across ≥3 runs. Also record skill **trigger rate** per case to detect description collisions.

**Harness fix:** the SAA Test Manager classifier reads form intent only from `buttonGroup` items, which is why 13/15 design cases land as `unknown`. It must read the form type from the test-case metadata instead.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Registry generation is fragile — 6 shims, a scaffolding denylist, and settings-form structure could change | Pin 0.45.1; commit the last known-good registry; regenerate deliberately; snapshot test asserts 116/116 |
| False-positive validator behind a blocking hook is worse than no hook | Tier 1/2 block, Tier 3 only scores; run against all 233 corpus forms and assess FP rate *before* enabling; escape-hatch env var; every bypass logged |
| Container wrapping inflates component count and collides with minimalism | The normalizer inserts wrappers, so it is not the model's job; the minimalism rule explicitly exempts structural wrappers |
| Normalizer rewriting `columns` could change rendering on existing live forms | Normalizer runs on *authored output*, not as a bulk migration. Any fleet migration is a separate, pilot-first exercise via `fleet-transformer` |
| Framework churn (React 19 / antd 6 on `main`; TextField/TextArea/Checkbox rewrite in flight) | Registry is version-stamped and regenerable; prose keeps only what no schema can express (the outer/inner DOM split and the precedence chain) |
| Cutting SKILL.md removes a rule that was load-bearing but unenforced | Every deleted rule must be traceable to a validator code, a normalizer transform, or an explicit decision to drop it. The rule inventory is the checklist |
| Corpus contains PII / client data | Corpus artifacts stay outside the plugin tree and out of git; exemplars are reviewed and field values scrubbed before curation |

## 12. Out of scope

- The `copilot-toolkit/` folder. Assessed as ~85% duplication: `awesome-copilot` has converged on the same Agent Skills spec already in use, and `prompts/`, `chatmodes/`, `collections/`, `mcp/` no longer exist upstream. The one additive idea is path-scoped instructions via `.claude/rules/*.md` with `paths:` (which VS Code reads natively in Claude's format) — but a plugin cannot ship rules, so it needs project-level files or an installer. Deferred.
- The Next.js SSE hot-reload watcher for `.form.json` files. Unrelated to output consistency; forms live in the backend DB, not on disk.
- Backend/BE-agent and architect-agent layers beyond `shesha-form-designer`. Worth building, separate spec.
- Bulk migration of the 233 existing production forms. The corpus report identifies them; fixing them is separate, pilot-first work.
- Visual-regression gating (Chromatic-style baseline + approval). Valuable but requires deterministic rendering — seeded data, fixed dates, no animation. Revisit after Stage 2.

## 13. Sequencing

| # | Work | Est. | Unblocks |
|---|---|---|---|
| 1 | Registry generator + snapshot test | 1d | everything |
| 2 | Validator Tier 1+2 + fixtures | 1.5d | hook, corpus grading, evals |
| 3 | Normalizer + idempotence tests | 1d | rule deletion |
| 4 | Corpus mine + grade + FP assessment + curate exemplars | 1d | exemplar-based authoring |
| 5 | Blocking `PreToolUse` + `Stop` hooks | 0.5d | enforcement |
| 6 | Rule surgery, contradiction resolution, boundary repair, seed rewrite, missing assets | 2d | token reduction |
| 7 | Evals + harness classifier fix | 1.5d | measurement |
| 8 | `shesha-form-designer` agent + description surgery | 0.5d | pipeline execution |

**≈9 days for Stage 1.** The oracle lands first; everything after it is measurable. Stage 2 begins only after evals show a stddev reduction.

Plugin version bumps follow `CLAUDE.md`: the pre-release suffix increments while the version carries `-alphaN`/`-betaN`; otherwise minor for a new skill, patch for enhancements to existing ones.

## 14. Success criteria

1. **Variance down.** Tier 3 score stddev across 3 runs of the same eval case drops by ≥50% versus a pre-change baseline measured on the same cases.
2. **No invalid pushes.** Tier 1/2 findings on pushed forms: zero, enforced by the hook. Render-crash signatures in telemetry trend to zero (baseline: 32 in 2 days).
3. **Pipeline actually executes.** `shesha-design-comprehension` invocation rate in design builds goes from 0/10 to ≥9/10, measured from telemetry.
4. **Instruction load down.** A single design run loads <40k tokens of instruction/asset text (baseline 110–145k).
5. **Rule count down.** ≤100 prose rules across the four skills (baseline ~250), with zero known contradictions and zero unverifiable rules that gate a decision.
6. **Registry accurate.** 116/116 types, 0 phantoms, versions matching the framework.
7. **Design cases gradable.** 0/15 harness design cases classified `unknown` (baseline 13/15).
