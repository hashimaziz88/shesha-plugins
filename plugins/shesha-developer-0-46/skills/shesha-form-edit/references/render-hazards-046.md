# Render hazards on Shesha 0.46

Things that look fine in stored markup and break (or silently change) when the 0.46 portal renders it.
Each hazard: **symptom -> cause (source) -> detection predicate over stored markup -> fix**.

Evidence tags: **[proven]** = reproduced on a running 0.46 app (2026-10-01); **[source]** = read from
`release-0.46.0` source only. Paths are relative to `shesha-reactjs/src/` (frontend) or `shesha-core/src/` (backend).
Run the detectors with `node scripts/scan-hazards.mjs <markup.json | dir>` (see [Scanner](#scanner)).

Quick index

| # | Hazard | Tag |
|---|---|---|
| H1 | Form API moved: `GetByName` 404, `UpdateMarkup` overwrites `modelType`, no Draft/Live | proven |
| H2 | Admin portal serves a stale form from IndexedDB | proven |
| H3 | `htmlRender` drops a leading `<style>` (sanitiser) | proven |
| H4 | `htmlRender` shows "Please, provide some content" | proven |
| H5 | `htmlRender` with `contentType: 'html'` ignores `renderer` | proven |
| H6 | Hidden components are not mounted (hidden CSS carriers never inject) | proven |
| H7 | antd 6 tabs DOM: old `.ant-tabs-content-holder` selectors match nothing | proven |
| H8 | `text` v7 reads `desktop.stylingBoxJson` / `desktop.font.size`, not the legacy keys | proven |
| H9 | Migrations inject style defaults; hidden components keep wrapper size (phantom gaps) | proven |
| H10 | Render-time script throws before data loads; a throwing visibility means VISIBLE | proven |
| H11 | Arrays read from `data`/`value` are mutated in place by the form | proven |
| H12 | `ReferenceList/GetItems` is gone (404) | proven |
| H13 | `refListStatus` inside a `subForm` throws "Component with id ... is not found" | proven (framework bug) |
| H14 | `subForm` with `labelCol: 0` hides the labels of hosted fields | proven (core issue) |
| H15 | `editMode` returning a boolean `false` now means DISABLED, not read-only | source |
| H16 | `columns` blocks lose gutter compensation (inset by `gutter/2`) | source |
| H17 | `datatable` migrations force zebra rows / hover / single selection over stored values | source |
| H18 | `text` v7 content: `{{` becomes `{{data.` on load | source |
| H19 | `text` ignores `hidden`/`visible` in live mode | proven (framework bug) |
| H20 | Multi-line field labels overlap the next row (label height fixed at 32px) | proven (antd 6) |
| H21 | Every field row is 35px, not 32px; a positive field margin cannot shrink the gap | proven |
| H22 | A hidden or empty `container` still takes 32px | proven |
| H23 | A negative right margin on `columns` adds horizontal scrollbars | proven |
| H24 | `tabs` lose the gap between the tab bar and the first field | proven |
| H25 | A `text` used as a label paints the primary colour / the wrong font | proven |
| H26 | Buttons with an empty code label render as blank 32px buttons | proven |
| H27 | A designer tab opened before an API write saves the old markup over it | proven (tooling) |
| H28 | A value the host form shows disappears after a subform loads (status tag shows, then goes blank) | proven |
| H29 | Partial device blocks make the style migration ignore top-level styles and defaults (no row gap, collapsed boxes) | proven |
| H30 | Collapsible panel headers taller with 8px padding all round | proven |

---

## H1 Form API moved (tooling)

* **Symptom:** `FormConfiguration/GetByName` returns 404; a script written for 0.43/0.45 that does `CreateNewVersion` / `UpdateStatus` fails; after `UpdateMarkup` the form's `modelType` is blank or changed.
* **Cause:** 0.46 has one row per form, edited in place; history is an automatic revision table. `FormConfigurationAppService` has no `GetByName` and no versioning calls (`Shesha.Web.FormsDesigner/Services/FormConfigurationAppService.cs:73-298`). `UpdateMarkupAsync` does `form.Markup = input.Markup; form.ModelType = input.ModelType;` (`:161-190`) - an omitted `modelType` clears it, a different one replaces it. Resolution by name goes through `Shesha.Application/ConfigurationItems/ConfigurationItemAppService.cs:30-65`.
* **Detect (tooling):** any recipe or script containing `GetByName`, `CreateNewVersion`, `UpdateStatus`, `versionStatus`, `isLastVersion`; any `UpdateMarkup` body without `modelType`.
* **Fix:** resolve with `ConfigurationItem/GetCurrent?ItemType=form&Module=&Name=`; push with `UpdateMarkup {id, markup, modelType}` where `modelType` is the value you just read; read back and compare. Recipes: [api.md](api.md).

## H2 Stale form from IndexedDB

* **Symptom:** API read-back shows your change; the portal still renders the old form (or a mix).
* **Cause:** the admin portal caches forms client-side in IndexedDB databases `form:default-app` and `form_lookup:default-app` (and the legacy `forms`), keyed by `cacheMd5`. The server `ConfigurationItem/CleanClientSideCache` only clears the server md5 cache (`ConfigurationItemAppService.cs:93-97`).
* **Detect:** browser output disagrees with a verified API re-fetch.
* **Fix:** delete the databases from a static page (`/favicon.ico`) where no app holds connections, then load the form - recipe in [verification.md section 2](verification.md). Do this before judging any change.

## H3 `htmlRender` drops a leading `<style>`

* **Symptom:** a form that used an `htmlRender` to inject CSS (chevron tabs, section styling) is unstyled.
* **Cause:** `sanitize` defaults to `true`; content goes through `DOMPurify.sanitize(html)` (`designer-components/htmlRender/index.tsx:39`, default at `:52-56`, migration `:62-67`). DOMPurify moves a `<style>` at the start of a fragment to `<head>` and drops it; a renderer that is only `<style>` becomes `""`.
* **Detect:** `c.type==='htmlRender' && /<style/i.test(c.renderer ?? c.html ?? '') && c.sanitize !== false`.
* **Fix:** set `sanitize: false` on the carrier (the branch at `:39` honours it), or prefix real content (`<div></div><style>...</style>` survives). The carrier must also be mounted (H6).

## H4 "Please, provide some content for this HTML render"

* **Symptom:** an antd Empty illustration with that text where an `htmlRender` is.
* **Cause:** the rendered/sanitised string is empty or whitespace, so `<Empty description="Please, provide some content for this HTML render" />` is shown (`htmlRender/index.tsx:42`). Typical: a style-only renderer after H3, a renderer that returns `''`/`undefined`, or `contentType:'html'` without `html` (H5).
* **Detect:** `c.type==='htmlRender'` and (renderer empty, or carrier-only: `!/<(?!\/?style)[a-z]/i.test(renderer.replace(/<style[\s\S]*?<\/style>/gi,''))`).
* **Fix:** for a pure CSS carrier set `sanitize:false` and keep the component zero-size with its own `style`/dimensions (the Empty placeholder still renders if the output is empty - emit at least a `<div></div>`); for content make the renderer return a non-empty string on every path.

## H5 `contentType: 'html'` ignores `renderer`

* **Symptom:** a script-driven `htmlRender` renders nothing/placeholder after someone "set content type to HTML".
* **Cause:** `const html = (model.contentType === 'html' ? model.html : calculatedModel.getContent(...))` (`htmlRender/index.tsx:38`). With `contentType:'html'` only the `html` property is read.
* **Detect:** `c.type==='htmlRender' && c.contentType==='html' && !c.html`.
* **Fix:** either put the markup in `html`, or remove `contentType` / set it to the script mode and keep `renderer`.

## H6 Hidden components are not mounted

* **Symptom:** an invisible helper (CSS carrier, data holder, hidden input with `initialValue`) has no effect any more.
* **Cause:** 0.43 passed `hidden` to antd `Form.Item` and kept children mounted; 0.46 returns `null` before rendering when hidden (`components/formDesigner/components/configurableFormItemLive.tsx:68`). `hidden` is `hidden || visible===false || !permissions || !visiblePermissions || !isComponentFiltered` (`components/formDesigner/formComponent/formComponentModelPreparer.tsx:106-114`).
* **Detect:** `c.hidden===true || c.visible===false` (or a code-mode `hidden`/`visible`) on `htmlRender`, or on an input that carries `defaultValue`/`initialValue` or a validator.
* **Fix:** do not hide side-effect components. Keep a CSS carrier visible and collapse it (`desktop.dimensions` height 0, `overflow:hidden`, no margin) or put the CSS in the target component's own `style`. Move default values to `formSettings.onAfterDataLoad`.

## H7 antd 6 tabs DOM

* **Symptom:** custom CSS written against tabs (chevron tabs, counters, pane styling) matches nothing.
* **Cause:** antd 6 / `@rc-component/tabs` renamed the DOM: `.ant-tabs-content-holder > .ant-tabs-content > .ant-tabs-tabpane` is now `.ant-tabs-body-holder > .ant-tabs-body > .ant-tabs-content` (pane = `.ant-tabs-content`). The tabs component `style` (e.g. `counterReset`) is no longer put on each pane inline; it becomes a class rule on the holder/`.ant-tabs-content` (`designer-components/tabs/styles.ts:58,73`; `tabs/index.tsx`). Collapse also changed (`.ant-collapse-content-box` is now `.ant-collapse-body`, header text `.ant-collapse-title`).
* **Detect:** any string (renderer, `style`, `className` CSS) matching `/ant-tabs-(content-holder|tabpane)|\[style\*=/` or `/ant-collapse-content-box/`; `c.type==='tabs' && /counter-?reset/i.test(c.style)`.
* **Fix:** rewrite selectors to the antd 6 chain and prefer the Shesha anchors, which survive library changes: live components carry `data-sha-c-id`, `data-sha-c-name`, `data-sha-c-type` (`components/formDesigner/formComponent/knownFormComponent.tsx:98-124`), e.g. `[data-sha-c-name="tabs1"] .ant-tabs-body-holder`. For per-pane styling give each tab item a `className` (it lands on `.ant-tabs-content`). Do not rely on hashed `css-xxxx` classes.

## H8 `text` v7 style keys

* **Symptom:** `text` padding/margin or font size from the markup has no effect; legacy `fontSize: 'text-xl'` renders at a different size.
* **Cause:** text v7 reads `desktop.stylingBoxJson` (an object) - not the `stylingBox` string; `desktop.font.size` overrides legacy `fontSize`; the legacy `padding: 'padding-base'` token is ignored (`designer-components/text/utils.ts`, `text/index.tsx:62-85`). The v5 migration converts tokens with a hard-coded 14px root and drops line height; `text-2xl`/`text-6xl` fall back to 14px (`text/models.ts:22,26`, `text/utils.ts:45`).
* **Detect:** `c.type==='text' && (c.stylingBox || c.fontSize || c.padding) && !c.desktop?.stylingBoxJson`.
* **Fix:** author v7 shape: `version: 7`, `desktop: { font: { size: 16, weight: '400', color: '...' }, stylingBoxJson: { _type:'styleBox', paddingTop:'0', ... } }` and no legacy keys.

## H9 Migration-injected defaults and phantom gaps

* **Symptom:** extra whitespace between sections; hidden blocks still reserve space; containers taller than their content.
* **Cause:** on load every component runs its migrations; style migrations fill defaults the stored markup never had (container `dimensions.minHeight: '32px'`, `columns` marginBottom 5, input heights 24/32/40, alert +8px padding) (`designer-components/_common-migrations/migrateStyles.ts:34-131`, `container/data.ts:157-232`). A component hidden by CSS-only means (or a container wrapper whose children are all hidden) keeps its own wrapper dimensions.
* **Detect:** `c.type==='container' && !c.desktop` (never saw the style step) or `version` below the current style-block step in [component-kb.md](component-kb.md); a container whose children are all hidden.
* **Fix:** write the structured `desktop` block explicitly with `dimensions: { height: 'auto', minHeight: '0' }` where no floor is wanted; set the real `version` so migrations do not run; remove or `visible:false` the whole empty container, not just its children. For the 32px container floor specifically see H22.

## H10 Render-time script throws before data loads

* **Symptom:** a field/section that should be hidden is shown; console shows `Cannot read properties of undefined`; styling from a script (`color`, `style`) is missing on first paint.
* **Cause:** scripts in code-mode settings (`{_mode:'code', _code, _value}`) run on every render, including before `data` is populated. A throw is swallowed (`providers/form/utils/scripts.ts:22,50`) and a throwing visibility is treated as VISIBLE (migrated `visible` carries `_value: true`). The style migration copies code settings into `desktop|tablet|mobile.*` (e.g. `font.color`), so the same script runs in several places.
* **Detect:** in every `_code` (anywhere in a component, including `desktop/tablet/mobile.*`) a read chain like `data.a.b` or `data?.a.b` - i.e. a `.` access after a possibly-undefined hop: `/\b(data|form\.data|contexts?\.\w+|page\.state)(\?\.|\.)\w+\.\w+/` without `?.` on every hop.
* **Fix:** optional chaining on **every** hop in render-time scripts (`data?.a?.b`), with a safe default (`Boolean(data?.a?.b)`). **Never** use `?.` on an assignment target (`data?.a = 1` is a syntax error) - guard with `if` instead. Syntax-gate edited scripts ([api.md section 9](api.md)).

## H11 Arrays from `data`/`value` are mutated in place

* **Symptom:** "changed?" comparisons always say unchanged; a stored snapshot silently follows later edits.
* **Cause:** the form hands scripts the live array object from form data; later edits mutate that same array.
* **Detect:** a script that stores `data.someArray` / `value` for later comparison without copying (`/=\s*(data|value)[\w.?]*\s*;/` where the value is an array).
* **Fix:** copy at the point of storing: `const before = (data?.items ?? []).slice()` (or `structuredClone`). Compare against the copy.

## H12 `ReferenceList/GetItems` is gone

* **Symptom:** 404 from a script or custom endpoint call that fetched reference-list items.
* **Cause:** the 0.43 `ReferenceList` service surface was replaced by the configuration-item loader.
* **Detect:** any string matching `/ReferenceList\/GetItems/`.
* **Fix:** `GET /api/services/app/ConfigurationItem/GetCurrent?ItemType=reference-list&Module=<mod>&Name=<list>` (items are in `result.configuration`), or `ReferenceList/GetByName` where a compatibility endpoint exists on that app. For dropdowns prefer `dataSourceType: "referenceList"` with `referenceListId: {module, name}` and let the component load it. Probe first; do not assume.

## H13 `refListStatus` inside a `subForm`

* **Symptom:** a `subForm` that hosts a `refListStatus` throws `Component with id ... is not found` and the form errors out.
* **Cause:** `refListStatus/index.tsx:50` calls `useComponentModel(model.id)` from the markup context (`providers/form/providers/formMarkupProvider.tsx:27` throws when the id is absent); sub-forms do not provide that context. Framework bug.
* **Detect:** a `refListStatus` anywhere under a `subForm` (or a form that is itself rendered as a sub-form / row template).
* **Fix:** flag it to the framework owners. Workaround: render the status in the parent form, or show the reference-list value with a read-only `dropdown`/`text` bound to the display value inside the sub-form.

## H14 `subForm` `labelCol: 0`

* **Symptom:** fields inside a `subForm` have no visible labels.
* **Cause:** the sub-form label span is `model.hideLabel === true ? 0 : model.labelCol ?? 0` (`designer-components/subForm/index.tsx:87`); the host's `labelCol` is applied to the hosted fields, so 0 hides their labels. Known core issue.
* **Detect:** `c.type==='subForm' && !(c.labelCol>0)`.
* **Fix:** a positive span on the sub-form component, e.g. `labelCol: 8, wrapperCol: 16` (the core fix ships 8), or `10/14` when long labels need more room; keep `hideLabel` for the sub-form's own label only. A wider span reduces wrapping but does not stop a wrapped label overlapping (see H20).

## H15 `editMode` boolean false = disabled

* **Symptom:** a read-only view shows greyed (disabled) controls.
* **Cause:** `getDisabledAndReadOnly`: `false -> {disabled:true}`, `true|'editable' -> editable`, `'readOnly' -> readOnly`, anything else (incl. `'disabled'`) -> disabled (`components/formDesigner/formComponent/formComponentApi.ts:18-27`). 0.43 treated `false` as read-only.
* **Detect:** `c.editMode === false` or `editMode._mode==='code' && /return\s+(true|false)\b/.test(editMode._code)`.
* **Fix:** return the strings `'editable' | 'readOnly' | 'disabled' | 'inherited'`. See [edit-mode.md](components/edit-mode.md).

## H16 `columns` gutter

* **Symptom:** `columns` content is inset by `gutterX/2` on both outer sides compared with older versions.
* **Cause:** the Row is forced to `marginLeft/marginRight: 0` while each Col keeps `paddingInline: gutter/2` (`designer-components/columns/columns.tsx:57`).
* **Detect:** `c.type==='columns' && gutterX > 0`.
* **Fix:** for new work, use flex `container` rows for splits, not `columns`. For existing `columns`, restore the LEFT inset only: Margin left `-(gutterX/2)` on the columns component. Store it where the stored version survives migration: below v4 the v4 step replaces `desktop` with the top-level props, so write the top-level `stylingBox` JSON string; at v6+ write `desktop/tablet/mobile.stylingBoxJson`. Do not add a negative right margin (H23). Leave an author's explicit horizontal margin alone.

## H17 `datatable` forced defaults

* **Symptom:** zebra rows, hover highlight, grey header, single-row selection appear on tables that stored none of it.
* **Cause:** steps v12-v31 in `designer-components/dataTable/table/tableComponent.tsx:273-389` force `striped=true`, `hoverHighlight=true` (even over a stored `false`), row height/padding, header colours, `useMultiselect false -> selectionMode single`.
* **Detect:** `c.type==='datatable' && (c.version ?? -1) < <current>` in the KB.
* **Fix:** author at the current `version` with explicit `striped`, `hoverHighlight`, `selectionMode` so no step runs.

## H18 `text` v7 content rewrite

* **Symptom:** `{{data.x}}` in a legacy `text` shows empty after load.
* **Cause:** v7 migration rewrites `{{` to `{{data.` for content stored below v7, so `{{data.x}}` becomes `{{data.data.x}}` (`text/index.tsx:73-85`).
* **Detect:** `c.type==='text' && c.contentDisplay!=='name' && (c.version ?? -1) < 7 && /\{\{\s*(data|contexts)\./.test(c.content)`.
* **Fix:** author new text at `version: 7` with `{{data.x}}` (or `contentDisplay: 'name'` + `propertyName`); for legacy text lower the prefix (`{{x}}`) before it migrates.

## H19 `text` ignores `hidden`/`visible`

* **Symptom:** conditional texts (validation hints, notes, banners) always show; changing the condition has no effect.
* **Cause:** in live mode 0.46 hides a component only inside `ConfigurableFormItem` (`components/formDesigner/components/configurableFormItemLive.tsx:68`) or when its own Factory checks `model.hidden`. `text` (`designer-components/text/index.tsx` -> `genericText.tsx`) does neither, and the generic wrapper `knownFormComponent.tsx` has no hidden guard. Proven by interception: `visible: {_mode:'value', _value:false}`, `visible` code `return false;` and `hidden: true` all left every text on screen. `collapsiblePanel` was suspected from source but does honour `visible:false` on a running app - check other non-form-item types the same way before assuming.
* **Detect:** `c.type==='text'` with a `visible`/`hidden` setting that is code, `false`/`true` respectively, or a value-mode `false`/`true`.
* **Fix (workaround until the framework enforces it):** keep the visibility setting and also drive `display:none` from the same expression through `style`, which `text` applies to its own element (`genericText.tsx:45`). Wrap, do not replace: the existing style result is preserved and the wrapper is marked so it can be removed when the framework is fixed:

```js
/*reconciler:046-visibility-style*/
const __vis = (() => { /* the visible expression body, or !(hidden) */ })();
const __base = (() => { /* the original style body, or return {}; */ })() || {};
return __vis === false ? Object.assign({}, __base, { display: 'none' }) : __base;
```

Apply it to the root `style` and to any `desktop`/`tablet`/`mobile` block that has its own `style` (a device `style` overrides the root one). Verify both directions: the hidden case disappears and a forced-visible case still shows.

## H20 Multi-line labels overlap the next row

* **Symptom:** a long field label wraps onto two or more lines and its text runs into the field below; the row does not grow.
* **Cause:** antd 6 `.ant-form-item .ant-form-item-label > label { height: var(--ant-form-label-height) }` (32px). The variable is defined by the `css-var-*` class on the label column itself, so nothing set on an ancestor (a container's or subform's custom style) can override it. The label COLUMN follows the field's Appearance > Height when that is an exact value (`components/formDesigner/components/styles.ts`), but the label element stays 32px, so a field Height of `auto` does not help either. Line counts are unchanged from older versions; only the height behaviour changed (measured: 2/3/4-line labels gave rows of 38/49/60px before, 35px on 0.46).
* **Detect:** in the browser, `label.scrollHeight > label.clientHeight + 2` for `.ant-form-item-label label`. Wrapping depends on the label column width, so measure at the target screen width instead of guessing from label length.
* **Fix (configuration only):** move the label out of the field. Replace the field with:
  - a horizontal row `container` (align items centre, no wrap, gap 0) that takes the field's own visibility condition;
  - a `text` label inside it: width = the label column share (labelCol 8 -> 33.333%, 10 -> 41.667%), right-aligned, weight 700, 14px, `rgba(0,0,0,0.88)`, padding-right 13px (antd's label `::after` gap), `contentType: 'custom'` and font type `inherit` (H25);
  - a field holder `container` with width `stretch` holding the original field with `hideLabel: true`.

  The input then starts at the same x as the inputs of the neighbouring fields. Copy the `text` and `container` shapes from working instances in the same form, not from documentation. Skip required fields unless the required mark is rebuilt (the field's red `*` goes with its label). Vertical label layout (`ant-form-item-vertical`) also lets labels grow, but mixed into a horizontal form it looks inconsistent.

## H21 Field rows are 35px

* **Symptom:** every field row is 3px taller than before; a long column of fields drifts down (row pitch 40px instead of 37px).
* **Cause:** `components/formDesigner/styles/shaComponentStyles.ts:20-24` gives every field label column `padding-bottom: 3px` (not configurable). The 5px gap between rows is antd's `.ant-form-item-row` margin, which collapses with the field's own bottom margin, so a positive field margin (e.g. 2) changes nothing.
* **Detect:** `.ant-form-item` height 35 where the control is 32.
* **Fix:** field Appearance > Margin bottom `-3`. The negative margin collapses with the row's +5: 5 + (-3) = 2, and 35 + 2 = a 37px pitch. Store it the same way as H16 (top-level `stylingBox` below the style step, device `stylingBoxJson` above it); skip fields whose author stored a bottom margin.

## H22 Hidden or empty containers take 32px

* **Symptom:** blank bands between sections where a container is hidden or has no visible content; field columns step out of line beside them.
* **Cause:** the container dimension default `minHeight: '32px'` (`designer-components/container/data.ts:163`) is applied by a generated class on the component wrapper, which a hidden container still renders (empty). Separately, framework CSS `.sha-form .sha-components-container { min-height: 32px }` (`components/configurableForm/styles/styles.ts:33-35`) applies to every inner container including column cells; no setting reaches that rule.
* **Detect:** a visible, empty `.sha-component[data-sha-c-type="container"]` 32px tall; a `.sha-components-container` exactly 32px with no content.
* **Fix:** container Appearance > Dimensions > Min height `0px` (wrapper). Skip containers whose author stored a real floor. The inner-container rule only matters for empty cells.

## H23 Negative right margins scroll

* **Symptom:** horizontal scrollbars appear inside tab bodies and containers after compensating `columns` with negative margins on both sides.
* **Cause:** containers migrate to `overflow: auto` (the container v6 migration defaults `overflow: true`) and the tabs body hard-codes `overflow: auto` (`designer-components/tabs/styles.ts`). A right margin of `-gutter/2` makes the columns block wider than its scrolling parent; a left overflow is not scrollable.
* **Fix:** left margin only (H16). The right edge stays `gutter/2` inside, which reads fine.

## H24 Tab bar gap

* **Symptom:** the first field sits right under the tab bar.
* **Cause:** 0.46 tabs set `.ant-tabs-nav { margin: 0 }`; antd's default was a 16px bottom margin.
* **Fix:** usually none needed; if the gap is wanted, give the first container in each pane a top margin of 16 in its Appearance.

## H25 `text` as a label: colour and font

* **Symptom:** a `text` copied from a heading or a coloured text paints the primary colour, or renders in the text default font instead of the app font.
* **Cause:** `designer-components/text/genericText.tsx`: `contentType: 'primary'` adds the primary class and ignores `font.color`; only `contentType: 'custom'` uses `font.color`. An absent `font.type` falls back to the text default family (Segoe UI) rather than the theme font (`_settings/utils/font/utils.tsx`).
* **Fix:** `contentType: 'custom'`, an explicit `font.color`, `font.type: 'inherit'`.

## H26 Buttons with an empty code label

* **Symptom:** blank 32px buttons (37px with margin) appear in a form, often inside field columns where they push one column's rows down.
* **Cause:** a `button` whose `label` is `{ _mode: 'code', _code: null }` renders an empty label. The same markup also rendered blank buttons before 0.46, so it is legacy configuration, not a regression; it becomes noticeable once other gaps are fixed.
* **Fix:** do not delete them unless the owner confirms they are unused (they may carry actions). Move them out of the columns into one row container placed after the columns, and give that row container `visible: false` (a hidden container renders nothing and leaves no gap). Related: a `columns` block holding only one conditional `text` (a validation hint) keeps 1px plus its margin when the text is hidden (H19); give the columns block the text's own visibility condition.

## H27 Stale designer tab overwrites API writes

* **Symptom:** after a markup push through the API, Configuration Studio still shows the old form; saving from it brings the old markup back.
* **Cause:** the designer holds the markup it loaded in memory. `UpdateMarkup` writes in place with no revision (H1), so a save from a tab opened before the push overwrites the push.
* **Fix:** close the form's tab in Configuration Studio and reopen it from the Explorer (or reload the page) after every API push; never save from a tab older than the last push. Say so whenever you push to a backend someone else is designing on.

## H28 Host values disappear after a subform loads

* **Symptom:** a tag or field in the host form shows its value, then goes blank a moment later (e.g. a status tag next to the page title).
* **Cause:** a `subForm` with `dataSource: 'api'` and an explicit `properties` list loads its entity and writes the result into the host's field named by its `propertyName`, replacing the host's copy of that object. Any `<propertyName>.<x>` the HOST shows but the subform does not fetch is gone after the subform's `Crud/Get` returns. Timeline proven in the browser: tag rendered at 13s, blank at 15s, right after the subform's request; the host's own request did return the value.
* **Detect:** for each api `subForm` with a `properties` string: the top-level names of every host component `propertyName` starting with `<subForm.propertyName>.`, minus the names in the properties list.
* **Fix:** append the missing names to the subform's `properties` list. Verify by watching the tag for 30+ seconds after load.

## H29 Partial device blocks drop styles and defaults

* **Symptom:** components stored at an old version look wrong in ways their settings do not explain: horizontal rows with no gap (table toolbars where search, filter, refresh, columns and pager touch), boxes collapsing, top-level styles ignored.
* **Cause:** the style migration builds each device block from `prev[screen]` when that block exists and from the top-level props only when it does not (`_common-migrations/migrateStyles.ts`, `migratePrevStyles`). A partial block - only a `className`, or a single value written by a tool - therefore wins over every top-level style, and the container's later step copies `gap: prev.gap` (often unset), giving `gap: 0`.
* **Detect:** a component below its style-block step (see [component-kb.md](component-kb.md)) whose `desktop/tablet/mobile` blocks hold only a few keys; a horizontal container with no `gap` in any block and no top-level `gap`.
* **Fix:** never create a partial device block on a component below its style step - write the value at the top level instead (e.g. `dimensions.minHeight`). Where partial blocks already exist, add the missing value to every block (`gap: '8px'` restores a spaced row). If a tool created a partial block, remove it again.

## H30 Panel headers

* **Symptom:** collapsible panel headers are 52-56px with 8px padding on every side; before they were 50px with 5px top and 10px left padding.
* **Cause:** the panel migration writes default `headerStyles` (padding 8 all round) into every device block (`collapsiblePanel/collapsiblePanelComponent.tsx`).
* **Fix:** where the stored header padding is still exactly the default, set `headerStyles.stylingBoxJson` padding to 5 / 0 / 0 / 10 in each device block.

---

## Scanner

`scripts/scan-hazards.mjs` implements the predicates above that are decidable from markup alone (H3-H18 except H2; H1 is a tooling hazard, covered by `scripts/form-api.mjs`) and, with `--syntax`, the script syntax gate.

```bash
node scripts/scan-hazards.mjs staged/form.json            # report
node scripts/scan-hazards.mjs staged/form.json --json     # machine-readable
node scripts/scan-hazards.mjs staged/ --syntax            # a directory of forms + syntax-check every _code
```

Exit codes: 0 clean, 1 findings, 2 could not run. A hit is a **hypothesis**: confirm in the browser before rewriting a working form (the predicates are deliberately broad).
