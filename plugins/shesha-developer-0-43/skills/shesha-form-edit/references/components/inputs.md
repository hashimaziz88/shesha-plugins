# Input components — text, number, date, checkbox, file, validation

For dropdown / radio / checkboxGroup / refListStatus → [dropdowns.md](dropdowns.md).
For autocomplete / entityPicker → [selectors.md](selectors.md).

`editMode` per the form-type rule (detail forms `"inherited"`, dialogs/action pages `"editable"`) — see [edit-mode.md](edit-mode.md).

---

## textField

```json
{
  "id": "...",
  "type": "textField",
  "propertyName": "firstName",
  "label": "First Name",
  "validate": { "required": true, "maxLength": 100 },
  "placeholder": "Jane",
  "size": "middle",
  "editMode": "inherited",
  "parentId": "..."
}
```

Variants: `textArea` (multiline), `passwordCombo` (password + confirm).

---

## numberField

```json
{
  "id": "...",
  "type": "numberField",
  "propertyName": "capacity",
  "label": "Capacity",
  "min": 0,
  "max": 10000,
  "step": 1,
  "precision": 0,
  "editMode": "inherited"
}
```

---

## dateField / timePicker / calendar

```json
{
  "id": "...",
  "type": "dateField",
  "propertyName": "startsAt",
  "label": "Starts At",
  "showTime": true,
  "format": "YYYY-MM-DD HH:mm",
  "validate": { "required": true },
  "editMode": "inherited"
}
```

---

## checkbox / switch / threeStateSwitch

```json
{
  "id": "...",
  "type": "checkbox",
  "propertyName": "popiaConsent",
  "label": "POPIA consent",
  "editMode": "inherited"
}
```

`threeStateSwitch` adds an "indeterminate" state — value is `true | false | null`.

---

## fileUpload / attachmentsEditor / imagePicker

```json
{
  "id": "...",
  "type": "fileUpload",
  "propertyName": "coverImage",
  "label": "Cover Image",
  "ownerType": "PBF.MembershipManagement.Domain.Domain.Event",
  "ownerName": "CoverImage",
  "editMode": "inherited"
}
```

`ownerType` + `ownerName` link uploads to a `StoredFile` property on the entity (the framework wires the FK).

---

## Validation patterns

`validate` is a sub-object on input components:

```json
"validate": {
  "required": true,
  "minLength": 3,
  "maxLength": 100,
  "min": 0,
  "max": 1000,
  "regExp": "^[A-Z]{2}\\d{4}$",
  "validator": "value && value.startsWith('PBF')",
  "message": "Custom message shown when invalid"
}
```

`validator` is a JS expression (same script context as embedded scripts; see [scripts.md](scripts.md)) — must return truthy for valid. Invalid → AntD shows `validate.message`.

For complex business rules across fields, use **FluentValidation** on the .NET side (see the `shesha-fluent-validators` skill in the shesha-developer plugin) rather than per-component validators. UI validators can't enforce server-side invariants reliably.
