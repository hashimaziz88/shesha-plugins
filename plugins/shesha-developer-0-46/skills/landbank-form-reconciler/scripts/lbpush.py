"""LOCAL-ONLY form push for Shesha 0.46 (FormConfiguration/UpdateMarkup writes Markup in place, no revision).

Safety:
- Refuses any base URL that is not http(s)://localhost.
- Backs up the current form row to S/local/before/<module>__<name>.<stamp>.json before writing.
- Carries modelType forward (UpdateMarkup overwrites ModelType with whatever is sent; omitting it nulls it).
- Omits access/permissions (null -> server skips the permission write).
- Reads the form back and asserts the stored markup equals what was sent.

Transforms are functions (markup_dict) -> list[str] of change notes. They must assert their anchors and be
idempotent (return [] when already applied). A transform that raises aborts the push for that form.
"""
import json, os, sys, time, urllib.request
from lbapi import Api, HOSTS
from localforms import modname

from paths import BACKUPS as ROOT


class LocalWriter(Api):
    def __init__(self):
        assert HOSTS['local'].startswith(('http://localhost', 'https://localhost')), HOSTS['local']
        super().__init__('local')

    def put(self, path, body):
        assert self.base.startswith(('http://localhost', 'https://localhost')), 'refusing non-local write'
        req = urllib.request.Request(self.base + path, json.dumps(body).encode(),
                                     {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token}, method='PUT')
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode('utf-8', 'replace')


_IDX = {}


def _find(a, module, name):
    """Fresh read of one form. Name->id index is built once per process (GetAll is heavy); the row itself is
    re-read by id every time so read-back is never served from the index."""
    if not _IDX:
        items = a.get('/api/services/Shesha/FormConfiguration/GetAll', MaxResultCount=1000)['result']['items']
        for i in items:
            _IDX.setdefault((modname(i), i['name']), []).append(i['id'])
    ids = _IDX.get((module, name), [])
    assert len(ids) == 1, f'{module}/{name}: {len(ids)} matches'
    row = a.get('/api/services/Shesha/FormConfiguration/Get', id=ids[0])['result']
    assert row and row.get('id') == ids[0] and 'markup' in row, f'{module}/{name}: unexpected Get payload'
    return row


def push(module, name, transform, dry_run=False):
    w = LocalWriter()
    row = _find(w, module, name)
    markup = json.loads(row['markup'])
    notes = transform(markup)
    if not notes:
        print(f'[{name}] no change (already applied)'); return []
    new_markup = json.dumps(markup, ensure_ascii=False)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    os.makedirs(os.path.join(ROOT, 'before'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'after'), exist_ok=True)
    json.dump(row, open(os.path.join(ROOT, 'before', f'{module}__{name}.{stamp}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(markup, open(os.path.join(ROOT, 'after', f'{module}__{name}.{stamp}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'[{name}] {len(notes)} change(s):'); [print('   -', n) for n in notes]
    if dry_run:
        print(f'[{name}] DRY RUN - not pushed'); return notes
    status, body = w.put('/api/services/Shesha/FormConfiguration/UpdateMarkup',
                         {'id': row['id'], 'markup': new_markup, 'modelType': row.get('modelType')})
    assert status == 200, (status, body[:300])
    back = _find(w, module, name)
    assert back['markup'] == new_markup, 'READ-BACK MISMATCH'
    assert back.get('modelType') == row.get('modelType'), ('modelType changed', back.get('modelType'))
    print(f'[{name}] pushed + read-back verified (id {row["id"]}, modelType {row.get("modelType")})')
    return notes


def walk(o, parent=None):
    """yield (component, parent_list, index) for every component dict in the markup tree."""
    if isinstance(o, list):
        for i, v in enumerate(o):
            if isinstance(v, dict) and 'type' in v and 'id' in v:
                yield v, o, i
            yield from walk(v, o)
    elif isinstance(o, dict):
        for v in o.values():
            if isinstance(v, (list, dict)):
                yield from walk(v, o)


def one(markup, cid, ctype=None, cname=None):
    hits = [(c, pl, i) for c, pl, i in walk(markup) if c['id'] == cid]
    assert len(hits) == 1, f'anchor {cid}: {len(hits)} hits'
    c = hits[0][0]
    if ctype: assert c['type'] == ctype, f'anchor {cid}: type {c["type"]} != {ctype}'
    if cname: assert c.get('componentName') == cname, f'anchor {cid}: name {c.get("componentName")} != {cname}'
    return hits[0]
