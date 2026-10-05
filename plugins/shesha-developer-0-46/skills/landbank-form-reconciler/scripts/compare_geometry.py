"""Compare label/value geometry local vs p2 (headless, read-only). Usage: cmp.py <path> <waitSelector>"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbbrowse import session, settle
path = sys.argv[1]; sel = sys.argv[2] if len(sys.argv) > 2 else '.ant-form-item-label'
JS = """() => { const vis=e=>e.offsetParent&&e.getBoundingClientRect().height>0; const root=document.querySelector('.ant-tabs')||document.body; const R=root.getBoundingClientRect();
 const items=[...document.querySelectorAll('.ant-form-item')].filter(vis).map(it=>{const l=it.querySelector('.ant-form-item-label label'); const c=it.querySelector('.ant-form-item-control'); if(!l||!c) return null; const lr=l.getBoundingClientRect(), cr=c.getBoundingClientRect();
   return [l.textContent.trim().slice(0,40), Math.round(lr.right-R.left), Math.round(cr.left-R.left), Math.round(cr.right-R.left), Math.round(lr.top-R.top), Math.round(it.getBoundingClientRect().height)]}).filter(Boolean);
 const scrollers=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e); return /(auto|scroll)/.test(s.overflowX) && e.scrollWidth>e.clientWidth+1;}).length;
 return {tabsX: Math.round(R.left), tabsW: Math.round(R.width), scrollers, items}; }"""
out = {}
for env in ('p2', 'local'):
    with session(env, {}) as pg:
        pg.set_viewport_size({'width': 1600, 'height': 1000})
        pg.goto(pg.url.split('/dynamic')[0] if False else None or (('https://landbankcrm-adminportal-lb-phase2.shesha.app' if env == 'p2' else 'http://localhost:3000') + path), timeout=180000)
        try: pg.wait_for_selector(sel, timeout=180000)
        except Exception: pass
        settle(pg, 8000)
        out[env] = pg.evaluate(JS)
        pg.screenshot(path=os.path.join(__import__('paths').SWEEP, f'{env}-{path.split("/")[-1].split("?")[0]}.png'))
p, l = out['p2'], out['local']
print('tabs x/w  p2', p['tabsX'], p['tabsW'], '| local', l['tabsX'], l['tabsW'], '| scrollers p2', p['scrollers'], 'local', l['scrollers'])
lm = {}
for it in l['items']: lm.setdefault(it[0], it)
print(f'{"label":40} {"p2 lblR ctlL ctlR top h":>26} | {"local":>24} | dx')
for it in p['items'][:40]:
    o = lm.get(it[0])
    if not o: print(f'{it[0]:40} {str(it[1:]):>26} | missing'); continue
    print(f'{it[0]:40} {str(it[1:]):>26} | {str(o[1:]):>24} | {o[1]-it[1]:+d} {o[2]-it[2]:+d} {o[3]-it[3]:+d} dy{o[4]-it[4]:+d}')
json.dump(out, open(os.path.join(__import__('paths').SWEEP, 'cmp-' + path.split('/')[-1].split('?')[0] + '.json'), 'w'), indent=1)
