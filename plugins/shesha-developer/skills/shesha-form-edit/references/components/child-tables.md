# Child tables on a detail view

> **Scope**: This file covers SIMPLE FK child tables (Entity-sourced + `permanentFilter` on `{{data.id}}`). For M:M JUNCTION subtables — Url-sourced dataContext, link/unlink, drill-down columns, delete actions — see [junction-subtables.md](junction-subtables.md); for the Add/create dialogs they open, see [add-dialogs.md](add-dialogs.md).

Pattern from `assets/exemplars/record-detail-with-children.json` (a compact, validator-clean exemplar of the tabs + filtered-child-datatable shape), `assets/examples/rs-subtable-tab-fragment.json` (a `dataContext` + filtered `datatable` child table in a tab), and the `record-detail` golden (`assets/golden/record-detail--rs-detail-with-header.json`) — verified live paging under a parent record.

A child table = related records that point back to the record on screen via a foreign key. Structure:

```
detail form
└─ tabs  (componentName: "childTables")
   └─ tab (title: "<Children>", e.g. "Payslips")
      └─ dataContext  (componentName: "childTableContext")
         ├─ entityType: "<full.Child.Class>"        // e.g. A.Test.Domain.Domain.Payroll.Payslip
         ├─ sourceType: "Entity"
         ├─ dataFetchingMode: "paging"
         ├─ permanentFilter: <see below>             // ties child rows to the parent record
         ├─ container (toolbar)
         │  ├─ datatable.quickSearch
         │  └─ datatable.pager
         └─ datatable  (the child grid; items = child columns)
```

## The parent→child filter (the crux)

`permanentFilter` is JsonLogic with a mustache `evaluate` that injects the parent record's id at runtime:

```json
"permanentFilter": {
  "and": [
    { "==": [
      { "var": "<childFkProperty>" },
      { "evaluate": [ { "expression": "{{data.id}}", "required": true, "type": "mustache" } ] }
    ] }
  ]
}
```

- `<childFkProperty>` is the **child entity's** FK property that references the parent (e.g. Payslip has `employee` → use `"employee"`; if PayGrade is the parent and Employee the child, Employee's FK is `payGrade` → use `"payGrade"`).
- `{{data.id}}` resolves to the open record's id (the detail form's `data`). Always use `{{double braces}}` — single-brace `{data.id}` is silently ignored at runtime.

## Multiple child tables

Add more `tab` entries to the same `tabs` component — each with its own `dataContext` + `datatable` + `permanentFilter` for that child entity. One tab per related entity.

## Gotchas

- The child `dataContext` needs its **own** `componentName` (don't reuse the main form's). (`uniqueStateId` is not a real `dataContext` prop — see `examples.md` — do not add it.)
- The child entity must have a working query endpoint — if it returns HTTP 400, the table chrome renders but rows won't load (a backend/entity-config issue, not a form issue; see Step 8.5).
- Inline add/edit on the child grid comes from the `datatable` `canAddInline` / `canEditInline` / `crud` props — copy them from the example as-is.
