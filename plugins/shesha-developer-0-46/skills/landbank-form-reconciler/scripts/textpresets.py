"""Rule: restore 0.43 sizes for `text` components that use legacy presets.
0.46 text v5 migration converts `fontSize` presets with a 14px root (text/index.tsx:62-64, remToPx) while 0.43 rendered
them in rem against the browser's 16px root; v7 ignores the legacy `padding` preset entirely (0.43 applied it on all four
sides). Measured on p2: text-xl title = 20px font, box 60px tall / 32px wider than the text (padding-base = 16px all round).
Only rewrites values that are the migration's own output (font.size == rem*14 or absent; padding sides unset/0)."""
import json, re
FONT = {'text-xxs': .6, 'text-xs': .75, 'text-sm': .875, 'text-base': 1, 'text-lg': 1.125, 'text-xl': 1.25, 'text-2xl': 1.5,
        'text-3xl': 1.875, 'text-4xl': 2.25, 'text-5xl': 3, 'text-6xl': 3.75, 'text-7xl': 4.5, 'text-8xl': 6, 'text-9xl': 8}
PAD = {'padding-xxs': .6, 'padding-xs': .75, 'padding-sm': .875, 'padding-base': 1, 'padding-lg': 1.125, 'padding-xl': 1.25,
       'padding-2xl': 1.5, 'padding-3xl': 1.875, 'padding-4xl': 2.25, 'padding-5xl': 3, 'padding-6xl': 3.75,
       'padding-7xl': 4.5, 'padding-8xl': 6}
SIDES = ('paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft')


def _num(v):
    try: return float(str(v).replace('px', ''))
    except Exception: return None


def apply(c, notes):
    if c.get('type') != 'text': return 0
    d = c.get('desktop')
    if not isinstance(d, dict): d = c['desktop'] = {}
    n = 0
    fs = c.get('fontSize')
    if isinstance(fs, str) and fs in FONT:
        want, migrated = FONT[fs] * 16, FONT[fs] * 14
        font = d.setdefault('font', {})
        cur = _num(font.get('size'))
        if cur is None or abs(cur - migrated) < 0.01 or abs(cur - want) < 0.01:
            if cur is None or abs(cur - want) >= 0.01:
                font['size'] = int(want) if want == int(want) else want; n += 1
                notes.append(f'{c.get("componentName")}: font {cur} -> {font["size"]} ({fs} at 16px root)')
    pd = c.get('padding')
    if isinstance(pd, str) and pd in PAD:
        px = str(int(PAD[pd] * 16)) if PAD[pd] * 16 == int(PAD[pd] * 16) else str(PAD[pd] * 16)
        box = d.get('stylingBoxJson') if isinstance(d.get('stylingBoxJson'), dict) else {'_type': 'styleBox'}
        changed = False
        for s in SIDES:
            if _num(box.get(s)) in (None, 0.0) and box.get(s) != px:
                box[s] = px; changed = True
        if changed:
            box['_type'] = 'styleBox'; d['stylingBoxJson'] = box; n += 1
            notes.append(f'{c.get("componentName")}: padding {pd} -> {px}px all sides')
    return n
