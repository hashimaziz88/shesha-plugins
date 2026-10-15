"""Rule (hazard H36): a datatable column on a URL-sourced table (`datatableContext.sourceType = 'Url'`) whose display
component is '[default]' shows the RAW value of a reference-list property on 0.46 (Opportunity > Documents: Document column
'12', '20', '23' instead of 'Business Plan', ...). 0.43 resolved the list from the context's entity type; 0.46's default
display gets no property metadata for URL data. Sibling tables already bind the column to a dropdown display with the
reference list and render names.
Fix (configuration only): for each such column whose property is a reference list in the context entity's metadata, use a
dropdown display bound to that list (copied from a working dropdown display in the same form when present, else the
DocumentType one in loan-application-documents-subform). Read-only display; stored values unchanged. Idempotent.
LOCAL only.  python url_reflist_columns.py [--only form,form] [--push]"""
import copy, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push, LocalWriter
from localforms import fetch_all, modname


def _meta(api, cache, et):
    if et not in cache:
        r = api.get('/api/services/app/Metadata/Get', entityType=et)['result']
        cache[et] = {(p.get('path') or '').lower(): p for p in r.get('properties', [])}
    return cache[et]


def _reflist(p):
    if not p: return None
    r = p.get('referenceListId')
    if isinstance(r, dict) and r.get('name'): return {'name': r['name'], 'module': r.get('module')}
    if p.get('referenceListName'): return {'name': p['referenceListName'], 'module': p.get('referenceListModule')}
    return None


def _templates(m):
    out = []
    def walk(o):
        if isinstance(o, dict):
            d = o.get('displayComponent')
            if isinstance(d, dict) and d.get('type') == 'dropdown' and ((d.get('settings') or {}).get('dataSourceType') == 'referenceList'):
                out.append(d)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(m); return out


def plan_columns(m, api, cache):
    """[(column dict, reflist)] for '[default]' columns on Url-sourced tables whose entity property is a reference list."""
    out = []
    def walk(o, ctx=None):
        if isinstance(o, dict):
            if o.get('type') == 'datatableContext': ctx = o
            if o.get('type') == 'datatable' and ctx is not None and ctx.get('sourceType') == 'Url' and ctx.get('entityType'):
                et = ctx['entityType']; et = et.get('fullClassName') if isinstance(et, dict) else et
                props = _meta(api, cache, et)
                for c in o.get('items', []):
                    d = (c.get('displayComponent') or {}).get('type')
                    rl = _reflist(props.get((c.get('propertyName') or '').lower()))
                    if c.get('columnType') == 'data' and d in ('[default]', None) and rl: out.append((c, rl))
            for v in o.values(): walk(v, ctx)
        elif isinstance(o, list):
            for v in o: walk(v, ctx)
    walk(m); return out


def main():
    a = sys.argv[1:]; do_push = '--push' in a
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    api, items = fetch_all(); cache = {}
    forms = {i['name']: json.loads(i['markup']) for i in items if modname(i) == 'LandBank.Crm' and i.get('markup')}
    fallback = next(iter(_templates(forms['loan-application-documents-subform'])), None)
    assert fallback, 'anchor: no reference-list dropdown display template in loan-application-documents-subform'
    for name, m in forms.items():
        if only and name not in only: continue
        if not plan_columns(m, api, cache): continue
        def t(markup, name=name):
            notes = []
            tpl = next(iter(_templates(markup)), fallback)
            for c, rl in plan_columns(markup, api, cache):
                d = copy.deepcopy(tpl)
                d['settings']['id'] = hashlib.sha1(f'{name}:{c.get("id")}'.encode()).hexdigest()[:22] + '-rl046'
                d['settings']['referenceListId'] = rl
                c['displayComponent'] = d
                notes.append(f'{c.get("caption")} ({c.get("propertyName")}): dropdown display bound to {rl["module"]}/{rl["name"]}')
            return notes
        push('LandBank.Crm', name, t, dry_run=not do_push)


if __name__ == '__main__':
    main()
