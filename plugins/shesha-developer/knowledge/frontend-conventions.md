# Frontend conventions — Shesha 0.45

Plugin-level knowledge. Any skill or agent doing frontend work stands on this file;
it holds **facts**, not procedure. The procedure for building a form lives in
`skills/shesha-form-edit/`; the per-component recipes live in its
`references/components/` and are routed by `scripts/lookup.js`.

Every fact here was learned from a real form that silently mis-rendered — these
are the facts trial-and-error repair loops rediscover at 1–3 push cycles each.
Rule ids cite `skills/shesha-form-edit/references/_rules.json`, and the registry
statement is authoritative where prose disagrees.

## The form JSON model

- A form config is `{ components: [...], formSettings: {...} }`. Component trees nest
  through `components[]`, except `card` / `collapsiblePanel`, whose children live in
  `content.components` **only** — leaving children in both slots renders the body twice,
  usually with id collisions.
- Every component carries `id` (uuid/nanoid), `type` (an exact string from the KB),
  `parentId` set to its direct parent's `id` (root-level components use `"root"`), and an
  integer `version` [R-001/R-002/R-003].
- Inputs bind through `propertyName`, which must be **camelCase** and must exist in the
  entity metadata — including `datatable` column `propertyName`s, where metadata's
  PascalCase `path` renders blank cells.
- A `datatable`'s columns live in its **`items[]`** array. There is no `columns` property;
  an empty or missing `columns` is expected, not a defect.
- Settable props can take an IPropertySetting wrapper — `{_mode:"code", _code:"return …"}`
  — instead of a literal. A plain-string JS endpoint is stripped on save.

## The component settings model

`assets/components-kb/` in `shesha-form-edit` is the authority for exact `type` strings,
the current `version`, and each component's `settingsFields`. `_index.json` keys are the
115 valid type strings for this release; `node scripts/lookup.js <type>` resolves one and
exits 1 only if the type does not exist. Author only fields the KB lists for that type.

## Styling levers (what actually renders)

- **Appearance goes through `desktop`/`tablet`/`mobile` breakpoint blocks** —
  the measured channels in `assets/measured-capability-matrix.json`.
  `background`/`shadow` render only as COMPLETE objects (background needs
  `type`); the legacy `style` JS-string renders inline and WINS over
  everything — when a stamped prop doesn't render, grep the component and its
  ancestors for a truthy `style` first [R-030].
- **Breakpoint blocks override base per-key** — a base `borderType:"custom"` is
  dead if `desktop.border.borderType:"all"`. Stamp base AND every breakpoint
  object consistently.
- **Sizing a flex child**: `desktop.dimensions.width` is the ONLY lever
  (accepts `%` and `calc()`); `customStyle:{flex}` is ignored and
  style-channel `flexShrink` never reaches the outer div [R-028]. A flex
  container must set `display:"flex"` explicitly [R-029].
- **A container renders TWO divs**: the outer (`sha-components-container`, the
  flex item) receives only dimensions+shadow; layout props land on the inner.
  Inner overflow is hard-coded `overflow:auto` — fix squeezed headers with
  `dimensions.minHeight:"fit-content"` [R-032].
- **Field-level `labelCol` is ignored** — only `formSettings.labelCol/wrapperCol`
  applies (field-level `labelAlign` IS honored); `.sha-page-content:not(.no-padding)`
  carries a hard-coded 12px inset [R-033].
- **`refListStatus` fill colour comes only from the reflist item's own colour**;
  radius via `desktop.border.radius.all`, never `customStyle` [R-036].

## Versions and visibility

- **A component with no integer `version` renders READ-ONLY** — standalone
  create/edit fields draw as display spans, not inputs; a stale version
  silently drops the whole `desktop` style block [R-003]. Never model a new
  form on a versionless legacy seed, and don't trust the frontend
  `package.json` version string — trust live-form shapes and the KB.
- **Conditional visibility = code-mode `hidden`** (`{_mode:"code",_code:"return
  !(data?.x)"}` — TRUE hides); legacy `customVisibility` is IGNORED [R-031].
  Use `data?.field` optional chaining — create forms have no data context
  initially and a throw fails-open, masking the bug.

## Data and binding

- `formSettings.modelType` is the `{name,module}` object from live EntityConfig;
  `dataContext.entityType` stays the fullClassName string [R-016].
- The table/list wrapper is `dataContext` v8 with explicit `entityType` +
  `sourceType` [R-005].
- A bound value renders ONLY when `propertyName` is a real entity property —
  `onAfterDataLoad` mutations or `setFieldsValue` never populate a read-only
  field's display [R-034].
- Mustache `{{ }}` HTML-escapes `' & < >` — `{{{triple-brace}}}` for trusted
  display values [R-035]. Dynamic CRUD Update rejects nested FK objects —
  reduce to `{id}` in `onPrepareSubmitData` [R-037].
- **Lifecycle hooks**: `onInitialized` is NOT wired on dynamic pages — custom
  loading goes through `onAfterDataLoad`; `dataLoaderType:"custom"` is silently
  skipped when the page supplies initialValues (DynamicPage always does) [R-039].
- **Script runtime**: Execute Script actions return a Promise; `http.get(url,
  {params})` drops params — query args go in the URL string; formArguments/
  selectedRows are not in scope [R-038].

## Anonymous writes + backend bootstrap

- **Anonymous public-form writes** [R-041]: dynamic-CRUD create is
  permission-protected (anonymous POST → 401). Set form `access: 5` [R-022],
  scaffold a custom `[AbpAllowAnonymous]` app service (via
  `shesha-developer:shesha-app-layer`) that forces server-side values and
  re-enforces validation, wire Submit to POST to it via Execute Script, then
  Navigate. Never expose raw entity CRUD to the anonymous internet.
- **Backend bootstrap** [R-040]: plan entity + migration + app service up front
  and apply in ONE build + double-boot — a NEW entity needs TWO boots (its CRUD
  controller registers on the boot after EntityConfig seeds); reflist items +
  app-service code need one. Verify entity CRUD Create returns 200 BEFORE
  authoring the form. Restart mechanics: [shesha-form-edit/references/backend-restart.md](../skills/shesha-form-edit/references/backend-restart.md).

## Publish model

Mutable forms on 0.45 test builds: bare `UpdateMarkup` works, `UpdateStatus`
may 404, `GetJson` returns the markup object directly (no `.result`). Version
facts and the foreign-backend handoff: [shesha-form-edit/references/versioning.md](../skills/shesha-form-edit/references/versioning.md).
