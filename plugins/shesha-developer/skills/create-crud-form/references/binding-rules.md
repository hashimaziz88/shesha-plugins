# Binding rules

Rules for wiring components to entity data. Every rule here corresponds to a silent-drop-on-render defect actually observed on live builds — and every one is enforced by [`scripts/validate-form-markup.cjs`](../scripts/validate-form-markup.cjs).

## `propertyName` is always camelCase

Entity GQL field keys are camelCase, but `Metadata/GetProperties` returns `path` in **PascalCase** (`FirstName`, `PatientCode`, `ScheduledDateTime`). Copy those PascalCase names straight into a component's `propertyName` and the data-fetch still works (row count is correct) but every cell renders **blank** — the accessor reads the literal PascalCase key against camelCase row data.

Rule: **lower-case the first letter of every `propertyName`**. `FirstName` → `firstName`, `ScheduledDateTime` → `scheduledDateTime`, `MedicalAidMemberNumber` → `medicalAidMemberNumber`.

Same rule for `datatable` column `propertyName`s and `dataContext.entityType.name`. Reference-list names in `referenceListId` are usually PascalCase — leave those as-is (they're identifiers, not property paths).

## Mustache in plain-string bindings

**`{{propertyName}}` — NOT `{{data.propertyName}}`.**

In a plain-string `text.content`, `link.href` (plain form), `refListStatus.propertyName`, `button.actionArguments.target` — mustache resolves against the current data scope directly. The entity IS `data` there.

```jsonc
// CORRECT — plain-string mustache
{ "type": "text", "content": "{{firstName}} {{lastName}}" }
{ "type": "text", "content": "Notification: {{name}}" }
{ "type": "refListStatus", "propertyName": "status" }        // just the field name, no braces at all

// WRONG — silently renders empty. NO error.
{ "type": "text", "content": "{{data.firstName}} {{data.lastName}}" }
{ "type": "text", "content": "Notification: {{data.name}}" }
```

The `data.` prefix is ONLY valid inside **code-mode** expressions (`{ "_mode": "code", "_code": "return data.firstName" }`) — the `_code` body IS JavaScript with `data` in scope.

Rendering behaviour with `{{data.x}}` varies by build: some render literally as the string `{{data.x}}`; more commonly renders as empty. Never right.

## Code-mode expressions on `text.content` and `link.href`

For anything that needs computation (concatenation, `moment()` age, template-literal URLs, conditionals), use code-mode:

```jsonc
{
  "type": "text", "version": 5,
  "content": {
    "_mode": "code",
    "_code": "const getInitials = (first, last) => ((first || '').trim()[0] || '').toUpperCase() + ((last || '').trim()[0] || '').toUpperCase(); return getInitials(data.firstName, data.lastName)"
  }
}
```

**Inside `_code`, `data` IS the correct scope** (`data.firstName`, `data.dateOfBirth`, etc.). Only in plain-string mustache is `data.` wrong.

Globals available in `_code`: `data`, `moment`, `application` (with `application.user`), `http`, `message`, `contexts.appContext`, `pageContext`. See [action-configurations.md § Execute Script](action-configurations.md#execute-script-rare--for-anonymous-form-submit-custom-fetches).

Same shape for `link.href`:
```jsonc
{
  "type": "link", "version": 5,
  "href": {
    "_mode": "code",
    "_code": "return `/dynamic/Forms.Optimization/notification-details?id=${data.id}`"
  }
}
```

## `editMode` by form type

The `editMode` on every input determines whether it renders as an editable control or a read-only display. Wrong choice = the form looks broken.

| Form type | `editMode` on inputs |
|---|---|
| **Create form (in modal)** | `"editable"` — always. The form is always in edit mode. |
| **Create form (standalone page)** | `"editable"` — same reason. |
| **Details form** | `"inherited"` — starts in view mode; the header's Edit button (`Start Edit`) flips the whole tree to edit. |
| **Card / row-template used inside a datalist row** | `"inherited"` — inherits from the list's read-only context. |
| **Anonymous public form (login, register)** | `"editable"` — always in edit. |

Symptoms of the wrong choice:
- `"inherited"` on a standalone create page → **every input renders as a bare label — no input box visible**. The classic "dead form" bug.
- `"editable"` on a details form → fields are editable before Edit is clicked, defeating the view/edit lifecycle.

Enforced by validator R9: create forms (identified by `dataLoaderType: "none"` OR `modelType: null` OR form name matching `/(create|register)/`) require every input to have `editMode: "editable"`.

## `dataSourceType` on dropdowns / checkboxGroups — never omit

Dropdowns without an explicit `dataSourceType` fail silently — the dropdown renders but never shows options and there's no console error.

| Field kind | `dataSourceType` | Additional config |
|---|---|---|
| Bound to a reference list | `"referenceList"` | `referenceListId: { module, name }` |
| Hardcoded options (radio-style or multi-select) | `"values"` | `items: [{ label, value }]` (checkboxGroup uses `items`, not `values`) |
| Bound to an entity (FK) — use `autocomplete` instead of `dropdown` | — | on the `autocomplete`: `dataSourceType: "entitiesList"` + `entityType: { name, module }` |

`checkboxGroup` (v=5) with hardcoded options **uses `items` (NOT `values`)** — plus `referenceListId: null`, `container: {}`, `validate: {}` as required boilerplate.

## Reference-list fields: bind from metadata, never fetch

A reference-list-backed field (dropdown, `refListStatus`, radio) is resolved **entirely by binding** — the frontend loads the items at render. Your only job is to set the binding straight from `Metadata/GetProperties`, which returns `referenceListModule` and `referenceListName` for the property. Use them **verbatim**:

```jsonc
"dataSourceType": "referenceList",
"referenceListId": { "module": "<referenceListModule>", "name": "<referenceListName>" }
```

- **Do NOT call any `ReferenceList/*` endpoint to fetch or verify the items.** The renderer (`useReferenceList`) loads them from the binding alone. Fetching them is pointless, and improvising a lookup is exactly how a run *hangs*.
- **The values are not what they look like for framework lists.** For a framework enum like Gender, `name` is the **fully-qualified dotted list name** and `module` is the **owning module** — `{ "module": "Shesha", "name": "Shesha.Core.Gender" }`, **NOT** `{ "module": "Shesha.Core", "name": "Gender" }` (that combination 404s). This exact Gender binding already sits in `sample-patient-create.json` and `sample-patient-details.json` — **copy it verbatim; do not re-derive it.** Entity-owned lists use the app module + short name, e.g. `{ "module": "boxfusion.test", "name": "AstronautSpecialisation" }`, also taken verbatim from metadata.
- **If you ever genuinely must confirm a list exists, do it ONCE — never loop:** `GET /api/services/app/ReferenceList/GetByName?module=<referenceListModule>&name=<referenceListName>` (BOTH params; `module` is the metadata `referenceListModule`, not the namespace) returns the list plus its `items[]`. `GetAll` is a paged config listing, not a lookup-by-name — don't use it here. Treat a `404` as "bind it anyway and move on" (or escalate to `domain-model` only if the list is genuinely missing) — **do not retry the call.**

## `defaultValue` must be a string

`defaultValue` is resolved as a mustache TEMPLATE via `.match()`. A literal non-string (array, number, object) has no `.match` method → `e.match is not a function` → the component (often the whole form) fails to render.

- **Allowed**: `"defaultValue": "some string"` or `"defaultValue": "{{prop}}"` (mustache) — both resolve fine.
- **Wrong**: `"defaultValue": ["a", "b"]` for a multi-select (fires the crash).
- For a multi-select default: bind through form data / the data loader, or omit.

## Required means `validate.required`

Fields marked as required must carry:

```jsonc
"validate": { "required": true }
```

Without it, the user discovers the rule via a server 400 after filling the whole form. Also — any form with any required input needs a `validationErrors` component in the tree (see [functional-requirements.md](functional-requirements.md)).

## Mustache always uses `{{double braces}}`

Single-brace expressions (`{data.id}`) are silently ignored at runtime and resolve to nothing. Only double-brace is honoured (`{{data.id}}` inside `_code`, `{{fieldName}}` in plain-string mustache).

## `formSettings.modelType` — the object shape

Author `formSettings.modelType` as the OBJECT `{ name: "<ShortClass>", module: "<Module>" }`, not a full-class-name string:

```jsonc
// CORRECT
"modelType": { "name": "Notification", "module": "Shesha" }

// LEGACY — still renders on some builds but not the current shape to author
"modelType": "Shesha.Domain.Notification"
```

Resolve `name` + `module` from `EntityConfig/GetMainDataList` every time. Do NOT copy a namespace from memory or from these examples — the same entity may be at `Shesha.Domain.Person` or `Shesha.Core.Person` across framework versions.

`dataContext.entityType` uses the same `{ name, module }` object.
