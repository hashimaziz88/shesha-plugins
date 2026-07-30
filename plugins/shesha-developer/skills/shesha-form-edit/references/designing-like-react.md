# Designing like React — the design surface

You are good at designing React pages. You are bad at hand-writing Shesha's
form-config JSON (a leaky proprietary DSL). So **design in the React mental
model you already have**, express it as the blueprint layout tree, and let
`compile-blueprint.js` translate each primitive into the Shesha channel the
gym-**measured** capability matrix proves works. You never hand-author Shesha
markup; your flex / spacing / hierarchy instincts translate 1:1.

## Think in these primitives (they are your JSX elements)

| You'd write in React | Blueprint `kind` | Compiles to |
|---|---|---|
| `<div style={{display:'flex',flexDirection:'column',gap}}>` / `<Stack>` | `stack` | flex-column container + `gap` |
| `<div style={{display:'flex',gap}}>` / `<Row>` | `row` | flex-row container + `gap` |
| CSS grid of N equal columns | `grid` (`columns: N`) | flex-wrap row, each child `dimensions.width: calc(...)` |
| `<Card>` / a surfaced panel | `card` (`title?`) | container (Style pass adds surface/border/radius) |
| a titled group | `section` (`title`) | stack with an h3 heading prepended |
| `<h1>`…`<h4>` | `heading` (`level`) | text with structural `font.size`/`weight` |
| body copy | `text` | text component |
| `<input>`/`<select>` bound to a field | `field` (`property`) | by-datatype component, bound + reflist-resolved |
| a data grid | `datatable` (`columns: [...]`) | dataContext(v8) + datatable |
| a card list | `datalist` (`itemForm`) | dataContext(v8) + datalist |
| tabbed panels | `tabs` → `tab` children | tabs |
| the submit/cancel button row | `actions` | buttonGroup: Submit(primary) + Back |
| a status pill | `chip` / `field` on a reflist prop | refListStatus |

## Layout props — the flexbox you know

Any container node (`stack`/`row`/`grid`/`card`/`section`/`region`) takes:

- `gap` — space between children. Number (px) or scale token `xs sm md lg xl 2xl` (4/8/12/16/24/32). → container `gap`.
- `padding` — inner padding, same units. → `stylingBox`.
- `align` — cross-axis: `start center end stretch baseline`. → `alignItems`.
- `justify` — main-axis: `start center end space-between space-around`. → `justifyContent`.
- `width` on a **child** of a `row` — `%`, `px`, `fr`, or `calc()`. → `desktop.dimensions.width`. This is the ONLY split lever [R-028]; `flex`/`flexBasis` do NOT reach the outer div. A 2/3 + 1/3 split is `width:"66%"` and `width:"33%"` on the two row children.

Containers always emit `display:"flex"` so the flex props are live [R-029].

## The one rule that differs from web CSS

**Splits are flex children sized by `width`, never a `columns` component** [R-028].
When you'd reach for a 12-col grid or `<Col span=8>`, use a `row` with children
carrying `width`, or a `grid` with `columns:N`. The compiler enforces the rest
(ids, versions, dataContext wrappers, the validationErrors + Submit/exit floor).

## Worked example — a capture screen, designed as JSX then as the blueprint

What you'd sketch in React:

```jsx
<Stack gap="lg" padding="lg">
  <Heading level={1}>Register Asset</Heading>
  <Row gap="lg">
    <Stack width="66%" gap="md">
      <Field property="name" /><Field property="serialNumber" />
      <Field property="category" /><Field property="purchaseDate" />
    </Stack>
    <Stack width="33%" gap="md">
      <Field property="status" /><Field property="location" />
      <Field property="assignedEmployee" />
    </Stack>
  </Row>
  <Actions />
</Stack>
```

The same thing as the blueprint `layout` (the `blueprint-json` block):

```json
{ "kind": "stack", "gap": "lg", "padding": "lg", "children": [
  { "kind": "heading", "level": 1, "content": "Register Asset" },
  { "kind": "row", "gap": "lg", "children": [
    { "kind": "stack", "width": "66%", "gap": "md", "children": [
      { "kind": "field", "property": "name" },
      { "kind": "field", "property": "serialNumber" },
      { "kind": "field", "property": "category" },
      { "kind": "field", "property": "purchaseDate" } ] },
    { "kind": "stack", "width": "33%", "gap": "md", "children": [
      { "kind": "field", "property": "status" },
      { "kind": "field", "property": "location" },
      { "kind": "field", "property": "assignedEmployee" } ] } ] },
  { "kind": "actions" } ] }
```

`node scripts/compile-blueprint.js --blueprint <it> --out form.json` produces
gate-clean Shesha markup: the two-column split via `desktop.dimensions.width`,
reflist identities resolved from live metadata, the validationErrors + Submit/
Back floor, KB versions stamped. Then the **Style pass** (`shesha-design-system`)
paints brand colour/type/borders over this structure — you designed the layout;
it designs the skin.

## Where design judgment still matters (do this, don't delegate it)

The compiler handles the DSL translation; **you** own the design decisions the
way you would for a React page: the archetype, the layout tree, the visual
hierarchy (what's an h1 vs h2 vs body), grouping into cards/sections, the split
ratios, spacing rhythm (pick a consistent gap scale), and which fields belong
where. Consult `shesha-design-system` for brand tokens and `frontend-design`
for visual-composition heuristics. Measure, don't guess placement, when a real
design source exists (that's `shesha-design-comprehension`).
