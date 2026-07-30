# Archetype vocabulary

This file is the **single archetype vocabulary** for this skill. It supersedes:

- the partial archetype list in [blueprint-consumption.md](blueprint-consumption.md) (which mapped
  only 4 of the 8 to seeds);
- the block-level `$kind` tags found in `assets/blocks/*.block.json` (`fragment`, `list`,
  `layout`) — those are block *kinds* (what a block structurally is), not archetype names, so
  the field was renamed to `$kind` and no block file carries an `$archetype` value anymore. See
  [block-library.md](block-library.md) for the `$kind` taxonomy; this file remains the only
  place archetype names are defined.

There are exactly **eight** archetypes, and all eight now have a flow manifest under
`assets/archetypes/*.flow.json` — every one loads with `loadFlow` and passes `validateFlow` with
zero problems against the registry and role catalogue.

| Archetype | Flow manifest | Seed / exemplar | When to use |
|---|---|---|---|
| `table-worklist` | `table-worklist.flow.json` | `table-worklist--employee-table.json` | Dense admin grid: dataContext + toolbar (Add action, quick search) + datatable + pager. The default for "a list/table of X". |
| `record-detail` | `record-detail.flow.json` | `assets/exemplars/record-detail-simple.json`, `assets/exemplars/record-detail-with-children.json` | Per-record page reached by navigating from a table row: header band carrying the Start Edit/Submit/Cancel Edit lifecycle, plus a body split into a main column and a related-panels rail. |
| `capture-dialog` | `capture-dialog.flow.json` | `capture-dialog--rs-create-dialog.json`, `assets/examples/rs-link-add-dialog.json` | Modal create/edit hosted by a parent's Add action (subtable toolbar, table Add button). Submits via the dialog footer — the dialog chrome supplies Save/Cancel, so the form body itself does not author a Submit button. |
| `standalone-capture` | `standalone-capture.flow.json` | `standalone-capture--standalone-create.json`, `standalone-capture--employee-create.json` | Full-page create/edit opened as its own screen (not a dialog) — "make a form for X" with no parent context. Always needs a Submit **and** a Back exit; a form you can save but not leave is the single most-forgotten defect in this codebase (see [form-quality.md](form-quality.md)). |
| `list-card` | `list-card.flow.json` | `list-card--entity-datalist.json`, `list-card--entity-card-item.json` | A `datalist` of row-template cards rather than a grid — browsing/gallery views. dataContext + toolbar (Add) + `datalist` + pager; the row template (`list-card--entity-card-item.json`-style) is a separately published form, declared as a `rowTemplate` dependency alongside the create and detail dependencies the Add action and row navigation need. |
| `hub` | `hub.flow.json` | — | Landing page of navigation tiles into other screens: page + header band + a wrapping tile grid (`card-grid`) + repeated `nav-tile` nodes, each a container holding a text label and a navigate action. **Not** the same shape as the P2/`golden` corpus's former `hub--rs-detail-with-header.json` — that file was a record-detail page mis-archetyped under the word "hub"; it has been renamed to `record-detail--rs-detail-with-header.json` (see "Retired P2 vocabulary" below). |
| `dashboard` | `dashboard.flow.json` | — | Metric tiles + a chart, no single entity binding: page + header band + a row of `metric-tile` nodes (`card-grid`) + at least one `chart-surface` wrapping an authorable chart type (`barChart`/`lineChart`/`pieChart`/`polarAreaChart`). |
| `wizard` | `wizard.flow.json` | — | Multi-step capture split across steps with its own progression state: the `wizard` component (role `wizard-shell`) holding per-step `wizard-step` containers, plus `validationErrors`. Back/Next/Done navigation is the wizard component's own built-in affordance (`showBackButton`, `showDoneButton`, `backButtonText`, …) — no separate navigation `buttonGroup` is authored. This is a real, compilable archetype — do not confuse it with the retired path's `wizard`, which had no node kind and no fixture and silently compiled to a plain stack + Save/Back (see "Retired P2 vocabulary" below). |

Other seeds that don't map to a single archetype above but are useful as fragments:
`assets/golden/table-worklist--inline-editable-table.json` (an inline-edit grid variant of
`table-worklist`, filed under that archetype — see "Retired P2 vocabulary" below), and
`assets/examples/rs-subtable-tab-fragment.json` (a subtable-in-tab fragment, used
inside `record-detail` bodies).

## Retired P2 vocabulary — the mapping

A prior merge brought in a second, 11-value archetype enum
(`shesha-design-comprehension/schemas/blueprint.schema.json`, now retired). Every value in that
enum maps to one of the eight above, is explicitly unsupported, or is retired outright:

| P2 name | Resolution | Notes |
|---|---|---|
| `hub` | → `record-detail` | **False friend**: P2's `hub` meant "main+rail detail page", the opposite of P1's `hub` (a nav-tile landing page). The one golden file using this name (`hub--rs-detail-with-header.json`) was verified as a record-detail shape (Start Edit/Submit/Cancel Edit lifecycle present) and renamed `record-detail--rs-detail-with-header.json`. |
| `modal-dialog` | → `capture-dialog` | **Semantically inverted**: P1's `capture-dialog` contract is that the dialog chrome supplies Save, so the form body must **not** author a Submit. The retired `compile-blueprint.js` treated `modal-dialog` as a capture archetype and injected a Submit+Back pair — do not port that behaviour. Golden file renamed `modal-dialog--rs-create-dialog.json` → `capture-dialog--rs-create-dialog.json`. |
| `capture` | → `standalone-capture` | Golden file renamed `capture--employee-create.json` → `standalone-capture--employee-create.json`. |
| `capture-standalone` | → `standalone-capture` | Near-identical name/word-order to `capture` above — a human reads these as the same archetype. Golden file renamed `capture-standalone--standalone-create.json` → `standalone-capture--standalone-create.json`; the `capture-standalone` spelling is not used anywhere else in the tree. |
| `list-card-item` | → `list-card`'s row-template | Not a separate archetype: it is the form a `list-card`'s `datalist` delegates each row to via its `rowTemplate` dependency. Golden file renamed `list-card-item--entity-card.json` → `list-card--entity-card-item.json` so the archetype-prefix convention still resolves to one of the eight. |
| `wizard` | → P1's `wizard` (kept) | **Phantom in P2**: no node kind, no fixture — `compile-blueprint.js`'s `compileNode()` has no `wizard` case, so it silently fell through to `buildContainer()` (a plain stack) plus the capture-archetype floor (Save/Back). P1 ships a real `wizard.flow.json` manifest and component; that is the only `wizard` a build should ever target. |
| `table-worklist`, `list-card`, `dashboard` | unchanged | Same name, same meaning in both vocabularies. |
| `inline-card` | → `table-worklist` (fragment) | No P1 equivalent archetype. Already documented above as an inline-edit variant of `table-worklist`, not a standalone archetype — golden file renamed `inline-card--inline-editable-table.json` → `table-worklist--inline-editable-table.json` so its filename prefix also resolves to one of the eight. |
| `auth-page` | unsupported-for-now | See "Unsupported" below. |
| `solution-map` | retired outright | No fixture existed anywhere in the corpus and no code path (compiler, gym, evals) ever referenced it — removed with the retired schema, nothing else to migrate. |

## Unsupported (not part of the eight)

- **`auth-page`** — an anonymous full-page login/register/OTP shell (`assets/golden/auth-page--auth-login.json`, flagged `"status": "unsupported"` in `_index.json`). No flow manifest, no compiler support (`compile-spec.mjs` has no auth-page node kinds or flow). Kept in the corpus as a manual-clone reference only, per `references/components/layout.md`'s "house pattern for full-page forms" — copy its JSON by hand when building an anonymous auth screen; do not pass it through `compileSpec()`.

## How the eight shipped manifests were scoped

Each manifest states the **complete required node set** for its flow, so a required node (Add
action, row action, quick search, pager, etc.) is never silently dropped when reverse-engineering
a blueprint from prose. Load a manifest with `loadFlow(archetype, { dir })` from
`scripts/lib/flow.mjs`, get its flat node list with `requiredNodes(flow)`, and validate it against
the registry and role catalogue with `validateFlow(flow, { registry, roles })` before treating a
build as complete.

- **`table-worklist`** — dataContext, page-root container, header band (heading + subtitle), a
  toolbar row (Add buttonGroup wired to a `createForm` dependency + quick search), the datatable
  itself (with a required navigate-action column wired to a `detailForm` dependency), and a pager
  row. It does **not** require a column-chooser button:
  `datatable.selectColumnsButton` is `authorable: false` in the registry (the framework marks it
  `isHidden`), so a manifest requiring it would make `validateFlow` reject every table-worklist
  build.
- **`record-detail`** — dataContext, page-root container, a header band carrying the Start
  Edit/Submit/Cancel Edit lifecycle `buttonGroup` (all three actions `actionOwner: "shesha.form"`),
  a `validationErrors` node, and a body split into a main column (`section-card`) and a related
  panels rail (`detail-rail`) — both are flex `container`s. **Never** a `columns` component: this
  project's only split mechanism is a flex `container` row with explicit
  `desktop.dimensions.width` on each child (see [blueprint-consumption.md](blueprint-consumption.md)).
- **`capture-dialog`** — a root container, `validationErrors`, and an exit `buttonGroup` carrying
  `Close Dialog` / `shesha.common`. No Submit button is required in the node set: this archetype
  relies on the dialog footer submit supplied by the hosting `Show Dialog` action, matching every
  shipped create-dialog seed (`capture-dialog--rs-create-dialog.json`, `assets/examples/rs-link-add-dialog.json`) — none of them
  author an in-body Submit button.
- **`standalone-capture`** — page-root container, header band, `validationErrors`, and an action row
  `buttonGroup` carrying **both** `Submit`/`shesha.form` and `Navigate`/`shesha.common`. This pairing
  is non-negotiable: `form-quality.md` documents the Back/exit button as the single most-forgotten
  case, because a terse prompt ("a form with one required field") names no buttons at all and it is
  easy to emit only the Submit and stop.
- **`list-card`** — dataContext, page-root container, header band (heading + subtitle), a toolbar
  row (Add `buttonGroup` wired to a `createForm` dependency), a `datalist` tagged `grid-surface`
  (documenting its `formId` row-template wiring against a `rowTemplate` dependency, and its
  `onListItemClick` row-navigation wiring against a `detailForm` dependency), and a pager row. It
  does **not** require a `datatable`: the whole point of this archetype is a `datalist` of
  row-template cards, not a grid. Three dependencies, not two — the row template
  (`list-card--entity-card-item.json`-style) is its own separately published form, on top of the create-dialog and
  record-detail dependencies `table-worklist` also needs.
- **`hub`** — page-root container, header band, a `card-grid` tile grid, and three `nav-tile`
  containers (more than one, to prove the archetype is a grid and not a single tile), each with a
  text label and a single-action `buttonGroup` (`Navigate`/`shesha.common`). No dependencies: a hub
  doesn't bind a single entity, and its tiles' navigate targets are a build-time wiring detail, not
  a required form.
- **`dashboard`** — page-root container, header band, a `card-grid` row of three `metric-tile`
  containers (label + value text pair each), and a `chart-surface` wrapping a `barChart` node. Any
  of `barChart`/`lineChart`/`pieChart`/`polarAreaChart` satisfies "a chart type" — all four are
  `authorable: true` in the registry; `barChart` was picked as the representative default. No
  dependencies, matching `hub`.
- **`wizard`** — page-root container, header band, `validationErrors`, and the `wizard` component
  itself (role `wizard-shell`) holding three `wizard-step` containers (more than one, proving
  "multi-step"). The registry's `wizard` entry (`customContainerNames: ["steps"]`) supplies its own
  Back/Next/Done navigation via component props (`showBackButton`, `showDoneButton`,
  `backButtonText`, `nextButtonText`, `doneButtonText`, `buttonsLayout`) — the manifest documents
  those under the node's `props` field rather than requiring a separate navigation `buttonGroup`,
  because the wizard chrome already supplies it (the same reasoning `capture-dialog` uses for its
  dialog-footer submit).

## Judgement calls

- The role catalogue (`shesha-design-system/assets/roles.styles.json`) has 15 roles today: the
  original 9 (`page-root`, `dialog-root`, `header-band`, `toolbar-row`, `toolbar-row-right`,
  `grid-surface`, `section-card`, `detail-rail`, `field-row`) plus 6 added for the four new
  archetypes (`card-grid`, `nav-tile`, `metric-tile`, `chart-surface`, `wizard-shell`,
  `wizard-step`). `capture-dialog`'s root container is tagged `dialog-root`, not `page-root`: a
  modal body is not a page — it should not carry the page canvas background or page-level padding
  (the dialog chrome supplies its own frame/padding), so it gets its own role instead of reusing
  `page-root`.
- `record-detail`'s body-split row container itself carries no role (only its two children,
  `mainColumn` and `detailRail`, do) — it is pure flex-row structure, not a styled surface.
- None of the eight manifests declare a `columnChooser`/`datatable.selectColumnsButton` node, by
  design (see above) — do not add one without first making that type authorable in the framework.
- All 6 new roles use `componentType: "container"`, like every role before them: it is the only
  registry type carrying `display`/`flexDirection`/`flexWrap`/`gap`/`justifyContent`/`alignItems`
  as literal prop paths, so it is the only type that can satisfy the catalogue's full layout
  contract. `wizard-shell` styles the container that *wraps* the `wizard` component (background,
  border, `maxWidth: $chrome.formColMax`), not the `wizard` node's own props — the `wizard`
  registry entry has no `display`/`flexDirection`/etc. in its prop list, so a role targeting it
  directly could never satisfy the contract.
- Three new `chrome.*` tokens were added to `shesha.tokens.json` for the new roles:
  `navTileWidth` (220), `metricTileWidth` (200), `chartMinHeight` (280). None collide with
  `requirements-studio.tokens.json`'s `chrome` group (`railWidth`, `headerHeight`,
  `recordBarHeight`) — checked before naming, per the `chrome.railWidth`/`chrome.detailRailWidth`
  precedent. `wizard-shell` reuses the existing `chrome.formColMax` token rather than adding a new
  one; like `detail-rail`'s `chrome.detailRailWidth`, that token is absent from the
  `requirements-studio` brand file, so resolving `wizard-shell` under that brand throws rather than
  silently resolving a wrong value — a pre-existing, documented gap, not a new one.
