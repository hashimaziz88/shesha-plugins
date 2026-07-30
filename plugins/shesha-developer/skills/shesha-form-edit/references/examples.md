# Seeds — exemplars first, golden archetypes second, fragments third

**One priority order for picking a starting point, stated in [SKILL.md](../SKILL.md):**

1. **`assets/exemplars/`** — small, validator-clean, one form per archetype. Check here first.
2. **`assets/golden/`** — the 0.45 golden corpus `compile-blueprint.js` clones from (`_index.json`:
   **table-worklist · record-detail · hub · capture · capture-standalone · modal-dialog · list-card ·
   list-card-item · inline-card · dashboard**; archetype keys match the blueprint IR vocabulary,
   `shesha-design-comprehension/schemas/blueprint.schema.json`). Full-screen shapes (worklist table,
   card list, inline-CRUD table, standalone create, detail page) live here now — grep the fragment
   you need, never read one whole [R-050].
3. **`assets/blocks/`** — compose small vetted blocks when neither of the above covers the shape (see
   [block-library.md](block-library.md)).
4. **`assets/examples/`** (this file's fragment index, below) — the two sub-screen **fragments** no
   single archetype covers, for grafting into a hub/detail build. `assets/patterns/` (other vendor
   seeds — see [patterns.md](patterns.md)) is the tier below that.

Whichever tier you copy from: change only `modelType`, `entityType`, `propertyName`s, captions, and
`formId` references. Do not invent structure the seed doesn't have. Project-tied seeds live in
`.claude/cache/shesha-form-edit/seeds/`, scratch in `.claude/cache/shesha-form-edit/_archive/` —
never in the shipped asset pools.

The normal build path is the compiler — `scripts/compile-spec.mjs` (registry-backed, builds
programmatically from blocks/rules) or `scripts/compile-blueprint.js` (field-validated, clones the
closest `assets/golden/` archetype from the blueprint's `Archetype:` header and re-types it: ids,
versions [R-003], bindings, dataContext wrappers [R-005]). Manual cloning below is the fallback for
hand-composition — pick via `_index.json` only, grep the fragment you need, and re-stamp every id +
`parentId` [R-001/R-002/R-025].

## `assets/exemplars/` — check here first

| File | Archetype | Demonstrates |
|---|---|---|
| `record-detail-simple.json` | `record-detail` | Start Edit/Submit/Cancel Edit lifecycle header, `editMode:"inherited"` fields, `validationErrors` — no child tables. |
| `record-detail-with-children.json` | `record-detail` | Same header + one field, plus a `tabs` pane holding an Entity-sourced `dataContext` + `datatable` filtered on the parent via `permanentFilter` on `{{data.id}}` (the FK child-table pattern). |

Both are under ~400 lines, PASS the push-hook gate with zero Tier 1/2 findings, and are safe to read
in full (never need `Grep`/offset).

## `assets/golden/` — full-screen shapes (see `_index.json` for the authoritative list)

| Need | Golden file | Use when |
|---|---|---|
| **Table** / index / grid page | `table-worklist--employee-table.json` | "table", "grid", "manage X", "spreadsheet of X" — tabular data with sortable columns |
| **Card list** (datalist) | `list-card--entity-datalist.json` **+** `list-card-item--entity-card.json` | "**list** of X", "cards", "feed", "tiles", "gallery", "directory" — repeating card view; multi-select via `selectionMode: "multiple"`. Copy **BOTH**: the list (`dataContext` → `datalist`) and its **row-template card form**, then point the datalist's `formId` at your card form. (Live-verified row-template mode — see [data-tables.md](components/data-tables.md). Do NOT use inline `items`; it renders blank on 0.45.x.) |
| Inline-editable table (edit/add/delete in-row) | `inline-card--inline-editable-table.json` | "edit details / add / remove **directly inside the rows**", inline-CRUD grid — has `crud-operations` column + concrete `{type, settings}` editors. See [components/inline-editable-tables.md](components/inline-editable-tables.md) |
| Create / edit in modal | `capture--employee-create.json`, `modal-dialog--rs-create-dialog.json` | the form the table's **Add** button opens; submit comes from the modal footer (no in-form button row) |
| Standalone create / edit **page** (own Save + Back) | `capture-standalone--standalone-create.json` | a full-page create/edit form the user opens directly (not in a modal), e.g. "create a person form" or "a form with a required first-name field" — the Save + Back row is mandatory even when the prompt never mentions buttons; see note below |
| Detail page, no children | `assets/exemplars/record-detail-simple.json` (an exemplar, not golden — see above) | a standalone record view with the **Start Edit / Save / Cancel Edit toggle** lifecycle |
| Detail page with child tables | `record-detail--employee-detail.json`, or the exemplar `assets/exemplars/record-detail-with-children.json` | record view that also lists related child entities |
| Main+rail hub (largest fixture) | `hub--rs-detail-with-header.json` | 962/332 split, KIB-style meta strip, tabs, related panels — grep only |

Three seeds that used to live in `assets/examples/` — `rs-detail-with-header.json`,
`employee-detail-with-child-tables.json`, `employee-detail-without-child-tables.json` — were retired
by both branches independently: at 25,010 / ~14,300 / ~8,800 lines they were unreadable by
construction, contradicting the "never read a large seed wholesale" rule below. The
`assets/exemplars/` forms and the `assets/golden/` corpus above replace their teaching value at a
fraction of the size.

## `assets/examples/` — fragment index (2 files; every other seed moved to `assets/golden/`)

| File | Use for |
|---|---|
| `rs-link-add-dialog.json` | link-existing dialog (M:M junction add) — [components/junction-subtables.md](components/junction-subtables.md) |
| `rs-subtable-tab-fragment.json` | child-table tab fragment (`dataContext` + filtered `datatable` in a tab) — [components/child-tables.md](components/child-tables.md) |

`assets/golden/capture-standalone--standalone-create.json` is the canonical full-page create/edit form: a
`validationErrors`, a 2-column flex split (two `container`s at `desktop.dimensions.width: "50%"`
each, never the `columns` component), and one `buttonGroup` with **Save** (primary,
`Submit`/`shesha.form`) + **Back** (default, `Navigate`/`shesha.common`). It's a Person create
page — swap `modelType`, the field `propertyName`s/labels, the title `content`, and the Back
button's `actionArguments.url` to the target entity's list form. This is the seed to reach for
on any "create a form for X" / "make me a person form" request, including terse ones.

## When you clone anything, swap ALL of these (easy to miss)

1. `formSettings.modelType` → `{ name, module }` object resolved from live
   EntityConfig [R-016]; every `entityType` (fullClassName string on
   `dataContext`; `{name,module}` on `autocomplete`).
2. Each field's `propertyName`/`componentName`/`label` → real camelCase entity
   properties [R-004]; datatable column `items` → your columns.
3. The Add button's `actionArguments.formId` → your create form.
4. Title text content; delete any debug text components.
5. `uniqueStateId`/`componentName` on each `dataContext` — unique per table.
6. Re-stamp ids on clones and `parentId` everywhere (descend into `components`,
   `columns[].components`, `tabs[].components`, `content.components`) [R-001].
7. Strip every node the request doesn't need — but never the validationErrors
   or the Submit/exit pair [R-020].

Scope notes: FK child tables filter an Entity-sourced `dataContext` with a
`permanentFilter` on the parent FK ([components/child-tables.md](components/child-tables.md));
M:M junction subtables use the Url-sourced `dataContext` canon
([components/junction-subtables.md](components/junction-subtables.md)); create
dialogs presetting a parent FK need `formArguments` AND `onPrepareSubmitData`
[R-045] ([components/add-dialogs.md](components/add-dialogs.md)).

- `editMode: "editable"` on the inputs (a standalone create/edit page is always in edit mode —
  `inherited` renders dead inputs here; that mode is only for the toggle-lifecycle detail view).
- `formSettings.layout: "vertical"` — a form with any sub-50%-width field row must not pair
  `layout:"horizontal"` with a global `labelCol` span (it truncates/crams the label the instant a
  row is narrower than full width; see [form-quality.md](form-quality.md)). Vertical layout has no
  such row-width dependency, so it's the safe default for any form with a column split.
- The `validationErrors` component (mandatory once any field is required).
- Buttons live **inside the `buttonGroup`**, never as standalone `type: "button"` components —
  tooling reads form intent largely from `buttonGroup` items, so loose buttons can get the
  form misread as read-only. Full reasoning: [form-quality.md](form-quality.md).

Beyond that floor, don't add what the request didn't ask for — no extra panels, no `modelType`
debug text. Match the component count to the field list + validationErrors + the one buttonGroup
(+ the optional title in the seed).

### Scope note — what these seeds do and don't cover

- The `record-detail-with-children` exemplar and `rs-subtable-tab-fragment.json` demonstrate **FK child tables**: an **Entity-sourced** `dataContext` filtered with a `permanentFilter` on the child's `<parentFk>` (shape below).
- **M:M junction subtables are NOT in this seed set** — they use the **Url-sourced** `dataContext` canon (code-object `endpoint` returning a `/api/dynamic/<module>/<Junction>/Crud/GetAll?filter=...` URL): see [components/junction-subtables.md](components/junction-subtables.md).
- **Create dialogs that preset a parent FK** need more than the create seed: pass the parent via `formArguments` on the opening button AND inject it in `formSettings.onPrepareSubmitData` — `setFieldsValue` alone never survives submit (the gql submitter serializes only `_formFields`): see [components/add-dialogs.md](components/add-dialogs.md).

## The CRUD loop (how table / create / detail fit together)

1. **Table** (`employee-table`/`rs-table`) lists records. Its toolbar **Add** button is a `buttonGroup` item with `buttonAction: "dialogue"` → `actionName: "Show Dialog"` (owner `shesha.common`) → `actionArguments.formId: { name: "<create-form>", module: "<module>" }`, `modalWidth: "60%"`, `formMode: "edit"`. It does **not** navigate. The Add button's `onSuccess` should be `Refresh table` with `actionOwner` = the `dataContext` **component id** (full shape below).
2. **Create** (`employee-create`/`rs-create-dialog`) renders inside that modal. `dataLoaderType: "gql"`, `dataSubmitterType: "gql"`; the dialog's OK button submits it via the form's default endpoints.
3. **Detail** (`record-detail-simple`/`record-detail-with-children` exemplars) opens a full record. The header `buttonGroup` carries the lifecycle: **Edit** = `Start Edit` (owner `shesha.form`), **Save** = `Submit` (owner `shesha.form`), **Cancel** = `Cancel Edit` (owner `shesha.form`), plus an optional **Audit Log** = `Show Dialog` → `entity-change-audit-log` (module `Shesha`). There is **no** manual navigate-back Save.
4. **Child tables** live in a `tabs` component; each tab is a `dataContext` + `datatable` filtered to the parent.

## Recommended improvement over the raw example: refresh the table after Add

The captured `employee-table` Add button has `handleSuccess: false`, so creating a record (verified: `POST .../api/dynamic/<Module>/<Entity>/Crud/Create` → 200) closes the modal but **does not refresh the list** — the user must reload to see their new row. For better UX, set the Add button's action to refresh the table on success:

```json
"handleSuccess": true,
"onSuccess": {
  "_type": "action-config",
  "actionName": "Refresh table",
  "actionOwner": "<dataContext component id>"
}
```

`actionOwner` must be the table's `dataContext` **component id** (the same owner the toolbar Refresh button uses). Keep `handleFail: true` + `onFail: Close Dialog`.

## Non-obvious specifics the examples encode

- **Data context type is `dataContext`** (canonical here) with `sourceType: "Entity"`, `entityType: "<full.Class.Name>"`, `dataFetchingMode: "paging"`, `defaultPageSize: 10`, `componentName`, `propertyName`, `sortMode: "standard"`, `allowReordering: "no"`. (`uniqueStateId` is NOT a real `dataContext` prop despite appearing in some older captures — framework-verified absent from `IDataContextComponentProps`; don't add it to a new form.)
- **Toolbar buttons are context-scoped**: Refresh = `actionName: "Refresh table"`, column toggle = `"Toggle Columns Selector"`, both with `actionOwner` set to the **dataContext component's id** (not `shesha.common`).
- **Side-by-side field layout is a flex `container` row** — two (or more) child `container`s each carrying `desktop.dimensions.width` (e.g. `"50%"`), inside a parent with `display:"flex"` + `flexDirection:"row"`. **Never the `columns` component** — this project's firm rule; a form seed that still shows `columns` has not yet been normalized (`scripts/normalize-form.mjs` converts it automatically).
- **Component choice is driven by the property's data type** — see [components/by-datatype.md](components/by-datatype.md).
- **Child-table filter** uses JsonLogic + mustache:
  ```json
  "permanentFilter": { "and": [ { "==": [
    { "var": "<parentFkProp>" },
    { "evaluate": [ { "expression": "{{data.id}}", "required": true, "type": "mustache" } ] }
  ] } ] }
  ```
- **`editMode: "inherited"`** on every component; the detail header's Start Edit/Cancel Edit toggles the whole form.
