# Related panels: rail structure, live counts, section toolbars

> Moved here from `shesha-design-system` → `component-recipes.md`: the
> three patterns below are structure/behaviour (re-parenting, `formSettings.onAfterDataLoad`
> CRUD wiring, and a non-native control's DOM construction) — not appearance. The paired
> visual recipes (surface, count-badge colour, pill styling) stay in `component-recipes.md`
> under `related-panel` and `datalist section toolbar`; this file owns how the pieces are
> assembled and wired.

---

## related-panel host — header placement

A `related-panel` (a `card` whose header carries the section title + count badge + inline
"+" add link, body = a datalist of the linked items) needs its header put **INSIDE the
dataContext's control row**, not left as the card's own native header slot: set the card's
`hideHeading:true`, then build a flex row (`justifyContent:"space-between"`) as the first
child inside the `dataContext` — left = `titleGroup` (title text + count badge), right = the
add `buttonGroup`. This re-parenting is what lets the header sit in the same scope as the datalist/add-dialog
wiring below it; a header left in the card's own header slot renders fine but sits outside
that scope. Card/count-badge appearance: `shesha-design-system` → `component-recipes.md` →
`related-panel`.

---

## Live collection count (via `onAfterDataLoad`)

To show a **live count** of a related collection in a header/badge/title, compute it in
`formSettings.onAfterDataLoad` and stash it on the record, then bind a `text` to it. This is
the reliable way — **reading a live context value (`contexts.appContext.X`) in a text does
NOT resolve** (see `shesha-design-system`'s capability-matrix → "filter by a GLOBAL value").

```js
// in formSettings.onAfterDataLoad (the form already does this for the completeness bar):
var mk = function(fk){ return encodeURIComponent(JSON.stringify({and:[{'==':[{'var':fk+'.id'},data.id]}]})); };
var cnt = async function(entity, fk){ var r = await http.get('/api/dynamic/<Module>/'+entity+'/Crud/GetAll?filter='+mk(fk)+'&properties=id&maxResultCount=1000'); return ((r.data.result||{}).items||[]).length; };
form.setFieldsValue({ apiCount: await cnt('ViewDefinitionRequiredApi','viewDefinition'), reqCount: <n> });
```

Use **`items.length`, NOT `result.totalCount`** (unreliable at small `maxResultCount`). Bind
the badge/title text content to `{{data.apiCount}}`.

---

## Datalist section toolbar — structure

The header row above a wide datalist (e.g. "View Requirements"): a flex row
`justifyContent:"space-between"`, full width. Left = `titleGroup` (section title + a muted
"· N" count, count via the recipe above). Right = `controlsWrap` (flex row, gap 10) holding
the bound **quick-search** (Filter, ~170px) + a **segmented control** + the pager.

**The segmented control has no native Shesha component** — build it from a styled `container`
wrapping two `text` "pills": the active pill gets a raised/inset `style` treatment, the
inactive pill stays transparent/muted (exact values: `shesha-design-system` →
`component-recipes.md` → "datalist section toolbar"). **Note:** built this way, the segmented
is presentational only unless its modes are separately wired (view-state + conditional
rendering) — it does not toggle anything on its own; wire a `style`/`hidden` swap driven by a
context value if it needs to actually switch views.

Keep the quick-search + pager **inside the dataContext scope** so their wiring holds. Hide the
wrapping card's own `hideHeading` so the title isn't duplicated.
