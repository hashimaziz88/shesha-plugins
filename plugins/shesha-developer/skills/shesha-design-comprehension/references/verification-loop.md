# Verification loop — does the built form match the blueprint?

The mechanism that turns "it renders" into "it's placed where the design put it". This is what actually fixes the container-drift complaint: the blueprint's `contract` rows become a measured pass/fail gate on the built Shesha form, and failures become concrete fixes routed back to `shesha-form-edit`.

Runs as **gate 5a.5** in `shesha-claude-designer` — after structural integrity (5a), before styling (5b). It can also be invoked standalone to diagnose an existing form ("why doesn't this match the design?").

## Procedure

1. **Build + publish** the form via `shesha-form-edit` (Draft → Live).
2. **Clear the form cache.** The frontend caches form markup in IndexedDB — clear `form` / `form_lookup` from `/favicon.ico` (not in-app) after every push, or you measure a ghost of the previous build.
3. **Navigate the real path.** Open the form via **table-row → details**, never a pasted `?id=` (a direct id load 500s the subtable Crud/Create). Pin the **same viewport** used for capture (1440×900).
4. **Re-probe.** Run the *same* `scripts/layout-probe.js` against the rendered Shesha form → actual `layout.json`. Same instrument as capture = comparable numbers.
5. **Diff actual vs the blueprint `contract`** — structurally, not by pixels (next section).
6. **Route mismatches back to `shesha-form-edit`** as concrete fixes; rebuild → re-publish → clear cache → re-probe → re-diff until every assertion passes.

## What to diff (and why it survives the pixel↔width-expression gap)

Assert on properties that are stable across the design's pixel grid and Shesha's flex-container `calc()`/% widths:

| Dimension | How to measure from the probe | Example assertion |
|---|---|---|
| **Split-cell membership** | which x-cluster a node falls in (`colIndex` within its parent) | "both related panels in the RIGHT cluster" |
| **Row grouping** | nodes sharing a `rowBand` (y-band) | "Details rows are 2-cell, label and control on one row" |
| **Nesting depth / parent** | the `parentId` ancestor chain | "panels are children of the rail column, not the page root" |
| **Tab assignment** | which tab panel a node lives under | "child table X is under the 'Endpoints' tab" |
| **Split ratio (range)** | left:right width ratio, with tolerance | "left ≥ 2.5× right; rail ≈ 332px ± 40" |

**Never** assert absolute pixels or exact width expressions — a `minmax(0,1fr) 332px` design grid is *satisfied* by a flex-row split whose fill cell is `width:"calc(100% - 356px)"` and whose rail cell is a fixed `width:"332px"` (the ratio, not the exact calc, is what matters). Fail only on **wrong cluster / wrong parent / wrong tab / ratio out of range**.

## Routed-fix vocabulary (speak `shesha-form-edit`'s language)

A failing assertion becomes an instruction phrased in the builder's terms, e.g.:

> **A2 FAIL** — `Required End-points` panel measured in the LEFT x-cluster (x≈40, colIndex 0) but the blueprint asserts the RIGHT rail. *Fix:* move that panel's node into the right flex `container` row; ensure the body row carries `display:"flex"` + `flexDirection:"row"` + `gap`, the fill cell has `desktop.dimensions.width:"calc(100% - 356px)"` and the rail cell has its own `desktop.dimensions.width:"332px"` (a cell with no width set grows/shrinks freely and can collapse to the left).

> **A4 FAIL** — `Details` rows measured full-width (one node per rowBand) but blueprint asserts 2-cell rows. *Fix:* wrap each label+control into a 2-cell flex row — a `container` with `display:"flex"` + `flexDirection:"row"` + `gap` whose two child `container`s each carry a `desktop.dimensions.width` — or use the detail-attributes recipe's label/value row.

Keep each fix to: the failing assertion id, the measured fact (with numbers), the asserted fact, and the structural change in `shesha-form-edit` terms.

## RED → GREEN (how this skill is validated)

The skill is proven by watching the failure first:

- **RED:** build the pilot from a *prose* brief only (no blueprint) → probe → record ≥1 failing assertion with numbers (e.g. panels collapse into one column; KIB flattens). This reproduces the drift, measured.
- **GREEN:** build the same screen from the blueprint → probe → iterate routed fixes until the *same* contract rows all pass.

The RED→GREEN delta on identical contract rows is the proof the layer fixes drift rather than re-describing it.

## Failure modes

- **Stale IndexedDB cache** → you measure the previous build. Always clear from `/favicon.ico` after a push.
- **Direct `?id=` load** → 500s on subtables, or renders a partial form. Always navigate table→details.
- **Different viewport** between capture and verification → incomparable numbers. Pin one.
- **Responsive collapse** at the test viewport → if the design is genuinely responsive, capture+verify at the breakpoint the design targets, and say so in the blueprint.
