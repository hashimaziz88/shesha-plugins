---
description: Build a Shesha form from an archetype + entity through the v2 compiler pipeline (spec → compile → gates → style → push → oracle)
argument-hint: <archetype> <entity> [module] [-- requirements...]
---

Build a Shesha form using `shesha-developer:shesha-form-edit` (invoke the skill
now and follow its pipeline exactly).

Arguments: `$ARGUMENTS` — first token = archetype (one of the eight in
`shesha-form-edit/references/archetypes.md`: table-worklist · record-detail ·
capture-dialog · standalone-capture · list-card · hub · dashboard · wizard),
second = entity name or fullClassName, optional third = module (default: the
app's main module), anything after `--` = extra requirements.

Non-negotiable path:
1. Pre-flight + `backend-probe.mjs` for the entity.
2. Synthesize the blueprint IR (schema:
   `shesha-design-comprehension/assets/blueprint.schema.json`) from the
   archetype + entity metadata + requirements.
3. `scripts/compile-spec.mjs` (the default `shesha` theme is baked in here, at
   compile — there is no follow-up styling pass [R-042]) →
   `scripts/validate-form.mjs` (Tier 1 + Tier 2) → push → ledger →
   re-fetch diff → `scripts/render-instrument.js`.
4. Report module + name + id + oracle verdict. A form without a PASS verdict
   is reported UNVERIFIED [R-046].
