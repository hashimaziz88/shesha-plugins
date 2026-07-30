# Verification loop — does the built form match the blueprint?

The mechanism that turns "it renders" into "it's placed where the design put it". This is what actually fixes the container-drift complaint: the blueprint's `assertions` become a measured pass/fail gate on the built Shesha form, and failures become concrete fixes routed back to `shesha-form-edit`.

Runs as **gate 5a.5** in `shesha-claude-designer` — after structural integrity (5a), before the visual audit (5b). It measures the form as compiled and pushed, which is already styled (theme is a compile-time input [R-042]); a placement failure routes back to the blueprint for a recompile, never to a style override. It can also be invoked standalone to diagnose an existing form ("why doesn't this match the design?").

## Procedure

1. **Build + publish** the form via `shesha-form-edit` (Draft → Live).
2. **Clear the form cache.** The frontend caches form markup in IndexedDB — clear `form` / `form_lookup` from `/favicon.ico` (not in-app) after every push, or you measure a ghost of the previous build.
3. **Navigate the real path.** Open the form via **table-row → details**, never a pasted `?id=` (a direct id load 500s the subtable Crud/Create). Pin the **same viewport** used for capture (1440×900). **If the blueprint has any `tab(...)` assertions, click through every tab at least once first** — rc-tabs only mounts a pane's contents into the DOM on its first visit, so an untouched tab is invisible to any single-pass probe. Return to whichever tab you want active for the capture (doesn't matter which — inactive-but-mounted panes are still captured, see below).
4. **Re-probe.** Run the *same* `scripts/layout-probe.js` against the rendered Shesha form → actual `layout.json`. Same instrument as capture = comparable numbers.
5. **Diff actual vs the blueprint `assertions`** — structurally, not by pixels (next section).
6. **Route mismatches back to `shesha-form-edit`** as concrete fixes; rebuild → re-publish → clear cache → re-probe → re-diff. **HARD CAP: 2 routed-fix iterations.** If assertions still fail after the second re-probe, STOP the loop and emit a placement report instead: each still-failing assertion id, its measured vs asserted values, and the suspected structural cause. Two failed targeted fixes means the fix vocabulary doesn't reach the problem (usually a version/renderer constraint, not placement) — a third iteration burns 5–10 minutes without converging. An honest "placement partial: A2, A4 unmet — <measured facts>" beats a 40-minute loop every time.

## What to diff (and why it survives the pixel↔width-expression gap)

Assert on properties that are stable across the design's pixel grid and Shesha's flex-container `calc()`/% widths — expressed as one of five **typed predicates** (`scripts/lib/assertions.mjs`), not English prose. `parseAssertion()` rejects anything that isn't one of these five forms, naming the valid forms — there is no prose fallback:

| Dimension | How to measure from the probe | Predicate |
|---|---|---|
| **Split-cell membership** | which x-cluster a node falls in (`colIndex` within its parent) | `same-cluster(a, b)` |
| **Row grouping** | nodes sharing a `rowBand` (y-band) | `same-rowband(a, b)` |
| **Nesting depth / parent** | the `parentId` ancestor chain | `parent-of(a, b)` |
| **Tab assignment** | which tab panel a node lives under | `tab(a, key)` — `layout-probe.js` stamps a `tabKey` (nearest enclosing `role="tabpanel"`'s key) and a `hidden` flag onto every node; inactive-but-*mounted* panes (`display:none` via antd's `ant-tabs-tabpane-hidden`) are still walked. A pane never yet activated isn't mounted at all (rc-tabs only mounts on first visit unless `forceRender` is set), so it can't be captured by a single-pass probe — **click through every tab at least once before the final capture** (step 3 below) so all panes are in the DOM for that one pass |
| **Split ratio (range)** | left:right width ratio, with tolerance | `ratio(a, b, min, max)` — reads `multiColumnContainers[].childWidths` (`scripts/layout-probe.js`), never an absolute pixel |

**Never** assert absolute pixels or exact width expressions — a `minmax(0,1fr) 332px` design grid is *satisfied* by a flex-row split whose fill cell is `width:"calc(100% - 356px)"` and whose rail cell is a fixed `width:"332px"` (the ratio, not the exact calc, is what matters). `ratio` is the only quantitative predicate for exactly this reason, and it always takes a `[min, max]` range. Fail only on **wrong cluster / wrong parent / wrong tab / ratio out of range**.

**Run it.** `node scripts/verify-placement.mjs <blueprint.json> <built.probe.json> [--design <design.probe.json>]` evaluates every assertion in the blueprint against the built form's probe (`evaluate()` in `scripts/lib/assertions.mjs`), prints a PASS/FAIL line per assertion (failures include the measured values), and exits 0 only if every assertion passed. This is gate 5a.5 made executable — it replaces the model reading its own English assertions back and grading them.

## Routed-fix vocabulary (speak `shesha-form-edit`'s language)

A failing assertion becomes an instruction phrased in the builder's terms, e.g.:

> **A2 FAIL** — `Required End-points` panel measured in the LEFT x-cluster (x≈40, colIndex 0) but the blueprint asserts the RIGHT rail. *Fix:* move that panel's node into the right flex `container` row; ensure the body row carries `display:"flex"` + `flexDirection:"row"` + `gap`, the fill cell has `desktop.dimensions.width:"calc(100% - 356px)"` and the rail cell has its own `desktop.dimensions.width:"332px"` (a cell with no width set grows/shrinks freely and can collapse to the left).

> **A4 FAIL** — `Details` rows measured full-width (one node per rowBand) but blueprint asserts 2-cell rows. *Fix:* wrap each label+control into a 2-cell flex row — a `container` with `display:"flex"` + `flexDirection:"row"` + `gap` whose two child `container`s each carry a `desktop.dimensions.width` — or use the detail-attributes recipe's label/value row.

Keep each fix to: the failing assertion id, the measured fact (with numbers), the asserted fact, and the structural change in `shesha-form-edit` terms.

## Failure modes

- **Stale IndexedDB cache** → you measure the previous build. Clear after every push — procedure in `shesha-form-edit/references/verification.md §2`.
- **Direct `?id=` load** → 500s on subtables, or renders a partial form. Always navigate table→details (`verification.md §3`).
- **Different viewport** between capture and verification → incomparable numbers. Pin one.
- **Responsive collapse** at the test viewport → if the design is genuinely responsive, capture+verify at the breakpoint the design targets, and say so in the blueprint.
