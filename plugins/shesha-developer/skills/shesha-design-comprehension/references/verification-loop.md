# Verification loop — does the built form match the blueprint?

The mechanism that turns "it renders" into "it's placed where the design put it". This is what actually fixes the container-drift complaint: the blueprint's `assertions` become a measured pass/fail gate on the built Shesha form, and failures become concrete fixes routed back to `shesha-form-edit`.

Runs as **Layer 3 (placement diff)** of `shesha-form-edit/references/quality-gates.md` — a stage `shesha-form-edit` RUNS (this skill owns the SCRIPT, `verify-placement.mjs`), after the Layer 2 render-instrument gate and before the Layer 4 design-critic gate, consuming the `.evidence.json` the render instrument wrote. (Styling is a compile-time input [R-042], not a later pass this loop precedes.) It can also be invoked standalone to diagnose an existing form ("why doesn't this match the design?").

## Procedure

1. **Build + publish** the form via `shesha-form-edit` (Draft → Live).
2. **Consume the instrument's evidence file — do NOT launch a browser.** The
   Layer 2 render-instrument run already navigated, cleared the cache [R-056] and
   measured this form at 1440×900; it wrote the **one canonical render evidence
   document** as `<out>/<module>--<name>.evidence.json` next to the screenshot
   and the (slim) verdict. That file is the only input this layer needs — its
   schema is declared once, in `scripts/layout-probe.js` (`EVIDENCE_REQUIRED`).
   There is no separate layout artifact and no second copy of the geometry
   inside the verdict; the verdict just carries `evidencePath`. **One browser
   boot per verify cycle** — artifacts fan out, browsers don't
   (`shesha-form-edit/references/quality-gates.md`, browser-verification tiers).
3. **Fallback re-probe — only when the evidence file is absent** (no instrument
   run, or `--no-browser`): clear the form cache first, or you measure a ghost of
   the previous build [R-056] (recipe in
   `shesha-form-edit/references/verification.md` §2); open the form via
   **table-row → details**, never a pasted `?id=` (a direct id load 500s the
   subtable Crud/Create); pin the **same viewport** used for capture (1440×900);
   run the *same* probe — `node scripts/layout-probe.js --url <url> --form
   <module>/<name> --out <file>.evidence.json`. Same probe function, same schema
   as the instrument (the CLI stamps `capturedBy: "layout-probe"` and leaves the
   fields only a scripted session can know — `consoleErrors`, `networkErrors`,
   `screenshotPath`, `settled` — present but empty). Same instrument as capture =
   comparable numbers.
4. **Run the placement oracle — mechanically, never by reading a screenshot:**

   ```
   node scripts/verify-placement.mjs --spec <blueprint>.json \
        --evidence <out>/<module>--<name>.evidence.json [--out placement.verdict.json]
   ```

   It evaluates the blueprint's TYPED `assertions` against the evidence's rects,
   `rowBands`, `columnClusters` and `tabMembership`. `description` fields are
   ignored — there is no model interpretation anywhere in it, so the same inputs
   always give the same verdict. Per-assertion outcome is a **closed set**, and
   the three failure modes stay distinct because they route to different fixes:

   | outcome | meaning | route the fix to |
   |---|---|---|
   | `pass` | measured, and right | — |
   | `mismatch` | measured, and wrong (carries `expected` + `measured`) | `shesha-form-edit` — a placement change |
   | `unverifiable` | subject/target absent or ambiguous in the evidence | the build — the node was never created (or the assertion names something that does not exist) |
   | `malformed-evidence` | the probe measured nothing | the **instrument**, not the form |

   Exit codes: `0` all required assertions passed · `1` a required assertion did
   not (an unverifiable REQUIRED assertion fails the gate — fail-closed) · `2`
   usage · `3` malformed evidence. Tolerances are fixed and documented in the
   script header (containment 2px, alignment 4px, same-row 12px, same-column
   16px, relative-width ±0.08, width-ratio ±15%) and echoed in every report.
5. **Route mismatches back to `shesha-form-edit`** as concrete fixes; rebuild → re-publish → re-run the render-instrument (which clears the cache and rewrites the evidence file) → re-run the oracle. **HARD CAP: 2 routed-fix iterations.** If assertions still fail after the second re-probe, STOP the loop and emit a placement report instead: each still-failing assertion id, its measured vs asserted values, and the suspected structural cause. Two failed targeted fixes means the fix vocabulary doesn't reach the problem (usually a version/renderer constraint, not placement) — a third iteration burns 5–10 minutes without converging. An honest "placement partial: A2, A4 unmet — <measured facts>" beats a 40-minute loop every time.

## What to diff (and why it survives the pixel↔width-expression gap)

Assert on properties that are stable across the design's pixel grid and Shesha's flex-container `calc()`/% widths:

| Dimension | How to measure from the probe | Example assertion |
|---|---|---|
| **Split-cell membership** | which x-cluster a node falls in (`columnIndex` within its parent) | "both related panels in the RIGHT cluster" |
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

## Failure modes

- **Stale form cache** → you measure the previous build. Clear after every push [R-056].
- **Direct `?id=` load** → 500s on subtables, or renders a partial form. Always navigate table→details (`verification.md §3`).
- **Different viewport** between capture and verification → incomparable numbers. Pin one.
- **Responsive collapse** at the test viewport → if the design is genuinely responsive, capture+verify at the breakpoint the design targets, and say so in the blueprint.
