---
name: landbank-form-reconciler
description: Reconciles LandBank CRM forms after the Shesha 0.43 -> 0.46 upgrade so they look and behave like the phase2 (0.43) environment - aligned labels and columns, no phantom gaps, no script errors, working CSS carriers, tabs, status buttons and tags. Measures phase2 against the 0.46 build page by page, applies scripted, idempotent, per-component configuration rules to the LOCAL 0.46 backend (pilot first, then fleet), and verifies in the browser. Use when a LandBank form or page looks or behaves differently on 0.46 than on phase2, when rolling the reconciliation rules out to more forms, when sweeping pages for remaining 0.46 defects, or when preparing the reconciled configuration for export.
---

# LandBank form reconciler (Shesha 0.43 -> 0.46)

Project layer on top of the `shesha-developer-0-46` plugin. The plugin holds the framework knowledge
(`shesha-form-edit/references/render-hazards-046.md`, hazards H1-H46, and the 0.46 form API); this skill holds the
LandBank environments, the owner's decisions, the proven rules as scripts, and the workflow that applies them.

## Hard rules

- **Push to LOCAL only** (`http://localhost:21021`). `scripts/lbpush.py` refuses any other host. Phase2 and the
  0-46-upgrade environment are read-only (`scripts/lbapi.py` refuses non-GET; `scripts/lbbrowse.py` aborts writes).
- **Configuration level only.** No adminportal `globals.css`, no framework patches, no hidden stylesheet components
  (htmlRender CSS carriers that already existed in the forms are kept working, not added). Fix with each component's
  own settings: Appearance values, visibility, structure.
- **Pilot first.** Run a rule with `--only` on 2-3 forms, let the owner check them in his own browser, then run the
  fleet. Report how many forms a batch touches: every touched form must be re-exported in the configuration package.
- **Never** hand-build or commit a `.shaconfig`, publish anything, or delete a component the owner has not confirmed is
  unused (hide it instead). Never start, stop or rebuild the backend - the developer's IDE owns it.
- After every push: clear the browser form caches (IndexedDB `form:default-app`, `form_lookup:default-app`, `forms`)
  and tell the owner to close and reopen any Configuration Studio tab on that form (a stale designer tab saves the old
  markup over the push - hazard H27).
- "Similar, neat, aligned, well spaced" is the target - not a pixel-exact copy of phase2 (owner, 2026-10-02).

## Setup

1. Credentials: `<skill>/.local.json` `{"username": "...", "password": "..."}` (gitignored) or `$LBREC_CREDS`.
   Never print them.
2. Work dir: `<skill>/.work/` or `$LBREC_WORK` - snapshots, backups (`local/before`, `local/after`), sweep captures,
   cached logins. Gitignored.
3. Python 3.11+ with `playwright` (`python -m playwright install chromium`) and Node 20+ (script syntax gate).
4. Local 0.46 backend on :21021 and the adminportal on :3000, running on a local copy of the phase2 database.

Details: [references/environments.md](references/environments.md).

## Workflow

1. **Snapshot** both sides read-only: `python scripts/snapshot.py` (phase2 Live forms and 0-46-upgrade forms).
2. **Sweep** pages: `python scripts/capture.py p2` and `python scripts/capture.py local` (pages and record ids in
   [references/pages.json](references/pages.json); run slices `capture.py <env> <start> <end>` in parallel). Each page
   gets full-page screenshots per tab plus defect probes (label overflow, inner scrollbars, empty status tags, HTML
   render placeholders, empty 32px containers, panel headers, empty buttons, KPI cards).
3. **Compare** each page pair (screenshots + probes) and list defects with the owning form and component; check the
   defect register [references/defects.md](references/defects.md) first - most defects already have a rule.
4. **Diagnose** a new defect against the running app (computed styles, the 0.46 source, request interception) before
   writing a rule; prove the fix by intercepting the form response or on one local form.
5. **Rule**: add an idempotent, anchored transform (assert what you expect, refuse otherwise) to a module and a group
   in `scripts/reconcile.py`. Syntax-gate any script you write or rewrite.
6. **Functional check** after any change to a form with a Save: `python scripts/e2e_save.py <form> <id>` (Edit -> Save unchanged; expect 200 and back to view).
7. **Pilot**: `python scripts/reconcile.py --rules <group> --only <form,form>` (dry run), then `--push`; measure in
   the browser (`scripts/compare_geometry.py`, `scripts/compare_labels.py`); owner checks.
8. **Fleet**: `python scripts/reconcile.py --rules <group> --push`; run it again and expect `forms changed 0`.
9. **Record** the rule in [references/rules.md](references/rules.md) and the defect status in
   [references/defects.md](references/defects.md).

Full detail, including verification and revert: [references/workflow.md](references/workflow.md).

## Scripts

| Script | Purpose |
|---|---|
| `paths.py` | credentials / work-dir locations |
| `lbapi.py` | read-only API client (`Api('p2' / '046' / 'local')`) |
| `lbbrowse.py` | write-guarded headless browser session with cached login |
| `lbpush.py` | LOCAL write: backup, transform, `UpdateMarkup` (keeps `modelType`), read-back verify |
| `localforms.py` | list local forms, module name helper |
| `snapshot.py` | phase2 / 0-46-upgrade form snapshots |
| `capture.py` | page sweep: screenshots per tab + defect probes |
| `compare_geometry.py`, `compare_labels.py` | p2 vs local field / label geometry for one page |
| `reconcile.py` | fleet runner over the rule groups (dry run by default) |
| `split_labels.py` | move measured multi-line labels into their own text label (H20) |
| `hide_empty_buttons.py` | move empty-label buttons out of field columns into a hidden row (H26) |
| `move_dialog_footer.py` | dynamic custom dialog footer buttons rendered inside the dialog form; guard on shared dialog forms (H35) |
| `url_reflist_columns.py` | URL-sourced table columns bound to their reference list (H36) |
| `readonly_strip.py` | `onPrepareSubmitData` strips metadata read-only properties before submit (H42) |
| `urlfilter.py` | leftover never-resolving permanent filters removed from URL-sourced tables (H43) |
| `e2e_save.py` | functional check: Edit -> Save without changes, report write calls, errors, return to view |
| rule modules | `safechain.py`, `visstyle.py`, `textpresets.py`, `carriers.py`, `rls2dd.py`, `appearance046.py`, `tabsurface.py`, `statusbuttons.py`, `rowgap.py`, `tablecontrol.py`, `panelheader.py`, `labelsplit.py`, `tagnull.py`, `optfilter.py` (table filters, `editmode.py` (editMode values, H15), `acsort.py` (autocomplete sort, H38), `dialogfooter.py` (H35), `payloadcopy.py` (H39), `urlwait.py` (H40), `afterload.py` (H44), `gsrefresh.py` (H41); `optfilter.py` is H34 |

## References

- [references/rules.md](references/rules.md) - every rule: symptom, cause, what it writes, proof, status.
- [references/decisions.md](references/decisions.md) - the owner's decisions and boundaries, with dates.
- [references/defects.md](references/defects.md) - defect register (found, rule, status, forms touched).
- [references/environments.md](references/environments.md) - hosts, auth, caches, local backend.
- [references/workflow.md](references/workflow.md) - the full procedure, verification and revert.
- [references/pages.json](references/pages.json) - sweep pages with record ids.
