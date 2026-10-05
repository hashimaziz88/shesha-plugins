"""Rule (hazard H41): 0.46 no longer puts data table contexts into `globalState`, so an `Execute Script` action that ends
with `globalState?.<ctx>?.refreshTable()` refreshes nothing (Opportunity > Documents: after Manage File Versions > OK
the row stays 'Not Uploaded' until a page reload; 0.43 refreshed it). `contexts.<ctx>` holds the table state only (no
refreshTable).
Fix: remove the dead call and chain the standard `Refresh table` action (owner = that context's component id, the shape
of 245 working instances) after the script, ahead of any existing onSuccess. Only contexts defined once in the SAME
form are handled; a context in another (host) form is reported and left alone. Proof (local test record, real upload):
baseline - UpdateStatus only, row 'Not Uploaded'; chained - UpdateStatus then GetForApplication, row 'Uploaded'.
Marked /*reconciler:046-refresh-chain*/ in the script. Idempotent (the dead call is gone after the first run)."""
import re, sys

MARK = '/*reconciler:046-refresh-chain*/'
CALL = re.compile(r'globalState\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*refreshTable\s*\(\s*\)\s*;?')


def _contexts(m):
    seen = {}
    def walk(o):
        if isinstance(o, dict):
            if o.get('type') == 'datatableContext' and o.get('componentName'):
                seen.setdefault(o['componentName'], []).append(o['id'])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(m)
    return {k: v[0] for k, v in seen.items() if len(v) == 1}


def apply_all(m, notes):
    ids = _contexts(m); n = 0
    def walk(o):
        nonlocal n
        if isinstance(o, dict):
            args = o.get('actionArguments') if o.get('actionName') == 'Execute Script' else None
            ex = args.get('expression') if isinstance(args, dict) else None
            if isinstance(ex, str):
                calls = list(CALL.finditer(ex))
                if calls:
                    names = list(dict.fromkeys(c.group(1) for c in calls))
                    if len(names) == 1 and names[0] in ids:
                        for c in calls: ex = ex.replace(c.group(0), f'{MARK} /* table refresh moved to a chained Refresh table action (H41) */')
                        args['expression'] = ex
                        tail = {'_type': 'action-config', 'actionName': 'Refresh table', 'actionOwner': ids[names[0]],
                                'handleSuccess': bool(o.get('handleSuccess') and o.get('onSuccess')), 'handleFail': False}
                        if o.get('handleSuccess') and o.get('onSuccess'): tail['onSuccess'] = o['onSuccess']
                        o['handleSuccess'] = True; o['onSuccess'] = tail; n += 1
                        notes.append(f'script refresh of {names[0]} -> chained Refresh table (H41)')
                    else:
                        print(f'   report: refresh of {names[:4]} not converted - context not defined once in this form (H41, review by hand)', file=sys.stderr)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(m)
    return n
