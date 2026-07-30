# Block library

Authored layout **blocks** — small, parented, version-stamped component subtrees that you
**compose** into a form. A block is structure only; the matching **style overlay** lives in
`shesha-design-system` and is applied after composition. Never hand-copy a 25K-line seed —
map each blueprint node to a block, insert its subtree into a named `$slot`, re-stamp ids,
fill `$bindings`, then hand off to the design-system overlay.

Blocks live in `assets/blocks/*.block.json`. Every block file carries: `$block`, `$kind`,
`$styleOverlay` (the paired overlay name in shesha-design-system), `$slots`, `$bindings`,
`$validatedAgainst` (matrix rows the structure relies on), and a `subtree` (the literal markup).
Some also carry a `$rowTemplate` (a separately-published Table-type row form).

`$kind` says what the block **is**, structurally — it is not an archetype (see
[archetypes.md](archetypes.md) for the eight archetype names; a block's `$kind` value is never
one of them). Three kinds exist:
- `layout` — a top-level page-skeleton piece that implements a specific archetype's required
  structure (currently only `record-detail`'s body-split and detail title band).
- `list` — a block whose job is to host or represent a repeating collection (a rail card wrapping
  a datalist, or a row template for one).
- `fragment` — everything else: a self-contained, reusable structural unit with no archetype
  affinity of its own — usable inside whichever archetype composes it in.

## Catalogue

| Block | Kind | Builds | Key `$slots` | Key `$bindings` |
|---|---|---|---|---|
| `flex-split-main-rail` | layout (record-detail) | The body split: one flex `container` (row, gap 16) with a fill `main` column + a fixed 332px `rail` column. The clean fixed/`calc` idiom — never `columns`. | `main`, `rail` | none (pure structure) |
| `page-header-band` | layout (record-detail) | In-page detail title band: breadcrumb + title row (title text + status chip on the left, Edit/Save/Cancel buttonGroup on the right). NOT the global header form. | `titleText`, `statusChip`, `actionItems`, `breadcrumbContent` | title content, status `propertyName` + reflist id, actions width `calc` |
| `meta-strip` | fragment | A horizontal strip of label/value meta cells (MODULE / RELEASE / VIEW TYPE …) under a header. | `cells`, `cell.label.text`, `cell.value.text` | each cell value `propertyName`/content |
| `card-with-header-strip` | fragment | A white card (radius 12, hairline, soft shadow) with a tinted header strip (title + optional count badge) over a padded body. | `header`, `body` | header text, count badge expression |
| `rail-panel` | list | A count-badged rail card for a linked collection: title + count + inline `+` add link over a datalist bound to its own `dataContext`. | `title.text`, `count.badge.text`, `add.button.label`, `datalist` | dataContext entityType/endpoint, datalist `formId`, add `formId`, onSuccess owner |
| `rail-label-value-row` | fragment | One Details-card attribute row: a fixed 96px label cell + a `calc(100% - 106px)` value/control cell, bottom hairline. Repeat per attribute. | `labelText`, `control`, `labelCell`, `valueCell` | row label, value `propertyName`, control `type`+version |
| `status-pill` | fragment | A standalone reflist status pill (per-item colours from the reflist, pill `customStyle`). | none | status `propertyName`, reflist module + name |
| `completeness-bar` | fragment | A micro-label + line progress bar reading a 0–100 percent property (or a static percent). | `label`, `progress` | percent `propertyName` (or literal `percent`) |
| `requirement-datalist-row` | list | The wide-column requirement list: a host (`dataContext` → `datalist`) in the parent form **plus** a separately-published row-card template (`$rowTemplate`: type + status badges, body line, meta + action row). **Carries the datalist row-template collapse/scroll FIX** — `style` overflow on every container + a `minHeight` reserve on the body text (markup-only; no global CSS). Canonical live examples: `view-requirement-card`, `view-endpoint-row`, `view-role-row`. | `host.datalist`, `row.header.left`, `row.body`, `row.meta` | host entityType/endpoint, datalist `formId`, row badge/body propertyNames + reflists |
| `dashed-add-button` | fragment | The dashed `+ Add X` button at the foot of a rail list: full-width dashed-bordered wrapper + a single `link` button opening a create dialog. | `button`, `buttonLabel`, `buttonGroup` | create-form id, label, parent-FK `formArguments`, refresh-target id |

### Placeholder conventions in a subtree
- `$binding:<name>` — a value you fill from `$bindings` (entity propertyName, reflist id, label, etc.).
- `$slot:<name>` — an id you mint during stamping (kept stable so action wiring resolves).
- `$role:<token>` — a **design-system** colour/role token; resolved by the overlay, never a hex.
- `$MODULE` / `$ENTITY` / `$OWNERFK` / `$PROJECTION` — substitutions in dataContext endpoint code.

## Assembly workflow

Compose from blocks — **never** copy a 25K-line seed and edit it down.

1. **Map** each blueprint `layout-tree` node to a block (use the blueprint's own archetype, per
   [archetypes.md](archetypes.md), plus each block's purpose and `$kind` in the catalogue above).
   Body split → `flex-split-main-rail`; title band → `page-header-band`; each rail collection →
   `rail-panel` (+ `dashed-add-button`); attribute rows → `rail-label-value-row`; the wide list →
   `requirement-datalist-row` (host + row template).
2. **Insert** the block's `subtree` into the parent's named `$slot` (the `$slots` map gives the
   JSON path of the array/node to write into). Nest blocks by inserting one block's subtree into
   another's slot (e.g. `rail-panel` subtrees into `flex-split-main-rail.$slots.rail`).
3. **Re-stamp** the whole inserted subtree with `stampTree`: mint a fresh `id` per component and
   set every child's `parentId` to its new parent. Wrong/missing `parentId` renders blank. Resolve
   `$slot:` ids here and keep them stable so action `actionOwner`/`onSuccess` wiring still points at
   the right component.
4. **Fill `$bindings`**: walk the block's `$bindings` list and write each `$binding:` placeholder —
   entity `propertyName`s (validate every one against entity metadata), reflist `{module,name}`,
   labels, count/body content expressions, dataContext endpoints, dialog `formId`s, and the
   `onSuccess.actionOwner` that must equal the owning dataContext/datalist id.
5. **Resolve + stamp the style overlay**: take `$styleOverlay`, fetch that overlay from
   `shesha-design-system`, resolve its `$role:` tokens against the active brand token file, and
   stamp the resolved `desktop`/`tablet`/`mobile` style blocks onto the matching components.
   **form-edit composes structure; design-system owns the overlays** — do not invent hexes,
   fonts, or per-component colours in the block subtree.
6. **Validate**: run `scripts/validate-blocks.js` (skeleton JSON parses, every `$validatedAgainst`
   row is `renders`/`gotcha` in the capability matrix, no `columns`, no stray hex, no flex row
   missing `display:flex`). Then validate the assembled form against the component-properties index.
7. **Push** via the form-edit API (Create / UpdateMarkup / ImportJson) and publish any
   `$rowTemplate` as its own Table-type form. Expect the gate-5a.5 placement re-measure.

## The styling boundary (read this twice)

A block's `subtree` is **structure** — containers, flex direction/gap, nesting, parentIds,
component types/versions, bindings. The few style values present in a subtree (radius, hairline
colours on `card-with-header-strip`, pill `customStyle`) are structural defaults that the overlay
overrides. **All brand styling — colour, type scale, spacing rhythm, shadow, status lifecycle —
comes from the paired overlay in `shesha-design-system`**, addressed by `$styleOverlay` and
resolved through `$role:` tokens. If you find yourself typing a hex into a block subtree, stop:
that value belongs in the overlay. form-edit composes; design-system styles.
