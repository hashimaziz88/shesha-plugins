# Archetype vocabulary

This file is the **single archetype vocabulary** for this skill. It supersedes:

- the partial archetype list in [blueprint-consumption.md](blueprint-consumption.md) (which mapped
  only 4 of the 8 to seeds);
- the block-level `$kind` tags found in `assets/blocks/*.block.json` (`fragment`, `list`,
  `layout`) — Phase 5 reconciled the vocabularies: those are block *kinds* (what a block
  structurally is), not archetype names, so the field was renamed to `$kind` and no block file
  carries an `$archetype` value anymore. See [block-library.md](block-library.md) for the `$kind`
  taxonomy; this file remains the only place archetype names are defined.

There are exactly **eight** archetypes, and all eight now have a flow manifest under
`assets/archetypes/*.flow.json` — every one loads with `loadFlow` and passes `validateFlow` with
zero problems against the registry and role catalogue.

| Archetype | Flow manifest | Seed / exemplar | When to use |
|---|---|---|---|
| `table-worklist` | `table-worklist.flow.json` | `table-worklist--employee-table.json` | Dense admin grid: dataContext + toolbar (Add action, quick search) + datatable + pager. The default for "a list/table of X". |
| `record-detail` | `record-detail.flow.json` | `assets/exemplars/record-detail-simple.json`, `assets/exemplars/record-detail-with-children.json` | Per-record page reached by navigating from a table row: header band carrying the Start Edit/Submit/Cancel Edit lifecycle, plus a body split into a main column and a related-panels rail. |
| `capture-dialog` | `capture-dialog.flow.json` | `modal-dialog--rs-create-dialog.json`, `assets/examples/rs-link-add-dialog.json` | Modal create/edit hosted by a parent's Add action (subtable toolbar, table Add button). Submits via the dialog footer — the dialog chrome supplies Save/Cancel, so the form body itself does not author a Submit button. |
| `standalone-capture` | `standalone-capture.flow.json` | `capture-standalone--standalone-create.json`, `capture--employee-create.json` | Full-page create/edit opened as its own screen (not a dialog) — "make a form for X" with no parent context. Always needs a Submit **and** a Back exit; a form you can save but not leave is the single most-forgotten defect in this codebase (see [form-quality.md](form-quality.md)). |
| `list-card` | `list-card.flow.json` | `list-card--entity-datalist.json`, `list-card-item--entity-card.json` | A `datalist` of row-template cards rather than a grid — browsing/gallery views. dataContext + toolbar (Add) + `datalist` + pager; the row template (`list-card-item--entity-card.json`-style) is a separately published form, declared as a `rowTemplate` dependency alongside the create and detail dependencies the Add action and row navigation need. |
| `hub` | `hub.flow.json` | — | Landing page of navigation tiles into other screens: page + header band + a wrapping tile grid (`card-grid`) + repeated `nav-tile` nodes, each a container holding a text label and a navigate action. |
| `dashboard` | `dashboard.flow.json` | — | Metric tiles + a chart, no single entity binding: page + header band + a row of `metric-tile` nodes (`card-grid`) + at least one `chart-surface` wrapping an authorable chart type (`barChart`/`lineChart`/`pieChart`/`polarAreaChart`). |
| `wizard` | `wizard.flow.json` | — | Multi-step capture split across steps with its own progression state: the `wizard` component (role `wizard-shell`) holding per-step `wizard-step` containers, plus `validationErrors`. Back/Next/Done navigation is the wizard component's own built-in affordance (`showBackButton`, `showDoneButton`, `backButtonText`, …) — no separate navigation `buttonGroup` is authored. |

Other seeds that don't map to a single archetype above but are useful as fragments:
`assets/golden/inline-card--inline-editable-table.json` (an inline-edit grid variant of
`table-worklist`), `assets/examples/rs-subtable-tab-fragment.json` (a subtable-in-tab fragment, used
inside `record-detail` bodies).

## How the eight shipped manifests were scoped

Each manifest states the **complete required node set** for its flow — the fix for a real failure
mode where a blueprint declared only a heading, a text and a datatable, while its assertions
demanded an Add action, a row action, quick search and a pager. The model had to reverse-engineer
those from prose and dropped them. Load a manifest with `loadFlow(archetype, { dir })` from
`scripts/lib/flow.mjs`, get its flat node list with `requiredNodes(flow)`, and validate it against
the registry and role catalogue with `validateFlow(flow, { registry, roles })` before treating a
build as complete.

- **`table-worklist`** — dataContext, page-root container, header band (heading + subtitle), a
  toolbar row (Add buttonGroup wired to a `createForm` dependency + quick search), the datatable
  itself (with a required navigate-action column wired to a `detailForm` dependency), and a pager
  row. It does **not** require a column-chooser button:
  `datatable.selectColumnsButton` is `authorable: false` in the registry (the framework marks it
  `isHidden`), so a manifest requiring it would make `validateFlow` reject every table-worklist
  build. An earlier draft of this manifest listed a `columnChooser` node using that type — that was
  a spec error, already corrected before this manifest was authored.
- **`record-detail`** — dataContext, page-root container, a header band carrying the Start
  Edit/Submit/Cancel Edit lifecycle `buttonGroup` (all three actions `actionOwner: "shesha.form"`),
  a `validationErrors` node, and a body split into a main column (`section-card`) and a related
  panels rail (`detail-rail`) — both are flex `container`s. **Never** a `columns` component: this
  project's only split mechanism is a flex `container` row with explicit
  `desktop.dimensions.width` on each child (see [blueprint-consumption.md](blueprint-consumption.md)).
- **`capture-dialog`** — a root container, `validationErrors`, and an exit `buttonGroup` carrying
  `Close Dialog` / `shesha.common`. No Submit button is required in the node set: this archetype
  relies on the dialog footer submit supplied by the hosting `Show Dialog` action, matching every
  shipped create-dialog seed (`modal-dialog--rs-create-dialog.json`, `assets/examples/rs-link-add-dialog.json`) — none of them
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
  (`list-card-item--entity-card.json`-style) is its own separately published form, on top of the create-dialog and
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
