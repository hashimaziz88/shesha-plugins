---
description: Build a Shesha form from an archetype + entity through the compiler pipeline (spec → compile → gates → push → oracle)
argument-hint: <archetype> <entity> [module] [-- requirements...]
---

Build a Shesha form using `shesha-developer:shesha-form-edit` (invoke the skill
now and follow its pipeline exactly).

Arguments: `$ARGUMENTS` — first token = archetype (one of
`assets/golden/_index.json`: table-worklist · record-detail · hub · capture ·
modal-dialog · list-card · inline-card · dashboard), second = entity name or
fullClassName, optional third = module (default: the app's main module),
anything after `--` = extra requirements.

Non-negotiable path:
1. Pre-flight + `backend-probe.mjs` for the entity.
2. Synthesize the blueprint IR (schema:
   `shesha-design-comprehension/schemas/blueprint.schema.json`) from the
   archetype + entity metadata + requirements.
3. `scripts/compile-blueprint.js` → gates (`validate-schema` →
   `validate-guardrails` → `resolve-bindings`) → default-theme styling pass →
   push → ledger → re-fetch diff → `scripts/render-instrument.js`.
4. Report module + name + id + oracle verdict. A form without a PASS verdict
   is reported UNVERIFIED [R-046].
