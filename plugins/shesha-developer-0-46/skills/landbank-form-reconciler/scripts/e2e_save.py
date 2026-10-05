"""Functional check on LOCAL (a local copy of the phase2 database): open a details
page, click Edit, click Save WITHOUT changing anything, and report the write calls with their HTTP status, any UI error,
and whether the form returned to view mode. Saving unchanged values is the safest real test of the save path.
  python e2e_save.py <form> <recordId> [<form> <recordId> ...]
Value-changing checks must restore the exact original through the API afterwards (see references/workflow.md)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbbrowse import session, settle

args = sys.argv[1:]
for form, rid in zip(args[::2], args[1::2]):
    log = {}; calls = []
    try:
        with session('local', log, viewport=(1568, 950), allow_local_writes=True) as pg:
            pg.on('response', lambda r: (r.request.method in ('PUT', 'POST') and 'localhost:21021/api/' in r.url
                                         and not any(x in r.url for x in ('CheckPermissions', 'SyncClientApi')))
                  and calls.append(f'{r.status} {r.request.method} {r.url.split("/api/")[1][:90]}'))
            pg.goto(f'/dynamic/LandBank.Crm/{form}?id={rid}', timeout=300000)
            pg.wait_for_selector('[data-sha-form-name]', timeout=300000); settle(pg, 8000)
            pg.get_by_text('Edit', exact=True).first.click(timeout=60000); settle(pg, 5000)
            pg.get_by_role('button', name='Save').first.click(timeout=60000); settle(pg, 8000)
            ui = pg.evaluate("() => [...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, .ant-form-item-explain-error')].map(e=>e.innerText.trim().slice(0,140))")
            back = pg.evaluate("() => [...document.querySelectorAll('button, a')].some(b=>(b.innerText||'').trim()==='Edit')")
            print(json.dumps({'form': form, 'calls': calls, 'uiMessages': ui, 'backToView': back}))
    except Exception as e:
        print(json.dumps({'form': form, 'error': str(e)[:200], 'calls': calls}))
