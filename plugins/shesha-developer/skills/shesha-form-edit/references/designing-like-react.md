# Designing like React — the design surface

You are good at designing React pages. You are bad at hand-writing Shesha's
form-config JSON (a leaky proprietary DSL). So **design in the React mental
model you already have**, express it as the blueprint layout tree, and let
`compile-spec.mjs` translate each primitive into the Shesha channel the
gym-**measured** capability matrix proves works. You never hand-author Shesha
markup; your flex / spacing / hierarchy instincts translate 1:1.

## The node shape (this is your JSX element)

`nodes[]` is a **flat** array, not a nested tree — parentage is by name, which is
what lets a node be referenced from `assertions[]`. Authoritative schema:
`shesha-design-comprehension/assets/blueprint.schema.json` (`definitions.node`).

| Key | Meaning |
|---|---|
| `node` | the node's own name — the id `slot`, `children` and `assertions` refer to |
| `type` | `"container"`, or a real Shesha component type (`textField`, `text`, `datatable`, `buttonGroup`, `validationErrors`, …) |
| `role` | optional design-system role — the styling shorthand (see below) |
| `slot` | the parent node's name. **A node with no `slot` is a root.** |
| `children` | array of child node **names**, in render order |
| `style` | `{ desktop, tablet, mobile }`, each a real Shesha style block |
| `content` | a text node's copy, or an input's label |
| `items` | a `buttonGroup`'s buttons (`label`, `primary?`, `action`, `target?`) |
| `columns` / `rowTemplate` / `tabs` | datatable columns · datalist card · tab panes |

Field **bindings live in the top-level `bindings[]` array**, not on the node:
`{ label, property, component, datatype }`, matched to a leaf by its `content`.
The object is closed, so a binding carries no styling.

**An option or entity input needs its source on the binding**, or it renders as a
silently empty box (`T2-DROPDOWN-SOURCE` blocks it). Add exactly one of:

| Key | For | Emits |
|---|---|---|
| `referenceList: { module, name }` | `dropdown` · `radio` · `checkboxGroup` on a reflist property | `dataSourceType: "referenceList"` + `referenceListId`. `name` is FULL-DOTTED (`Acme.HR.EmployeeStatus`) |
| `entityType: "<FullClassName>"` | `autocomplete` / entity-FK pickers | `dataSourceType: "entitiesList"` + `entityType` |
| `values: [{ label, value }]` | genuinely form-local option lists | `dataSourceType: "values"`; the compiler mints each `id` |

The compiler will **not** guess a reference list — its identity comes verbatim
from live metadata [R-015], and a guessed one would produce a form that passes
every gate and renders an empty dropdown. Omit the key and it compiles, reports
the gap under `report.unresolved`, and the Tier 2 gate stops the push.

## Roles — the 15-name styling vocabulary

A container's `role` picks a resolved style block from
`shesha-design-system/assets/roles.styles.json`, so you don't hand-write style
for ordinary chrome. The whole vocabulary:

`page-root` · `dialog-root` · `header-band` · `toolbar-row` ·
`toolbar-row-right` · `grid-surface` · `section-card` · `detail-rail` ·
`field-row` · `card-grid` · `nav-tile` · `metric-tile` · `chart-surface` ·
`wizard-shell` · `wizard-step`

Reach for `style` only where the design genuinely deviates from a role.

## Layout — the flexbox you know, written as a style block

There is no `gap`/`padding`/`align` shorthand on a node: layout goes in
`style.desktop` using the real Shesha keys.

```json
{ "node": "body", "type": "container", "slot": "page",
  "style": { "desktop": { "display": "flex", "flexDirection": "row", "gap": 24,
                          "dimensions": { "width": "100%" } } },
  "children": ["mainColumn", "sideColumn"] }
```

- **`display: "flex"` is mandatory** on any flex container, or `flexDirection`
  and `gap` are inert and children stack full-width [R-029].
- **`dimensions.width` on a row's child is the ONLY split lever** [R-028].
  `flex`/`flexBasis` do not reach the outer div. A 2/3 + 1/3 split is
  `width: "66%"` and `width: "33%"` on the two children; a filling main column
  beside a fixed rail is `calc(100% - <rail+gap>px)` and `<rail>px` with matching
  `minWidth`/`maxWidth`.
- **Never leave a row child's width at `auto`** — `auto` resolves flex-basis to
  content size with flex-grow 0, so the child hugs its content and the row never
  splits (`T3-ROW-CHILD-NOFILL`).

## The one rule that differs from web CSS

**Splits are flex children sized by `width`, never a `columns` component**
[R-028]. When you'd reach for a 12-col grid or `<Col span=8>`, use a flex-row
container whose children each carry a `width`. The compiler enforces the rest
(ids, versions, dataContext wrappers, the validationErrors + Submit/exit floor).

## Worked example — a capture screen, designed as JSX then as the blueprint

What you'd sketch in React:

```jsx
<Stack gap={16}>
  <Heading>Register asset</Heading>
  <Row gap={24}>
    <Stack width="66%" gap={16}>
      <Field property="name" /><Field property="serialNumber" />
      <Field property="category" /><Field property="purchaseDate" />
    </Stack>
    <Stack width="33%" gap={16}>
      <Field property="status" /><Field property="location" />
    </Stack>
  </Row>
  <Actions />
</Stack>
```

The same thing as `nodes[]` — flat, parented by `slot`. This exact document
compiles and validates clean (0 Tier 1, 0 Tier 2 against `standalone-capture`):

```json
{
  "screen": "register-asset", "archetype": "standalone-capture", "theme": "shesha",
  "entity": { "fullClassName": "Acme.AssetManagement.Domain.Asset",
              "modelType": { "name": "Asset", "module": "Acme.AssetManagement" } },
  "form": { "module": "Acme.AssetManagement", "name": "asset-create" },
  "nodes": [
    { "node": "page", "type": "container", "role": "page-root",
      "children": ["pageHeader", "validationErrors", "body", "actionRow"] },
    { "node": "pageHeader", "type": "container", "role": "header-band", "slot": "page",
      "children": ["heading"] },
    { "node": "heading", "type": "text", "slot": "pageHeader", "content": "Register asset" },
    { "node": "validationErrors", "type": "validationErrors", "slot": "page" },

    { "node": "body", "type": "container", "slot": "page",
      "style": { "desktop": { "display": "flex", "flexDirection": "row", "gap": 24,
                              "dimensions": { "width": "100%" } } },
      "children": ["mainColumn", "sideColumn"] },

    { "node": "mainColumn", "type": "container", "role": "section-card", "slot": "body",
      "style": { "desktop": { "display": "flex", "flexDirection": "column", "gap": 16,
                              "dimensions": { "width": "66%" } } },
      "children": ["name", "serialNumber", "category", "purchaseDate"] },
    { "node": "name", "type": "textField", "slot": "mainColumn", "content": "Name" },
    { "node": "serialNumber", "type": "textField", "slot": "mainColumn", "content": "Serial number" },
    { "node": "category", "type": "textField", "slot": "mainColumn", "content": "Category" },
    { "node": "purchaseDate", "type": "dateField", "slot": "mainColumn", "content": "Purchase date" },

    { "node": "sideColumn", "type": "container", "role": "section-card", "slot": "body",
      "style": { "desktop": { "display": "flex", "flexDirection": "column", "gap": 16,
                              "dimensions": { "width": "33%" } } },
      "children": ["status", "location"] },
    { "node": "status", "type": "textField", "slot": "sideColumn", "content": "Status" },
    { "node": "location", "type": "textField", "slot": "sideColumn", "content": "Location" },

    { "node": "actionRow", "type": "buttonGroup", "slot": "page", "items": [
      { "label": "Save", "primary": true,
        "action": { "actionName": "Submit", "actionOwner": "shesha.form" } },
      { "label": "Back",
        "action": { "actionName": "Navigate", "actionOwner": "shesha.common" },
        "target": "asset-table" } ] }
  ],
  "bindings": [
    { "label": "Name", "property": "name", "component": "textField", "datatype": "string" },
    { "label": "Serial number", "property": "serialNumber", "component": "textField", "datatype": "string" },
    { "label": "Category", "property": "category", "component": "textField", "datatype": "string" },
    { "label": "Purchase date", "property": "purchaseDate", "component": "dateField", "datatype": "date" },
    { "label": "Status", "property": "status", "component": "textField", "datatype": "string" },
    { "label": "Location", "property": "location", "component": "textField", "datatype": "string" }
  ],
  "assertions": [
    "same-rowband(mainColumn, sideColumn)",
    "parent-of(body, mainColumn)",
    "parent-of(mainColumn, name)"
  ]
}
```

`node scripts/compile-spec.mjs <bp.json> --out form.json` produces gate-clean
markup: the split via `desktop.dimensions.width`, reflist identities resolved from
live metadata, the validationErrors + Submit/Back floor, registry versions stamped
— **and the skin already on it**. The blueprint's own `theme` id selects the brand
whose tokens the compiler bakes into every node as it emits [R-042]; there is no
`--theme` flag and no follow-up paint step. `report.theme` names the brand used.

## Where design judgment still matters (do this, don't delegate it)

The compiler handles the DSL translation; **you** own the design decisions the
way you would for a React page: the archetype, the layout tree, the visual
hierarchy (what's an h1 vs h2 vs body), grouping into cards/sections, the split
ratios, spacing rhythm (pick a consistent gap scale), and which fields belong
where. Consult `shesha-design-system` for brand tokens and `frontend-design`
for visual-composition heuristics. Measure, don't guess placement, when a real
design source exists (that's `shesha-design-comprehension`).
