import json, os, sys, re
from lbapi import Api
from paths import SNAPSHOTS as OUT
def page(a, flt=None):
    items, skip = [], 0
    while True:
        p = {'MaxResultCount': 100, 'SkipCount': skip}
        if flt: p['Filter'] = json.dumps(flt)
        r = a.get('/api/services/Shesha/FormConfiguration/GetAll', **p)['result']
        items += r['items']; skip += 100
        if skip >= r['totalCount'] or not r['items']: return items, r['totalCount']
def modname(it):
    m = it.get('module'); return (m.get('name') if isinstance(m, dict) else m) or '_nomodule'
for env, flt in (('046', None), ('p2', {'==': [{'var': 'versionStatus'}, 3]})):
    a = Api(env); items, total = page(a, flt)
    if env == 'p2':  # keep live only, belt and braces
        items = [i for i in items if i.get('versionStatus') == 3]
    idx = []
    for it in items:
        mn = modname(it); d = os.path.join(OUT, env, re.sub(r'[^\w.-]', '_', mn)); os.makedirs(d, exist_ok=True)
        fn = re.sub(r'[^\w.-]', '_', it['name']) + '.json'
        mk = it.get('markup')
        try: mk = json.loads(mk) if isinstance(mk, str) and mk else mk
        except Exception: pass
        json.dump({k: v for k, v in it.items() if k != 'markup'} | {'markup': mk}, open(os.path.join(d, fn), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        idx.append({'module': mn, 'name': it['name'], 'id': it['id'], 'version': it.get('versionNo'), 'file': f'{env}/{os.path.basename(d)}/{fn}', 'hasMarkup': bool(mk)})
    json.dump(idx, open(os.path.join(OUT, f'{env}-index.json'), 'w'), indent=1)
    from collections import Counter
    print(env, 'server total', total, 'kept', len(idx), Counter(i['module'] for i in idx).most_common(8))
