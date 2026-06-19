# dataContext, datatable, datalist

> Versions + minimal shapes: [../component-cheatsheet.md](../component-cheatsheet.md). Read that before opening a large table seed.

---

## Table vs List — pick the component from the user's wording (decide this FIRST)

`datatable` and `datalist` are **different deliverables, not interchangeable.** Before picking a seed, read the noun the user used and build *that* component:

| User's wording | Build | Inner component | Seed |
|---|---|---|---|
| **table**, grid, spreadsheet, "columns", tabular, "rows of", manage / admin index | a **table** | `datatable` (column grid) | `assets/examples/employee-table.json` |
| **list**, "list of X", card(s), feed, tiles, gallery, directory, board | a **list** | `datalist` (repeating card view) | `assets/examples/entity-datalist.json` |

Rules:

- **Honor the explicit noun even when the other would also render the data.** "Give me a **list** of pending tasks" is a `datalist`, NOT a datatable — even though a table could show the same rows. "Show it in a **table**" is a `datatable`, even if cards would look nicer.
- **A "list" is NEVER satisfied by stacked static `container` cards.** Repeating data is a `datalist` bound to a `dataContext`. Hand-built container cards are a defect — they don't page, filter, select, or bind to the entity.
- **Neither word, and the layout is genuinely ambiguous** (e.g. "show me the customers") → **ask the user: table or list?** before building. Don't silently pick one.
- Both wrap the **same `dataContext`** (it owns the entity query + paging + sort + filter). They differ ONLY in the inner display component, so switching between them is a one-component swap inside the wrapper.

---

## Lean by default — add only what the prompt asks for

A table's DEFAULT footprint is: `dataContext` → (`datatable.quickSearch` + `datatable.pager`) → `datatable`. **Do NOT add `tableViewSelector`, `datatable.filter`, a column-toggle button, a Refresh button, or an Export button unless the prompt explicitly asks for filtering / column control / refresh / export.** The configuration-studio's table generator emits all of that chrome — when you seed from it, strip what wasn't requested. Unrequested toolbar chrome is a quality defect.

A **list's** DEFAULT footprint is leaner still: `dataContext` → `datalist` (+ `datatable.pager`; add `datatable.quickSearch` **only if** search is requested). Same lean rule — no `tableViewSelector` / filter / column-toggle / refresh / export chrome unless the prompt asks for it.

**Toolbar buttons go in a `buttonGroup`, never as standalone `type:"button"` nodes** (a bare button in a toolbar is a defect, and the standalone Refresh/Columns buttons the generator emits must be removed or grouped). If the table has any action button, exactly one is `buttonType:"primary"`.

**Add affordance depends on the table type:**
- **Inline-editable table** (the prompt says "edit/add/remove *in the rows*"): add is the in-row capture row (`canAddInline:"yes"` + `newRowCapturePosition:"top"`) and a `crud-operations` column gives per-row Edit/Delete. **No toolbar "New" button** — it's redundant and there is no valid toolbar inline-add action (wiring one to `Add list items` throws "action not found"). See [inline-editable-tables.md](inline-editable-tables.md).
- **Display / modal-CRUD table**: ONE primary "Add" button (in a `buttonGroup`) wired to `Show Dialog` opening the create form. This is the standard generator pattern.

---

## Wrapper rule (non-negotiable)

**`datatable` and `datalist` MUST be wrapped in a `dataContext`.** Never put them at root with `entityType` / `sourceType` set on the component itself — that pattern technically renders something in some Shesha versions but is wrong and brittle:

- The data-fetching, paging, sorting, and filtering all live on the **context wrapper**, not the table/list. Putting them on the inner component means they don't get re-evaluated when filters or sort change, and external components (toolbar buttons, refresh actions) can't target them by `actionOwner: "<contextId>"`.
- Built-in actions (`Refresh table`, `Export to Excel`, quick-search wiring) all expect to find a `dataContext` ancestor. Without it, they silently no-op.
- Sub-form-renderer datalists (`formSelectionMode: "name"` with a row-template form) inherit the row data from the context's current row. Without the context, the row template gets nothing.

Common symptoms of a missing wrapper: "datalist isn't refreshing after I change the filter", "the export button does nothing", "the row template isn't seeing the row data". Walk up the `parentId` chain from the datalist; if there isn't a `dataContext` ancestor, that's the bug.

**Only exception**: a datalist with hardcoded `items` (not entity-bound) — e.g. inline help-style display. Even then, prefer the wrapper unless you have a specific reason.

---

## Canonical entity-bound list (datalist — row-template mode)

This is the **verified** datalist shape (matches `assets/patterns/dashboard.json`): each row is rendered by a **separate named form** via `formSelectionMode: "name"` + `formId`.

```json
{
  "id": "...",
  "type": "dataContext",
  "propertyName": "tiersContext",
  "componentName": "tiersContext",
  "sourceType": "Entity",
  "entityType": "PBF.MembershipManagement.Domain.Domain.Tier",
  "defaultPageSize": 25,
  "dataFetchingMode": "paging",
  "sortMode": "standard",
  "strictSortBy": "sortOrder",
  "strictSortOrder": "asc",
  "permanentFilter": { "==": [{"var": "mode"}, {"var": "modeFilter"}] },
  "components": [
    { "id": "...", "type": "datatable.quickSearch" },
    {
      "id": "...",
      "type": "datalist",
      "version": 11,
      "formSelectionMode": "name",
      "formId": { "module": "PBF.MembershipManagement", "name": "tier-card" },
      "formType": "Table",
      "orientation": "wrap",
      "listItemWidth": 0.25,
      "selectionMode": "none"
    },
    { "id": "...", "type": "datatable.pager" }
  ]
}
```

The `datalist` here has **no** `entityType`, **no** `sourceType`, **no** `permanentFilter`, **no** `properties` — it inherits them all from the wrapper. Same rule for `datatable`.

---

## Datalist — binding modes, multi-select, and no-entity data

A `datalist` (v11) renders the wrapper's rows as repeating cards. Two ways to define what each card looks like:

- **(b) Row-template form (`formSelectionMode: "name"` + `formId`) — THE DEFAULT. Verified rendering.** Each row is rendered by a separate named **card form**; the row entity is exposed to that card form via `propertyName` bindings / `{{mustache}}` (its `data`). This is the proven pattern — it matches `assets/patterns/dashboard.json`, the canonical block above, and is the shape shipped by the seed pair `assets/examples/entity-datalist.json` + `assets/examples/entity-card.json` (live-verified against `@shesha-io/reactjs 0.45.x`). Shape:
  ```json
  {
    "type": "datalist", "version": 11,
    "formSelectionMode": "name",
    "formId": { "module": "<module>", "name": "<entity>-card" },
    "formType": "Table",
    "selectionMode": "none",
    "orientation": "wrap", "listItemWidth": 0.33,
    "showBorder": true, "gap": 12
  }
  ```
  The card form (`<entity>-card`) is a small `dataLoaderType: "none"` form bound to the **same entity**; its `text`/`refListStatus`/field components bind to the row via `propertyName` or `{{mustache}}`. `showBorder` + `gap` on the datalist give each row its card chrome (so the card form itself needs no border styling).
- **(a) Inline card (`items: []`) — DO NOT USE on 0.45.x.** Defining the card inline via `items: []` is **not supported** on the tested framework version: the `dataContext` fetches the rows (the pager even shows the count), but the datalist renders **"No data is available for this list"** and throws **"Maximum update depth exceeded"** (infinite render loop). `items` is not an enumerated `datalist` prop. Only consider it if a future Shesha version documents it — and browser-verify (Step 9) before relying on it. Until then, **always use mode (b).**

**Multi-select list** — set `selectionMode: "multiple"` on the datalist for "select several at once" (gives per-card + header selection). `"single"` for one, `"none"` (default) for a read-only list. This is the list-shaped answer to "operator can select multiple items" — do NOT reach for a datatable just because the ask mentions multi-select.

**Card styling (rounded corners, soft shadow, etc.)** lives on the datalist's card container style channels (`showBorder`, `gap`, `cardHeight`/`cardMinWidth`/`cardMaxWidth`, and the container style panels) — see [styling-v7.md](styling-v7.md). A "polished cards" ask is styling on the `datalist`, not a reason to hand-build static containers. For the per-field rules that make card text actually render (name-mode binding, `dimensions: fit-content`, single-line `ellipsis`, chip-on-its-own-row, and style-based padding/overflow), see **Building the row-template card form** below.

**No entity yet? A datalist still needs a data source.** A `datalist` is bound through its `dataContext`, so it cannot display a card list for an entity that doesn't exist. If the target entity is missing (Step 4.5 metadata 404), **create it first** via `shesha-developer:domain-model` (then rebuild/restart per [backend-restart.md](../backend-restart.md) and bind). Only for a genuine static/demo list use hardcoded rows — but the component is still a `datalist`, **never** stacked static `container` cards.

### Building the row-template card form (0.45 runtime rules — runtime-verified)

The datalist renders each row's card form inside a cell that **collapses `ant-form-item` heights and forces `white-space: nowrap`**. Plain text components therefore overlap, clip, or vanish unless the card form is built this way (all verified live on 0.45.x; the `entity-card.json` seed encodes them):

- **Bind values with NAME mode, not content mode.** Each field = `text` with `contentDisplay: "name"` + `propertyName: "<prop>"` + `content: "{{data.<prop>}}"` + `textType: "paragraph"`. A `text` in **content mode with a `{{mustache}}` value renders EMPTY** inside a card cell — content mode is only for STATIC decoration text (e.g. a `★` or `/ 5` separator).
- **Give every field `dimensions: { minHeight: "fit-content", height: "auto", maxHeight: "auto", … }`.** Without it the field's form-item collapses to ~0 height and the text overflows / overlaps its neighbours.
- **Long text (quote / description) → clamp to a single line:** set `ellipsis: true` AND a legacy `style` string `"return { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', display: 'block' }"`. Multi-line text in a card cell collapses and overflows **upward** (clips at the card top); clamping to one line is the reliable fix.
- **`refListStatus` / status chip goes on its OWN full-width row** (a single-element container row). In a shared `space-between` row inside a card cell it collapses to a stray glyph or disappears entirely.
- **Inner padding + no-scroll go on the card container via the legacy `style` prop, NOT `stylingBox`** (which does not apply on the card container in this context): `"style": "return { whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'hidden', padding: '20px 22px', boxSizing: 'border-box' }"`. `overflow: hidden` clips the nowrap quote so the cell shows **no scrollbar**; `padding` keeps text off the border. Set the card container `dimensions.height: "auto"` — **never `"100%"`** (that triggers the inner scroll + overlap).
- Card chrome (border radius, white background, soft shadow) on the card container's v7 channels (`border` / `background` / `shadow`) renders fine — only `stylingBox` padding is the channel that doesn't take here.

Copy `assets/examples/entity-card.json` (the verified card) and swap the entity + field `propertyName`s. Symptom→fix table: [debug.md](../debug.md).

---

## URL-bound list (custom endpoint)

```json
{
  "type": "dataContext",
  "sourceType": "Url",
  "endpoint": "/api/services/app/EntityHistory/GetAuditTrail?entityId={{data.id}}&entityTypeFullName={{data.modelType}}",
  // Note: mustache expressions always use {{double braces}} — single {brace} is silently ignored
  "defaultPageSize": 10,
  "components": [ /* datatable or datalist */ ]
}
```

---

## Inner components quick reference

| Type | Purpose |
|---|---|
| `datatable` | Column-based grid view. Columns go in `items: []`. Sorting/filter/paging inherited from the wrapper. **Inline editing** (edit/add/delete directly in rows) has its own contract — see [inline-editable-tables.md](inline-editable-tables.md). |
| `datatable.quickSearch` | Search box that targets the wrapper's data |
| `datatable.pager` | Pagination controls |
| `datatable.toolbar` | Toolbar slot (Add / Refresh / Export buttons; their `actionOwner` typically references the wrapper's id) |
| `datalist` | Card / list view — the inner component for a **"list"** request (see the Table vs List decision above). Binding modes (a) inline `items: []` or (b) `formSelectionMode: "name"` + `formId` row template — full detail in **Datalist — binding modes** below. Cards lay out via `orientation` (`vertical` / `horizontal` / `wrap`) + `listItemWidth`; multi-select via `selectionMode: "multiple"` |

### Dynamic permanentFilter via IPropertySetting code mode

```json
"permanentFilter": {
  "_mode": "code",
  "_code": "data?.tierId ? JSON.stringify({ '==': [{ var: 'tier.id' }, data.tierId] }) : JSON.stringify({ '==': [1, 0] })"
}
```

The `{ '==': [1, 0] }` fallback returns no rows — useful when the filter dependency hasn't loaded yet.

---

## Row template (sub-form-renderer datalist)

When `formSelectionMode: "name"` is set with a `formId: { module, name }`, the datalist renders each row using that form. The row data is exposed inside the row template's scripts as `data` (the row entity instance). Wrap the row template in its own form (e.g. `tier-card`, `tier-benefit-row`) and treat it as a regular entity-bound form.
