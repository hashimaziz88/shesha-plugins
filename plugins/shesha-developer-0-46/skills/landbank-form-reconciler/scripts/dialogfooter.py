"""Rule (hazard H35): custom dialog footer buttons are rendered by 0.46 with the raw button-group renderer, which reads only a
static `visible` / `disabled` and permissions; their `editMode` / visibility SCRIPTS are never evaluated (0.43 evaluated
them). A footer Save that 0.43 disabled until a condition held is therefore always enabled on 0.46 (Add New Lead: Save stays
enabled while 'Upload Resolution and Consent?' is on and nothing has been uploaded).

Fix (configuration only): render the footer buttons INSIDE the dialog form as an ordinary `buttonGroup` component, which
goes through the normal evaluation pipeline, and set the dialog's `footerButtons` to 'none'. The button items (labels,
actions, scripts) are copied unchanged; `shesha.form` actions inside the dialog form act on the same form as before.
The original footer items are kept on the action as `_reconcilerFooterButtons046` so the change can be reverted.

Only dialogs whose items carry a code-valued `editMode` / `visible` / `hidden` / `disabled` are moved, and only when the
dialog form is opened by that one dialog (otherwise the buttons would leak into other dialogs). Idempotent and anchored."""
import copy, hashlib

ROW_SUFFIX, GROUP_SUFFIX = '-ftr046', '-ftrbtn046'
DYN_KEYS = ('editMode', 'visible', 'hidden', 'disabled')
STRIP = ('hidden', 'visible', 'customVisibility', 'editMode', 'readOnly', 'components')


def _dyn(item):
    return any(isinstance(item.get(k), dict) and item[k].get('_mode') == 'code' and (item[k].get('_code') or '').strip() for k in DYN_KEYS)


def form_name(fid):
    return fid.get('name') if isinstance(fid, dict) else (fid if isinstance(fid, str) else None)


def find_dialogs(markup, only_form=None):
    """Show Dialog action arguments with a custom footer that has at least one dynamic item."""
    out = []
    def walk(o):
        if isinstance(o, dict):
            a = o.get('actionArguments')
            if o.get('actionName') == 'Show Dialog' and isinstance(a, dict) and a.get('footerButtons') == 'custom' \
                    and any(_dyn(b) for b in a.get('buttons') or []):
                if only_form is None or form_name(a.get('formId')) == only_form: out.append(a)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(markup); return out


def _id(seed, suffix):
    return hashlib.sha1(seed.encode()).hexdigest()[:22] + suffix


def _find(markup, pred):
    out = []
    def walk(o):
        if isinstance(o, dict):
            if pred(o): out.append(o)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(markup); return out


def add_footer_to_form(form_markup, items, seed, row_template):
    """Append a right-aligned row with a buttonGroup holding `items` as the last child of the form's root container."""
    row_id = _id(seed, ROW_SUFFIX)
    if _find(form_markup, lambda o: o.get('id') == row_id): return []           # already applied
    comps = form_markup.get('components')
    assert isinstance(comps, list) and comps, 'anchor: form has no root components'
    root = comps[0] if len(comps) == 1 and comps[0].get('type') == 'container' else None
    holder = root['components'] if root else comps
    parent_id = root['id'] if root else None
    row = {k: copy.deepcopy(v) for k, v in row_template.items() if k not in STRIP}
    row.update({'id': row_id, 'parentId': parent_id, 'propertyName': 'dialogFooterRow046', 'componentName': 'dialogFooterRow046',
                'label': 'Dialog footer (reconciler 046)', 'components': []})
    group = {'id': _id(seed, GROUP_SUFFIX), 'type': 'buttonGroup', 'componentName': 'dialogFooterButtons046',
             'propertyName': 'dialogFooterButtons046', 'label': 'Dialog actions', 'hideLabel': True, 'isInline': True,
             'editMode': 'inherited', 'version': 15, 'parentId': row_id, 'items': copy.deepcopy(items)}
    row['components'].append(group)
    holder.append(row)
    return [f'footer buttons {[i.get("label") for i in items]} rendered inside the form (row {row_id})']


def clear_footer(dialog_args):
    if dialog_args.get('footerButtons') == 'none' and not dialog_args.get('buttons'): return []
    assert dialog_args.get('footerButtons') == 'custom', 'anchor: footerButtons is not custom'
    dialog_args['_reconcilerFooterButtons046'] = copy.deepcopy(dialog_args.get('buttons') or [])
    dialog_args['footerButtons'] = 'none'; dialog_args['buttons'] = []
    return ['dialog footerButtons custom -> none (original items kept in _reconcilerFooterButtons046)']


def row_template_from(form_markup):
    """A clean right-aligned flex row from the same form when available, else a minimal v9 container."""
    for c in _find(form_markup, lambda o: o.get('type') == 'container' and str(o.get('justifyContent')) in ('end', 'flex-end')
                   and (o.get('desktop') or {}).get('display') == 'flex'):
        return c
    return {'type': 'container', 'version': 9, 'labelAlign': 'right', 'isDynamic': False, 'direction': 'horizontal',
            'display': 'flex', 'justifyContent': 'end', 'flexWrap': 'nowrap'}


# ---- shared dialog forms (the same form opened by many dialogs with different buttons): the buttons cannot move into
# the form, so the button's own enable condition is enforced inside its action instead. The first `Execute Script` of
# the button's chain is prefixed with the condition; when the button would have been disabled (0.43), the click shows a
# warning and stops before any write. The button still LOOKS enabled on 0.46 (framework fix needed for the visual).
GUARD = '/*reconciler:046-footer-guard*/'


def guard_item(item):
    """Prefix the first Execute Script of a dynamic footer button with its editMode condition. Returns a note or None."""
    em = item.get('editMode')
    if not (isinstance(em, dict) and em.get('_mode') == 'code' and (em.get('_code') or '').strip()): return None
    ac = item.get('actionConfiguration')
    if not (isinstance(ac, dict) and ac.get('actionOwner') == 'shesha.common' and ac.get('actionName') == 'Execute Script'): return None
    args = ac.setdefault('actionArguments', {})
    expr = args.get('expression') or ''
    if GUARD in expr: return None
    cond = em['_code']
    args['expression'] = (f"{GUARD}\nlet __footerMode;\n"
                          f"try {{ __footerMode = (() => {{\n{cond}\n}})(); }} catch (__e) {{ __footerMode = 'editable'; }}  // fail open\n"
                          "if (__footerMode === false || __footerMode === 'readOnly' || __footerMode === 'readonly' || __footerMode === 'disabled') {\n"
                          "    message.warning('Please complete the required details before saving.');\n"
                          "    throw new Error('Save blocked: required details are incomplete');\n}\n" + expr)
    return f'{item.get("label")}: enable condition enforced in its action (footer button, shared dialog form)'


def guard_dialogs(markup, shared_forms):
    """Apply guard_item to dynamic custom-footer buttons of dialogs that open one of `shared_forms`."""
    notes = []
    for a in find_dialogs(markup):
        if form_name(a.get('formId')) not in shared_forms: continue
        for b in a.get('buttons') or []:
            n = guard_item(b)
            if n: notes.append(n)
    return notes
