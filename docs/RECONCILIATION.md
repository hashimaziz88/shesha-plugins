# Reconciliation plan — two designer pipelines in one plugin

**State:** `plugins-rework` @ `09d4faa`. Merge of `81bc675` (**P1** — registry/compiler/validator/evals) and `fda1e44` (**P2** — `claude-designer-stripped`), base `017b6ab`.
**Written:** 2026-07-30, from three independent audits of the merged tree.

The merge kept both of everything. Tests pass — 474 from P1, 10 from P2 — but nothing is reconciled. P1 touched 221 files, P2 touched 338, and **only 33 were touched by both**, so most of the collision is *silent*: two implementations sitting side by side that never conflicted textually and now both answer the same question differently.

## Contents
- [The one decision that unlocks the rest](#the-one-decision-that-unlocks-the-rest)
- [Recommended position](#recommended-position)
- [P0 — actively produces wrong output today](#p0--actively-produces-wrong-output-today)
- [P1 — sends work down the wrong path](#p1--sends-work-down-the-wrong-path)
- [P2 — misleads, wastes budget, or rots](#p2--misleads-wastes-budget-or-rots)
- [Experiments — where the evidence runs out](#experiments--where-the-evidence-runs-out)
- [What must NOT be cleaned up](#what-must-not-be-cleaned-up)
- [Guard tests to add](#guard-tests-to-add)

---

## The one decision that unlocks the rest

**Which blueprint format and compiler is authoritative.** Six other collisions are bound to it and cannot be settled independently:

| Bound collision | Why it follows |
|---|---|
| Which `blueprint.schema.json` (there are two, with **mutually exclusive `required` sets**, cited by 13 locations) | A document valid against one is invalid against the other |
| Archetype vocabulary (8 vs 11, three false friends) | Each vocabulary belongs to one compiler's manifests/corpus |
| Seed corpus — `assets/golden/` vs `assets/exemplars/` | `shesha-claude-designer/README.md:60` assigns one to each toolchain |
| Component-type authority — `registry-0.45.1.json` vs `components-kb/` | Each compiler reads a different table |
| Conductor contract — `handoff-contract.md` vs `conducting.md` | They name different compilers for "Contract A" |
| `form-author` agent's future | Its contract names a seed directory that no longer holds whole forms |

## Recommended position

Not a winner-takes-all. The two sides are strong in different places, and the evidence says so plainly.

**1. Blueprint format + compiler: P1's, as the single entry point.**

Decisive: **P2→P1 converts; P1→P2 does not.** P2's format cannot represent `role`, `overrides[]` provenance, tablet/mobile breakpoints, slotted components (`card.content`), authored `buttonGroup.items[]`, or wizard steps — and its nodes carry no stable `componentName`, so there is no handle a placement assertion could reference. P2's assertions are English prose with no evaluator anywhere in the repo. Choosing P2 means abandoning the placement gate, the one artifact built to stop the drift this project exists to prevent. P2 also cannot express a `Start Edit`/`Cancel Edit` lifecycle at all, so it literally cannot build P1's `record-detail`.

Against that, P2's compiler has **zero test coverage** (its one test file covers the gym classifier) and is **online-only** — `--no-live` degrades every field to `textField`.

**2. Validators: merge, with P1 as the chassis.**

Overlap is **31% of P1, 57% of P2** — 18 P2 predicates have no P1 counterpart, 31 P1 checks have no P2 counterpart. Discarding either loses real coverage. P1 is the chassis because it alone has machine-readable `--json`, a policy layer that re-triages a code as data with a measured corpus rate, and an idempotent repairer that runs *before* validation. P2 has no repair path and 0 tests over its three form validators; **9 of its `severity:"fail"` rules are documented but never executed.**

Highest-value ports from P2: **`R-015`** (reference-list identity against live metadata — P1 has no metadata-aware check, and a wrong reflist renders an empty dropdown) and **`validate-styledness`'s coverage triad**, the only mechanical defence against shipping a structurally-valid grey form. It fails `record-detail-simple.json` at 17% coverage where P1's Tier 3 scores the same form **100/100**.

**3. Ground truth: keep both, with a stated division of labour.**

- `registry-0.45.1.json` — sole authority on *does this prop exist, at what version*. It executes the framework (jsdom + real `settingsFormMarkup` + full migrator replay), yields **5,681 prop paths** to the KB's 1,880, and regenerates in ~60s with no backend.
- The gym / `measured-capability-matrix.json` — sole authority on *does this channel actually render*. No static source can answer that.
- `capability-matrix.json` (hand) keeps only what the gym cannot express. **Delete its `versions` block** — it says `validationErrors: 1` where both generated sources say `0`, so anything built from it earns `T1-VERSION-STALE` on a mandatory component.

**4. The single highest-value one-line change:** point `generate-component-gym.js:30` at the registry instead of `components-kb/_index.json`. The KB is regex-parsed and missing `border.*` on 46 types and `font.*` on 47, so **the gym never asks about `container.font`, `card.border`, `card.radius` or ~3,800 other paths** — and the hand matrix's unverified `container:font` no-op claim currently gates 5 of 10 blocks.

---

## P0 — actively produces wrong output today

| # | Finding | Fix | Needs a decision? |
|---|---|---|---|
| 1 | **`expand-style.mjs:104` — `widthByBp[bp] ?? 'auto'`.** P1's `wrapFlexChild()` and compiler both call it, so every wrapper synthesised for a width-less leaf gets `dimensions.width:"auto"`. `T2-STYLE-INCOMPLETE` only checks the key is *present*, so `"auto"` satisfies it. **P1 manufactures the reported layout defect and then certifies it clean.** `checkWidthOnNonContainer` also early-returns on containers, so the wrapper is never width-checked | Depends on the flexGrow experiment | **Experiment first** |
| 2 | **Two `blueprint.schema.json` with mutually exclusive `required` sets**, cited interchangeably by 13 locations | One wins; other becomes a `$ref` stub or is deleted with all citations repointed | **Yes — the gating decision** |
| 3 | **`agents/form-author.md:35`** requires an `assets/examples/*.json` whole-form seed. P2 pruned that directory to 2 *fragments*. The agent cannot succeed as contracted | Retire (its own `:19-26` argues for it) or repoint at `golden/`+`exemplars/` | Yes |
| 4 | **`agents/form-auditor.md:50`** grades a form **fail** for lacking flat `fontSize`/`fontWeight` — a rule `evals/README.md:14` records as proven false; real paths are `desktop.font.size`. **It fails correctly-authored forms** | Change to the nested path | No — mechanical |
| 5 | **`uniqueStateId`** required at `SKILL.md:296`, `component-cheatsheet.md:52`, `components/child-tables.md:48`, `examples.md:84`; **forbidden** at `examples.md:142` ("framework-verified absent") — a contradiction inside one file | Retract the four requirements | No — evals settled it |
| 6 | **`SKILL.md:361`** — "Copy `assets/examples/standalone-create.json` whole". File moved to `golden/capture-standalone--standalone-create.json` | Repoint | No |
| 7 | **Four seed-priority orders**, and neither of `SKILL.md`'s two reaches `assets/golden/` — the corpus that actually holds the whole-form seeds. One tier (`assets/patterns/`) does not exist | Collapse to one; delete the fictional tier | Order: **yes**. Dangling tier: no |
| 8 | **`scripts/gym-lib/classify.js` has zero executed coverage** — it decides every entry in the 586 KB measured matrix. `tests/classify.test.js` is excluded by the `*.test.mjs` glob and is **not** a duplicate of `classify.test.mjs` (different module) | Rename to `classify-gym.test.mjs`. Do **not** switch to bare `node --test tests/` before renaming `extract.test.ts`, which Node 25 would then discover and fail on | No — in that order |

## P1 — sends work down the wrong path

| # | Finding | Needs a decision? |
|---|---|---|
| 9 | **`shesha-forms` (MCP) now competes with `shesha-form-edit` and the orchestrator with no tie-break.** Its description is a superset of both; P2 deleted form-edit's explicit "always prefer this skill over the Shesha MCP" clause, while `SKILL.md:225` still uses the MCP as seed tier 5. **Highest-probability wrong-skill selection in the plugin** | Yes |
| 10 | **`shesha-form-edit/SKILL.md` contains two complete step schemes** (`0 · Route`…`7 · Report`, then `Step 6 — Validate`…`Step 10`) with no transition. "Step 6" means two different things and is cited 6×; **"Step 4.5" is cited as a blocking gate 3× and does not exist**; "Step 0" is cited as producing a design plan it does not | Which scheme: yes |
| 11 | **`"add a sector dropdown"` is claimed verbatim by both the orchestrator and its own sub-skill.** The guard test cannot see it | Owner: yes |
| 12 | **`shesha-claude-designer/SKILL.md:75-76` asserts three false facts** — that `/shesha-build`, `/shesha-audit`, `/shesha-gym` "each enter this pipeline at the right step". None does | Yes |
| 13 | **`/shesha-gym` command duplicates the `shesha-gym` skill** with a shorter step list (the command omits the skill's green-tests requirement) | No — make the command invoke the skill |
| 14 | **13 byte-identical skill descriptions between `shesha-developer` and `shesha-developer-0-43`**, none mentioning 0.43. With both installed, `domain-model` for a 0.45 project is a coin-flip | No — prefix the -0-43 descriptions |
| 15 | **`skills/shesha-gym/SKILL.md:15-19`** — every path in its artifact table is unqualified and actually lives in `shesha-form-edit/`. That skill folder contains only `SKILL.md` | No |
| 16 | **Styling has four positions**: baked-in at compile (`SKILL.md:130,136`), mandatory separate pass (frontmatter, `quality-gates.md:24`), ask-first optional (`SKILL.md:329`). And "placement checked *before* styling" is impossible if style is a compile-time input | Yes |
| 17 | **Publish step missing** from form-edit Steps 7–10 while four other docs require it before the placement probe. A gate run on an unpublished form measures nothing | No |
| 18 | **`form-author` remit contradicted** by `conducting.md:25,56` and `SKILL.md:215`, which dispatch it exactly where its own text forbids | Yes |
| 19 | **`shesha-form-designer` agent vs the orchestrator's inline route** — the skill says "comprehension inline, no dispatch"; the agent exists to be dispatched for the same task shape. It also **omits the mandatory design-critic gate** | Yes |

## P2 — misleads, wastes budget, or rots

19 further items, all mechanical unless noted: duplicated steps 2/3/4 in `shesha-design-system/SKILL.md:53-55` · `README.md` claiming four skills (six exist), two conflicting capability-matrix authorities, and "being built" for two artifacts that exist · `form-shape.md:103` vs `:113` on registry-vs-KB authority (**decision**) · `gate-policy.json:3` and `grade-corpus.mjs:48,234` citing the nonexistent `assets/patterns/`, making the gate's calibration cohort unreconstructible (**decision** on whether to re-derive) · `render-verdicts/` — 3 committed artifacts with foreign absolute paths and missing PNGs · two `gym/forms/` files outside the manifest · `skills/add-public-portal/` folder ≠ its `name: shesha-public-portal`, violating `CLAUDE.md` · `T1-ID-NOT-UUID` cited live though renamed `T1-ID-EMPTY` · 9 dangling links in repo-root `docs/` · two conductor-contract docs (**decision**) · `slim-seed.js` undocumented, `evals/` invoked by nothing (**decision**).

Full detail with file:line for every item is in the three audit reports under `.superpowers/sdd/2026-07-29-phase5-debt-paydown/`.

---

## Experiments — where the evidence runs out

Three findings cannot be settled by reading code. **None of the three reported runtime defects is caught by any static validator on either side**; one is caught only by a live browser oracle.

1. **Is `flexGrow` an authorable 0.45 channel at all?** It appears **nowhere** in either ground truth, and the live-probed golden corpus never uses it. Add `container` variants `width:auto` / `flexGrow:1` / `flex:1 1 0` to `gym-lib/scaffolds.js`, re-run the gym, read the measured effect. Then add a **row fill-ratio metric** to `render-instrument.js` (`sum(child.width)+gaps` vs `inner.width`) — that single metric turns P0#1 from invisible to fail-closed.
2. **Does the gym test *absent* props?** No — its scaffolds inject `initModel` defaults, so a missing default is never exercised. 449 text nodes across 118 gym forms, **zero** without `textType`. Add a `default-omitted` variant class. This also invalidates a positive claim: the gym's `text: font.size → changes-geometry` result holds *only because* the scaffold supplied `textType`, a precondition recorded nowhere.
3. **Is `customVisibility` live or ignored?** P1 treats it as a live field *and* syntax-checks its JavaScript; P2 forbids it as "IGNORED on 0.45" but cites nothing. Push one form with it and one with code-mode `hidden`; run the render instrument on both.

`isInline` needs no experiment — `render-instrument.js:198` already catches it. It needs **promotion** to a mandatory pass, since it is currently the only mechanism in either pipeline that caught any of the three defects.

## What must NOT be cleaned up

- **`assets/exemplars/` and `assets/golden/` are not redundant.** `README.md:60` assigns one to each toolchain; resolve them *with* the compiler decision, not before it.
- **The two capability matrices are correctly layered** — hand annotations overlaid onto measured data by `merge-capability.js:20-21`. Only `README.md:84` needs fixing, not the data. Note the overlay is currently **inert**: 0 verdict overlays, 0 contradictions flagged, because a `strong ≥ 2` gate suppresses the one real disagreement it found.
- **`scripts/harness/extract.test.ts` is correctly never run in place** — it is codegen, matched only after `gen-registry.mjs` copies it into a framework checkout.

## Guard tests to add

Every failure class this audit found was invisible to CI. Mirroring `tests/no-groups-index.test.mjs`:

- no reference anywhere to `assets/patterns/` or to a retired `assets/examples/` seed filename
- exactly one `blueprint.schema.json` in the plugin
- every path in `commands/*.md` resolves from the citing file
- folder name == frontmatter `name`, for every skill
- **widen `skill-descriptions.test.mjs`**: glob `skills/*/SKILL.md` rather than a fixed list of four; include `agents/` and `commands/`; derive reserved phrases from the orchestrator's own quoted examples instead of hard-coding six design-matching strings; assert no command contradicts the orchestrator's claim about it
- registry ↔ components-kb parity on type set and versions — its absence is what let `dataContext` (null vs 8) and `permissionTagGroup` (2 vs null) drift, from generations **8 days apart**
