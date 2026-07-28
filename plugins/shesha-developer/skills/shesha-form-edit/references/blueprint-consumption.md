# Consuming a layout blueprint (from shesha-design-comprehension)

Design-driven requirements arrive as a **blueprint**: a Markdown file
(`<screen>.blueprint.md`) carrying a fenced ```` ```blueprint-json ```` block
that conforms to `shesha-design-comprehension/schemas/blueprint.schema.json`.
The blueprint is a *measured placement contract* — build to it exactly.

## Pipeline

1. **Extract** the `blueprint-json` block (the Markdown around it is
   human-readable commentary — the JSON is the contract). `validate-blueprint.mjs`
   accepts the `.md` directly and pulls the block out for you.
2. **Compile**: `node scripts/compile-blueprint.js --blueprint <bp.json>
   --metadata <Entity>.probe.json --out <workdir>/<form>.json`. The compiler
   validates the blueprint first, resolves `archetype` against
   `assets/golden/_index.json` and instantiates its chrome, builds the layout tree
   as flex containers sized via `desktop.dimensions.width` [R-028/R-029], types
   each node from `kind`, and wires `bindings` from the metadata snapshot.
3. **Apply**: `node scripts/apply-form.mjs` runs the gate chain and the whole
   mutation. Appearance is already baked in from the brand style plan — there is no
   pass-through to `shesha-design-system` and nothing to annotate for it.

**The schema is closed.** Every node kind sets `additionalProperties: false`, so an
extra key is a validation error rather than a silently ignored hint — including the
`recipe:` region annotations older blueprints carried. Express intent with the node
`kind` and the archetype; there is nowhere else for it to go.

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
tab). Fix the blueprint, recompile, re-run `apply-form.mjs` — done is "placement
assertions pass", not "it renders".
