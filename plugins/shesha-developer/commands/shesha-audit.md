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
   canonical `.evidence.json`, the mechanical placement verdict (or "no blueprint,
   no placement verdict"), the active theme token path, and `artDirection` when the
   blueprint carries it. The critic judges design only; it never scores placement.
5. Report: one table of findings by rule id, the instrument verdict, the
   critic verdict (`excellent | acceptable | generic | broken`) with its top-3
   fixes, and a fix list ordered by severity. Change nothing.
