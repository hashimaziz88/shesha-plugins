"""Rule: htmlRender CSS carriers on 0.46, keeping the XSS sanitizer ON.

0.46 sanitizes htmlRender output with DOMPurify by default (htmlRender/index.tsx:39) and DOMPurify drops a LEADING <style>
(the HTML parser hoists it into <head>), so carriers that start with <style> inject nothing and show the Empty placeholder.
Fix without disabling the sanitizer: make the carrier mounted (hidden components are not mounted), force contentType jsx,
and wrap the renderer so its output is prefixed with '<span hidden></span>' (the <style> is then body content and kept).
An empty output becomes the hidden span (no placeholder).

Also: 0.46 gives every htmlRender a fit-content wrapper (htmlRender/index.tsx getWrapperStyle), so HTML built by
htmlRenders (header bars, rows) shrinks to its content where 0.43 rendered a full-width block. The carrier therefore also
emits one rule restoring full width for htmlRenders inside ITS OWN subform ([data-sha-c-form-name="<module>/<name>"]).
Proven on esra-screening-subform: style tags 0 -> 1, placeholders 1 -> 0. Idempotent via MARK.
"""
MARK = '/*reconciler:046-carrier*/'


def is_carrier(c):
    return c.get('type') == 'htmlRender' and '<style' in (c.get('renderer') or '')


def _prefix(form):
    css = ''
    if form:
        css = ('<style>[data-sha-c-form-name="' + form + '"] [data-sha-c-type="htmlRender"]'
               '{width:100% !important;}</style>')
    return '<span hidden></span>' + css


def apply(c, notes, form=None):
    if not is_carrier(c): return 0
    n = 0
    if c.get('hidden') is True:
        c['hidden'] = False; n += 1
    v = c.get('visible')
    if v is False or (isinstance(v, dict) and v.get('_mode') == 'value' and v.get('_value') is False):
        c['visible'] = True; n += 1
    if c.get('contentType') == 'html' and not (c.get('html') or '').strip():
        c['contentType'] = 'jsx'; n += 1
    r = c['renderer']
    if MARK not in r and '/*reconciler:nonempty*/' not in r:
        prefix = _prefix(form).replace('\\', '\\\\').replace("'", "\\'")
        c['renderer'] = (MARK + '\nconst __out = (() => {\n' + r + '\n})();\n'
                         "return '" + prefix + "' + ((typeof __out === 'string') ? __out : '');")
        n += 1
    if n: notes.append(f'{c.get("componentName")}: carrier mounted + style kept under the sanitizer')
    return n
