"""Rule: give a field with a MULTI-LINE label its label as a separate text component, so the label takes real height.

0.46 / antd 6 fixes the label element at `var(--ant-form-label-height)` (32px). The variable is defined on the label
column itself, so no Appearance, Custom style or ancestor setting can change it, and a wrapped label spills into the
next row. The core team is only shipping labelCol 8 (labels visible in subforms), not a height fix (owner 2026-10-02).

Structure (all ordinary components, no stylesheet):
  row container (horizontal, align-items center, takes the field's visibility)
    text label    width = labelCol share (8/24 -> 33.333%), right-aligned, 14px / 700 / rgba(0,0,0,0.88),
                  13px right gap (antd's label ::after), wraps freely
    field holder  container, width 'stretch' (flex: 1)
      field       unchanged except hideLabel: true (its own label is kept in `_reconcilerLabel`)
The input therefore starts at the same x as the inputs of normal fields in the same column.

Templates are copied from working v7 text / v9 container instances (passed in), never built from guesses.
Ids are derived from the field id (idempotent: a field already wrapped is skipped). Refuses required fields (the
red required mark would be lost) unless allow_required.
"""
import copy

ROW, LBL, HOLD = '-row046', '-lbl046', '-hold046'


def _devices(c, fn):
    for dev in ('desktop', 'tablet', 'mobile'):
        if isinstance(c.get(dev), dict): fn(c[dev])


def split(holder_list, idx, text_tpl, cont_tpl, label_share='33.333%', allow_required=False):
    f = holder_list[idx]
    fid = f['id']
    assert not fid.endswith(HOLD), 'already a holder'
    label = f.get('label')
    assert isinstance(label, str) and label.strip(), f'{f.get("componentName")}: label is not static text'
    req = (f.get('validate') or {}).get('required')
    if req not in (None, False) and not (isinstance(req, dict) and req.get('_mode') != 'code' and not req.get('_value')):
        assert allow_required, f'{f.get("componentName")}: required field, label split would drop the required mark'
    parent_id = f.get('parentId')

    row = copy.deepcopy(cont_tpl); row.pop('components', None)
    row.update({'id': fid + ROW, 'componentName': f'{f.get("componentName")}Row046', 'propertyName': f'{f.get("componentName")}Row046',
                'label': 'Label row (0.46 multi-line label)', 'parentId': parent_id, 'direction': 'horizontal',
                'justifyContent': 'start', 'flexWrap': 'nowrap', 'alignItems': 'center',
                'visible': copy.deepcopy(f.get('visible', True))})
    row.pop('hidden', None)
    def rowdev(d):
        d.update({'display': 'flex', 'direction': 'horizontal', 'justifyContent': 'start', 'flexWrap': 'nowrap',
                  'alignItems': 'center', 'gap': '0px'})
        d.setdefault('dimensions', {}).update({'width': 'auto', 'minHeight': '0px'})
        d['stylingBoxJson'] = {'_type': 'styleBox', 'marginBottom': '2'}
    _devices(row, rowdev)

    txt = copy.deepcopy(text_tpl)
    txt.update({'id': fid + LBL, 'componentName': f'{f.get("componentName")}Label046', 'propertyName': f'{f.get("componentName")}Label046',
                'label': 'Label text', 'parentId': fid + ROW, 'content': label.strip(), 'textAlign': 'end', 'strong': True,
                'visible': True, 'contentType': 'custom'})   # 'primary' (template) paints colorPrimary; 'custom' uses font.color
    txt.pop('hidden', None)
    def txtdev(d):
        font = d.setdefault('font', {})
        # type 'inherit': an absent type falls back to the text default (Segoe UI); inherit keeps the theme font (Inter)
        font.update({'size': 14, 'weight': '700', 'color': 'rgba(0, 0, 0, 0.88)', 'align': 'right', 'type': 'inherit'})
        if 'contentType' in d: d['contentType'] = 'custom'
        d.setdefault('dimensions', {}).update({'width': label_share, 'minWidth': label_share, 'maxWidth': label_share,
                                               'height': 'auto', 'minHeight': '0px'})
        d['stylingBoxJson'] = {'_type': 'styleBox', 'paddingRight': '13'}
    _devices(txt, txtdev)

    hold = copy.deepcopy(cont_tpl); hold.pop('components', None)
    hold.update({'id': fid + HOLD, 'componentName': f'{f.get("componentName")}Holder046', 'propertyName': f'{f.get("componentName")}Holder046',
                 'label': 'Field holder', 'parentId': fid + ROW, 'direction': 'vertical', 'justifyContent': 'start',
                 'visible': True})
    hold.pop('hidden', None)
    def holddev(d):
        d.update({'display': 'block', 'direction': 'vertical', 'justifyContent': 'start', 'gap': '0px'})
        d.setdefault('dimensions', {}).update({'width': 'stretch', 'minHeight': '0px'})
        d['stylingBoxJson'] = {'_type': 'styleBox'}
    _devices(hold, holddev)

    f['_reconcilerLabel'] = label
    f['hideLabel'] = True
    f['parentId'] = fid + HOLD
    hold['components'] = [f]
    row['components'] = [txt, hold]
    holder_list[idx] = row
    return f'{f.get("componentName")}: label moved into its own text ({label.strip()[:40]})'


def fix_label_colour(c):
    """Bring earlier pilot labels up to the current rule (contentType custom, font inherit). Returns 1 if changed."""
    if c.get('type') != 'text' or not c['id'].endswith(LBL): return 0
    n = 0
    if c.get('contentType') != 'custom': c['contentType'] = 'custom'; n = 1
    for dev in ('desktop', 'tablet', 'mobile'):
        d = c.get(dev)
        if not isinstance(d, dict): continue
        if 'contentType' in d and d['contentType'] != 'custom': d['contentType'] = 'custom'; n = 1
        f = d.setdefault('font', {})
        if f.get('type') != 'inherit': f['type'] = 'inherit'; n = 1
    return n


def set_label_share(c, share):
    """Resize a split label to the subform's label column share (e.g. labelCol 10 -> '41.667%'). Returns 1 if changed."""
    if c.get('type') != 'text' or not c['id'].endswith(LBL): return 0
    n = 0
    for dev in ('desktop', 'tablet', 'mobile'):
        d = c.get(dev)
        if not isinstance(d, dict): continue
        dims = d.setdefault('dimensions', {})
        for k in ('width', 'minWidth', 'maxWidth'):
            if dims.get(k) != share: dims[k] = share; n = 1
    return n
