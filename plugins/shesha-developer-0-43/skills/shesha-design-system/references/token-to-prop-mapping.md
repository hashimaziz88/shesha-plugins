# Token → Shesha prop mapping

How a brand token (from `<brand>.tokens.json`) becomes an exact Shesha value. Resolve `roles.*` first (role → token path), then map.

| Token | Where it goes |
|---|---|
| `brand.primary` | **App theme** `colorPrimary` (buttons, links, active tab ink-bar, focus ring) — set once, do NOT set per-button |
| `brand.primaryHover` / `primaryActive` | App theme `colorPrimaryHover` / `colorPrimaryActive` |
| `brand.primary` (section headings) | text component `fontColor` / `desktop.font.color` on section-header text |
| `surfaces.canvas` | App theme `colorBgLayout`; page root container `desktop.background.color` |
| `surfaces.surface` (white) | card container `desktop.background.color` = `#ffffff` |
| `surfaces.surfaceAlt` | card **header strip** background |
| `surfaces.surfaceMuted` | read-only field background |
| `lines.border` / `borderStrong` / `divider` | `desktop.border.border.all.color` (hairline / input / row+section divider); per-side needs `border.borderType:"custom"` |
| `ink.primary` / `muted` / `soft` | text `desktop.font.color` (body / secondary / helper+placeholder) |
| `type.scale.*` | `desktop.font.size` (or text component `fontSize` Tailwind class); title 24, section 20/header 16, body 14, micro 12 |
| `type.weights.semibold` (600) | `fontWeight` on headings/labels; body stays 400 |
| `spacing.*` | `stylingBox` (JSON string) padding/margin keys; field gap 16, section gap 24, card pad 16/24 |
| `radius.md` (6) | controls `desktop.border.radius.all`; App theme `borderRadius` |
| `radius.lg` (8–12) | cards `desktop.border.radius.all`; App theme `borderRadiusLG` |
| `shadow.card` | `desktop.shadow {offsetX:0, offsetY:1, blurRadius:4, spreadRadius:0, color}` on **every card/panel** (the live app renders `0 1 4 rgba(0,0,0,0.06)`) — paired with the hairline border |
| `shadow.overlay` | `desktop.shadow` on **floating surfaces only** — modals, popovers, dropdown menus |
| `statusLifecycle.badges.<status>` | `refListStatus` component colours per item (bg/fg/border) — see component-recipes status-chip |

**Worked micro-example — card with header strip:** container (`background.color`=surface, `border.all.color`=lines.border, `border.radius.all`=radius.lg) → header text (fontColor=brand.primary, fontWeight=600, fontSize=cardHeader) on a child whose `background.color`=surfaceAlt with a bottom `border` hairline → body container `stylingBox` padding 16.
