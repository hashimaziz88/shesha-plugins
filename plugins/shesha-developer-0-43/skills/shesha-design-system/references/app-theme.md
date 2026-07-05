# Applying the app-level theme (set once per project)

The first of the two styling layers. Set the brand primary, base font and base radius (plus semantic + neutral colours) at the **application theme** so the whole portal inherits them — then per-component blocks only handle what the global theme can't express.

## Mechanism (Shesha)

The app theme is the `Shesha.ThemeSettings` setting (Ant Design `ConfigProvider` tokens). 0.43 has **no Configuration Studio** — set it via the **legacy `/settings` theme editor** (Settings → Default UI → theme settings in the legacy admin area), or via the settings REST API directly. It is **client-specific** — when writing via API, send the `sha-frontend-application: default-app` header and supply the value as an OBJECT (not a JSON string). Map the brand tokens onto AntD 6.x token names per [shesha-design-standards.md](shesha-design-standards.md) (colorPrimary/…/semantic/neutral/type/shape).

> Do NOT edit `ConfigProvider`/app-provider/layout or any Shesha frontend source for theming — theme only through the legacy `/settings` theme editor / the settings API. (The shipped theme settings cover colours + sidebar; there is no font field in the editor — set font via the token object if needed.)

## When to apply vs skip

- **Apply** when establishing a brand, or when the complaint is "buttons/links/active states are the wrong colour" (that's the app theme, not per-component blocks).
- **Skip** only for a one-off single-form tweak where the app theme is already correct.

## Verify

Check in the running app: a primary button, a link, an active tab ink-bar and a focus ring should all be the brand primary; the page background should be the brand canvas; base radius on inputs should match. Clear the IndexedDB cache (`/favicon.ico`) after changing theme settings so the frontend re-reads them.
