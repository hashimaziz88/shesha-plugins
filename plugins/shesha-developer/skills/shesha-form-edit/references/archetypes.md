# Archetype vocabulary

This file is the **single archetype vocabulary** for this skill. It supersedes:

- the partial archetype list in [blueprint-consumption.md](blueprint-consumption.md) (which mapped
  only 4 of the 8 to seeds);
- the `$archetype` values found in `assets/blocks/*.block.json` (`fragment`, `list`,
  `record-detail`, …) — some of those are block-level tags, not this table's archetype names, and
  do not yet match this vocabulary 1:1. Phase 5 reconciles the block tags against this list; until
  then, this file wins on any conflict.

There are exactly **eight** archetypes. **Four have a flow manifest today; four are deferred to
Phase 5.** Do not read the presence of only four `assets/archetypes/*.flow.json` files as the list
being complete — the table below is the complete list, the manifest column just says which ones
are machine-checkable right now.

| Archetype | Flow manifest | Seed / exemplar | When to use |
|---|---|---|---|
| `table-worklist` | `table-worklist.flow.json` | `employee-table.json`, `rs-table.json` | Dense admin grid: dataContext + toolbar (Add action, quick search) + datatable + pager. The default for "a list/table of X". |
| `record-detail` | `record-detail.flow.json` | `rs-detail-with-header.json`, `employee-detail-with-child-tables.json`, `employee-detail-without-child-tables.json` | Per-record page reached by navigating from a table row: header band carrying the Start Edit/Submit/Cancel Edit lifecycle, plus a body split into a main column and a related-panels rail. |
| `capture-dialog` | `capture-dialog.flow.json` | `rs-create-dialog.json`, `rs-link-add-dialog.json` | Modal create/edit hosted by a parent's Add action (subtable toolbar, table Add button). Submits via the dialog footer — the dialog chrome supplies Save/Cancel, so the form body itself does not author a Submit button. |
| `standalone-capture` | `standalone-capture.flow.json` | `standalone-create.json`, `employee-create.json` | Full-page create/edit opened as its own screen (not a dialog) — "make a form for X" with no parent context. Always needs a Submit **and** a Back exit; a form you can save but not leave is the single most-forgotten defect in this codebase (see [form-quality.md](form-quality.md)). |
| `list-card` | Phase 5 | `entity-datalist.json`, `entity-card.json` | A `datalist` of row-template cards rather than a grid — browsing/gallery views. |
| `hub` | Phase 5 | — | Landing page of navigation tiles into other screens. |
| `dashboard` | Phase 5 | — | Metric tiles + charts, no single entity binding. |
| `wizard` | Phase 5 | — | Multi-step capture split across steps/tabs with its own progression state. |

Other exemplars available in `assets/examples/` that don't map to a single archetype above but are
useful as fragments: `inline-editable-table.json` (an inline-edit grid variant of `table-worklist`),
`rs-subtable-tab-fragment.json` (a subtable-in-tab fragment, used inside `record-detail` bodies).

## How the four shipped manifests were scoped

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
  shipped create-dialog seed (`rs-create-dialog.json`, `rs-link-add-dialog.json`) — none of them
  author an in-body Submit button.
- **`standalone-capture`** — page-root container, header band, `validationErrors`, and an action row
  `buttonGroup` carrying **both** `Submit`/`shesha.form` and `Navigate`/`shesha.common`. This pairing
  is non-negotiable: `form-quality.md` documents the Back/exit button as the single most-forgotten
  case, because a terse prompt ("a form with one required field") names no buttons at all and it is
  easy to emit only the Submit and stop.

## Judgement calls

- The role catalogue (`shesha-design-system/assets/roles.styles.json`) has 8 roles today
  (`page-root`, `header-band`, `toolbar-row`, `toolbar-row-right`, `grid-surface`, `section-card`,
  `detail-rail`, `field-row`). `capture-dialog`'s root container is tagged `page-root` even though
  it is dialog-hosted, not a full page — there is no dialog-specific role yet, and `page-root` is
  the closest existing "top-level content container" role. If a dialog-specific role is added later,
  repoint `dialogRoot` at it.
- `record-detail`'s body-split row container itself carries no role (only its two children,
  `mainColumn` and `detailRail`, do) — it is pure flex-row structure, not a styled surface.
- None of the four manifests declare a `columnChooser`/`datatable.selectColumnsButton` node, by
  design (see above) — do not add one without first making that type authorable in the framework.
