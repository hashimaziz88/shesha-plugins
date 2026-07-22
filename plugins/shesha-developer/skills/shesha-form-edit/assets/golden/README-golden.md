# Golden archetypes (0.45)

One production-shaped form per archetype, keyed to the blueprint IR vocabulary.
These are **compiler fixtures and grep targets** — `compile-blueprint.js`
clones the closest archetype; agents choose via `_index.json` and grep
fragments, never read a whole file [R-050].

Provenance: RequirementsStudio (0.45.1) + employee starter seeds, v7 style
blocks throughout. The retired 0.43 corpus (pd-assetmanagement2) lives in git
history and belongs to the `shesha-developer-0-43` plugin's world.

Rebuild check: every file must pass `validate-schema.js` and
`validate-guardrails.js` (template placeholders like `{{NEW_KEY}}` are stamped
at clone time and are the only expected findings).
