"""Move MEASURED multi-line labels into their own text label (hazard H20; rule module labelsplit.py). LOCAL only.

  python split_labels.py --from-sweep [--only form,form] [--push]
  python split_labels.py --form <name> --labels "label text|other label" [--push]

--from-sweep reads <work>/sweep/local/*.json (capture.py output: every label whose text overflowed, per page / tab),
finds the owning form of each label (a non-required field with exactly that static label, directly in a components
list), and splits it. The label share follows the labelCol the form renders with: the hosting subForm's labelCol when
the form is hosted (majority across hosts), else the form's own settings, else 8.
Templates: a working v7 `text` and v9 `container` from the same form when present, else from the reference form
(opportunity-loan-application). Required fields are skipped (their red mark would be lost) and reported.
"""
import sys, os, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push, walk, LocalWriter, _find
from localforms import fetch_all, modname
from paths import SWEEP
import labelsplit

MODULE = 'LandBank.Crm'
REF_FORM, REF_TEXT, REF_CONT = 'opportunity-loan-application', 'oKw4cuzK8fWMzyKge5Facs1v5hZt0q', 'reconciler046-moved-buttons'
FIELD_TYPES = {'textField', 'dropdown', 'checkbox', 'dateField', 'numberField', 'textArea', 'autocomplete', 'entityReference',
               'address', 'radio', 'switch', 'timePicker', 'checkboxGroup', 'currency', 'password', 'refListStatus', 'numericInput'}


def holder_lists(o, out):
    if isinstance(o, dict):
        for v in o.values(): holder_lists(v, out)
    elif isinstance(o, list):
        for i, x in enumerate(o):
            if isinstance(x, dict) and 'type' in x and 'id' in x: out.append((o, i))
            holder_lists(x, out)
    return out


def norm(t):
    return ' '.join((t or '').replace(':', ' ').split()).strip().lower()


def label_cols(items):
    """form name -> labelCol it renders with (hosting subForms' majority)."""
    votes = collections.defaultdict(collections.Counter)
    for i in items:
        for c, _, _ in walk(json.loads(i.get('markup') or '{}')):
            f = c.get('formId')
            if c.get('type') == 'subForm' and isinstance(f, dict) and f.get('name') and isinstance(c.get('labelCol'), int):
                votes[f['name']][c['labelCol']] += 1
    return {k: v.most_common(1)[0][0] for k, v in votes.items()}


def own_label_col(m):
    s = m.get('formSettings') or {}
    lc = s.get('labelCol')
    if isinstance(lc, dict): lc = lc.get('span')
    return lc if isinstance(lc, int) and lc > 0 else 8


def templates(m, ref):
    comps = {c['id']: c for c, _, _ in walk(m)}
    txt = next((c for c in comps.values() if c['type'] == 'text' and c.get('version') == 7 and isinstance((c.get('desktop') or {}).get('font'), dict)), None)
    cont = next((c for c in comps.values() if c['type'] == 'container' and c.get('version') == 9 and isinstance(c.get('desktop'), dict)), None)
    rc = {c['id']: c for c, _, _ in walk(ref)}
    return txt or rc[REF_TEXT], cont or rc[REF_CONT]


def make(labels, share, ref, skipped):
    want = {norm(l) for l in labels}
    def t(m):
        txt, cont = templates(m, ref)
        notes = [f'{n} split label(s) resized' for n in [sum(labelsplit.set_label_share(c, share) for c, _, _ in walk(m))] if n]
        for lst, i in holder_lists(m, []):
            f = lst[i]
            if f.get('type') not in FIELD_TYPES or f.get('hideLabel') is True: continue
            lab = f.get('label')
            if not isinstance(lab, str) or norm(lab) not in want: continue
            try:
                notes.append(labelsplit.split(lst, i, txt, cont, label_share=share))
            except AssertionError as e:
                skipped.append(str(e)[:160])
        return notes
    return t


def from_sweep():
    want = collections.defaultdict(set)
    for f in glob.glob(os.path.join(SWEEP, 'local', '*.json')):
        d = json.load(open(f, encoding='utf-8'))
        blocks = [d.get('main') or {}] + [t.get('defects') or {} for t in d.get('tabs', [])] + [s.get('defects') or {} for t in d.get('tabs', []) for s in t.get('sub', [])]
        for b in blocks:
            for l in b.get('labelOverflow') or []: want[os.path.basename(f)[:-5]].add(l)
    return {l for v in want.values() for l in v}


def main():
    a = sys.argv; dry = '--push' not in a
    _, items = fetch_all()
    lcs = label_cols(items)
    ref = json.loads(_find(LocalWriter(), MODULE, REF_FORM)['markup'])
    if '--from-sweep' in a:
        labels = from_sweep()
        print(f'{len(labels)} distinct overflowing label texts in the sweep')
        targets = []
        for i in items:
            if modname(i) != MODULE: continue
            m = json.loads(i.get('markup') or '{}')
            if any(c.get('type') in FIELD_TYPES and c.get('hideLabel') is not True and isinstance(c.get('label'), str) and norm(c['label']) in {norm(x) for x in labels} for c, _, _ in walk(m)):
                targets.append(i['name'])
    else:
        targets = [a[a.index('--form') + 1]]; labels = a[a.index('--labels') + 1].split('|')
    if '--only' in a: targets = [t for t in targets if t in a[a.index('--only') + 1].split(',')]
    skipped = []
    for name in sorted(targets):
        lc = lcs.get(name)
        if lc is None: lc = own_label_col(json.loads(_find(LocalWriter(), MODULE, name)['markup']))
        share = f'{lc / 24 * 100:.3f}%'
        push(MODULE, name, make(labels, share, ref, skipped), dry_run=dry)
    print('skipped:', skipped)


if __name__ == '__main__':
    main()
