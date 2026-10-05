"""Rule: a refListStatus with no value renders an empty grey chip on 0.46 (phase2 rendered nothing): beside record
names on Account, Contact and case pages. Give every always-visible refListStatus the condition
`data?.<path> != null` (optional chaining on every hop). Components that already carry a visibility condition, or are
hidden, are left alone. Marked so it can be found/removed: /*reconciler:046-tag-null*/"""
MARK = '/*reconciler:046-tag-null*/'


def apply(c, notes):
    if c.get('type') != 'refListStatus': return 0
    pn = c.get('propertyName')
    if not isinstance(pn, str) or not pn or pn.startswith('_'): return 0
    v, h = c.get('visible'), c.get('hidden')
    if isinstance(v, dict) and v.get('_mode') == 'code': return 0
    if v is False or h is True or (isinstance(h, dict) and h.get('_mode') == 'code'): return 0
    if isinstance(v, dict) and v.get('_mode') == 'value' and v.get('_value') is False: return 0
    path = 'data?.' + '?.'.join(pn.split('.'))
    c['visible'] = {'_mode': 'code', '_code': f'{MARK}\nreturn {path} != null;', '_value': True}
    c.pop('hidden', None)
    notes.append(f'{c.get("componentName")}: visible only with a value ({pn})')
    return 1
