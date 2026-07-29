# Consuming a layout blueprint (from shesha-design-comprehension)

When this skill is invoked by `shesha-claude-designer` (or directly with a design to match), the requirements arrive as a **layout blueprint** — a `<screen>.blueprint.md` produced by `shesha-developer:shesha-design-comprehension`. The blueprint is a *measured placement contract*; build to it exactly, then expect a placement re-measure (gate 5a.5) against its `assertions`.

## How to read it

A blueprint has, per screen: a header (entity modelType, form identity, **Archetype**, fidelity/confidence/viewport) and per-region `layout-tree`, `bindings`, and `assertions` fenced blocks. Map them onto a build:

| Blueprint part | Drives |
|---|---|
| `Archetype:` (one of the 8) | which seed to copy — see [examples.md](examples.md) for the priority order (record-detail → `assets/exemplars/record-detail-simple.json` or `record-detail-with-children.json`; list/table → `assets/examples/rs-table.json`; create dialog → `assets/examples/rs-create-dialog.json`; link-add → `assets/examples/rs-link-add-dialog.json`) |
| `layout-tree` `row=[…]` / `flex=[…]` | a flex **`container` row** (`display:"flex"` + `flexDirection:"row"` + `gap`) — **never the `columns` component**; size each child via `desktop.dimensions.width` (fill = `"calc(100% - <others>px)"`, fixed rail = `"332px"`). `native=[…px]` flags a fixed-width child |
| `layout-tree` nesting (indentation) | the container nesting + every component's `parentId` |
| `layout-tree` `kind` (card/tabs/datatable/datalist/field/buttonGroup/chip) | the component `type` to use |
| `bindings` table | each input's `propertyName` + component `type` (validate every propertyName against the entity metadata, Step 4.5) |
| region `recipe:` annotations | passed through to `shesha-design-system` for styling (not your concern — build structure only) |
| `assertions` block | what gate 5a.5 will re-measure: column membership, row grouping, nesting depth, tab assignment |

## Building to the placement (the part that drifts)

- **Restructure the seed to match the `layout-tree`** — don't keep the seed's body just because it's there. If the blueprint says an 18/6 body with a right rail of panels, the seed's "full-width attributes + bottom tabs" body must be rebuilt into that split (attributes into the rail, the main list into the wide column).
- **Every split child needs an explicit `desktop.dimensions.width`, AND the row needs `display:"flex"`.** A flex row missing `display:"flex"` renders `display:block` → children stack full-width (the single most common placement failure: related panels end up under the main column instead of in the rail). `customStyle:{flex}` does NOT size the child — it is inert on the outer div; use `dimensions.width`.
- **Fixed-width rail:** for a `native=[…,332px]` rail, set the rail child `desktop.dimensions.width:"332px"` (`minWidth`/`maxWidth` `"332px"`) and the main child `width:"calc(100% - 348px)"` (332 rail + 16 gap). Collapse to stacked full-width on tablet/mobile.
- **Re-stamp `parentId` on every moved component** so the new nesting is real (wrong/missing parentIds render blank).

## After build — expect the placement diff

`shesha-design-comprehension` re-probes the built, published, table→details-navigated form and diffs measured placement against the blueprint `assertions`. Mismatches come back as concrete, routed fixes in this skill's vocabulary (move node into the right flex `container` row; give the child its `desktop.dimensions.width`; add `display:"flex"` to a row that's stacking; wrap rows 2-cell; assign to the right tab). Apply, re-push, repeat until all assertions pass. Don't consider the form done at "it renders" — done is "placement assertions pass".
