# Form quality — floor + grading notes

Part 1 is the terse always-on floor: build it into EVERY form from the first component and walk it again as the **pre-push gate**. Part 2 carries the rationale, silent-failure symptoms and edge cases — read it when a floor check is ambiguous or when auditing/grading a form (any Shesha QA process grades against exactly these properties). Deeper refs: [components/by-datatype.md](components/by-datatype.md) · [components/edit-mode.md](components/edit-mode.md) · [debug.md](debug.md) · [verification.md](verification.md).

## Part 1 — the floor

### Functional

- **Display component matches the requested noun** — "list"/cards/tiles/gallery ⇒ `datalist`; "table"/grid ⇒ `datatable`; both bound through a `dataContext`. Never a bound collection as stacked static `container` cards. Multi-select list ⇒ `selectionMode: "multiple"`. Ambiguous noun ⇒ ask, don't guess.
- **From a design, the component matches what the design RENDERS**, not the data-shape default — repeating cards/chips ⇒ `datalist` row-template; `datatable` only for a genuine dense admin grid; read-only label→value rail ⇒ read-only display controls; status value ⇒ `refListStatus` chip, not a dropdown.
- **`formSettings.modelType` resolved from the live backend, never assumed** [R-016] — full contract incl. evidence-before-create and portability: [entity-binding.md](entity-binding.md).
- **Every input binds a non-empty `propertyName`** that exists in metadata.
- **Every `propertyName` is camelCase — including datatable COLUMN `propertyName`s** (metadata `path` is PascalCase; PascalCase columns render blank cells). Lower-case the first letter (`ActionedBy`→`actionedBy`).
- **Required fields carry `validate: { "required": true }`.**
- **Every dropdown declares `dataSourceType`** (missing/wrong fails silently): reference list ⇒ `referenceList` + `referenceListId: { module, name }` (object, both keys, copied verbatim from metadata — [entity-binding.md §5](entity-binding.md)); entity FK ⇒ `entitiesList` + `entityType` (prefer `autocomplete`); fixed options ⇒ `values: [{ id, label, value }]`.
- **Date properties use `dateField`** (`showTime: true` for date-time) — never `textField`/`numberField`.
- **A Submit action exists** — `actionConfiguration: { "actionName": "Submit", "actionOwner": "shesha.form" }` (or a dialog footer submit). `actionOwner` is case-sensitive: `shesha.form`/`shesha.common`.
- **Every form with a Submit also has a paired exit button** — implied by ANY create/edit intent, even when the prompt names no buttons. Standalone page ⇒ **Back** (`Navigate`/`shesha.common`); modal ⇒ `Close Dialog` (`shesha.common`); detail ⇒ `Cancel Edit` (`shesha.form`).
- **`validationErrors` component is ALWAYS in the tree** (above the action row) once the form has any required input. Type string exactly `validationErrors`, no props.
- **`editMode` matches the form type** — detail forms on Start Edit/Submit/Cancel ⇒ `inherited`; a read-only rail that must always show values ⇒ `editMode: "readOnly"` per control (`inherited` renders blank until edit mode). Decision table: [components/edit-mode.md](components/edit-mode.md).
- **No duplicate ids tree-wide; no double-slot card children** — `card`/`collapsiblePanel` children live in `content.components` ONLY, never also in a top-level `components[]`.

### Layout & action

> Construction only — the LOOK (surfaces, shadows, spacing, radii, type scale) is owned by `shesha-design-system`. Do not author v7 appearance blocks here.

- **Follow the canonical build style** — labels on top for create/edit + modals (horizontal right-aligned label cols only on read-only detail views); action rows right-aligned (Cancel ghost before Submit primary); card-per-section with header strips; table toolbars with quick-search + ghost Add; main+rail split. Shapes + measurements: `shesha-design-system/references/default-layout-patterns.md`.
- **Group fields into sections** the design shows, or by IA (identity/classification/audit/free-text) — each group a flex `container` row (sized via `desktop.dimensions.width` [R-028]; **never** `columns`), `tabs`, `sectionSeparator`, or `card`+header. Trigger = ">1 logical group", not raw field count. Keep related fields together.
- **Every label is human-readable English** (`"First Name"`, never `firstName`) — labels are the automation handle for browser tests.
- **Action buttons live in a `buttonGroup`, never standalone `button` nodes** (GUARDRAIL) — tooling reads form intent from `buttonGroup` items. Items = `{ itemType: "item", itemSubType: "button", buttonType, buttonAction, actionConfiguration }`. Multiple `buttonGroup`s OK across distinct zones (header/footer/toolbar). Copy from a golden archetype in `assets/golden/`.
- **Every far-right element in a table's header zone aligns flush with the table's right edge** — toolbar row = full-width flex, `justifyContent:"flex-end"` (or `"space-between"` with a left search cluster). Silent killers: `justifyContent` needs an explicit `display:"flex"` [R-029]; force full width via `desktop.dimensions.width:"100%"` [R-028]. Copy from a canonical table seed.
- **One primary per action zone** — one `buttonType: "primary"` reachable in the default state per visible zone; never two inside the same `buttonGroup`.
- **Add only what the request needs — no padding.** Floor per editable form = inputs + one `validationErrors` + one `buttonGroup` (Submit **and** exit) + minimal structure (one `columns`/`sectionSeparator` only when >5 inputs). Delete unused seed nodes, but never the `validationErrors` or the Submit/exit pair. A Submit with no exit is the defect, not minimalism.
- **Destructive actions (Delete/Cancel/Reset) are NEVER primary** — `default`/`link` styling. Primary is reserved for the main forward action.
- **Appearance floor (presence check)** — a no-brand form still ships the default-theme markers: canvas page background (`#F8F8F9`), white hairline card surfaces, titles with `fontSize`+`fontWeight`, one primary in the action group. HOW is compile-time theming (or, for a form the compiler did not produce, the default-theme quick pass); THAT it happened is a construction check. Exempt only if a brand/blueprint pipeline styled it.
- **One layout grid** — `formSettings.layout` + `labelCol`/`wrapperCol` set once at form level. Field-level `labelCol` is silently ignored; align a lone full-width field by placing it in a 50% column.
- **Titles carry explicit `fontSize`+`fontWeight`** sized to role — page title 24/`600` (`700` if bold), card header 16/`600`, section header 13–14/`600`. Unstyled headers render at body size and the page loses its hierarchy.
- **Nothing clips or overflows** — fix a squeezed container with `dimensions.minHeight: 'fit-content'` (clean-form-config may flag it; do NOT strip). Verify with `getBoundingClientRect` after clearing the FE IndexedDB form cache ([verification.md](verification.md)).

## Part 2 — grading notes (rationale + silent-failure symptoms)

Read when a floor check is ambiguous, or when auditing. Each note names the defect the floor bullet prevents.

- **Static-cards defect:** a bound entity collection as stacked static `container`s doesn't page/filter/select/bind. A *non-collection* card surface (summary panel, KIB stat, related-panel shell) is legitimately a styled container — that's a design-system recipe, not a bound list.
- **Design-render mismatch:** a related collection the design shows as cards/chips rendered as a `datatable` is a **placement defect** even though a grid would hold the rows.
- **Unbound input:** renders fine, silently drops its value from the submit payload — invisible until data goes missing.
- **Missing `validate.required`:** the user discovers the rule via a server 400 after filling the whole form.
- **Wrong/missing dropdown source:** empty dropdown, **no console error**. Reflist names do NOT always match property names (a `status` property can bind `BookingStatus`, and one live case bound `existsInDevOps` → `RsDevOpsStatus`, where the guessed name threw a `ConfigurationLoadingError` blocking the whole form).
- **Exit-button trap:** a terse prompt ("a form with one required first-name field") names no buttons, so it's easy to emit only Submit — leaving a form the user can save but not leave. The exit is implied by any create/edit intent; copy `assets/golden/capture-standalone--standalone-create.json` for the standalone case (the most-forgotten one).
- **Missing `validationErrors`:** a failed submit renders *nothing* — the form looks dead.
- **`editMode` rail defect:** `inherited` on an always-visible read-only rail renders blank cells until edit mode ("rail labels with no values"); `readOnly` resolves and displays `_displayName` immediately.
- **Double-slot card defect:** a container→card migration that leaves children in `components[]` while the slot is `content.components` renders the body **twice** (often with id collisions): the "everything shows 2–4×" defect. Assert both conditions before push; if violated, keep `content.components`, empty the other.
- **buttonGroup intent rule (highest-leverage):** tooling reads a form's *intent* (create/edit/details/read-only) largely from `buttonGroup` item actions. A loose `button`, or a Save wired to anything but `Submit`/`shesha.form`, causes three failures at once: scattered layout, the form misread as read-only, and a submit that never fires. Back = `Navigate`/`shesha.common`; Cancel-on-details = `Cancel Edit`/`shesha.form`.
- **FK naming divergence:** an FK property's entity class can differ from the property name (an `assignedTo` FK may map to class `EmployeeDefinition` — the guessed `…Domain.AssignedTo` 404s). When metadata 404s, the EntityConfig `fullClassName` is the authority ([entity-binding.md](entity-binding.md)).
- **Preset required FK in add dialogs:** must be injected via `formSettings.onPrepareSubmitData` — `setFieldsValue` alone never survives submit ([components/add-dialogs.md](components/add-dialogs.md)).
- **Overflow physics:** container inner divs are hard-coded `overflow:auto`, and `dimensions` is the only channel reaching the outer div — a `style`-string `flexShrink:0` lands on the inner div and does nothing ([frontend-conventions.md](../../../knowledge/frontend-conventions.md)).
- **Worked example (generic):** an `employee-details` form binds `modelType` resolved from EntityConfig; its `department` FK renders as an `autocomplete` bound `entityType: Department`; `status` binds the reflist named by the property's metadata (`EmployeeStatus`, not a name derived from the entity); the detail grid sets `formSettings.labelCol: 8` / `wrapperCol: 16` / `layout: "horizontal"` once so labels align across columns; the subtable drill-down column is `EyeOutlined`, `minWidth`/`maxWidth` 35, anchored left.

---

Related: [detail-page-pattern.md](components/detail-page-pattern.md) · [navigation-menu.md](navigation-menu.md) · [bulk-operations.md](bulk-operations.md)
