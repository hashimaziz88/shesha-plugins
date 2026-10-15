"""Safe-chain rule for render-time Shesha scripts (0.46 treats a throwing visibility expression as VISIBLE and logs
executeScriptSync errors for every render).

Rewrites, in render-time settings only:
  data.a.b / formData.a.b / form.data.a.b   ->  data?.a?.b ...   (root + >=2 member accesses)
  x?.a.b  (any root already marked nullable) ->  x?.a?.b
Never rewrites an assignment target (x.a.b = ..., x.a.b += ..., ++x.a.b) - optional chaining is invalid there.
"""
import json, re, subprocess

ROOTS = ('form._data', 'form.data', 'formData', 'data')
ROOTED = re.compile(r'(?<![\w$.])(?:form\.(?:_data|data)|formData|data)(?:\??\.[A-Za-z_$][\w$]*){2,}')
NULLABLE = re.compile(r'(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\?\.[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+')
ASSIGN_AFTER = re.compile(r'\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)')
INCDEC_BEFORE = re.compile(r'(?:\+\+|--)\s*$')
RENDER_KEYS = {'style', 'queryParams', 'customVisibility', 'customEnabled'}


def _fix_chain(chain):
    root = next((r for r in ROOTS if chain.startswith(r) and not chain[len(r):len(r) + 1].isalnum()), None)
    if root:
        head, rest = root, chain[len(root):]
    else:
        # nullable root: keep everything up to and including the first '?.' as written
        i = chain.index('?.') + 2
        j = re.match(r'[A-Za-z_$][\w$]*', chain[i:]).end() + i
        head, rest = chain[:j], chain[j:]
    return head + re.sub(r'\??\.', '?.', rest)


def safe_chain(code):
    out, n = code, 0
    for rx in (ROOTED, NULLABLE):
        res, pos = [], 0
        for m in rx.finditer(out):
            s, e = m.span()
            if ASSIGN_AFTER.match(out, e) or INCDEC_BEFORE.search(out[:s]) or out[e:e + 1] == '(' and False:
                continue
            fixed = _fix_chain(m.group(0))
            if fixed != m.group(0):
                res.append(out[pos:s]); res.append(fixed); pos = e; n += 1
        res.append(out[pos:]); out = ''.join(res)
    return out, n


CHILD_KEYS = {'components', 'columns', 'tabs', 'steps', 'items', 'content'}


def render_scripts(component):
    """yield (holder, key) for every render-time script string on a component, at ANY depth of its own settings
    (0.46's style migration copies JS settings into desktop/tablet/mobile.{background,font}.color etc.).
    Child component containers are skipped - the caller's walk visits those components itself."""
    def visit(holder, top):
        for k, v in list(holder.items()):
            if top and k in CHILD_KEYS:
                continue
            if isinstance(v, dict):
                if isinstance(v.get('_code'), str):
                    yield v, '_code'
                else:
                    yield from visit(v, False)
            elif isinstance(v, str) and k in RENDER_KEYS:
                yield holder, k
    yield from visit(component, True)


def syntax_errors(snippets):
    """Parse each snippet as an async function body in ONE node process. Returns list of (index, message)."""
    if not snippets: return []
    js = ("const s=JSON.parse(require('fs').readFileSync(0,'utf8'));const bad=[];"
          "s.forEach((c,i)=>{try{new Function('return (async function(){\\n'+c+'\\n})')}catch(e){bad.push([i,e.message])}});"
          "process.stdout.write(JSON.stringify(bad));")
    r = subprocess.run(['node', '-e', js], input=json.dumps(snippets), capture_output=True, text=True, encoding='utf-8')
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


if __name__ == '__main__':
    cases = {
        'return data?.loanApplication.status != 12;': 'return data?.loanApplication?.status != 12;',
        'return data.clientVerification.status == 1': 'return data?.clientVerification?.status == 1',
        'entityVerification?.cipcVerification.status': 'entityVerification?.cipcVerification?.status',
        'form.data.a.b': 'form.data?.a?.b',
        'data.x.y = 5; return data.x.y': 'data.x.y = 5; return data?.x?.y',
        'data.a.b += 1': 'data.a.b += 1',
        'return data.a.b === 2': 'return data?.a?.b === 2',
        'return data.a': 'return data.a',
        'return metadata.a.b': 'return metadata.a.b',
        'return data?.a?.b': 'return data?.a?.b',
        'x.data.a.b': 'x.data.a.b',
        'return form._data.data.opportunity.clientType == 1': 'return form._data?.data?.opportunity?.clientType == 1',
        'return dataset.a.b': 'return dataset.a.b',
        'data?.items.some(i => i.ok)': 'data?.items?.some(i => i.ok)',
    }
    for src, want in cases.items():
        got = safe_chain(src)[0]
        assert got == want, f'{src!r}: got {got!r} want {want!r}'
    print('safe_chain self-test ok', len(cases))
