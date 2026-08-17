# Shesha AI Tooling — Critique, Target Architecture, Roadmap

**Author:** prepared for Hashim Muhammed, Boxfusion · **Date:** 2026-08-17
**Baseline audited:** `hashimaziz88/shesha-plugins` @ `claude/team-standup-4e3e21` (PR #39, v1.8.4) · Shesha 0.45.x
**Constraints honoured:** model-agnostic · no changes to `shesha-framework` · PR #39 is the base to work forward from
**Reference artifact:** `boxfusion.test/bookings-table` revision 2 (hand-polished production form)

---

## 0. The verdict in one page

The pipeline has not plateaued because the models are not good enough. It has plateaued because **the pipeline asks a language model to be a compiler, and asks prose to be a type system.** Both are category errors, and both are now measurable.

Three measurements settle it.

**One — the artifact is 96% mechanical.** Your `bookings-table` form is 19,170 bytes of markup carrying roughly **768 bytes of actual design decisions** — a **25× expansion**. 43.9% of the markup is `desktop`/`tablet`/`mobile` triplication, and across the 11 components that carry breakpoint blocks there are exactly **five** real differences (two of which are defects, see §1.1). Every model token spent emitting that expansion is a token spent on work a 200-line function does perfectly, and each one is an independent opportunity to be wrong.

**Two — the instruction surface is past the measured point where models stop obeying.** A single form build, following what `shesha-form-edit/SKILL.md` mandates, requires **110–150K tokens**, of which ~75K is instruction and index text loaded *before the first component is written*. A full three-screen brief through the documented pipeline costs **370K–1,050K tokens** — two to five full context windows. Independently, IFScale (ICLR-accepted, 2025) measures instruction adherence collapsing from 100% to 52.7% for Claude-class models between 10 and 500 simultaneous instructions, with frontier models already struggling above **~100**. Anthropic's own skill guidance caps `SKILL.md` at **500 lines**; yours is 378 lines but 47KB, with 32 reference files totalling 276KB behind it, referenced more than one level deep — the exact nesting Anthropic warns silently truncates under partial reads. SkillReducer (2026) found that compressing skills by 39–48% *improved* functional quality by 2.8%.

**Three — the gates that were supposed to catch this do not fire.** I ran them. `validate-blocks.js`: **0 failures, 136 warnings, exit 0** — it passes everything, including a block I built containing the banned `columns` component, two literal hexes and flex-without-display (three docs claim it fails exactly that). `summarize.js` **cannot execute at all** — CommonJS `require` in a package declaring `"type": "module"`; every invocation dies at line 15, and it is invoked from `SKILL.md:297`. `bake-overlays.mjs --apply` **writes files despite unresolved `$role` tokens** — I broke one and it wrote the literal string `$role:doesNotExist` into a block as a colour value, then exited 1. `verify-artifact.mjs` — the one genuinely good program in the repo, 15 passing tests — has **no zero-coverage rule**, so a form whose `formId` is `""`, `null`, or absent reports `walked 0, checked 0, verdict: pass, exit 0`. That is verbatim the "0 bindings, 0 reflists, 0 endpoints checked" false-green that the script's own header says it exists to prevent.

And the deepest problem: **your golden reference is not clean.** The hand-authored, human-reviewed `bookings-table` revision 2 contains a stray `label: "Card1"` with no `hideLabel`, a border that is `none` on desktop but `solid` on tablet, mobile and base, `className: "sha-page"` present on desktop only, a page-shell card pinned to `height: 30px` at every breakpoint, `text` components carrying both legacy (`fontSize`/`fontWeight`) and v7 (`desktop.font`) styling channels, row-click wired three redundant ways, and a `dataSubmitterType: "gql"` submit pipeline with an `onBeforeDataLoad` hook on a **list** form that never submits. So "match the golden example" cannot be the target. There is no clean example to match.

### The recommendation

**Build a compiler. Keep the corpus. Demote the prose. Rebuild the verifier ladder. Make the harness the product.**

Concretely: introduce a small typed intermediate representation (call it **SFS — Shesha Form Spec**) that a model authors, and a deterministic compiler that expands SFS into Shesha markup — stamping ids, versions, `parentId`, breakpoint blocks, default props, escaping and envelope, all by construction. The model's job shrinks from *emit 19,170 correct bytes* to *emit 768 bytes of intent*. Prose skills shrink from 47KB of procedure to a thin router plus the compiler's error vocabulary. Verification moves from model-judged prose to a five-tier ladder where the bottom four tiers are programs.

This is not a speculative architecture. It is (a) Anthropic's own documented "plan → validate-with-a-script → execute → verify" pattern and their three-agent harness design; (b) the BMW Financial Services industrial result where 7B models hit **1.000 structural fidelity and 100% valid JSON** on a real DSL-to-code task; (c) the direct consequence of JSONSchemaBench's finding that constrained decoding coverage collapses on deeply-nested schemas (XGrammar: **7%** on Kubernetes-shaped schemas; Guidance: 96% → **41%** across GitHub Easy→Hard) — your markup is Kubernetes-shaped.

Nothing valuable gets thrown away. The `components-kb`, the capability matrix, the block library, the retrospectives and the SAA harness are the **assets that make the compiler possible** — they are just currently addressed to the wrong reader. They are written for a model to read. They should be written for a program to execute, and a model to consult only when the program cannot decide.

**What I would *not* do:** keep iterating prose. Every retrospective cycle so far has added instruction mass to a system already past its adherence ceiling. That is why the same defects recur — `footerButtons: "default"`, the `columns` ban, the reflist name format — despite each being documented, sometimes in five places.

---

## 1. Evidence

### 1.1 The artifact: what a Shesha form actually is

I decomposed `bookings-table` revision 2 mechanically.

| Measure | Value |
|---|---|
| Components | 12 (max depth 5) |
| Markup, compact JSON | 19,170 bytes |
| Markup as pretty JSON | 44,326 bytes |
| Semantic content (design decisions a spec must state) | **~768 bytes** |
| Expansion ratio | **~25×** |
| `desktop` + `tablet` + `mobile` blocks | 8,422 bytes = **43.9% of markup** |
| Components where `desktop` ≡ `tablet` byte-identical | 6 of 11 |
| Real desktop-vs-tablet differences, whole form | **5 leaf values** |

The five differences:

```
card1               border.border.all.style   ("none" desktop vs "solid" tablet)   ← DEFECT
card1               className                 ("sha-page" desktop, absent tablet)  ← DEFECT
searchCell          dimensions.width          calc(100% - 196px) → 100%            ← real
bookingsQuickSearch dimensions.width          100% → (unset)                       ← incidental
addCell             dimensions.width          180px → 100%                         ← real
bookingsTable       dimensions.maxWidth/minWidth (unset → none/0px)                ← incidental
```

So the entire responsive intent of this screen is: **"the toolbar's search cell fills, the action cell is 180px, and below tablet the toolbar stacks."** One sentence. It costs 8,422 bytes, and hand-expanding it introduced two defects.

**The eight defects in the golden reference**, all invisible to every gate in the pipeline:

1. `label: "Card1"`, `labelAlign: "right"`, `hideLabel` unset — leftover designer default on the page-shell card.
2. `border.all.style`: base `solid`, desktop `none`, tablet `solid`, mobile `solid` — three-way inconsistency.
3. `className: "sha-page"` on `desktop` only; absent from `tablet`/`mobile`.
4. `dimensions.height: "30px"` on the card that wraps the entire page, at all three breakpoints.
5. `pageTitle`/`pageSubtitle` carry legacy `fontSize: "text-2xl"` + `fontWeight: "600"` **and** v7 `desktop.font.size: 24` / `weight: "600"` — two competing styling channels for the same property.
6. `stylingBox` duplicated as an escaped JSON string at base level *and* inside each of the three breakpoint blocks.
7. Row navigation wired three ways: code-mode `onRowClick` returning `{actionName:'Navigate'}`, plus `rowClickActionConfiguration`, plus a byte-identical `dblClickActionConfiguration`.
8. `formSettings` carries `dataSubmitterType: "gql"`, `dataSubmittersSettings.gql.dynamicEndpoint` (create-vs-update logic) and `onBeforeDataLoad: "form.setFieldsValue({...form.formArguments})"` — a **create/edit form's** submit and argument plumbing, on a read-only list.

Every one of these is a *normalisation* problem — a canonicaliser removes all eight by construction. None of them is a reasoning problem. This is the single strongest argument in the document: if a careful human on revision two produces eight of these, no volume of instruction will stop an unsupervised model producing more.

**What the compiler must therefore own** (derived from the same decomposition):

| Contract | Detail |
|---|---|
| Envelope | 23 top-level fields; `Markup` is a **JSON string** containing `{components, formSettings}`; `Id` ≡ `OriginId`; `Access` mirrored in `formSettings.access` |
| Identity | opaque unique `id` per node; `parentId` = direct parent's `id`; root children `"root"` |
| Versioning | integer `version` per component type — 12 components here span `card:3, container:7, text:5, dataContext:8, datatable.quickSearch:3, buttonGroup:15, datatable:29, datatable.pager:4` |
| Slots | `card` children live in `content.components` (and `header.components`), **not** `components` — the single most-cited crash in the corpus |
| Data wrapper | `datatable`/`datalist` require a `dataContext` ancestor carrying `entityType`, `sourceType`, `dataFetchingMode`, `defaultPageSize` |
| Layout | splits are flex `container` rows sized by `desktop.dimensions.width` (`calc(100% - 196px)`, `180px`); `customStyle:{flex}` is inert |
| Columns | `items[]` with `columnType`, `propertyName` (camelCase), `caption`, `sortOrder`, `minWidth`/`width`, and `displayComponent`/`editComponent`/`createComponent` as `{type, settings:{…version}}` |
| Actions | `buttonGroup.items[].actionConfiguration` with `{_type, actionName, actionOwner, actionArguments, onSuccess}`; `actionOwner` case-sensitive lowercase; names spaced (`"Show Dialog"`, `"Refresh table"`) |
| References | `formId: {name, module}`; `referenceListId: {module, name}` |
| Templating | mustache `{{selectedRow.id}}`; code-mode props are objects `{_mode:"code", _code:"…"}` |
| Styling | v7 channels per breakpoint: `font`, `background`, `border`, `shadow`, `dimensions`, `stylingBox` (escaped JSON string) |

That table is a **schema**. It is currently distributed across 32 markdown files as prose. That is the whole problem, and the whole opportunity.

### 1.2 The skill layer: mass, contradiction, drift

Measured shape of the four designer skills:

| Skill | `SKILL.md` | refs | assets |
|---|---|---|---|
| `shesha-form-edit` | 46,926 B / 378 lines | 32 files, 276 KB | `components-kb` 125 files ~920 KB (121 components) · `blocks` 11 files 152 KB · `examples` 12 files **2.5 MB** (largest single: 730 KB) |
| `shesha-claude-designer` | 16,462 B | 2 files, 8.8 KB | — |
| `shesha-design-comprehension` | 9,849 B | 3 files, 23 KB | `layout-probe.js` 10 KB |
| `shesha-design-system` | 7,508 B | 8 files, 55 KB | `capability-matrix.json` (36 rows) · 2 theme files · 10 overlays |

Composition of `shesha-form-edit/SKILL.md`: ~20 KB executable procedure, ~10 KB lookup tables, ~13 KB warnings, and **~4 KB of pure changelog archaeology** — prose whose only function is to explain a defect that was already fixed ("this line used to say…", "four rows used to cite plugins that don't exist"). Twelve more such passages across the references. This is a codebase where the *commit history has leaked into the runtime prompt*.

**Contradictions found (a sample of 13 identified, all verified against the shipped assets):**

| # | Subject | The conflict |
|---|---|---|
1 | `referenceListId.name` | **Three-way.** `form-quality.md:61` bare name; `by-datatype.md:35` + `dropdowns.md:16` + `add-dialogs.md:110` fully-qualified `Module.List`. Assets split 2-vs-4. `form-quality.md:225` and `rs-detail-with-header.json` disagree **about the same reference list in the same project**. Documented failure: `ConfigurationLoadingError` blocking the whole form.
2 | `refListStatus` shape | `SKILL.md:165` declares the KB settled it (`referenceListId` object, no flat keys) — and `dropdowns.md:112-124`, the file the topic table routes to, still ships `module` + `referenceListName` flat keys **with an explicit warning not to correct it**. Verified: neither key exists in `refListStatus.json` `ownProps`.
3 | `referenceListName` on `dropdown` | `by-datatype.md:15` mandates it ("Always replace"); it is absent from the groups index, so `SKILL.md:155` guarantees `clean-form-config` strips it at Step 6, and `SKILL.md:226` forbids treating that as a false positive.
4 | `columns` component | Banned in 5 places (`SKILL.md:320`, `containers.md:102`, matrix docs…) and **mandated** at `form-quality.md:160` ("one `columns`/`sectionSeparator` only when >5 inputs"), 52 lines before the same file's checklist bans it. Present in 7 of the seeds the skill tells you to copy.
5 | Block styling | `block-library.md:7` "**Blocks now ship pre-styled — there is no separate overlay pass… Do not apply the overlay again**" vs `SKILL.md:136` "**Styling is applied by `shesha-design-system` from the paired overlay, not here**" vs conductor `SKILL.md:104` "**(b) Styling — REQUIRED SUB-SKILL… not optional**". Worth 35–55K tokens/screen depending on which file was read last.
6 | Seed-first vs block-first | `SKILL.md:22` "start from the canonical seeds… don't hand-author" vs `SKILL.md:136` "compose, don't copy-a-seed… prefer it" vs `block-library.md:70` "**never** copy a 25K-line seed".
7 | `editMode` on create/edit | `edit-mode.md:12` `"editable"` ("proven canon across 33 production forms") vs `SKILL.md:264` "**Don't 'fix' by forcing `editable`**" vs `by-datatype.md` hardcoding `"inherited"` in all nine rows.
8 | `formArguments` hook | `onDataLoaded` (`add-dialogs.md:38`, "NOT `onBeforeDataLoad`") vs `onAfterDataLoad` (`debug.md:49`, "`onDataLoaded` never fires on a modal") vs `data-tables.md:207`. Your own reference form uses `onBeforeDataLoad`.
9 | `actionOwner` casing | `actions.md:83` ships `"Shesha.Common"` / `"ExecuteScript"` — the exact strings `debug.md:21` lists as the cause of "button click fires nothing, no console, no network".
10 | `Metadata` endpoint | `SKILL.md:86` `GetProperties` → direct array; `api.md:264` `Get` → `result.properties[]`. And `api.md:296` shows camelCase `path` while `form-quality.md:50` says PascalCase (→ every cell renders blank).
11 | `collapsiblePanel` | `containers.md:176` gives `version: 8`, `accent`, `isDefaultExpanded`; reality is `9`, `accentStyle`, `collapsedByDefault` — **with inverted polarity**. `check-references.mjs` misses it because its regex needs `type` and `version` adjacent; the gate prints `versions walked 26 checked 26 failures 0 · PASS`.
12 | Table-vs-list ambiguity | `data-tables.md:20` "**ask the user: table or list?** Don't silently pick one" vs `SKILL.md:30` "**never call `AskUserQuestion`**" in headless mode. In the ambiguous case the unsupervised agent has no legal action.
13 | Hexes in blocks | `README.md:132` "**A hex in a block subtree is a bug**" vs `block-library.md:39` "literal hexes… that is the **recorded trade**, not a defect". Measured: **48 literal hexes vs 10 `$role:` references** across the overlays; all 11 blocks contain 0 `$role:` tokens and 2–6 hexes each.

**The brand-genericity claim is false as shipped.** `README.md:70` — "To theme a brand-new app you write zero code: copy the token file, edit the values, point the designer at it." In fact `bake-overlays.mjs` resolves `$role:` tokens at **build time**, writing literals into `shesha-form-edit/assets/blocks/*.block.json` in the plugin source tree. Six distinct hexes account for 48 of 58 colour sites, and each is exactly a default-brand token value that already has a role defined (`#E8EAF0` = `lines.border` ×14, `#9BA3B8` = `ink.soft` ×13, `#ffffff` = `surfaces.surface` ×8…). I baked under the LandBank-green `requirements-studio.tokens.json`: every white, hairline and muted grey stayed at the Shesha value. **Swapping the token file changes 10 of 58 colour sites**, and two apps on different brands cannot share an installed plugin.

### 1.3 The blueprint / verification layer: measurement without a comparator

The "measured blueprint" is a hand-written markdown document. Placement assertions are **numbered English sentences**:

```
A1  body is a 2-column split; left:right width ratio ≈ 18:6 (left ≥ 2.5× right); right rail ≈ 332px fixed
A2  the related panels (Realises Use Cases, Required End-points) are BOTH in the RIGHT column …
```

`verification-loop.md` specifies the check as a five-row prose table and explicitly forbids exactness ("**Never** assert absolute pixels"; fail only on "wrong cluster / wrong parent / wrong tab / ratio out of range"). **No diff program exists.** Repo-wide, the string `layout-tree` appears in exactly one non-markdown file — a comment. So the gate is: a model reads a geometry JSON and a prose document and decides.

And it cannot decide two of its own five dimensions:

- **Tab assignment** — the probe has no `tabKey` field, and an inactive antd tab panel is `display:none`, filtered out by the probe's visibility test. Unmeasurable for any non-active tab. `tabs` and `collapsiblePanel` also have **zero rows** in the capability matrix.
- **Split ratio with tolerance** — `getComputedStyle().gridTemplateColumns` resolves to pixels, so `minmax(0,1fr) 332px` (called "the gold signal") is seen as `962px 332px`. The `1fr`-vs-fixed distinction the blueprint grammar requires is not recoverable.

Also: the probe captures **no appearance at all** — no colour, font, background, border, radius, shadow, gap or padding — yet the `design-critic` agent is instructed to read it for "exact gaps, widths… It is measurement; prefer it over your eye." `rowBand` is `round(y/14)` quantisation on *viewport-absolute* y, so two controls on one visual row land in different bands whenever they straddle a 14px boundary, and unrelated containers at the same absolute y always share a band. Node identity is a **truncated 80-char text label**; `data-sha-c-name` (the only handle back to a form component) is not captured. And the payload is 313 bytes/node — a real detail page yields 800–2,500 nodes, i.e. **63–195K tokens if read whole**.

The blueprint document itself contradicts its own rules: it bans the 24-unit grid at line 71 and then uses `ratio ≈ 18:6` in the canonical assertion at line 144, which is a 24-grid expression. Tier D is required by the skill and **absent from the template** a model copies.

### 1.4 The gates: what actually runs

I executed all six scripts on the checked-out tree (Node 22).

| Script | Reality |
|---|---|
`verify-artifact.mjs` (511 L, 15 passing tests) | **The one good program.** Three families with walked/checked/failures/uninspectable accounting; correctly routes offline/401/code-mode/bare-GUID to `partial` (exit 3) and prints "A partial verdict is NOT a pass". **But:** no zero-coverage rule in `verdictOf`; a `formId` that is `""`/`null`/absent is never walked → `pass`, exit 0. And its component walker only reads arrays under the literal key `components`, so nodes under `items` (buttonGroup) or `columns` (datatable) are invisible — I fed it three broken nodes there and got `structure walked 3, checked 6, failures 0`. It claimed coverage of territory it never visited.
`check-references.mjs` (408 L) | 8 families, 633 pointers, PASS in ~1s. Implements the only real zero-coverage rule in the repo (`walked > 0 && checked === 0`). **But** families are created lazily, so a family whose regex stops matching **vanishes from the report** and cannot fail — I reworded two files and 9 agent-dispatch pointers went from `checked 9` to unmentioned, still `PASS`. Coverage arithmetic doesn't reconcile (`skills` 40 walked / 29 checked / 11 unaccounted; `roles` 7 walked / 14 checked — a unit mismatch). Crashes with an uncaught `SyntaxError` and no verdict on a malformed data JSON, indistinguishable by exit code from real failures.
`validate-blocks.js` (323 L) | **0 hard failures, 136 warnings, exit 0.** Three docs claim it fails a block containing `columns`; the code warns. I built a maximally-bad block (banned `columns`, 2 hexes, flex-without-display, no `$validatedAgainst`) → `PASS, 0 fails, 5 warns, exit 0`. Its matcher is fuzzy free-text with two escape hatches downgrading failures to warnings. **It is not wired into anything** — no CI, no hook, not invoked by the documented pipeline. Its own output shows it reading Shesha style descriptors (`{type:'color'}`, `{type:'Segoe UI'}`) as if they were components.
`bake-overlays.mjs` (220 L) | Header: "Refuses to write anything unless every assertion holds." **It doesn't.** Structural failures `continue` before the write; `roleFailures` are inspected *after* the write loop. I broke one `$role` and it wrote `"$role:doesNotExist"` into a block as a colour, then exited 1. Also `page-shell.block.json` has **no paired overlay at all** and bake treats the absence as a non-error (`page-shell   skip — no overlay file`, verified), so the page shell of every screen ships unstyled by construction with nothing failing. Identical to a defect `block-library.md` records as already found and fixed for `page-header-band`.
`summarize.js` (221 L) | **Cannot execute.** `require` in a `"type": "module"` package → `ReferenceError` at line 15 on every input. Invoked from `SKILL.md:297` and `api.md:307`. Its sibling documents the exact fix. And had it run, it validates nothing (zero matches for `fail|invalid|assert|mismatch`).
`layout-probe.js` (10 KB) | Asserts nothing by design — a measurement instrument. Needs a browser. Deliberately clock-free (good).

**No shared model of a Shesha form exists.** Five mutually inconsistent tree walkers across the six scripts (key-gated; generic; a six-location whitelist; type-blind; `componentName`-keyed), and three disagreeing envelope-unwrappers. Repo-wide grep for `$schema` / `json-schema` / `ajv`: **one hit**, a self-declared version label with no validator. `clean-form-config` — the MUST-strength every-push gate — **ships no scripts at all**, only JSON for a model to read.

What is *never* checked, on any form: binding names against entity metadata · component `type` existence · component `version` correctness · reference-list resolution · action wiring (`actionName`/`actionOwner`/`onSuccess` targets) · embedded script syntax · `formSettings` semantics · layout/placement at the JSON level · appearance channels · and all semantic wrongness (wrong column set, missing required field, wrong tab grouping, duplicate `propertyName`). The only invariants asserted on a form are: id present, id not a `{{token}}`, id unique, `parentId` present, ≥1 component, and `formId:{name,module}` resolves.

`npm test` runs only the positive suite; the mutation test (the one artifact in the repo that proves a gate *fails when it should*) is a separate script. `summarize.js`, `validate-blocks.js`, `bake-overlays.mjs` and `layout-probe.js` have **no tests at all** — which is how a script that cannot start shipped.

### 1.5 Cost

| Unit | Tokens |
|---|---|
Run fixed cost (conductor + contract + design system + ingest) | 17–52K |
Comprehension per screen (docs + probe emit + blueprint out + screenshot) | ~13K + probe |
Probe result, read targeted | 10–30K (unfiltered tail risk: 63–195K) |
Build per screen (`SKILL.md` + on-demand refs + blocks in + form JSON out) | 55–95K |
Style pass per screen (if run — see contradiction #5) | 35–55K |
Verify per screen (re-probe × rounds + screenshot + critic in fresh context) | 20–80K |
**One screen, clean pass** | **110–180K** |
**One screen with the documented 2 fix cycles** | **200–330K** |
**Canonical 3-screen brief** | **370K–1,050K** |

The two largest line items — the form JSON the builder writes, and the probe JSON the verifier reads — are exactly the two that the pipeline's path-passing discipline cannot reduce, because a model must produce or consume those bytes either way. **Only moving them out of the model's mouth reduces them.**

For calibration: Anthropic's published three-agent harness costs **$200 / 6 hours** versus **$9 / 20 minutes** for a solo agent — ~20× — for the difference between "non-functional core features" and "fully playable". Zero-supervision correctness is bought with roughly an order of magnitude more inference. The question is not whether to spend it; it is whether to spend it on *expansion* (which a compiler does free) or on *verification* (which is the only thing that buys correctness).

---

## 2. Root-cause diagnosis: why it stalled

Five causes. None of them is model capability.

**RC1 — The model is doing the compiler's job.** 96% of the output bytes are mechanical expansion of a small intent. Asking a probabilistic system to perform 19,170 bytes of deterministic expansion means every byte is an independent failure opportunity, and the failures are *plausible* — wrong version, wrong slot, missing breakpoint key — so they survive review. This is why "structurally valid but functionally wrong" is the dominant failure mode. It is the predicted outcome, not bad luck: the 2026 empirical study of structured-output control found **185 and 544 residual *value* errors** on two benchmarks under *perfect* syntax enforcement. Syntax gates cannot reach semantics.

**RC2 — Prose is being used as a type system, past the point where models obey prose.** The corpus encodes hundreds of hard constraints as English scattered across 47KB + 276KB, with 13+ verified mutual contradictions. IFScale measures Claude-class adherence falling to ~53% at 500 simultaneous instructions and frontier models struggling above ~100. The primacy trick ("put the important rule first") is measured to *stop working* past ~150–200 instructions. So the recurrence of `footerButtons: "default"`, the `columns` ban and the reflist format is not carelessness — **it is the expected behaviour of a system operating past its instruction-adherence ceiling.** Adding a fourth restatement of a rule makes adherence *worse*, because it adds mass. SkillReducer's result (compress 39–48% → quality *up* 2.8%) is the same finding from the other direction.

**RC3 — The verifier layer is theatre in four of six places.** Two scripts pass everything (`validate-blocks.js` warns where three docs say it fails; `bake-overlays.mjs` writes despite declared refusal), one cannot execute at all (`summarize.js`), one has a coverage hole that reproduces the exact false-green it was written to prevent (`verify-artifact.mjs`), and the placement gate has no comparator program at all. Meanwhile the most load-bearing gate in the documented chain, `clean-form-config`, ships **zero code**. Green signals with no coverage are worse than no signals: they consume the review budget that would otherwise go to reading the JSON.

**RC4 — Model-judged gates are being used in the regime where they are measurably reward-hackable.** A July 2026 result: a reference-free judge's pass rate climbed 0.72 → 0.94 while true accuracy stayed at ~0.20 — a judge–truth gap of **0.74** — and **three-judge unanimous ensembles still accepted 55% of hacked wrong answers**, because monotone aggregation shares the plausibility signal. Severity is bounded by `1 − accuracy`, i.e. **worst exactly in hard, low-accuracy regimes** like yours. Separately, SpecBench found the hacking gap grows **~27 percentage points per 10× increase in code size** — your artifacts scale 12 → 500 components, so this widens as you succeed. Anthropic's own harness post reports the same thing plainly: "out-of-the-box agents over-praise their own outputs," requiring multiple evaluator calibration rounds. Your `design-critic` spending its one cycle disproving its own false positive (Animal Patient retrospective) is this failure mode, in your own logs.

**RC5 — Visual fidelity and functional correctness are being pursued as one goal, and they decouple violently.** On UI2App (2026) the visual-fidelity leader ranks **fourth** on interaction correctness, trailing the leader by **5.2×**; half the models score exactly zero on cross-page state. MobileForge: **100% build success across all six frontier models** (build success is a worthless gate) while best visual score was **2.99/5**, and the best visual performer emitted **2.2× more code with 2.5× more dead code**. Your retrospective says it in the same words: "Function was verified thoroughly. Look and feel was not verified with anywhere near the same rigor." These must be **separately generated and separately verified**, with different instruments, or one will always be sacrificed to the other.

### The corollary that matters most

Because the golden reference is itself defective (§1.1), *imitation* is a dead end. There is no clean example to few-shot from, no gold corpus to fine-tune on, and no target for a similarity metric — until something **normalises** the corpus. A compiler is therefore not only the cheapest path to correctness; it is the **precondition for every other technique** on the table, including RAG and fine-tuning. Retrieval over a defective corpus retrieves defects. Fine-tuning on a defective corpus learns defects. Normalise first, and every downstream option becomes available at once.

---

## 3. The strategic choice

Three options. I evaluated all three against the constraints (model-agnostic, no framework changes, PR #39 as base).

### Option A — Keep improving prose (status quo + retrospectives)

*What it is:* keep feeding retrospectives into SKILL.md and reference files; fix the scripts' bugs; carry on.

**Verdict: reject.** It is measurably self-defeating. Every cycle adds instruction mass to a system past its adherence ceiling (RC2), and the mechanism by which it is supposed to work — the model reliably obeying more rules — is the mechanism that is failing. The 13 contradictions and 4 KB of changelog archaeology are the accumulated cost of eight months of this. Expected trajectory: recurring defects, rising cost, no ceiling lift.

### Option B — Full clean-sheet rebuild

*What it is:* discard the skills, design the ideal system, rebuild.

**Verdict: reject on cost, adopt its architecture.** The assets that took the longest to earn are the empirical ones — the 121-component KB, the 36-row capability matrix, the block library's live-verified workarounds (the datalist row-template collapse fix alone encodes a month of probing), the retrospectives, and the SAA harness with its `__SAA_RESULT__` contract and five-dimension scoring. Rebuilding those means re-measuring against a live backend. Throwing them away to escape the prose is throwing away the wrong half.

### Option C — Compiler-first re-architecture on the PR #39 base *(recommended)*

*What it is:* keep every empirical asset, **change who reads it**. Convert the prose corpus into a machine-executable registry + a compiler + a verifier ladder. Reduce the skills to thin routers over that toolchain. Make the SAA harness the arbiter.

*Why this specific shape:*
- It is Anthropic's own documented guidance, not an invention: *"Prefer scripts for deterministic operations: write `validate_form.py` rather than asking Claude to generate validation code"* — pre-made scripts are "more reliable than generated code"; *"Set appropriate degrees of freedom"* → low freedom (specific scripts) *"when operations are fragile and error-prone and consistency is critical"*; and the **plan → validate-plan-with-a-script → execute → verify** pattern, whose worked example is literally 50 form-field updates validated via a `changes.json` before application.
- It is the pattern with the best industrial evidence in this exact task class: BMW Financial Services' DSL→multi-file-code pipeline, where QLoRA-tuned **7B** models reached **1.000 structural fidelity, 100% valid JSON, ~0.98 BLEU**, rated 5.00/5 on structural fidelity by four senior developers.
- It satisfies model-agnosticism *by construction*: the compiler and the bottom four verifier tiers are ordinary programs. What is left for a model is a ~768-byte spec — and small models are measured to match large ones on grammar-constrained DSL emission (7–12B open models matching much larger ones, 2026).
- It requires **no framework change** — every input it needs is already published or already measured.

*What it costs:* one focused engineering push (§6 estimates 6–9 weeks to a defensible v1, with a go/no-go decision available in week 1). The compiler is small — the hard part is already done, in that the corpus already documents the rules; they just need to be transcribed into code exactly once instead of being re-read by a model on every run.

---

## 4. Target architecture

Six layers. Layers 0–3 are programs. Layer 4 is the agent harness. Layer 5 is measurement. **Every arrow that must never be violated is code, not prose.**

```
 L5  EVAL & GOVERNANCE   golden corpus · structural distance · held-out functional suite
                         anchor-validated visual judge · SAA harness as arbiter
                                        ▲ measures everything below
 L4  AGENT HARNESS       Planner ──▶ Specwriter ──▶ (compile) ──▶ Evaluator
                         thin skills · PreToolUse/PostToolUse hooks · MCP tool surface
                                        │ emits/repairs SFS only
 L3  VERIFIER LADDER     T1 schema · T2 registry · T3 semantic/graph · T4 live smoke
                         · T5 visual (model, rubric-bound, last)
                                        ▲ every tier reports coverage, zero coverage = fail
 L2  COMPILER            SFS ──▶ normalise ──▶ expand ──▶ stamp ──▶ envelope ──▶ push
                         + decompiler: markup ──▶ SFS  (round-trip = the correctness proof)
                                        ▲
 L1  SFS (the IR)        ~768 bytes/screen · typed · JSON-Schema'd · human-reviewable
                                        ▲
 L0  GROUND TRUTH        component registry (types/props/versions/slots/enums/required)
                         · capability matrix · brand tokens · entity metadata
                         · precedent index (RAG)
```

### L0 — Ground truth: one registry, generated, pinned, reconciled

Today's `components-kb` is 80% of this and is addressed to the wrong reader. Three changes make it a compiler input:

1. **Reproducible generation.** `_meta.json` currently records `sourceDir: "C:/Users/Hashim/Documents/Git Repos/shesha-framework/…"` — a machine-local path. Re-point the extractor at a **pinned git ref** of `shesha-io/shesha-framework` (`releases/0.45`, commit SHA recorded), run it in CI, commit the output with the SHA. *(I checked the npm route: `@shesha-io/reactjs@0.45.1` publishes, but `dist/index.d.ts` is a 2 KB stub and versions mined from the rolled-up bundle are migration-chain artifacts — `textField` yields `[0,1,2,3,4,5,6]`, `collapsiblePanel` `[1,2,4,5,7]` — so source extraction at a pinned tag is the only sound path. This is a change to your extractor, not to the framework.)*
2. **Add the three fields a validator needs and the KB lacks:** `type` (value type, not the designer widget name — `settingsFields[].editorType` is currently the *widget*, so `SKILL.md:212`'s "booleans not `"true"`" is unenforceable), `required`, and **nested item schemas** for `datatable.items[]`, `buttonGroup.items[]`, `tabs.tabs[]`, `KeyInformationBar.columns[]`. Those nested structures are precisely where `debug.md` rows 19–22 locate the crashes, and today the KB describes `datatable.items` as one entry: `{"path":"items","editorType":"columnsEditorComponent"}`. Also fill the **28 components with empty `ownProps`** — which include `datatable`, `datalist`, `dropdown`, `button`, `buttonGroup`, the five with the most disputed props, and the ones `SKILL.md:165` designates as the arbiter of shape disputes — and the **22 with `version: null`**.
3. **Runtime reconciliation.** A `registry-probe` that reads the *live* app's published forms + designer metadata and diffs against the committed registry. Any divergence is an upgrade-impact report. This is what makes the registry trustworthy per-app rather than per-release, and it replaces `cheatsheet:74`'s non-functional stub recipe.

Add to L0: the capability matrix (**give every row an `id`, a probe-form reference and its own `measuredAt`** — today all 36 share one header date, several are inferences labelled "production-confirmed", `tabs`/`collapsiblePanel` have zero rows, and `matrix.versions` has re-introduced the drifting version list its own doc forbids: `dataContext` 7 vs KB 8), the brand tokens, and entity metadata.

### L1 — SFS: the intermediate representation

A typed, JSON-Schema-validated spec. Design rules, each earned from the evidence:

- **Say intent once.** One `responsive` declaration per region (`{ stack: "below:tablet", fill: "search", fixed: { actions: 180 } }`) compiles to all three breakpoint blocks. That single rule removes 43.9% of the markup bytes and both breakpoint defects in your reference form.
- **No ids, no versions, no `parentId`, no escaping.** Nesting is expressed by nesting. The compiler stamps identity and version from the registry. This deletes the `stampTree` function that `SKILL.md:173` currently asks the model to *transcribe and run*, and the four places that re-specify it.
- **Semantic component names, not slot mechanics.** SFS says `card { … }`; the compiler knows children go in `content.components`. The single most-cited crash in the corpus becomes structurally impossible.
- **Bindings are entity paths, resolved at compile time** against the metadata in L0 — camelCasing, existence, datatype→component mapping (a 9-row total function today living in prose) all become compiler concerns.
- **Actions are named intents.** `action: openDialog(booking-create, width: 60%, onSuccess: refresh(bookingsTable))` compiles to the `{_type, actionName, actionOwner, actionArguments, onSuccess}` shape with correct lowercase owner and spaced action name. Contradiction #9 evaporates.
- **Style by role only.** SFS carries `$role:` tokens; **resolution moves to compile time, per run, per brand** — not `bake-overlays.mjs --apply` mutating plugin source. That is the one change that makes the brand-genericity claim true, and it un-breaks the two scripts currently fighting each other.
- **Escape hatch, explicitly typed.** `raw: { … }` for anything the IR cannot yet express, and the compiler **counts and reports** every escape. Escape-hatch frequency is your roadmap: the props that get raw-ed most often are the next ones to promote into SFS.

Two properties make SFS trustworthy rather than aspirational:

- **A decompiler.** `markup → SFS` for the existing corpus. `compile(decompile(form))` ≡ `normalise(form)` is a **property test over every form you own** — hundreds of free test cases, and the mechanism that migrates the corpus. This is the single highest-value artifact in the whole plan.
- **Never constrain the reasoning channel.** The research is unambiguous and cuts both ways: constrained decoding on reasoning-heavy tasks is *catastrophic* (Claude-3-Haiku GSM8K **86.5% → 23.4%** under a JSON schema), while it is fine on selection-into-a-shape. So: the model reasons in prose/plan, then emits SFS; SFS is *validated* (parse-and-repair with domain error messages), not *decode-constrained*. This is also why SFS must be a real language with error recovery, not merely a terser serialisation — "Notation Matters" (2026) found token-optimised formats saving 18–27% input while costing **1–14 points of accuracy**, with parse failures cascading.

### L2 — The compiler

```
SFS ──▶ [1 parse+schema] ──▶ [2 resolve: registry, metadata, tokens, precedent]
    ──▶ [3 normalise: canonical key order, single styling channel, dedupe wiring]
    ──▶ [4 expand: breakpoints, defaults, slots, nested item shapes]
    ──▶ [5 stamp: uuid ids, parentId, versions]
    ──▶ [6 serialise: markup string, escaping, envelope]  ──▶ push (single path)
```

Non-negotiable properties: **deterministic** (same SFS + same registry ⇒ byte-identical markup; no clock, no randomness beyond a seeded id source so diffs are reviewable) · **total** (every reachable state either compiles or produces a *domain-level* error, never a stack trace) · **idempotent** (`compile(decompile(compile(x))) == compile(x)`) · **one push path** (already a stated invariant; now enforced by there being exactly one function).

The normaliser alone removes all eight defects in your golden reference: canonical single styling channel kills #5 and #6; canonical breakpoint expansion kills #2 and #3; slot/label defaults kill #1; registry-driven `formSettings` per form kind kills #8; action dedupe kills #7; and a page-shell recipe kills #4.

Error messages are a first-class deliverable. The BMW study and the Thoughtworks DSL argument agree on this: an agent can autonomously self-correct against a *domain* error (`unknown property 'referenceListName' on 'dropdown' — did you mean referenceListId: {module, name}? (registry 0.45.1)`) far better than against a runtime blank screen. Your entire `debug.md` (15 KB, 30+ symptom rows) is the raw material for the compiler's error catalogue — it becomes *generated feedback* instead of *documentation the model must have read in advance*.

### L3 — The verifier ladder

Five tiers, cheapest and most decisive first. **Every tier reports `walked / checked / uninspectable`, and zero coverage is a hard fail — implemented once, in a shared library, not re-implemented per script.**

| Tier | What | Instrument | Needs |
|---|---|---|---|
**T1 Schema** | SFS + compiled markup validate against JSON Schema | `ajv` | nothing |
**T2 Registry** | every `type` exists · every prop legal for that type · every enum value in domain · every `version` current · required props present · slot placement correct · value types correct | registry from L0 | nothing |
**T3 Semantic / graph** | bindings resolve against entity metadata · reference lists resolve · every `formId` target exists · action owners/names in the legal pair set · `onSuccess` targets exist in-tree · `dataContext` ancestor present for every data component · one primary per action zone · `validationErrors` present when inputs are required · submit+exit pair per hosting mode · embedded scripts parse (`node --check`) · **placement assertions as executable predicates over the compiled tree** | compiler AST + live backend for existence checks | backend |
**T4 Live smoke** | render · console clean · click every action and assert the consequence (dialog opens, row navigates, save persists — verified by a raw backend GET, not a toast) · reference-list options populate · read-only fields render values | Playwright | backend + frontend |
**T5 Visual** | rubric-bound, anchor-validated VLM comparison against target/theme | model | screenshots |

Two design points carry most of the value:

**Placement moves from T5 to T3.** Today it is a model reading a 63–195K-token DOM probe against English sentences, and two of its five dimensions are unmeasurable (§1.3). But **95% of what those assertions state is a property of the compiled tree, not of the rendered DOM**: which flex cell a node is in, its parent, its tab, the declared width ratio. Those are checkable in milliseconds with zero tokens. Rewrite assertions as predicates over the SFS/AST — `assert cell(relatedPanels) == "rail"`, `assert ratio(main, rail) >= 2.5`, `assert tab(endpointsTable) == "Endpoints"` — and keep the DOM probe only for the genuinely emergent residue (overflow clipping, actual painted overlap). This also fixes tab assignment, which the DOM probe *cannot* see and the tree knows exactly.

**T5 is a ranking signal, never a gate — and its judge must be qualified.** Adopt MobileForge's **anchor-reference list-wise protocol**: embed the ground-truth design anonymously among the candidates; a judge that fails to rank the anchor first is **disqualified**. The measured spread between two frontier models on this test was **~100% vs ~35%** anchor accuracy — so this is not a formality, it is the difference between a working instrument and a random number generator. Bind it to explicit rubrics (WebVR: human agreement **77–87% with rubrics vs 59–67% without**, where unrubriced "scores are artificially inflated and demonstrate severe lack of discriminative power"). And enforce **judge independence** — the judge commits to its own assessment before seeing the builder's claim (measured effect: false positives **0.719 → 0.012**). Never let the builder's self-report enter the judge's context; today the `__SAA_RESULT__` self-verification block does exactly that.

Also: **pixel diffing is not an option** — a naive pixel baseline scores 0.00% no-change accuracy (it flags everything); with anti-aliasing tolerance, 6.72%. Use semantic/structural diffing plus the rubric-bound judge.

### L4 — The agent harness

Three roles with **file-based handoffs**, per Anthropic's harness-design report, replacing the current conductor-plus-prose arrangement:

- **Planner** — reads the design source (or the brief), produces `plan.json`: screens, archetype per screen, entity, build order, and the **acceptance contract** for each screen (the T3/T4 predicates that define "done"). Negotiated *before* implementation — Anthropic's "sprint contracts". Uses RAG (below) for precedent.
- **Specwriter** — one screen at a time, emits SFS. Never sees the markup. Its whole world is the IR, the registry excerpt for the types it uses, and retrieved precedent. **This is the only creative step**, and it is where the expensive model earns its cost.
- **Evaluator** — separate context, never sees the Specwriter's reasoning or its self-report. Runs T1–T4, then T5. Returns structured findings against the acceptance contract with **hard thresholds**.

Repair loop: compiler/T1–T3 errors go straight back to the Specwriter as domain diagnostics (cheap, deterministic, high-yield). T4/T5 findings route by ownership. **Cap the loop at 3 rounds** — UI2Code^N measures visual-refinement gains saturating at **N=3–5** (66.0 → 73.0 from N=1→4, synthetic saturating at N=3), and SpecBench found more search iterations *do not* reliably remove reward hacking and sometimes amplify it.

**Skills become thin.** Target: `SKILL.md` under 500 lines and under ~8 KB each, references one level deep, every deterministic rule deleted because it now lives in the compiler or the registry. Rough shape:

| Skill | Job after |
|---|---|
`shesha-designer` (conductor) | route, own `plan.json`, own the run dir, dispatch, enforce gates |
`shesha-spec` (new, replaces `shesha-form-edit`) | how to write SFS: the IR grammar, ~10 worked examples, the escape hatch, and *nothing else* |
`shesha-design-comprehension` | design source → screen inventory + target facts; DOM probe for the emergent residue only |
`shesha-design-system` | brand tokens + recipes as **data**; resolution is the compiler's job |

Everything currently in `shesha-form-edit`'s 32 reference files splits three ways: **compiler code** (the deterministic 38 items the audit enumerated), **registry data** (props, versions, enums, slots), or **error catalogue** (the `debug.md` symptom table). Very little survives as prose. Note Anthropic's measured finding that **worked input/output examples beat schema descriptions by 18 points** on complex parameter handling (72% → 90%) — so the ~10 SFS examples are load-bearing and the prose explanation is not.

**Hooks are where invariants live.** A hook is code, so instruction-adherence decay does not apply to it. Minimum set: `PostToolUse` on any write to a `*.sfs.json` → schema-validate, reject on failure; `PreToolUse` on the push tool → refuse unless the compile artifact and T1–T3 verdicts are green in the run dir; `PreToolUse` on `Write` targeting a form JSON directly → **block** (the compiler is the only writer). That last hook alone makes "the model hand-edited the markup" impossible, which is the failure class that produces defects nothing can trace. *(Honesty note: the case for hooks here is architectural, not empirical — I found no published measurement of hook-based enforcement versus prompt-based instruction. The argument is that a hook cannot be forgotten, which is a property, not a claim.)*

**MCP surface.** Wrap the toolchain as an MCP server (`compile`, `decompile`, `verify`, `registry.lookup`, `metadata.entity`, `precedent.search`, `push`) so it is reachable from Claude Code, Copilot, a local model, or the SAA harness identically. This is the concrete form of model-agnosticism. Note the measured token economics: tool search gives **85%** reduction *with accuracy up* (79.5% → 88.1% on tool selection), programmatic tool calling **37%**, and MCP-via-code-execution up to **98.7%** (150K → 2K tokens) — so a tool surface plus code execution beats preloading a large toolset.

**On parallel subagents: don't.** Anthropic's multi-agent research post reports a 90.2% win for lead+subagents on breadth-first *research*, and explicitly excludes tasks with shared context, heavy inter-agent dependencies, and "most coding tasks". Your artifact is one tightly-coupled document; parallel authors on slices of one form is the named anti-pattern — and you have already been bitten by it (`SKILL.md:165` records two parallel authoring agents producing two mutually incompatible `refListStatus` shapes). Fan out **across screens**, never within one.

### Where RAG belongs — and where it does not

You asked; here is the honest split.

**Not for correctness lookups.** "Which props are legal on `datatable` in 0.45.1?" needs an **exact** answer from an index, not a nearest-neighbour answer from an embedding. Retrieval over the KB would reintroduce, probabilistically, the very ambiguity the registry removes. Use a lookup, not a search.

**Yes, for three things — all of which become possible once the corpus is normalised:**

1. **Precedent retrieval over your own live forms (highest value).** Decompile every form in every Shesha app you own into SFS. Index by *shape* — archetype, entity cardinality, component multiset, region topology — not by prose similarity. Then "build a bookings list with search, add-dialog and status column" retrieves the three nearest normalised SFS precedents, which the Specwriter adapts. This is the mechanism that makes 768-byte specs reliable: the model is editing a known-good spec, not inventing one. It also compounds — every accepted screen enlarges the index.
2. **Grounding design→archetype mapping.** Retrieve over screenshots + blueprints of past accepted screens to answer "which archetype is this design?" — a genuinely fuzzy question where similarity is the right primitive.
3. **The error catalogue.** Retrieve over the 30+ `debug.md` symptom rows *and the accumulated retrospectives* keyed by compiler/verifier error code, so a T3/T4 failure arrives with the historical fix attached. This is where the Animal Patient retrospective, Zama's backend logs and every future one get consumed automatically instead of being read by a human and re-typed into a SKILL.md.

Build it small: local embeddings (a 100–400M model), SQLite + a vector index, one MCP tool `precedent.search`. This runs comfortably on your laptop GPU (§Appendix A).

### L5 — Eval and governance: the SAA harness becomes the arbiter

Your harness is a genuine asset and is currently under-used — it grades *agents*, when it should also grade *the toolchain*. Changes:

- **A golden corpus with a normalisation baseline.** Decompile→recompile every form you own; the diff is your first quality report and it will find defects like the eight in `bookings-table` across the estate.
- **Structural distance, not exact match.** The BMW study's discriminating metric was **structural fidelity 0.990–1.000 while exact match was 0.629–0.657** — exact match is too brittle to be useful in the high-quality regime. Define a typed, prop-channel-aware tree distance that ignores ids and semantically-irrelevant ordering.
- **A held-out functional suite the generator never sees.** SpecBench: "every frontier agent saturates the visible suite" while failing held-out compositional tests, with the gap growing ~27pp per 10× artifact size. Split your test cases: visible (for iteration) and sealed (for release decisions). Only sealed results gate a version.
- **A vector of scores, never a blend.** MobileForge's five orthogonal axes surfaced an *inverse* correlation between visual quality and maintainability that a single blended score would have hidden. Your harness already has five dimensions — keep them separate and make regression on any axis block.
- **Instrument the judge–truth gap deliberately.** Sample N screens per release, hand-verify, and publish the gap between T5's verdict and truth. If you cannot state that number, you do not know whether your gates work. This one habit is the difference between the current state and a system you can trust unsupervised.
- **Apply the Agentic Benchmark Checklist** to the harness itself. Task/outcome validity failures are measured to distort agent performance by up to **100% in relative terms** — the canonical example being TAU-bench counting empty responses as successful, which is precisely your "0 checked, PASS" bug in another codebase.

---

## 5. Disposition: what is kept, promoted, rewritten, deleted

| Asset | Disposition | Why |
|---|---|---|
`components-kb` (121 components) | **Promote to L0 registry** — add value types, `required`, nested item schemas; fill 28 empty `ownProps` + 22 null versions; regenerate from a pinned git ref in CI | 80% of a compiler symbol table already exists; it is just unaddressed to a program and unreproducible |
`capability-matrix.json` (36 rows) | **Keep, harden** — per-row `id`, probe reference, own `measuredAt`; drop `matrix.versions` (re-introduces the drift its own doc bans); add `tabs`/`collapsiblePanel` | Genuinely empirical and expensive to re-earn; the metadata makes it auditable and diffable across upgrades |
Block library (11 blocks) | **Convert to compiler recipes** — parameterised SFS macros, not JSON skeletons with three incompatible `$bindings` shapes and prose-located insertion points | The *knowledge* is precious (the datalist collapse fix, the 332/`calc(100% - 348px)` idiom, page-shell `hideHeading`+`className`); the *format* is unusable as a machine contract |
`verify-artifact.mjs` + its 15 tests | **Keep, extend into T1–T3** — fix the two holes (zero-coverage rule; walk `items`/`columns`); make coverage accounting a shared library | The best-engineered thing in the repo and the right template for everything else |
`check-references.mjs` | **Keep** — fix lazy families (declare the family set up front), reconcile the coverage arithmetic, guard `readJson` | Real value: it catches doc rot, which will still exist for the thin skills |
`tests/check-references.negative.mjs` | **Promote to a pattern** — every gate gets a mutation test proving it fails when it should | The only artifact in the repo that proves a gate fails correctly. Generalise it |
`bake-overlays.mjs` | **Delete; absorb into the compiler** at run time, per brand | Build-time baking into plugin source is what breaks brand-genericity, and its write-despite-failure path is a live defect |
`validate-blocks.js` | **Delete; absorb into T2** with hard failures and real matching | Fuzzy free-text matcher, two escape hatches, 0 fails / 136 warns, not wired to anything |
`summarize.js` | **Delete** | Cannot execute; validates nothing even if it could |
`layout-probe.js` | **Keep, narrow** — add `data-sha-c-name` capture and a `--summary` mode; use it only for the emergent residue after placement moves to T3 | Sound instrument, wrong job. It cannot see tabs or `1fr` intent, and 63–195K tokens/read is untenable |
`assets/examples/*.json` (2.5 MB) | **Decompile to SFS, then delete the raw seeds** | Their current role — "copy this 730 KB file" — is the main cost driver and imports their defects (7 seeds contain the banned `columns`; `standalone-create.json` has 7 of 10 components versionless and a `version: "1"` **string**) |
`shesha-form-edit/SKILL.md` (47 KB) + 32 refs (276 KB) | **Split three ways and delete the remainder**: → compiler code (the 38 deterministic items) · → registry data · → error catalogue. What survives is `shesha-spec` (<8 KB: the IR grammar + ~10 worked examples) | This is the bulk of the "gutting". It is not a loss — the content moves to where it is enforceable |
`blueprint-ir.md` + `verification-loop.md` | **Rewrite** — assertions become executable predicates over the compiled tree; keep the DOM probe for the residue only | The vocabulary is good; the mechanism (English sentences, model-judged, fuzzy by mandate) is not |
Handoff contract | **Replace with schemas** — `plan.json`, `<screen>.sfs.json`, `verdict.json`, all JSON-Schema'd and hook-validated | Today the `{archetype, blocks[], recipes[]}` contract is one clause in one sentence, and the file named as its home never mentions it. `blocks[]` is decided and then never transmitted to anyone |
Retrospectives (Animal Patient, Zama's logs, future) | **Promote to the RAG error catalogue**, keyed by error code | Currently consumed by a human re-typing lessons into prose, which is the loop that is failing |
SAA harness | **Keep, elevate to arbiter** — golden corpus, structural distance, sealed suite, judge-independence, published judge–truth gap | Already the right shape (`__SAA_RESULT__`, 5 dimensions, `--executor` comparison, watch mode). It just needs to grade the toolchain, not only the agent |
`test-env-rules.md` | **Keep, amend** — one change: the `outputs` block should reference the compiled artifact + verdict paths, and the self-verification block must **not** be fed to the judge | Judge independence is worth 0.719 → 0.012 on false positives. Feeding the builder's self-report to the evaluator is the exact anti-pattern |

---

## 6. Roadmap

Sequenced so the **riskiest assumption is tested in week 1** and every phase ends in something measurable. Effort assumes roughly one focused engineer with agent assistance; run phases 1–2 before committing to the rest.

### Phase 0 — Stop the bleeding (2–3 days, do immediately, independent of everything else)

These are live defects, cheap, and they make the rest measurable.

1. Fix `verify-artifact.mjs`: add the zero-coverage rule to `verdictOf`; walk `items`/`columns`; count absent/empty `formId` as walked-and-uninspectable. Add the missing tests.
2. Fix `check-references.mjs`: declare families up front so none can vanish; reconcile walked/checked; guard `readJson`.
3. Fix `bake-overlays.mjs`'s write-despite-role-failure, or disable `--apply` pending Phase 3.
4. Delete `summarize.js` and its two invocations, or port it to ESM.
5. `validate-blocks.js`: make `columns`, flex-without-display and unmatched channels **hard failures**, wire it into `npm test`, and make `npm test` run the negative suite.
6. Resolve the top 6 contradictions in §1.2 by **deleting the losing side** — not by adding a note explaining which wins. Start with #1 (reflist name), #2 (`refListStatus` shape), #5 (block styling pass), #9 (`actionOwner` casing).
7. Delete the ~4 KB of changelog archaeology from `SKILL.md`.

**Gate:** every gate that claims to fail on X provably fails on X (mutation-tested), and `npm test` runs everything.

### Phase 1 — The decisive experiment (1 week)

The one claim in this document with no published head-to-head evidence is *"model emits compact IR → compiler expands"* beats *"model emits markup"* for this artifact class. Test it before building anything.

1. **Hand-write the SFS for `bookings-table`** (target ≤1 KB) and hand-write a throwaway compiler for just that archetype — table + toolbar + dialog action + refListStatus column + pager.
2. Prove `compile(SFS) ≡ normalise(bookings-table)` — byte-identical after normalisation, defects removed.
3. Run a **three-arm comparison** on 8–10 test cases through the SAA harness, all other things equal: (A) current pipeline, (B) SFS + compiler with a frontier model, (C) SFS + compiler with a **small/local** model.
4. Measure: T1–T4 pass rate, tokens, wall-clock, defects found by hand review, and the T5 rubric score.

**Gate — the go/no-go:** arm B beats arm A on functional pass rate *and* costs ≤50% of the tokens. Arm C's result tells you how far model-agnosticism reaches today. If arm B does not clear it, stop and reassess rather than build the full compiler — and the experiment is a week, not a quarter.

### Phase 2 — Registry + decompiler (2 weeks)

1. Re-point the KB extractor at a pinned `releases/0.45` commit; run in CI; commit with the SHA. Add value types, `required`, nested item schemas for the four container-ish types; fill the 28 empty `ownProps` and 22 null versions.
2. Build the **decompiler** (`markup → SFS`) and run it over every form in every app you own.
3. Publish the **normalisation report**: for each form, the defects the round-trip removes. Expect the eight-per-form class to be endemic.
4. Property test: `compile(decompile(f)) == normalise(f)` for the whole corpus. Failures are either compiler gaps or genuinely novel constructs — both are exactly the backlog you want.

**Gate:** ≥90% of the existing corpus round-trips; every failure is triaged into "compiler gap" or "promote to SFS"; escape-hatch usage is counted and published.

### Phase 3 — Compiler + verifier ladder to v1 (2–3 weeks)

1. Compiler: the six stages, with domain-level errors seeded from `debug.md`'s symptom table. Run-time, per-brand `$role:` resolution (retire `bake-overlays.mjs`).
2. T1/T2 from the registry; T3 semantic/graph checks including **placement predicates over the compiled tree**; shared coverage-accounting library with zero-coverage-fails built in once.
3. T4 harness: Playwright smoke that clicks every action and asserts the consequence against a backend GET — never a toast.
4. Convert the 11 blocks into parameterised compiler recipes.

**Gate:** on the Phase 1 test set, T1–T3 catch ≥90% of the defect classes the audits enumerated; every tier reports coverage; zero coverage fails; every gate has a mutation test.

### Phase 4 — Harness, skills, hooks, RAG (2 weeks)

1. Planner / Specwriter / Evaluator with file handoffs and schema'd artifacts; 3-round repair cap.
2. Rewrite the four skills thin (<500 lines, <8 KB, refs one level deep, ~10 worked SFS examples).
3. Hooks: SFS schema on write; push blocked without green verdicts; **direct form-JSON writes blocked outright**.
4. MCP server exposing `compile`/`decompile`/`verify`/`registry.lookup`/`metadata.entity`/`precedent.search`/`push`.
5. Precedent RAG over the decompiled corpus (local embeddings, SQLite + vector index); error-catalogue RAG keyed by error code.

**Gate:** a three-screen brief completes unattended, all gates green, no human edit, at ≤30% of the current token cost.

### Phase 5 — Eval maturity and distribution (ongoing)

1. Golden corpus + structural-distance metric; **sealed** functional suite separate from the visible one.
2. T5: anchor-validated judge (disqualify any judge model failing the anchor test), published rubrics, judge independence enforced.
3. Publish the **judge–truth gap** per release from hand-verified samples.
4. Then distribute: version the registry per Shesha release, ship the compiler as a package, and treat the marketplace plugin as a thin client over it.

**Gate:** two consecutive releases where the sealed-suite result matches hand review within a stated tolerance. That is the point at which "zero human supervision" is a claim you can defend rather than hope for.

---

## 7. Cost and quality model

Where the tokens go today, and after.

| Line item | Today | After | Mechanism |
|---|---|---|---|
Instruction/index preload per build | ~75K | ~10K | 47 KB + 276 KB prose → <8 KB skill + registry excerpt |
Artifact emission per screen | 15–38K out | **~1K out** | 768-byte SFS instead of 19 KB markup (25× expansion is free) |
Style pass | 35–55K | **0** | Compile-time role resolution |
Placement verification | 10–30K/round (tail 195K) | **~0** | Predicates over the compiled tree |
Repair rounds | model reads DOM probe + prose | domain error strings | Compiler diagnostics, deterministic |
Visual verification | model, unbounded | 1 screenshot + rubric, capped at 3 | Saturates at N=3–5 anyway |
**Per screen, clean** | **110–180K** | **20–40K** | |
**3-screen brief** | **370K–1,050K** | **70–140K** | |

Then apply the pricing levers, in the order the evidence supports:

1. **Prompt caching first** — cache reads at **0.1× input** (90% off). The registry excerpt, skill and IR grammar are a stable prefix; this is the single largest lever. Watch the minimum cacheable prefix, which is model-specific (512 tokens for Opus 5, 1,024 for Sonnet 5, **4,096 for Haiku 4.5**) — **short prompts silently fail to cache with no error**, an easy invisible leak.
2. **Batch API** for anything non-interactive — **50% off**, stacks with caching (though batch cache-hit rates are best-effort, 30–98%).
3. **Model routing last.** On current pricing Opus 5 → Haiku 4.5 is **5×** on both input and output, not the order of magnitude folklore suggests. **Context engineering beats model downgrading**: 90% from caching and 85–98.7% from tool-surface economics both dwarf 5×.

Where cheap/local models genuinely fit, per the research: **DSL emission** (7–12B open models measured matching much larger ones under grammar constraint; QLoRA-tuned 7B hitting 1.000 structural fidelity on a real industrial DSL) and **verification** (a **400M cross-encoder distilled from a verifier ensemble retained 98.7% of accuracy at 99.97% fewer FLOPs**). Keep the frontier model for the Planner and the Specwriter's hard cases; push expansion, validation and first-pass verification down.

**Be honest internally about the trade.** Anthropic's own numbers: a solo agent is $9/20min and produces non-functional core features; the three-agent harness is $200/6h and produces something that works. Zero-supervision correctness costs roughly an order of magnitude more inference than one-shot generation. The architecture above does not avoid that; it *moves the spend from expansion to verification*, which is the only place it buys correctness. And the compiler makes the expansion free, so the net per-screen cost still falls 4–5×.

---

## 8. Risks, and how each one gets falsified

| Risk | Falsification test |
|---|---|
**The IR cannot express real designs** — you end up with `raw:` everywhere and have rebuilt the problem with extra steps | Phase 2's escape-hatch counter. Set a hard threshold: if >20% of screens need `raw:` for anything structural after Phase 3, the IR is under-designed — fix the IR, don't tolerate the hatch |
**Compiler becomes the new 47 KB** — complexity migrates rather than reduces | Two invariants: the compiler has tests and a type checker (prose has neither), and its behaviour is *derived from the registry*, not hand-written per component. Track compiler LOC per supported component type; if it grows super-linearly, the registry is under-specified |
**Registry drift on Shesha upgrade** | CI regenerates from a pinned ref; the runtime `registry-probe` diffs against the live app. Upgrade impact becomes a report, which is strictly better than today's silent version drift (`dataContext` 7-vs-8 is already live in two places) |
**The 0.45 pin ages / 0.46 lands** | The pin *is* the mitigation — versioned registries per release, exactly as `shesha-developer-0-43` already does for skills. This is the same pattern you already validated |
**T5 (visual) stays unreliable** | Anchor-validation gives a per-model pass/fail on judge competence (measured spread 100% vs 35%). If no available model passes the anchor test on your designs, T5 stays advisory and visual sign-off stays human — state that honestly rather than pretending the gate works |
**Reward hacking as artifacts scale** (~27pp per 10× size) | Sealed suite + published judge–truth gap. Assume measured pass rates overstate truth and size the tolerance accordingly. No known mitigation fully closes this — more tests and more search both sometimes made it *worse* — so the defence is measurement, not confidence |
**Team adoption** — a new IR is a new thing to learn while a deadline runs | Sequencing protects this: Phase 0 improves the current pipeline for everyone in 3 days; the decompiler means nobody hand-writes SFS from scratch (they edit a decompiled precedent); and the current pipeline keeps working throughout — Phases 1–3 are additive |
**This whole document is wrong about the cause** | Phase 1 is a one-week, three-arm, harness-measured experiment with a stated numeric gate. If arm B doesn't clear it, you have spent a week and learned the most important thing available to learn |
**Optimism bias in my own estimates** | Discount them. The METR RCT is the calibration: experienced developers using AI assistance were **19% slower** while believing, afterwards, that they had been 20% faster. Treat the token savings in §7 as hypotheses the harness will grade, not as results |

---

## 9. Decisions I need from you

1. **Approve Phase 0 immediately?** It is 2–3 days, strictly improves the current pipeline, and is a prerequisite for measuring anything. Independent of the bigger decision.
2. **Fund Phase 1 (one week) as the go/no-go?** This is the whole bet, compressed into a week with a numeric gate. I would not commit to Phases 2–4 without it.
3. **Who owns the registry?** It is the keystone. If it drifts, everything above it drifts. My suggestion: it belongs with whoever owns Shesha framework releases (Mvelo's NuGet/manifest work is the analogous backend problem), with the extractor in CI on the framework repo's release branch.
4. **Where does SFS live?** Its own repo/package (versioned per Shesha release, consumable by Claude Code, Copilot, the SAA harness and any local model) or inside `shesha-plugins`? I recommend its own package — the plugin becomes a thin client, and that is what makes it distributable.
5. **Do you want the 13 contradictions resolved by decision or by measurement?** Six of them (reflist name format, `refListStatus` shape, `editMode` on create/edit, the `formArguments` hook, `actionOwner` casing, `columns`) are empirical questions with one right answer that a 30-minute probe against a live backend would settle permanently. Worth doing in Phase 0 and writing into the registry rather than into prose.

---

## Appendix A — Local GPU: what your RTX 4050 is genuinely good for

You have real options here, but the honest framing matters: a laptop 4050 is ~6 GB VRAM. That rules some things in decisively and others out.

**Highest value, do these — all comfortably within 6 GB:**

1. **The whole compiler and verifier stack needs no GPU at all.** Node/Python, milliseconds, runs on any laptop and in CI. This is where most of the quality comes from, so the GPU is a bonus, not a dependency.
2. **Precedent RAG embeddings.** A 100–400M embedding model (bge-small / gte-small class) indexes your entire decompiled form corpus in minutes and queries in milliseconds, in well under 1 GB. This is the single best use of the card, and it is the piece that makes 768-byte specs reliable.
3. **A distilled verifier.** The strongest published result for pushing verification off frontier models: a **400M cross-encoder distilled from a verifier ensemble retained 98.7% of accuracy at 99.97% fewer FLOPs**. Training a 400M cross-encoder on your own accept/reject decisions is a genuinely good fit for a 4050 — hours, not days. Your training data is the harness's own history: every T1–T4 verdict paired with the artifact.
4. **Local small-model DSL emission (arm C of Phase 1).** A 7B at 4-bit is ~4.5 GB and fits, if slowly. Grammar-constrained emission of SFS is exactly the task where 7–12B open models were measured matching much larger ones. Use `llama.cpp`/Ollama + a GBNF grammar generated from the SFS JSON Schema. Expect it to be viable for *routine* screens, not hard ones — which is the correct division of labour anyway.
5. **A local VLM as a cheap first-pass visual screen.** A 2–3B VLM at 4-bit fits and could pre-screen screenshots for gross regressions (blank panel, unstyled default, obvious overlap) before a frontier VLM is spent. Treat as an experiment: it must pass the **anchor test** before it is allowed to gate anything, and on the published evidence a 3B model probably will not — but a pre-screen that only ever *escalates* is safe even when weak.

**What to rent rather than run locally:**

- **QLoRA fine-tuning a 7B** on SFS emission. At 6 GB this is borderline-painful (4-bit + gradient checkpointing + short sequences); a few hours on a rented 4090/A100 costs less than the time lost. Then run the resulting adapter locally. The BMW result — 7B + QLoRA reaching 1.000 structural fidelity and 100% valid JSON on a real DSL — is the target to aim at, and it is a *fine-tune*, not a frontier-model result. **But note the sequencing: you cannot fine-tune on a defective corpus.** The decompiler (Phase 2) is what creates trainable data. Fine-tuning is a Phase 5+ option, not an early shortcut.
- Anything needing long context or >13B parameters.

**A caution on the training instinct.** Fine-tuning is attractive and is genuinely the endgame for cost, but it is the *last* lever, not the first. Every point of quality available from normalisation, a compiler, and executable gates is available without any training at all, is deterministic, and does not need re-earning on the next Shesha release. Train once the corpus is clean and the eval is trustworthy — otherwise you will be measuring a fine-tune with instruments you already know to be broken.

---

## Appendix B — Evidence index

**Measured by me on your artifacts** (reproducible: repo at `claude/team-standup-4e3e21`, Node 22): form decomposition and the eight golden-reference defects · skill/reference/asset byte census · the 13 contradictions verified against shipped assets · `validate-blocks.js` 0 fails / 136 warns and the maximally-bad-block pass · `summarize.js` ESM failure · `bake-overlays.mjs` write-despite-`$role`-failure · `verify-artifact.mjs` zero-coverage and walker holes · `check-references.mjs` vanishing-family hole and coverage non-reconciliation · overlay hex-vs-`$role` census (48 vs 10) and the LandBank re-bake · `@shesha-io/reactjs@0.45.1` npm mining feasibility.

**External sources.** Constrained generation: JSONSchemaBench (arXiv 2501.10868, ICLR-accepted) · "Let Me Speak Freely?" (arXiv 2408.02442, EMNLP 2024) · Structured Output Control for SE (arXiv 2606.09395) · "From Text to DSL" (arXiv 2605.15865) · "Notation Matters" (arXiv 2605.29676). IR/compiler: BMW multi-file DSL case study (arXiv 2604.24678) · Joshi, "DSLs Enable Reliable Use of LLMs" (martinfowler.com, 2026-07-14, *qualitative only*) · Design2Code (NAACL 2025) · UI2Code^N (arXiv 2511.08195). Verification: Weaver (NeurIPS 2025, arXiv 2506.18203) · "Trust but Verify!" survey (arXiv 2508.16665) · "More Convincing, Not More Correct" (arXiv 2607.05904) · SpecBench (arXiv 2605.21384) · "LLMs Cannot Self-Correct Reasoning Yet" (ICLR 2024) · MobileForge (arXiv 2607.28645) · UI2App (arXiv 2607.06306) · WebVR (arXiv 2603.13391) · "Coding with Eyes" (arXiv 2604.19750). Agents/context: Anthropic harness design for long-running apps (2026-03-24) · effective context engineering (2025-09-29) · skill authoring best practices · Agent Skills (2025-10-16) · code execution with MCP (2025-11-04) · advanced tool use (2025-11-24) · multi-agent research system (2025-06-13) · Chroma "Context Rot" (2025-07-14) · IFScale (arXiv 2507.11538) · SkillReducer (arXiv 2603.29919). Eval: "Who Validates the Validators" (UIST 2024) · Rigorous Agentic Benchmarks / ABC (arXiv 2507.02825) · "Beyond Pixel Diffs" (arXiv 2607.01728). Cost: Anthropic prompt caching / batch / pricing docs · RouteLLM (LMSYS 2024, *method sound, percentages stale*) · METR developer RCT (2025-07-10).

**Where the evidence is thin — stated plainly.** (1) There is **no published head-to-head** of "IR + compiler" versus "direct target-JSON generation" for UI/config artifacts; the case here is inferential, which is exactly why Phase 1 exists. (2) Hook-based enforcement versus prompt-based instruction is **architecturally sound but empirically unmeasured** — practitioner blogs only. (3) Figma-to-code and low-code AI accuracy claims are **vendor-blog territory with nothing independent**; I excluded them. (4) Much of the strongest 2026 material (UI2App, MobileForge, WebVR, SpecBench, the judge-hacking paper, SkillReducer) is **arXiv preprint, not peer-reviewed** — mutually corroborating across independent groups, which raises confidence, but treat specific numbers as provisional. (5) Reward hacking as artifacts scale has **no known working mitigation** — measurement is the only defence on offer.

---

## Appendix C — What SFS would look like, concretely

This is the whole of `bookings-table` as a spec. It replaces 19,170 bytes of markup with **~900 bytes of intent**, and every one of the eight defects in §1.1 is unrepresentable in it.

```yaml
form: bookings-table
module: boxfusion.test
kind: list                      # ⇒ compiler emits list formSettings; no submit pipeline, no formArguments hook
entity: boxfusion.test.Domain.Domain.Bookings.Booking
label: Bookings
description: All flight bookings. Row opens the detail page; Add opens the create dialog.
access: authenticated

page:                           # ⇒ page-shell recipe: card + hideHeading + sha-page on ALL breakpoints, no stray label, no 30px height
  title: Bookings
  subtitle: All flight bookings

data: bookings                  # ⇒ dataContext v8, entityType from `entity`, paging, pageSize 10

  toolbar:                      # ⇒ flex container row, space-between, gap 16
    responsive: { stack: below-tablet }
    fill: quickSearch           # ⇒ calc(100% - 196px) desktop, 100% tablet/mobile — arithmetic by compiler
    fixed:
      actions: 180px
    actions:
      - button: Add booking
        style: primary
        icon: PlusOutlined
        do: openDialog
        form: boxfusion.test/booking-create
        title: New booking
        width: 60%
        onSuccess: refresh(bookings)      # ⇒ actionOwner = the dataContext id, resolved at compile time

  table: bookings
    freezeHeaders: true
    inline: none
    columns:                    # propertyName validated against entity metadata; camelCased by compiler
      - bookingReference as "Reference"   width: 140  min: 130
      - passengerName    as "Passenger"               min: 180
      - origin           as "From"        width: 150  min: 120
      - destination      as "To"          width: 150  min: 120
      - departureDate    as "Departure"   width: 150  min: 130
      - cabinClass       as "Cabin"       width: 150  min: 130
      - status           as "Status"      width: 150  min: 130
        render: statusBadge(boxfusion.test/BookingStatus, solid)
    onRowClick: navigate(boxfusion.test/booking-details, id: row.id)   # ⇒ ONE wiring, not three
    surface: card               # ⇒ $role:cardBg / $role:hairline / radius / shadow from the active brand

  pager: below
```

Read what the compiler is now responsible for, none of which the model touches: 12 opaque ids · 12 `parentId` links · 8 distinct version integers from the registry · 33 breakpoint blocks derived from one `responsive:` line · the `calc(100% - 196px)` arithmetic · `card` children into `content.components` · the `[not-editable]` edit/create component triplets on all 7 columns · `refListStatus` v6 settings in the canonical shape · `actionOwner` resolved to the dataContext's generated id with correct lowercase and spaced action names · `formSettings` appropriate to `kind: list` · brand roles resolved to the active token file · escaping of `Markup` into a JSON string · the 23-field envelope.

And read what a reviewer — human or model — can now actually check by eye: the entity, the seven columns and their captions, the two navigation targets, one responsive rule, one status reference list. That is the entire design decision surface of the screen, on one page, in a form where "what did this change?" is answerable from a diff.
