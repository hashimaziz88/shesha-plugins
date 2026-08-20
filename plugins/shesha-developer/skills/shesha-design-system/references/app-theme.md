# Applying the app-level theme (set once per project)

The first of the two styling layers. Set the brand primary, base font and base radius (plus semantic + neutral colours) at the **application theme** so the whole portal inherits them — then per-component blocks only handle what the global theme can't express.

## Set expectations first: the app theme moves very little on a configured form

Measured reality, and the reason "we set the theme and it looked the same" keeps recurring: **the app theme supplies AntD defaults, and a per-component breakpoint block overrides them per key** ([style-channels.md](style-channels.md) — breakpoint objects beat base props, and a legacy `style` string beats everything). Every component an authored form ships carries explicit `desktop`/`tablet`/`mobile` values, so the theme is the *lowest*-precedence input on the page.

What the app theme actually reaches: primary-button fill, link colour, active tab ink-bar, focus ring, page canvas, base input radius. That is chrome.

What it does **not** reach, and what fidelity is actually made of: type scale, spacing rhythm, surface treatment (card background, hairline border, radius, shadow), table chrome, status-chip styling, page shell. All of that lives in per-component blocks.

**So: set the app theme once for chrome, then stop.** Do not spend a session tuning theme tokens expecting the page to transform — it won't, and that time is the single most reliably wasted hour in this pipeline. High fidelity comes from composing the pre-styled blocks, whose values are baked in from `../assets/block-styles/` + the brand tokens.

## Mechanism (Shesha)

The app theme is the `Shesha.ThemeSettings` setting (Ant Design `ConfigProvider` tokens). Set it via **Configuration Studio → Settings → Default UI → Frontend → Theme settings**, or via the settings API. It is **client-specific** — when writing via API, send the `sha-frontend-application: default-app` header and supply the value as an OBJECT (not a JSON string). Map the brand tokens onto AntD 6.x token names per [shesha-design-standards.md](shesha-design-standards.md) (colorPrimary/…/semantic/neutral/type/shape).

> Do NOT edit `ConfigProvider`/app-provider/layout or any Shesha frontend source for theming — theme only through the Configuration Studio / settings API. (The shipped theme settings cover colours + sidebar; there is no font field in the editor — set font via the token object if needed.)

## When to apply vs skip

- **Apply** when establishing a brand, or when the complaint is "buttons/links/active states are the wrong colour" (that's the app theme, not per-component blocks).
- **Skip** only for a one-off single-form tweak where the app theme is already correct.

## Verify

Check in the running app: a primary button, a link, an active tab ink-bar and a focus ring should all be the brand primary; the page background should be the brand canvas; base radius on inputs should match. Clear the IndexedDB cache (`/favicon.ico`) after changing theme settings so the frontend re-reads them.
