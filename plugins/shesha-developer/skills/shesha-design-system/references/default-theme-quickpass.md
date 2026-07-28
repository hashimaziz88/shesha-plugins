# Default-theme quick pass — for forms the compiler did not produce

**A compiled form does not need this.** `compile-blueprint.js` consumes the validated style
plan (see the SKILL.md "linked, not invoked" section) and bakes these values in as it emits.
Use this file only for the cases the compiler never touched: a hand-composed form, or a small
edit to an already-live form that is still default-grey.

It is a **cost-capped** floor — a small, fixed subset of
[component-recipes.md](component-recipes.md) pre-resolved with the default `shesha` values
from `assets/themes/shesha.tokens.json`, following the canonical build style in
[default-layout-patterns.md](default-layout-patterns.md). Apply it in **one pass**; it is a
floor, not a design project.

Styled markup is a **handback, not a delivery.** This skill never pushes: the caller
(`shesha-form-edit`) still has to push and verify. Do not report "styled markup returned" as
a completed task.

**Hard limits (what makes it "quick"):**
- Do NOT read [capability-matrix.md](capability-matrix.md) or [token-to-prop-mapping.md](token-to-prop-mapping.md) — every value below is already resolved and channel-safe.
- Do NOT run a browser measurement loop.
- Do NOT rewrite the app-level theme — if `$antdTheme` was never applied to the app, note it in the summary and move on (app theme is a once-per-project action, see [app-theme.md](app-theme.md)).
- One pass over the tree; mirror every block across `desktop`/`tablet`/`mobile`; done.

## The five treatments

Walk the markup tree once and apply, where each shape exists (skip what the form doesn't have):

### 1. Page root — canvas surface
On the outermost container (or a wrapping container if the form has none):

```json
"desktop": { "background": { "type": "color", "color": "#F8F8F9" },
             "stylingBox": "{\"paddingLeft\":\"24\",\"paddingRight\":\"24\",\"paddingTop\":\"24\",\"paddingBottom\":\"24\"}" }
```

### 2. Cards / section containers — white surface, hairline, radius 8 (border-forward, NO shadow)
Every container that groups a section of fields (and every `card`):

```json
"desktop": { "background": { "type": "color", "color": "#FFFFFF" },
             "border": { "border": { "all": { "width": "1px", "style": "solid", "color": "#E8EAF0" } },
                          "radius": { "all": 8 } },
             "stylingBox": "{\"paddingLeft\":\"16\",\"paddingRight\":\"16\",\"paddingTop\":\"16\",\"paddingBottom\":\"16\",\"marginBottom\":\"16\"}" }
```

Do not add shadows — the default `shesha` brand is border-forward (cards render flat).

### 3. Titles — role-sized ink, weight 600
`text` components acting as headers (color always Nero ink `#181818`, never brand blue; emphasis is weight + colour, never bigger text):

| Role | fontSize | fontWeight |
|---|---|---|
| Page title | 24 | 600 |
| Section / card header | 15–16 | 600 |
| Uppercase micro-label / eyebrow | 11 | 600 (letter-spacing 0.04em) |

### 4. Action row — one buttonGroup, primary from the app theme
The form's `buttonGroup`: confirm exactly one `buttonType: "primary"` item (Submit/Save) with the rest `default` — then leave colours alone. Brand primary (`#003BB2`) comes from the app-level theme; **never repaint buttons per form.** Give the group a top gap: `stylingBox` `{"marginTop":"16"}`.

### 5. Datatable / datalist / status
- Datatable header: `background` `#F8F8F9`, text **12 / 600 / uppercase** `#333333` (letter-spacing 0.04em); rows separated by 1px `#F0F2F5` dividers only — no zebra stripes.
- `refListStatus` chips: **radius 12 (rounded-rect, not a full pill)**, fontSize 10.5–11, fontWeight 600, uppercase, padding 4px 10px, tones from the token file's `statusLifecycle.badges` (draft grey, success green `#E8F5E9`/`#007E00`, warning `#FFF8E1`/`#E65100`, error `#FFEBEE`/`#B71C1C`, info `#EEF2FF`/`#003BB2`).
- Full anatomy (row heights, toolbar, list cards, KIB strips, tabs, modals): [default-layout-patterns.md](default-layout-patterns.md) — consult it when the form has those shapes; skip for a plain field form.

## Rules

- `stylingBox` is a JSON **string**; text components take `fontSize`/`fontWeight` as direct props (see the gotchas in SKILL.md).
- Never touch structure, `propertyName`s, actions, or `formSettings` — style only. If structure looks wrong, report it back; do not fix it here.
- Preserve every existing style the author already set — this pass fills gaps, it does not overwrite deliberate values.
- The pass is complete when: page root has the canvas background, every section surface is a white hairline card, every title carries fontSize+fontWeight, and the buttonGroup has exactly one primary. These four markers are what `form-quality.md`'s appearance floor and the `form-auditor` appearance check look for.
