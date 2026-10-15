"""Rule: table headers stored as a VERTICAL `sha-index-table-control` container (title on top, toolbar row below).
0.46 container defaults force `display: flex; flex-wrap: nowrap` for className `sha-index-table-control`
(container/data.ts:218-220) whatever the stored direction, so the title and the toolbar row are squeezed into one
line (title overlaps the search box, pager clipped). Phase2 stacked them. The default loses to explicit device
values, so write display flex + column + stretch into each device block (top level when there are none).
Headers stored horizontal (title left, controls right - e.g. LBAccount-table) are not touched."""
VERT = {'display': 'flex', 'flexDirection': 'column', 'direction': 'vertical', 'alignItems': 'stretch'}


def _class(c):
    return c.get('className') or next((c[d].get('className') for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict) and c[d].get('className')), None)


def apply(c, notes):
    if c.get('type') != 'container' or _class(c) != 'sha-index-table-control': return 0
    if c.get('direction') != 'vertical': return 0
    blocks = [c[d] for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict)] or [c]
    n = 0
    for b in blocks:
        if any(b.get(k) != v for k, v in VERT.items()):
            if b.get('flexDirection') not in (None, '', 'column') or b.get('display') not in (None, '', 'flex'): continue  # author's own layout
            b.update(VERT); n += 1
    if n: notes.append(f'{c.get("componentName")}: table header stacked (title above toolbar)')
    return n
