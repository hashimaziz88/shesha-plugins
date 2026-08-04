# Renderer physics — live-verified 0.45 render behaviour

Every fact here was learned from a real form that silently mis-rendered — these
are the facts trial-and-error repair loops rediscover at 1–3 push cycles each.
Facts in the registry are cited by id; the registry statement is authoritative.

**Almost nothing on this stack fails loudly** [R-055]. Every fact below was found by
comparing *computed* styles in the live DOM against what was authored — not by
reading the JSON and not by trusting the schema. A prop existing in the schema is
no guarantee it renders: `text.textAlign` is listed and dead, `desktop.font.color`
is listed and a measured no-op on `text`, `customStyle:{flex}` is listed and
inert. Treat styling this stack as an empirical, measure-first process; a
"spec-says-so" fix that isn't measured is not a fix.

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
- **The flex-row rule is a DESCENDANT selector, not direct-child** — once ANY
  ancestor container is horizontal, every nested container's inner div is forced
  to `row`+`wrap` regardless of its own `vertical`/`flexDirection:"column"`
  setting. A label-over-value stack built inside a horizontal card renders
  side-by-side with **zero errors**. Fix: wrap each child that needs its own
  line in an extra `width:100%` container — one added nesting level per stacked
  child, every time. Budget that level when planning any vertical stack inside
  a row; it is not optional and there is no prop that substitutes for it
  [R-051].
- **`text` (v5) is broken by default and needs THREE levers together** [R-052]. With no
  `textType`, it renders `<h1 class="ant-typography">` and AntD's h1 rule
  overrides both font-size and colour — every size/colour you configure is
  silently ignored, no error. Working combination:
  `textType:"paragraph"` (escape the h1) + `contentType:"custom"` (unlock colour
  at all) + colour in a **top-level `font` object** — NOT the
  `desktop.font.color` block that works on every other v7 component (measured
  no-op, twice). Also: the top-level `textAlign` prop is in the schema but dead
  at runtime — real alignment is `desktop.font.align`. `textTransform` and
  `letterSpacing` have **no working lever** on `text` (both the documented
  code-mode prop and the flat prop matching the TypeScript interface were tried;
  injecting the same CSS via `el.style` works, so it is the component, not the
  browser). Need uppercase eyebrow text? Type it uppercase in `content`.
  **Open question:** the no-op was measured with `textType:"span"`, yet several
  golden archetypes ship `span` + `desktop.font.color` and read as correct — so
  whether `span` escapes the h1 trap is unresolved. `validate-guardrails.js`
  therefore WARNs rather than fails, and the answer comes from measuring the
  computed colour, never from reading the JSON (matrix `todo`).
- **Field-level `labelCol` is ignored** — only `formSettings.labelCol/wrapperCol`
  applies (field-level `labelAlign` IS honored); `.sha-page-content:not(.no-padding)`
  carries a hard-coded 12px inset [R-033].
- **`refListStatus` fill colour comes only from the reflist item's own colour**;
  radius via `desktop.border.radius.all`, never `customStyle` [R-036].

## Composition gaps — no workaround, design around them

These are missing capabilities, not bugs to fix. Each was confirmed by measuring
computed styles in the live DOM after the obvious configurations failed silently.
Choosing a layout that needs one of them costs a full repair loop that cannot
converge.

- **`button` and `buttonGroup` do not share a styling system, and cannot be
  mixed in a row** [R-053]. `buttonGroup` items have **no per-item colour and no
  per-item enable/disable** — colour is one shared `buttonType` for the whole
  group; independently-coloured toolbar buttons force standalone `button`
  components. But the two render in **different wrappers with different default
  heights**: a `buttonGroup` hugs its content, while a standalone `button` gets
  auto-wrapped in a ~50px box that vertically centres it. Mixing them in one row
  produces a small, real misalignment that **styling the button cannot fix** —
  margin tricks on the visible `<button>` shift it unpredictably. The only fix
  is to stop mixing: convert every action in the row to the same kind of
  component. Wrapping a single-item `buttonGroup` in a coloured container does
  **not** tint the button either — the wrapper stays fully transparent while the
  button stays app-theme blue. To colour one action, move it out of the
  `buttonGroup` entirely.
- **Container background images don't work from a URL** [R-054]. `background.type:"image"`
  with a plain URL never renders — the renderer expects an internally-stored file
  reference. The only working path is an actual in-flow `image` component.
- **There is no photo-with-text-overlay.** Forcing an image out of flow with
  `position:absolute` collapses its wrapper to 0×0 even with an explicit height
  set. Hero banners on this stack are strictly **banner-then-content**, never
  overlay — say so rather than attempting it.
- **There is no general-purpose icon or decorative-element component.** Icons
  render only through `button.icon` (an interactive element), `iconPicker` (an
  input, not a display), or `statistic` (unverified, and on an entirely different
  flat-prop styling system). A decorative icon on a KPI card means repurposing a
  `button` with no label and a neutralised cursor — a hack around a missing
  primitive. Prefer a layout that doesn't need one.

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
