"""Empty-label buttons inside field columns (hazard H26). LOCAL only.

  python hide_empty_buttons.py [--only form,form] [--push]

A container whose only child is a `button` with label `{_mode: 'code', _code: null}` (renders a blank 32px button),
sitting directly in a `columns` cell, pushes that column's rows down. The owner keeps these buttons (they may carry
actions) but does not want them shown: every such container in a columns block is moved, unchanged and in order, into
one row container placed directly after the columns, and the row gets `visible: false` (a hidden container renders
nothing and leaves no gap). The row is named `<columns>EmptyButtons046`; a columns block already handled is skipped.
"""
import sys, os, json, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push, walk
from localforms import fetch_all, modname

MODULE = 'LandBank.Crm'
SUFFIX = '-emptybuttons046'


def is_empty_button_container(c):
    kids = c.get('components') or []
    if c.get('type') != 'container' or len(kids) != 1 or kids[0].get('type') != 'button': return False
    lab = kids[0].get('label')
    return isinstance(lab, dict) and lab.get('_mode') == 'code' and not (lab.get('_code') or '').strip()


def holders(o, out):
    if isinstance(o, dict):
        for v in o.values(): holders(v, out)
    elif isinstance(o, list):
        for i, x in enumerate(o):
            if isinstance(x, dict) and 'type' in x and 'id' in x: out[x['id']] = (o, i)
            holders(x, out)
    return out


def t(m):
    notes = []
    for cols in [c for c, _, _ in walk(m) if c.get('type') == 'columns']:
        wrap_id = cols['id'] + SUFFIX
        if wrap_id in holders(m, {}): continue
        moved = []
        for cell in cols.get('columns') or []:
            lst = cell.get('components') or []
            for c in [x for x in lst if is_empty_button_container(x)]:
                lst.remove(c); moved.append(c)
        if not moved: continue
        plist, pi = holders(m, {})[cols['id']]
        wrap = copy.deepcopy({k: v for k, v in moved[0].items() if k != 'components'})
        wrap.update({'id': wrap_id, 'componentName': f'{cols.get("componentName")}EmptyButtons046',
                     'propertyName': f'{cols.get("componentName")}EmptyButtons046', 'label': 'Empty-label buttons (kept, hidden)',
                     'parentId': cols.get('parentId'), 'direction': 'horizontal', 'visible': False, 'components': moved})
        wrap.pop('hidden', None)
        for c in moved: c['parentId'] = wrap_id
        plist.insert(pi + 1, wrap)
        notes.append(f'{cols.get("componentName")}: {len(moved)} empty-label button container(s) moved into a hidden row')
    return notes


if __name__ == '__main__':
    a = sys.argv
    _, items = fetch_all()
    names = sorted(i['name'] for i in items if modname(i) == MODULE)
    if '--only' in a: names = [n for n in names if n in a[a.index('--only') + 1].split(',')]
    for n in names:
        push(MODULE, n, t, dry_run='--push' not in a)
