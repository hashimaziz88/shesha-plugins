---
name: shesha-form-edit
description: Create and edit Shesha form configurations directly via the API. Authenticates as admin, fetches existing markup with Get/GetByName/GetJson, applies the user's requirements (adding, removing, modifying, or restructuring components — or building a brand-new form from scratch), validates against the bundled component-properties index and embedded-script rules, and pushes via Create / UpdateMarkup / ImportJson. Use when the user provides a form id (or module + name) and a set of requirements like "add a sector dropdown above the email field", "make the address tab conditional on AccountType=PBF", "wire the Save button to call /api/.../Submit", or "create a new branded login page using the auth-login pattern". Always prefer this skill over the Shesha MCP `create_form_configuration` tool — the MCP regularly fails with `'dict' object has no attribute 'lower'` and JSON-RPC `-32602` errors, and the direct-API path is more reliable.
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

# Shesha Form Edit

Round-trip: **GET form JSON → edit → PUT/POST it back**. Also creates new forms (`Create` then `UpdateMarkup`).

> **For any new table / list / create / detail form, start from a seed — never hand-author structure a seed already provides.** ONE priority order, always: **`assets/exemplars/` first** (small, validator-clean, one per archetype) → **`assets/blocks/`** (compose small vetted blocks when no exemplar fits) → **`assets/examples/`** (the fuller CRUD-loop seeds, fallback when neither above has the shape). Full index + the swap-these-fields checklist: [references/examples.md](references/examples.md). A "**table**"/grid request builds a `datatable`; a "**list**"/cards request builds a `datalist` — different components, pick from the user's wording ([data-tables.md](references/components/data-tables.md)). These seeds are real Shesha-standard forms (verified rendering against a live backend, or curated from graded production markup) and encode the CRUD wiring most models get wrong: the **Add button opens the create form in a modal** (`Show Dialog`), detail views toggle edit in place (`Start Edit`/`Submit`), child tables use `tabs` + a `permanentFilter` on `{{data.id}}`, and inputs are chosen by the property's data type ([by-datatype.md](references/components/by-datatype.md)). Copy the matching seed, swap entity/properties/captions/`formId`s, re-stamp `parentId`s, push.

> **Building a form to match a design?** If the requirements arrive as a **layout blueprint** (`<screen>.blueprint.json` from `shesha-developer:shesha-design-comprehension`, usually via the `shesha-claude-designer` orchestrator), this is a **compile, not an authoring task** — run `node scripts/compile-spec.mjs <screen>.blueprint.json --out <form>.json` then `node scripts/validate-form.mjs <form>.json`. No hand-translation of `layout-tree`/`bindings` into components: the compiler resolves the archetype's seed shape, the flex-container splits, the `parentId`s, and the `propertyName`s from the blueprint directly. Full contract (what it owns, what it doesn't, the acceptance property): [references/compiling.md](references/compiling.md). Then expect a placement re-measure — the orchestrator's gate 5a.5, now `verify-placement.mjs`'s exit code — against the blueprint's `assertions`. Field-mapping reference / troubleshooting a compile failure: [references/blueprint-consumption.md](references/blueprint-consumption.md).

Args received: `$ARGUMENTS`. Flags: `--refresh-cache` (ignore TTL, re-distill metadata/seeds), `--no-browser` (skip Step 9 browser smoke), `--no-design` (skip Step 0 / 9.5 design passes).

## Non-interactive (headless) runs — read this first

When invoked non-interactively (`claude -p`, a test harness, CI) or when the task supplies a context block (Backend URL / Username / Password / Module / Working directory): **never call `AskUserQuestion` — it dead-ends the run.** Use the supplied context verbatim — it **overrides** Step 1 URL discovery, Step 2 default credentials, and the target module. Defaults for every ask-gate: Step 0 design ask → skip, author from seeds; Step 3 missing form identity → resolve from the task wording against the module's form list (`GetAll`), else create a new form named `{entity-kebab}-{type}` in the context module; push-failure menu → re-fetch & re-apply once, then stop and report; Step 9.5 → skip. **Always end with a summary naming every form created or modified (module + name + id)** — downstream evaluation identifies your work from that output.

## Step R — Scale the effort to the request (always first)

Match your process weight to the task, and **default down** when unsure:

- **A small edit** (one component / property / script / action on an existing form) → stay inline, do Steps 1–8 only, skip the design pass, and only do a browser check (Step 9) if the change is visual/behavioral. Keep it cheap — don't run the full pipeline for a one-line tweak.
- **One whole form** (table / list / create / details / dialog / subform) → inline, full Steps 0–10, seed-first (exemplars → blocks → examples, see line above). ("table"/grid → `datatable`; "list"/cards → `datalist`.)
- **Backend prerequisites may be missing** (entity / property / reflist / API / menu item) → gate on Step 4.5 (or the `fullstack-prereq-checker` agent) and fix gaps via the owning sibling skill BEFORE writing form JSON.
- **Multiple linked pages, or a whole app from a brief** → don't build it all in one context: plan first, then build in waves (create → details → table, then cross-link), orchestrating with `superpowers:dispatching-parallel-agents`. State the rough cost up front. See [orchestration.md](references/orchestration.md).

Also **route OUT non-form work** — a pure backend ask (reference list, role, notification, background job, API) goes straight to the sibling skill, not wrapped in form workflow.

**Styling is not this skill's job.** This skill builds correct **structure + CRUD wiring**; *appearance* (surfaces, backgrounds, shadows, layering, radii, v7 style blocks, theme) belongs to `shesha-developer:shesha-design-system`. A structural build/edit never reads styling docs and never authors v7 appearance blocks. When the request is "make it look like X / match the design / style it / it looks bad / apply our brand", build/confirm the structure, then hand off: `Skill(shesha-developer:shesha-design-system)`. The ONE layout concern that stays here is **structural splits**, which are flex `container` rows (`display:"flex"` + `flexDirection:"row"`, children sized via `desktop.dimensions.width`) — **never the `columns` component** (firm project rule).

## Step 0 — Design consultation (ask first)

For brand-new forms or major restructures, **ask the user via `AskUserQuestion`** whether to invoke the `frontend-design` skill for a design plan (typography, palette, spatial system, section list):

> Want a design consultation from the `frontend-design` skill for this form? It returns aesthetic direction (~30s extra) before authoring.
> - **Yes — get a design plan** (recommended for new pages / major restructures)
> - **No — author from seeds only** (good for adding fields, small tweaks, internal forms)

On Yes: invoke `Skill(skill="frontend-design", ...)` per [references/design.md](references/design.md); cache the plan at `.claude/cache/shesha-form-edit/design-plans/<form-name>.md` for Step 9.5.

**Don't ask** (skip silently) for: trivial edits (add a field, fix a script, change a propertyName), bug fixes, row-template / sub-form / utility forms, or when `--no-design` is in `$ARGUMENTS`. If `frontend-design` isn't installed, warn the user once and continue without it.

## Step 1 — Resolve backend URL

Order: **task-supplied context block (always wins)** → **`SHESHA_BACKEND_URL` environment variable** (sandboxed/ephemeral environments where the backend runs in a separate process or pod, not at `localhost`) → `src/*.Web.Host/Properties/launchSettings.json` (`profiles.Project.applicationUrl`) → `src/*.Web.Host/appsettings.json` (`Kestrel:Endpoints:Http:Url`) → fallback `http://localhost:21021`. Strip trailing slash. Store as `$BASE_URL`. Ping `$BASE_URL/swagger/index.html` to confirm reachability; if it fails, stop and tell the user to start the backend.

## Step 2 — Authenticate as admin

Task-supplied credentials win; local-dev defaults otherwise: **`admin` / `123qwe`** — don't ask. POST `$BASE_URL/api/TokenAuth/Authenticate` with `{ userNameOrEmailAddress, password }`; extract `result.accessToken` (or `accessToken` on older builds). See [references/api.md §2](references/api.md). If no token, surface raw response and stop.

**Module ID lookup** (needed for `Create`): `GET $BASE_URL/api/services/app/Module/GetAll` (note: `app` namespace — `Shesha/Module/GetAll` returns 404). Find the entry where `name === "<module>"` and take its `id`. Cache it for the session. If a subsequent `Create` call returns `"There is no entity Module with id = …"`, the backend was restarted and the ID changed — re-fetch via this endpoint.

## Step 3 — Identify the form

Required: form id **OR** (module + name). Ask the user only what's missing:

> Which form? Either give me the **id** (Guid), or **module + name** (e.g. `PBF.MembershipManagement` + `member-create`).

If module + name only, resolve via `GetByName` ([api.md §3](references/api.md)). Store as `$FORM_ID`.

## Step 4 — Fetch the current markup

`GET /api/services/Shesha/FormConfiguration/GetJson?id=$FORM_ID` ([api.md §4](references/api.md)). Save to `$env:TEMP\form-current.json`. The response body is a stringified form JSON; parse it. Resulting object has top-level `components` (nested tree) and `formSettings`.

## Step 4.5 — Entity introspection (mandatory for entity-bound forms)

Skip if `formSettings.dataLoaderType === "none"`. Otherwise fetch the entity's metadata and validate every `propertyName` in the edit.

**Get the exact entity type first (critical — wrong type causes 500 errors at runtime):**

`formSettings.modelType` must identify the **exact registered entity for THIS backend** — resolve it dynamically every time; never assume or copy a namespace from this doc. The same logical entity is registered under different namespaces across Shesha/BoxStack versions: framework entities like `Person` are `Shesha.Domain.Person` on current versions but `Shesha.Core.Person` on older ones, and a backend may even carry both. **The only authority is the live `EntityConfig` for the running backend** — its record gives you the `name`, `module`, and `fullClassName` you need below. Getting this wrong causes 500/404 errors in the browser when the loader or `dataContext` queries the entity — any mismatch with the registered entity is a runtime failure.

**Favour the object shape for `formSettings.modelType`:** `{ "name": "<ShortClass>", "module": "<Module>" }` (e.g. `{ "name": "Person", "module": "Shesha" }`) — the shape current Shesha builds emit. A full-class-name **string** still renders on legacy forms, but write new/edited forms with the object. **Independently, you always also need the resolved `fullClassName` string** — the metadata fetch below passes it as `?container=`, and component-level `entityType`s use either the short class+module or the full class string per their own rules (unchanged).

Resolve it (in priority order) — and use the result verbatim:
1. **From entity config (authoritative)**: `GET $BASE_URL/api/services/app/EntityConfig/GetMainDataList?maxResultCount=200` — find the entity by `name`, then take its **`name` + `module`** for the `modelType` object **and** its **`fullClassName`** (fall back to `className`) for the metadata `container` param. These are authoritative — use them verbatim.
2. **Cross-check against an existing form**: `GET $BASE_URL/api/services/Shesha/FormConfiguration/GetAll?maxResultCount=50` — a form bound to the same entity shows the in-use `modelType`. If existing forms disagree with each other (legacy `Shesha.Core.*` vs current `Shesha.Domain.*`), the EntityConfig `fullClassName` wins.

**Entity existence check**: before building any form, verify the entity exists: `GET $BASE_URL/api/services/app/Metadata/GetProperties?container=<exactModelType>`. If the response returns an empty array or error, the entity does not exist — stop and invoke `Skill(skill="shesha-developer:domain-model")`. Never build forms for entities that don't exist; they silently fail at runtime.

**If you (or `domain-model`) create or change an entity/property/reflist, the backend MUST be rebuilt and restarted before the entity is usable — follow [references/backend-restart.md](references/backend-restart.md).** Do this BEFORE building the form, and in this order: domain change → rebuild + restart (+ the 2-boot lag for new entities) → poll the entity's `…/api/dynamic/<module>/<Entity>/Crud/GetAll` until 200 → only then author/push the form. Never relaunch IIS Express outside Visual Studio (it 500s); headless runs take over :21021 with `dotnet`, attended runs hand the restart back to VS. This restart sequence is the biggest cost/failure sink when improvised — use the runbook.

1. Take the resolved `fullClassName` (the class-name string from the resolution above; `formSettings.modelType` itself is the `{ name, module }` object).
2. Fetch `GET $BASE_URL/api/services/app/Metadata/GetProperties?container=<fullClassName>` — `container` is the class-name **string**, never the object. Returns `result` as a direct array of properties (not wrapped). Cache to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`.
3. **Validate `propertyName` against the property list** for every input component you're adding/editing. Surface mismatches before push.

Metadata semantics (`referenceListName` is the full dotted name used **without** any `RefList` prefix; `entityType` is the SHORT class name with `entityModule` separate; FK property names can differ from class names): [api.md §10](references/api.md). Array properties with `listConfiguration.mappingType: "many-to-many"` mean **junction subtables** — read [junction-subtables.md](references/components/junction-subtables.md) before touching those tabs.

TTL 24h; `--refresh-cache` forces re-fetch. If the metadata fetch returns nothing or surfaces a malformed entity, optionally invoke `Skill(skill="shesha-developer:test-entity-crud-api", args="--no-fix")` and fix entity bugs before continuing — a form bound to a broken entity will look fine in markup but fail at runtime.

**For a NEW entity-bound form, or any entity/junction not already verified this session: dispatch the `shesha-developer:fullstack-prereq-checker` agent** (Task tool; pass backend URL, token-file path, and the entity list) and block until its verdict is `ready` — its failures name the fixing skill per gap. Inline checks remain fine for small edits to an already-rendering form. Catalog of backend-rooted symptoms: [full-stack-prereqs.md](references/full-stack-prereqs.md).

## Step 5 — Apply the user's requirements

Read **only** the topic files relevant to the edit. Most edits need 1–3 files:

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
| Add/create dialogs, formArguments, onPrepareSubmitData | [references/components/add-dialogs.md](references/components/add-dialogs.md) |
| Inline-editable datatables (editComponent shape, crud-operations column) | [references/components/inline-editable-tables.md](references/components/inline-editable-tables.md) |
| Form quality contract (always-on construction rules) | [references/form-quality.md](references/form-quality.md) |
| Adding forms to the app navigation/menu | [references/navigation-menu.md](references/navigation-menu.md) |
| Edits across many forms (pilot-first transforms) | [references/bulk-operations.md](references/bulk-operations.md) |
| Multi-agent fleet dispatch, verdict schemas, cost table | [references/orchestration.md](references/orchestration.md) |
| Browser testing, IndexedDB cache, layout measurement | [references/verification.md](references/verification.md) |
| Symptoms whose fix is backend (reflists, junction DTOs, GQL) | [references/full-stack-prereqs.md](references/full-stack-prereqs.md) |
| Rebuild + restart the backend after a domain change (entity/migration) | [references/backend-restart.md](references/backend-restart.md) |

**Touching more than ~3 forms?** Read [references/bulk-operations.md](references/bulk-operations.md) first — pilot-first is mandatory. Mutations go through **one `shesha-developer:fleet-transformer` agent** (never per-form authoring agents); audits fan out **one `shesha-developer:form-auditor` per form**. Dispatch templates + cost table: [references/orchestration.md](references/orchestration.md).

**Authoring 2+ genuinely distinct new forms?** Dispatch one `shesha-developer:form-author` agent per form in parallel (each gets the seed, metadata, requirements, and an output path); you audit and push centrally afterwards. A single new form stays in-context.

**Read [references/component-cheatsheet.md](references/component-cheatsheet.md) FIRST** — it has the current per-component `version` + minimal shape, so you don't burn round-trips probing for versions or read multi-thousand-line seeds. **Never read a large seed wholesale** (`employee-create.json`, `rs-create-dialog.json`, etc. can run thousands of lines — that's tens of thousands of wasted tokens); open them only with `Grep`/offset for one specific fragment. Prefer the small/lean seeds — every `assets/exemplars/` form is under ~400 lines by construction; among `assets/examples/`, prefer `inline-editable-table.json`/`standalone-create.json` over the multi-thousand-line ones.

**Seed discovery for new forms** — ONE priority order (full detail + swap-fields checklist: [references/examples.md](references/examples.md)):
0. **`assets/exemplars/` — small, validator-clean, one form per archetype.** Check here FIRST for any table/list/create/detail shape — these are curated, normalized, and pass the push-hook gate outright. Copy whole; they're short enough to read in full.
1. **`assets/blocks/` — the BLOCK LIBRARY (compose, don't copy-a-seed)** when no exemplar covers the shape you need. Build the form by composing small, individually-validated blocks (`flex-split-main-rail`, `page-header-band`, `meta-strip`, `card-with-header-strip`, `rail-panel`, `rail-label-value-row`, `status-pill`, `completeness-bar`, `requirement-datalist-row`, `dashed-add-button`) — assembly workflow in [references/block-library.md](references/block-library.md). Each block is a structure skeleton paired with a `shesha-design-system` style overlay and validated against the capability matrix (`scripts/validate-blocks.js`).
2. **`assets/examples/` — the fuller CRUD-loop seeds (fallback when neither above has the shape).** See [references/examples.md](references/examples.md) for the index and the CRUD-loop wiring (modal Add button, Start Edit/Submit detail header, child-table tabs). Copy the matching example and change only `modelType`/`entityType`/`propertyName`/captions/`formId`s. **Prefer the small/lean seeds; never read the multi-thousand-line ones in full.**
3. `assets/patterns/` — other vendor seeds (index: [references/patterns.md](references/patterns.md)).
4. `.claude/cache/shesha-form-edit/seeds/` — project-specific forms cached from prior edits.
5. **MCP `search_forms`** — query `mcp__shesha__search_forms` for forms in this backend matching the layout type. Use the closest match as a seed; cache it under `seeds/` for next time.
6. Author from scratch only if no seed fits — guided by the design plan from Step 0.

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
   stripped at Step 6.
5. **Scan for a better fit** — e.g. `refListStatus` rather than `dropdown` for read-only
   status. For side-by-side layout use a flex `container` whose children are themselves
   `container`s, never the `columns` component (see the split rule below).

Tree-editing principles: preserve every existing component's `id` and `parentId` (fresh GUIDs only on clones / new nodes); when re-parenting, update only the moved node and add it to the new parent's `components`; don't touch `formSettings` unless asked.

**`parentId` is mandatory on every component** — the Shesha renderer crashes entirely when it's absent. Building from a blueprint: `compile-spec.mjs` stamps every `parentId` for you (`normalize-form.mjs` Phase B2 — root-level = `"root"`, else the parent's id); nothing to do by hand. Hand-editing: set it to the direct parent's `id` (root-level components get `"root"`; components inside a `columns` slot get the `columns` component's own `id`, not the slot's), then let Step 6's validator catch an omission (`T1-PARENT-MISSING`) before push. Full contract: [references/compiling.md](references/compiling.md).

## Step 6 — Validate

**Run the validator** (mandatory, blocking): `node scripts/validate-form.mjs <path-to-your-edited-form>.json`. It exits 0 only when there are zero Tier 1 (renderability) and zero Tier 2 (construction-contract) findings; Tier 3 (appearance) is reported but never blocks. Its checks are what this step used to describe as a manual walk — unique/valid ids, parent chain, per-component `version`, `defaultValue` shape, datatable `editComponent` shape, dropdown/checkboxGroup source shape, `dataContext` props, buttonGroup Submit/exit wiring, `propertyName` casing, `validationErrors` presence, and JSON-safety of every script string (`T1-JSON-UNSAFE` — the old "Step 5.5" snippet's job, now a real check with a real exit code). Full code list + which ones actually block a push: [references/push-hook.md](references/push-hook.md) — the same checks also run automatically, post-normalize, in the `PreToolUse` hook on every `UpdateMarkup`/`ImportJson` call, so this step is a chance to see and fix a finding *before* the hook denies the push. A finding names the exact path and expected shape — fix it, don't reason around it. **Never push a config that fails validation without user confirmation.**

Then run the **[form-quality checklist](references/form-quality.md)** — human-readable labels, dropdown sources complete, primary action visible, consistent layout (the parts of "is this a good form" the validator doesn't check structurally).

Then **invoke `clean-form-config` ONCE, right before the final push** (mandatory, blocking) — covers layout overflow, label-vs-propertyName refs, missing try/catch, missing async, broken script syntax:

```
Skill(skill="shesha-developer:clean-form-config", args="<path to your edited form>")
```

**Run it once on the finished markup — not after every intermediate edit** (re-running it per change is a large, repeated cost for no extra signal). **Known false positives — don't re-investigate or strip these:** the `dataContext` data props (`entityType`, `sourceType`, `dataFetchingMode`, `defaultPageSize`, …), container `direction`/`flexDirection`, `text.padding`, and the datatable inline props (`canEditInline`/`canAddInline`/`canDeleteInline`/`inlineEditMode`/`inlineSaveMode`) are valid and render in live forms; the bundled index just doesn't enumerate them.

**Before any bulk push (>3 forms changed): fan out `shesha-developer:form-auditor` agents — one per form** — with the verdict contract from [orchestration.md](references/orchestration.md); aggregate and never push a form with a `fail` verdict.

## Step 7 — Push

Default: **UpdateMarkup** — `PUT $BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup`, body `{ "id": "$FORM_ID", "markup": "<stringified form JSON>" }`. Build the body in Node to avoid escaping pain. See [api.md §5](references/api.md).

**Scratch-script hygiene (avoids a recurring time-sink):** write build/push scripts and staged JSON into the **supplied working directory**, NOT `/tmp` — git-bash `/tmp` maps to `%TEMP%` (e.g. `C:\Users\…\AppData\Local\Temp`), which is a *different* path than Windows `C:\tmp` and from PowerShell `$env:TEMP`, so a file written by `bash` is frequently "not found" by `node`/PowerShell. Pass values into Node via **env vars** (`VAR=x node script.js`), not positional argv that the shell may not forward. Prefer **one combined fetch→mutate→push script** over many small probe commands (each round-trip is cost).

Alternative: **ImportJson** — multipart upload (`ItemId` + `file`). See [api.md §6](references/api.md). Both write `Markup` on the form configuration.

Success: HTTP 200 with `{ "result": ... }`.

### On push failure (any non-200)

1. Surface the raw response and a short diagnosis.
2. Ask the user via `AskUserQuestion`: **retry as-is** / **re-fetch and re-apply** / **abort**.
3. Act on the choice. **Never silently retry. Never just stop.**

## Step 8 — Verify

Re-fetch via `GetByName`/`GetJson`; diff against what you sent. Surface any normalization the server applied. For anonymous forms (`access: 5`), confirm `result.access === 5` — the `Create` endpoint may not honor `access` on initial create; call `UpdateMarkup` once more if it didn't stick.

## Step 8.5 — Diagnose common runtime errors

After verifying, watch for these patterns in the browser console or from Playwright:

| Error | Cause | Fix |
|---|---|---|
| `HTTP 400` on dataContext data load | Entity doesn't have GQL query API enabled in backend | Invoke `shesha-developer:domain-model` to enable GQL on entity, or use `sourceType: "Url"` with an explicit REST endpoint |
| `HTTP 404` on metadata fetch (`"Failed to fetch metadata of type …"`) | Wrong entity class name in `formSettings.modelType` | Re-verify entity type via `EntityConfig/GetMainDataList` or `FormConfiguration/GetAll` on existing forms |
| `HTTP 500` on dataContext | `entityType` or `sourceType` missing on the `dataContext` component | Add `entityType`, `sourceType: "Entity"`, `dataFetchingMode`, `defaultPageSize`, `uniqueStateId` |
| `JSON parse error` in browser console | Malformed script string in form markup — template literals or literal newlines | Run `node scripts/validate-form.mjs` (`T1-JSON-UNSAFE`); replace template literals with concatenation |
| Form shows blank/empty without error | Short IDs (`pr1`, `btn2`) or all-`root` parentIds | Re-run `node scripts/validate-form.mjs` (`T1-ID-NOT-UUID`/`T1-PARENT-MISSING`); re-mint ids with `crypto.randomUUID()` and re-stamp `parentId` |
| Detail form shows blank when navigated to without `?id=` | Normal — `gql` loader has no ID to fetch | This is expected; test detail forms with `?id=<real-guid>` |
| Create/edit fields show as read-only labels (no input boxes) standalone | `editMode: "inherited"` + form not in edit context | Expected — they become inputs inside the Add modal (`formMode: "edit"`) or after Start Edit. Don't "fix" by forcing `editable`. |
| Dropdown opens but shows "No matches" / no options | The backend **reference list has no items**, or wrong `referenceListId` | Verify the reflist name via property metadata; confirm items exist in the backend reflist editor. Config itself (see by-datatype.md) is likely correct. |
| Autocomplete (FK) shows "No matches" | Target entity has no records, or wrong `entityType:{name,module}` | Confirm the FK target short class name + module; ensure records exist. |
| Junction/child `Crud/Create` 500 on dialog submit | Contextually-preset FK never reached the payload (`_formFields` rule) | Real component + `formSettings.onPrepareSubmitData` — see [add-dialogs.md](references/components/add-dialogs.md) |
| Push returned 200 but the browser shows old markup | Frontend IndexedDB form cache | Clear from a static page (`/favicon.ico`) — see [verification.md](references/verification.md) |

Full catalog (~40 rows, grouped): [references/debug.md](references/debug.md).

## Step 9 — Browser smoke (default; `--no-browser` opts out)

Invoke the playwright skill to load the form, screenshot, and capture console + network errors that JSON validation can't catch (editMode regressions, runtime script failures, broken layout). Recipe in [api.md §12](references/api.md):

```
Skill(skill="playwright", args="<directive from api.md §12, with FRONTEND_URL + form path filled in>")
```

Frontend URL: `adminportal/` (auth forms) or `publicportal/` (anonymous) — read the dev port from `<app>/.env*` or `<app>/package.json`. If neither front-end is running, skip the smoke step and warn the user.

Test `*-details` forms via the **table row's view link**, never a pasted `?id=` URL — direct loads render but subtable Add/Create submits 500 (missing page context). If the browser disagrees with a verified API re-fetch, clear the **IndexedDB form cache from `/favicon.ico`** before debugging further.

**Verification cost discipline (this is where runs blow up — keep it tight):**
- Assert with the **a11y snapshot** + `getBoundingClientRect`/`getComputedStyle`, **not screenshots**. Reading a full-page screenshot is ~60 KB of tokens each — take **at most ONE screenshot, at the very end** for a final visual confirmation, never one per iteration.
- **Batch all DOM measurements into a single `evaluate` call** rather than climbing the tree across many calls.
- Before reaching for the browser, check whether the layout question is already answered by a recipe — e.g. full-width = `display:"flex"` + `flexDirection:"column"` + `alignItems:"stretch"`; a flex container needs an explicit `display:"flex"` or `flexDirection` is inert; date renders `&#x2F;` = use `{{{triple-brace}}}`. (v7 styling mechanics now live in `shesha-design-system/references/styling-v7-mechanics.md`.) Don't rediscover documented gotchas with a long browser loop.

Full recipes: [references/verification.md](references/verification.md).

**On any captured error or 4xx/5xx**: consult [references/debug.md](references/debug.md) before guessing — it maps common symptoms to causes. Quote the captured error verbatim; reference the matching row number.

## Step 9.5 — Aesthetic review (ask first; skip if `--no-design` or no Step 0 plan)

If a design plan exists for this form, **ask the user via `AskUserQuestion`** whether to run a post-render aesthetic critique:

> Run an aesthetic review on the rendered form via `frontend-design`? It compares the screenshot against the design plan and returns up to 5 prop-level tweaks.
> - **Yes — review and suggest tweaks**
> - **No — confirm and finish**

On Yes: pass screenshot + plan + original requirements to `frontend-design`. Surface findings as **suggestions, not blockers** — accept/reject per item; on accept, loop back to Step 5 → 8 → 9. Recipe: [references/design.md](references/design.md).

## Step 10 — Confirm

Tell the user: form `$FORM_ID` updated. Authenticated forms render at `/dynamic/<module>/<form>`; anonymous at `/no-auth/<module>/<form>`.

## Cache (`.claude/cache/shesha-form-edit/`)

Project-scoped learning state. **Skill reads `.summary.md` by default; opens raw `.raw.json` only when summary is insufficient.** Layout: `metadata/`, `seeds/`, `docs/`, `_archive/` — see `.claude/cache/shesha-form-edit/README.md`. Populate via `node .claude/skills/shesha-form-edit/scripts/summarize.js <input.json> [--out <out.summary.md>]`. TTLs: metadata 24h; seeds invalidate on `versionNo` change. `--refresh-cache` ignores TTL.

## Non-negotiables

- **"list" → `datalist`, "table"/"grid" → `datatable` — build the component the user's wording names.** A "list of X" (or "cards", "feed", "tiles", "gallery") is a `datalist` (card view) — never a datatable, and **never** stacked static `container` cards. A "table"/"grid"/"spreadsheet" is a `datatable` (column grid). Honor the explicit noun even when the other would also render the data; for multi-select-from-a-list use `selectionMode: "multiple"` on the `datalist` (not a switch to a datatable). When the prompt names neither and the shape is genuinely ambiguous, **ask** before building. Decision table + both seeds: [data-tables.md](references/components/data-tables.md).
- **Every `propertyName` is camelCase — including datatable column `propertyName`s.** Entity GQL field keys are camelCase, but `Metadata/GetProperties` returns the `path` in PascalCase. A PascalCase column still fetches data + shows the right row count, but renders **blank cells** (the cell accessor reads the literal key). Lower-case the first letter (`ActionedBy`→`actionedBy`) — `compile-spec.mjs` does this for you (`leaf.mjs`'s `camelCase()`); hand-edits are caught by `T2-PROPERTYNAME-CASE`. **Datalist row-template cards** also have their own runtime rules (name-mode bound text, `dimensions: fit-content`, single-line `ellipsis` for long text, status chip on its own row, padding/overflow via the legacy `style` prop, card `height:"auto"`) — see [data-tables.md](references/components/data-tables.md).
- **`dataContext` (v8) is the data wrapper for `datatable`/`datalist`.** It's the universal wrapper — verified to render display tables, multiselect tables, datalists, AND inline-editable tables, and it reliably fires the entity data query. Wrap every `datatable`/`datalist` in a `dataContext` carrying `sourceType: "Entity"` + `entityType` (string) + the fetching props. The canonical seeds `employee-table.json` / `rs-table.json` use it.
- **`dataContext` requires explicit `entityType` + `sourceType`** — it does NOT inherit from `formSettings.modelType`. A bare `dataContext` without these props causes HTTP 500 on page load. Building from a blueprint, `compile-spec.mjs`'s `datacontext.mjs` builder emits the full required set (`entityType`, `sourceType: "Entity"`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`) unconditionally — see [compiling.md](references/compiling.md) for the exact shape. Hand-editing one, match that same shape; `T2-DATACONTEXT-PROPS` catches an omission.
- **`id` must be a real UUID; `parentId` set on every component.** Building from a blueprint, both are minted/stamped automatically (`normalize-form.mjs` Phase B — deterministic ids seeded from tree path, `parentId` from the walked tree, root-level = `"root"`). Hand-editing, use `crypto.randomUUID()`/`uuid.v4()` (short placeholders like `btn1` are NOT valid — the renderer ignores non-UUID ids and the form renders blank) and set `parentId` to the direct parent's `id`. `T1-ID-EMPTY`/`T1-ID-NOT-UUID`/`T1-ID-DUPLICATE`/`T1-PARENT-MISSING` catch either omission at Step 6, and the push hook re-checks (post-normalize) on every push regardless.
- **Every authored component carries its component-type's current `version`** (an integer) — a component with no `version` is treated as `-1`, so the ENTIRE legacy migration chain re-runs on already-current data and a step can throw (`e.match is not a function`, `reading 'migrator'`/`'version'`), and a stale/too-low version can also SILENTLY DROP the component's `desktop` style block. Building from a blueprint, `normalize-form.mjs` Phase B3 stamps the current version straight from the registry (`assets/registry/registry-0.45.1.json`) — never hand-maintain a version list, the registry is the single source of truth. Hand-editing, look the type up in the registry or [component-cheatsheet.md](references/component-cheatsheet.md); `T1-VERSION-MISSING`/`T1-VERSION-STALE` catch an omission or a stale value.
- **`defaultValue` is a mustache-TEMPLATE STRING, never a literal non-string.** At render the value resolver does `defaultValue.match(/{{key.accessor}}/)` to detect templates. A literal **array** (e.g. a multi-select default `["a","b"]`), **number**, or **object** has no `.match` → **`e.match is not a function`**, and the component (often the whole form) fails to render. Allowed: a plain string (returned as-is when not a `{{…}}` expression) or a mustache string. For a multi-select default (checkboxGroup / multi-`dropdown`), do NOT set a literal-array `defaultValue` — bind the value through form data / the data loader, or omit it. `T1-DEFAULTVALUE-NONSTRING` catches a violation.
- **Datatable inline-editing column editors (verified shape):** an inline-editable `data` column's `editComponent`/`createComponent` MUST be either `{ "type": "[not-editable]" }` (read-only cell) OR `{ "type": "<editorType>", "settings": { <FULL component model: its own `type` + `version` + `editMode:"inherited"` + `hideLabel:true` + styling> } }`. **NEVER `{ "type": "[default]" }`** (only `displayComponent` resolves `[default]`; edit/create cells pass it straight to the component wrapper → `F6()["[default]"]` is `undefined` → `reading 'migrator'`), and **NEVER a FLAT model without the `settings` wrapper** (the cell wrapper reads `customComponent.settings`; flat → `undefined` → `reading 'version'`). Per-row Edit/Delete/Save controls require a `{ "columnType": "crud-operations", "sortOrder": -1, "itemType": "item" }` column, plus `canEditInline`/`canAddInline`/`canDeleteInline: "yes"` on the datatable. The compiler does not build inline-editable tables — this stays a hand-authoring concern. Full recipe + seed: [inline-editable-tables.md](references/components/inline-editable-tables.md). `T1-EDITCOMPONENT-SHAPE` catches the `[default]`/flat-model mistakes.
- **`checkboxGroup` hardcoded options use `items` (NOT `values`), each `{ label, value }`** — plus `version: 5`, `dataSourceType: "values"`, `referenceListId: null`, `container: {}`, `validate: {}`. (`dropdown`/`radio` use `values` with `{id,label,value}`; `checkboxGroup` is different — do not conflate.) The compiler doesn't populate dropdown/checkboxGroup data sources (that needs the real reference-list name) — this stays a hand-authoring concern. See [dropdowns.md](references/components/dropdowns.md); `T2-DROPDOWN-SOURCE` catches the shape.
- **CRUD wiring follows the canonical examples (`references/examples.md`), not ad-hoc navigation.** Building from a blueprint, the Add-button modal wiring and the Submit/exit pairing below are compiler-emitted (`actions.mjs`, completed against the archetype's flow manifest — [compiling.md](references/compiling.md)); the rest (Refresh/column-toggle, row→detail navigation) is not, and stays a hand-authoring concern either way:
  - **Table "Add" button** = a `buttonGroup` item with `buttonAction: "dialogue"`, `actionConfiguration.actionName: "Show Dialog"` (owner `shesha.common`), `actionArguments.formId: { name: "<create-form>", module: "<module>" }`, `modalWidth: "60%"`, `formMode: "edit"`. It opens the create form in a **modal** — verified to render the create form's fields inline. Do NOT make Add a Navigate.
  - **Detail-view lifecycle buttons** = a header `buttonGroup`: Edit → `Start Edit`, Save → `Submit`, Cancel → `Cancel Edit` (all owner `shesha.form`); optional Audit Log → `Show Dialog` → `{ name: "entity-change-audit-log", module: "Shesha" }`. The form toggles edit state in place; there is no manual navigate-back Save.
  - **Standalone create/edit page Save + Back** = one `buttonGroup`: Save → `Submit`/`shesha.form` (primary), Back → `Navigate`/`shesha.common` (default). Copy `assets/examples/standalone-create.json` whole. **The Back button is mandatory even when the prompt mentions no buttons** (e.g. "a form with one required field") — a create form with no way out is incomplete.
  - **Toolbar Refresh / column-toggle** buttons use `actionName: "Refresh table"` / `"Toggle Columns Selector"` with `actionOwner` set to the **dataContext component's id**.
  - **Row → detail navigation** (only when a separate detail page is wanted): action column item with `columnType: "action"`, `action: "navigate"`, `targetUrl: "/dynamic/<module>/<form>?id={{selectedRow.id}}"`, `icon: "EditOutlined"`.
- **`actionArguments.target`** for plain Navigate actions: `{ actionName: "Navigate", actionOwner: "shesha.common", actionArguments: { target: "/dynamic/..." } }`.
- **Preserve ids** on existing components — fresh GUIDs only on clones / new nodes.
- **`editMode` is per form type — never blanket-stamp either value.** Detail forms with Start Edit/Submit lifecycle: `"inherited"` (explicit `"editable"` makes fields editable before Edit is clicked). Create/edit dialogs and action/anonymous pages: `"editable"` (`"inherited"` renders dead inputs there). Visual components: omit. Building from a blueprint, `leaf.mjs` resolves this the same way `T2-EDITMODE-MISMATCH` checks it (a "Start Edit"/`shesha.form` action anywhere marks the form detail-lifecycle). Full decision table: [edit-mode.md](references/components/edit-mode.md).
- **Contextually-preset required FKs on create dialogs need BOTH a real component AND `formSettings.onPrepareSubmitData`** — `formArguments`/`setFieldsValue` alone never reach the submit payload (only `_formFields` serialize). Omission = `Crud/Create` 500. See [add-dialogs.md](references/components/add-dialogs.md).
- **Row delete/unlink = Execute Script + `await http.delete(...)` + onSuccess `Refresh table` with actionOwner = the dataContext component id.** `actionName: "Delete row"` with owner `"table"` does not exist and throws. See [junction-subtables.md](references/components/junction-subtables.md).
- **Code-mode props are objects** — a dataContext `endpoint` (or any code-carrying prop) stored as a plain JS string is silently stripped on save; use `{ "_mode": "code", "_code": "..." }`.
- **JSON-safe script strings** — ALL script values embedded in form JSON must be serialisable without breaking the outer `JSON.stringify`: no template literals (use concatenation instead of `` `${x}` ``), no unescaped newlines (use `\n`), no smart/curly quotes. A broken script string produces `"Expected ',' or '}' after property value"` parse errors in the browser. The compiler never emits template-literal or raw-newline script strings, so this only bites hand-edited scripts — `T1-JSON-UNSAFE`/`T1-SCRIPT-SYNTAX` catch it at Step 6, and the push hook (Group A, [push-hook.md](references/push-hook.md)) blocks the push outright if it survives to there.
- **No `globalState`** for cross-form state. Default to `contexts.appContext` (app-wide) or `pageContext` (inter-page). `localStorage` / `sessionStorage` are OK only when state must survive a hard refresh AND the data is not sensitive (no auth tokens / PII) — see [shared-state.md](references/components/shared-state.md).
- **API calls in scripts**: `try/catch` + `async/await` (no `.then()` chains) — see [scripts.md](references/components/scripts.md).
- **Mustache expressions always use `{{double braces}}`** — e.g. `{{data.id}}`, `{{selectedRow.id}}`. Never write `{data.id}` (single brace). Single-brace expressions are silently ignored at runtime, producing empty values with no error.
- **A domain change requires a backend rebuild + restart before the entity is usable** — follow [references/backend-restart.md](references/backend-restart.md). Order: domain change → restart → poll the entity's `…/Crud/GetAll` until 200 → then build the form. **Never relaunch IIS Express outside Visual Studio** (`hostingModel=InProcess` + `%LAUNCHER_PATH%` → 500.0 ANCM); headless = take over :21021 with `dotnet` (Kestrel), attended = hand the restart to VS. A **new** entity needs **two boots** (its dynamic CRUD controller registers a boot late). After any restart, re-verify your forms resolve by name (`GetByName`) and re-push if a live revision was orphaned.
- **`access: 5`** on anonymous forms (login, register, OTP). Verify post-push via re-fetch.
- **PowerShell + non-ASCII body**: pass UTF-8 bytes (em dashes / curly quotes trigger server 500 — `Unable to translate bytes [E2] ... from specified code page to Unicode`). Use `[System.Text.Encoding]::UTF8.GetBytes($jsonBody)` or `curl --data-binary @file`. And write staged JSON files **without a BOM** (`New-Object System.Text.UTF8Encoding $false`) — `Out-File -Encoding utf8` emits a BOM that breaks Node's `JSON.parse`. Recipe in [api.md](references/api.md).
- **Human-readable labels on every field** — labels are user-facing AND how browser-based tests locate fields; a raw `propertyName` as a label fails both. Full contract: [form-quality.md](references/form-quality.md).
- **`modelType` is the object `{ name, module }`, resolved, never assumed** — write `formSettings.modelType` as `{ "name": "<ShortClass>", "module": "<Module>" }` (e.g. `{ "name": "Person", "module": "Shesha" }`), the shape current Shesha builds emit. A bare full-class-name string still renders on legacy forms but is not the shape to author. Resolve `name`+`module` (and the `fullClassName` string the metadata fetch + `dataContext.entityType` need) from `EntityConfig/GetMainDataList` for the running backend (Step 4.5). Never hardcode a namespace from memory or from this doc's examples; `Shesha.Core.*` vs `Shesha.Domain.*` is version-dependent and a mismatch 500s at runtime. (`compile-spec.mjs` synthesizes a placeholder `modelType` only for a blueprint with no bound entity at all — hub/dashboard archetypes — flagged in its `report.defaults`; that placeholder is never a substitute for resolving a real entity when one exists.)
- **Favour the default endpoints when binding a form to a type.** An entity-bound form (`formSettings.modelType` set) uses `dataLoaderType: "gql"` + `dataSubmitterType: "gql"` — the entity's standard dynamic CRUD/GraphQL endpoints, resolved from `modelType` with no URL supplied. Use `"none"` only for non-loading forms (card templates, anonymous/action pages). A **custom form-level loader/submitter endpoint is opt-in only** — wire one solely when the user explicitly asks for a specific endpoint (or in a documented forced case), and build/verify it via `shesha-developer:shesha-app-layer` first. Never reach for a custom endpoint by default. Detail + decision table: [form-shape.md](references/components/form-shape.md).
- **A `validationErrors` component is ALWAYS in the tree** (conventionally just above the action row) **whenever the form has any required input**. Omitting it makes a failed submit render nothing — the user sees a dead form. Type string is exactly `validationErrors`; it takes no props. This applies to simple forms too — it is not an "advanced" extra. Building from a blueprint, every archetype's flow manifest requires it and `flow-complete.mjs` synthesizes it if the blueprint omitted it; `T2-VALIDATIONERRORS-MISSING` catches an omission on a hand-edit.
- **Form action buttons live in a `buttonGroup`, never as standalone `button` components — and the Save button MUST carry `actionConfiguration: { actionName: "Submit", actionOwner: "shesha.form" }`, paired with an exit action (Navigate/Close Dialog/Cancel Edit).** This is the **single highest-leverage rule** — a standalone `button`, a Submit wired to anything else, or a Submit with no exit each break the form in a different way (ungrouped layout, dead submit, or a user who can save but not leave). Building from a blueprint, `actions.mjs` emits this shape and pairing directly. Hand-editing, copy a `buttonGroup` from a seed in `assets/examples/`; `T2-SUBMIT-WIRING`/`T2-EXIT-MISSING`/`T2-LOOSE-BUTTON` catch a violation. The standalone `button` type ([actions.md](references/components/actions.md)) is reserved for rare inline-in-content cases, never the form's action row.
- **Minimal component count — add only what the request needs, but the Submit + exit pair is part of the floor, not an extra.** Every editable form is exactly: the requested input fields + a `validationErrors` + one `buttonGroup` holding **both Submit and an exit (Back/Close/Cancel) button** + the minimum structure to satisfy layout (one `columns`/`sectionSeparator` when >5 inputs). A terse prompt that names only fields ("a form with one required first-name field") still gets the Submit **and** the exit button — they are part of a working form, never "unnecessary extras". What to avoid is padding the user didn't ask for: extra containers, decorative panels, headers, or duplicate wrappers, and (for tables) unrequested toolbar chrome. Seeds are a starting point: after copying, strip every node the current request doesn't use — but never the `validationErrors` or the Submit/exit pair.

## Required skill & agent invocations

| Trigger | Invoke | Strength |
|---|---|---|
| Entity/property/reflist missing or broken (Step 4.5 gate) | `shesha-developer:domain-model` | MUST before any form push |
| After a domain change (entity/property/reflist/migration created) | [backend-restart.md](references/backend-restart.md) runbook (rebuild + restart + 2-boot + poll CRUD) | MUST before building the form |
| New entity-bound form / unverified entity this session | `shesha-developer:fullstack-prereq-checker` agent | MUST (block until `ready`) |
| Form needs a custom (non-dynamic) endpoint for a Url-source or submit | `shesha-developer:shesha-app-layer` | MUST before wiring the endpoint |
| Every push (Step 6) | `shesha-developer:clean-form-config` | MUST (respect its documented false positives) |
| >3 forms changed (Step 6) | `shesha-developer:form-auditor` fan-out | MUST before pushing |
| Any bulk mutation | `shesha-developer:fleet-transformer` agent (exactly one) | MUST |
| 2+ distinct new forms | `shesha-developer:form-author` per form | SHOULD (parallel) |
| Any runtime error / failed smoke (Step 8.5/9) | `superpowers:systematic-debugging` | MUST before proposing fixes |
| Before claiming done (Step 10) | `superpowers:verification-before-completion` | MUST — evidence (re-fetch diff + smoke output) first |
| Multi-form plan execution | `superpowers:subagent-driven-development` / `dispatching-parallel-agents` | SHOULD |
| >10 forms or a restructure | `superpowers:writing-plans` first | SHOULD |
| Requirement mentions notifications / app settings | `shesha-developer:shesha-notifications` / `shesha-settings` | SHOULD |
| New endpoints exposed post-rollout | `shesha-utils:harden-permissions` | ASK the user |

(Skills via the Skill tool; agents via the Task tool. In headless runs, ASK-strength items are skipped, MUST items still run.)

## Doc fallback

When you hit an unfamiliar API / component / action, fetch docs first via `WebFetch` instead of guessing — `https://shesha-grads.vercel.app/docs/` for practical how-to ("how do I X"), `https://docs.shesha.io/` for canonical contracts ("what is the contract for X"). Quote field names and gotchas verbatim; cache distillates in `.claude/cache/shesha-form-edit/docs/<topic>.summary.md`. If the token expires (24h default), re-run Step 2.
