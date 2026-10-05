"""Read-only Playwright harness for the two deployed LandBank portals.
CLI:  python lbbrowse.py <env 046|p2> <path-or-url> <outprefix> [--tabs] [--wait ms] [--full]
Writes <outprefix>.png, <outprefix>.json (console, blocked writes, failed requests, layout probe, tab labels).
Guard: aborts every PUT/PATCH/DELETE and every POST not on the read allowlist. Never clicks buttons except
tab headers when --tabs is given (it walks each top-level tab and screenshots <outprefix>-tabN.png)."""
import json, os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from lbapi import Api, FRONT
READ_POST = re.compile(r'(TokenAuth/Authenticate|/GetAll|/Get\b|/GetJson|/Query|/Spreadsheet/Open|/Metadata|/GetByName|/Autocomplete|/List|/Search|/Count|/GetValue|/GetSettings|graphql|/CheckPermissions|signalr/negotiate|/GetCurrentLoginInfo|/GetUserConfig|EntityConfig/SyncClientApi|/GetUserValue|/signalr)', re.I)
PROBE = r"""() => {
 const out = {tabs:[], htmlRenderPlaceholders:0, requiredErrors:0, emptyLabels:0, overlaps:[], spinners:0, fonts:{}, header:null};
 document.querySelectorAll('.ant-tabs').forEach((t,i)=>{ const labs=[...t.querySelectorAll(':scope > .ant-tabs-nav .ant-tabs-tab')].map(x=>x.innerText.trim());
   const cs=getComputedStyle(t.querySelector(':scope > .ant-tabs-nav')||t); out.tabs.push({i, labs, navBg:cs.backgroundColor, navH:(t.querySelector(':scope > .ant-tabs-nav')||t).getBoundingClientRect().height}); });
 out.htmlRenderPlaceholders = [...document.querySelectorAll('*')].filter(e=>e.childElementCount===0 && /provide some content for this HTML render/i.test(e.textContent||'')).length;
 out.requiredErrors = [...document.querySelectorAll('.ant-form-item-explain-error')].filter(e=>/required/i.test(e.textContent)).length;
 out.spinners = document.querySelectorAll('.ant-spin-spinning').length;
 out.styleTags = [...document.querySelectorAll('style')].filter(s=>/chevtabs|ant-tabs/.test(s.textContent)).length;
 const b=document.body; const f=getComputedStyle(b); out.fonts={family:f.fontFamily,size:f.fontSize};
 const items=[...document.querySelectorAll('.ant-form-item')]; out.formItems=items.length;
 out.emptyLabels = items.filter(it=>{const l=it.querySelector('.ant-form-item-label'); return l && !l.innerText.trim();}).length;
 const h=document.querySelector('.ant-tabs'); out.firstTabsTop = h? h.getBoundingClientRect().top : null;
 return out; }"""
import contextlib
from paths import STATE as STATE_DIR
from paths import CRED
def _login(pg, env):
    pg.goto(FRONT[env] + '/login', wait_until='domcontentloaded', timeout=180000); pg.wait_for_timeout(3000)
    c = json.load(open(CRED))
    pg.get_by_placeholder(re.compile('^user', re.I)).first.fill(c['username'], timeout=120000)
    pg.get_by_placeholder(re.compile('^pass', re.I)).first.fill(c['password'])
    pg.get_by_role('button', name='Sign In', exact=True).first.click(timeout=120000)
    pg.wait_for_url(lambda u: '/login' not in u, timeout=180000)
@contextlib.contextmanager
def session(env, log=None, viewport=(1600, 1000), allow_local_writes=False):
    """Yields a logged-in, write-guarded Playwright page. Reuses a cached login (0.46 rate-limits logins to 10/min).
    log: dict that collects console/blocked/failed. Usage: with session('046') as pg: pg.goto(...)"""
    log = log if log is not None else {}
    for k in ('console', 'blocked', 'failed'): log.setdefault(k, [])
    os.makedirs(STATE_DIR, exist_ok=True); sf = os.path.join(STATE_DIR, f'{env}.json')
    fresh = os.path.exists(sf) and time.time() - os.path.getmtime(sf) < 40 * 60
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        ctx = br.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, storage_state=sf if fresh else None)
        ctx.add_init_script("try{localStorage.setItem('CONFIGURATION_ITEM_MODE','\"live\"')}catch(e){}")
        def guard(route, req):
            # allow_local_writes: functional checks only, and only against the LOCAL backend
            if allow_local_writes and env == 'local' and req.url.startswith('http://localhost:21021/'):
                if req.method != 'GET': log.setdefault('writes', []).append(req.method + ' ' + req.url[:160])
                return route.continue_()
            if req.method in ('PUT', 'PATCH', 'DELETE') or (req.method == 'POST' and not READ_POST.search(req.url)):
                log['blocked'].append(req.method + ' ' + req.url); return route.abort()
            return route.continue_()
        ctx.route('**/*', guard)
        pg = ctx.new_page()
        pg.on('console', lambda m: m.type in ('error', 'warning') and log['console'].append(m.type + ': ' + m.text[:300]))
        pg.on('requestfailed', lambda r: log['failed'].append(r.method + ' ' + r.url[:200]))
        pg.on('response', lambda r: r.status >= 400 and log['failed'].append(f'{r.status} {r.request.method} {r.url[:200]}'))
        if not fresh:
            _login(pg, env); tmp = sf + f'.{os.getpid()}.tmp'; ctx.storage_state(path=tmp); os.replace(tmp, sf)
        orig_goto = pg.goto
        def goto(url, **kw):
            url = url if url.startswith('http') else FRONT[env] + url
            r = orig_goto(url, **({'wait_until': 'domcontentloaded'} | kw)); pg.wait_for_timeout(1500)
            if '/login' in pg.url:  # cached session expired
                _login(pg, env); tmp = sf + f'.{os.getpid()}.tmp'; ctx.storage_state(path=tmp); os.replace(tmp, sf)
                r = orig_goto(url, **({'wait_until': 'domcontentloaded'} | kw))
            return r
        pg.goto = goto
        try: yield pg
        finally: br.close()
def settle(pg, wait=6000):
    pg.wait_for_timeout(wait)
    try: pg.wait_for_load_state('networkidle', timeout=20000)
    except Exception: pass
def run(env, target, outp, walk_tabs=False, wait=6000, full=False):
    log = {'url': target}
    with session(env, log) as pg:
        pg.goto(target); settle(pg, wait); log['finalUrl'] = pg.url
        pg.screenshot(path=outp + '.png', full_page=full)
        log['probe'] = pg.evaluate(PROBE)
        log['sidebar'] = pg.evaluate("() => [...document.querySelectorAll('a[href]')].map(a=>({t:(a.innerText||a.getAttribute('title')||a.getAttribute('aria-label')||'').trim(),h:a.getAttribute('href')})).filter(x=>/dynamic|shesha|settings/.test(x.h))")
        if walk_tabs:
            tabs = pg.locator('.ant-tabs').first.locator(':scope > .ant-tabs-nav .ant-tabs-tab')
            for i in range(tabs.count()):
                try:
                    tabs.nth(i).click(); settle(pg, wait)
                    pg.screenshot(path=f'{outp}-tab{i}.png', full_page=full); log.setdefault('tabProbes', []).append(pg.evaluate(PROBE))
                except Exception as e: log.setdefault('tabErrors', []).append(f'{i}: {e}'[:200])
    json.dump(log, open(outp + '.json', 'w'), indent=1)
    return log
if __name__ == '__main__':
    ar = sys.argv[1:]; env, tgt, outp = ar[0], ar[1], ar[2]
    w = int(ar[ar.index('--wait') + 1]) if '--wait' in ar else 6000
    r = run(env, tgt, outp, '--tabs' in ar, w, '--full' in ar)
    print(json.dumps({'finalUrl': r.get('finalUrl'), 'probe': r.get('probe'), 'blocked': len(r['blocked']), 'console': len(r['console']), 'failed': len(r['failed'])}, indent=0)[:1500])
