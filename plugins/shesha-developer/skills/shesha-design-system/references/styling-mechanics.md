# Styling mechanics — v7 blocks, the five channels, and why a prop doesn't render

The 0.45 style system this skill authors against. Block shapes + patterns first; then the channel/precedence model and the debug procedure. Capability verdicts (which channel actually renders per component) are in [capability-matrix.md](capability-matrix.md). Layout/structure idioms live in `shesha-form-edit` — this skill owns appearance only. Appearance goes through the breakpoint blocks [R-030]; rule ids cite `shesha-form-edit/references/_rules.json`.

## Contents
1. v6 vs v7
2. Full v7 style block
3. Common surface patterns
4. The five style channels
5. Channel→div mapping
6. Stamping rules
7. Debug checklist

## v6 vs v7

| | v6 | v7 |
|---|---|---|
| How styled | `"style": "return { backgroundColor: '#fff', … }"` | `"desktop": { "background": {…}, "border": {…}, … }` |
| Breakpoints | single style | separate `desktop` / `tablet` / `mobile` keys |
| Version field | 1–6 | 7+ |

Apply the same block to all three breakpoints unless the design is genuinely responsive. Migrating v6→v7: bump `version` to 7; null the `style` string on base + all breakpoints; re-express keys as blocks (`backgroundColor`→`background.color`, `borderRadius`→`border.radius.all`, `boxShadow`→`shadow.*`, margins/paddings→`stylingBox`); drop `shadowStyle`.

## Full v7 style block

```json
{
  "border": {
    "hideBorder": false, "radiusType": "all", "borderType": "all",
    "border": { "all": { "width": 1, "color": "#e5e7eb", "style": "solid" }, "top": {}, "bottom": {}, "left": {}, "right": {} },
    "radius": { "all": 12 }
  },
  "background": { "type": "color", "color": "#ffffff", "repeat": "no-repeat", "size": "auto", "position": "center",
    "gradient": { "direction": "to right", "colors": {} }, "url": "", "storedFile": { "id": null }, "uploadFile": null },
  "font": { "color": "#1a1a1a", "type": "Segoe UI", "align": "left", "size": 14, "weight": "400" },
  "dimensions": { "width": "100%", "height": "auto", "minHeight": "0px", "maxHeight": "auto", "minWidth": "0px", "maxWidth": "100%" },
  "shadow": { "offsetX": 0, "offsetY": 1, "color": "rgba(0,0,0,0.06)", "blurRadius": 4, "spreadRadius": 0 },
  "stylingBox": "{\"paddingTop\":\"24\",\"paddingBottom\":\"24\",\"paddingLeft\":\"32\",\"paddingRight\":\"32\"}",
  "enableStyleOnReadonly": false,
  "flexDirection": "column", "direction": "vertical", "justifyContent": "flex-start",
  "alignItems": "stretch", "flexWrap": "nowrap", "gap": "0", "overflow": true
}
```

- **`stylingBox` is a JSON-string** (values quoted even for numbers). ONLY margin/padding keys — never `textTransform`, `color`, or other CSS. Negative padding (`"paddingTop":"-30"`) is invalid CSS — silently dropped.
- **Per-side borders:** set `borderType: "custom"`; per-side entries then take precedence, `all` is the fallback, empty `{}` = no border that side.
- **`enableStyleOnReadonly: false` silently disables padding/background in readonly/Live mode** — looks fine in the designer, vanishes live. Set `true` (or leave undefined) on any container whose styling must persist.
- **`text` components:** `fontSize` (Tailwind class string, `"text-xs"`) + `fontWeight` are direct props; **colour** goes in `desktop.font.color` (a number size lives there too — set both prop and block for consistency).

## Common surface patterns

```jsonc
// White card sub-container
"border": { "borderType":"all", "border": { "all": { "width":1, "color":"#e5e7eb", "style":"solid" } }, "radius": { "all": 8 } },
"background": { "type":"color", "color":"#ffffff" },
"shadow": { "offsetX":0, "offsetY":1, "color":"rgba(0,0,0,0.05)", "blurRadius":3, "spreadRadius":0 },
"stylingBox": "{\"paddingTop\":\"12\",\"paddingBottom\":\"12\",\"paddingLeft\":\"16\",\"paddingRight\":\"16\"}"

// Tinted header strip (full-bleed — root container needs pt/pl/pr = 0 so it spans the card)
"background": { "type":"color", "color":"#f8fafc" },
"border": { "borderType":"custom", "border": { "all": { "style":"none" }, "bottom": { "width":1, "color":"#e5e7eb", "style":"solid" } } }

// Left accent (branded title container)
"border": { "borderType":"custom", "border": { "all": { "style":"none" }, "left": { "width":4, "color":"<accent>", "style":"solid" } } }

// Toolbar row
"direction":"horizontal", "justifyContent":"flex-end", "alignItems":"center", "gap":"8",
"border": { "borderType":"custom", "border": { "top": { "width":1, "color":"#e5e7eb", "style":"solid" }, "bottom": { "width":1, "color":"#f0f0f0", "style":"solid" } } }
```

**Full-width child recipe:** a single child sizes to content, and the v7 renderer ignores legacy `direction:"vertical"` — make the parent `{ "flexDirection": "column", "display": "flex", "alignItems": "stretch" }` [R-029] (verified: turns a 700px list full-width). Set it up front for any "stretch across the page" request; don't rediscover it in a browser loop.

**Text escaping:** the `text` component renders `content` via Mustache — `{{double}}` HTML-escapes (`2023/11/17` → `2023&#x2F;11&#x2F;17`); use `{{{triple}}}` for raw output [R-035] (and don't stack a `date-time` dataType on top — double-renders).

## The five style channels (lowest → highest)

| # | Channel | Shape | Wins over |
|---|---|---|---|
| 1 | Designer props | top-level `alignItems`, `display`, `background`, `border`, `font`, `shadow`, `dimensions`, … | — (base) |
| 2 | `stylingBox` | JSON string of margins/paddings | merges with 1 |
| 3 | Breakpoint objects `desktop`/`tablet`/`mobile` | same keys, nested | overrides base **PER-KEY** |
| 4 | Legacy `style` prop | JS-expression STRING → rendered **INLINE** | wins over everything [R-030] |
| 5 | Framework CSS via `className` | `sha-page`, `.sha-page-content:not(.no-padding){padding:12px}`, `sha-index-table-control` | applies regardless; some `!important` |

- Channel 3 is per-key: base `border.radius=0` is dead if the breakpoints carry `radius=8`; base `borderType:"custom"` is dead if `desktop.border.borderType:"all"`.
- Channel 4 can also live *inside* breakpoints (`desktop.style`) — check both.
- Channel 5 cuts both ways: escape `.sha-page-content` padding by appending ` no-padding` to `className` on base AND every breakpoint; but `sha-index-table-control` *provides* the toolbar inset aligning quick-search to the datatable — don't remove it.

## Channel→div mapping

A container renders **TWO divs** [R-032]: the outer (`sha-components-container`, the actual flex item) receives ONLY `dimensions` (+ `shadow`); the inner gets the legacy `style` string + layout props. Consequence: a `style`-channel `flexShrink:0` renders on the inner div but **cannot stop flex squeeze** — sizing fixes must go through `dimensions`:

```json
"dimensions": { "minHeight": "fit-content", "height": "auto", "maxHeight": "auto" }
```

stamped on base + every breakpoint of each squeezed container.

**Hard-coded overflow:** every v7 container's inner div is ALWAYS `overflow:auto` (the markup `overflow` prop is a no-op in view mode). A scrollbar means content exceeds the box — in a stretched flex row that's flex-shrink squeeze (every Shesha form-item adds 5px top/bottom margins, so content is always taller than it looks). Fix via `dimensions`, never `overflow`.

## Stamping rules

- Every style fix goes on **base AND every breakpoint object that exists** — breakpoint-only values are invisible in a base-level audit and resurface at render.
- Any style audit sweeps **all five channels** — a `stylingBox` audit can show a band clean while `style` carries the offending padding.
- Transplanting from a template: clone whole style objects, overwrite ONLY style keys (`direction`/`flex*`/`display`/`justify*`/`align*`/`gap`/`dimensions`/`border`/`background`/`font`/`shadow`/`stylingBox`/breakpoints/`className`/`style`); preserve ids, names, versions, bindings.
- Never build dividers as standalone components — an empty border-only container collapses to 0×0, and a `sectionSeparator` divider needs a hard-coded `lineHeight` that drags the row taller. Correct: row `alignItems:"stretch"`, columns `alignSelf:"stretch"`, `gap:0`, `flexWrap:"nowrap"`, height caps `"auto"`, columns 2+ carry `borderType:"custom"` + left border `1px solid #d9d9d9` on base + every breakpoint — flush by construction.

## Debug checklist — when a prop doesn't render (run in order, stop at first hit)

1. **Legacy `style` string** — truthy `style`/`desktop.style` on the component or ANY ancestor? (inline wins; grep this FIRST)
2. **Breakpoint override** — a different value for the same key in `desktop`/`tablet`/`mobile`?
3. **Framework class** — a `className` injecting/blocking the style (check computed styles)?
4. **Channel→div mapping** — prop landing on the inner div when the constraint is on the outer flex item?
5. **enableStyleOnReadonly** — readonly/Live with `false`?
6. Verify with `getBoundingClientRect`/`getComputedStyle`, **not screenshots** (scaled screenshots fake 10–15px offsets that are really 0).
7. Clear the frontend form cache before re-testing [R-056] — `shesha-form-edit/references/verification.md` §2.

**Worked case (channel 4):** a detail-form header band had `alignItems:"stretch"` stamped on base + all breakpoints yet rendered `flex-start` with mystery padding; the stylingBox audit showed it clean. Cause: a legacy `style` string (`"return { padding: '10px 0px 10px 25px', alignItems: 'flex-start' }"`) on the band, plus a wrapper `style` blocking vertical stretch — the template form had `style: null` on the same containers. Fix: null `style` on base + all breakpoints and re-express as designer props; `style` strings identical across all forms including the template can stay.
