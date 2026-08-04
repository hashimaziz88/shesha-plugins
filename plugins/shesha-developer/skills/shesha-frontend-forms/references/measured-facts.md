# Measured facts about Shesha 0.45

Every entry was established by running something against the installed framework or a live app,
not by reading prose. Each carries its evidence. Where a fact contradicts what the previous
stack's documents claimed, the contradiction is recorded — those documents were the reason the
old pipeline could only be fixed by writing more prose.

If you remember a Shesha detail and it is not in this file, verify it before acting on it.

---

## The framework's own surface

**`getComponentDefinitions` is not a runtime export.**
The `.d.ts` exists because tsc emits per-file declarations, but the rollup bundle exports 533
names and this is not one of them. `Migrator`, `migrateFormSettings` and `getNanoId` are also
unexported.
*Reachable instead:* `useFormDesignerComponents()` is a public root export, and every dependency
it has is optional — `useSheshaApplication(false)` returns `undefined` rather than throwing, and
`app?.formDesignerComponentGroups` is optional-chained. So the registry is obtainable from a
**bare React render with no provider tree, no backend and no auth**.
`useIsDevMode()` reads `localStorage`, which is why this must run in a browser rather than Node.

**The package is not importable in bare Node.**
`dist/index.es.js` statically imports `react-big-calendar/lib/css/react-big-calendar.css`
(→ `ERR_UNKNOWN_FILE_EXTENSION`) plus `next/image`, `next/link` and `next/navigation`.
The harness bundles with esbuild using `loader: { '.css': 'empty' }`, stubs for `next/*`,
`@bprogress/next`, `next-navigation-guard` and node builtins, and
`nodePaths: [<app>/node_modules]` so bare specifiers resolve.

**`react-icons` is a latent app defect.** Shesha declares `^5.1.0`; `SiCss3` was renamed inside
that range, so 5.6.0 breaks the import. The harness stubs `react-icons` with a CJS Proxy.

**`IToolboxComponent` has no `group` and no `getDefaultStyles()`.**
Grouping lives on `IToolboxComponentGroup`. Default styles are per-component module exports
(`designer-components/*/util.d.ts → defaultStyles`), unreachable from the package root — recorded
as a gap in `ground-truth.json.gaps`.

**Versions come from each type's own migrator chain.** `def.migrator` is
`(m) => MigratorFluent`; passing a duck-typed recorder `{ add(v, fn) { versions.push(v); return
this } }` yields the real chain, so `lastVersion = max(versions)`. Types with no migrator record
`null` explicitly. `datatable` is 29 deep. Omitting `version` replays every migration from -1; a
stale version silently drops the entire `desktop` style block.

---

## Keys and types that older prose got wrong

| Claimed | Measured |
|---|---|
| `stylingBoxJson` is current | **Does not exist in 0.45** — 0 occurrences in typings or bundle. The key is `stylingBox`, a *stringified* JSON string. Emitting `stylingBoxJson` authors a dead channel. |
| `datatableContext` wraps a table | The working type is **`dataContext`**. `datatableContext` is `Data Context (Legacy)`, not authorable (no settings form). Using it renders nothing. |
| table columns live in `columns` | They live in **`items`**. |
| `columns` component for layout splits | Excluded by design (R-028). Use flex containers sized by `desktop.dimensions.width`. |

## The text content contract (R-059)

`desktop.font.*` on a `text` component is **inert** unless all of these are present alongside
`content`:

```js
textType: 'span' | 'paragraph' | 'title',
contentDisplay: 'content' | 'name',   // 'name' when bound
contentType: 'custom',                // 'custom' is required for a font COLOUR (R-052)
content: '…'
```

Mined by rendering, not reasoned. Setting the font block alone produced a form that passed every
offline gate and rendered unstyled text. This took the Phase 6 worklist from FAIL to PASS on all
three rendered gates.

## Prop types are harvested, not listed

`probe` walks each type's settings-form markup and records the editor and its legal values:
**4188 typed props, 700 enums, 697 with static value sets** across 116 types. R-058 validates
against these.

Two traps in that walk, both of which returned a smaller *plausible* answer with no error:

- Most 0.45 settings fields live in `settingsInputRow.inputs[]`. A walker that does not recurse
  into `inputs` finds 34 enums instead of 700 and misses every appearance channel on `text`.
- The real editor is `node.inputType`, not `node.type` — `type` is the generic wrapper
  `settingsInput` (490 occurrences). `settingsInput.tsx` unwraps exactly this way.
- Choices live in `dropdownOptions` (`IDropdownOption[]`) and `buttonGroupOptions`
  (`IRadioOption[]`).

`contentType` includes the **empty string** as a legal value. Treating it as illegal fails a
correct form.

## Structure

**A slot child's `parentId` is the SLOT's id, not the owning component's.**
`card.content.components[0].parentId === card.content.id`. `card` slots are `header` and
`content`; `collapsiblePanel` adds `customHeader`.

**`content` is a slot on `card` but a plain prop on `text`.** Any walker that skips a key by name
rather than by checking whether the value *is* a slot will silently make rules unreachable.

**A missing `parentId` is a warning, not a failure.** `componentsTreeToFlatStructure` recomputes
it from tree position (`null → "root"`), and a shipped production form carries three nulls and
renders.

**`isInput` does not mean "binds an entity property".** It is `true` for `datatableContext` and
`datatable`, whose `propertyName` is an identifier. Use `dataTypeSupported` instead — flagging
those was a false positive on correct shipped markup.

---

## The rendered DOM

**Shesha's datatable is not an antd Table.** It is a div-based react-table carrying
`sha-datatable-wrapper` / `sha-data-table` / `sha-react-table` / `sha-table`. There is **no
`ant-table` class and no `<table>` element**. Matching antd or the tag reports "no table" on a
page that plainly rendered one.

**Scope measurement to the form, not the page.** `document.body` sweeps in the adminportal shell
— its dark rail, header and fonts — so `pageBackground` reads as the shell's transparent body and
`fontFamily` reads `-apple-system`. Every colour axis then fails on a correctly themed form.
Scope to the **largest** of `.sha-page-content` / `.sha-form` / `.sha-components-container` /
`main`; selecting the *first* match grabbed a 43-node subtree of a page with hundreds.

**Escapes inside `CAPTURE_FN` must be doubled.** It is a template literal, so `\s` collapses to
`s` and `\(` collapses to `(`. Both shipped: `/\s+/` split class lists on the letter "s", and
`/rgba(0, 0, 0, 0)|transparent/` searched for the literal text `rgba0, 0, 0, 0` so a fully
transparent background scored as a real colour. Neither threw.

**Readiness before measurement.** Require real form output with no `.ant-spin-spinning`, else
exit 12. Measuring a spinner once produced six confident design failures against a blank page.

**A row is wrapped only when one child sits entirely below another.** Comparing tops flagged
every centred row.

---

## Backend

- Auth is **`POST /api/TokenAuth/Authenticate`** — *not* `/api/services/app/...`.
- **Cache the token BOM-free.** A UTF-8 BOM yields "Current user did not login".
- Reference lists come from `Entities/GetAll` over `Shesha.Domain.ReferenceListItem`. There is no
  ReferenceList service.
- `GetModules` returns `{ modules: [...] }` with names but **no ids**; the moduleId map comes from
  `GetFlatTree`.
- `UpdateMarkup` body is `{ id, markup: JSON.stringify(markup), access, permissions }` — **no
  `modelType`**.
- `CreateItem` requires `discriminator: 'form'` and takes **no markup**. Omitting the
  discriminator returns HTTP 500 "Parameter 'key'".
- Clear form caches via CDP `Storage.clearDataForOrigin` (R-056); IndexedDB stores `form` and
  `form_lookup` otherwise serve a ghost.

## Theme

`Shesha.ThemeSettings` carries `application` / `sidebar` / `layoutBackground` / `text` /
`sidebarBackground` / `labelSpan` / `componentSpan` / `marginPadding`. **No token block, no
component block.** Primary-button fill comes from the app theme, not a per-component channel —
`fontFamily` likewise is not a per-component channel. Both are recorded as `notAsserted` rather
than being asserted and failing.

## Known gaps

Recorded rather than guessed: `defaultStyles`, `formSettingsVersion`, `componentGroup` (not
derivable — `IToolboxComponent` has no `group`), prop **effect** (whether a legal prop reaches the
DOM — validity is now checkable via R-058, effect still needs measurement), and R-053's full
measured matrix, which this rebuild deliberately does not vendor.

`formSettings.version`: the runtime migration chain ends at **8**, the live PBF form carries
**1**, and the typings admit only `-1|1|null|undefined`. Unresolved — decide with evidence before
setting it.
