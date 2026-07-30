# Container / card / columns / tabs

Layout components. All keep `editMode: "inherited"` or omit it (no interactive surface).

---

## container

Layout wrapper. Children go in `components: []`. Direction defaults to column.

```json
{
  "id": "...",
  "type": "container",
  "label": "Personal Info",
  "direction": "vertical",
  "components": [ /* children */ ],
  "desktop": {
    "dimensions": { "width": "100%" },
    "flexDirection": "column"
  }
}
```

Per-breakpoint settings live under `desktop` / `tablet` / `mobile` keys.

Use containers as semantic divs for grouping related rows (consents block, action row, footer row). See [layout.md](layout.md) for the full house pattern.

---

## card

Shesha's card component — a bordered, rounded, optionally-shadowed white box. **Children do NOT go in `components`** — they go in `content.components`. The card has two slots:

```json
{
  "id": "...",
  "type": "card",
  "propertyName": "myCard",
  "componentName": "myCard",
  "parentId": "...",
  "header": {
    "id": "...",
    "components": []          // usually empty for full-page forms
  },
  "content": {
    "id": "...",
    "components": [ /* the actual children */ ]
  }
}
```

**Common bug**: pushing children directly onto `card.components` and watching them silently disappear from the rendered output. Walk + push always go through `card.content.components`.

When walking the tree: recurse into both `header.components` and `content.components`. When updating ids: both slots' nested `id` keys must be regenerated coherently with their children's `parentId`.

The card's outer width defaults to its parent's width. To constrain it, set `desktop.dimensions.maxWidth` on the card itself, or wrap it in a fixed-max-width inner container.

---

## columns

Two-up / three-up layouts. `columns` array has child slots:

```json
{
  "id": "...",
  "type": "columns",
  "columns": [
    { "id": "...", "flex": 12, "components": [ /* left */ ] },
    { "id": "...", "flex": 12, "components": [ /* right */ ] }
  ],
  "gutterX": 8,
  "gutterY": 8
}
```

**Total `flex` must be 24** across direct columns. (`12+12`, `8+8+8`, `6+6+6+6`, `16+8`.)

For a simple inline text + link row, prefer a sub-`container` with `flexDirection: "row"` and `alignItems: "baseline"` — wraps cleaner on narrow viewports than a `columns` does.

---

## tabs

```json
{
  "id": "...",
  "type": "tabs",
  "tabs": [
    {
      "id": "...",
      "key": "personal",
      "title": "Personal",
      "components": [ /* tab content */ ]
    },
    {
      "id": "...",
      "key": "business",
      "title": "Business",
      "components": [ /* ... */ ],
      "hidden": { "_mode": "code", "_code": "data.accountType !== 'PBF'" }
    }
  ],
  "defaultActiveKey": "personal"
}
```

Per-tab `hidden` lets you conditionally show tabs (uses the IPropertySetting wrapper — see [form-shape.md](form-shape.md)).

**Visual style:**

| Prop | Values | Effect |
|---|---|---|
| `tabType` | `"card"` / `"line"` | `card` = boxed tabs; `line` = underline style |
| `tabPosition` | `"top"` | set alongside `tabType: "line"` |

When switching to `line` style, also remove any leftover `size: "small"` prop.

---

## collapsiblePanel

Expandable/collapsible section card with a header strip and content slot.

```json
{
  "id": "...",
  "type": "collapsiblePanel",
  "componentName": "panelMySection",
  "propertyName": "panelMySection",
  "label": "My Section",
  "version": 8,
  "collapsible": "icon",
  "accent": true,
  "borderRadius": 12,
  "isDefaultExpanded": true,
  "header": { "id": "...", "components": [] },
  "content": {
    "id": "...",
    "components": [ /* section content */ ]
  }
}
```

**Key props:**
- `accent: true` — renders a branded 4px left-border strip on the panel header (colour convention: `shesha-design-system` → `component-recipes.md` → `accent-left-border`). Best visual signal for a branded section break on details pages.
- `collapsible: "icon"` — shows a chevron icon that collapses the panel. Set to `false` (boolean) to make always-open (cleaner on entity-details forms where users don't need to hide sections).
- `borderRadius: 12` — rounds the outer card corners; match the root card's radius token.
- `isDefaultExpanded: true` — ensures panel renders open on load (default; set `false` to start collapsed).

**Content slot**: children go in `content.components`, **not** `components`. Same slot rule as the `card` component.

**Walking the tree**: recurse into `content.components` (and `header.components` if you need to inject into the header strip).

---

## keyInformationBar

Stat-row component for 2–4 key facts across the top of a record page.

```json
{
  "id": "...",
  "type": "KeyInformationBar",
  "componentName": "keyinformationbarXXX",
  "version": 2,
  "columns": [
    {
      "id": "...",
      "components": [
        {
          "type": "container",
          "componentName": "containerLabelXXX",
          "components": [
            { "type": "text", "content": "Name", "fontSize": "text-xs", "fontWeight": "500",
              "desktop": { "font": { "color": "$role:mutedText", "type": "Segoe UI", "size": 11, "weight": "500" } } }
          ]
        },
        { "type": "textField", "propertyName": "name", "label": "Name",
          "desktop": { "font": { "color": "$role:bodyText", "type": "Segoe UI", "size": 15, "weight": "600" } } }
      ]
    }
  ]
}
```

**Structure**: each `column` has exactly two children — a `container` holding the **label text**, and a **value field** (`textField` or `switch`). Not the typical Shesha container pattern. (Colours above are illustrative role placeholders, not literals — see the next three bullets.)

**Styling labels**: set `fontSize: "text-xs"`, `fontWeight: "500"` as direct props, plus a muted `desktop.font.color`.

**Styling values**: add `desktop.font` with `size: 15`, `weight: "600"`, a body-ink `color` on the `textField` — makes the actual data pop.

**Card wrapper**: give the KIB component itself a `desktop` block with `border`, `background`, `shadow`, and `stylingBox` padding to turn it into a white stat-card. Concrete role/token values for all three bullets above: `shesha-design-system` → `component-recipes.md` → `kib-strip / meta-strip` (+ `styling-v7-mechanics.md` for the block shape).

---

## Section divider pattern

For a "Related Records" or section-heading strip above a tab group — style an **existing** `text` component with a v7 `desktop` block rather than wrapping it in a new container (border `all`=none/`bottom`=hairline/`left`=4px accent, a tinted `background`, a dark `font.color`, `stylingBox` padding, `marginTop` to separate from the content above). Copy `desktop` to `tablet`/`mobile`. The resolved recipe (which role/token goes where) is `shesha-design-system` → `component-recipes.md` → `section-divider-strip`.

---

## Full-bleed header pattern (details pages)

Standard approach for a tinted header zone that spans the full card width:

**Correct approach (v2+):** Set the root container padding to `0` (top/sides) and let the header container own its own padding. No negative margins needed.

```
root container:  pt=0, pb=24, pl=0, pr=0
header container: pt=20, pb=20, pl=32, pr=32  ← owns its zone
content container: pt=16, pb=0, pl=32, pr=32   ← owns content zone
```

**Anti-pattern (avoid):** Negative-margin hack (root has padding, header uses `marginTop:-24, marginLeft:-32, marginRight:-32`). This works but is fragile — if the root padding changes, all offsets must be recalculated manually.

For the header left accent on the **title container** inside the header (title + status badge), use a custom v7 border block with `borderType: "custom"` and a 4px solid `left` border — this creates the branded left-border signal without touching the full header background. Colour convention: `shesha-design-system` → `component-recipes.md` → `accent-left-border`.
