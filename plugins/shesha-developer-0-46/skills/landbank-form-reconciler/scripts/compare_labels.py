"""Label column width / text lines, p2 vs local (headless, read-only)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbbrowse import session, settle
path = '/dynamic/LandBank.Crm/LBOpportunity-details?id=818af5a4-f61a-468e-beea-074dde2e4d92'
JS = """() => { const vis=e=>e.offsetParent&&e.getBoundingClientRect().height>0;
 return [...document.querySelectorAll('.ant-form-item')].filter(vis).map(it=>{ const lc=it.querySelector('.ant-form-item-label'); const l=lc&&lc.querySelector('label'); if(!l) return null;
   const range=document.createRange(); range.selectNodeContents(l); const rects=[...range.getClientRects()]; const lines=new Set(rects.map(r=>Math.round(r.top))).size;
   const s=getComputedStyle(l), cs=getComputedStyle(lc);
   return [l.textContent.trim().slice(0,34), Math.round(lc.getBoundingClientRect().width), Math.round(l.getBoundingClientRect().width), lines, Math.round(it.getBoundingClientRect().height), s.fontSize, s.fontWeight, s.fontFamily.split(',')[0], cs.paddingRight, cs.flex.slice(0,12), Math.round(it.getBoundingClientRect().width)]; }).filter(Boolean); }"""
out = {}
for env in ('p2', 'local'):
    with session(env, {}) as pg:
        pg.set_viewport_size({'width': 1600, 'height': 1000})
        pg.goto(('https://landbankcrm-adminportal-lb-phase2.shesha.app' if env == 'p2' else 'http://localhost:3000') + path, timeout=180000)
        try: pg.wait_for_selector('.ant-form-item-label', timeout=180000)
        except Exception: pass
        settle(pg, 12000)
        out[env] = pg.evaluate(JS)
lm = {}
for r in out['local']: lm.setdefault(r[0], r)
print(f'{"label":34} | p2: colW lblW lines itemH font | local: colW lblW lines itemH font | itemW p2/local')
for r in out['p2'][:30]:
    o = lm.get(r[0])
    if not o: continue
    print(f'{r[0]:34} | {r[1]:4} {r[2]:4} {r[3]} {r[4]:3} {r[5]} {r[6]} {r[7][:10]} pr{r[8]} | {o[1]:4} {o[2]:4} {o[3]} {o[4]:3} {o[5]} {o[6]} {o[7][:10]} pr{o[8]} | {r[10]}/{o[10]}')
json.dump(out, open(os.path.join(__import__('paths').SWEEP, 'labels-opp.json'), 'w'), indent=1)
