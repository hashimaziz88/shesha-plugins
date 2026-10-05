"""Rules for 0.43 behaviour that relied on a THROWING setting expression.
1. Status buttons: label computed as `const status = data?.X?.status; switch (status) ...` with no visibility condition.
   On 0.43 the label threw when X was absent and the button did not render (p2: no space taken). 0.46 swallows the
   error (executeScriptSync returns undefined) and renders an empty 37px button. Restore with an explicit condition.
2. sectionSeparator lost its bottom spacing on 0.46 (p2: 10px under the rule; local 2px) -> marginBottom 8 when unset."""
import re
STATUS = re.compile(r'const\s+status\s*=\s*data\??\.(\w+)\??\.status')


def status_button(c, notes):
    if c.get('type') != 'button': return 0
    lab = c.get('label')
    code = lab.get('_code') if isinstance(lab, dict) and lab.get('_mode') == 'code' else None
    m = STATUS.search(code or '')
    if not m: return 0
    v, h = c.get('visible'), c.get('hidden')
    if (isinstance(v, dict) and v.get('_mode') == 'code') or (isinstance(h, dict) and h.get('_mode') == 'code'): return 0
    if v is False or h is True: return 0
    c['visible'] = {'_mode': 'code', '_code': f'/*reconciler:046-status-button*/\nreturn data?.{m.group(1)}?.status != null;', '_value': False}
    c.pop('hidden', None)
    notes.append(f'{c.get("componentName")}: visible only when {m.group(1)}.status exists (0.43 hid it by throwing)')
    return 1


def separator_spacing(c, notes):
    """0.43 sectionSeparator had a built-in bottom margin (p2 10px under the rule, local 2px). 0.46 applies wrapperStyle
    to the separator's outer container (sectionSeprator/index.tsx: containerStyle={model.wrapperStyleCss})."""
    if c.get('type') != 'sectionSeparator': return 0
    n = 0
    sb = (c.get('desktop') or {}).get('stylingBoxJson')
    if isinstance(sb, dict) and sb.get('marginBottom') == '8' and set(sb) <= {'_type', 'marginBottom'}:
        del c['desktop']['stylingBoxJson']; n += 1      # undo batch-14 v1 (separator ignores stylingBoxJson margins)
    if not (c.get('wrapperStyle') or '').strip():
        c['wrapperStyle'] = "/*reconciler:046-separator-gap*/\nreturn { marginBottom: '8px' };"; n += 1
    if n: notes.append(f'{c.get("componentName")}: separator bottom gap via wrapperStyle')
    return n


def lone_button_container(c, notes):
    """A hidden component keeps its wrapper size on 0.46 (button default height 32px) -> when a container holds only a
    status button, give the container the same condition (containers do not render at all when hidden)."""
    if c.get('type') != 'container': return 0
    kids = c.get('components') or []
    if len(kids) != 1 or kids[0].get('type') != 'button': return 0
    v = kids[0].get('visible')
    if not (isinstance(v, dict) and '/*reconciler:046-status-button*/' in (v.get('_code') or '')): return 0
    cv = c.get('visible')
    if isinstance(cv, dict) and cv.get('_code') == v['_code']: return 0
    if (isinstance(cv, dict) and cv.get('_mode') == 'code') or isinstance(c.get('hidden'), dict): return 0
    c['visible'] = dict(v); c.pop('hidden', None)
    notes.append(f'{c.get("componentName")}: container takes its only status button\'s condition')
    return 1
