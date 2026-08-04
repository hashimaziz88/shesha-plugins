# Styling mechanics — v7 blocks, the five channels, and why a prop doesn't render

The 0.45 style system this skill authors against. Block shapes + patterns first; then the channel/precedence model and the debug procedure. Capability verdicts (which channel actually renders per component) are in [capability-matrix.md](capability-matrix.md). Layout/structure idioms live in `shesha-form-edit` — this skill owns appearance only. Appearance goes through the breakpoint blocks [R-030]; rule ids cite `shesha-form-edit/references/_rules.json`.

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
- **`text` components are the exception — `desktop.font.color` is a measured NO-OP on them.** `fontSize` (Tailwind class string, `"text-xs"`) + `fontWeight` are direct props and do work. **Colour needs three levers together:** `textType:"paragraph"` (with no `textType` the component renders `<h1 class="ant-typography">` and AntD's h1 rule overrides both size and colour, silently) + `contentType:"custom"` (colour is locked otherwise) + the colour in a **top-level `font` object**, not the `desktop.font` block that every other v7 component uses. Alignment is `desktop.font.align` — the top-level `textAlign` prop is in the schema and dead. `textTransform`/`letterSpacing` have **no working lever at all** — type the text uppercase in `content` instead. Full account: `shesha-form-edit/references/renderer-physics.md`.

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

**Stacking inside a horizontal parent needs an extra wrapper level** [R-051]. Shesha's flex-row CSS is a **descendant** selector, not direct-child: once ANY ancestor is horizontal, every nested container's inner div is forced to `row`+`wrap` no matter what its own `flexDirection`/`direction` says. A label-over-value stack inside a horizontal card renders side-by-side with zero errors. The only fix is an extra `width:100%` wrapper around each child that needs its own line — **one added nesting level per stacked child**. Plan that level into the block up front (KIB cells, rail label/value rows, card meta strips all need it); no prop substitutes for it.

**Buttons are colour-locked outside the app theme** [R-053]. `buttonGroup` items have no per-item colour and no per-item enable/disable — one shared `buttonType` for the group — and wrapping a single-item `buttonGroup` in a coloured container does *not* tint the button (the wrapper stays transparent). Standalone `button` and `buttonGroup` items also render in different wrappers at different default heights, so mixing them in one row misaligns in a way no style fixes. Route action colour through the app theme's `Button` tokens, keep one kind of button component per row, and route the rest to `shesha-form-edit` — this is structure, not appearance. Detail: `shesha-form-edit/references/renderer-physics.md` §Composition gaps.

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

1. **Component `version`** — does it match what's live? A style block on a version-mismatched component is a **total no-op with no error** [R-003]. Cheapest check, and it invalidates every other hypothesis; do it first.
2. **Legacy `style` string** — truthy `style`/`desktop.style` on the component or ANY ancestor? (inline wins; grep this next)
3. **Breakpoint override** — a different value for the same key in `desktop`/`tablet`/`mobile`?
4. **Framework class** — a `className` injecting/blocking the style (check computed styles)?
5. **Channel→div mapping** — prop landing on the inner div when the constraint is on the outer flex item?
6. **enableStyleOnReadonly** — readonly/Live with `false`?
7. **A measured no-op** — is the channel known-inert on this component? Check `assets/capability-matrix.json` + the measured matrix before a third attempt (`desktop.font.color` on `text`, `customStyle:{flex}`, per-item colour on `buttonGroup`, `background.type:"image"` from a URL). If it's measured inert, no amount of restamping will work — change approach.
8. **An ancestor is horizontal** — a stack rendering side-by-side is the descendant flex-row selector, not your `flexDirection`. Needs a `width:100%` wrapper per child.
9. Verify with `getBoundingClientRect`/`getComputedStyle`, **not screenshots** (scaled screenshots fake 10–15px offsets that are really 0).
10. Clear the FE IndexedDB form cache from a static page before re-testing — see `shesha-form-edit/references/verification.md`.

**Worked case (channel 4):** a detail-form header band had `alignItems:"stretch"` stamped on base + all breakpoints yet rendered `flex-start` with mystery padding; the stylingBox audit showed it clean. Cause: a legacy `style` string (`"return { padding: '10px 0px 10px 25px', alignItems: 'flex-start' }"`) on the band, plus a wrapper `style` blocking vertical stretch — the template form had `style: null` on the same containers. Fix: null `style` on base + all breakpoints and re-express as designer props; `style` strings identical across all forms including the template can stay.
