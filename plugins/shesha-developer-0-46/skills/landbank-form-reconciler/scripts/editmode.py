"""Rule: an `editMode` script that returns anything other than 'editable' | 'readOnly' | 'disabled' | 'inherited'
renders the component DISABLED on 0.46 (hazard H15). 0.43 read `true` / 'edit' as editable and `false` / 'readonly' as
read-only. LandBank scripts return 'edit' and 'readonly' (Client Info tab of the opportunity loan application: every
field stayed disabled after Edit) and booleans.
Buttons: 0.46 maps 'readOnly' to {disabled:false, readOnly:true} and a button only honours `disabled`, so a read-only
button became clickable (Initiate Loan Application stayed enabled in edit mode; phase2 disabled it). 0.43 rendered a
read-only button disabled.
Fix: when a script can return a non-canonical value, wrap it so its result is mapped back to the 0.43 meaning; canonical
values pass through untouched. Scripts whose every `return` is a canonical literal (or a ternary of them) are left alone.
For buttons (button components, button-group items) 'readOnly' / false map to 'disabled', static 'readOnly' included.
Marked /*reconciler:046-editmode*/ so it can be found/removed."""
import re

MARK = '/*reconciler:046-editmode*/'
VALID = ('editable', 'readOnly', 'disabled', 'inherited')
LIT = r"""(?:'(?:%s)'|"(?:%s)")""" % ('|'.join(VALID), '|'.join(VALID))
CANON_EXPR = re.compile(r'^\s*(?:%s|[^?;]+\?\s*%s\s*:\s*%s)\s*;?\s*$' % (LIT, LIT, LIT), re.S)


def _strip(code):
    return re.sub(r'//[^\n]*', '', re.sub(r'/\*.*?\*/', '', code, flags=re.S))


def needs_wrap(code):
    body = _strip(code)
    rets = re.findall(r'\breturn\b([^;\n]*)', body)
    if not rets: return False
    return any(not CANON_EXPR.match(r) for r in rets)


RO_LINE = "if (__em === false || __em === 'readonly' || __em === 'read-only' || __em === 'ReadOnly') return 'readOnly';"
RO_LINE_BUTTON = ("if (__em === false || __em === 'readonly' || __em === 'read-only' || __em === 'ReadOnly' || __em === 'readOnly') "
                  "return 'disabled';")


def wrap(code, button=False):
    return (f"{MARK}\nconst __em = (() => {{\n{code}\n}})();\n"
            "if (__em === true || __em === 'edit' || __em === 'Edit') return 'editable';\n"
            f"{RO_LINE_BUTTON if button else RO_LINE}\n"
            "return __em;")


def is_button(c):
    return c.get('type') == 'button' or (c.get('itemType') == 'item' and ('buttonType' in c or 'actionConfiguration' in c))


def apply(c, notes):
    """c: any dict carrying an `editMode` (components, button-group items and tab items)."""
    em, button = c.get('editMode'), is_button(c)
    name = c.get('componentName') or c.get('label') or c.get('title') or c.get('id')
    if button and em == 'readOnly':
        c['editMode'] = 'disabled'; notes.append(f'{name}: read-only button -> disabled (H15)'); return 1
    if not (isinstance(em, dict) and em.get('_mode') == 'code' and isinstance(em.get('_code'), str) and em['_code'].strip()):
        return 0
    code = em['_code']
    if MARK in code:   # already wrapped; a button wrapped before the button mapping existed gets its read-only line upgraded
        if button and RO_LINE in code:
            em['_code'] = code.replace(RO_LINE, RO_LINE_BUTTON)
            notes.append(f'{name}: wrapped button editMode upgraded (read-only -> disabled) (H15)'); return 1
        return 0
    if not (needs_wrap(code) or (button and re.search(r"""['"]readOnly['"]""", _strip(code)))): return 0
    em['_code'] = wrap(code, button)
    notes.append(f'{name}: editMode result mapped to 0.46 values{" (button: read-only -> disabled)" if button else ""} (H15)')
    return 1
