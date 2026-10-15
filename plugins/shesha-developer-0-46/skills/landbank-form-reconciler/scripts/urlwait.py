"""Rule (hazard H40): a URL-sourced table context (`sourceType: 'Url'`, endpoint with `{{data.id}}`) fetches when it mounts.
When it mounts before the record has loaded, 0.46 calls the endpoint with an EMPTY id (400 "The value '' is invalid") and
does not fetch again once `{{data.id}}` resolves; the table stays empty (Opportunity > Documents: Main Applicant / Related
Party / Farms tables empty, so the documents the initiation gate asks for could not be uploaded). 0.43 showed them.
Fix: make the context visible only once every id-like value its endpoint needs exists - it then mounts, and fetches, with
real ids. Only static-visibility contexts whose mustache parameters are all id-like (`data.id`, `data.xxxId`) are gated;
filter parameters (which may legitimately be empty) are left alone. Marked /*reconciler:046-url-wait*/. Idempotent."""
import re

MARK = '/*reconciler:046-url-wait*/'
IDLIKE = re.compile(r'^data\.(id|[A-Za-z0-9_]*Id)$')


def apply(c, notes):
    if c.get('type') not in ('datatableContext', 'dataContext') or c.get('sourceType') != 'Url': return 0
    ep = c.get('endpoint'); ep = ep.get('url') if isinstance(ep, dict) else ep
    params = re.findall(r'\{\{\s*([^}]+?)\s*\}\}', str(ep or ''))
    if not params or not all(IDLIKE.match(p) for p in params): return 0
    v, h = c.get('visible'), c.get('hidden')
    if isinstance(v, dict) and MARK in (v.get('_code') or ''): return 0
    if (isinstance(v, dict) and (v.get('_code') or '').strip()) or (isinstance(h, dict) and (h.get('_code') or '').strip()): return 0
    if v is False or h is True: return 0
    cond = ' && '.join('!!' + p.replace('data.', 'data?.') for p in dict.fromkeys(params))
    c['visible'] = {'_mode': 'code', '_code': f'{MARK}\n// mount (and fetch) only once the record ids are loaded\nreturn {cond};', '_value': True}
    c.pop('hidden', None)
    notes.append(f'{c.get("componentName")}: fetches only once {", ".join(dict.fromkeys(params))} is loaded (H40)')
    return 1
