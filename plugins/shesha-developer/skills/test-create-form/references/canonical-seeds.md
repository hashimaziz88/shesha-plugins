# Canonical seeds — the source of truth

Four seeds. Copy verbatim, swap the entity bits, push. Do not hand-author these structures.

Every seed under `assets/examples/` was captured verbatim from a live, correctly-rendering form on Shesha 0.45.x. Component versions, style blocks, action wirings, tab identity, permanentFilter shape — all correct. When something in the render doesn't match the seed, it's the build that's wrong, not the seed.

Full screenshots of every seed live at [`assets/screenshots/`](../assets/screenshots/). Compare your render to the screenshot before claiming a form is done.

## The four seeds

### `sample-patient-table.json` — table archetype

**Screenshot:** [assets/screenshots/sample-patient-table.png](../assets/screenshots/sample-patient-table.png)

- **`dataContext` at the ROOT of the tree**, wrapping the entire page (page-header + toolbar + table + pager). Not nested inside a container. Not merged with the form loader. Everything else lives INSIDE this dataContext so `entityType`, `sourceType:"Entity"`, `dataFetchingMode:"paging"`, `defaultPageSize:10` flow through.

- **Container-nesting = three-layer visual sandwich.** The seed's `dataContext` has ONE child: a `container(pageShell)` with `background.color: "#fafafa"` (grey) and `stylingBox` padding 20 all sides. Inside `pageShell` are TWO sibling `container`s, each a **white surface with `shadow` `rgba(0,0,0,0.05)` blur 8** — one wraps the page-header row, one wraps the toolbar+datatable+pager. Missing any layer produces the wrong background: no `pageShell` → the header floats bare on the canvas; only-tableSurface → the header has no card.

  ```
  dataContext(root)
  └─ container(pageShell)     bg #fafafa, padding 20              ← outer grey shell
     ├─ container(headerCard) bg #ffffff, subtle shadow, padding 15  ← white card #1
     │  └─ [page-header row: title-block + actions-block]
     └─ container(tableSurface) bg #ffffff, subtle shadow, marginTop 15, paddingBottom 15  ← white card #2
        ├─ container(toolbarRow) transparent, padding 15
        ├─ datatable
        └─ datatable.pager
  ```

- **`formSettings.dataLoaderType: "gql"`** and `dataSubmitterType: "gql"` — uniformly, even on the table.
- **`formSettings.onBeforeDataLoad`** = `"form.setFieldsValue({...form.formArguments});"` — pipes URL-query args into form state; keep it.

- **Toolbar is composed of three primitives** — copy by TYPE, don't invent buttons:
  - `datatable.quickSearch` (v=3) — the search input
  - `datatable.filter` (v=5) — the "Filters" text-link (a dedicated component, NOT a custom button)
  - `buttonGroup` with a single item `Column Selector` — action `Toggle Columns Selector`, `actionOwner: <datatable-component-id>`

- **Page-header actions** = ONE `buttonGroup` (`isInline: true`) with two items:
  - `Export` (default) — action `Export to Excel`, `actionOwner: <datatable-component-id>`
  - `Add <Entity>` (primary) — action `Show Dialog`, `actionOwner: shesha.common`, opens the create seed at `80%` width, on success runs `Refresh table` with `actionOwner: <datatable-component-id>`. Full wiring: [add-dialogs.md](add-dialogs.md).

- **Column shape** — every column carries `itemType:"item"`, `columnType:"data"`, `isVisible:true`, `allowSorting:true`, `minWidth`/`maxWidth`/`width` in px, and the three cell-component slots:
  - `displayComponent`: `{"type":"[default]"}` for plain-text OR a wrapped real component — see [§ settings-wrapper](#the-settings-wrapper-rule-for-custom-display-cells) below.
  - `editComponent`: `{"type":"[not-editable]"}`
  - `createComponent`: `{"type":"[not-editable]"}`

### `sample-patient-create.json` — create archetype

**Screenshot:** [assets/screenshots/sample-patient-create.png](../assets/screenshots/sample-patient-create.png)

- **`formSettings.modelType`** = `{ name, module }` object. `dataLoaderType: "gql"`, `dataSubmitterType: "gql"` — uses the entity's default endpoints; do not wire a custom submitter unless the request specifically demands one.

- **Body starts with a `text` subtitle** and a **`validationErrors` (v=0, no props)** — both above the first card.

- **Sections use the dedicated `card` component (v=3)** with `header` and `content` slots. The `header` slot holds a text explanation (right-aligned in the mockup); the `content` slot holds a **container(v=7, `desktop.display: "grid"`, `gridColumnsCount: 2`,`justifyContent": "normal"`,)** with all fields as direct children — NOT decomposed into multiple horizontal-flex row containers. See [§ Card content grid](#card-content--one-grid-container).

- **Every input `editMode: "editable"`** — `inherited` renders dead labels on a standalone create page. See [binding-rules.md § editMode-by-form-type](binding-rules.md#editmode-by-form-type).

- **Section fields — the right component per data-type:**
  - Composite address → the `address` component (dedicated), NOT a `textField` named `physicalAddress`.
  - Radio-style single choice (preferredLanguage) → `checkboxGroup` (v=5) `horizontal` + `dataSourceType:"values"` + `items:[{label,value}]`, NOT a `dropdown`.
  - Multi-select (chronic conditions, consent) → `checkboxGroup` (v=5, multi).
  - Rich in-form explanation → `htmlRender` (v=1).

- **No footer button row inside the form.** The create seed is opened in a modal (`modalWidth:"80%"`, `footerButtons:"default"`); the modal chrome supplies Save/Cancel. Adding an in-form Save row doubles up the buttons.

### `sample-patient-details.json` — details archetype

**Screenshots:** [overview](../assets/screenshots/sample-patient-details-overview.png) · [appointments](../assets/screenshots/sample-patient-details-appointments.png) · [prescriptions](../assets/screenshots/sample-patient-details-prescriptions.png) · [lab-results](../assets/screenshots/sample-patient-details-lab-results.png)

- **`formSettings.modelType`** = `{ name, module }` object. `dataLoaderType: "gql"`. `dataSubmitterType: "gql"`.

- **Root structure:**
  ```
  container(root)
  ├── hero row  (container, horizontal, gap: middle)
  │   ├── avatar + name-block
  │   │   ├── text (INITIALS — code expression, see below)
  │   │   └── column
  │   │       ├── name row (horizontal)
  │   │       │   ├── text "{{firstName}} {{lastName}}"     ← plain mustache (NOT {{data.*}})
  │   │       │   └── refListStatus(status)                  ← inline pill
  │   │       └── text (meta line — code expression using moment)
  │   └── actions column
  │       └── buttonGroup [Edit / Save / Cancel Edit]        ← lifecycle, all shesha.form
  ├── container (quick-actions bar)
  │   └── buttonGroup [Book Appointment / Prescription / Order lab test]
  └── tabs (v=4) [Overview / <child-1> / <child-2> / …]
      ├── Overview  → N × card (v=3) sections stacked vertically
      └── each child tab → dataContext(childEntity, permanentFilter) → toolbar + datatable + pager
  ```

- **Hero avatar initials — TEXT with a CODE expression** (NOT a plain "•"):
  ```jsonc
  {
    "type": "text", "version": 5,
    "content": {
      "_mode": "code",
      "_code": "const getInitials = (first, last) => ((first || '').trim()[0] || '').toUpperCase() + ((last || '').trim()[0] || '').toUpperCase(); return getInitials(data.firstName, data.lastName)"
    }
  }
  ```

- **Hero name text uses `{{firstName}} {{lastName}}`** — NOT `{{data.firstName}}` (silently renders empty). See [binding-rules.md § mustache](binding-rules.md#mustache-in-plain-string-bindings).

- **Every input `editMode: "inherited"`** — the details form starts in view-mode; the Edit lifecycle button flips it. Do NOT set `editable`.

- **Lifecycle buttons** are ONE `buttonGroup` (`isInline: true`) with THREE items — all `actionOwner: "shesha.form"`:
  - Edit → `actionName: "Start Edit"` (`buttonType: "primary"`)
  - Save → `actionName: "Submit"` (`buttonType: "default"`)
  - Cancel Edit → `actionName: "Cancel Edit"` (`buttonType: "default"`)
  All three are always in the DOM; Shesha handles visibility via the form's editMode.

- **Tabs identity: `tab.key === tab.id`, both unique across the tabs array.** The `tabs` component (v=4) uses `key` to route rendered content. When cloning a tab body, regenerate BOTH `tab.id` AND `tab.key` to the SAME fresh 30-char alphanumeric string per tab. See [§ tab-identity](#tab-identity).

- **Child-tab filtering — `permanentFilter` on the tab's `dataContext`** (not on the datatable). Uses JsonLogic + mustache `evaluate`:
  ```jsonc
  {
    "and": [{
      "==": [
        { "var": "<parentFkProp>" },
        { "evaluate": [{ "expression": "{{data.id}}", "required": true, "type": "mustache" }] }
      ]
    }]
  }
  ```
  **Do NOT use `_mode: "code"` for the filter** — the backend expects the JsonLogic shape; `_mode: "code"` returns a JS-object that hits the Entities/GetAll endpoint with the wrong query and 400s.

- **`componentName` uniqueness in cloned tab bodies.** When you duplicate a tab body (e.g. copy the sample's Appointments-tab subtree to build Prescriptions + Lab Results tabs), rename every `componentName` in the cloned subtree with a per-tab prefix (`personsQuickSearch`, `addressesPager`, etc.). Avoids `uniqueStateId` scope collisions on toolbar Refresh/Export/Column-Selector actions.

### `sample-patient-subform.json` — mini-card archetype

The reusable row-template card: `[avatar-with-initials-text] [name-link | subtitle-text]`. Embed it as the Patient column's row-template in a datatable, or as the details-hero avatar row. The Name link's `href` is a code expression:

```jsonc
{
  "type": "link", "version": 5,
  "href": {
    "_mode": "code",
    "_code": "return `/dynamic/<Module>/<details-form-name>?id=${data.id}`"
  }
}
```

Embed in a table's primary column by setting `datatable.items[<primary col>].displayComponent = { type: "subForm", settings: { formSelectionMode: "name", formName: "sample-patient-subform" (or your equivalent) } }`.

---

## The `settings`-wrapper rule for custom display cells

**The highest-frequency crash source.** A datatable column's `displayComponent` / `editComponent` / `createComponent` accepts two shapes only:

1. **Sentinels** — `{ "type": "[default]" }` or `{ "type": "[not-editable]" }`. No wrapper.

2. **Real component** (`refListStatus`, `entityReference`, `dropdown`, etc.) — MUST be wrapped:
   ```jsonc
   {
     "type": "refListStatus",
     "settings": {
       "id": "<uuid>",
       "type": "refListStatus",          // repeat the type inside
       "version": 6,                     // REQUIRED — omitting crashes with 'reading version'
       "propertyName": "editor",         // literally "editor"
       "hideLabel": true,
       "hidden": false,
       "isDynamic": false,
       "referenceListId": { "module": "<Module>", "name": "<RefListName>" },
       "desktop": { …full v7 block, height 24px, radius 4, hairline border… },
       "enableStyleOnReadonly": false
     }
   }
   ```

Flat `{ type: "refListStatus" }` (no settings) crashes on current datatable (v=29) with `Cannot read properties of undefined (reading 'version')`. Same rule for `entityReference`, `dropdown`, `dateField` as a display component. Only `[default]` and `[not-editable]` are settings-free.

## Card content = ONE grid container (or field-holding containers, if multiple)

Every `card` (v=3) in a details Overview tab or a create form section has this content pattern:

- **Simple case (all fields fit in one grid):** `card.content.components = [ one container(v=7, desktop.display:"grid", gridColumnsCount:2, direction:"vertical", gap:8,"justifyContent": "normal",) with ALL fields as direct children ]`.

- **Mixed case (grid rows + span-full siblings):** `card.content.components = [ container(grid), address-component, container(grid), htmlRender, textArea, … ]`. Each container child that HOLDS fields uses grid; standalone `address` / `htmlRender` / `textField` / `textArea` sit as span-full siblings.

- **`gridColumnsCount` can be 2 OR 3** — sample's Medical card uses 3 for `bloodType / heightCm / weightKg` on one row. Never 1; never 4+.

- **Do NOT decompose into multiple horizontal-flex row containers** (one per pair of fields). That visibly renders 2 columns but loses the seed's field-spacing behaviour.

## Tab identity

For every entry in a `tabs.tabs` array:

- `tab.id` = a fresh 30-char alphanumeric string
- `tab.key` = the SAME string as `tab.id`
- Every `tab.id` in the array is unique

```jsonc
// CORRECT
{ "id": "3Dz3RCIo49ZYnz_ZhCE063DhTG9Ou2", "key": "3Dz3RCIo49ZYnz_ZhCE063DhTG9Ou2", "name": "Tab 1", "title": "Overview", "components": [...] }

// WRONG — duplicate id across tabs → React key collision → BOTH tab bodies render
{ "id": "sNTp5jbm5TCmoVc7pAy_r9kJ5TbBKd", "key": "abc123...", "title": "Persons",   ... }
{ "id": "sNTp5jbm5TCmoVc7pAy_r9kJ5TbBKd", "key": "def456...", "title": "Addresses", ... }

// WRONG — id !== key → tab routing loses the mapping → same double-render behaviour
{ "id": "3Dz3RCIo49ZYnz_ZhCE063DhTG9Ou2", "key": "78TH9hmAO68vwbg7_RFp4JaSXuahTh", ... }
```

## Child-tab filtering — `permanentFilter`

On the child tab's `dataContext` (NOT the datatable). Shape:

```jsonc
"permanentFilter": {
  "and": [{
    "==": [
      { "var": "<parentFkProp>" },
      { "evaluate": [{ "expression": "{{data.id}}", "required": true, "type": "mustache" }] }
    ]
  }]
}
```

Where `<parentFkProp>` is the child entity's FK property that references the parent (e.g. `partOf` on `NotificationMessage`, `patient` on `Appointment`, `organisation` on `OrganisationAddress`). `{{data.id}}` resolves to the open record's id — always double-brace, never single.

**Do NOT use `_mode: "code"` for `permanentFilter`** — it's a documented mistake that produces a 400 on `Entities/GetAll`. The backend expects the JsonLogic shape above; code-mode returns a JS object the query builder can't serialise.

---

## The swap checklist

Every seed you copy from `assets/examples/sample-patient-*` gets this pass, in order. Nothing is optional.

1. **`formSettings.modelType`** → `{ name: "<YourEntity>", module: "<YourModule>" }` (the exact `name` + `module` you resolved from `EntityConfig/GetMainDataList`). Not a string, not a guess.
2. **Every `dataContext.entityType`** → same `{ name, module }` object, one per dataContext (parent for the root; children for tab-scoped filters).
3. **Every field `propertyName` / `componentName` / `name` / `label`** → real camelCase property (path from metadata, lowercased first char) + sentence-case label ("First name", not "First Name" or "FirstName").
4. **Every datatable column** — the `items[]` list → your entity's real columns (matching camelCase). Preserve the wrapped-`settings` shape on any status / entity-reference / date columns.
5. **Every `formId` reference** in action arguments → your family's form names (`sample-patient-create` → `<yourentity>-create`, `sample-patient-details` → `<yourentity>-details`).
6. **Every `actionOwner: "<datatable-id>"`** — after regenerating IDs, remap so Export/Refresh/Column-Selector actions point at the actual `datatable` component's new `id`.
7. **The child-tab `permanentFilter`s** — `<parentFkProp>` → your child entity's FK property name (e.g. `patient` → `partOf` for NotificationMessage under Notification).
8. **The hero avatar/meta code expressions** — `data.firstName`/`data.lastName`/`data.patientCode`/etc. → your entity's equivalent fields. Keep the `moment().diff` age pattern where applicable.
9. **The subform's `href` code expression** — `sample-patient-details` → your details form name; `Forms.Optimization` → your module (if different).
10. **Re-run `stampTree`** so every `parentId` is fresh and points at the direct parent's `id`. Descend into `components`, `columns[].components`, `tabs[].components`, `content.components`, `header.components`.
11. **All `id`s** → fresh `crypto.randomUUID()`. Short IDs like `pr1`, `btn2` don't work — the renderer ignores non-UUID ids and the form renders blank.
12. **Tab identity**: for every entry in a `tabs.tabs` array, generate ONE fresh 30-char alphanumeric string; assign it to BOTH `tab.id` AND `tab.key`. Never leave the seed's original tab ids in place (they collide) and never set `tab.key` different from `tab.id`.
13. **componentName uniqueness across cloned tab bodies**: when you clone a tab body for multiple child collections, prefix every `componentName` in the cloned subtree with the per-tab short name.
14. **Text mustache**: any plain-string `text.content`, `link.href` (plain-string), `refListStatus.propertyName`, `button.actionArguments.target` that binds an entity property uses `{{propertyName}}` — never `{{data.propertyName}}`. Code-mode is the only place `data.` is valid.
15. **Card content = grid container(s)**: for every `card` in the details / create form, `card.content.components` contains at least one `container(v=7, desktop.display: "grid", gridColumnsCount: 2 or 3,"justifyContent": "normal",)` holding fields as direct children.
16. **Every `buttonGroup` has `isInline: true`**. Otherwise buttons collapse into a "..." dropdown menu.
17. **Every reference-list field** (dropdown / `refListStatus` / radio) → `dataSourceType: "referenceList"` + `referenceListId: { module, name }` copied **verbatim from `Metadata/GetProperties`** (`referenceListModule` / `referenceListName`). **Never call a `ReferenceList/*` endpoint to fetch or verify items, and never loop on one** — the frontend loads them at render. Framework lists keep their seed binding as-is: Gender is `{ "module": "Shesha", "name": "Shesha.Core.Gender" }` (module `Shesha`, dotted name — **not** `{ module: "Shesha.Core", name: "Gender" }`). See [binding-rules.md § Reference-list fields](binding-rules.md#reference-list-fields-bind-from-metadata-never-fetch).

Full failure modes per rule → the validator's exit output when it flags them.
