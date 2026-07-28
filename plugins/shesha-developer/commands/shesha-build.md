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

The path, in two commands:

1. **Prerequisites + metadata snapshot.**
   `node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>` — exit 1
   names each blocker and the skill that fixes it. It also writes
   `<Entity>.probe.json`, the snapshot the build reads.
2. **Synthesize the blueprint IR** (schema:
   `shesha-design-comprehension/schemas/blueprint.schema.json`) from the
   archetype + that metadata + the requirements. This is the judgment step.
3. **Build — pure, no backend:**
   `node scripts/compile-blueprint.js --blueprint <bp.json> --metadata
   <Entity>.probe.json --out <form.json> [--theme <brand>]`. It validates the
   blueprint, resolves the archetype against the golden corpus, refuses types the
   measured matrix records as dead, and bakes the brand style plan in — there is
   no separate styling pass.
4. **Apply — the only mutation path:**
   `node scripts/apply-form.mjs --form <form.json> --module <mod> --name <form>`.
   One command stages, runs the gate chain, snapshots the prior markup, pushes,
   re-fetches, diffs canonically, renders, and writes the evidence bundle plus the
   ledger entry. It prints the bundle path on stdout.
5. **Report** module + name + id, and the bundle's `status`. Only `verified`
   counts as delivered; anything else is reported UNVERIFIED [R-046]. Verify with
   `node scripts/verify-evidence.mjs <bundle>` rather than by assertion.
