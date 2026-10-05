"""Per-component APPEARANCE fixes for 0.46 layout drift (owner 2026-10-02: no hidden stylesheet components; use each
component's own Appearance settings). Every value written is one the Appearance panel itself shows.

Where a value must be stored depends on the stored component version: a component saved below the version whose
migration moved styles into desktop/tablet/mobile gets its prev styles COPIED into those blocks at load (the copy
replaces `desktop`), so for those the value goes into the top-level `stylingBox` / `dimensions` the migration copies.

1. container  Dimensions > Min height '0px'  (0.46 default 32px, container/data.ts:163, lands on the wrapper: hidden and
   empty containers keep a 32px gap; p2 had none). Skipped where the author stored a min height.
2. columns    Margin left -(gutterX/2), LEFT ONLY. 0.46 cancels antd's row margin (columns.tsx:57) so fields are inset by
   gutterX/2. A right margin as well would overflow the 0.46 overflow:auto containers and tab bodies (horizontal
   scrollbars, measured on LBLead-details), so only the left inset is restored (x matches p2; right edge 6px inside).
3. form field Margin bottom '-3'. The framework adds padding-bottom 3px to every label column
   (shaComponentStyles.ts:20-24, not configurable), so rows are 35px where p2 had 32. The 5px row gap is antd's
   `.ant-form-item-row` margin, which collapses with the field's own margin, so a positive value cannot shrink it
   (2px measured: no change). A negative margin collapses with it: 5 + (-3) = 2, and 35 + 2 = p2's 37px pitch.
   Skipped where the author stored a bottom margin (an earlier pilot value '2' is replaced).
Each returns the number of values changed and appends notes. Idempotent.
"""
import json

FIELDS = {'textField', 'dropdown', 'checkbox', 'dateField', 'numberField', 'textArea', 'autocomplete', 'entityReference',
          'address', 'radio', 'switch', 'timePicker', 'checkboxGroup', 'refListStatus', 'currency', 'password'}
DEVICES = ('desktop', 'tablet', 'mobile')


def _blocks(c):
    return [c[d] for d in DEVICES if isinstance(c.get(d), dict)]


def _top_box(c):
    raw = c.get('stylingBox')
    box = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
    assert isinstance(box, dict), f'{c.get("componentName")}: stylingBox is not an object'
    return box


def _uses_json(c):
    """True when the stored model already carries device stylingBoxJson (migrated); else write the top-level string."""
    return any(isinstance(b.get('stylingBoxJson'), dict) for b in _blocks(c))


PARTIAL = {'dimensions': {'minHeight': '0px'}}


def container_min_height(c, notes, p2_min=None):
    """A container that stores no device blocks is still below the style step: the load-time migration builds its
    desktop/tablet/mobile blocks FROM ITS TOP-LEVEL PROPS, but only when no device block exists
    (migrateStyles: prevStyles = prev[screen] ? prev[screen] : prev). Creating a partial `desktop` block therefore
    makes the migration ignore every top-level style (height, padding, ...) - proven: Legal-tab boxes collapsed.
    So: write the top-level `dimensions.minHeight` for those, and repair a partial block an earlier run created.
    NOTE: existing EMPTY blocks ({}) are also used by the migration (an empty object is truthy), so for those the
    value must go INTO the blocks - emptying them and writing the top level would bring the 32px floor back."""
    if c.get('type') != 'container': return 0
    n = 0
    if c.get('desktop') == PARTIAL and not isinstance(c.get('tablet'), dict) and not isinstance(c.get('mobile'), dict):
        del c['desktop']; n += 1   # repair: undo the partial block, keep the intent at top level below
        c.setdefault('dimensions', {})['minHeight'] = '0px'
        notes.append(f'{c.get("componentName")}: partial desktop block removed, min height 0px at top level')
        return n
    if p2_min not in (None, '', '0px', '0'): return 0
    blocks = _blocks(c)
    if not blocks:
        dims = c.get('dimensions') if isinstance(c.get('dimensions'), dict) else {}
        if dims.get('minHeight') in (None, '', '32px'):
            c['dimensions'] = {**dims, 'minHeight': '0px'}; n += 1
    for b in blocks:
        dims = b.setdefault('dimensions', {})
        if dims.get('minHeight') in (None, '', '32px'):
            dims['minHeight'] = '0px'; n += 1
    if n: notes.append(f'{c.get("componentName")}: min height 0px')
    return n


def columns_left_margin(c, notes):
    if c.get('type') != 'columns': return 0
    g = c.get('gutterX')
    if not isinstance(g, (int, float)) or g <= 0: return 0
    want = str(-(int(g) // 2))
    name = c.get('componentName') or c['id']
    def setbox(box, where):
        cur = box.get('marginLeft')
        if str(cur) == want: return False
        if cur not in (None, '', '0', 0):
            notes.append(f'INFO {name}: {where} marginLeft {cur!r} kept'); return False
        box['marginLeft'] = want; return True
    n = 0
    if _uses_json(c):
        for b in _blocks(c):
            if isinstance(b.get('stylingBoxJson'), dict) and setbox(b['stylingBoxJson'], 'stylingBoxJson'): n += 1
    else:
        box = _top_box(c)
        if setbox(box, 'stylingBox'): c['stylingBox'] = json.dumps(box); n += 1
    if n: notes.append(f'{name}: margin left {want}px (gutter {g})')
    return n


def field_margin_bottom(c, notes):
    if c.get('type') not in FIELDS: return 0
    name = c.get('componentName') or c['id']
    def setbox(box):
        cur = box.get('marginBottom')
        if str(cur) == '-3' or cur not in (None, '', '2'): return False
        box['marginBottom'] = '-3'; return True
    n = 0
    if _uses_json(c):
        for b in _blocks(c):
            if isinstance(b.get('stylingBoxJson'), dict) and setbox(b['stylingBoxJson']): n += 1
    else:
        box = _top_box(c)
        if setbox(box): c['stylingBox'] = json.dumps(box); n += 1
    if n: notes.append(f'{name}: margin bottom -3')
    return n
