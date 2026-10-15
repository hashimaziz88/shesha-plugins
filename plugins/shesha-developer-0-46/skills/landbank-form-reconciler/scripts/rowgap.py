"""Rule: horizontal containers lost their gap on 0.46 (table toolbars: search, filter, refresh, columns, pager touch).
A container stored below the style step with PARTIAL device blocks (e.g. only `className`) is migrated from those
blocks (migrateStyles reads prev[screen] when it exists), and the v9 step copies `gap: prev.gap` - unset/null - so the
row renders with gap 0. Phase2 rendered these rows spaced. Set `gap: '8px'` in every device block that has no gap
(or top-level when the container stores no device blocks). Containers with their own gap are left alone.
Proven on LBAccount-table: toolbar items 0px apart -> 8px (2026-10-02)."""


ROW_CLASSES = {'index-table-controls-right'}   # 0.46 container defaults force display:flex/nowrap for these (container/data.ts:218)


def _class(c):
    return c.get('className') or next((c[d].get('className') for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict) and c[d].get('className')), None)


def _horizontal(c):
    """Rendered as a row: stored horizontal, or a class 0.46 forces into a flex row whatever the stored direction."""
    return (c.get('direction') == 'horizontal' or _class(c) in ROW_CLASSES
            or any(isinstance(c.get(d), dict) and c[d].get('direction') == 'horizontal' for d in ('desktop', 'tablet', 'mobile')))


def apply(c, notes):
    if c.get('type') != 'container' or not _horizontal(c): return 0
    if c.get('gap') not in (None, ''): return 0
    blocks = [c[d] for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict)]
    n = 0
    if blocks:
        for b in blocks:
            if b.get('gap') in (None, ''):
                b['gap'] = '8px'; n += 1
    else:
        c['gap'] = '8px'; n = 1
    if n: notes.append(f'{c.get("componentName")}: horizontal row gap 8px')
    return n
