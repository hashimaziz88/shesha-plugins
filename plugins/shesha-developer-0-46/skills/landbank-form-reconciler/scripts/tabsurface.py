"""Rule: undo the 0.46 tabs 'surface' that the v4+ migration persisted into tabs desktop/tablet/mobile blocks.
Measured on p2 vs local (2026-10-02): p2 line tabs have transparent inactive tabs, active label colorPrimary weight 400,
no box around the tab body. Local v11 tabs store card.background rgba(0,0,0,0.02) (grey blocks), font.color '' (an
empty-but-defined colour overrides colorPrimary -> black active label, tabs/styles.ts --ant-tabs-item-selected-color),
font.weight 500, a 1px #f0f0f0 border with radius 8 and 16px padding. Theme defaults cannot win (desktop > theme,
formComponentModelPreparer.tsx:55-58), so this is a per-form rule. Only touches values equal to the migration defaults."""
GREY = {'rgba(0,0,0,0.02)', 'rgba(0, 0, 0, 0.02)'}


ZERO = {'width': '0px', 'style': 'none', 'color': '#f0f0f0'}
# tabs body border lines come from border.border.all/sides and IGNORE hideBorder (tabs/styles.ts:27-43, borderLinesStyles)
P2_FAITHFUL = {'card': {'background': {'type': 'color', 'color': 'transparent'}},
               'font': {'color': 'var(--primary-color)', 'weight': '400'},
               'border': {'hideBorder': True, 'borderType': 'all', 'border': {'all': ZERO, 'top': ZERO, 'right': ZERO, 'bottom': ZERO, 'left': ZERO}},
               'stylingBoxJson': {'_type': 'styleBox', 'paddingTop': '0', 'paddingRight': '0', 'paddingBottom': '0', 'paddingLeft': '0'}}


def seed_low_version(c, notes):
    """v<4 tabs are migrated at render time and receive the 0.46 surface defaults; give them explicit p2-faithful
    desktop values the migration merges under (PILOT - verify per form)."""
    if c.get('type') != 'tabs' or (c.get('version') or 0) >= 4: return 0
    d = c.setdefault('desktop', {})
    import copy
    before = repr(d)
    for k, v in P2_FAITHFUL.items():
        cur = d.get(k)
        # border: the seed wins (the migration's border lines must be zeroed); everything else, incl. stylingBoxJson,
        # keeps stored values so later rules (tab_gap paddingTop 16) are not overwritten on the next run.
        d[k] = {**(cur if isinstance(cur, dict) else {}), **copy.deepcopy(v)} if k == 'border' else {**copy.deepcopy(v), **(cur if isinstance(cur, dict) else {})}
    sbm = c.get('stylingBox')
    if isinstance(sbm, str) and 'marginBottom' in sbm:
        import json as _j
        try: d['stylingBoxJson']['marginBottom'] = str(_j.loads(sbm).get('marginBottom'))
        except Exception: pass
    d['_reconciler046'] = True
    if repr(d) == before: return 0
    notes.append(f'{c.get("componentName")}: v{c.get("version")} tabs seeded with p2-faithful desktop surface')
    return 1


def apply(c, notes):
    if c.get('type') != 'tabs': return 0
    n = 0
    for dev in ('desktop', 'tablet', 'mobile'):
        d = c.get(dev)
        if not isinstance(d, dict): continue
        bg = ((d.get('card') or {}).get('background') or {})
        if bg.get('color') in GREY:
            bg['color'] = 'transparent'; n += 1
        f = d.setdefault('font', {}) if dev == 'desktop' else d.get('font')
        if isinstance(f, dict):
            # tabs defaults (tabs/utils.ts:14) merge color '' back in; '' is "defined" and replaces colorPrimary,
            # so write the primary colour explicitly (0.46 defines --primary-color on the active tab).
            if f.get('color') in ('', None) and dev == 'desktop':
                f['color'] = 'var(--primary-color)'; n += 1
            elif f.get('color') == '':
                del f['color']; n += 1
            if str(f.get('weight')) == '500':
                f['weight'] = '400'; n += 1
        b = d.get('border')
        if isinstance(b, dict) and ((b.get('border') or {}).get('all') or {}).get('color') == '#f0f0f0':
            sides = b.setdefault('border', {})
            if any(str((sides.get(k) or {}).get('width')) not in ('0px', '0') for k in ('all', 'top', 'right', 'bottom', 'left')) or not b.get('hideBorder'):
                b['hideBorder'] = True
                for k in ('all', 'top', 'right', 'bottom', 'left'): sides[k] = dict(ZERO)
                n += 1
        sb = d.get('stylingBoxJson')
        if isinstance(sb, dict) and all(str(sb.get(k)) == '16' for k in ('paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft')):
            for k in ('paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'): sb[k] = '0'
            n += 1
    if n: notes.append(f'{c.get("componentName")}: tabs 0.46 surface reset ({n})')
    return n


def tab_gap(c, notes):
    """Gap between the tab bar and the first field. 0.46 tabs set `.ant-tabs-nav{margin:0}` (antd's default was a 16px
    bottom margin, which phase2 shows) and apply the component's padding to `.ant-tabs-body-holder`, i.e. BELOW the bar
    (tabs/styles.ts). So paddingTop 16 restores the phase2 gap. Only for top-positioned tabs whose stored top padding
    is 0/unset (the surface reset above writes 0); an author's own padding is kept."""
    if c.get('type') != 'tabs' or c.get('tabPosition') not in (None, '', 'top'): return 0
    n = 0
    for dev in ('desktop', 'tablet', 'mobile'):
        d = c.get(dev)
        if not isinstance(d, dict): continue
        sb = d.get('stylingBoxJson')
        if sb is None: sb = d['stylingBoxJson'] = {'_type': 'styleBox'}
        if not isinstance(sb, dict): continue
        if str(sb.get('paddingTop', '')) in ('', '0', 'None'):
            sb['paddingTop'] = '16'; n += 1
    if n: notes.append(f'{c.get("componentName")}: 16px gap under the tab bar')
    return n
