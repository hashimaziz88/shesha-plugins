---
description: Build a Shesha form from an archetype + entity through the v2 compiler pipeline (spec → compile → gates → style → push → oracle)
argument-hint: <archetype> <entity> [module] [-- requirements...]
---

Build a Shesha form using `shesha-developer:shesha-form-edit` (invoke the skill
now and follow its pipeline exactly).

Arguments: `$ARGUMENTS` — first token = archetype, one of the 11 values in the
schema enum (`shesha-design-comprehension/schemas/blueprint.schema.json` is the
authority): record-detail · hub · list-card · capture · dashboard ·
solution-map · wizard · inline-card · table-worklist · modal-dialog ·
auth-page. Second = entity name or fullClassName, optional third = module
(default: the app's main module), anything after `--` = extra requirements.

Non-negotiable path:
1. Pre-flight + `backend-probe.mjs` for the entity.
2. Synthesize the blueprint IR (schema:
   `shesha-design-comprehension/schemas/blueprint.schema.json`) from the
   archetype + entity metadata + requirements, theme resolved (brand name or
   token-file path) as a compile-time input [R-042].
3. `scripts/compile-blueprint.js --theme <brand>` → gates (`validate-schema` →
   `validate-guardrails` with the metadata arg → `resolve-bindings` →
   `validate-styledness`) → push → ledger → re-fetch diff →
   `scripts/render-instrument.js` → dispatch `design-critic` with the
   screenshot + blueprint assertions + theme token path. Build not done until
   the critic PASSes.
4. Report module + name + id + oracle verdict + critic verdict. A form
   without a PASS verdict is reported UNVERIFIED [R-046].
