"""Rule: collapsiblePanel header spacing back to phase2's look.
0.46 collapsiblePanel migration (collapsiblePanelComponent.tsx:188-202) writes default headerStyles into every device
block, including stylingBoxJson padding 8/8/8/8, so headers are 52-56px with 8px all round where phase2 rendered
50px with padding 5px top / 10px left / 0 right / 0 bottom (measured on 22 panels, 2026-10-02).
Only rewrites a padding that is still exactly the migration default; an author's own header padding is kept."""
DEFAULT = {'paddingTop': '8', 'paddingRight': '8', 'paddingBottom': '8', 'paddingLeft': '8'}
P2 = {'paddingTop': '5', 'paddingRight': '0', 'paddingBottom': '0', 'paddingLeft': '10'}


def apply(c, notes):
    if c.get('type') != 'collapsiblePanel': return 0
    n = 0
    for dev in ('desktop', 'tablet', 'mobile'):
        hs = (c.get(dev) or {}).get('headerStyles') if isinstance(c.get(dev), dict) else None
        sb = hs.get('stylingBoxJson') if isinstance(hs, dict) else None
        if not isinstance(sb, dict): continue
        if all(str(sb.get(k)) == v for k, v in DEFAULT.items()):
            sb.update(P2); n += 1
    if n: notes.append(f'{c.get("componentName")}: panel header padding 8 -> 5/0/0/10 (phase2)')
    return n
