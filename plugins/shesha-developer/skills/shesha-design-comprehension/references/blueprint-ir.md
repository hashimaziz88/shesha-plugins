# Layout blueprint IR

The intermediate representation that carries a screen's placement from design to build. One file
per screen: `<workdir>/blueprints/<screen>.blueprint.json`, conforming to
`assets/blueprint.schema.json`. This supersedes the retired `<screen>.blueprint.md` prose format
with its `layout-tree` grammar — `SKILL.md` and `capture-pipeline.md` now describe this JSON +
rendered-mock format too; this file remains the source of truth for the IR's shape. Eight worked
examples (one per archetype) live in [blueprint-examples.md](blueprint-examples.md).

## Why a JSON blueprint, not hand-authored Markdown

The blueprint has two audiences. A **human** reviews and approves placement at the planning gate.
A **builder** (`shesha-form-edit`) consumes it as a requirements brief — archetype + layout spec +
bindings is exactly the input it already takes. Earlier drafts of this IR tried to serve both from
one hand-authored Markdown document with a prose `layout-tree` grammar (arrows, `row=[…]`
annotations, recipe notes). That grammar was itself a wireframe — authored by a human transcribing
what they intended — and could drift from the JSON actually handed to the builder, which is exactly
the failure mode this whole layer exists to prevent.

The blueprint is now **one JSON object** (`assets/blueprint.schema.json`) carrying `nodes[]` with
resolved `role` and resolved `style.desktop/tablet/mobile` (literal values — a fully-expanded
`page-root` node looks like the resolved form of `shesha-design-system/assets/roles.styles.json`'s
`page-root` entry, not a token reference). Three representations are then **generated from that one
object**, so none of them can disagree with what the compiler consumes:

1. **The ASCII mock** — `renderMock(blueprint)` in `scripts/lib/render-mock.mjs`. Depth-first,
   one box per container, indentation by depth, a resolved-style summary line per container, a
   header row for `datatable` columns, and a `(added by flow)` marker on any node the flow manifest
   contributed. This is what a human reads at the planning gate.
2. **The machine blocks** — `bindings[]` (label → entity property → component → datatype),
   `assertions[]` (the placement contract the verification loop re-measures against — see
   `verification-loop.md`), and the resolved `style` carried directly on each node in `nodes[]`.
   These are not transcribed from the mock; the mock is rendered from them.
3. **The flow-manifest expansion** — which nodes in `nodes[]` came from the design/prompt and which
   were injected by the archetype's `*.flow.json` (Task 9: `loadFlow` / `requiredNodes` /
   `validateFlow` in `shesha-form-edit/scripts/lib/flow.mjs`). A node the manifest added carries
   `addedBy: "flow-manifest"`; the renderer surfaces it as `(added by flow)` so a reviewer can see
   which placement decisions came from the archetype contract rather than being re-imagined by the
   model. See `shesha-form-edit/references/archetypes.md` for the eight-archetype vocabulary — all
   eight now ship a flow manifest (`assets/archetypes/*.flow.json`).

Pure prose was the thing that drifted. A blueprint that IS the compiler's input, rendered rather
than transcribed, cannot.

## Document structure

A blueprint JSON file has the shape (`assets/blueprint.schema.json`):

```
{
  "screen": "<human name>",
  "archetype": "<one of the eight — see shesha-form-edit/references/archetypes.md>",
  "theme": "<design-system theme id>",
  "viewport": "<w>x<h>",
  "entity": { "fullClassName": "...", "modelType": { "name": "...", "module": "..." } },
  "form": { "module": "...", "name": "...", "label": "..." },
  "nodes": [ { "node": "...", "type": "...", "role": "...", "slot": "...", "style": {...}, ... } ],
  "bindings": [ { "label": "...", "property": "...", "component": "...", "datatype": "..." } ],
  "assertions": [ "..." ],
  "dependencies": [ { "id": "...", "archetype": "...", "naming": "..." } ]
}
```

`nodes[]` carries the full container/leaf tree: `role` for anything drawing from the fifteen-role
catalogue in `shesha-design-system/assets/roles.styles.json` (`page-root`, `dialog-root`,
`header-band`, `toolbar-row`, `toolbar-row-right`, `grid-surface`, `section-card`, `detail-rail`,
`field-row`, plus the six added for the four newer archetypes: `card-grid`, `nav-tile`,
`metric-tile`, `chart-surface`, `wizard-shell`, `wizard-step`); `slot` naming the parent a node
renders inside (nodes with no `slot` are roots — **every** non-root node needs a `slot`, even one
only reachable through a `tabs[].children` list or a `datalist`/`wizard`'s own special rendering,
or `renderMock()` mistakes it for an extra root); `style.desktop/tablet/mobile` as **resolved**
literal values, never token references; `overrides[]` for any per-node deviation from its role's
default style, where each override is `{ prop, value, source, evidence }` — `source` and `evidence`
are required by the schema precisely because an override with no measurement provenance is what
this whole design discipline forbids.

**Shape fields for the newer archetypes** (all in `assets/blueprint.schema.json`'s `node`
definition):

- **`items`** (buttonGroup) — the group's ordered items, each `{ label, primary?, action: {
  actionName, actionOwner }, target? }`. `renderMock()` renders every item inline with the action it
  fires, e.g. `[Save]◄primary → Submit/shesha.form`, or `[Navigate] → Navigate/shesha.common →
  bookings-table` when a `target` is set (a hub tile's navigate destination). Wiring invisible in
  the mock is wiring a reviewer can't check.
- **`rowTemplate`** (datalist) — the form name the datalist delegates each row to, e.g.
  `"listing-card"`. `renderMock()` draws a datalist as a repeating card row (`╭ card ╮ ╭ card ╮ ⋯`),
  visibly different from a datatable's `│ col | col │` header — a collection drawn as a grid when
  the design shows cards is a documented defect class (`shesha-form-edit/references/archetypes.md`'s
  `list-card` entry).
- **`tabs`** (a `tabs`-type node) — ordered tab groups, each `{ key, title?, children: [nodeName,
  ...] }`. `renderMock()` renders each tab's key/title and its member nodes explicitly (`▤ tab:
  general ("General")` followed by that tab's nodes, indented) rather than a flat list, because tab
  assignment is one of the things that drifts most.
- **`valueBinding`** (a metric-tile's value text node) — `{ property, aggregate? }` binding the
  displayed value to an entity property (optionally aggregated, e.g. `"count"`/`"sum"`).
  `renderMock()` surfaces it as `⟨bind: count bookingCount⟩`.
- A **`wizard`**-type node's `children[]` are its ordered `wizard-step` containers; `renderMock()`
  numbers them `Step 1: <node>`, `Step 2: <node>`, … so a reviewer can see which nodes belong to
  which step without a separate legend.
- A leaf node typed `barChart`/`lineChart`/`pieChart`/`polarAreaChart` (a chart-surface's child) has
  its chart type named directly in the mock, e.g. `chart ⟨chart: barChart⟩`.

## Rail / split-cell width derivation

The only split mechanism in this project is a flex `container` row with explicit
`desktop.dimensions.width` on each child — never the Shesha `columns` component (see
`shesha-form-edit/references/archetypes.md` and `blueprint-consumption.md`). For a two-cell row
`row=[fill, <railPx>px]` with row `gap=<gapPx>`, the filling cell's width is **derived**, not
independently measured:

```
fill cell width = calc(100% - <railPx + gapPx>px)
```

**Worked example** — a 332px rail with a 24px row gap: `332 + 24 = 356`, so the filling cell is
`width: "calc(100% - 356px)"`, and the rail cell is `width: "332px"` with matching
`minWidth`/`maxWidth`. This is the only numbers this document uses for this shape — an earlier
draft stated `calc(100% - 348px)` for this same 332px-rail/24px-gap case elsewhere in this file,
which was wrong (348 = 332 + 16, a 16px-gap figure that does not belong to this example); always
derive the constant from the actual rail width and gap in front of you rather than copying a
literal from a different measurement.

`multiColumnContainers[]` entries carry `columnCount`, `columnEdges`, `childIds` **and
`childWidths`** — each split child's own measured width (`rect.w`, native px), index-aligned with
`childIds` (`scripts/layout-probe.js`'s `PROBE_FN`, clustering logic in `scripts/lib/cluster.mjs`).
Read a split cell's native width directly off `childWidths[i]` (or, equivalently, off that child's
own `rect.w` in the flat `nodes[]` array — the two always agree). Widths are never normalised to a
24-unit grid — the project's only split mechanism is a flex `container` row with explicit
`desktop.dimensions.width` per child, never the Shesha `columns` component (see above). `columnCount`
is derived from **horizontal overlap within a shared row band**, not from left-edge distinctness
alone — a vertically-stacked pair of children at different left indents (Shesha's outer/inner div
nesting systematically indents) shares no row band and so counts as one column, not two.

## Worked example — `table-worklist` (Bookings Register), all three representations

This is the actual output of `renderMock()` run against the fixture below — not hand-drawn. If the
renderer's contract ever changes, regenerate this block; do not hand-edit it.

### 1. The blueprint (abridged `nodes[]`, resolved style, `addedBy` from the flow manifest)

```json
{
  "screen": "Bookings Register",
  "archetype": "table-worklist",
  "theme": "requirements-studio",
  "viewport": "1440x900",
  "entity": {
    "fullClassName": "Boxfusion.Travel.Domain.Booking",
    "modelType": { "name": "Booking", "module": "Boxfusion.Travel" }
  },
  "form": { "module": "travel", "name": "bookings-table", "label": "Bookings" },
  "nodes": [
    { "node": "dataContext", "type": "dataContext" },
    { "node": "page", "type": "container", "role": "page-root",
      "style": { "desktop": { "display": "flex", "flexDirection": "column", "gap": 24,
        "justifyContent": "flex-start", "alignItems": "stretch",
        "dimensions": { "width": "100%", "minHeight": "fit-content" },
        "stylingBox": { "padding": 24 } } },
      "children": ["pageHeader", "toolbar", "table", "pagerRow"] },
    { "node": "pageHeader", "type": "container", "role": "header-band", "slot": "page",
      "style": { "desktop": { "display": "flex", "flexDirection": "column", "gap": 4,
        "justifyContent": "flex-start", "alignItems": "flex-start",
        "dimensions": { "width": "100%" } } },
      "children": ["heading", "subtitle"] },
    { "node": "heading", "type": "text", "slot": "pageHeader", "content": "Bookings" },
    { "node": "subtitle", "type": "text", "slot": "pageHeader",
      "content": "All passenger bookings across active routes" },
    { "node": "toolbar", "type": "container", "role": "toolbar-row", "slot": "page",
      "style": { "desktop": { "display": "flex", "flexDirection": "row", "gap": 12,
        "justifyContent": "space-between", "alignItems": "center",
        "dimensions": { "width": "100%" } } },
      "children": ["addButtonGroup", "quickSearch"] },
    { "node": "addButtonGroup", "type": "buttonGroup", "slot": "toolbar",
      "content": "[Add Booking]", "addedBy": "flow-manifest" },
    { "node": "quickSearch", "type": "datatable.quickSearch", "slot": "toolbar",
      "addedBy": "flow-manifest" },
    { "node": "table", "type": "datatable", "role": "grid-surface", "slot": "page",
      "columns": ["bookingReference", "passengerLastName", "status", "travelDate"] },
    { "node": "pagerRow", "type": "container", "role": "toolbar-row-right", "slot": "page",
      "style": { "desktop": { "display": "flex", "flexDirection": "row", "gap": 8,
        "justifyContent": "flex-end", "alignItems": "center",
        "dimensions": { "width": "100%" } } },
      "children": ["pager"], "addedBy": "flow-manifest" },
    { "node": "pager", "type": "datatable.pager", "slot": "pagerRow",
      "addedBy": "flow-manifest" }
  ],
  "bindings": [
    { "label": "Booking Reference", "property": "bookingReference", "component": "text (column)", "datatype": "string" },
    { "label": "Passenger Last Name", "property": "passengerLastName", "component": "text (column)", "datatype": "string" },
    { "label": "Status", "property": "status", "component": "refListStatus / chip (column)", "datatype": "refList" },
    { "label": "Travel Date", "property": "travelDate", "component": "date (column)", "datatype": "datetime" }
  ],
  "assertions": [
    "A1  toolbar is a single flex row directly under the header band; Add Booking left, quick search right (justify:space-between)",
    "A2  the pager row sits directly below the datatable, right-aligned (role: toolbar-row-right, justify:flex-end)",
    "A3  quickSearch, the pager row and its pager are present even though the source design did not depict them — required by the table-worklist flow manifest, not optional polish"
  ],
  "dependencies": []
}
```

### 2. The rendered ASCII mock

```
Bookings Register (table-worklist)
viewport 1440x900

dataContext

┌─ page ─── role: page-root
  flex column · gap 24 · justify:flex-start · align:stretch · w:100% minH:fit-content · pad 24
  ┌─ pageHeader ─── role: header-band
    flex column · gap 4 · justify:flex-start · align:flex-start · w:100%
    heading "Bookings"
    subtitle "All passenger bookings across active routes"
  └─
  ┌─ toolbar ─── role: toolbar-row
    flex row · gap 12 · justify:space-between · align:center · w:100%
    addButtonGroup "[Add Booking]"  (added by flow)
    quickSearch  (added by flow)
  └─
  ┌─ table ─── role: grid-surface
    │ bookingReference | passengerLastName | status | travelDate │
  └─
  ┌─ pagerRow ─── role: toolbar-row-right  (added by flow)
    flex row · gap 8 · justify:flex-end · align:center · w:100%
    pager  (added by flow)
  └─
└─
```

### 3. The flow-manifest expansion

Reading the mock's `(added by flow)` markers against `table-worklist.flow.json`'s `requires[]`:

| Node | In the design/prompt? | Added by flow manifest? | Why it would otherwise be dropped |
|---|---|---|---|
| `page`, `pageHeader`, `heading`, `subtitle`, `toolbar` | yes | no | Directly visible in the design/prompt. |
| `table` (datatable, `grid-surface`) | yes | no | The screen's whole point; never omitted. |
| `addButtonGroup` | no | **yes** | An admin grid needs a create action; a prose brief describing "a table of bookings" routinely omits it. |
| `quickSearch` | no | **yes** | Same failure mode `references/archetypes.md` documents: dropped when reverse-engineered from prose. |
| `pagerRow` / `pager` | no | **yes** | Easy to omit when the design mock shows one page of rows and no visible pager control. |

This is the concrete version of the abstract claim in `references/archetypes.md`: "a blueprint
declared only a heading, a text and a datatable, while its assertions demanded an Add action, a row
action, quick search and a pager." Here those four nodes are visible in the mock, tagged, and
justified against the manifest rather than silently present or silently missing.

## Authoring checklist

- [ ] `archetype` is one of the eight in `shesha-form-edit/references/archetypes.md`, with a variant
      note if needed.
- [ ] Every node with `slot` resolves to a real parent `node` name; every root (`slot` absent) is
      intentional — `renderMock` throws `renderMock: no nodes` on an empty tree rather than silently
      emitting nothing.
- [ ] Every `container`-role node carries resolved `style.desktop/tablet/mobile` (literal values, no
      token references) with all six `dimensions.*` set per `roles.styles.json`'s Task 8 contract.
- [ ] Every `overrides[]` entry carries `source` and `evidence` — no override without measurement
      provenance.
- [ ] Every split cell's fill width is the derived `calc(100% - <railPx + gapPx>px)`, computed from
      the rail width and gap actually in front of you (see "Rail / split-cell width derivation"
      above) — never a copied literal from a different measurement.
- [ ] Run the archetype's flow manifest against the blueprint (`validateFlow`, Task 9) before
      treating it as complete; every node it adds should be visible in the rendered mock tagged
      `(added by flow)`.
- [ ] Every bound field has an entry in `bindings[]`; `assertions[]` covers split-cell membership,
      row grouping, nesting depth and tab assignment — the things that drift. No pixel asserts.
- [ ] A `buttonGroup` node's `items[]` each carry an `action` — wiring invisible in the mock is wiring
      a reviewer cannot check; mark the item that's `primary`.
- [ ] A `datalist` node carries `rowTemplate`; a `tabs` node carries `tabs[]` (not just a flat
      `children[]`) so tab assignment renders explicitly.
- [ ] Regenerate the rendered mock from `renderMock()` before pasting it anywhere — never hand-draw
      one; a hand-drawn mock is the exact failure mode this IR replaces.
- [ ] Validate the blueprint against `assets/blueprint.schema.json` (see
      `scripts/lib/validate-blueprint.mjs`, exercised in `tests/blueprint-schema.test.mjs`) before
      treating it as complete.
