---
name: shesha-design-system
description: Owns APPEARANCE ONLY — brand tokens, the app-level Ant Design theme, and per-component v7 style blocks. Use for "apply our brand", "the buttons are the wrong blue", "make this look less default", or to author a new <brand>.tokens.json. Maps colour, type, spacing, radius, shadow and status-lifecycle tokens onto the props 0.45 components actually honour, annotated with gym-measured evidence of which style channels render. Ships shesha (default), requirements-studio and wcg. It exposes tokens as a validated style plan that the form compiler links directly, so a compiled form arrives already themed. NEVER authors structure, wires CRUD, or pushes to the backend — structure and every push belong to shesha-form-edit; layout choices belong to shesha-design-comprehension.

---

# Shesha Design System (0.45)

Turn "make it look good / match the design" into **concrete Shesha style values**. This skill owns *how forms look*, never *what they contain*.

**The bar is a production C-suite deliverable** — the fidelity of a McKinsey or Deloitte engagement artefact, not merely token-compliant output. Restraint and hierarchy over decoration; exact alignment; every number labelled; the empty and error states designed too. What that means concretely, and how it is judged: [references/shesha-design-standards.md](references/shesha-design-standards.md) § The bar. `shesha-design-critic` scores it from the rendered screenshot and a build is not done below `acceptable`.

## How the compiler uses this skill — linked, not invoked

For a **compiled** form, this skill is a **pure function, not an actor**. `scripts/resolve-style-plan.mjs` turns a `<brand>.tokens.json` into a normalized **style plan** — every `roles.*` indirection dereferenced to a concrete value — validated against [schemas/style-plan.schema.json](schemas/style-plan.schema.json). `shesha-form-edit`'s `compile-blueprint.js` imports that function and bakes the plan into every node as it emits.

So there is no styling *pass* over a compiled form, and this skill never pushes. Inspect any brand's plan:

```
node scripts/resolve-style-plan.mjs shesha
```

A token file missing a key the plan requires fails there — loudly — instead of silently producing an unbranded form. When you author a new brand, run it and get exit 0 before considering the brand done.

Direct invocation is for **authoring appearance**: a new or changed brand, the one-time app theme, or restyling a form the compiler did not produce. That work emits the props 0.45 components expect, in **two layers that must BOTH be applied**:

1. **App-level Ant Design theme (set once):** brand primary, base font, base radius, semantic colours — the whole portal inherits them. Mechanism: [references/app-theme.md](references/app-theme.md). Don't repaint every button per form.
2. **Per-component v7 style blocks (per form):** surfaces, cards, section headers, density, status chips, header bands, rails — what the global theme can't express. Recipes: [references/component-recipes.md](references/component-recipes.md).

A form looks "cheap" when only one layer is done (AntD still default-blue, or no surface treatment). Apply both.

## When to use / not

- **Use** for visual goals: match a design, apply branding, raise polish, restyle a working form.
- **Don't use** to add fields, wire buttons/CRUD, resolve modelType, or debug runtime errors (→ `shesha-form-edit`); or to choose the layout (→ `shesha-design-comprehension`).

## Steps

1. **Pick the theme.** Token files live in `assets/themes/<brand>.tokens.json`. Three ship:

   | Brand | File | What it is |
   |---|---|---|
   | `shesha` | `shesha.tokens.json` | **The default** — Cobalt `#003BB2` interactive anchor, Navy chrome, Nero ink, white cards on Athens Grey canvas, borders-not-shadows, ready `$antdTheme` block. The compiler's default when a blueprint names no brand. |
   | `requirements-studio` | `requirements-studio.tokens.json` | Example custom brand (LandBank green, Inter, RsStatus lifecycle). |
   | `wcg` | `wcg.tokens.json` | Additional shipped brand. |

   User names a brand / hands tokens / an app `<brand>.tokens.json` exists → use it. A genuinely new brand → copy `shesha.tokens.json` → `<brand>.tokens.json`, swap the values, **keep every key name identical** so recipes, block-overlays and `roles.*` resolve unchanged. Load the file; resolve `roles.*` before authoring.
2. **Apply the app-level theme (once per project)** — [app-theme.md](references/app-theme.md). Never skip when the complaint is "buttons/links are the wrong colour".
3. **Apply per-component v7 blocks.** Copy the matching recipe from [component-recipes.md](references/component-recipes.md), fill it with resolved token values via [token-to-prop-mapping.md](references/token-to-prop-mapping.md). Mirror blocks across desktop/tablet/mobile unless the design is genuinely responsive.
Visual judgment of a built form is **not** this skill's job — the `shesha-design-critic` agent owns it, dispatched from `shesha-form-edit`'s oracle, so the judge never sees the authoring rationale. Findings come back here only as concrete prop-level fixes to apply.

Design conventions every recipe respects: [references/shesha-design-standards.md](references/shesha-design-standards.md). The canonical brand-independent layout/component anatomy (page anatomy, tables, cards, chips, modals): [references/default-layout-patterns.md](references/default-layout-patterns.md) — every styling pass builds to these shapes; brand tokens only recolour them.

## Capability authority

"Does style channel X actually render on component Y?" is answered by **`shesha-form-edit/assets/measured-capability-matrix.json`** — the gym-measured 0.45 authority, regenerated per release. The local `assets/capability-matrix.json` is **annotation only**: technique key paths, cross-cutting rules, and fixes, overlaid with measured evidence by `merge-capability.js`. How to read the pair: [references/capability-matrix.md](references/capability-matrix.md). Never author a style on a channel measured as a no-op.

## Mechanics & firm rules

- v7 block shapes, the 5-channel precedence (the legacy `style` JS-string wins over everything [R-030]), and where each channel lands in the DOM (outer vs inner div [R-032]): [references/styling-mechanics.md](references/styling-mechanics.md).
- Splits are flex container rows sized via `desktop.dimensions.width` — never the `columns` component [R-028]; a flex container must set `display:"flex"` [R-029].
- `refListStatus` colour comes from the reflist item itself [R-036]; datalist row-template card fixes live in the block subtree [R-048].
- `stylingBox` is a JSON **string** (padding/margin keys only). Text components take `fontSize`/`fontWeight` as direct props. Per-side borders need `borderType: "custom"`. Brand primary on buttons comes from the app theme — never per-button.
- No custom CSS/React/HTML — everything is component props on Shesha JSON. Tokens live in theme files, never inline hexes.
- **Style, don't restructure** — wrong structure routes back to `shesha-form-edit`; layout is owned by `shesha-design-comprehension`.
- This skill produces styled JSON/edits; it does **not** own auth/push/publish — `shesha-form-edit` does [R-046], and handing back styled markup is a handback, not completion.

## Reference map

| Topic | File |
|---|---|
| App-level Ant theme | [references/app-theme.md](references/app-theme.md) |
| Per-component recipes | [references/component-recipes.md](references/component-recipes.md) |
| Token → prop resolution | [references/token-to-prop-mapping.md](references/token-to-prop-mapping.md) |
| v7 blocks + channels + debug | [references/styling-mechanics.md](references/styling-mechanics.md) |
| Capability (measured + annotations) | [references/capability-matrix.md](references/capability-matrix.md) |
| Default look for un-compiled forms | [references/default-theme-quickpass.md](references/default-theme-quickpass.md) |
| Style-plan contract (compiler input) | [schemas/style-plan.schema.json](schemas/style-plan.schema.json) |
| Canonical layout anatomy | [references/default-layout-patterns.md](references/default-layout-patterns.md) |
| Design conventions | [references/shesha-design-standards.md](references/shesha-design-standards.md) |

| Concern | Skill |
|---|---|
| Ingest design, plan, orchestrate, verify | `shesha-developer:shesha-claude-designer` |
| Design → measured blueprint + placement verify | `shesha-developer:shesha-design-comprehension` |
| Build structure, CRUD, gates, push | `shesha-developer:shesha-form-edit` |
| **Tokens → validated style plan, app theme, v7 style blocks** | **this skill** |
