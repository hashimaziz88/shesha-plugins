# Consuming a layout blueprint (from shesha-design-comprehension)

When this skill is invoked by `shesha-claude-designer` (or directly with a design to match), the requirements arrive as a **layout blueprint** — a `<screen>.blueprint.json` produced by `shesha-developer:shesha-design-comprehension`, conforming to `../shesha-design-comprehension/assets/blueprint.schema.json`. Building from it is a **compile, not an authoring task** — see [compiling.md](compiling.md) for the one-command path (`compile-spec.mjs` then `validate-form.mjs`) and the full contract. This file is the field-mapping reference for reading a blueprint and troubleshooting a compile that fails or produces the wrong thing.

## What's in a blueprint, and what the compiler does with each part

| Blueprint field | What the compiler does with it |
|---|---|
| `archetype` (one of the 8 — [archetypes.md](archetypes.md)) | Selects the flow manifest (`assets/archetypes/<archetype>.flow.json`) that completes any node the blueprint itself omitted, and resolves the `isDetailForm`/`editMode` logic (a "Start Edit"/`shesha.form` action anywhere marks a detail-lifecycle form) |
| `nodes[]` (each with `node`, `type`, optional `role`/`style`/`slot`/`children`/`items`/`tabs`) | Walked into the raw component tree (`scripts/lib/compile/tree.mjs`) — resolves each node's concrete registry `type`, its container style (role → full per-breakpoint style block), its buttonGroup/dataContext/datatable/tabs/wizard shape |
| `bindings[]` (`{ label, property }`) | Matched to a leaf node by its `content` label; drives that leaf's `propertyName` (camelCased) |
| `entity.modelType` (`{ name, module }`) | Becomes `formSettings.modelType` verbatim; if absent, a placeholder is synthesized (flagged in `report.defaults`) — see `compile-spec.mjs`'s `buildFormSettings()` |
| `dependencies[]` | Resolved into `{ module, name }` form references used by Show Dialog / row-navigate wiring (`deriveDependsOnForms()` in `tree.mjs`) |
| `assertions[]` | NOT consumed by the compiler at all — this is gate 5a.5's input, evaluated post-build by `verify-placement.mjs` against a probe of the rendered form. See `shesha-design-comprehension`'s `verification-loop.md`. |

Layout splits (a design's two-column row, a fixed-width rail) are expressed in a blueprint node's `role`/`style`, never as a separate "layout-tree" annotation to hand-translate — the compiler resolves a container's role straight into a complete flex `container` (`display:"flex"` + `flexDirection:"row"`, each child sized via `desktop.dimensions.width`) via `container-style.mjs`. **Never the `columns` component** — this project's only split mechanism, enforced by the compiler (it never emits `columns`) and by `T2-COLUMNS-PRESENT` on a hand-edit.

## When the compile fails or produces the wrong thing

- **`compileSpec` throws "blueprint failed schema validation"** — the blueprint itself is malformed. That's `shesha-design-comprehension`'s artifact; route the fix there, don't hand-patch the compiled output.
- **`compileSpec` throws "referenced by a slot/children/tabs entry but no blueprint node defines it"**, or **"defined but never reachable from a root"** — the blueprint's node graph has a dangling reference or an orphaned node. Same as above: a `shesha-design-comprehension` authoring bug, not a markup patch.
- **The compiled markup fails `validate-form.mjs` with a real (non-zero) finding** — every one of the 8 archetype fixtures plus the card/collapsiblePanel fixture compiles to zero Tier 1/2 findings today (`tests/e2e-compile.test.mjs`, `tests/card-collapsible-fixture.test.mjs`), so a finding on a real blueprint names either a genuine gap in that blueprint (e.g. a role the compiler can't resolve) or a compiler bug — do not paper over it by hand-editing the compiled JSON; report it.
- **The build matches structurally but fails gate 5a.5 (placement)** — that's a `shesha-design-comprehension`/`verify-placement.mjs` concern, not this skill's. Read the failing assertion's message (it names the measured vs. asserted fact) and fix the blueprint or the compiler's role/style resolution, not the pushed markup directly.

## Styling passes through untouched

A blueprint node's `recipe:` annotations (if present) are for `shesha-design-system` — not this skill's concern. Structure only.
