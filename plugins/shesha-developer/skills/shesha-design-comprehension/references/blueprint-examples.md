# Blueprint worked examples — one per archetype

Eight small fixtures, one per archetype in `shesha-form-edit/references/archetypes.md`, live under
`assets/blueprint-examples/<archetype>.blueprint.json`. Each is exercised by
`tests/blueprint-schema.test.mjs` — validated against `assets/blueprint.schema.json` and rendered
without throwing — so these fixtures cannot silently rot out of sync with either the schema or the
renderer.

**Every rendered mock below is the literal, unedited output of `renderMock()` run against its
fixture** (see `scripts/lib/render-mock.mjs`) — none of this is hand-drawn. If the renderer's
contract ever changes, regenerate this file; do not hand-edit the mock blocks.

## `table-worklist` — Bookings Register

`assets/blueprint-examples/table-worklist.blueprint.json`

```
Bookings Register (table-worklist)
viewport 1440x900

dataContext

┌─ page ─── role: page-root
  flex column · gap 24 · w:100% minH:fit-content · pad 24
  ┌─ pageHeader ─── role: header-band
    flex column · gap 4 · w:100%
    heading "Bookings"
  └─
  ┌─ toolbar ─── role: toolbar-row
    flex row · gap 12 · justify:space-between · w:100%
    addButtonGroup ─── buttonGroup: [Add Booking] → Show Dialog/shesha.common  (added by flow)
    quickSearch  (added by flow)
  └─
  ┌─ table ─── role: grid-surface
    │ bookingReference | passengerLastName | status | travelDate │
  └─
  ┌─ pagerRow ─── role: toolbar-row-right  (added by flow)
    flex row · gap 8 · justify:flex-end · w:100%
    pager  (added by flow)
  └─
└─
```

## `record-detail` — Booking Detail

`assets/blueprint-examples/record-detail.blueprint.json`. Shows the lifecycle `buttonGroup` (Start
Edit / Submit marked primary / Cancel Edit), the main-column/detail-rail split, and a `tabs` node
with two tabs — the shape most prone to drift, now rendered explicitly.

```
Booking Detail (record-detail)
viewport 1440x900

dataContext

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "Booking BK-1042"
    lifecycleButtonGroup ─── buttonGroup: [Start Edit] → Start Edit/shesha.form  [Submit]◄primary → Submit/shesha.form  [Cancel Edit] → Cancel Edit/shesha.form
  └─
  validationErrors
  ┌─ body
    flex row · gap 24 · w:100%
    ┌─ mainColumn ─── role: section-card
      flex column · gap 16 · w:calc(100% - 356px)
      ┌─ detailTabs
        ▤ tab: general ("General")
          passengerName "Passenger Last Name"
          travelDate "Travel Date"
        ▤ tab: documents ("Documents")
          attachments "Attachments"
      └─
    └─
    ┌─ detailRail ─── role: detail-rail
      w:332px
      relatedInvoices "Related Invoices"
    └─
  └─
└─
```

## `capture-dialog` — Add Booking

`assets/blueprint-examples/capture-dialog.blueprint.json`. Notice there is no Submit button in the
node set — the `exitButtonGroup` only carries `Close Dialog`, because the dialog footer supplies
the actual submit.

```
Add Booking (capture-dialog)
viewport 1440x900

┌─ dialogRoot ─── role: dialog-root
  validationErrors
  passengerName "Passenger Last Name"
  travelDate "Travel Date"
  exitButtonGroup ─── buttonGroup: [Close Dialog] → Close Dialog/shesha.common
└─
```

## `standalone-capture` — New Employee

`assets/blueprint-examples/standalone-capture.blueprint.json`. The `actionRow` carries both
`Submit` (primary) and a `Back` exit wired to `Navigate/shesha.common → employee-table` — the
Submit-without-an-exit defect this archetype exists to prevent is visible by its absence.

```
New Employee (standalone-capture)
viewport 1440x900

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "New Employee"
  └─
  validationErrors
  firstName "First Name"
  lastName "Last Name"
  actionRow ─── buttonGroup: [Submit]◄primary → Submit/shesha.form  [Back] → Navigate/shesha.common → employee-table
└─
```

## `list-card` — Property Gallery

`assets/blueprint-examples/list-card.blueprint.json`. The `list` node renders as a repeating card
row (`╭ card ╮ ╭ card ╮ ╭ card ╮`) naming its `row-template`, deliberately unlike a datatable's
`│ col | col │` header — drawing a card collection as a grid is the documented defect this shape
exists to catch.

```
Property Gallery (list-card)
viewport 1440x900

dataContext

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "Properties"
  └─
  ┌─ toolbar ─── role: toolbar-row
    addButtonGroup ─── buttonGroup: [Add Listing] → Show Dialog/shesha.common
  └─
  ┌─ list ─── role: grid-surface
    ╭ card ╮ ╭ card ╮ ╭ card ╮  ⋯ (repeating card row)
    row-template → listing-card
  └─
  ┌─ pagerRow ─── role: toolbar-row-right
    pager
  └─
└─
```

## `hub` — Operations Hub

`assets/blueprint-examples/hub.blueprint.json`. `tileGrid`'s summary line shows `wrap`, and each
tile's `buttonGroup` item carries a `target` — the tile's actual navigate destination — right next
to its label.

```
Operations Hub (hub)
viewport 1440x900

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "Operations"
  └─
  ┌─ tileGrid ─── role: card-grid
    flex row · wrap · gap 16
    ┌─ tile1 ─── role: nav-tile
      tile1Label "Bookings"
      tile1Action ─── buttonGroup: [Navigate] → Navigate/shesha.common → bookings-table
    └─
    ┌─ tile2 ─── role: nav-tile
      tile2Label "Invoices"
      tile2Action ─── buttonGroup: [Navigate] → Navigate/shesha.common → invoices-table
    └─
    ┌─ tile3 ─── role: nav-tile
      tile3Label "Properties"
      tile3Action ─── buttonGroup: [Navigate] → Navigate/shesha.common → listings-gallery
    └─
  └─
└─
```

## `dashboard` — Bookings Dashboard

`assets/blueprint-examples/dashboard.blueprint.json`. Each metric tile shows its label/value pair,
with the value's `valueBinding` (aggregate + property) named directly; the chart surface names its
chart type (`barChart`) rather than leaving it implicit.

```
Bookings Dashboard (dashboard)
viewport 1440x900

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "Bookings Dashboard"
  └─
  ┌─ metricRow ─── role: card-grid
    flex row · wrap · gap 16
    ┌─ metric1 ─── role: metric-tile
      metric1Label "Total Bookings"
      metric1Value "1,284" ⟨bind: count bookingCount⟩
    └─
    ┌─ metric2 ─── role: metric-tile
      metric2Label "Revenue (MTD)"
      metric2Value "R 842,110" ⟨bind: sum revenue⟩
    └─
  └─
  ┌─ chartSurface ─── role: chart-surface
    chart "Bookings by Route" ⟨chart: barChart⟩
  └─
└─
```

## `wizard` — Grant Application Wizard

`assets/blueprint-examples/wizard.blueprint.json`. Steps render as an ordered, numbered sequence
(`Step 1: step1`, `Step 2: step2`, `Step 3: step3`) with each step's own fields nested underneath —
so which node belongs to which step is unambiguous. No separate navigation `buttonGroup` — the
wizard's own Back/Next/Done affordances handle it.

```
Grant Application Wizard (wizard)
viewport 1440x900

┌─ page ─── role: page-root
  ┌─ pageHeader ─── role: header-band
    heading "Grant Application"
  └─
  validationErrors
  ┌─ wizard ─── role: wizard-shell
    ┌─ Step 1: step1 ─── role: wizard-step
      applicantName "Applicant Name"
    └─
    ┌─ Step 2: step2 ─── role: wizard-step
      fundingAmount "Funding Requested"
    └─
    ┌─ Step 3: step3 ─── role: wizard-step
      supportingDocs "Supporting Documents"
    └─
  └─
└─
```
