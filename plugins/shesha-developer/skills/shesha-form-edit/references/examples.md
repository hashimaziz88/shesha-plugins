# Example sources — golden archetypes first, fragments second

Two asset pools feed a build. Both are grep targets — never read a whole file
[R-050].

## 1. Golden archetypes (`assets/golden/`) — seed/reference tier

`assets/golden/_index.json` indexes the 0.45 golden corpus — one golden file
per archetype, plus two extra file variants (`capture-standalone`,
`list-card-item`) filed under their parent archetype, not standalone
archetypes: **table-worklist · record-detail · hub · capture**
(+ `capture-standalone` file, a minimal capture variant) **· modal-dialog ·
list-card** (+ `list-card-item` file, the datalist row-template card) **·
inline-card · dashboard · auth-page**. Archetype keys match the blueprint IR
vocabulary — the schema enum is the single authority
(`shesha-design-comprehension/schemas/blueprint.schema.json`).

The normal path is the compiler: `scripts/compile-blueprint.js` builds the
layout tree directly from the blueprint (ids, versions [R-003], bindings,
dataContext wrappers [R-005]) — it never reads the golden corpus. Golden files
serve hand-composition (no archetype-shaped compiler path fits, exotic
component mix) and regression comparison — pick via `_index.json` only, grep
the fragment you need, and re-stamp every id + `parentId` [R-001/R-002/R-025].

## 2. Pattern fragments (`assets/examples/`)

Whole-screen shapes (worklist table, card list, inline-CRUD table, standalone
create) are golden archetypes — section 1. `examples/` holds only the two
sub-screen **fragments** that no single archetype covers, for grafting into a
hub/detail build:

| File | Use for |
|---|---|
| `rs-link-add-dialog.json` | link-existing dialog (M:M junction add) — [components/junction-subtables.md](components/junction-subtables.md) |
| `rs-subtable-tab-fragment.json` | child-table tab fragment (`dataContext` + filtered `datatable` in a tab) — [components/child-tables.md](components/child-tables.md) |

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
