# Applying the app-level theme (set once per project)

The first of the two styling layers. Set the brand primary, base font and base radius (plus semantic + neutral colours) at the **application theme** so the whole portal inherits them — then per-component blocks only handle what the global theme can't express.

## Mechanism (Shesha)

The app theme is the `Shesha.ThemeSettings` setting (Ant Design `ConfigProvider` tokens). Set it via **Configuration Studio → Settings → Default UI → Frontend → Theme settings**, or via the settings API. It is **client-specific** — when writing via API, send the `sha-frontend-application: default-app` header and supply the value as an OBJECT (not a JSON string). Map the brand tokens onto AntD 6.x token names per [shesha-design-standards.md](shesha-design-standards.md) (colorPrimary/…/semantic/neutral/type/shape).

> Do NOT edit `ConfigProvider`/app-provider/layout or any Shesha frontend source for theming — theme only through the Configuration Studio / settings API. (The shipped theme settings cover colours + sidebar; there is no font field in the editor — set font via the token object if needed.)

> App-level delivery has no `token`/`components` channel at all — only the legacy six-colour set plus layout/text roles reach `IConfigurableTheme`; `processingColor`, `text.link`, and any `token`/`components` block are silently dropped on write [R-051]. Carry that styling per-component at compile time instead.

## When to apply vs skip

- **Apply** when establishing a brand, or when the complaint is "buttons/links/active states are the wrong colour" (that's the app theme, not per-component blocks).
- **Skip** only for a one-off single-form tweak where the app theme is already correct.

## Verify

Check in the running app: a primary button, a link, an active tab ink-bar and a focus ring should all be the brand primary; the page background should be the brand canvas; base radius on inputs should match. Clear the IndexedDB cache (`/favicon.ico`) after changing theme settings so the frontend re-reads them.
