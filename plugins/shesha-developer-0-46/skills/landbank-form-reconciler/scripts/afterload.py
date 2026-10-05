"""Rule (hazard H44): on 0.46 a page-level form's `formSettings.onAfterDataLoad` receives as `data` only the initial
values (the id from the URL), not the loaded record; the loaded record is `form.data`. 0.43 passed the loaded record.
Scripts that read record fields from `data` get undefined, throw part-way and skip the rest of the handler
(Opportunity > Loan Info 'Total loan Amount' R 0: `data.loanApplication.applicationLoanPurposes` threw, so
pageContext.totalLoanAmount was never set; the same throw skipped globalState.isReadOnly and the loan-purpose fetch).
Proof: in-flight instrumentation of the same page - phase2 data == form.data (full record); 0.46 data = {id},
form.data = full record. Sub-form after-load scripts behave the same on both versions.
Fix: run the original handler with `data` bound to `form.data` exactly when `data` holds nothing but the id and
`form.data` holds more (the 0.46 symptom); otherwise the handler runs unchanged. Only handlers that read record fields through `data` are wrapped; handlers that write into `data`
are reported and left alone. Marked /*reconciler:046-afterload-data*/. Idempotent; syntax-gated."""
import re
from safechain import syntax_errors

MARK = '/*reconciler:046-afterload-data*/'
READ = re.compile(r'(?<![\w$.?])data\s*\??\.\s*([A-Za-z_$][\w$]*)')
WRITE = re.compile(r'(?<![\w$.?])data\s*(\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(=(?!=)|\+=|-=)|(?<![\w$.?])delete\s+data\b')


def _strip_comments(code): return re.sub(r'//[^\n]*|/\*.*?\*/', '', code, flags=re.S)


def wrap(code):
    return (f'{MARK}\n// 0.46 passes only the initial values (the id) as `data` to onAfterDataLoad; the loaded record is\n'
            f'// form.data (0.43 passed the loaded record). When `data` holds nothing but the id and form.data holds more,\n'
            f'// run the handler with `data` = the loaded record; otherwise it runs unchanged (H44).\n'
            f'const __d046 = (typeof form !== "undefined" && form && form.data && typeof form.data === "object"\n'
            f'    && Object.keys(data || {{}}).filter(k => k !== "id").length === 0\n'
            f'    && Object.keys(form.data).filter(k => k !== "id").length > 0) ? form.data : data;\n'
            f'return (async (data) => {{\n{code}\n}})(__d046);')


def apply(markup, notes):
    fs = markup.get('formSettings') or {}
    code = fs.get('onAfterDataLoad')
    if not isinstance(code, str) or not code.strip() or MARK in code: return 0
    bare = _strip_comments(code)
    reads = {m.group(1) for m in READ.finditer(bare)} - {'id'}
    if not reads: return 0
    if WRITE.search(bare):
        notes.append(f'onAfterDataLoad writes into `data` - not wrapped, review by hand (H44)'); return 0
    new = wrap(code)
    if syntax_errors([new]): return 0
    fs['onAfterDataLoad'] = new
    notes.append(f'onAfterDataLoad reads the loaded record (form.data) - {", ".join(sorted(reads))[:120]} (H44)')
    return 1
