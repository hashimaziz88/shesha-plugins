# Default layout patterns — the Shesha build style

The measured component/layout anatomy every Shesha form is built to **by default** — extracted from the canonical Claude-designed prototypes (Requirements Studio + Asset Management System). This is the *structure and density* language; colours come from the active brand token file (`assets/themes/<brand>.tokens.json`) via the neutral roles used below (canvas / surface / surface-alt / hairline / divider / ink / ink-muted / ink-soft / primary / tint). **Layout values here are brand-independent — they do not change when the brand does.**

Used by: `default-theme-quickpass.md` (the values behind the quick pass), `shesha-claude-designer` (default archetype vocabulary when interpreting designs), and `shesha-form-edit`'s construction rules (label placement, action rows, section grouping).

## Contents
1. Spacing, type, borders (the system)
2. Page anatomy
3. Tables
4. Item lists
5. Cards / panels
6. Forms
7. Detail pages
8. Buttons & controls
9. Chips / badges / status
10. Modals
11. The "clean lines" rules

## 1. Spacing, type, borders

- **4px base unit.** Workhorse gaps: 8 intra-control · 14–16 between fields/cards · 24 main↔rail · 28 page side padding.
- **Type scale** (system-ui; mono for IDs/codes/amounts): 10.5–11.5 uppercase eyebrows (600–700, letter-spacing 0.04–0.06em) · 12–12.5 meta · 13–13.5 dense body/tables/toolbars · 14 body/buttons/inputs/tabs · 15 card titles · 16 modal/section titles · 22–24 page titles (ls −0.01em) · 28 KPI values (600–700, ls −0.02em). Weights 400/500/600 — **600 is the emphasis default; emphasis = primary colour + 600, never bigger text**.
- **Borders, three tiers, all 1px**: *hairline* (outer card/table edges) · *divider* (inner rows/sections, lighter) · *strong* (inputs only, slightly darker so controls read against chrome). 2px only for tab indicators.
- **Radius scale**: controls (buttons/inputs) take the brand's `$antdTheme.borderRadius` (**6** in the default `shesha` tokens — the token file wins over the mockups here) · 8 cards/search · 10–12 pills/badges · 9999 tags/toggles. Cards are radius **8**.
- **No shadows on cards/tables** — flat surfaces with hairlines on the canvas. Shadow (`0 8px 24px rgba(15,23,42,0.18)`) is reserved for floating layers: menus, modals, toasts.

## 2. Page anatomy

- Page padding **28px sides** (32 on wide detail pages), 20–24 top, 48+ bottom. Content is full-bleed fluid — no max-width.
- Vertical rhythm between page sections: **16px**; section titles get margin-bottom 14.
- **Page-title band**: h1 22–24/600 ink (+ inline status pills on detail pages, gap 12); subtitle 13–14 ink-soft margin-top 4–6; actions right-aligned in the same flex row (`space-between`). List pages: in-canvas heading, margin-bottom 20–22. Detail pages: a **surface strip** with 1px hairline bottom, padding 14px 28px 16px, optional 13px breadcrumb above (current crumb 600 ink, ancestors 500 ink-soft).

## 3. Tables (`datatable` inside its card)

- Container: surface, 1px hairline, **radius 8, overflow hidden**, no shadow.
- **Header row: 44px, surface-alt bg, 1px divider bottom, 11.5–12px / 600 / UPPERCASE / letter-spacing 0.04em / ink-muted, nowrap.**
- Body rows: **44px default** (cell padding 10px 14px); go ≥54px only when rows carry pills/two-line content. Cell text 13–13.5 ink; secondary columns ink-muted; numeric right-aligned + 600; IDs mono 12 primary 600.
- Separation: **1px divider between rows only** — no zebra striping, no column rules. Hover = surface-alt/faint tint; selected = tint.
- Alignment: text left · counts/dates center · money right. Ellipsis + nowrap on overflow.
- **Row actions: anchored LEFT** — the action column (view/edit icon buttons, 28px, gap 2) is the FIRST column, `anchored: "left"`, width 35–50px. This is the Shesha default (the canonical seeds already do it); it deviates deliberately from the mockups' row-end placement.
- **Everything on the far right of a table's header zone aligns flush with the table's right edge** — toolbar buttons (Refresh, column toggle, Add), alerts/notices, count labels ("1–50 of 5,221"), and pagination all share one right edge: the table's. Mechanics (browser-verified 2026-07-05): the toolbar-row container (the one carrying `className:"sha-index-toolbar"`) needs `justifyContent:"flex-end"` (or `"space-between"` with a left search/filter cluster) **plus its inner div forced to full width** via `desktop.dimensions.width:"100%"`. `justifyContent` without an explicit `display:"flex"` is inert. Nothing in the header zone overhangs or falls short of the table edge. The canonical table seeds carry this recipe.
- **Toolbar above the table**: quick-search 240–280px wide at the token `controlHeight`, radius 6, magnifier inside-left; filter selects at `controlHeight`; count label 13 ink-soft ("1–50 of 5,221"); **Add is a ghost text button** (primary text 14/600 + plus icon, hover tint bg) — not a large solid button. Pagination = inline 30×30 radius-6 number squares top-right beside the count (active = tint bg + primary 600).
- Empty state: centered padding 40–48px; 36px ink-soft icon; 15/600 ink-muted title; 13 ink-soft hint.

## 4. Item lists (`datalist` row templates)

- **Card list** (rich rows): stack gap 14; each card = surface, hairline, radius 8, **padding 18px 20px**; leading **64×64 radius-8 tint tile** with a primary icon, gap 18 to content. Title row: name 15/600 ink + status pill (gap 10); meta line mono 12 ink-soft margin-top 3. Meta grid margin-top 12, gap 22: **uppercase 10.5–11px/600 ink-soft label over 13px ink value** (gap 2). Action row margin-top 14, gap 8: one primary solid + ghost primary-text rest (token `controlHeight`); destructive ghost pushed right.
- **Row list** (compact, e.g. rail panels): rows padding 7px 8px, radius 6, **no dividers — hover tint + whitespace only**; leading 14–16px type icon + 12.5–13.5/500 name; right side = status pill + chevron.

## 5. Cards / panels

- Surface + 1px hairline + **radius 8**, no shadow; `overflow hidden` when a header strip exists. 16px between cards.
- **Header strip**: surface-alt bg, padding 12px 16–20px, 1px divider bottom; title **15/600** (brand may colour it primary), optional leading 17px icon (gap 9); right side = 28px icon buttons / count badge.
- Body padding **16–20px**.
- KPI/stat card: label 12/500–600 ink-soft; value 28/600 ink margin-top 6–8; sub-line 12 margin-top 4; optional footer split by a divider (margin-top 13 / padding-top 11). KPI rows: `repeat(4–5, 1fr)` gap 14–16.
- Grids: 2-col `1fr 1fr` gap 16; card galleries `auto-fill minmax(320px, 1fr)`.
- **Main + rail split: rail 332–340px, gap 24** (flex row per the firm rule — main `calc(100% - 356px)`).
- Active/selected card: hairline switches to primary (still 1px).

## 6. Forms

- **Label placement — two conventions, by context:**
  - **Create/edit forms and modals: labels on top** — 13/600 ink, margin-bottom 6; fields stacked **gap 14–16**.
  - **Read-only detail views: horizontal** — label column 170–200px, **right-aligned, 600 ink**, gap 16, row padding 8px 0, divider per row optional.
- Inputs: height and radius come from the brand's `$antdTheme` (**controlHeight 32, borderRadius 6** in the default `shesha` tokens — the token file wins over the mockups' 36/4), padding 0 12, 1px strong border, 14px text; **focus = border → primary (no glow ring)**; read-only bg = muted surface. Textarea padding 9px 12px.
- 2-col field grids: gutter 14–16 (flex containers, never `columns`).
- Section separation: **card-per-section with header strips** (dominant pattern) — not bare separators on a flat page.
- Helper text 12–13 ink-soft under the field.
- **Action row: right-aligned, gap 10** — Cancel/Back ghost (primary text), Submit primary solid, both at the token `controlHeight`; in modals it lives in the footer strip (§10).

## 7. Detail pages

- **Record bar**: full-width surface band, hairline bottom, padding 14–18px 28–32px — back-link 12–13 ink-soft, then h1 24/600 + status pills inline, then a mono 13 ink-soft sub-line.
- **Key-info strip (KIB)**: cells padding 0 22px separated by 1px vertical hairlines — 13/600 ink label over 13 ink-muted value (gap 6); or the flat meta-row variant: gap 28, uppercase 11/700 ink-soft label over 13.5/500 value.
- **Action bar**: own surface strip (padding 8px 32px, hairline bottom), all **ghost text buttons** at the token `controlHeight` (primary text + 16px icons, hover tint); destructive ghost far-right via spacer.
- **Tabs: underline style** — container border-bottom 1px divider; items gap 28–32, padding 13px 0, 14px, inactive 500 ink / active **600 primary with a 2px primary indicator**; content starts 22px below.
- Label:value rows in cards per §6 horizontal convention.

## 8. Buttons & controls

- Heights and radius follow the brand's `$antdTheme` (**controlHeight 32 / SM 24 / LG 40, borderRadius 6** in the default `shesha` tokens — the token file wins over the mockups' 36/34/30 at radius 4). Padding 0 16 (sm 0 12). Font 14/600. Icon 16–18, icon–label gap 7–8.
- Variants: **primary** solid; **ghost** transparent + primary text + hover tint (the default secondary — most page actions are ghosts); **neutral** surface + strong border + ink text; **danger** ghost red. Disabled = opacity 0.4. One primary per action zone.
- Icon buttons: 28/32px square, radius 4, transparent, hover divider-grey bg.
- Segmented control: surface-alt wrapper + hairline, radius 6, padding 2; active segment = surface bg + primary 600 + whisper shadow.

## 9. Chips / badges / status

- **Status pill: padding 4px 10px, radius 12 (rounded-rect, NOT a full pill), 10.5px / 600 / UPPERCASE / letter-spacing 0.04em**, tones from the brand's `statusLifecycle.badges`. Detail-header size-up: padding 5px 12px, 11–12px.
- Count badge: h20, min-width 22, radius 10, 12/600, tint bg + primary text.
- Category/type tag: full pill 9999, padding 3px 9px, 11.5/600, surface bg + hairline + coloured icon.
- Never colour-alone — the label text is the status name.

## 10. Modals

- Width **520–560px** (max 92vw), radius 8, overlay `rgba(15,23,42,0.40)`, shadow `0 8px 24px rgba(15,23,42,0.18)`.
- Header: padding 16px 20px, divider bottom, title 16/600, 28px close icon-button.
- Body: padding 20–22px, scrollable, top-label fields gap 14–16.
- **Footer: padding 14px 20px, divider top, surface-alt bg, right-aligned gap 10** — Cancel ghost + Submit primary, at the token `controlHeight`.

## 11. The "clean lines" rules (what makes it read as this style)

1. **Hairlines + background shifts do all separation** — flat white cards with 1px hairlines on a grey canvas; surface-alt marks headers/footers; shadows only float menus/modals.
2. **Two-tier borders**: outer hairline vs lighter inner divider; inputs alone get the darker strong border.
3. **Uppercase micro-eyebrows** (10.5–11.5/600–700, spaced) label every meta cluster; **mono type** flags every ID/code/amount.
4. **Alignment discipline**: fixed-width right-aligned label columns; one 14px horizontal padding module in tables; everything on the 4px grid.
5. **Emphasis = primary + 600 weight**, reusing one primary+tint pair everywhere (active tab, focused input, active rail item, card title) — never bigger text, never a second accent.
6. Density is **comfortable-dense**: 13–13.5px table body, 44px rows, token-sized controls (32px in the default `shesha` brand) — information-rich without crowding.
