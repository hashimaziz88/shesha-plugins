---
name: shesha-design-system
description: EXECUTION LAYER under shesha-claude-designer (the main entry for all designer work — enter there first). Owns how forms LOOK — maps brand design tokens (colour, type, spacing, radius, shadow, status lifecycle) onto Shesha's app-level Ant Design theme and per-component v7 style blocks, through channels the measured capability matrix proves work. Ships three brand themes (shesha default, requirements-studio, wcg) and accepts new token files. Invoked automatically by shesha-form-edit's Style step so no form ships unstyled [R-042]. Invoke directly only for targeted styling of an existing form. 0.45-only — 0.43 styling lives in the shesha-developer-0-43 plugin. Never authors structure/components, CRUD, or runtime fixes — that is shesha-form-edit's job.
---

# Shesha Design System (0.45)

Turn "make it look good / match the design" into **concrete Shesha style values**. This skill owns *how forms look*, never *what they contain*. It reads a brand **theme token file** and emits the exact props 0.45 components expect, in **two layers that must BOTH be applied**:

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
   | `shesha` | `shesha.tokens.json` | **The default** — Cobalt `#003BB2` interactive anchor, Navy chrome, Nero ink, white cards on Athens Grey canvas, borders-not-shadows, ready `$antdTheme` block. Used whenever no brand is named — including form-edit's mandatory no-design pass [R-042] via the cost-capped [default-theme-quickpass.md](references/default-theme-quickpass.md) (for that pass, follow that file only). |
   | `requirements-studio` | `requirements-studio.tokens.json` | Example custom brand (LandBank green, Inter, RsStatus lifecycle). |
   | `wcg` | `wcg.tokens.json` | Additional shipped brand. |

   User names a brand / hands tokens / an app `<brand>.tokens.json` exists → use it. A genuinely new brand → copy `shesha.tokens.json` → `<brand>.tokens.json`, swap the values, **keep every key name identical** so recipes, block-overlays and `roles.*` resolve unchanged. Load the file; resolve `roles.*` before authoring.
2. **Apply the app-level theme (once per project)** — [app-theme.md](references/app-theme.md). Never skip when the complaint is "buttons/links are the wrong colour".
3. **Apply per-component v7 blocks.** Copy the matching recipe from [component-recipes.md](references/component-recipes.md), fill it with resolved token values via [token-to-prop-mapping.md](references/token-to-prop-mapping.md). Mirror blocks across desktop/tablet/mobile unless the design is genuinely responsive.
4. **Audit (optional).** Given a screenshot + the theme, return prop-level fixes (component, prop path, current vs target, one-line reason), ordered by impact. Rubric: [references/appearance-quality.md](references/appearance-quality.md) — never override a construction guardrail.

Design conventions every recipe respects: [references/shesha-design-standards.md](references/shesha-design-standards.md). The canonical brand-independent layout/component anatomy (page anatomy, tables, cards, chips, modals): [references/default-layout-patterns.md](references/default-layout-patterns.md) — every styling pass builds to these shapes; brand tokens only recolour them.

## Baseline authority — never invent a value

Shesha renders on **Ant Design 6.3.5**. Precedence is: **brand token file → Ant 6.3.5 default → nothing.** Anything the brand file doesn't name takes the Ant default, and the Ant default is *looked up*, never guessed — [references/ant-baseline.md](references/ant-baseline.md) for the contract (derived Cobalt ramp, the deliberate deviations from stock Ant, measured WCAG verdicts, posture rules, the theme-owns-vs-form-owns line), and [references/ant-tokens.md](references/ant-tokens.md) as the dictionary for one specific value (all 72 components; look up, don't read end to end).

Two consequences that catch every pass: **`#1890FF` and `#1677FF` are always wrong** (unthemed Ant v4, and the v6 default Cobalt replaces — either one means the theme was bypassed); and **control-level appearance is theme-owned** — button fill, input border/focus ring, table header tint, control height, base radius come from `$antdTheme` and are never re-declared per component. v7 blocks carry *composition* (page ground, surfaces, header strips, rails, density, chips), which [R-042] requires — not control appearance.

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
| **Ant 6.3.5 baseline + WCAG + theme-vs-form line** | [references/ant-baseline.md](references/ant-baseline.md) |
| Ant token dictionary (72 components — lookup only) | [references/ant-tokens.md](references/ant-tokens.md) |
| App-level Ant theme | [references/app-theme.md](references/app-theme.md) |
| Per-component recipes | [references/component-recipes.md](references/component-recipes.md) |
| Token → prop resolution | [references/token-to-prop-mapping.md](references/token-to-prop-mapping.md) |
| v7 blocks + channels + debug | [references/styling-mechanics.md](references/styling-mechanics.md) |
| Capability (measured + annotations) | [references/capability-matrix.md](references/capability-matrix.md) |
| Canonical layout anatomy | [references/default-layout-patterns.md](references/default-layout-patterns.md) |
| Default no-design quick pass | [references/default-theme-quickpass.md](references/default-theme-quickpass.md) |
| Design conventions | [references/shesha-design-standards.md](references/shesha-design-standards.md) |
| Appearance grading | [references/appearance-quality.md](references/appearance-quality.md) |

| Concern | Skill |
|---|---|
| Ingest design, plan, orchestrate, verify | `shesha-developer:shesha-claude-designer` |
| Design → measured blueprint + placement verify | `shesha-developer:shesha-design-comprehension` |
| Build structure, CRUD, gates, push | `shesha-developer:shesha-form-edit` |
| **Tokens → app theme + v7 style blocks** | **this skill** |
