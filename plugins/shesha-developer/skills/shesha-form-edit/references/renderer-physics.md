# Renderer physics — live-verified 0.45 render behaviour

Every fact here was learned from a real form that silently mis-rendered — these
are the facts trial-and-error repair loops rediscover at 1–3 push cycles each.
Facts in the registry are cited by id; the registry statement is authoritative.

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
  authoring the form. Restart mechanics: [backend-restart.md](backend-restart.md).

## Publish model

Mutable forms on 0.45 test builds: bare `UpdateMarkup` works, `UpdateStatus`
may 404, `GetJson` returns the markup object directly (no `.result`). Version
facts and the foreign-backend handoff: [versioning.md](versioning.md).
