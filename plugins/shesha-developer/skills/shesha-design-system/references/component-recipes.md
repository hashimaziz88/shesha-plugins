# Component recipes (Shesha default archetypes)

Per-component v7 style blocks — the second styling layer. Copy a recipe, fill it with the brand theme's resolved values (via [token-to-prop-mapping.md](token-to-prop-mapping.md)), and mirror the block across desktop/tablet/mobile unless the design is genuinely responsive. Illustrative values below reference the **default `shesha`** theme; swap for another brand's tokens (e.g. `requirements-studio`). The `recipe:`/token names are identical across brands — only the resolved values differ.

Recipe names match the `recipe:` annotations the comprehension layer puts on blueprint regions, so a blueprint region maps 1:1 to a recipe here.

**Two rules every recipe obeys** (proven against the live app — see [capability-matrix.md](capability-matrix.md)):
1. **Splits are flex `container` rows, never the `columns` component** (firm project rule). A row is `display:"flex"` + `flexDirection:"row"` + `gap`; size each child via `desktop.dimensions.width` (calc/%/px) — this is the only lever that reaches the child's outer div. Per-child `customStyle:{flex:…}` is **inert** for sizing (lands on the inner div).
2. **Every flex container sets `display:"flex"` explicitly** — omit it and `flexDirection`/`gap` are ignored and children stack full-width.

## surface-layering  (the depth system every screen builds on)
Four token layers, back to front: page root container `background.color` = `surfaces.canvas` (Shesha default `#F8F8F9` Athens Grey — the dominant surface); cards = `surfaces.surface` (white) + hairline `border.all` (`lines.border`) + `border.radius.all` = `radius.lg` (8 in the Shesha default) **+ the brand card shadow only if the brand defines one** (the Shesha default is border-forward — cards render flat; see R1); card **header strips** = `surfaces.surfaceAlt` (Shesha default `#F8F8F9`) + a bottom hairline; tints (count badges, row hover, status chips) from `brand.tint` / `statusLifecycle.badges`. Radius by role: `radius.sm` (4) on chips/legacy inputs, `radius.md` (6) on controls, `radius.lg` (8 in the Shesha default; up to 12 in other brands) on cards, `radius.pill` on status badges — pick the token for the element's role, don't flatten to one radius.

## card + section-header
Card container: white `background.color`, hairline `border.all` (lines.border), `border.radius.all` = radius.lg (8 in the Shesha default), **+ the brand card shadow only if the brand defines one** — the Shesha default is border-forward (flat); a brand with a visible `shadow.card` uses `desktop.shadow {offsetX:0, offsetY:1, blurRadius:4, spreadRadius:0, color:…}` (border and shadow are complementary, never a shadow instead of a border). Header strip: child container, `background.color` = surfaceAlt, bottom hairline, padding `12 16`; header text color = **`sectionHeading` role** (Nero ink `#181818` in the Shesha default — Cobalt is reserved for interactive elements; a brand colour in brands that colour their headers), 600, fontSize cardHeader (16); optional leading icon. Count badge (e.g. "7"): small pill, neutral `surfaces.surfaceInset` bg + muted/`sectionHeading` text (or `brand.tint`/`brand.primary` in brands that colour it). Body: `stylingBox` padding 16. Sub-cards use radius `radius.md`–`radius.lg`.

## page-title-band
Header band container: `background.color` = surface (white), bottom hairline (`border.borderType:"custom"`, bottom = lines.border), `stylingBox` padding `20 24`. Title text: fontSize = title (24), fontWeight 600 (700 if the design's title is bold), color ink.primary. Subtitle text: fontSize = subtitle (14–18), color ink.soft. Actions: a right-aligned `buttonGroup` in a flex row (`display:flex`, `justifyContent:"space-between"`) — title block sized `dimensions.width:"calc(100% - <actions>px)"`, actions auto. (primary = brand fill, secondary = white + hairline border.)

## status-chip  (refListStatus)
Bind to the status property; colour each lifecycle item from `statusLifecycle.badges.<status>` (bg/fg/border). Pill radius (9999), fontSize 12, fontWeight 500–600, padding `2 8`. Never colour-only — the label text is the status name.

## kib-strip / meta-strip  (Key Info Bar)
A flex `container` row (`display:"flex"`, `flexDirection:"row"`, `gap`) of cells on the surface. **Equal cells:** size each `desktop.dimensions.width:"calc((100% - <total gap>px)/N)"` (do NOT rely on `customStyle flex` — inert). **Content-width meta strip** (e.g. MODULE · RELEASE · …): leave cells auto + `gap` + `justifyContent:"flex-start"`. Each cell: a micro-label (uppercase 11–12/600, color ink.soft/rail, letter-spacing 0.05–0.06em) above a value (13.5–14/400–500, ink.primary). `stylingBox` padding `12 16`. Flush dividers between cells = `border.borderType:"custom"` **left hairline on cells 2+** (NOT divider elements — border-only containers collapse 0×0). Optional bottom hairline under the strip.

## detail-attributes  (label-left / value-right rows)
Inside the Details card: each attribute is a **2-cell flex `container` row** (`display:"flex"`, `flexDirection:"row"`, `gap` 8–12, `alignItems:"center"`) — label cell `desktop.dimensions.width:"96px"` (up to ~200px; 14/600, ink.muted, right-aligned) + value/control cell `desktop.dimensions.width:"calc(100% - <label+gap>px)"` (fills). Row bottom hairline (lines.divider), `stylingBox` padding `6 0`. Read mode shows the value; edit mode shows the control (input/select inheriting app-theme border/radius). Do NOT stack label-over-value; do NOT use `columns`.

## datatable / datalist
Header row: surfaceAlt bg, 14/600 ink.primary, 2px bottom border. Body rows: white, 1px row hairline (divider), hover = brand.tint, selected = brand.tint. Cell 14/400, padding `12 16`. Inline status cells use the status-chip recipe.

## datalist-row-template card  (the canonical way to do cards in a datalist)
A bound collection renders as a **datalist of cards**: the row template is its **own Table-type form** (the datalist's `formId`), and the datalist stamps one instance per record. The card root is a **styled `container`** (a flex column), not the `card` component.

**⚠️ The collapse/scroll trap — and the fix (browser-verified).** In a row template every component sits in an Ant `form-item` chain the framework forces to `min-height:0`. Multi-line content then paints via `overflow:visible` **out of a collapsed wrapper** → cards overlap, and the container's hard-coded inner `overflow:auto` shows **▲▼ scroll arrows** for tall text. `dimensions`/`customStyle`/the `overflow` boolean prop **cannot** fix it. **The fix is the legacy `style` JS-string channel**, which renders inline on the element and reaches the inner `.sha-components-container-inner` div. Apply ALL of:
1. **`style` overflow on every container:** inner rows `style:"return {overflow:'visible'}"`, card root `style:"return {overflow:'hidden', boxSizing:'border-box'}"`.
2. **Body text:** reserve `dimensions.minHeight:"24px"` **+** `style:"return {whiteSpace:'normal', wordBreak:'break-word', overflow:'hidden', display:'block', maxWidth:'100%'}"` → wraps to full height, no collapse/overlap. (The form-item wrapper still reports a short height — harmless once its parent is `overflow:visible` and the height is reserved.)
3. **Containers:** `dimensions.minHeight:"fit-content"` so the card grows to its content.
4. **refListStatus pills:** `style:"return {display:'inline-flex', alignItems:'center', height:'26px', overflow:'visible', whiteSpace:'nowrap'}"` + `solidBackground:true` → uniform, vertically-centred pill that doesn't collapse.
5. **Header alignment:** the header is a flex row with `justifyContent:"space-between"` — a left `leftBadges` flex-wrap container (`dimensions.maxWidth:"calc(100% - 80px)"`) holds the badges/pills, the action `buttonGroup` sits right. No margin-auto tricks.

**Card structure:** root `cardBody` (flex column, gap 8) → `headerRow` (flex row, `space-between`) → [`leftBadges` (type + status refListStatus) | `rowActions` buttonGroup] → `rowBody` (paragraph text) → `rowMeta` (flex row, optional, e.g. "Release · …" 12px muted). Surface: white bg, hairline `border.all` (lines.border), `radius.lg`/8, **plus the brand card shadow only if the brand defines one** (the Shesha default is border-forward — flat; a brand with a visible `shadow.card` uses e.g. `{0,1,4,0,rgba(0,0,0,0.06)}`), `stylingBox` padding `14 16`.

**Canonical live examples:** `view-requirement-card`, `view-endpoint-row`, `view-role-row` — the three row templates of `view-definition-details-claude`. **Block + overlay:** compose the host + row template from the `requirement-datalist-row` block; brand visuals from its `requirement-datalist-row` overlay. The `style` overflow values and the body `minHeight` reserve are **correctness, not decoration** — they live in the block subtree and must never be stripped by the overlay.

## related-panel  (count-badged rail panel)
A `card` whose header carries the section title + a **count badge** (right of the title) + an inline "+" add link (brand). Body = a datalist of the linked items (each row a `datalist-row-template card`). Stacks vertically in the rail with 16 gap.
- **Header build:** set the card's `hideHeading:true` and put the header INSIDE the dataContext's control row: a flex row `justifyContent:"space-between"` → left = `titleGroup` (title text 15/600 + count badge), right = the add `buttonGroup`. (Proven on `endpointsCard`/`rolesCard` in view-definition-details-claude.)
- **Count badge** = a `text` styled inline as a muted pill: `style:"return {display:'inline-block', minWidth:'20px', textAlign:'center', padding:'1px 8px', borderRadius:'10px', background:'#F0F2F5', color:'#9BA3B8'}"` (Shesha default neutrals — `surfaces.surfaceInset` / `ink.soft`), content bound to `{{data.<x>Count}}` — populated by the count recipe below.

## collection-count badge / "· N" title  (via onAfterDataLoad)
To show a **live count** of a related collection in a header/badge/title, compute it in `formSettings.onAfterDataLoad` and stash it on the record, then bind a `text` to it. This is the reliable way — **reading a live context value (`contexts.appContext.X`) in a text does NOT resolve** (see capability-matrix → "filter by a GLOBAL value").
```js
// in formSettings.onAfterDataLoad (the form already does this for the completeness bar):
var mk = function(fk){ return encodeURIComponent(JSON.stringify({and:[{'==':[{'var':fk+'.id'},data.id]}]})); };
var cnt = async function(entity, fk){ var r = await http.get('/api/dynamic/<Module>/'+entity+'/Crud/GetAll?filter='+mk(fk)+'&properties=id&maxResultCount=1000'); return ((r.data.result||{}).items||[]).length; };
form.setFieldsValue({ apiCount: await cnt('ViewDefinitionRequiredApi','viewDefinition'), reqCount: <n> });
```
Use **`items.length`, NOT `result.totalCount`** (unreliable at small `maxResultCount`). Bind the badge/title text content to `{{data.apiCount}}`. Proven on the rail count badges + the "View Requirements · 9" title.

## datalist section toolbar  (section title + count + filter + view toggle)
The header row above a wide datalist (e.g. View Requirements): a flex row `justifyContent:"space-between"`, full width. Left = `titleGroup` (section title 16/600 + a muted "· N" count, count via the recipe above). Right = `controlsWrap` (flex row, gap 10) holding the bound **quick-search** (Filter, ~170px) + a **segmented control** + the pager. The segmented (no native component) = a styled container (`background:#eef1f4`, radius 8, padding 3) of two `text` "pills"; the active pill `style` = `{background:'#fff', borderRadius:'6px', padding:'4px 12px', boxShadow:'0 1px 2px rgba(15,23,42,0.08)', fontWeight:600}`, inactive = transparent/muted. **Note:** a segmented built this way is presentational unless its modes are separately wired (view-state + conditional rendering). Keep the quick-search + pager INSIDE the dataContext scope so their wiring holds. Hide the wrapping card's own `hideHeading` so the title isn't duplicated. Proven on view-definition-details-claude.

## flex-split-main-rail  (the page body split — replaces the old `columns` body)
A flex `container` row: `display:"flex"`, `flexDirection:"row"`, `gap:"16"`, `justifyContent:"space-between"`, `alignItems:"flex-start"`, row `desktop.dimensions {width:"100%", minWidth:"100%", maxWidth:"100%", minHeight:"fit-content"}`. Children:
- **main column:** `desktop.dimensions {width:"calc(100% - 348px)", minWidth:"0px", maxWidth:"calc(100% - 348px)"}` (348 = 332 rail + 16 gap), `display:"flex"`, `flexDirection:"column"`, `alignItems:"stretch"`.
- **rail column:** `desktop.dimensions {width:"332px", minWidth:"332px", maxWidth:"332px"}`, `display:"flex"`, `flexDirection:"column"`, `gap:"16"`, no own background (panels carry their own white surfaces). On tablet/mobile, collapse to stacked full-width (`width:"100%"`). Proven: main 1022 / rail 332 at a 1370px row.
