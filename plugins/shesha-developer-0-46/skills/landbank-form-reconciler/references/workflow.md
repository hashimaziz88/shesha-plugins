# Workflow

All commands run from `.claude/skills/landbank-form-reconciler/scripts`. Writes go to the LOCAL backend only.

## 0. Preconditions

- Local backend answers (`GET .../Settings/GetValue?name=Shesha.ThemeSettings&module=Shesha&appKey=default-app` = 200)
  and the adminportal on :3000 renders a page. If not, ask the owner; never start or restart it yourself.
- Credentials in `<skill>/.local.json` (or `$LBREC_CREDS`).

## 1. Snapshot (read-only)

`python snapshot.py` writes `<work>/snapshots/p2/<module>/<form>.json` (phase2 Live versions) and
`<work>/snapshots/046/...`. The `layout` rule reads the phase2 snapshot to skip containers whose phase2 counterpart
stored its own minimum height. Refresh the snapshot when phase2 changes.

## 2. Sweep (read-only, headless)

```bash
python capture.py p2 0 25 & python capture.py p2 25 49 &      # phase2 is remote - parallel slices are fine
python capture.py local 0 25 & python capture.py local 25 49   # local dev server: at most 2 slices
```

Each page in `references/pages.json` gets `<work>/sweep/<env>/<module>__<form>.png` (+ `-t<k>` per tab, `-t<k>-s<j>`
per nested tab) and a probe JSON. Add pages (with a real record id) to `pages.json` when the owner names a new one.
The adminportal dev server is slow under load: if a page sits on "Initializing..." or throws `ChunkLoadError`, reload
it; do not interpret a half-loaded capture.

## 3. Compare

Fan out the `shesha-developer-0-46:reconciliation-assessor` agent, one per slice of ~9 pages (Sonnet, read-only), with
the noise list (data differences between the two databases, phase2's LIVE badges, the Inter font, edit-mode form
badges, offsets under 6px) and the already-fixed list from `references/defects.md`. Merge their findings into
`references/defects.md` (one row per distinct defect, with the pages and components it affects).

## 4. Diagnose a new defect

- Reproduce on the running local app (Chrome, the owner's view): computed styles, the component's
  `data-sha-c-id/-name/-type`, the owning form (`data-sha-c-form-name` on a subform wrapper,
  `data-sha-form-name` on the page form).
- Read the 0.46 source for the component (release-0.46.0) and the plugin hazards (H1-H46).
- A table with no rows: read the `Entities/GetAll` request body and the error text (intercept it, or the browser
  network log) and compare with the same page on phase2. A 400 with `null` inside an `and` filter is H34.
- Prove the fix without pushing when possible (Playwright route interception on `ConfigurationItem/GetCurrent`
  serving patched markup), otherwise on ONE local form.
- A data difference is not a defect: check the record on both databases through the API first.

## 5. Write the rule

A function `(component, notes) -> number of changes` (or `(markup, form, notes)` for form-level rules) that:
asserts its anchors and refuses otherwise; only rewrites values that are the migration's own output or unset;
never deletes a component (hide instead); is idempotent; keeps an author's explicit value. Add it to a group in
`reconcile.py`. Script rewrites go through the syntax gate (`safechain.syntax_errors`).

## 6. Pilot

```bash
python reconcile.py --rules <group> --only <formA>,<formB>          # dry run: notes + backups, nothing written
python reconcile.py --rules <group> --only <formA>,<formB> --push
```

Then clear the browser form caches, measure (`compare_geometry.py <path>`, `compare_labels.py`), screenshot, and ask
the owner to check in his own browser. Do not roll out before he confirms.

## 7. Fleet

```bash
python reconcile.py --rules <group>            # dry run: forms changed + changes per group
python reconcile.py --rules <group> --push
python reconcile.py --rules <group>            # must print "forms changed 0"
```

Report the number of forms touched (export cost) before pushing.

## 8. Verify

- Second dry run = zero changes (persistence + idempotence).
- Re-sweep the affected pages and re-run the assessor on them.
- The owner checks in his browser - that is the completion signal.

## Revert

Every push writes `<work>/local/before/<module>__<form>.<stamp>.json` (the full row before the write) and
`<work>/local/after/...` (the markup sent). To undo one rule precisely, write a transform that restores exactly the
values the rule changed (compare the before/after pair of the batch's stamp window) - not a blanket restore, which
would also undo later batches. A blanket restore of a form is only safe when no later batch touched it.

## Export

The reconciled configuration reaches other environments only through the configuration package exported by the
owner (never hand-build a `.shaconfig`). List the forms changed since the last export from the `local/after` stamps.
