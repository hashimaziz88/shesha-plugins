"""Rule (hazard H43): a URL-sourced table context that still carries a permanent filter (a leftover from when it was
entity-sourced) whose REQUIRED mustache value can never resolve on this form - e.g. `{{data.loanApplication.id}}` on a
form whose data IS the loan application - never fetches on 0.46: the filter stays "not ready", so the request is never
issued and the table shows "No Data" (Opportunity > Documents > Related Party Documents: the SA ID / Spouse ID /
Marriage Certificate rows the initiation gate asks for could not be uploaded, so no entity with parties could be
initiated). 0.43 fetched the URL without the filter (phase2 capture: GetForParticipant?loanApplicationId=..., no filter).
Fix: remove that permanent filter. Only filters whose every mustache expression starts with `data.<prop>` where <prop> is
neither `id` nor a property of the form's model are removed; anything else is reported and left alone (0.46 does send a
resolvable filter to the URL endpoint). Idempotent (a removed filter is not re-found).
LOCAL only.  python urlfilter.py [--only form,form] [--push]"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push
from localforms import fetch_all, modname


def camel(p): return p[:1].lower() + p[1:] if p else p


class Meta:
    def __init__(self, api): self.api, self.cache = api, {}

    def props(self, et):
        if et not in self.cache:
            try: self.cache[et] = {camel(p['path']) for p in self.api.get('/api/services/app/Metadata/Get', entityType=et)['result'].get('properties', [])}
            except Exception: self.cache[et] = None
        return self.cache[et]


def contexts(o):
    if isinstance(o, dict):
        if o.get('type') in ('datatableContext', 'dataContext') and o.get('sourceType') == 'Url' and o.get('permanentFilter'): yield o
        for v in o.values(): yield from contexts(v)
    elif isinstance(o, list):
        for v in o: yield from contexts(v)


def apply(markup, meta, report=None):
    model = (markup.get('formSettings') or {}).get('modelType')
    props = meta.props(model) if isinstance(model, str) and model else None
    notes = []
    for c in contexts(markup):
        exprs = re.findall(r'\{\{\s*([^}]+?)\s*\}\}', json.dumps(c['permanentFilter']))
        dead = [e for e in exprs if props is not None and re.match(r'^data\.([A-Za-z0-9_]+)', e)
                and re.match(r'^data\.([A-Za-z0-9_]+)', e).group(1) not in props | {'id'}]
        if exprs and len(dead) == len(exprs):
            c.pop('permanentFilter')
            notes.append(f'{c.get("componentName")}: leftover permanent filter on {", ".join(dead)} (never resolves on {model.split(".")[-1]}) removed - the URL source fetches again (H43)')
        elif report is not None:
            report.append((c.get('componentName'), exprs, 'model unknown' if props is None else 'resolvable - left alone'))
    return notes


def main():
    a = sys.argv[1:]; do_push = '--push' in a
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    api, items = fetch_all(); meta = Meta(api)
    for i in items:
        if modname(i) != 'LandBank.Crm' or not i.get('markup') or (only and i['name'] not in only): continue
        rep = []
        if not apply(json.loads(i['markup']), meta, rep):
            for r in rep: print('  skip', i['name'], *r)
            continue
        push('LandBank.Crm', i['name'], lambda m: apply(m, meta), dry_run=not do_push)


if __name__ == '__main__':
    main()
