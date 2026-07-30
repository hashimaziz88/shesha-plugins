---
description: Audit a live Shesha form — gates, bindings, render instrument, and a fresh-context critic verdict
argument-hint: <module>/<form-name> [--expect-data]
---

Audit the form `$ARGUMENTS` without modifying it:

1. Fetch its markup (`shesha-form-edit/references/api.md` — GetByName/GetJson)
   into the workdir.
2. Run the gate chain read-only from
   `plugins/shesha-developer/skills/shesha-form-edit/scripts/`:
   `validate-schema.js`, `validate-guardrails.js` (with a metadata dump when
   the form is entity-bound), `resolve-bindings.js`, `validate-styledness.js`.
3. `render-instrument.js --form <module>/<name>` (pass `--expect-data` through).
4. Dispatch the `form-auditor` agent with the markup + findings, and the
   `design-critic` agent with the instrument screenshot.
5. Report: one table of findings by rule id, the instrument verdict, the
   critic verdict, and a fix list ordered by severity. Change nothing.
