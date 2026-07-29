# Phase 3: The Deterministic Compiler and Placement Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Stop the model authoring Shesha markup. It authors a typed blueprint; a deterministic compiler emits the markup. Then make placement verification executable instead of self-graded.

**Architecture:** `compile-spec.mjs` takes a styled blueprint + the registry + the role catalogue + the archetype flow manifest and emits form markup that is **validator-clean by construction**. `verify-placement.mjs` evaluates a typed assertion grammar against two probe captures and exits non-zero on mismatch. The probe is fixed to emit the per-child widths three documents already assume.

**Tech Stack:** Node 25, `node --test`, zero dependencies.

## Why this phase is the point of the whole project

Forensics on two real failed builds established that both sessions **followed the pipeline correctly** — design comprehension ran, blueprints were produced for all 9 forms, entity metadata was genuinely fetched — and the forms still came out visibly broken. The defects were introduced in the last mile: hand-written `build-forms.mjs` / `build-asset-*.js` scripts that translated validated blueprints into markup. The flight session used one monolithic script pushed 9 times, so a single `compile()` bug replicated identically across six forms. Its sibling session hit the same width bug, **found it, and fixed it**; the flight session never noticed.

That is the variance this phase removes. A bespoke translator authored per run fails differently every run. One compiler, tested once, does not.

## Global Constraints

- **Framework pinned to 0.45.1.** Registry `shesha-form-edit/assets/registry/registry-0.45.1.json` — 116 components. Never regenerate in this phase.
- Forward slashes only in paths written into files. Zero dependencies.
- **Never emit a `columns` component.** Flex `container`s are the only split mechanism.
- **Never set a proportional width on an input leaf.** It lands inside an antd `Form.Item` chain forced `width: 100% !important` and cannot size a flex track. Geometry belongs on a wrapping field-cell container; the leaf gets `width: "100%"`.
- **Style values come from resolved roles, never invented.** An override is legal only with `{prop, value, source, evidence}`.
- `authorable: false` registry types are recognised but never emitted.
- `version: null` types are exempt from version stamping.
- Do not modify the framework repo. Do not commit corpus data.
- Plugin version bump per `CLAUDE.md`; currently `1.8.19`.

## Assets this phase consumes (all already committed)

| Asset | Location |
|---|---|
| Registry, 116 components | `shesha-form-edit/assets/registry/registry-0.45.1.json` |
| 15 style roles + `resolveRole` | `shesha-design-system/assets/roles.styles.json`, `scripts/lib/resolve-role.mjs` |
| 8 archetype flow manifests + `loadFlow`/`requiredNodes` | `shesha-form-edit/assets/archetypes/`, `scripts/lib/flow.mjs` |
| Blueprint schema + validator | `shesha-design-comprehension/assets/blueprint.schema.json`, `scripts/lib/validate-blueprint.mjs` |
| **8 blueprint fixtures, one per archetype** | `shesha-design-comprehension/assets/blueprint-examples/*.blueprint.json` |
| Validator (12 Tier 1 + 25 Tier 2 + Tier 3) | `shesha-form-edit/scripts/validate-form.mjs` |
| Normalizer, idempotent over 100 real forms | `shesha-form-edit/scripts/normalize-form.mjs` |
| ASCII mock renderer | `shesha-design-comprehension/scripts/lib/render-mock.mjs` |

Test baseline that must not regress: hooks **33** · form-edit **218** · design-system **24** · design-comprehension **37**.

---

### Task 1: `compile-spec.mjs` — blueprint to markup

**Files:** Create `shesha-form-edit/scripts/compile-spec.mjs`, `scripts/lib/compile/*.mjs`, `tests/compile-spec.test.mjs`

**Interfaces produced:**
- `compileSpec(blueprint, {registry, roles, tokens, flows}) => {markup, report}` — `markup` is a complete Shesha form config; `report` names every node emitted, which came from the blueprint versus the flow manifest, and every default applied.
- CLI: `node scripts/compile-spec.mjs <blueprint.json> [--out <form.json>] [--json]`.

**What the compiler owns, so the model never touches it:** component `type` selection from the binding's datatype · `version` from the registry · `parentId` stamping through every slot shape · `id` minting · `propertyName` casing · the full style block per node from its `role` · field-cell wrappers with geometry on the wrapper and `width:"100%"` on the leaf · `validationErrors` presence · `buttonGroup` shape and Submit/exit wiring · `dataContext` mandatory props · vertical gap on row lists · layout style applied to the correct slot for slotted components (`card.content`, `collapsiblePanel.content`/`header`).

**THE ACCEPTANCE CRITERION — this is the whole task:**

> For all 8 blueprint fixtures, `compileSpec` output must pass `validate-form.mjs` with **zero Tier 1 and zero Tier 2 findings**, and a Tier 3 score at or above the calibrated `evalPassScore`.

If the compiler cannot produce clean output for an archetype, that is a real finding: either the compiler is incomplete, the fixture is wrong, or a check is wrong. Investigate and report which — do not weaken a check or doctor a fixture to get green.

- [ ] **Step 1: Write the failing test** — one case per archetype asserting `tier1` and `tier2` are empty on compiled output, plus:
  - compiling twice is byte-identical (deterministic)
  - `compile(bp)` then `normalize(...)` is a no-op — the compiler already emits normalized form, so the normalizer finds nothing to fix. This is the strongest possible statement that the two agree.
  - every node in the flow manifest's required set appears in the output
  - no `columns` component anywhere
  - no proportional width on any input leaf
  - a blueprint override with `source`+`evidence` survives into the markup; one without is rejected with a clear error
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement**, one emitter module per concern under `scripts/lib/compile/`.
- [ ] **Step 4: Run until green for all 8 archetypes.**
- [ ] **Step 5: Commit.**

---

### Task 2: Fix the layout probe

**Files:** Modify `shesha-design-comprehension/scripts/layout-probe.js`; create `tests/layout-probe.test.mjs`

Three defects, all already documented in `blueprint-ir.md` as outstanding:

1. **`multiColumnContainers[].childWidths` is never emitted**, though `blueprint-ir.md`, `capture-pipeline.md` and the comprehension `SKILL.md` all describe reading it. Emit it: each split child's measured width in native px, aligned index-wise with `childIds`.
2. **`colSpan24` normalises to a 24-unit grid**, which `blueprint-ir.md` explicitly forbids ("do NOT normalise to a 24-unit grid"). Remove it.
3. **`columnCount` is derived from distinct left edges**, so a vertically-stacked pair at different indents counts as two columns. Shesha containers nest an outer and inner div, which systematically indent — so this is a live false-positive source. Cluster on horizontal overlap within a row band, not on left-edge distinctness alone.

- [ ] **Step 1: Write tests** against synthetic node sets — a genuine 2-column row, a vertically-stacked indented pair (must be 1 column), a fixed rail + fill main (widths `[332, N]`), and a 6-equal-cell strip.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** The probe body runs in a browser via `browser_evaluate`, so it must stay dependency-free and self-contained; keep the pure clustering logic in a module the tests can import directly.
- [ ] **Step 4: Update the three docs** that describe the probe's output to match reality.
- [ ] **Step 5: Commit.**

---

### Task 3: The typed assertion grammar and evaluator

**Files:** Create `shesha-design-comprehension/scripts/lib/assertions.mjs`, `scripts/verify-placement.mjs`, `tests/assertions.test.mjs`

Replace English assertions (`"left ≥ 2.5× right"`, currently graded by the model that wrote them) with five typed predicates — exactly the dimensions `verification-loop.md` already tabulates:

| Predicate | Meaning |
|---|---|
| `same-cluster(a, b)` | a and b are in the same split column |
| `parent-of(a, b)` | b is a descendant of a |
| `ratio(a, b, min, max)` | a's width ÷ b's width falls in range |
| `same-rowband(a, b)` | a and b share a horizontal row band |
| `tab(a, key)` | a sits under the tab with that key |

**Interfaces produced:**
- `parseAssertion(str) => {predicate, args}` — rejects anything unparseable with a message naming the expected forms. No English fallback: an unparseable assertion is an error, because a permissive parser silently degrades to the prose it replaces.
- `evaluate(assertions, probe) => Array<{assertion, pass, actual, message}>`
- CLI `verify-placement.mjs <blueprint.json> <built.probe.json> [--design <design.probe.json>]` — exit 0 if all pass, 1 otherwise.

Assert on membership, grouping, nesting depth and tab key — **never absolute pixels**, which reflow makes brittle. `ratio` is the one quantitative predicate and it takes a range for that reason.

- [ ] **Step 1: Write tests** — each predicate passing and failing; an unparseable assertion rejected; a failure message that names both operands and the measured value; `verify-placement` exit codes.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Migrate the 8 blueprint fixtures'** assertions to the typed grammar and assert they all parse.
- [ ] **Step 5: Commit.**

---

### Task 4: Wire the compiler into the skills

**Files:** Modify `shesha-form-edit/SKILL.md`, `shesha-claude-designer/SKILL.md`, `shesha-design-comprehension/SKILL.md`; create `shesha-form-edit/references/compiling.md`

The compiler is worthless if the skills still tell the model to hand-author markup.

- `shesha-form-edit`: authoring a form from a blueprint becomes "run `compile-spec.mjs`", not "copy a seed and edit". Seeds remain for reference and for edits to existing forms. Delete the prose rules the compiler now owns — this is the second large rule deletion, and every deleted rule must be traceable to an emitter or a check.
- `shesha-claude-designer`: gate 5a.5 becomes "run `verify-placement.mjs`", with its exit code as the gate rather than a model judgement.
- `shesha-design-comprehension`: the blueprint's `assertions` block uses the typed grammar.

- [ ] **Step 1** Write `references/compiling.md` — the blueprint→markup contract, what the compiler owns, and the one-command path.
- [ ] **Step 2** Rewire the three SKILL.md files. Keep each under 500 lines.
- [ ] **Step 3** Grep for surviving instructions to hand-author markup or hand-grade placement; fix or list them.
- [ ] **Step 4** Commit.

---

### Task 5: Prove it end to end

**Files:** Create `shesha-form-edit/tests/e2e-compile.test.mjs`; update `docs/corpus-report.md`

- [ ] **Step 1** For each of the 8 archetypes: compile → validate → assert zero Tier 1/2 and Tier 3 ≥ threshold → render the ASCII mock → confirm the mock matches the compiled tree (the mock is generated from the same resolved tree, so a mismatch means one of them drifted).
- [ ] **Step 2** Compile a blueprint derived from one of the two real failed forms (`flight-details`) and assert the compiler does **not** reproduce any of the six forensic defects: no split width on a leaf, layout style on the correct slot, a vertical gap on the row list, mustache-bound title, no duplicate caption, no horizontal `labelCol` with narrow rows. **This is the regression test for the actual failure that motivated the phase.**
- [ ] **Step 3** Record in `corpus-report.md` how compiled output scores versus the 935-form corpus baseline.
- [ ] **Step 4** Commit.

---

## Phase gate

- [ ] All 8 archetypes compile to **zero Tier 1/2 findings**.
- [ ] `compile` then `normalize` is a no-op for all 8 — compiler and normalizer agree.
- [ ] Compilation is deterministic and byte-identical across runs.
- [ ] The probe emits `childWidths`; `colSpan24` is gone; stacked indented pairs no longer count as columns.
- [ ] All 8 fixtures' assertions parse under the typed grammar; `verify-placement.mjs` returns real exit codes.
- [ ] The `flight-details` regression test proves none of the six forensic defects reproduce.
- [ ] Four suites green, totals at or above 33 / 218 / 24 / 37.
- [ ] No corpus data in the repo; framework repo clean.

## What this phase does NOT do

- It does not build a general markup editor. Editing an existing live form stays with `shesha-form-edit`'s round-trip path; the compiler owns **authoring**.
- It does not retire the seeds. They remain reference material and the basis for edits.
- It does not widen the push gate. That needs `T1-PROP-UNKNOWN` resolved, which needs registry work outside this phase.
