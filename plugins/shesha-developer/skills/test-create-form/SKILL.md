---
name: test-create-form
description: Build canonical Shesha CRUD forms (list / create / details / row-template mini-card) by COPYING one of four sample-patient-* seed markups and swapping only the entity-specific bits. Use when the user asks for a "table", "list view", "details view", "create form", "edit form", "CRUD views" (any of the four common shapes) — for one entity or many. Trimmed alternative to shesha-form-edit — this skill has ONLY the four canonical seeds and the rules that keep them working; no block library, no employee-*/rs-* alternates, no design-consultation branch. Route non-canonical shapes (dashboards, wizards, master-detail splits, junction subtables, inline-editable tables) to shesha-form-edit instead. Args accept the standard headless context block (Backend URL / Username / Password / Module / Working directory).
allowed-tools:
  - Bash
  - PowerShell
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Skill
  - Task
---

# Shesha CRUD forms

**One rule: copy one of the four `sample-patient-*` seeds, run the swap checklist, validate, push.** Do not hand-author these structures from a prose brief. Do not remix. Do not "improve" the seed.

The four seeds live at `assets/examples/`. Every non-audit visual + structural + wiring behaviour of a canonical CRUD form is encoded there — pulled from a live, correctly-rendering backend.

| The user asks for… | Copy this seed | See it | Full spec |
|---|---|---|---|
| a **table** / list / index / grid page for one entity | `sample-patient-table.json` | [screenshot](assets/screenshots/sample-patient-table.png) | [canonical-seeds.md](references/canonical-seeds.md#sample-patient-tablejson--table-archetype) |
| a **create** / edit form the table's Add button opens (in a modal) | `sample-patient-create.json` | [screenshot](assets/screenshots/sample-patient-create.png) | [canonical-seeds.md](references/canonical-seeds.md#sample-patient-createjson--create-archetype) |
| a **details** / record view (with tabs + child datatables) | `sample-patient-details.json` | screenshots: [overview](assets/screenshots/sample-patient-details-overview.png) · [appointments](assets/screenshots/sample-patient-details-appointments.png) · [prescriptions](assets/screenshots/sample-patient-details-prescriptions.png) · [lab-results](assets/screenshots/sample-patient-details-lab-results.png) | [canonical-seeds.md](references/canonical-seeds.md#sample-patient-detailsjson--details-archetype) |
| a **row-template mini-card** (avatar + name-link + subtitle) embedded in a table's primary column or a details hero | `sample-patient-subform.json` | *(rendered inline in the details hero + table primary column — see the screenshots above)* | [canonical-seeds.md](references/canonical-seeds.md#sample-patient-subformjson--mini-card-archetype) |

> **Before writing any JSON, Read the target archetype's screenshot(s).** 

## The flow — five steps

> **Order of operations: domain first, forms last.** If Step 2 finds the entity missing, create it and get the backend restarted (Step 2.3) *before* copying any seed — a form built against a not-yet-registered entity won't render.

### Step 1 — Auth + resolve context

- Backend URL: from the task's context block; otherwise `http://localhost:21021`.
- Admin creds: from the task's context block; otherwise `admin` / `P@ssw0rd` (no tenant header).
- `POST /api/TokenAuth/Authenticate` with `{userNameOrEmailAddress, password}` → read `result.accessToken`. Use as `Authorization: Bearer …` on every subsequent call. Send `sha-frontend-application: default-app` on any config-scoped write.
- Module id: `GET /api/services/app/Module/GetAll` → find `items[].name === "<module>"` → store `id`. Cache for the session.

### Step 2 — Resolve the entity (mandatory before touching JSON)

For every entity you're binding:

1. `GET /api/services/app/EntityConfig/GetMainDataList?maxResultCount=500` — find `items[].className === "<Entity>"`. Take `name`, `module`, and `fullClassName` verbatim.
2. `GET /api/services/app/Metadata/GetProperties?container=<fullClassName>` — the property list you'll bind fields to. `path` is PascalCase in the response — **camelCase every `propertyName` when copying into markup** (`FirstName` → `firstName`; see [references/binding-rules.md](references/binding-rules.md)).
3. `GET /api/services/app/Entities/GetAll?entityType=<fullClassName>&maxResultCount=1` — must return HTTP 200 with a `result.totalCount`. **A 400 (or the entity missing from step 2.1's `GetMainDataList`) means its dynamic CRUD isn't registered — the domain doesn't exist or hasn't been rebuilt yet.** Don't build against a missing entity. Instead:
   - **Locate the real solution root first.** The supplied **Working directory** is often a scratch/output dir with no `.sln` in it. Before delegating, resolve the actual .NET solution root: if `<workingDir>` (or `<workingDir>/backend`) has no `*.sln`, search for the backend solution (`find <workingDir> ... -iname '*.Web.Host.csproj'`, then widen the search) and use *that* directory. domain-model builds and restarts from this path — a wrong one silently builds nothing.
   - **Create it — delegate ownership.** Invoke the **`domain-model` skill directly via the `Skill` tool, inline in *this* session** — do **not** spawn a separate sub-agent / `Task` for it (a sub-agent's background backend dies when the sub-agent ends, before you can use it). It creates the entity + migration **and** performs the mandatory rebuild + **restart-twice** via its own runbook. Pass the full context block, not blobs — Backend URL · Username · Password · **Module** · **Working directory** (the *resolved solution root* from the previous bullet — load-bearing) · the **entity name + property list / requirements** the user gave (the one thing domain-model can't derive) · the **required outcome**: "entity live — `/api/dynamic/<module>/<Entity>/Crud/GetAll` returns 200 after the restart; report back the final `{name, module, fullClassName}`." **Don't run the initial domain rebuild/restart yourself** — the runbook (not you) picks that restart path: self-host Kestrel when headless, prompt the developer to Stop▸Build▸Run twice when attended/Visual Studio, shesha-agent API when ephemeral.
   - **Then verify, don't restart.** When domain-model returns, poll `GET /api/dynamic/<module>/<Entity>/Crud/GetAll?maxResultCount=1` until 200. If it still 404s, that's the known 2-boot lag, not a failure — request **one** more delegated boot per [references/backend-restart.md](references/backend-restart.md) ("budget 2–3 boots"), then re-poll. Do not build a parallel restart loop or call `dotnet build`/`dotnet run`/kill the port.
   - **Make the backend persist — headless only.** In a headless run, domain-model launched the restarted backend as a *session-bound background task* — it dies the moment this skill's session exits, leaving nothing on `:21021` for a downstream grader/harness to read (no persisted form, no screenshot). **This is the one restart test-create-form owns:** once CRUD is verified, relaunch the built backend **detached** so it outlives the session, then confirm swagger + `Crud/GetAll` return 200 against the detached process before finishing. Exact mechanism (Start-Process / scheduled-task fallback) in [references/backend-restart.md § Persist the backend](references/backend-restart.md#persist-the-backend-after-a-headless-restart). Skip this in attended/Visual-Studio mode (the developer owns the backend) and ephemeral mode (shesha-agent owns it).
   - **Re-resolve context.** A restart can change the module id — re-run step 1's `Module/GetAll` and steps 2.1–2.2 for the now-live entity before continuing.

Once `Crud/GetAll` returns 200, store `{name, module, fullClassName}` as `MODELTYPE`. `formSettings.modelType` is authored as the **object** `{ name, module }`. Any `dataContext.entityType` uses the same object.

### Step 3 — Copy the seed + run the swap checklist

Read the seed for your archetype from `assets/examples/`. Then, verbatim, for EVERY item in the checklist at [references/canonical-seeds.md § "The swap checklist"](references/canonical-seeds.md#the-swap-checklist):

- `formSettings.modelType` → `{name, module}` from Step 2
- Every `dataContext.entityType` → `{name, module}` of the entity that dataContext queries (parent for the root dc; child for a tab's dc)
- Every field's `propertyName` / `componentName` / `name` / `label` → real camelCase property + sentence-case label
- Every `formId` reference in `actionArguments` → your family's form names (`sample-patient-create` → `<yourentity>-create`, etc.)
- Every `text.content` mustache → `{{propertyName}}` NOT `{{data.propertyName}}` (see [references/binding-rules.md](references/binding-rules.md))
- Every column `displayComponent` for a REAL type (`refListStatus`, `entityReference`, etc.) — wrapped in `settings` with `version` + `propertyName:"editor"` (see [references/canonical-seeds.md § settings-wrapper](references/canonical-seeds.md#the-settings-wrapper-rule-for-custom-display-cells))
- Every `tab.id === tab.key` (both a fresh 30-char random string per tab; all `tab.id` unique in a `tabs.tabs[]`)
- Every child-tab `dataContext.permanentFilter` uses JsonLogic + mustache-`evaluate` (NOT `_mode:"code"` — see [references/canonical-seeds.md § permanentFilter](references/canonical-seeds.md#child-tab-filtering--permanentfilter))
- Every `buttonGroup` has `isInline: true` (visible buttons, not a "..." collapsed dropdown)
- Every input on a **create form** has `editMode: "editable"` — inherited is only for details forms in view-mode
- Re-stamp every `id` (fresh UUIDs) and `parentId` (points at the direct parent's id) via a `stampTree` pass
- Card `content.components` field-holding containers use `desktop.display: "grid"` + `gridColumnsCount: 2` + `justifyContent": "normal"`, (or 3 for medical rows) — do NOT decompose into horizontal-flex rows

Full checklist + failure modes: [references/canonical-seeds.md](references/canonical-seeds.md).

### Step 4 — Validate (BLOCKING, before every push)

Run the pre-push validator against your staged markup:

```bash
node scripts/validate-form-markup.cjs <path-to-markup.json>
```

Exit code 0 → OK to push. Exit code 1 → fix the printed BLOCK-PUSH violations and re-run. **Do not push a form the validator blocks.** The eleven rules encode every "silent-drop-on-render" / "React-key-collision" / "component-crash" defect observed on live builds — each maps to a documented rule in `references/`.

### Step 5 — Push

- If the form doesn't exist yet: `POST /api/services/Shesha/FormConfiguration/Create` with `{name, label, description, moduleId}` → capture `result.id`.
- Push markup: `PUT /api/services/Shesha/FormConfiguration/UpdateMarkup` with `{id, markup: JSON.stringify(<markup>)}`. Also pass `access: 5` on anonymous pages (login, register).
- Re-fetch via `GetByName` to confirm the round-trip. **After a run that created/changed the domain in Step 2.3**, `GetByName` (and the `/dynamic/<mod>/<name>` route) can 404 even though `GetJson?id=<id>` still returns the markup — startup re-ran the config bootstrappers. If so, **re-push via `UpdateMarkup`** to restore name-resolution, then re-fetch. A clean run that never restarted won't hit this. See [references/backend-restart.md](references/backend-restart.md).
- Report the form's module + name + id.

### Optional — Browser smoke

Launch a headless browser, log in, navigate to `/dynamic/<module>/<form-name>`, screenshot, capture console + page errors. Take ONE screenshot at the end (not per iteration). A one-liner using Playwright is enough — see [references/functional-requirements.md § smoke](references/functional-requirements.md#optional--browser-smoke-recipe).

## The five hard rules — these are what break forms

If nothing else, get these right on every push. Each is enforced by the validator (rule number in brackets).

1. **[R3] `displayComponent`/`editComponent`/`createComponent` with a real type MUST wrap it in `settings`** — flat `{ type: "refListStatus" }` crashes with `reading 'version'`. See [references/canonical-seeds.md § settings-wrapper](references/canonical-seeds.md#the-settings-wrapper-rule-for-custom-display-cells).
2. **[R2, R11] Plain-string mustache in `text.content`, `link.href`, `refListStatus.propertyName`, action `target` = `{{name}}` NOT `{{data.name}}`** — silent-drop-on-render. See [references/binding-rules.md § mustache](references/binding-rules.md#mustache-in-plain-string-bindings).
3. **[R4] Every tab has `tab.key === tab.id`, both unique** — React key collision if `tab.id` is duplicated across sibling tabs → BOTH tab bodies render on the visible tab. See [references/canonical-seeds.md § tab identity](references/canonical-seeds.md#tab-identity).
4. **[R8] Every `buttonGroup` has `isInline: true`** — otherwise buttons collapse into a "..." dropdown menu. Documented in [references/functional-requirements.md § buttonGroup](references/functional-requirements.md#buttongroup---always-isinline-true).
5. **[R9] Create-form inputs use `editMode: "editable"`** — `inherited` renders dead labels with no input boxes on a standalone create page. See [references/binding-rules.md § editMode-by-form-type](references/binding-rules.md#editmode-by-form-type).

Everything else is style + polish. These five are correctness.

## Multi-form runs

For 2+ distinct new forms (typical CRUD triad: list + create + details), author sequentially in one context — the seeds are small enough that copying + swapping all three inline is faster than dispatching agents. Push each after its own validator pass.

For >5 near-identical forms across a fleet, escalate to `shesha-developer:shesha-form-edit`'s bulk-operations flow.

## Reference index

| Concern | File |
|---|---|
| Missing entity → create it + get the backend restarted before building (delegate to domain-model; 2-boot lag; headless Kestrel vs prompt-in-VS vs shesha-agent) | [references/backend-restart.md](references/backend-restart.md) |
| What each of the four seeds guarantees, byte-exact rules, swap checklist | [references/canonical-seeds.md](references/canonical-seeds.md) |
| Component types + current versions + minimal shape | [references/component-list.md](references/component-list.md) |
| Action-configuration verbatim JSON (Show Dialog / Refresh table / Submit / Start Edit / Cancel Edit / Navigate) | [references/action-configurations.md](references/action-configurations.md) |
| Property binding, mustache, editMode, camelCase | [references/binding-rules.md](references/binding-rules.md) |
| Modal Add pattern + `onSuccess: Refresh table` wiring | [references/add-dialogs.md](references/add-dialogs.md) |
| What a "complete" form has (validationErrors, Save+Back, isInline, page-header, 3-layer sandwich) | [references/functional-requirements.md](references/functional-requirements.md) |
| The eleven pre-push validator rules + how to invoke | [scripts/validate-form-markup.cjs](scripts/validate-form-markup.cjs) |
