"""TEMPORARY WORKAROUND rule (Shesha 0.46 framework bug): `text`, `collapsiblePanel` and `KeyInformationBar` never
enforce hidden/visible in live mode (collapsiblePanel was suspected too but PROVEN to honour visible:false - excluded) - they neither render through ConfigurableFormItem (configurableFormItemLive.tsx:68)
nor check model.hidden in their Factory. Proven 2026-10-02 by interception: visible {_mode:'value',_value:false},
visible code 'return false', and hidden:true all left 10/10 texts on screen.

Workaround: keep the visibility setting untouched and ALSO drive `display:none` from the same expression through the
component's evaluated `style` (text: genericText.tsx:45 applies model.styleCss; collapsiblePanel:
collapsiblePanelComponent.tsx:78). The original style is preserved inside the wrapper; `unwrap()` restores it.
Remove once the framework enforces visibility for these types.
"""
import re

MARK = '/*reconciler:046-visibility-style*/'
TYPES = {'text'}  # collapsiblePanel proven to honour visible (2026-10-02); KeyInformationBar untested


def visibility_code(c):
    """JS function body returning the component's VISIBLE boolean, or None if it has no visibility condition."""
    v, h = c.get('visible'), c.get('hidden')
    if isinstance(v, dict) and v.get('_mode') == 'code' and (v.get('_code') or '').strip():
        return v['_code']
    if isinstance(v, dict) and v.get('_mode') == 'value' and v.get('_value') is False:
        return 'return false;'
    if v is False:
        return 'return false;'
    if isinstance(h, dict) and h.get('_mode') == 'code' and (h.get('_code') or '').strip():
        return 'return !(() => {\n' + h['_code'] + '\n})();'
    if (isinstance(h, dict) and h.get('_mode') == 'value' and h.get('_value') is True) or h is True:
        return 'return false;'
    return None


def wrap(base_style, vis_code):
    base = base_style if isinstance(base_style, str) and base_style.strip() else 'return {};'
    return (MARK + '\n'
            'const __vis = (() => {\n' + vis_code + '\n})();\n'
            'const __base = (() => {\n' + base + '\n})() || {};\n'
            "return __vis === false ? Object.assign({}, __base, { display: 'none' }) : __base;")


def unwrap(style):
    m = re.search(r"const __base = \(\(\) => \{\n(.*)\n\}\)\(\) \|\| \{\};\nreturn __vis", style, re.S)
    if not m: return style
    inner = m.group(1)
    return None if inner == 'return {};' else inner


def apply(c, notes):
    """Mutates component c. Returns number of style holders changed."""
    if c.get('type') not in TYPES: return 0
    vc = visibility_code(c)
    if vc is None: return 0
    n = 0
    holders = [c] + [c[d] for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict) and 'style' in c[d]]
    for h in holders:
        cur = h.get('style')
        if isinstance(cur, str) and cur.startswith(MARK):
            # refresh if the visibility expression changed since it was wrapped
            new = wrap(unwrap(cur), vc)
            if new == cur: continue
        else:
            new = wrap(cur, vc)
        h['style'] = new; n += 1
    if n: notes.append(f'{c.get("componentName")}: visibility enforced via style ({n} holder(s))')
    return n
