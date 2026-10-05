"""Apply the H35 rule (dialogfooter.py): move dynamic custom dialog footer buttons into the dialog form. LOCAL only.

  python move_dialog_footer.py                      dry run over every form (all modules)
  python move_dialog_footer.py --only HOST[,HOST]   restrict to these host forms (the forms holding the Show Dialog action)
  python move_dialog_footer.py --push               write

Per qualifying dialog: refuse unless the dialog form is opened by exactly one Show Dialog action in the whole
configuration; push the dialog form first (adds the footer row), then the host (footerButtons -> none, original items
kept in `_reconcilerFooterButtons046`). Both writes back up and read-back verify through lbpush.push."""
import json, os, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbpush import push, LocalWriter, _find
from localforms import fetch_all, modname
import dialogfooter as df


def main():
    a = sys.argv[1:]; do_push = '--push' in a
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    _, items = fetch_all()
    forms = {(modname(i), i['name']): json.loads(i['markup']) for i in items if i.get('markup')}
    uses = collections.Counter()
    def count(o):
        if isinstance(o, dict):
            if o.get('actionName') == 'Show Dialog' and isinstance(o.get('actionArguments'), dict):
                uses[df.form_name(o['actionArguments'].get('formId'))] += 1
            for v in o.values(): count(v)
        elif isinstance(o, list):
            for v in o: count(v)
    for m in forms.values(): count(m)
    plan = []
    for (mod, name), m in forms.items():
        if only and name not in only: continue
        for args in df.find_dialogs(m):
            fid = args.get('formId'); dname = df.form_name(fid)
            dmod = fid.get('module') if isinstance(fid, dict) else None
            if not dmod:
                hits = [k for k in forms if k[1] == dname]; dmod = hits[0][0] if len(hits) == 1 else None
            plan.append((mod, name, dmod, dname, args.get('modalTitle')))
    shared = {}
    for mod, name, dmod, dname, title in plan:
        if uses[dname] != 1 or not dmod:
            shared.setdefault((mod, name), set()).add(dname)
            print(f'[{name}] dialog {dname!r} opened by {uses[dname]} dialogs - buttons stay in the footer; enable condition enforced in the action')
            continue
        seed = f'{name}:{title}'
        holder = {}
        def host_args(markup):
            got = df.find_dialogs(markup, dname)
            assert len(got) == 1, f'anchor: {len(got)} dynamic custom-footer dialogs for {dname} in {name}'
            return got[0]
        holder['items'] = host_args(json.loads(json.dumps(forms[(mod, name)])))['buttons']
        def t_dialog(markup):
            return df.add_footer_to_form(markup, holder['items'], seed, df.row_template_from(markup))
        def t_host(markup):
            got = df.find_dialogs(markup, dname)
            if not got: return []            # already moved
            assert len(got) == 1
            return df.clear_footer(got[0])
        print(f'== {name} -> dialog {dmod}/{dname} ({title}) buttons {[i.get("label") for i in holder["items"]]}')
        push(dmod, dname, t_dialog, dry_run=not do_push)
        push(mod, name, t_host, dry_run=not do_push)
    for (mod, name), forms_ in shared.items():
        print(f'== {name}: guard footer buttons of shared dialog forms {sorted(forms_)}')
        push(mod, name, lambda markup, f=forms_: df.guard_dialogs(markup, f), dry_run=not do_push)


if __name__ == '__main__':
    main()
