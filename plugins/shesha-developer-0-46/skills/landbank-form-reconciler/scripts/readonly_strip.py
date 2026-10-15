"""Rule (hazard H42): the 0.46 dynamic CRUD rejects READ-ONLY (calculated) properties in a create/update payload
("Your request is not valid! Property 'totalInsurance' is readonly.") where 0.43 ignored them. Forms that display a
calculated value, or host a subform whose entity is updated in cascade, post it and the whole save fails
(Opportunity Edit > Save; Add Moveable Asset). Fix: the form's onPrepareSubmitData deletes every property the entity
metadata marks `readonly` - on the form's model and, for entity references updated in cascade (`cascadeUpdate`), under
that reference - before `return data;`. Deleting an absent key is a no-op; read-only values were never stored by 0.43
either. Marked /*reconciler:046-readonly-strip*/; regenerated in place, so idempotent.
LOCAL only.  python readonly_strip.py [--only form,form] [--push]"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push
from localforms import fetch_all, modname

MARK = '/*reconciler:046-readonly-strip*/'
END = '/*end:046-readonly-strip*/'


def camel(p): return p[:1].lower() + p[1:] if p else p


class Meta:
    def __init__(self, api): self.api, self.cache = api, {}

    def get(self, et):
        if et not in self.cache:
            try: self.cache[et] = self.api.get('/api/services/app/Metadata/Get', entityType=et)['result'].get('properties', [])
            except Exception: self.cache[et] = None
        return self.cache[et]

    def resolve(self, short, module):
        for cand in (f'{module}.Domain.{short}', f'{module}.Domain.{short}s.{short}', f'{module}.Domain.LoanApplications.{short}', short):
            if self.get(cand): return cand
        return None


def bound_roots(m):
    roots = set()
    def walk(o):
        if isinstance(o, dict):
            p = o.get('propertyName')
            if isinstance(p, str) and p and o.get('type'): roots.add(p.split('.')[0])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(m); return roots


def strip_block(meta, model):
    props = meta.get(model)
    if not props: return None
    top = sorted(camel(p['path']) for p in props if p.get('readonly'))
    nested = {}
    for p in props:
        if p.get('dataType') == 'entity' and p.get('cascadeUpdate') and p.get('entityType'):
            et = meta.resolve(p['entityType'], p.get('entityModule') or '')
            sub = meta.get(et) if et else None
            ro = sorted(camel(x['path']) for x in (sub or []) if x.get('readonly'))
            if ro: nested[camel(p['path'])] = ro
    if not top and not nested: return None
    lines = [MARK, '// 0.46 CRUD rejects read-only (calculated) properties that 0.43 ignored - strip them before submit (H42).']
    if top: lines.append('for (const __k of ' + json.dumps(top) + ') { if (data && __k in data) delete data[__k]; }')
    for ref, ro in nested.items():
        lines.append(f'if (data && data.{ref} && typeof data.{ref} === "object") {{ for (const __k of {json.dumps(ro)}) {{ delete data.{ref}[__k]; }} }}')
    lines.append(END)
    return '\n'.join(lines)


def apply(markup, meta):
    fs = markup.setdefault('formSettings', {})
    model = fs.get('modelType')
    if not isinstance(model, str) or not model: return []
    # only forms that submit through the default dynamic CRUD endpoints (a custom endpoint may accept these values)
    if fs.get('dataSubmitterType') not in (None, 'gql'): return []
    gql = (fs.get('dataSubmittersSettings') or {}).get('gql') or {}
    if gql.get('endpointType') not in (None, 'default'): return []
    block = strip_block(meta, model)
    if not block: return []
    code = fs.get('onPrepareSubmitData') or ''
    if MARK in code:
        old = code[code.index(MARK):code.index(END) + len(END)]
        if old == block: return []
        fs['onPrepareSubmitData'] = code.replace(old, block); return ['read-only strip refreshed']
    if code.strip():
        rets = [m.start() for m in re.finditer(r'return\s+data\s*;\s*$', code.rstrip(), re.M)]
        if not rets: return []   # unknown shape: leave alone (reported by the caller)
        i = rets[-1]
        fs['onPrepareSubmitData'] = code[:i] + block + '\n' + code[i:]
    else:
        fs['onPrepareSubmitData'] = block + '\nreturn data;'
    return [f'onPrepareSubmitData strips read-only properties of {model.split(".")[-1]} (H42)']


def main():
    a = sys.argv[1:]; do_push = '--push' in a
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    api, items = fetch_all(); meta = Meta(api)
    for i in items:
        if modname(i) != 'LandBank.Crm' or not i.get('markup') or (only and i['name'] not in only): continue
        probe = json.loads(i['markup'])
        if not apply(probe, meta): continue
        push('LandBank.Crm', i['name'], lambda m: apply(m, meta), dry_run=not do_push)


if __name__ == '__main__':
    main()
