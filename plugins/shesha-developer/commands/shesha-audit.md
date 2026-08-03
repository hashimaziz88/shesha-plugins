---
description: Audit a live Shesha form — gates, bindings, render instrument, and a fresh-context critic verdict
argument-hint: <module>/<form-name> [--expect-data]
---

Audit the form `$ARGUMENTS` without modifying it:

1. Fetch its markup (`shesha-form-edit` references/api.md — GetByName/GetJson)
   into the workdir.
2. Run the gate chain read-only from
   `plugins/shesha-developer/skills/shesha-form-edit/scripts/`:
   `validate-schema.js`, `validate-guardrails.js` (with a metadata dump when
   the form is entity-bound), `resolve-bindings.js`, `validate-styledness.js`.
3. `render-instrument.js --form <module>/<name>` (pass `--expect-data` through).
4. Dispatch the `form-auditor` agent with the markup + findings, and the
   `design-critic` agent with ALL its inputs — the instrument screenshot, the
   form's blueprint assertions, and the active theme token path. Where no
   blueprint exists for the audited form, dispatch the critic in its
   no-blueprint mode (judges styled-ness + layout-quality only; verdict JSON
   carries `"mode":"no-assertions"`) and report the verdict flagged
   "no-assertions".
5. Report: one table of findings by rule id, the instrument verdict, the
   critic verdict, and a fix list ordered by severity. Change nothing.
