# Component cheat-sheet — read THIS before opening any seed

A compact `type → current version → minimal shape` table so you don't read 4,000-line seeds or
run a dozen probes just to discover a version. **Versions are framework-version-specific** — the
numbers below are the documented **fallback** for `@shesha-io/reactjs 0.43.x`. **The runtime
version-probe (top of this file) is authoritative** — census the running backend's own forms and
author every component at THOSE versions; use the table only when a probe isn't possible.

> Every component must carry its integer `version` (a versionless component re-runs the whole
> legacy migration chain at render and can throw `e.match` / `reading 'migrator'` / `reading 'version'`).
> `parentId` is mandatory on every node (root-level → `"root"`). `id` must be a real UUID.

## Versions (0.43.x — fallback; the runtime version-probe above is authoritative)

| type | version | type | version |
|---|---|---|---|
| `container` | 7 | `datatable` | 11 |
| `columns` | 5 | `datatableContext` | 8 |
| `text` | 5 | `datalist` | 8 |
| `textField` | 6 | `datatable.pager` | 4 |
| `textArea` | 4 | `datatable.quickSearch` | 3 |
| `numberField` | 5 | `tableViewSelector` | 2 |
| `dateField` | 7 | `button` | 9 |
| `dropdown` | 10 | `buttonGroup` | 13 |
| `autocomplete` | 8 | `alert` | 2 |
| `checkbox` | 5 | `collapsiblePanel` | 9 |
| `checkboxGroup` | 5 | `refListStatus` | 4 |

This is a **full live census from ONE 0.43 backend** (all forms, every nested value; probed
2026-07-01). This is a newer 0.43 (~0.43.33) so many versions match 0.45 — but **versions DRIFT
across 0.43 point releases**: an OLDER 0.43 backend was measured at `container` 6, `text` 2,
`textField` 5, `buttonGroup` 10, `collapsiblePanel` 8. So **treat this table as a fallback and run
the probe (STEP 1 above) against YOUR backend** — that is authoritative, and it must walk EVERY form
and EVERY nested value (a partial sample under-counts and gives too-low versions). Ranges seen across
0.43 releases: `datatable` 10–11, `datalist` 7–8. **Probe-resolve (no form used these on the probed
backend — census yours, do NOT hardcode):** `card`, `progress`, `KeyInformationBar`.

## Minimal shapes (omit styling — the renderer applies defaults)

```jsonc
// input (string). number→numberField(v5), date→dateField(v7); same skeleton.
{ "id": "<uuid>", "type": "textField", "version": 6, "parentId": "<pid>",
  "propertyName": "name", "componentName": "name", "label": "Name", "editMode": "inherited", "textType": "text" }

// reference-list dropdown
{ "id": "<uuid>", "type": "dropdown", "version": 10, "parentId": "<pid>", "propertyName": "status", "label": "Status",
  "editMode": "inherited", "dataSourceType": "referenceList",
  "referenceListId": { "module": "<mod>", "name": "<ReflistName>" }, "valueFormat": "simple", "mode": "single" }

// entity FK autocomplete
{ "id": "<uuid>", "type": "autocomplete", "version": 8, "parentId": "<pid>", "propertyName": "assignedTo", "label": "Assigned To",
  "editMode": "inherited", "dataSourceType": "entitiesList", "entityType": "Shesha.Domain.Person", "mode": "single" }  // 0.43: entityType is a STRING (fullClassName), NOT {name,module}

// checkboxGroup (hardcoded) — items, NOT values; each {label,value}. (probed backend: v5 — verify via STEP 1)
{ "id": "<uuid>", "type": "checkboxGroup", "version": 5, "parentId": "<pid>", "propertyName": "tags", "label": "Tags",
  "dataSourceType": "values", "mode": "multiple", "referenceListId": null, "container": {}, "validate": {},
  "items": [ { "label": "A", "value": "a" } ] }

// datatableContext (wrapper for datatable/datalist — needs explicit entityType + sourceType)
{ "id": "<uuid>", "type": "datatableContext", "version": 8, "parentId": "<pid>",
  "entityType": "<exact modelType>", "sourceType": "Entity", "dataFetchingMode": "paging",
  "defaultPageSize": 10, "uniqueStateId": "<name>", "componentName": "<name>", "propertyName": "<name>" }

// buttonGroup (action buttons NEVER as standalone `button` in a toolbar). isInline:true so items don't collapse to an overflow menu on 0.43.
{ "id": "<uuid>", "type": "buttonGroup", "version": 13, "parentId": "<pid>", "isInline": true, "editMode": "editable",
  "items": [ { "id": "<uuid>", "itemType": "item", "itemSubType": "button", "label": "Add", "buttonType": "primary",
    "actionConfiguration": { "_type": "action-config", "actionName": "Show Dialog", "actionOwner": "shesha.common",
      "actionArguments": { "formId": { "name": "<create-form>", "module": "<mod>" }, "modalWidth": "60%" } } } ] }
```

## STEP 1 (authoritative) — probe THIS backend's own forms for the real versions

Do this FIRST, before trusting the fallback table above. It censuses every form the running
0.43 backend already has and records the **max `version` seen per component type** — those are the
versions to author at, because they are exactly what this backend's render-time migrations expect.

```bash
# One call: dump every form's markup, walk it, print `type → max version` seen live.
TOKEN=...   # bearer from the admin login (see version-lifecycle.md)
BASE="$BASE_URL"
curl -s "$BASE/api/services/Shesha/FormConfiguration/GetAll?MaxResultCount=1000" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e '
    const fs = require("fs");
    const res = JSON.parse(fs.readFileSync(0, "utf8"));
    const forms = res.result?.items ?? res.result ?? res.items ?? [];
    const max = {};
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (typeof n.type === "string" && Number.isFinite(n.version))
        max[n.type] = Math.max(max[n.type] ?? 0, n.version);
      for (const k of Object.keys(n)) walk(n[k]);   // recurse every value: components, items, tabs, columns, content, header…
    };
    for (const f of forms) {
      let m = f.markup;
      if (typeof m === "string") { try { m = JSON.parse(m); } catch { continue; } }
      walk(m?.components ?? m);
    }
    Object.entries(max).sort((a,b) => a[0].localeCompare(b[0]))
      .forEach(([t,v]) => console.log(`${t}\t${v}`));
  '
```

Author every component at the version this prints for its type. For a type the probe does not
print (the backend has no form using it yet), fall back to the table above; for a **probe-resolve**
type with no table value either, seed it from an existing form that uses it (the designer's output
is canonical) rather than guessing.

Prefer this over reading large seed files. **Do not** read `employee-table.json`,
`rs-detail-with-header.json`, or other multi-thousand-line seeds wholesale — open them only with
`Grep`/offset for one specific fragment.
