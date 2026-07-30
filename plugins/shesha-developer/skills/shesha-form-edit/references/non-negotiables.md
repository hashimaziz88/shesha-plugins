# Non-negotiables — index of the rule registry

**`_rules.json` is the single source; validators cite these ids; this file is
only a reading order.** Each line below is the one-line gist — the full
statement (and the failure it prevents) lives in the registry entry.

## Structure
- [R-001] `parentId` on every component (root-level → `"root"`) · [R-002] ids are generated UUIDs/nanoids, never placeholders
- [R-006] `validationErrors` in the tree whenever any input is required · [R-009] `defaultValue` is a string, never a literal array/number/object
- [R-018] `editMode` per form type, never blanket-stamped · [R-020] minimal component count; Submit + exit pair is part of the floor
- [R-021] human-readable labels on every field · [R-025] preserve ids when editing existing forms · [R-031] conditional visibility = code-mode `hidden`, never `customVisibility`

## Binding
- [R-004] every `propertyName` camelCase (incl. datatable columns) · [R-014] mustache uses `{{double braces}}`
- [R-015] reflist identity copied verbatim from metadata · [R-016] `modelType` = `{name,module}` object from live EntityConfig; `entityType` stays the fullClassName string
- [R-034] a bound value renders only from a real entity property · [R-035] `{{ }}` HTML-escapes; `{{{ }}}` for trusted display values

## Data
- [R-005] datatable/datalist wrapper = `dataContext` v8 with explicit `entityType` + `sourceType` · [R-010] inline column editors are `[not-editable]` or `{type, settings:{…}}`
- [R-011] `checkboxGroup` options in `items` (not `values`) · [R-037] reduce FKs to `{id}` in `onPrepareSubmitData`
- [R-039] custom loading via `onAfterDataLoad` (`onInitialized` not wired) · [R-045] preset FKs need a bound component AND `onPrepareSubmitData`

## Actions
- [R-007] form actions in ONE `buttonGroup`; Submit = `Submit`/`shesha.form` + paired exit · [R-008] every Navigate has a non-empty target
- [R-043] canonical CRUD wiring (Add = Show Dialog modal, detail lifecycle, Save+Back) · [R-044] row delete = Execute Script + Refresh table, never "Delete row"/"table"

## Scripts
- [R-012] code-mode props are `{_mode:"code",_code}` objects · [R-013] embedded scripts JSON-safe
- [R-023] no `globalState` — appContext/pageContext · [R-024] try/catch + async/await, no `.then()` · [R-038] Execute Script returns a Promise; params in the URL

## Styling
- [R-028] page splits = flex containers sized via `desktop.dimensions.width`, never `columns` · [R-029] flex props need explicit `display:"flex"`
- [R-030] appearance through desktop/tablet/mobile blocks; background/shadow as complete objects; legacy `style` string wins
- [R-032] container renders two divs; inner overflow hard-coded · [R-033] field-level `labelCol` ignored · [R-036] `refListStatus` colour from the reflist item · [R-048] datalist row-card recipe

## Security
- [R-022] `access: 5` on anonymous forms, verified post-push · [R-041] never expose raw entity CRUD anonymously — custom `[AbpAllowAnonymous]` service

## API / process
- [R-026] API namespace per service, never guessed · [R-027] BOM-free UTF-8 for tokens and staged JSON
- [R-019] "list" → datalist, "table" → datatable · [R-040] plan backend changes up front; one build + double-boot
- [R-042] no form ships unstyled · [R-046] pushed + verified before "done" (push ledger) · [R-047] verification = re-fetch + diff · [R-050] never read a whole golden/seed file — grep fragments

## Versioning
- [R-003] every component carries its type's current KB `version` · [R-049] versions drift per release; the 0.45 KB is authoritative here — prior-generation authoring lives in the `shesha-developer-0-43` plugin (see [versioning.md](versioning.md))
