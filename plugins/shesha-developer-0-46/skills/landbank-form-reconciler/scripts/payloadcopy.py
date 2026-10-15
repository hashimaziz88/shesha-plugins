"""Rule (hazard H39): in a 0.46 action script `delete data.<prop>` has no effect (`data` is a proxy that ignores deletes),
so a script that strips helper fields and then posts `{...data}` sends them anyway and the 0.46 dynamic CRUD rejects them
("Property 'requestedAmount' not found for 'ApplicationLoanPurpose'"): Add Loan Purpose saved nothing, so no application
could be initiated. 0.43 honoured the deletes.
Fix: copy `data` into a local object before the first `delete data.`, delete from the copy, and spread the copy where the
script spread `data` afterwards. Reads of `data.<x>` are unchanged. Only scripts that both delete from `data` and spread it
afterwards are touched. Marked /*reconciler:046-payload-copy*/. Idempotent."""
import re

MARK = '/*reconciler:046-payload-copy*/'
VAR = '__payload046'


def rewrite(code):
    if MARK in code: return None
    m = re.search(r'\bdelete\s+data\.', code)
    if not m: return None
    head, tail = code[:m.start()], code[m.start():]
    if not re.search(r'\.\.\.\s*data\b(?!\s*\.)', tail): return None
    line_start = head.rfind('\n') + 1
    indent = re.match(r'[ \t]*', head[line_start:]).group(0)
    tail = re.sub(r'\bdelete\s+data\.', f'delete {VAR}.', tail)
    tail = re.sub(r'\.\.\.(\s*)data\b(?!\s*\.)', rf'...\1{VAR}', tail)
    return head[:line_start] + f'{indent}{MARK}\n{indent}const {VAR} = {{ ...data }};\n' + head[line_start:] + tail


def apply_all(markup, notes):
    n = 0
    def walk(o, owner=None):
        nonlocal n
        if isinstance(o, dict):
            owner = o.get('label') or o.get('componentName') or owner
            for k, v in list(o.items()):
                if isinstance(v, dict) and v.get('_mode') == 'code' and isinstance(v.get('_code'), str):
                    r = rewrite(v['_code'])
                    if r: v['_code'] = r; n += 1; notes.append(f'{owner}.{k}: payload copied before deleting helper fields (H39)')
                elif k == 'expression' and isinstance(v, str):
                    r = rewrite(v)
                    if r: o[k] = r; n += 1; notes.append(f'{owner} script: payload copied before deleting helper fields (H39)')
            for v in o.values(): walk(v, owner)
        elif isinstance(o, list):
            for v in o: walk(v, owner)
    walk(markup)
    return n
