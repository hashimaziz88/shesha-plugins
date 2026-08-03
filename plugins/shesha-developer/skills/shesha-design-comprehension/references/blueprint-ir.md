# Layout blueprint IR

The intermediate representation that carries a screen's placement from design to build. One file per screen: `<workdir>/blueprints/<screen>.blueprint.md`.

## Why hybrid Markdown (not pure JSON/YAML)

The blueprint has two audiences. A **human** reviews and approves placement at the planning gate — they read Markdown, not a 24-deep JSON tree. A **builder** (`shesha-form-edit`) consumes it as a requirements brief — archetype + layout spec + bindings is exactly the input it already takes. So the doc is human-readable Markdown **headings/prose**, with the machine-precise parts isolated in **three fenced code blocks per region**:

- ` ```layout-tree ` — the container tree: regions → sections → flex-row splits → split children → fields, with explicit child counts and per-child native widths.
- ` ```bindings ` — a table mapping each label to its entity property, component type and datatype.
- ` ```assertions ` — the placement contract: the statements the verification loop re-measures against.

Pure JSON alone would be unreviewable; pure prose is the thing that drifts. The fenced blocks recover everything the machine needs without making the whole doc machine-only.

## Machine twin (blueprint-json)

Every blueprint `.md` ALSO carries one fenced ` ```blueprint-json ` block — a single JSON document conforming to [`../schemas/blueprint.schema.json`](../schemas/blueprint.schema.json) (screen, entity `{fullClassName, modelType}` [R-016], form identity, archetype, layout node tree, bindings, assertions). **That block is what `shesha-form-edit`'s `compile-blueprint.js` consumes** — its "no spec, no build" rule means a blueprint without a valid blueprint-json block cannot be built. Validate the block against the schema before handing off.

The Markdown blocks (`layout-tree` / `bindings` / `assertions`) remain the human-readable view a reviewer signs off — and they MUST agree with the JSON twin: same regions and nesting, same widths, same bindings, same assertion ids. When they diverge, the JSON twin is what gets built, so fix the divergence, never ship it.

## Document structure

```
# Blueprint — <screen-slug>
Screen identity:  <human name + where it lives>
Entity (modelType, resolve live):  <Entity>   ·   Form identity:  <module> / <form-name>
Archetype:  <one of the 11 — see below>  [+ variant note]
Fidelity tier:  A | B | C        Confidence:  high | medium | low
Viewport captured:  <w>x<h>      Source:  <probe file / source path / screenshot>

## Region N — <name>  (recipe: <design-system recipe>)
```layout-tree …``` 
(prose notes about this region if helpful)

## Bindings
```bindings …```

## Assertions  (placement contract — verified by verification-loop.md)
```assertions …```

## Machine twin
```blueprint-json …```   (conforms to schemas/blueprint.schema.json)
```

## The archetypes (target vocabulary)

The schema enum is the single authority: the blueprint's `Archetype` must be
one of the 11 values in the IR schema's `archetype` enum
(`schemas/blueprint.schema.json`), so the compiler picks the right seed.
<!-- archetype-enum -->
`record-detail` · `hub` · `list-card` · `capture` · `dashboard` ·
`solution-map` · `wizard` · `inline-card` · `table-worklist` ·
`modal-dialog` · `auth-page`.

Each one's clonable seed is catalogued in
`shesha-form-edit/assets/golden/_index.json` (grep it — never read a golden
whole), except `solution-map` and `wizard`, which have no golden reference
form yet — the compiler falls back to hand-composition for those.
`auth-page`'s golden reference form exists (manual-clone only — the compiler
does not wire anonymous auth).

## `layout-tree` grammar

Indentation = nesting (DOM depth). Each line: `<node-name>  <kind> [attributes]`.

- **kind**: `region | container | row | card | tabs | tab | datatable | datalist | field | text | buttonGroup | chip`. A `row` is a flex-row split — a `container` that builds with `display:"flex"` + `flexDirection:"row"` + `gap`; its children are split cells, each its own `container`.
- **`row` attributes**: `row=[a,b,…]` listing each child's native size (`1fr` / `fill` for a filling cell, `<n>px` for a fixed cell, e.g. `row=[1fr, 332px]` or `row=[fill, 332px]`), plus optionally `gap=<px>`, `align=start|center|stretch`. Each child of the row maps to a `container` sized via **`desktop.dimensions.width`**: a `fill`/`1fr` cell → `width:"calc(100% - <fixed+gap>px)"` (e.g. `"calc(100% - 348px)"` for a 332px sibling + 16px gap); a fixed cell → `width:"<n>px"` with matching `minWidth`/`maxWidth`. The row container itself MUST carry `display:"flex"` (or the children stack full-width) + `flexDirection:"row"` + the `gap`.
- **fixed-width cell**: write `row=[fill, 332px]` — keep the native fixed px so the builder sets a fixed rail width (`width:"332px"`, `minWidth`/`maxWidth` `"332px"`) and the diff can reason structurally.
- **field/text/chip**: append `← <Entity>.<property>` for a binding, and `(recipe: <name>)` for the design-system recipe.

## Native-width recording rules

- Measure child widths within their container (probe `multiColumnContainers[].childWidths`) and record them in **native units** (px for fixed cells, `fill`/`1fr` for the filling cell) in `row=[…]`. Do NOT normalise to a 24-unit grid and do NOT use the Shesha `columns` component.
- A **fixed-width** cell (rail, icon column, action column) is recorded as its native px and builds to a `container` with `width:"<n>px"` (+ `minWidth`/`maxWidth`). The filling sibling builds to `width:"calc(100% - <fixed+gap>px)"`.
- A sub-pixel/handle cell (e.g. a 16px drag handle) keeps its small fixed px (`16px`) — never collapse it to 0; the builder needs a real fixed cell.

## Worked example — `view-detail` (measured, Tier A/B, 1440×900)

Grounded in the live probe of the design's *Facility Referral Form* view-detail screen: body split measured `widths=[962,332]` → `row=[fill, 332px]` (left fills `calc(100% - 348px)`, rail fixed at **332px**, gap 24); KIB measured 6 equal cells; header content split `[fill, 332px]`-style; requirement rows `[handle 16px / content fill]`.

````markdown
# Blueprint — view-detail
Screen identity:  View Detail — the per-View record page (Views list → row → detail)
Entity (modelType, resolve live):  Employee    ·    Form identity:  MyApp.Hr / employee-details
Archetype:  record-detail — Variant B (wide capture/attributes left + count-badged related-panel rail right)
Fidelity tier:  B (runnable design, probed)    Confidence:  high
Viewport captured:  1440x900    Source:  blueprints/_probe/view-detail-design.layout.json

## Region 1 — Header band  (recipe: page-title-band)
```layout-tree
region: header-band            container col
  ├─ breadcrumb                text  "Project / Module / Views / {name}"        (recipe: breadcrumb)
  ├─ title-row                 row  row=[fill, auto] gap=16 align=center   (flex: display:flex+flexDirection:row)
  │   ├─ title-block (cell 1)  container col   width:"calc(100% - <actions+gap>px)" (fill)
  │   │   ├─ title             text  ← ViewDefinition.name                       (recipe: page-title)
  │   │   ├─ status-chip       chip  ← ViewDefinition.status                     (recipe: status-chip)
  │   │   └─ subtitle          text  ← ViewDefinition.description                (recipe: subtitle)
  │   └─ actions (cell 2)      buttonGroup  [Mockup | Trace]   (fixed/auto-width cell, right-aligned)  (recipe: ghost-link-actions)
```

## Region 2 — Key Info Bar (KIB)  (recipe: kib-strip)
```layout-tree
region: kib                    row  row=[1fr,1fr,1fr,1fr,1fr,1fr]  native=6-equal  gap=<g> align=stretch   (flex: display:flex+flexDirection:row; each cell width≈"calc((100% - 5*<g>px)/6)" or flex-basis equivalent)
  ├─ Module                    field  micro-label + value ← ViewDefinition.module
  ├─ Release                   field  ← ViewDefinition.release
  ├─ View Type                 field  ← ViewDefinition.viewType
  ├─ Central Entity            field  ← ViewDefinition.centralEntity
  ├─ Mockup                    field  ← ViewDefinition.mockupStatus
  └─ Completeness              field  progress + % ← ViewDefinition.completeness
```

## Region 3 — Body  (the split that drifts — measured 962/332)
```layout-tree
region: body                   row  row=[fill, 332px] native=[1fr,332px] gap=24 align=start   (flex: display:flex+flexDirection:row+gap:24)
  ├─ LEFT (fill) ─ capture   container col   width:"calc(100% - 356px)"   (332px rail + 24px gap)
  │   └─ requirements-card     card  (header: "View Requirements" + count-badge ← count; filter; Cards/Notepad toggle)
  │       └─ req-list          datalist  ← ViewDefinition.requirements         (capture rows)
  │            row: [handle 16px | seq | category-chip | status-chip | description | refs(UC,endpoint) | delete]
  └─ RIGHT (fixed 332px) ─ rail   container col   width:"332px" minWidth/maxWidth:"332px", gap=16
      ├─ details-card          card "Details"  → rows (label-left / control-right)
      │     fields ← status, viewType, sequence, module, release, centralEntity, mockupStatus
      ├─ panel: Realises Use Cases   card + count-badge + "+"  → datalist ← ViewDefinition.realisesUseCases
      └─ panel: Required End-points  card + count-badge + "+"  → datalist ← ViewDefinition.requiredEndpoints
```

## Bindings
```bindings
label              | entity property        | component              | datatype
View name          | name                   | text (name-mode)       | string
Status             | status                 | refListStatus / chip   | refList
View type          | viewType               | dropdown               | refList
Sequence           | sequence               | numberField            | int
Module             | module                 | entityAutocomplete     | FK → ModuleDefinition
Release            | release                | entityAutocomplete     | FK → ReleaseDefinition
Central Entity     | centralEntity          | entityAutocomplete     | FK → EntityDefinition
Mockup             | mockupStatus           | dropdown               | refList
Requirements       | requirements           | datalist (capture)     | child → ViewRequirement
Realises UseCases  | realisesUseCases       | datalist panel         | M:M → UseCase  (count badge)
Required End-points| requiredEndpoints      | datalist panel         | M:M → ApiDefinition
```

> **Component-column rules the builder must honor (not just placement):** a `datalist panel` / `datalist (capture)` builds a **`datalist` row-template** — NEVER a `datatable` (a related collection drawn as a grid is a defect even though the data is collection-shaped). A rail attribute control (`dropdown` / `entityAutocomplete` rows in a read-only Details summary) is **read-only display** — author it `editMode: "readOnly"`, not `inherited` (which renders blank in the view state). A `refListStatus` is a status **chip**, not a dropdown. Row-template datalists need a fetch **projection** for their nested bindings — see `shesha-form-edit/references/components/data-tables.md` ("cards render empty" trap).

## Assertions  (placement contract — verified by verification-loop.md)
```assertions
A1  body is a 2-column split; left:right width ratio ≈ 18:6 (left ≥ 2.5× right); right rail ≈ 332px fixed
A2  the related panels (Realises Use Cases, Required End-points) are BOTH in the RIGHT column (same x-cluster as the Details card), stacked vertically
A3  the requirements list/capture card is in the LEFT column (not the rail)
A4  the "Details" card rows are 2-cell (label + control side by side), not full-width stacked
A5  nesting: the related panels are children of the rail column, not of the page root
A6  the KIB is a single flex row of 6 equal cells directly under the header band
A7  header actions (Mockup, Trace) sit in the header band, right-aligned on the title row
```
````

This one document is simultaneously: the thing a reviewer signs off (prose + tree), the compiler input the builder consumes (the `blueprint-json` twin — archetype → golden fixture, splits → flex-row `container`s with per-child `desktop.dimensions.width` [R-028], bindings → component+propertyName), and the contract the verification loop measures (`assertions` A1–A7).

## Authoring checklist

- [ ] `Archetype` is one of the 11 values in the schema enum, with a variant note if needed.
- [ ] Every `row` line records native cell widths (`row=[…]`, `fill`/`1fr` + fixed px) and a `gap`; no Shesha `columns` component, no `/24` normalisation. Each cell maps to a `container` sized via `desktop.dimensions.width` (fill → `calc(100% - <fixed+gap>px)`, fixed → `<n>px`); the row carries `display:"flex"`.
- [ ] Every bound field has `← Entity.property`; every region names its design-system `recipe`.
- [ ] `assertions` cover: split-cell membership, row grouping, nesting depth, tab assignment — the things that drift. No pixel asserts.
- [ ] Fidelity tier + confidence + viewport stamped at the top.
- [ ] A ` ```blueprint-json ` block is present, validates against `schemas/blueprint.schema.json`, and agrees with the Markdown blocks (regions, widths, bindings, assertion ids).
