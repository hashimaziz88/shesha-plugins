# Per-breakpoint Component Styling System

Shesha containers (and many other components) use **per-breakpoint style blocks** (`desktop`/`tablet`/`mobile`) instead of the legacy `style` JS-expression prop. This covers the full block structure, common patterns, and migration from a legacy style-string component.

---

## Legacy style-string vs breakpoint-block

The real distinction is **NOT a version-number threshold** ("version ≥ 7 = styleable") — that is a 0.45 framing that does not hold on 0.43. On **0.43 the `container` is version 6** and it **already carries the `desktop`/`tablet`/`mobile` breakpoint blocks**. What matters is whether a component is styled by the **legacy `style` JS-string** or by **per-breakpoint blocks**:

| | Legacy style-string | Per-breakpoint blocks |
|---|---|---|
| How styled | `"style": "return { backgroundColor: '#fff', ... }"` | `"desktop": { "background": {...}, "border": {...}, ... }` |
| Breakpoints | Single style for all | Separate `desktop` / `tablet` / `mobile` keys |
| Works with | old/relic components | `container` (v6 on 0.43) + most modern components |

> **Do NOT bump a component to version 7 just to "make it styleable".** On 0.43 the live `container` is v6 and takes breakpoint blocks fine. Forcing a component to a version the running app doesn't use **re-runs the migration chain and silently drops the styling** (see [capability-matrix.md](capability-matrix.md) crux rule). **Author every component at the version the live 0.43 app uses** — probe it (`FormConfiguration/GetAll`, max version per type); the capability matrix carries fallback 0.43 integers.

Always apply the same block to all three breakpoints unless you have viewport-specific layout differences.

---

## Full breakpoint style block

```json
{
  "border": {
    "hideBorder": false,
    "radiusType": "all",
    "borderType": "all",
    "border": {
      "all": { "width": 1, "color": "#e5e7eb", "style": "solid" },
      "top": {}, "bottom": {}, "left": {}, "right": {}
    },
    "radius": { "all": 12 }
  },
  "background": {
    "type": "color",
    "color": "#ffffff",
    "repeat": "no-repeat",
    "size": "auto",
    "position": "center",
    "gradient": { "direction": "to right", "colors": {} },
    "url": "",
    "storedFile": { "id": null },
    "uploadFile": null
  },
  "font": {
    "color": "#1a1a1a",
    "type": "Segoe UI",
    "align": "left",
    "size": 14,
    "weight": "400"
  },
  "dimensions": {
    "width": "100%",
    "height": "auto",
    "minHeight": "0px",
    "maxHeight": "auto",
    "minWidth": "0px",
    "maxWidth": "100%"
  },
  "shadow": {
    "offsetX": 0,
    "offsetY": 1,
    "color": "rgba(0,0,0,0.06)",
    "blurRadius": 4,
    "spreadRadius": 0
  },
  "stylingBox": "{\"paddingTop\":\"24\",\"paddingBottom\":\"24\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}",
  "enableStyleOnReadonly": false,
  "flexDirection": "column",
  "direction": "vertical",
  "justifyContent": "flex-start",
  "alignItems": "stretch",
  "flexWrap": "nowrap",
  "gap": "0",
  "overflow": true
}
```

---

## `stylingBox` encoding

`stylingBox` is a **JSON-string** (not a nested object). Values are strings even for numbers.

```json
"stylingBox": "{\"paddingTop\":\"24\",\"marginLeft\":\"-32\"}"
```

Supported keys: `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`. These are the only keys — do NOT put `textTransform`, `color`, or other CSS in `stylingBox`.

---

## Per-side borders (`borderType: "custom"`)

To set only some sides (e.g. left accent + bottom rule):

```json
"border": {
  "hideBorder": false,
  "radiusType": "all",
  "borderType": "custom",
  "border": {
    "all": { "width": 1, "color": "#e5e7eb", "style": "none" },
    "top": {},
    "bottom": { "width": 1, "color": "#e5e7eb", "style": "solid" },
    "left": { "width": 4, "color": "#fa8c16", "style": "solid" },
    "right": {}
  },
  "radius": { "all": 0 }
}
```

- Set `borderType: "custom"` (not `"all"`) to activate per-side overrides.
- Empty `{}` on a side means "no border on that side."
- `all` acts as the fallback for sides that aren't explicitly overridden; when `borderType: "custom"`, per-side entries take precedence.

---

## Design token set (base-project-details baseline)

| Role | Value |
|---|---|
| Card surface | `#ffffff` |
| Page background | `#f3f4f6` |
| Header strip bg | `#f8fafc` |
| Section divider bg | `#f9fafb` |
| Border / divider | `#e5e7eb` |
| Light rule | `#f0f0f0` |
| Brand accent | `#fa8c16` |
| Ink (primary text) | `#111827` |
| Body text | `#1a1a1a` |
| Muted (labels) | `#6b7280` |
| Section heading | `#374151` |
| Card border radius | `12` |
| Sub-card radius | `8` |
| Card shadow | `offsetY:1, blur:4, color:rgba(0,0,0,0.06)` |
| Sub-card shadow | `offsetY:1, blur:3, color:rgba(0,0,0,0.05)` |

---

## Common patterns

### White card sub-container
```json
"border": { "borderType": "all", "border": { "all": { "width":1, "color":"#e5e7eb", "style":"solid" }, ... }, "radius": { "all": 8 } },
"background": { "type": "color", "color": "#ffffff" },
"shadow": { "offsetX":0, "offsetY":1, "color":"rgba(0,0,0,0.05)", "blurRadius":3, "spreadRadius":0 },
"stylingBox": "{\"paddingTop\":\"12\",\"paddingBottom\":\"12\",\"paddingLeft\":\"16\",\"paddingRight\":\"16\"}"
```

### Tinted header strip (full-bleed)
```json
"background": { "type": "color", "color": "#f8fafc" },
"border": { "borderType": "custom", "border": { "all": { "style": "none" }, "bottom": { "width":1, "color":"#e5e7eb", "style":"solid" }, ... } },
"stylingBox": "{\"paddingTop\":\"20\",\"paddingBottom\":\"20\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}"
```
Root container must have `pt=0, pl=0, pr=0` so header spans full card width.

### Left accent (branded title container)
```json
"border": { "borderType": "custom", "border": { "all": { "style": "none" }, "left": { "width":4, "color":"#fa8c16", "style":"solid" }, ... } },
"stylingBox": "{\"paddingLeft\":\"16\",\"paddingTop\":\"4\",\"paddingBottom\":\"4\"}"
```

### Toolbar row
```json
"background": { "type": "color", "color": "#ffffff" },
"border": { "borderType": "custom", "border": { "top": { "width":1, "color":"#e5e7eb", "style":"solid" }, "bottom": { "width":1, "color":"#f0f0f0", "style":"solid" }, ... } },
"direction": "horizontal",
"justifyContent": "flex-end",
"alignItems": "center",
"gap": "8",
"stylingBox": "{\"paddingTop\":\"12\",\"paddingBottom\":\"12\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}"
```

---

## font.color on text components

`text` components expose `fontSize` and `fontWeight` as **direct props** (not inside `desktop`). For **color**, set `desktop.font.color`:

```json
{
  "type": "text",
  "fontSize": "text-xs",
  "fontWeight": "500",
  "desktop": {
    "font": { "color": "#6b7280", "type": "Segoe UI", "size": 11, "weight": "500" }
  },
  "tablet": { "font": { ... } },
  "mobile": { "font": { ... } }
}
```

Note: `fontSize` as a direct prop uses Tailwind class strings (`"text-xs"`, `"text-2xl"`), while `desktop.font.size` is a number (`11`, `24`). Both need to be set if you want consistent rendering across all contexts.

---

## Migrating a legacy style-string component → breakpoint blocks

1. Set `version` to **the version the live 0.43 app uses for that component type** (probe it — for `container` that is **6** on 0.43, NOT 7). Do NOT bump past the live version to "unlock styling" — that re-runs the migration chain and drops the styling.
2. Remove the legacy `style` JS expression prop.
3. Add `desktop`, `tablet`, `mobile` blocks (same object for all three at first; adjust per-breakpoint later if needed).
4. Move any margin/padding values from the old `style` return into `stylingBox`.
5. Move `backgroundColor` → `background.color`, `borderRadius` → `border.radius.all`, `boxShadow` → `shadow.*`.
6. Remove `shadowStyle` if present (a legacy relic).

---

## Recipe: make a child fill its parent's full width

A single child of a container sizes to its **content** (~700px), not the parent (e.g. a
`datatableContext` inside a `sha-index-table-full` container looks narrow even though the container
is full width). The renderer **ignores the legacy `direction: "vertical"`** prop. Fix by making
the container a column flexbox that stretches its children:

```jsonc
{ "type": "container", "version": 6, "flexDirection": "column", "display": "flex",
  "alignItems": "stretch" /* version 6 = the live 0.43 container; + width 100% via desktop.dimensions if needed */ }
```

`flexDirection: "column"` + `alignItems: "stretch"` makes the child fill the parent's width.
(Verified: this turns a 700px list into a full-width one.) Set it up front for any "full width /
stretch across the page" request — don't burn a browser DOM-climbing loop rediscovering it.

## Recipe: `text` component content escaping (`{{{triple-brace}}}`)

The `text` component renders its `content` via Mustache. `{{double-brace}}` **HTML-escapes** the
value — so a date/path like `2023/11/17` renders as `2023&#x2F;11&#x2F;17`. Use **triple-brace**
`{{{creationTime}}}` for raw/unescaped output. (Don't also apply a `date-time` `dataType` on top of
triple-brace — that double-renders the value.)
