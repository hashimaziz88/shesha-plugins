import json
from lbapi import Api
def modname(i):
    m=i.get('module'); return m.get('name') if isinstance(m,dict) else m
def fetch_all(env='local'):
    a=Api(env); r=a.get('/api/services/Shesha/FormConfiguration/GetAll',MaxResultCount=1000)['result']
    return a,r['items']
def fetch(a, module, name):
    items=a.get('/api/services/Shesha/FormConfiguration/GetAll',MaxResultCount=1000)['result']['items']
    m=[i for i in items if modname(i)==module and i['name']==name]
    assert len(m)==1, f'{module}/{name}: {len(m)} matches'
    return m[0]
def walk(o, d=0, parent=None):
    if isinstance(o,dict):
        if 'type' in o and 'id' in o: yield d, o, parent; parent=o; d+=1
        for v in o.values(): yield from walk(v,d,parent)
    elif isinstance(o,list):
        for v in o: yield from walk(v,d,parent)
