# Form quality contract (always-on construction rules)

Apply to EVERY form you build or edit. These are construction rules, not a post-hoc test
sheet — any Shesha form QA process (human reviewer or browser-driven automation) grades
against exactly these properties, so build them in from the first component.

Component selection per data type: [components/by-datatype.md](components/by-datatype.md) ·
editMode per form type: [components/edit-mode.md](components/edit-mode.md) ·
symptom→fix catalog: [debug.md](debug.md) · render checks: [verification.md](verification.md).

---

## Functional rules

**Bind to a real entity — with the backend's exact class name.** `formSettings.modelType`
must be the registered entity's **`fullClassName` as returned by
`GET /api/services/app/EntityConfig/GetMainDataList`** for the running backend — resolve it
every time, never assume or copy a namespace from memory or examples. The same entity is
registered under different namespaces across versions (`Person` is `Shesha.Domain.Person` on
current builds, `Shesha.Core.Person` on older ones; some backends carry both) — a mismatch
fails harness check **C2** and 500/404s at runtime. Confirm the resolved string exposes
properties via `GET /api/services/app/Metadata/GetProperties?container=<resolved fullClassName>`
BEFORE building. Never `object`, never an invented/guessed name. Entity class names diverge
from FK property names (`<fkProp>` can map to class `<FkPropDefinition>`) — when metadata
404s, the EntityConfig `fullClassName` is the authority.
Backend missing entirely? [full-stack-prereqs.md](full-stack-prereqs.md).

**Every input binds a property.** Non-empty `propertyName` (camelCase metadata path) on
every input component. An unbound input renders fine but silently drops its value from the
submit payload — invisible until data goes missing.

**Required means `validate.required`.** Fields the requirements call required carry
`validate: { "required": true }`. Without it the user discovers the rule via a server 400
after filling the whole form. More validators (minLength, regExp): [components/inputs.md](components/inputs.md).

**Every dropdown declares its data source.** `dataSourceType` is never omitted — a missing
or wrong source fails *silently* (empty dropdown, no console error):

| Field kind | `dataSourceType` | Mandatory config |
|---|---|---|
| Enum / reference list | `referenceList` | `referenceListId: { "module": "<module>", "name": "<RefListName>" }` — an object with BOTH keys, never a Guid, never name-only |
| Entity FK | `entitiesList` | `entityType` for the target entity (an `autocomplete` is usually the better FK component — see [components/by-datatype.md](components/by-datatype.md)) |
| Fixed inline options | `values` | `values: [ { "id": ..., "label": ..., "value": ... } ]` — all three keys per item |

Read `referenceListName` from the property metadata (strip the `RefList` prefix); reflist
names do NOT always match property names. Details: [components/dropdowns.md](components/dropdowns.md).

**Dates get `dateField`.** Any date / date-time property uses `dateField` (`showTime: true`
for date-time) — never `textField` or `numberField`, which lose the picker and break the
ISO round-trip.

**A Submit action exists.** A Save/Submit button with
`actionConfiguration: { "actionName": "Submit", "actionOwner": "shesha.form" }`.
Dialog-hosted create forms may instead rely on the Show Dialog footer submit — see
[components/add-dialogs.md](components/add-dialogs.md). `actionOwner` is case-sensitive:
`shesha.form` / `shesha.common`, never `Shesha.Common`.

**Every form with a Submit also has an exit action — even when the prompt never mentions
buttons.** A user who can save must be able to leave without saving, so the exit button is
half of the action row, not an optional extra. The catch: a terse prompt like *"a form with
one required first-name field"* names no buttons at all, so it's easy to emit only the
Submit and stop — which trips the deterministic harness check **F-S2** ("form has a
cancel/dismiss button") and cascades into **V-A3** and **C6**. Treat the exit button as
implied by *any* create/edit intent. Which exit action depends on how the form is hosted:

- **Standalone page** (a create/edit view the user opens directly — the default for "make a
  form for X"): a **Back** button — `buttonAction: "navigate"`,
  `actionConfiguration: { actionName: "Navigate", actionOwner: "shesha.common" }` pointing at
  the entity's list/table form. This is the most-forgotten case; copy
  [assets/examples/standalone-create.json](../assets/examples/standalone-create.json).
- **Modal/dialog form**: `Close Dialog` (owner `shesha.common`).
- **Detail form** with a Start Edit/Submit lifecycle: `Cancel Edit` (owner `shesha.form`).

A form you can save but not back out of is broken, not minimal — the minimalism rule below
explicitly exempts the exit button from "unnecessary extras".

**A `validationErrors` component is ALWAYS in the tree** (conventionally just above the
action row) — mandatory the moment the form has **any required input**. Without it, a failed
submit renders nothing — the form looks dead, and the form fails harness check **F-I7**
("validationErrors component present when form has required fields"). Type string is exactly
`validationErrors`, it takes no props, and it belongs on simple forms too — not just complex
ones.

**`editMode` matches the form type.** Inputs on detail forms governed by
Start Edit/Submit/Cancel Edit use `inherited` (explicit `editable` makes fields editable
before Edit is clicked). Full decision table: [components/edit-mode.md](components/edit-mode.md).

---

## Visual rules

**>5 inputs → structure.** Use `columns` / `tabs` / `sectionSeparator` /
`collapsiblePanel`. A flat single-column wall of 12 fields fails review on sight.
Shapes: [components/containers.md](components/containers.md).

**Group related fields under the same container/section.** Address parts together,
audit/devops fields together, free-text spec fields together. Grouping is the form's
information architecture — random field order reads as machine-generated.

**Every label is human-readable English.** `"First Name"`, never `firstName` or
`moduleDefinitionId`. Labels are also the automation handle: browser-based functional
tests locate fields **by label text**, so a raw propertyName label breaks both the human
read and the test run.

**All action buttons live in one `buttonGroup` — never standalone `button` nodes.** Save,
Back, Cancel, Edit, Delete, Refresh, Add are `items[]` inside a `buttonGroup`
(`{ itemType: "item", itemSubType: "button", buttonType, buttonAction, actionConfiguration }`),
not loose top-level `button` components. The standalone `button` type is reserved for a button
placed inline beside text/content — not the form's action row. Copy a `buttonGroup` from a
seed in `assets/examples/` rather than hand-authoring the item shape.

This is the highest-leverage construction rule because the QA classifier reads a form's
*intent* (create / edit / details / read-only) **solely from `buttonGroup` item actions** —
it never inspects standalone `button` components. A loose `button`, or a Save wired to
anything other than `actionName: "Submit"` + `actionOwner: "shesha.form"`, triggers three
failures from one mistake: harness check **V-A4** fails on the scattered button; the form is
**misclassified as read-only** ("no edit intent" → then docked for having buttons at all);
and the submit-action functional check finds nothing. So the Save item must be exactly
`actionName: "Submit"`, `actionOwner: "shesha.form"`; a Back item is `actionName: "Navigate"`,
`actionOwner: "shesha.common"`; Cancel-on-details is `Cancel Edit` / `shesha.form`.

**Exactly one visually-primary button.** One `buttonType: "primary"` per rendered view,
reachable in the default state — not hidden inside a collapsed panel or a non-default tab.
Two primaries = no primary.

**Add only what the request needs — no padding.** Component count should match the request's
complexity. Every editable form has a fixed floor, no matter how terse the prompt: the input
fields + one `validationErrors` + one `buttonGroup` holding **both** Submit **and** an exit
(Back/Close/Cancel) button + the minimum structure (one `columns`/`sectionSeparator` only when
>5 inputs). A prompt that names only fields — *"a form with one required first-name field"* —
still gets the Submit **and** the exit button: they are part of a working form, never
"unnecessary extras". A Submit with no exit button is the defect (fails **F-S2 / V-A3 / C6**),
not an example of minimalism.

What minimalism actually rules out is structure the request didn't call for: extra containers,
decorative panels, duplicate wrappers, or headers the user never asked for (harness check
**C8**). Seeds are a starting point, not a floor — after copying a seed, delete every node the
current request doesn't use, but never the `validationErrors` or the Submit/exit pair.

**Destructive actions are NEVER primary.** Delete / Cancel / Reset get `default` or `link`
styling (e.g. `link` + `DeleteOutlined` icon). Primary is reserved for the main
forward action (Save/Submit).

**One layout grid.** `formSettings.layout` + `labelCol`/`wrapperCol` are set once at form
level and stay consistent. Field-level `labelCol` is silently IGNORED by the renderer — to
align a lone full-width field with a 2-column grid, place it in a 50% column instead (see
[detail-page-pattern.md](detail-page-pattern.md)).

**The form title/header `text` component carries explicit `fontSize` + `fontWeight`.**
Unstyled headers render at body size and the page loses its hierarchy.

**Nothing clips or overflows at render.** Container inner divs are hard-coded
`overflow:auto` — flex-shrink squeeze turns squeezed headers into scrollbars. Fix the
squeezed container with `dimensions.minHeight: 'fit-content'` (runtime-verified;
`minHeight` under `dimensions` is not enumerated in the groups index — clean-form-config
may flag it; do NOT strip). `dimensions` is the only style channel reaching the container's
outer div — a `style`-string `flexShrink:0` lands on the inner div and does nothing
([style-channels.md](style-channels.md)). Verify geometry with `getBoundingClientRect`,
not screenshots, and clear the FE IndexedDB form cache from a static page (e.g.
`/favicon.ico`) first or stale markup will lie to you ([verification.md](verification.md)).

---

## Checklist before push

- [ ] `modelType` = exact `fullClassName` resolved from `EntityConfig/GetMainDataList` for this backend (no assumed `Core`/`Domain` namespace, no `object`, no invented names) — **C2**
- [ ] every input has a non-empty camelCase `propertyName` that exists in metadata
- [ ] required fields carry `validate.required: true`
- [ ] every dropdown has `dataSourceType`; reflists have `referenceListId` `{module, name}`
- [ ] date properties use `dateField` (`showTime` for date-time)
- [ ] Submit action (`Submit` / `shesha.form` or dialog footer) **and** a paired exit button on every editable form — standalone page → Back (`Navigate` / `shesha.common`), modal → `Close Dialog`, detail → `Cancel Edit` — even when the prompt never mentions buttons — **F-S2 / V-A3 / C6**
- [ ] `validationErrors` component present whenever the form has any required input — **F-I7**
- [ ] all action buttons wrapped in a `buttonGroup` (no standalone `button` nodes in the action row) — **V-A4**
- [ ] component count matches the request — no padding containers/panels/wrappers — **C8**
- [ ] >5 inputs structured into containers; related fields grouped together
- [ ] labels human-readable; exactly one primary button; destructive never primary
- [ ] consistent `layout`/`labelCol`; titled header has `fontSize`+`fontWeight`; no clipping/overflow

---

### Worked example (project-specific)

RequirementsStudio (`Shesha.RequirementsStudio`) instances of the rules above:

- `modelType: "Shesha.RequirementsStudio.Domain.ModuleDefinition"` — verified via
  `Metadata/GetProperties`. Divergence case: the `release` FK property maps to entity class
  `ReleaseDefinition`; `Shesha.RequirementsStudio.Domain.Release` returns 404.
- Status dropdowns: `referenceListId: { "module": "Shesha.RequirementsStudio", "name": "RsStatus" }`
  (`status` is always `RsStatus`). Counter-example: `existsInDevOps` binds reflist
  `RsDevOpsStatus`, NOT `RsExistsInDevOps` — the wrong name threw a
  `ConfigurationLoadingError` that blocked the whole form.
- Required-FK preset in add dialogs: `baseProject` must be injected via
  `formSettings.onPrepareSubmitData` — `setFieldsValue` alone never survives submit
  ([components/add-dialogs.md](components/add-dialogs.md)).
- Status chip: border `1px` `#d9d9d9`, radius 4; chip FILL color is data-driven per
  reflist value — never force a uniform color.
- Subtable drill-down action column: `EyeOutlined`, `minWidth`/`maxWidth` 35, anchored
  left; toolbar alignment via the `sha-index-table-control` framework class
  ([junction-subtables.md](junction-subtables.md)).
- Detail grid: `formSettings.labelCol: 8` / `wrapperCol: 16`, `layout: "horizontal"` on
  every `*-details` form — the shared grid that makes labels line up across columns.

---

Related: [components/by-datatype.md](components/by-datatype.md) ·
[components/edit-mode.md](components/edit-mode.md) · [debug.md](debug.md) ·
[verification.md](verification.md) · [detail-page-pattern.md](detail-page-pattern.md) ·
[navigation-menu.md](navigation-menu.md) · [bulk-operations.md](bulk-operations.md)
