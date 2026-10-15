"""Fleet runner for the LandBank 0.46 reconciliation rules (LOCAL backend only, via lbpush.push).

  python reconcile.py [--rules a,b,...] [--only form,form] [--module LandBank.Crm] [--push]

Dry run by default (backups and the would-be markup are still written to <work>/local/before|after). Every rule is
idempotent: a second run reports "no change". Run a pilot with --only on 2-3 forms, have the owner check them in his
browser, then run the fleet. After any push: clear the browser form caches and close stale designer tabs.

Rule groups (see references/rules.md for symptom, cause, proof and status of each):
  scripts   safe optional chaining in render-time scripts (syntax-gated)          safechain.py
  textvis   text visibility enforced through style (text ignores hidden/visible)  visstyle.py   (syntax-gated)
  textsize  0.43 text size/padding presets (14px -> 16px root)                     textpresets.py
  carriers  htmlRender CSS carriers mounted, style kept under the sanitizer        carriers.py   (syntax-gated)
  rlshidden hidden refListStatus helpers -> hidden textField, hosted forms only     rls2dd.py
  layout    container min height 0, columns left margin, field margin -3          appearance046.py
  tabs      tabs surface reset / v<4 seed                                         tabsurface.py
  status    status buttons, separator gap, lone status-button containers          statusbuttons.py
  hints     a columns block with one conditional text takes the text's visibility (inline)
  labelcol  subForm labelCol 8/16 -> 10/14 (owner's choice)                        (inline)
  subfetch  subForm (api) fetches every field its host shows from it               (inline)
  rowgap    horizontal containers get gap 8px where none is stored                rowgap.py
  tabgap    16px gap under the tab bar (top tabs with top padding 0)             tabsurface.py
  tablectl  vertical table headers stacked again (title above toolbar)          tablecontrol.py
  tagnull   status tags without a value hidden (no empty grey chip)               tagnull.py
  types     0.43 framework entity type names -> 0.46 names                          (inline)
  panels    collapsiblePanel header padding 8 -> 5/0/0/10 (phase2)               panelheader.py
  optfilter table filters: optional fallback beside a required item dropped (H34) optfilter.py
  editmode  editMode scripts returning 'edit'/'readonly'/booleans mapped to 0.46 values (H15) editmode.py
  urlwait   URL-sourced table contexts mount only once their record ids are loaded (H40) urlwait.py
  payload   action scripts that delete from `data` then post `...data` use a local copy (H39) payloadcopy.py
  acsort    entity autocompletes without a sort get the 0.43 default (display property asc) (H38) acsort.py
  gsrefresh script refreshes via globalState.<ctx> -> chained Refresh table action (H41) gsrefresh.py
  formref   subForms naming a framework form 0.46 dropped -> the LandBank copy (H45)  (inline)
  afterload onAfterDataLoad runs with `data` = the loaded record (form.data); 0.46 passes only the id (H44) afterload.py
Default: all groups. Label splitting (labelsplit.py) is NOT a fleet rule: it needs the measured list of wrapping
labels, see split_labels.py.
"""
import sys, os, json, glob, time, copy, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push, walk
from localforms import fetch_all, modname
from paths import SNAPSHOTS
import re
import safechain, visstyle, textpresets, carriers, rls2dd, appearance046 as ap, tabsurface, statusbuttons as sb, panelheader, rowgap, tablecontrol, tagnull, optfilter, editmode, acsort, payloadcopy, urlwait, afterload, gsrefresh

COUNT = collections.Counter()
PILOT_ONLY = set()   # every group has been piloted, owner-checked and rolled out (2026-10-02)


def _p2_min_heights():
    out = {}
    for f in glob.glob(os.path.join(SNAPSHOTS, 'p2', 'LandBank.Crm', '*.json')):
        d = json.load(open(f, encoding='utf-8')); mk = d.get('markup') or {}
        for c, _, _ in walk(json.loads(mk) if isinstance(mk, str) else mk):
            out[c['id']] = ((c.get('desktop') or {}).get('dimensions') or {}).get('minHeight') or c.get('minHeight')
    return out


P2_MIN = None


def g_scripts(m, form, notes):
    changed = []
    for c, _, _ in walk(m):
        for holder, key in safechain.render_scripts(c):
            old = holder[key]; new, n = safechain.safe_chain(old)
            if n: changed.append((c.get('componentName'), key, old, new)); holder[key] = new; notes.append(f'{c.get("componentName")}.{key}: {n} safe chain(s)')
    if changed:
        before_bad = {i for i, _ in safechain.syntax_errors([o for _, _, o, _ in changed])}
        regress = [changed[i][:2] for i, _ in safechain.syntax_errors([n for _, _, _, n in changed]) if i not in before_bad]
        assert not regress, f'safe-chain would introduce syntax errors: {regress}'
    return len(changed)


def _styles(c):
    return [h['style'] for h in [c] + [c[d] for d in ('desktop', 'tablet', 'mobile') if isinstance(c.get(d), dict)]
            if isinstance(h.get('style'), str) and visstyle.MARK in h['style']]


def g_textvis(m, form, notes):
    n = 0
    for c, _, _ in walk(m): n += visstyle.apply(c, notes) or 0
    if n:
        bad = safechain.syntax_errors([s for c, _, _ in walk(m) for s in _styles(c)])
        assert not bad, f'visibility-style wrap has syntax errors: {bad[:3]}'
    return n


def g_textsize(m, form, notes):
    return sum(textpresets.apply(c, notes) or 0 for c, _, _ in walk(m))


def g_carriers(m, form, notes):
    n = sum(carriers.apply(c, notes, form=form) or 0 for c, _, _ in walk(m))
    if n:
        bad = safechain.syntax_errors([c['renderer'] for c, _, _ in walk(m) if c.get('type') == 'htmlRender' and carriers.MARK in (c.get('renderer') or '')])
        assert not bad, f'carrier renderer syntax errors: {bad[:3]}'
    return n


HOSTED = None


def _hosted_forms():
    """Forms rendered inside another form (subForm / dataList / list item formId): only there does the
    refListStatus 'Component with id ... is not found' bug throw."""
    _, items = fetch_all(); out = set()
    for i in items:
        for c, _, _ in walk(json.loads(i.get('markup') or '{}')):
            for key in ('formId', 'itemFormId', 'createFormId', 'formSelectionMode'):
                f = c.get(key)
                if isinstance(f, dict) and f.get('name'): out.add(f"{f.get('module')}/{f['name']}")
    return out


def g_rlshidden(m, form, notes):
    global HOSTED
    if HOSTED is None: HOSTED = _hosted_forms()
    if form not in HOSTED: return 0
    n = 0
    for c, pl, i in list(walk(m)):
        if c.get('type') == 'refListStatus' and rls2dd.is_static_hidden(c):
            pl[i] = rls2dd.swap(c); n += 1; notes.append(f'{c.get("componentName")}: hidden refListStatus -> hidden textField')
    return n


def g_layout(m, form, notes):
    global P2_MIN
    if P2_MIN is None: P2_MIN = _p2_min_heights()
    n = 0
    for c, _, _ in walk(m):
        n += ap.container_min_height(c, notes, P2_MIN.get(c['id'])) + ap.columns_left_margin(c, notes) + ap.field_margin_bottom(c, notes)
    return n


def g_tabs(m, form, notes):
    return sum(tabsurface.seed_low_version(c, notes) + tabsurface.apply(c, notes) for c, _, _ in walk(m))


def g_status(m, form, notes):
    n = 0
    for _ in range(2):   # a lone-button container qualifies once its button has been fixed in the same pass
        n += sum(sb.status_button(c, notes) + sb.separator_spacing(c, notes) + sb.lone_button_container(c, notes) for c, _, _ in walk(m))
    return n


def g_hints(m, form, notes):
    n = 0
    for c, _, _ in walk(m):
        if c.get('type') != 'columns' or c.get('visible') is not True: continue
        kids = [k for col in c.get('columns') or [] for k in col.get('components') or []]
        if len(kids) != 1 or kids[0].get('type') != 'text': continue
        v = kids[0].get('visible')
        if not (isinstance(v, dict) and v.get('_mode') == 'code' and (v.get('_code') or '').strip()): continue
        c['visible'] = copy.deepcopy(v); c.pop('hidden', None); n += 1
        notes.append(f'{c.get("componentName")}: takes the visibility of its only text')
    return n


def g_labelcol(m, form, notes):
    n = 0
    for c, _, _ in walk(m):
        if c.get('type') == 'subForm' and c.get('labelCol') == 8 and c.get('wrapperCol') in (16, None):
            c['labelCol'], c['wrapperCol'] = 10, 14; n += 1; notes.append(f'{c.get("componentName")}: labelCol 8/16 -> 10/14')
    return n


def g_subfetch(m, form, notes):
    """A subForm loading through the API (dataSource 'api') with an explicit `properties` list writes what it loads
    back into the host's field (its propertyName) - replacing the host's copy. Any `<propertyName>.<x>` the HOST form
    shows but the subform does not fetch disappears once the subform loads (proven: the opportunity status tag shows
    DRAFT, then goes blank when the loan-application subform's Crud/Get returns without `status`).
    Append every such top-level field to the subform's properties list."""
    n = 0
    for c, _, _ in walk(m):
        if c.get('type') != 'subForm' or c.get('dataSource') != 'api' or not isinstance(c.get('properties'), str) or not c.get('propertyName'):
            continue
        pn = c['propertyName']
        have = {x.strip().split('{')[0].strip() for x in re.split(r'[\r\n,]+', c['properties']) if x.strip()}
        bound = sorted({x['propertyName'][len(pn) + 1:].split('.')[0] for x, _, _ in walk(m)
                        if isinstance(x.get('propertyName'), str) and x['propertyName'].startswith(pn + '.')} - have)
        if not bound: continue
        sep = '\r\n' if '\r\n' in c['properties'] else '\n'
        c['properties'] = c['properties'].rstrip() + sep + sep.join(bound)
        n += len(bound); notes.append(f'{c.get("componentName")}: fetch {bound} (shown by the host from {pn})')
    return n


def g_rowgap(m, form, notes):
    return sum(rowgap.apply(c, notes) for c, _, _ in walk(m))


def g_tabgap(m, form, notes):
    return sum(tabsurface.tab_gap(c, notes) for c, _, _ in walk(m))


def g_tablectl(m, form, notes):
    return sum(tablecontrol.apply(c, notes) for c, _, _ in walk(m))


def g_tagnull(m, form, notes):
    return sum(tagnull.apply(c, notes) for c, _, _ in walk(m))


def g_optfilter(m, form, notes):
    return sum(optfilter.apply(c, notes) for c, _, _ in walk(m))


def g_urlwait(m, form, notes):
    return sum(urlwait.apply(c, notes) for c, _, _ in walk(m))


def g_payload(m, form, notes):
    return payloadcopy.apply_all(m, notes)


# 0.43 framework forms that 0.46 no longer ships (absent locally and on the deployed 0.46 env) -> the LandBank copy,
# proven identical (same components) on phase2 (H45)
FORM_REF_MAP = {('Shesha.Enterprise', 'dynamic-task-subform'): ('LandBank.Crm', 'dynamic-task-subform')}


def g_formref(m, form, notes):
    """subForm formIds naming a framework form 0.46 dropped: 'form not found', the tab renders an empty box (H45)."""
    n = 0
    for c, _, _ in walk(m):
        f = c.get('formId')
        if isinstance(f, dict) and (f.get('module'), f.get('name')) in FORM_REF_MAP:
            mod, name = FORM_REF_MAP[(f['module'], f['name'])]
            notes.append(f'{c.get("componentName")}: form {f["module"]}/{f["name"]} (not shipped by 0.46) -> {mod}/{name} (H45)')
            c['formId'] = {**f, 'module': mod, 'name': name}; n += 1
    return n


def g_gsrefresh(m, form, notes):
    return gsrefresh.apply_all(m, notes)


def g_afterload(m, form, notes):
    return afterload.apply(m, notes)


def g_acsort(m, form, notes):
    return sum(acsort.apply(c, notes) for c, _, _ in walk(m))


def g_editmode(m, form, notes):
    """every dict with an editMode - components and tab items (tab items carry no `type`)."""
    n = 0
    def go(o):
        nonlocal n
        if isinstance(o, dict):
            if 'editMode' in o: n += editmode.apply(o, notes)
            for v in o.values(): go(v)
        elif isinstance(o, list):
            for v in o: go(v)
    go(m); return n


TYPE_MAP = {'Shesha.Domain.ConfigurationItems.Module': 'Shesha.Domain.Module',
            'Shesha.Framework.ConfigurableComponent': 'Shesha.Domain.FormConfiguration'}


def g_types(m, form, notes):
    """0.46 renamed framework entity types; lookups naming the 0.43 types fail (Metadata/Get 404, Entities/GetAll 500)."""
    n = 0

    def rec(o):
        nonlocal n
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str) and any(a in v for a in TYPE_MAP):
                    nv = v
                    for a, b in TYPE_MAP.items():
                        nv = nv.replace(a, b)
                    o[k] = nv; n += 1
                    notes.append(f'{o.get("componentName") or "?"}.{k}: 0.46 entity type {nv[:50]}')
                else:
                    rec(v)
        elif isinstance(o, list):
            for x in o:
                rec(x)
    rec(m)
    return n


def g_panels(m, form, notes):
    return sum(panelheader.apply(c, notes) for c, _, _ in walk(m))


GROUPS = {'scripts': g_scripts, 'textvis': g_textvis, 'textsize': g_textsize, 'carriers': g_carriers, 'rlshidden': g_rlshidden,
          'layout': g_layout, 'tabs': g_tabs, 'status': g_status, 'hints': g_hints, 'labelcol': g_labelcol, 'subfetch': g_subfetch, 'rowgap': g_rowgap, 'tabgap': g_tabgap, 'tablectl': g_tablectl, 'tagnull': g_tagnull, 'types': g_types, 'panels': g_panels, 'optfilter': g_optfilter, 'editmode': g_editmode, 'acsort': g_acsort, 'payload': g_payload, 'urlwait': g_urlwait, 'afterload': g_afterload, 'formref': g_formref, 'gsrefresh': g_gsrefresh}


def make(groups, form):
    def t(m):
        notes = []
        for g in groups:
            k = GROUPS[g](m, form, notes)
            if k: COUNT[g] += k
        return notes if any(not x.startswith('INFO') for x in notes) else []
    return t


def main():
    a = sys.argv
    groups = a[a.index('--rules') + 1].split(',') if '--rules' in a else [g for g in GROUPS if g not in PILOT_ONLY]
    assert all(g in GROUPS for g in groups), f'unknown rule group in {groups}'
    module = a[a.index('--module') + 1] if '--module' in a else 'LandBank.Crm'
    only = a[a.index('--only') + 1].split(',') if '--only' in a else None
    dry = '--push' not in a
    _, items = fetch_all()
    names = sorted(i['name'] for i in items if modname(i) == module and (not only or i['name'] in only))
    changed, failed = {}, []
    for n in names:
        for attempt in range(3):
            try:
                notes = push(module, n, make(groups, f'{module}/{n}'), dry_run=dry)
                if notes: changed[n] = len(notes)
                break
            except AssertionError as e: failed.append((n, str(e)[:200])); break
            except Exception as e:
                if attempt == 2: failed.append((n, f'{type(e).__name__}: {e}'[:200]))
                else: time.sleep(5)
    print(('DRY RUN - ' if dry else '') + f'forms changed {len(changed)} of {len(names)}')
    print('by rule group (changes):', dict(COUNT)); print('failed:', failed)


if __name__ == '__main__':
    main()
