# Component cheat-sheet — read THIS before opening any seed

A compact `type → current version → minimal shape` table so you don't read 4,000-line seeds or
run a dozen probes just to discover a version. **Versions are framework-version-specific** — the
numbers below are for `@shesha-io/reactjs 0.45.x`; if the running app differs, resolve once (see
bottom) and trust that.

> Every component must carry its integer `version` (a versionless component re-runs the whole
> legacy migration chain at render and can throw `e.match` / `reading 'migrator'` / `reading 'version'`).
> `parentId` is mandatory on every node (root-level → `"root"`). `id` must be a generated unique id — a UUID or a nanoid, never a short placeholder.

## Versions (0.45.x)

| type | version | type | version |
|---|---|---|---|
| `container` | 7 | `datatable` | 29 |
| `columns` | 5 | `dataContext` | 8 |
| `text` | 5 | `datalist` | 11 |
| `textField` | 6 | `datatable.pager` | 4 |
| `textArea` | 5 | `datatable.quickSearch` | 3 |
| `numberField` | 3 | `tableViewSelector` | 2 |
| `dateField` | 7 | `button` | 9 |
| `dropdown` | 7 | `buttonGroup` | 15 |
| `autocomplete` | 8 | `alert` | 2 |
| `checkbox` | 5 | `collapsiblePanel` | 7 |
| `checkboxGroup` | 5 | `refListStatus` | 3 |

## Minimal shapes (omit styling — the renderer applies defaults)

```jsonc
// input (string). number→numberField(v3), date→dateField(v7); same skeleton.
{ "id": "<uuid>", "type": "textField", "version": 6, "parentId": "<pid>",
  "propertyName": "name", "componentName": "name", "label": "Name", "editMode": "inherited", "textType": "text" }

// reference-list dropdown
{ "id": "<uuid>", "type": "dropdown", "version": 7, "parentId": "<pid>", "propertyName": "status", "label": "Status",
  "editMode": "inherited", "dataSourceType": "referenceList",
  "referenceListId": { "module": "<mod>", "name": "<ReflistName>" }, "valueFormat": "simple", "mode": "single" }

// entity FK autocomplete
{ "id": "<uuid>", "type": "autocomplete", "version": 8, "parentId": "<pid>", "propertyName": "assignedTo", "label": "Assigned To",
  "editMode": "inherited", "dataSourceType": "entitiesList", "entityType": { "name": "Person", "module": "Shesha" }, "mode": "single" }

// checkboxGroup (hardcoded) — items, NOT values; each {label,value}
{ "id": "<uuid>", "type": "checkboxGroup", "version": 5, "parentId": "<pid>", "propertyName": "tags", "label": "Tags",
  "dataSourceType": "values", "mode": "multiple", "referenceListId": null, "container": {}, "validate": {},
  "items": [ { "label": "A", "value": "a" } ] }

// dataContext (wrapper for datatable/datalist — needs explicit entityType + sourceType)
{ "id": "<uuid>", "type": "dataContext", "version": 8, "parentId": "<pid>",
  "entityType": "<exact modelType>", "sourceType": "Entity", "dataFetchingMode": "paging",
  "defaultPageSize": 10, "componentName": "<name>", "propertyName": "<name>" }

// buttonGroup (action buttons NEVER as standalone `button` in a toolbar)
{ "id": "<uuid>", "type": "buttonGroup", "version": 15, "parentId": "<pid>", "isInline": true, "editMode": "editable",
  "items": [ { "id": "<uuid>", "itemType": "item", "itemSubType": "button", "label": "Add", "buttonType": "primary",
    "actionConfiguration": { "_type": "action-config", "actionName": "Show Dialog", "actionOwner": "shesha.common",
      "actionArguments": { "formId": { "name": "<create-form>", "module": "<mod>" }, "modalWidth": "60%" } } } ] }
```

## Resolve versions for THIS app in ONE probe (if not 0.45.x)

```bash
# dumps every component type → version seen in the running backend's forms, in one call
TOKEN=...; curl -s "$BASE/api/services/Shesha/FormConfiguration/GetAll?MaxResultCount=1000" -H "Authorization: Bearer $TOKEN" \
 | python -c "import sys,json,collections; seen={}; \
def w(o):\n  import collections\n  pass"  # in practice: walk each form's stringified markup, record max version per type
```

Prefer this over reading large seed files. **Do not** read `table-worklist--employee-table.json`,
`capture-dialog--rs-create-dialog.json`, or other multi-thousand-line seeds wholesale — open them only with
`Grep`/offset for one specific fragment. Prefer `assets/exemplars/` first — every form there is
under ~400 lines and safe to read whole.
