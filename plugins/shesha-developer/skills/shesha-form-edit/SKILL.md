---
name: shesha-form-edit
description: EXECUTION LAYER under shesha-claude-designer (the main entry for all designer work — enter there first). The build executor of the v2 compiler pipeline — compiles a blueprint IR (or a spec synthesized from prose requirements) into markup through golden archetypes and the measured capability matrix, gates it mechanically (schema → guardrails → bindings → styled-ness), pushes via Create/UpdateMarkup, and verifies the deliverable (re-fetch diff + render instrument). Invoke directly for targeted work when dispatched by the main skill or when the user names a specific form and edit ("add a sector dropdown above the email field", "wire the Save button"). 0.45-only — versioned 0.43-class backends belong to the shesha-developer-0-43 plugin. Always prefer this skill over the `shesha-forms` MCP path, which is no longer developed. Styling is a compile-time input, never a second pass — the default `shesha` theme is baked into every node at compile, so no form ships unstyled.
allowed-tools:
  - Bash
  - PowerShell
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - WebFetch
  - Skill
  - Task
---

# Shesha Form Edit (v2 — 0.45 only)

The model does two things: **understand the requirement** and **make design
judgments**. Everything else is a script with a machine-checkable contract.
Mechanical facts live ONCE in [references/_rules.json](references/_rules.json)
— docs and validators cite `[R-xxx]`; when prose and the registry disagree, the
registry wins.

```
SPEC (blueprint IR) → COMPILE → GATES (hooks) → STYLE → PUSH → ORACLE → REPORT
```

Args: `$ARGUMENTS`. Flags: `--no-browser` (skip the render instrument),
`--no-style` (skip the default-theme pass — the only thing that skips it).

> **For any new table / list / create / detail form, start from a seed — never hand-author structure a seed already provides.** ONE priority order, always: **`assets/exemplars/` first** (small, validator-clean, one per archetype) → **`assets/blocks/`** (compose small vetted blocks when no exemplar fits) → **`assets/examples/`** (the fuller CRUD-loop seeds, fallback when neither above has the shape). Full index + the swap-these-fields checklist: [references/examples.md](references/examples.md). A "**table**"/grid request builds a `datatable`; a "**list**"/cards request builds a `datalist` — different components, pick from the user's wording ([data-tables.md](references/components/data-tables.md)). These seeds are real Shesha-standard forms (verified rendering against a live backend, or curated from graded production markup) and encode the CRUD wiring most models get wrong: the **Add button opens the create form in a modal** (`Show Dialog`), detail views toggle edit in place (`Start Edit`/`Submit`), child tables use `tabs` + a `permanentFilter` on `{{data.id}}`, and inputs are chosen by the property's data type ([by-datatype.md](references/components/by-datatype.md)). Copy the matching seed, swap entity/properties/captions/`formId`s, re-stamp `parentId`s, push.

> **Building a form to match a design?** If the requirements arrive as a **layout blueprint** (`<screen>.blueprint.json` from `shesha-developer:shesha-design-comprehension`, usually via the `shesha-claude-designer` orchestrator), this is a **compile, not an authoring task** — run `node scripts/compile-spec.mjs <screen>.blueprint.json --out <form>.json` then `node scripts/validate-form.mjs <form>.json`. No hand-translation of `layout-tree`/`bindings` into components: the compiler resolves the archetype's seed shape, the flex-container splits, the `parentId`s, and the `propertyName`s from the blueprint directly. Full contract (what it owns, what it doesn't, the acceptance property): [references/compiling.md](references/compiling.md). Then expect a placement re-measure — the orchestrator's gate 5a.5, now `verify-placement.mjs`'s exit code — against the blueprint's `assertions`. Field-mapping reference / troubleshooting a compile failure: [references/blueprint-consumption.md](references/blueprint-consumption.md). (The retired field-validated toolchain — `compile-blueprint.js`, the Markdown+twin blueprint format — is documented in `../shesha-claude-designer/README.md`'s "One compiler, two open questions" section for historical/troubleshooting reference only; it is not the build path.)

## Headless runs

When invoked non-interactively or with a supplied context block (Backend URL /
credentials / Module / Working dir): never call `AskUserQuestion`; the context
block overrides discovery. Missing form identity → resolve from the module's
form list, else create `{entity-kebab}-{type}` in the context module. Always
end with a summary naming every form created or modified (module + name + id)
— and a form is only "created" once the ORACLE step passes [R-046].

## 0 · Route

- **0.43-class backend detected** (`versionStatus` on GetByName, flat-prop
  markup)? Stop — that's the `shesha-developer-0-43` plugin. See
  [references/versioning.md](references/versioning.md).
- **Pure styling request** → `shesha-developer:shesha-design-system`.
- **Small edit to an existing form** (add/move/rewire a few components): skip
  the compiler; fetch → edit in place (preserve ids [R-025]) → GATES onward.
- **New form(s) or a structural rebuild**: full pipeline below.
- **2+ forms** → [references/orchestration.md](references/orchestration.md)
  (fan out `form-author` agents; ONE `fleet-transformer` for bulk mutations).
- **Backend prerequisites in doubt** (new entity, missing reflist/endpoint) →
  dispatch `fullstack-prereq-checker` first; plan backend changes in one
  build + double-boot [R-040].

## 1 · Pre-flight (once per session)

[references/contracts.md](references/contracts.md) has the exact recipes:
pin one shell, one `<workdir>`, resolve the backend URL, authenticate once
(cache the token BOM-free [R-027]), resolve the module id. API routes are per
service — never guessed [R-026]: [references/api.md](references/api.md).

Backend URL resolution order: **task-supplied context block (always wins)** → **`SHESHA_BACKEND_URL` environment variable** (sandboxed/ephemeral environments where the backend runs in a separate process or pod, not at `localhost`) → `src/*.Web.Host/Properties/launchSettings.json` (`profiles.Project.applicationUrl`) → `src/*.Web.Host/appsettings.json` (`Kestrel:Endpoints:Http:Url`) → fallback `http://localhost:21021`. Strip trailing slash. Store as `$BASE_URL`. Ping `$BASE_URL/swagger/index.html` to confirm reachability; if it fails, stop and tell the user to start the backend.

- **A small edit** (one component / property / script / action on an existing form) → stay inline, do **1 · Pre-flight** through **4 · Gates** only, skip the design pass, and only do the browser-verification layer of **6 · Push + Oracle** if the change is visual/behavioral. Keep it cheap — don't run the full pipeline for a one-line tweak.
- **One whole form** (table / list / create / details / dialog / subform) → inline, full **0 · Route** through **7 · Report**, seed-first (exemplars → blocks → examples, see line above). ("table"/grid → `datatable`; "list"/cards → `datalist`.)
- **Backend prerequisites may be missing** (entity / property / reflist / API / menu item) → gate on the entity-binding check below (`scripts/backend-probe.mjs`) — or the `fullstack-prereq-checker` agent — and fix gaps via the owning sibling skill BEFORE writing form JSON.
- **Multiple linked pages, or a whole app from a brief** → don't build it all in one context: plan first, then build in waves (create → details → table, then cross-link), orchestrating with `superpowers:dispatching-parallel-agents`. State the rough cost up front. See [orchestration.md](references/orchestration.md).

For entity-bound work run `scripts/backend-probe.mjs` — one probe returns
entity resolution, metadata, and reflist existence
([references/entity-binding.md](references/entity-binding.md)).

## 2 · Spec — no spec, no build

Every build has a spec: a **blueprint IR** JSON
(`shesha-design-comprehension/assets/blueprint.schema.json`).

- Design-driven work arrives with one (from `shesha-claude-designer` /
  `shesha-design-comprehension`) — consume it as-is.
- Prose requirements: synthesize the blueprint yourself — screen, entity
  (fullClassName + `{name,module}` modelType resolved live [R-016]), form
  identity, archetype, layout tree, bindings. "list"/cards → `datalist`;
  "table"/grid → `datatable` [R-019]. This is the judgment step: get the
  archetype and the layout tree right here, not in JSON surgery later.

Archetypes: `references/archetypes.md`'s single eight (table-worklist ·
record-detail · capture-dialog · standalone-capture · list-card · hub ·
dashboard · wizard). Golden/exemplar files are compiler fixtures — grep
fragments, never read one whole [R-050].

## 3 · Compile

```
node scripts/compile-blueprint.js --blueprint <bp.json> --out <workdir>/<form>.json
```

The compiler types the JSON: flex containers with `desktop.dimensions.width`
[R-028/R-029], by-datatype components, live reflist identities [R-015],
`dataContext` v8 wrappers [R-005], the validationErrors + Submit/exit floor
[R-006/R-007/R-020], KB versions [R-003], deterministic ids.

Hand-composition is the exception (no archetype fits, exotic component mix) —
note WHY in the push ledger, compose from `assets/blocks/` +
`assets/components-kb/` quick shapes, and expect the same gates. Component
shapes and per-type recipes: [references/components/](references/components/)
(routed by `scripts/lookup.js` — run it for every component type you author;
a no-hit is a gate violation).

## 4 · Gates (hooks — not optional)

Every markup write triggers the validate-on-write hook; run them yourself
before push in any case, cheapest first:

```
node scripts/validate-schema.js <form.json>       # known types, id/version shapes
node scripts/validate-guardrails.js <form.json> [metadata.json]   # render-killers, cites [R-xxx]
node scripts/resolve-bindings.js <form.json>      # live: properties, dotted paths, reflists, endpoints
node scripts/validate-styledness.js <form.json>   # structure-only forms are defects [R-042]
```

Entity-bound forms MUST pass `resolve-bindings.js` (live backend) before push.
Fix findings by rule id; never bypass a gate. JSON-safety for embedded scripts:
[R-013] + [references/components/scripts.md](references/components/scripts.md).

Compiled output carries the same acceptance property the compiler is judged
against — **run the combined validator too** (mandatory, blocking):
`node scripts/validate-form.mjs <form.json>`. It exits 0 only when there are
zero Tier 1 (renderability) and zero Tier 2 (construction-contract) findings;
Tier 3 (appearance) is reported but never blocks. Full code list + which ones
actually block a push: [references/push-hook.md](references/push-hook.md) —
these checks also run automatically, post-normalize, in the `PreToolUse` hook
on every `UpdateMarkup`/`ImportJson` call, so running it yourself first is a
chance to see and fix a finding before the hook denies the push. **Never push
a config that fails validation without user confirmation.**

Then run the **[form-quality checklist](references/form-quality.md)** —
human-readable labels, dropdown sources complete, primary action visible,
consistent layout (the parts of "is this a good form" the validator doesn't
check structurally).

Then **invoke `clean-form-config` ONCE, right before the final push**
(mandatory, blocking) — covers layout overflow, label-vs-propertyName refs,
missing try/catch, missing async, broken script syntax:

```
Skill(skill="shesha-developer:clean-form-config", args="<path to your edited form>")
```

**Run it once on the finished markup — not after every intermediate edit**
(re-running it per change is a large, repeated cost for no extra signal).
**Known false positives — don't re-investigate or strip these:** the
`dataContext` data props (`entityType`, `sourceType`, `dataFetchingMode`,
`defaultPageSize`, …), container `direction`/`flexDirection`, `text.padding`,
and the datatable inline props (`canEditInline`/`canAddInline`/`canDeleteInline`/
`inlineEditMode`/`inlineSaveMode`) are valid and render in live forms; the
bundled index just doesn't enumerate them.

**Before any bulk push (>3 forms changed): fan out `shesha-developer:form-auditor`
agents — one per form** — with the verdict contract from
[orchestration.md](references/orchestration.md); aggregate and never push a
form with a `fail` verdict.

## 5 · Style — compiled in, not a second pass

Design is a **compile-time input**: `compile-blueprint.js --theme <brand>`
(default `shesha`) resolves brand colour, type scale, radius, spacing and
borders from `shesha-design-system/assets/themes/<brand>.tokens.json` and bakes
them into every node, so the first output is already on-brand [R-042]. No
separate styling pass is needed for a compiled form.

Two things still route to `Skill(shesha-developer:shesha-design-system)`:
- **the one-time app AntD theme** (`$antdTheme` — input/table/button chrome), set
  once per app, not per form ([references/app-theme via design-system]);
- **re-styling a form you did NOT compile** (a hand-composed form, a small edit,
  or matching a brand that has no token file yet).

Either way **you still own push + verification**. `--no-style` / an unknown
theme falls back to neutral tokens.

## 6 · Push + Oracle

Push: **UpdateMarkup** (default, existing form) — `PUT
$BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup`, body
`{ "id": "$FORM_ID", "markup": "<stringified form JSON>" }` — or **Create**
(`POST FormConfiguration/Create`, new form). Alternative: **ImportJson** —
multipart upload (`ItemId` + `file`). Both write `Markup` on the form
configuration. Build the body in Node to avoid escaping pain. See
[references/api.md §5-6](references/api.md). Record every form in the push
ledger (`.claude/cache/shesha-form-edit/push-ledger.json`); the Stop hook
blocks session end while any entry is unverified [R-046].

**Scratch-script hygiene (avoids a recurring time-sink):** write build/push
scripts and staged JSON into the **supplied working directory**, NOT `/tmp` —
git-bash `/tmp` maps to `%TEMP%` (e.g. `C:\Users\…\AppData\Local\Temp`), which
is a *different* path than Windows `C:\tmp` and from PowerShell `$env:TEMP`,
so a file written by `bash` is frequently "not found" by `node`/PowerShell.
Pass values into Node via **env vars** (`VAR=x node script.js`), not
positional argv that the shell may not forward. Prefer **one combined
fetch→mutate→push script** over many small probe commands (each round-trip
is cost). Success: HTTP 200 with `{ "result": ... }`.

**On push failure (any non-200):** (1) surface the raw response and a short
diagnosis; (2) ask the user via `AskUserQuestion`: **retry as-is** /
**re-fetch and re-apply** / **abort**; (3) act on the choice. **Never
silently retry. Never just stop.**

**Publish (Draft → Live)** before anything below re-probes the form: `PUT
ConfigurationItem/UpdateStatus` with `{"filter": "{\"==\":[{\"var\":\"id\"},\"<form-guid>\"]}",
"status": 3}`. On mutable 0.45 test builds this may 404 — that's expected
(the form is already effectively live), not a failure; don't retry it or
block on it. On a versioned backend it is required — a placement probe
against an un-published Draft measures nothing. Full model:
[references/renderer-physics.md](references/renderer-physics.md#publish-model).

The oracle judges the deliverable through four fail-closed layers — a green
render alone never means done. Full model: [references/quality-gates.md](references/quality-gates.md).
1. **Re-fetch + diff** — via `GetByName`/`GetJson`; the pushed markup equals
   what you sent — a 200 alone proves nothing [R-047]
   ([references/verification.md](references/verification.md)). Surface any
   normalization the server applied. For anonymous forms (`access: 5`),
   confirm `result.access === 5` — the `Create` endpoint may not honor
   `access` on initial create; call `UpdateMarkup` once more if it didn't
   stick.
2. **Render instrument** (objective, unless `--no-browser`):
   `node scripts/render-instrument.js --form <module>/<name>` — navigate, probe,
   screenshot, console/network dump, binding smoke, and layout-quality checks
   (stacked splits, collapsed inputs/buttons, overflow). Exit ≠ 0 → fix and
   re-run. Frontend URL: `adminportal/` (auth forms) or `publicportal/`
   (anonymous) — read the dev port from `<app>/.env*` or `<app>/package.json`;
   if neither is running, skip this layer and warn the user. Test `*-details`
   forms via the **table row's view link**, never a pasted `?id=` URL —
   direct loads render but subtable Add/Create submits 500 (missing page
   context). If the browser disagrees with a verified API re-fetch, clear the
   **IndexedDB form cache from `/favicon.ico`** before debugging further. On
   any captured error or 4xx/5xx, consult
   [references/debug.md](references/debug.md) before guessing — it maps ~40
   symptom rows to causes and fixes; quote the captured error verbatim and
   cite the matching row number.
   **Verification cost discipline (this is where runs blow up — keep it
   tight):** assert with the **a11y snapshot** +
   `getBoundingClientRect`/`getComputedStyle`, **not screenshots** (take at
   most ONE, at the very end, for a final visual confirmation); **batch all
   DOM measurements into a single `evaluate` call** rather than climbing the
   tree across many calls; check whether the layout question is already
   answered by a documented recipe (full recipes:
   [references/verification.md](references/verification.md)) before reaching
   for the browser at all.
3. **Placement diff** (intent) — blueprint builds re-probe against the
   blueprint's `assertions`; this is what catches "the layout I intended didn't
   happen" (comprehension owns it).
4. **Design-critic** (visual quality, MANDATORY) — dispatch the
   `design-critic` agent with the screenshot + assertions + theme tokens; it
   returns a strict verdict (per-assertion, styled-ness, top-3 fixes). The
   build is NOT done until the critic PASSes (styled ≥ acceptable). A green
   render-instrument does not substitute for it.

**Optional 5th layer — aesthetic review (ask first, non-blocking).** If a
design source exists for this form, you MAY ask the user via
`AskUserQuestion` whether to run one further post-render pass via
`frontend-design`, comparing the screenshot against the design source and
returning up to 5 prop-level tweaks as **suggestions, not blockers**
(accept/reject per item). This is separate from — and never a substitute
for — the mandatory design-critic layer above; skip it entirely when
`--no-design` is passed or no design source exists. Recipe:
[../shesha-design-system/references/design.md](../shesha-design-system/references/design.md).
On any accepted tweak, loop back to **5 · Style** (re-touch the token/role
input, recompile if the tweak is structural) then **6 · Push + Oracle**.

## 7 · Report

One summary: every form (module + name + id), archetype used, gate results,
oracle verdict, ledger state. Authenticated forms render at
`/dynamic/<module>/<form>`; anonymous at `/no-auth/<module>/<form>`.
Anything unverified is reported as UNVERIFIED, never as done.

## Reference map

| Topic | File |
|---|---|
| **Building from a blueprint — the compiler contract (one-command path, what it owns, acceptance property)** | [references/compiling.md](references/compiling.md) |
| Form structure, skeleton, IPropertySetting wrapper | [references/components/form-shape.md](references/components/form-shape.md) |
| Inputs, validation, file uploads | [references/components/inputs.md](references/components/inputs.md) |
| Dropdowns / radio / checkboxGroup / refListStatus | [references/components/dropdowns.md](references/components/dropdowns.md) |
| Autocomplete, entityPicker | [references/components/selectors.md](references/components/selectors.md) |
| Containers, card, **flex-row splits**, tabs (structure only — appearance → `shesha-design-system`) | [references/components/containers.md](references/components/containers.md) |
| Buttons, links, subForm, action wiring | [references/components/actions.md](references/components/actions.md) |
| Datatable (table/grid) vs datalist (card list), dataContext — incl. the **table-vs-list** decision | [references/components/data-tables.md](references/components/data-tables.md) |
| Component selection by property data type | [references/components/by-datatype.md](references/components/by-datatype.md) |
| Child tables on a detail view (tabs + permanentFilter) | [references/components/child-tables.md](references/components/child-tables.md) |
| **Block library — compose small vetted blocks (do this BEFORE copying a seed)** | [references/block-library.md](references/block-library.md) |
| Canonical example seeds (fallback when the block library lacks a shape) | [references/examples.md](references/examples.md) |
| Embedded scripts, current user, async/try-catch | [references/components/scripts.md](references/components/scripts.md) |
| Shared state (appContext, pageContext) | [references/components/shared-state.md](references/components/shared-state.md) |
| editMode, visibility, permissions | [references/components/edit-mode.md](references/components/edit-mode.md) |
| **Visual styling / appearance** (surfaces, shadows, layering, v7 style blocks, theme) | **do NOT read during a structural build — call `Skill(shesha-developer:shesha-design-system)`** |
| Layout pattern (full-page forms, auth) | [references/components/layout.md](references/components/layout.md) |
| Detail page **structure/nav** anatomy (sections, label grid, table→row nav) — *appearance of it (header band, KIB styling) → `shesha-design-system`* | [references/components/detail-page-pattern.md](references/components/detail-page-pattern.md) |
| M:M junction subtables — link, drill-down, delete/unlink | [references/components/junction-subtables.md](references/components/junction-subtables.md) |
| Related-panel rail structure (header re-parenting, live count wiring, segmented-toolbar construction) | [references/components/related-panels.md](references/components/related-panels.md) |
| Add/create dialogs, formArguments, onPrepareSubmitData | [references/components/add-dialogs.md](references/components/add-dialogs.md) |
| Inline-editable datatables (editComponent shape, crud-operations column) | [references/components/inline-editable-tables.md](references/components/inline-editable-tables.md) |
| Form quality contract (always-on construction rules) | [references/form-quality.md](references/form-quality.md) |
| Adding forms to the app navigation/menu | [references/navigation-menu.md](references/navigation-menu.md) |
| Edits across many forms (pilot-first transforms) | [references/bulk-operations.md](references/bulk-operations.md) |
| Multi-agent fleet dispatch, verdict schemas, cost table | [references/orchestration.md](references/orchestration.md) |
| Browser testing, IndexedDB cache, layout measurement | [references/verification.md](references/verification.md) |
| Symptoms whose fix is backend (reflists, junction DTOs, GQL) | [references/full-stack-prereqs.md](references/full-stack-prereqs.md) |
| Rebuild + restart the backend after a domain change (entity/migration) | [references/backend-restart.md](references/backend-restart.md) |
| Ground-truth rerun (regenerate the KB/schema/measured-capability-matrix for the field-validated toolchain) | [references/gym.md](references/gym.md) |

**Touching more than ~3 forms?** Read [references/bulk-operations.md](references/bulk-operations.md) first — pilot-first is mandatory. Mutations go through **one `shesha-developer:fleet-transformer` agent** (never per-form authoring agents); audits fan out **one `shesha-developer:form-auditor` per form**. Dispatch templates + cost table: [references/orchestration.md](references/orchestration.md).

**Authoring 2+ genuinely distinct new forms?** Dispatch one `shesha-developer:form-author` agent per form in parallel (each gets the seed, metadata, requirements, and an output path); you audit and push centrally afterwards. A single new form stays in-context.

**Read [references/component-cheatsheet.md](references/component-cheatsheet.md) FIRST** — it has the current per-component `version` + minimal shape, so you don't burn round-trips probing for versions or read multi-thousand-line seeds. **Never read a large seed wholesale** (`assets/golden/standalone-capture--employee-create.json`, `assets/golden/capture-dialog--rs-create-dialog.json`, etc. can run thousands of lines — that's tens of thousands of wasted tokens); open them only with `Grep`/offset for one specific fragment. Prefer the small/lean seeds — every `assets/exemplars/` form is under ~400 lines by construction; among `assets/golden/`, prefer `table-worklist--inline-editable-table.json`/`standalone-capture--standalone-create.json` over the multi-thousand-line ones.

**Seed discovery for new forms** — ONE priority order (full detail + swap-fields checklist: [references/examples.md](references/examples.md)):
0. **`assets/exemplars/` — small, validator-clean, one form per archetype.** Check here FIRST for any table/list/create/detail shape — these are curated, normalized, and pass the push-hook gate outright. Copy whole; they're short enough to read in full.
1. **`assets/blocks/` — the BLOCK LIBRARY (compose, don't copy-a-seed)** when no exemplar covers the shape you need. Build the form by composing small, individually-validated blocks (`flex-split-main-rail`, `page-header-band`, `meta-strip`, `card-with-header-strip`, `rail-panel`, `rail-label-value-row`, `status-pill`, `completeness-bar`, `requirement-datalist-row`, `dashed-add-button`) — assembly workflow in [references/block-library.md](references/block-library.md). Each block is a structure skeleton paired with a `shesha-design-system` style overlay and validated against the capability matrix (`scripts/validate-blocks.js`).
2. **`assets/examples/` — the fuller CRUD-loop seeds (fallback when neither above has the shape).** See [references/examples.md](references/examples.md) for the index and the CRUD-loop wiring (modal Add button, Start Edit/Submit detail header, child-table tabs). Copy the matching example and change only `modelType`/`entityType`/`propertyName`/captions/`formId`s. **Prefer the small/lean seeds; never read the multi-thousand-line ones in full.**
3. `.claude/cache/shesha-form-edit/seeds/` — project-specific forms cached from prior edits.
4. **DEPRECATED, last resort only — MCP `search_forms`.** The `shesha-forms` MCP path has stopped receiving development; only reach for `mcp__shesha__search_forms` when every tier above (0–3) has genuinely nothing usable and a live backend is the sole remaining source of a matching layout. Cache anything you pull under `seeds/` so tier 3 covers the next request instead.
5. Author from scratch only if no seed fits — guided by the requirement directly (there is no separate design-plan step; see `0 · Route`/`2 · Spec`).

**Picking the input component for each field** — driven by the property's `dataType` (string→textField, number→numberField, date→dateField, reference-list-item→dropdown, entity FK→autocomplete, …). Full table + config in [references/components/by-datatype.md](references/components/by-datatype.md).

**Proactive doc fetch**: when the user's requirements mention non-trivial mechanisms (wizard, OTP, navigator, complex appContext composition, custom action chaining), `WebFetch` the relevant `shesha-grads.vercel.app` / `docs.shesha.io` page **before** writing scripts. Distill into `.claude/cache/shesha-form-edit/docs/<topic>.summary.md` (~30 lines) so subsequent edits don't re-fetch.

**Component plan + registry check (mandatory, blocking — before writing any component JSON)**:

1. **List every component `type` you plan to use.**
2. **Look each one up in `assets/registry/registry-0.45.1.json`** — the generated
   authority for types, props and versions ([component-registry.md](references/component-registry.md)).
   A type that is absent means you have the wrong name. A type with
   `authorable: false` must not be emitted — read `authorableReason` and pick the
   current equivalent.
3. **Take the `version` from the registry** and stamp it. `null` means the component
   has no migrator; omit `version` for those.
4. **Validate every prop against that type's `props` array.** Anything absent will be
   stripped at **4 · Gates**.
5. **Scan for a better fit** — e.g. `refListStatus` rather than `dropdown` for read-only
   status. For side-by-side layout use a flex `container` whose children are themselves
   `container`s, never the `columns` component (see the split rule below).

Tree-editing principles: preserve every existing component's `id` and `parentId` (fresh GUIDs only on clones / new nodes); when re-parenting, update only the moved node and add it to the new parent's `components`; don't touch `formSettings` unless asked.

**`parentId` is mandatory on every component** — the Shesha renderer crashes entirely when it's absent. Building from a blueprint: `compile-spec.mjs` stamps every `parentId` for you (`normalize-form.mjs` Phase B2 — root-level = `"root"`, else the parent's id); nothing to do by hand. Hand-editing: set it to the direct parent's `id` (root-level components get `"root"`; components inside a `columns` slot get the `columns` component's own `id`, not the slot's), then let **4 · Gates**' validator catch an omission (`T1-PARENT-MISSING`) before push. Full contract: [references/compiling.md](references/compiling.md).

## Cache (`.claude/cache/shesha-form-edit/`)

Project-scoped learning state. **Skill reads `.summary.md` by default; opens raw `.raw.json` only when summary is insufficient.** Layout: `metadata/`, `seeds/`, `docs/`, `_archive/` — see `.claude/cache/shesha-form-edit/README.md`. Populate via `node .claude/skills/shesha-form-edit/scripts/summarize.js <input.json> [--out <out.summary.md>]`. TTLs: metadata 24h; seeds invalidate on `versionNo` change. `--refresh-cache` ignores TTL.

## Non-negotiables

- **"list" → `datalist`, "table"/"grid" → `datatable` — build the component the user's wording names.** A "list of X" (or "cards", "feed", "tiles", "gallery") is a `datalist` (card view) — never a datatable, and **never** stacked static `container` cards. A "table"/"grid"/"spreadsheet" is a `datatable` (column grid). Honor the explicit noun even when the other would also render the data; for multi-select-from-a-list use `selectionMode: "multiple"` on the `datalist` (not a switch to a datatable). When the prompt names neither and the shape is genuinely ambiguous, **ask** before building. Decision table + both seeds: [data-tables.md](references/components/data-tables.md).
- **Every `propertyName` is camelCase — including datatable column `propertyName`s.** Entity GQL field keys are camelCase, but `Metadata/GetProperties` returns the `path` in PascalCase. A PascalCase column still fetches data + shows the right row count, but renders **blank cells** (the cell accessor reads the literal key). Lower-case the first letter (`ActionedBy`→`actionedBy`) — `compile-spec.mjs` does this for you (`leaf.mjs`'s `camelCase()`); hand-edits are caught by `T2-PROPERTYNAME-CASE`. **Datalist row-template cards** also have their own runtime rules (name-mode bound text, `dimensions: fit-content`, single-line `ellipsis` for long text, status chip on its own row, padding/overflow via the legacy `style` prop, card `height:"auto"`) — see [data-tables.md](references/components/data-tables.md).
- **`dataContext` (v8) is the data wrapper for `datatable`/`datalist`.** It's the universal wrapper — verified to render display tables, multiselect tables, datalists, AND inline-editable tables, and it reliably fires the entity data query. Wrap every `datatable`/`datalist` in a `dataContext` carrying `sourceType: "Entity"` + `entityType` (string) + the fetching props. The canonical seed `table-worklist--employee-table.json` uses it.
- **`dataContext` requires explicit `entityType` + `sourceType`** — it does NOT inherit from `formSettings.modelType`. A bare `dataContext` without these props causes HTTP 500 on page load. Building from a blueprint, `compile-spec.mjs`'s `datacontext.mjs` builder emits the full required set (`entityType`, `sourceType: "Entity"`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`) unconditionally — see [compiling.md](references/compiling.md) for the exact shape. Hand-editing one, match that same shape; `T2-DATACONTEXT-PROPS` catches an omission.
- **`id` must be a generated unique id (a UUID or a nanoid) — never a short placeholder; `parentId` set on every component.** Building from a blueprint, both are minted/stamped automatically (`normalize-form.mjs` Phase B — deterministic ids seeded from tree path, `parentId` from the walked tree, root-level = `"root"`). Hand-editing, use `crypto.randomUUID()`/`uuid.v4()` (short placeholders like `btn1` are NOT valid — the renderer ignores non-generated ids and the form renders blank) and set `parentId` to the direct parent's `id`. `T1-ID-EMPTY`/`T1-ID-DUPLICATE`/`T1-PARENT-MISSING` catch either omission at **4 · Gates**, and the push hook re-checks (post-normalize) on every push regardless.
- **Every authored component carries its component-type's current `version`** (an integer) — a component with no `version` is treated as `-1`, so the ENTIRE legacy migration chain re-runs on already-current data and a step can throw (`e.match is not a function`, `reading 'migrator'`/`'version'`), and a stale/too-low version can also SILENTLY DROP the component's `desktop` style block. Building from a blueprint, `normalize-form.mjs` Phase B3 stamps the current version straight from the registry (`assets/registry/registry-0.45.1.json`) — never hand-maintain a version list, the registry is the single source of truth. Hand-editing, look the type up in the registry or [component-cheatsheet.md](references/component-cheatsheet.md); `T1-VERSION-MISSING`/`T1-VERSION-STALE` catch an omission or a stale value.
- **`defaultValue` is a mustache-TEMPLATE STRING, never a literal non-string.** At render the value resolver does `defaultValue.match(/{{key.accessor}}/)` to detect templates. A literal **array** (e.g. a multi-select default `["a","b"]`), **number**, or **object** has no `.match` → **`e.match is not a function`**, and the component (often the whole form) fails to render. Allowed: a plain string (returned as-is when not a `{{…}}` expression) or a mustache string. For a multi-select default (checkboxGroup / multi-`dropdown`), do NOT set a literal-array `defaultValue` — bind the value through form data / the data loader, or omit it. `T1-DEFAULTVALUE-NONSTRING` catches a violation.
- **Datatable inline-editing column editors (verified shape):** an inline-editable `data` column's `editComponent`/`createComponent` MUST be either `{ "type": "[not-editable]" }` (read-only cell) OR `{ "type": "<editorType>", "settings": { <FULL component model: its own `type` + `version` + `editMode:"inherited"` + `hideLabel:true` + styling> } }`. **NEVER `{ "type": "[default]" }`** (only `displayComponent` resolves `[default]`; edit/create cells pass it straight to the component wrapper → `F6()["[default]"]` is `undefined` → `reading 'migrator'`), and **NEVER a FLAT model without the `settings` wrapper** (the cell wrapper reads `customComponent.settings`; flat → `undefined` → `reading 'version'`). Per-row Edit/Delete/Save controls require a `{ "columnType": "crud-operations", "sortOrder": -1, "itemType": "item" }` column, plus `canEditInline`/`canAddInline`/`canDeleteInline: "yes"` on the datatable. The compiler does not build inline-editable tables — this stays a hand-authoring concern. Full recipe + seed: [inline-editable-tables.md](references/components/inline-editable-tables.md). `T1-EDITCOMPONENT-SHAPE` catches the `[default]`/flat-model mistakes.
- **`checkboxGroup` hardcoded options use `items` (NOT `values`), each `{ label, value }`** — plus `version: 5`, `dataSourceType: "values"`, `referenceListId: null`, `container: {}`, `validate: {}`. (`dropdown`/`radio` use `values` with `{id,label,value}`; `checkboxGroup` is different — do not conflate.) The compiler doesn't populate dropdown/checkboxGroup data sources (that needs the real reference-list name) — this stays a hand-authoring concern. See [dropdowns.md](references/components/dropdowns.md); `T2-DROPDOWN-SOURCE` catches the shape.
- **CRUD wiring follows the canonical examples (`references/examples.md`), not ad-hoc navigation.** Building from a blueprint, the Add-button modal wiring and the Submit/exit pairing below are compiler-emitted (`actions.mjs`, completed against the archetype's flow manifest — [compiling.md](references/compiling.md)); the rest (Refresh/column-toggle, row→detail navigation) is not, and stays a hand-authoring concern either way:
  - **Table "Add" button** = a `buttonGroup` item with `buttonAction: "dialogue"`, `actionConfiguration.actionName: "Show Dialog"` (owner `shesha.common`), `actionArguments.formId: { name: "<create-form>", module: "<module>" }`, `modalWidth: "60%"`, `formMode: "edit"`. It opens the create form in a **modal** — verified to render the create form's fields inline. Do NOT make Add a Navigate.
  - **Detail-view lifecycle buttons** = a header `buttonGroup`: Edit → `Start Edit`, Save → `Submit`, Cancel → `Cancel Edit` (all owner `shesha.form`); optional Audit Log → `Show Dialog` → `{ name: "entity-change-audit-log", module: "Shesha" }`. The form toggles edit state in place; there is no manual navigate-back Save.
  - **Standalone create/edit page Save + Back** = one `buttonGroup`: Save → `Submit`/`shesha.form` (primary), Back → `Navigate`/`shesha.common` (default). Copy `assets/golden/standalone-capture--standalone-create.json` whole. **The Back button is mandatory even when the prompt mentions no buttons** (e.g. "a form with one required field") — a create form with no way out is incomplete.
  - **Toolbar Refresh / column-toggle** buttons use `actionName: "Refresh table"` / `"Toggle Columns Selector"` with `actionOwner` set to the **dataContext component's id**.
  - **Row → detail navigation** (only when a separate detail page is wanted): action column item with `columnType: "action"`, `action: "navigate"`, `targetUrl: "/dynamic/<module>/<form>?id={{selectedRow.id}}"`, `icon: "EditOutlined"`.
- **`actionArguments.target`** for plain Navigate actions: `{ actionName: "Navigate", actionOwner: "shesha.common", actionArguments: { target: "/dynamic/..." } }`.
- **Preserve ids** on existing components — fresh GUIDs only on clones / new nodes.
- **`editMode` is per form type — never blanket-stamp either value.** Detail forms with Start Edit/Submit lifecycle: `"inherited"` (explicit `"editable"` makes fields editable before Edit is clicked). Create/edit dialogs and action/anonymous pages: `"editable"` (`"inherited"` renders dead inputs there). Visual components: omit. Building from a blueprint, `leaf.mjs` resolves this the same way `T2-EDITMODE-MISMATCH` checks it (a "Start Edit"/`shesha.form` action anywhere marks the form detail-lifecycle). Full decision table: [edit-mode.md](references/components/edit-mode.md).
- **Contextually-preset required FKs on create dialogs need BOTH a real component AND `formSettings.onPrepareSubmitData`** — `formArguments`/`setFieldsValue` alone never reach the submit payload (only `_formFields` serialize). Omission = `Crud/Create` 500. See [add-dialogs.md](references/components/add-dialogs.md).
- **Row delete/unlink = Execute Script + `await http.delete(...)` + onSuccess `Refresh table` with actionOwner = the dataContext component id.** `actionName: "Delete row"` with owner `"table"` does not exist and throws. See [junction-subtables.md](references/components/junction-subtables.md).
- **Code-mode props are objects** — a dataContext `endpoint` (or any code-carrying prop) stored as a plain JS string is silently stripped on save; use `{ "_mode": "code", "_code": "..." }`.
- **JSON-safe script strings** — ALL script values embedded in form JSON must be serialisable without breaking the outer `JSON.stringify`: no template literals (use concatenation instead of `` `${x}` ``), no unescaped newlines (use `\n`), no smart/curly quotes. A broken script string produces `"Expected ',' or '}' after property value"` parse errors in the browser. The compiler never emits template-literal or raw-newline script strings, so this only bites hand-edited scripts — `T1-JSON-UNSAFE`/`T1-SCRIPT-SYNTAX` catch it at **4 · Gates**, and the push hook (Group A, [push-hook.md](references/push-hook.md)) blocks the push outright if it survives to there.
- **No `globalState`** for cross-form state. Default to `contexts.appContext` (app-wide) or `pageContext` (inter-page). `localStorage` / `sessionStorage` are OK only when state must survive a hard refresh AND the data is not sensitive (no auth tokens / PII) — see [shared-state.md](references/components/shared-state.md).
- **API calls in scripts**: `try/catch` + `async/await` (no `.then()` chains) — see [scripts.md](references/components/scripts.md).
- **Mustache expressions always use `{{double braces}}`** — e.g. `{{data.id}}`, `{{selectedRow.id}}`. Never write `{data.id}` (single brace). Single-brace expressions are silently ignored at runtime, producing empty values with no error.
- **A domain change requires a backend rebuild + restart before the entity is usable** — follow [references/backend-restart.md](references/backend-restart.md). Order: domain change → restart → poll the entity's `…/Crud/GetAll` until 200 → then build the form. **Never relaunch IIS Express outside Visual Studio** (`hostingModel=InProcess` + `%LAUNCHER_PATH%` → 500.0 ANCM); headless = take over :21021 with `dotnet` (Kestrel), attended = hand the restart to VS. A **new** entity needs **two boots** (its dynamic CRUD controller registers a boot late). After any restart, re-verify your forms resolve by name (`GetByName`) and re-push if a live revision was orphaned.
- **`access: 5`** on anonymous forms (login, register, OTP). Verify post-push via re-fetch.
- **PowerShell + non-ASCII body**: pass UTF-8 bytes (em dashes / curly quotes trigger server 500 — `Unable to translate bytes [E2] ... from specified code page to Unicode`). Use `[System.Text.Encoding]::UTF8.GetBytes($jsonBody)` or `curl --data-binary @file`. And write staged JSON files **without a BOM** (`New-Object System.Text.UTF8Encoding $false`) — `Out-File -Encoding utf8` emits a BOM that breaks Node's `JSON.parse`. Recipe in [api.md](references/api.md).
- **Human-readable labels on every field** — labels are user-facing AND how browser-based tests locate fields; a raw `propertyName` as a label fails both. Full contract: [form-quality.md](references/form-quality.md).
- **`modelType` is the object `{ name, module }`, resolved, never assumed** — write `formSettings.modelType` as `{ "name": "<ShortClass>", "module": "<Module>" }` (e.g. `{ "name": "Person", "module": "Shesha" }`), the shape current Shesha builds emit. A bare full-class-name string still renders on legacy forms but is not the shape to author. Resolve `name`+`module` (and the `fullClassName` string the metadata fetch + `dataContext.entityType` need) from `EntityConfig/GetMainDataList` for the running backend (the entity-binding check in **1 · Pre-flight**). Never hardcode a namespace from memory or from this doc's examples; `Shesha.Core.*` vs `Shesha.Domain.*` is version-dependent and a mismatch 500s at runtime. (`compile-spec.mjs` synthesizes a placeholder `modelType` only for a blueprint with no bound entity at all — hub/dashboard archetypes — flagged in its `report.defaults`; that placeholder is never a substitute for resolving a real entity when one exists.)
- **Favour the default endpoints when binding a form to a type.** An entity-bound form (`formSettings.modelType` set) uses `dataLoaderType: "gql"` + `dataSubmitterType: "gql"` — the entity's standard dynamic CRUD/GraphQL endpoints, resolved from `modelType` with no URL supplied. Use `"none"` only for non-loading forms (card templates, anonymous/action pages). A **custom form-level loader/submitter endpoint is opt-in only** — wire one solely when the user explicitly asks for a specific endpoint (or in a documented forced case), and build/verify it via `shesha-developer:shesha-app-layer` first. Never reach for a custom endpoint by default. Detail + decision table: [form-shape.md](references/components/form-shape.md).
- **A `validationErrors` component is ALWAYS in the tree** (conventionally just above the action row) **whenever the form has any required input**. Omitting it makes a failed submit render nothing — the user sees a dead form. Type string is exactly `validationErrors`; it takes no props. This applies to simple forms too — it is not an "advanced" extra. Building from a blueprint, every archetype's flow manifest requires it and `flow-complete.mjs` synthesizes it if the blueprint omitted it; `T2-VALIDATIONERRORS-MISSING` catches an omission on a hand-edit.
- **Form action buttons live in a `buttonGroup`, never as standalone `button` components — and the Save button MUST carry `actionConfiguration: { actionName: "Submit", actionOwner: "shesha.form" }`, paired with an exit action (Navigate/Close Dialog/Cancel Edit).** This is the **single highest-leverage rule** — a standalone `button`, a Submit wired to anything else, or a Submit with no exit each break the form in a different way (ungrouped layout, dead submit, or a user who can save but not leave). Building from a blueprint, `actions.mjs` emits this shape and pairing directly. Hand-editing, copy a `buttonGroup` from a seed in `assets/examples/`; `T2-SUBMIT-WIRING`/`T2-EXIT-MISSING`/`T2-LOOSE-BUTTON` catch a violation. The standalone `button` type ([actions.md](references/components/actions.md)) is reserved for rare inline-in-content cases, never the form's action row.
- **Minimal component count — add only what the request needs, but the Submit + exit pair is part of the floor, not an extra.** Every editable form is exactly: the requested input fields + a `validationErrors` + one `buttonGroup` holding **both Submit and an exit (Back/Close/Cancel) button** + the minimum structure to satisfy layout (one `columns`/`sectionSeparator` when >5 inputs). A terse prompt that names only fields ("a form with one required first-name field") still gets the Submit **and** the exit button — they are part of a working form, never "unnecessary extras". What to avoid is padding the user didn't ask for: extra containers, decorative panels, headers, or duplicate wrappers, and (for tables) unrequested toolbar chrome. Seeds are a starting point: after copying, strip every node the current request doesn't use — but never the `validationErrors` or the Submit/exit pair.

## Required skill & agent invocations

| Trigger | Invoke | Strength |
|---|---|---|
| Entity/property/reflist missing or broken (`1 · Pre-flight`'s entity-binding gate) | `shesha-developer:domain-model` | MUST before any form push |
| After a domain change (entity/property/reflist/migration created) | [backend-restart.md](references/backend-restart.md) runbook (rebuild + restart + 2-boot + poll CRUD) | MUST before building the form |
| New entity-bound form / unverified entity this session | `shesha-developer:fullstack-prereq-checker` agent | MUST (block until `ready`) |
| Form needs a custom (non-dynamic) endpoint for a Url-source or submit | `shesha-developer:shesha-app-layer` | MUST before wiring the endpoint |
| Every push (`4 · Gates`) | `shesha-developer:clean-form-config` | MUST (respect its documented false positives) |
| >3 forms changed (`4 · Gates`) | `shesha-developer:form-auditor` fan-out | MUST before pushing |
| Any bulk mutation | `shesha-developer:fleet-transformer` agent (exactly one) | MUST |
| 2+ distinct new forms | `shesha-developer:form-author` per form | SHOULD (parallel) |
| Any runtime error / failed smoke (`6 · Push + Oracle`) | `superpowers:systematic-debugging` | MUST before proposing fixes |
| Before claiming done (`7 · Report`) | `superpowers:verification-before-completion` | MUST — evidence (re-fetch diff + smoke output) first |
| Multi-form plan execution | `superpowers:subagent-driven-development` / `dispatching-parallel-agents` | SHOULD |
| >10 forms or a restructure | `superpowers:writing-plans` first | SHOULD |
| Requirement mentions notifications / app settings | `shesha-developer:shesha-notifications` / `shesha-settings` | SHOULD |
| New endpoints exposed post-rollout | `shesha-utils:harden-permissions` | ASK the user |

(Skills via the Skill tool; agents via the Task tool. In headless runs, ASK-strength items are skipped, MUST items still run.)

## Doc fallback

When you hit an unfamiliar API / component / action, fetch docs first via `WebFetch` instead of guessing — `https://shesha-grads.vercel.app/docs/` for practical how-to ("how do I X"), `https://docs.shesha.io/` for canonical contracts ("what is the contract for X"). Quote field names and gotchas verbatim; cache distillates in `.claude/cache/shesha-form-edit/docs/<topic>.summary.md`. If the token expires (24h default), re-run **1 · Pre-flight**'s authentication step.
