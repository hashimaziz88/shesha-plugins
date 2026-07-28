# Shesha design standards (brand-agnostic)

General conventions for how Shesha (Ant Design 6.x, light-mode) applications should be designed and styled — distilled from the Shesha Design System reference (A. Slavchov, Senior UI/UX). These are the *standards* the styling layer applies; they hold **regardless of brand**. A brand's concrete hex/type values live in its `*.tokens.json` — the shipped **default `shesha.tokens.json`**, or a custom brand like `requirements-studio.tokens.json` — not here.

## The bar — consulting-grade, not merely compliant

**Every screen aims at the fidelity of a production C-suite deliverable** — the standard of a McKinsey or Deloitte engagement artefact: something you could put in front of an executive committee without apologising for it. The rules further down are how; this is what "good" means when they are all satisfied and the page still looks amateur.

The distinction is *restraint plus hierarchy*, not decoration. Consulting-grade work is quiet: it earns attention through structure, alignment and typography rather than colour and ornament. Concretely, and each of these is judgeable from a screenshot:

- **One thing is clearly most important per view.** The eye lands on the primary value, record identity or action first — achieved by size and weight, never by making several things loud. A page where everything competes has no hierarchy.
- **Colour is an accent, never a surface.** Brand primary marks the single interactive anchor per zone; semantic colour appears only as operational status. Hierarchy is carried by ink shade and weight. Wide bands of saturated brand colour read as a template, not a deliverable.
- **Alignment is exact.** Every element sits on the 4px grid; labels, field edges and the right edge of a table's toolbar all line up. Numbers are right-aligned with consistent decimals and units. A 3px misalignment is the single most common tell of unfinished work.
- **Density matches the audience.** An executive summary view aggregates and rounds; an operational worklist enumerates. Do not put 40 raw columns in front of a committee, and do not hide the detail an operator needs behind a summary.
- **Nothing is orphaned.** Every number carries a label and a unit; every abbreviation is expanded on first use; every status chip pairs colour with a word. A bare figure on a card is a defect, however well styled.
- **The unglamorous states are designed.** Empty, loading, partial-permission and error states are part of the deliverable. A polished happy path with a default "No Data" scrawl fails the bar.
- **It reads as one system.** Card treatment, header rhythm, chip shape and control height are identical across screens. Two screens that were clearly styled separately fail even if each is individually attractive.

**Judged, not asserted.** The `shesha-design-critic` agent scores exactly this from the rendered screenshot and returns `styled ∈ excellent | acceptable | default-antd | broken` — `acceptable` means the bar's non-negotiables hold (hierarchy, alignment, restrained colour, labelled data), `excellent` means it is fully realised. A build is not done below `acceptable`. What a script can check mechanically is only the floor — `scripts/validate-styledness.js` catches structure-only and default-AntD output — so the floor passing is not the bar being met.

**Scope note.** This is the target for standard Shesha screens. A deliberately bespoke visual (a marketing landing page, a one-off dashboard) routes to `shesha-custom-page-designer`, which is allowed to deviate — but "bespoke" is not licence for lower fidelity.

## Foundations

- **Light mode only.** No dark mode.
- **Type — scale by surface, weight by role.** Dense data-entry (form fields, table cells, attribute rows) uses **14px**; for other surfaces pick the scale token that matches the role — 12 caption, 16 card heading, 18 hero/summary value, 20 section heading, 24 page title. Don't flatten everything to 14, and don't inflate dense data-entry past 14. **Weight by role:** body / values **400**; field labels, card & section headers **600**; micro-labels, status-chip text, table-cell emphasis **500**; **700** only where the design's title is genuinely bold. (All four live in the brand `type.weights` — use the token, don't invent a weight.) Never pure black for text — use the brand's near-black ink.
- **Surface elevation — border-forward; shadow is a brand decision.** Every white card/panel always carries a hairline 1px border (`lines.border`) on all breakpoints. Whether it *also* carries a shadow is read from the brand's `shadow.card` token, not assumed: some brands are **border-forward** and render cards essentially flat — the **Shesha default** does this (`shadow.card` is a whisper `0 1px 4px rgba(0,0,0,0.08)` or `none`; structure comes from the line, not the shadow) — while others pair the hairline with a visible `desktop.shadow {offsetX:0, offsetY:1, blurRadius:2–4, spreadRadius:0, color:…}`. Reserve the heavier `shadow.overlay` for floating surfaces only (modals, popovers, dropdown menus). Rows separate with hairlines (`lines.divider`). Never rely on a shadow *instead of* a border, and never use heavy/decorative shadows.
- **Surface proportion:** the dominant surface is the muted page canvas (~30%), with white cards on top — most of a page is *not* white. Brand-primary is the single interactive anchor (CTAs, links, active states, focus rings); deep/navy or dark-brand adds chrome depth.
- **4px spacing grid:** 4/8/12/16/20/24/32/40/48. Field gap 16px vertical; 24px between sections; card padding 16 (compact) / 24 (default).
- **Radius:** ~6px for controls (buttons/inputs/selects), ~8–12px for cards/panels, pill for status badges.

## AntD 6.x token mapping (set ONCE at app level)

Map the brand tokens onto `ConfigProvider theme.token` so the whole portal inherits them — do **not** repaint every button per-form:
`colorPrimary / colorPrimaryHover / colorPrimaryActive / colorPrimaryBg`, the semantic set (`colorSuccess/Warning/Error/Info` + their `Bg/Border`), neutrals (`colorText/TextSecondary/TextTertiary`, `colorBgLayout` = canvas, `colorBgContainer` = white, `colorBorder/colorBorderSecondary`), type (`fontFamily/fontSize=14/fontSizeLG=16/...`, `fontWeightStrong=600`, line-heights), shape (`borderRadius=6/LG=8`, `controlHeight=32/SM=24/LG=40`), and per-component overrides for `Button/Input/Select/Table/Card/Tabs/Menu/Steps`. In Shesha this is the app-level theme settings — see [app-theme.md](app-theme.md). A form looks "cheap" when only per-component blocks are set (AntD primary still default blue) or only the app theme is set (no surface/card treatment) — apply **both** layers.

## Component conventions

- **Buttons:** primary = brand fill, white 600 text, radius 6; default = white, hairline border, brand-coloured border/text on hover; danger = error fill; ghost/link = transparent, brand text. Sizes 24/32/40.
- **Inputs/Select/Date:** white bg, 1px border, radius 6, 4×12 padding, 14px; focus = brand border + 4px focus ring; error = error border + error ring; disabled = canvas bg + tertiary text. Label 14/600, required asterisk in error colour, helper 12px, validation 12px error.
- **Cards/Panels:** white bg, hairline border, radius 8–12, **plus the brand card shadow only if the brand defines one** (the Shesha default is border-forward — flat; see Surface elevation); panel header on the alt surface with a bottom hairline, 12×16 padding, 14/600; body 16 padding.
- **Data table:** header row on the alt surface, 14/600, 2px bottom border; body rows white with 1px row borders; row hover = brand-tint; selected = brand-subtle; cell 14/400, 12×16 padding.
- **Status badges/pills:** pill radius, 12px/500, 2×8 padding; colour from the **status lifecycle** in the brand tokens (bg/fg/border per status). Always pair colour with a text label — never colour alone.
- **Tabs:** inactive 14/400 secondary; active = brand text + 2px brand ink-bar.
- **Section separators / micro-labels:** uppercase 11–12/600 tertiary, letter-spacing ~0.06em.
- **Alerts/banners:** tinted bg + 4px left border in the semantic colour + matching icon.

## Voice & copy

- Labels in **sentence case** ("First name", not "First Name"). Actions verb-first ("Save changes", not "OK"). Validation specific ("Enter a valid email address"). Mark **required** with an asterisk; never mark optional. Placeholders are examples ("e.g. …"), not instructions, and never replace a label.

## Anti-patterns (never)

- Pure black `#000` text; inventing weights outside the brand `type.weights`; body >14px in **dense data entry** (larger scale tokens on reading surfaces — titles, headers, hero values — are correct, not an anti-pattern).
- **Heavy / decorative** drop shadows — large blurry shadows that don't match the brand token scale. (A card's subtle elevation shadow from the brand `shadow` token is expected and correct; only oversized/decorative shadows are banned.)
- Using a brand's accent/semantic colours decoratively — semantic colours are operational status signals only.
- Placeholder used as a label; removing focus rings (never strip focus indicators).
- Colour alone to convey status (always pair with icon/text).

## How the compiler uses this

These standards are realised at compile time. A blueprint's node `kind` and its `archetype`
select the shape; `scripts/resolve-style-plan.mjs` resolves the brand into concrete values;
the compiler bakes them in. There is no `recipe:` annotation channel — the blueprint schema
is closed (`additionalProperties: false` per kind), so an extra key is a validation error
rather than a hint for a later pass.

For a form the compiler did **not** produce — a hand-composed form, or a small edit to a live
one — apply these standards directly via [component-recipes.md](component-recipes.md) and
[token-to-prop-mapping.md](token-to-prop-mapping.md).
