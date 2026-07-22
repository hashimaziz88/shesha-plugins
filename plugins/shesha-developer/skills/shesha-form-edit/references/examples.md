# Example sources — golden archetypes first, fragments second

Two asset pools feed a build. Both are grep targets — never read a whole file
[R-050].

## 1. Golden archetypes (`assets/golden/`) — the primary clone source

`assets/golden/_index.json` indexes the 0.45 golden corpus: **table-worklist ·
record-detail · hub · capture · capture-standalone · modal-dialog · list-card ·
list-card-item · inline-card · dashboard**. Archetype keys match the blueprint
IR vocabulary (`shesha-design-comprehension/schemas/blueprint.schema.json`).

The normal path is the compiler: `scripts/compile-blueprint.js` clones the
closest archetype from the blueprint's `Archetype:` header and re-types it
(ids, versions [R-003], bindings, dataContext wrappers [R-005]). Manual cloning
is the fallback for hand-composition — pick via `_index.json` only, grep the
fragment you need, and re-stamp every id + `parentId` [R-001/R-002/R-025].

## 2. Canonical fragments (`assets/examples/`)

Small verbatim-captured forms for copying a specific mechanism:

| File | Use for |
|---|---|
| `employee-table.json` | dataContext + datatable worklist wiring (toolbar Add = Show Dialog modal, Refresh with dataContext-id owner [R-043]) |
| `entity-datalist.json` + `entity-card.json` | card list pair: the datalist (`dataContext` → `datalist`, `formSelectionMode: "name"`) and its row-template card form [R-048]. Copy BOTH; point the datalist's `formId` at your card form; `selectionMode: "multiple"` for multi-select. Do NOT use inline `items` — renders blank |
| `inline-editable-table.json` | in-row CRUD: `crud-operations` column + `{type, settings}` editors [R-010] |
| `standalone-create.json` | full-page create/edit floor: fields + validationErrors + Save (Submit/shesha.form) + Back (Navigate) [R-006/R-007/R-020] |
| `rs-link-add-dialog.json` | link-existing dialog (M:M junction add) |
| `rs-subtable-tab-fragment.json` | child-table tab fragment (dataContext + filtered datatable in a tab) |

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

Project-tied seeds live in `.claude/cache/shesha-form-edit/seeds/`, scratch in
`.claude/cache/shesha-form-edit/_archive/` — never in the shipped asset pools.
