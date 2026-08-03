# Consuming a layout blueprint (from shesha-design-comprehension)

Design-driven requirements arrive as a **blueprint**: a Markdown file
(`<screen>.blueprint.md`) carrying a fenced ```` ```blueprint-json ```` block
that conforms to `shesha-design-comprehension/schemas/blueprint.schema.json`.
The blueprint is a *measured placement contract* — build to it exactly.

## Pipeline

1. **Extract** the `blueprint-json` block (the Markdown around it is
   human-readable commentary — the JSON is the contract).
2. **Compile**: `node scripts/compile-blueprint.js --blueprint <bp.json> --out
   <workdir>/<form>.json`. The compiler builds the layout tree directly from
   the blueprint's `layout-tree` — it never reads a golden archetype; goldens
   are a seed/reference tier for hand-composition only. It sizes containers as
   flex via `desktop.dimensions.width` [R-028/R-029], types each node from
   `kind`, and wires `bindings` (validate every propertyName live [R-034] via
   `resolve-bindings.js`).
3. **Gates onward** as for any build — schema → guardrails → bindings →
   styledness. The blueprint's region `recipe:` annotations pass through to
   `shesha-design-system`, which resolves them into the theme tokens baked in
   at compile time [R-042].

## What the blueprint's parts drive

| Blueprint part | Drives |
|---|---|
| `archetype` | the named pattern the layout tree implements (not a golden clone) |
| `layout-tree` rows/nesting | flex container structure + every `parentId` [R-001] |
| `kind` per node | the component `type` |
| `bindings` | each input's `propertyName` + component type |
| `assertions` | the post-push placement re-measure |

## After push — assertions are verified by comprehension

`shesha-design-comprehension` re-probes the built, published form and diffs
measured placement against the blueprint `assertions`. Mismatches come back as
routed fixes (move node into the right flex row; set the child's
`desktop.dimensions.width`; add `display:"flex"` to a stacking row; reassign a
tab). Apply, re-push, repeat — capped at 2 iterations ([contracts.md §6](contracts.md)).
Done is "placement assertions pass", not "it renders".
