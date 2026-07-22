# Consuming a layout blueprint (from shesha-design-comprehension)

Design-driven requirements arrive as a **blueprint**: a Markdown file
(`<screen>.blueprint.md`) carrying a fenced ```` ```blueprint-json ```` block
that conforms to `shesha-design-comprehension/schemas/blueprint.schema.json`.
The blueprint is a *measured placement contract* — build to it exactly.

## Pipeline

1. **Extract** the `blueprint-json` block (the Markdown around it is
   human-readable commentary — the JSON is the contract).
2. **Compile**: `node scripts/compile-blueprint.js --blueprint <bp.json> --out
   <workdir>/<form>.json`. The compiler picks the golden archetype from the
   blueprint's `archetype`, builds the layout tree as flex containers sized via
   `desktop.dimensions.width` [R-028/R-029], types each node from `kind`, and
   wires `bindings` (validate every propertyName live [R-034] via
   `resolve-bindings.js`).
3. **Gates onward** as for any build — schema → guardrails → bindings →
   styledness. The blueprint's region `recipe:` annotations pass through to
   `shesha-design-system` untouched (style is not your concern here).

## What the blueprint's parts drive

| Blueprint part | Drives |
|---|---|
| `archetype` | which golden archetype the compiler clones (`assets/golden/_index.json`) |
| `layout-tree` rows/nesting | flex container structure + every `parentId` [R-001] |
| `kind` per node | the component `type` |
| `bindings` | each input's `propertyName` + component type |
| `assertions` | the post-push placement re-measure |

## After push — assertions are verified by comprehension

`shesha-design-comprehension` re-probes the built, published form and diffs
measured placement against the blueprint `assertions`. Mismatches come back as
routed fixes (move node into the right flex row; set the child's
`desktop.dimensions.width`; add `display:"flex"` to a stacking row; reassign a
tab). Apply, re-push, repeat — done is "placement assertions pass", not "it
renders".
