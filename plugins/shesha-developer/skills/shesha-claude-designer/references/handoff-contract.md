# Handoff contract — roles, inputs/outputs, sequencing

The conductor (`shesha-claude-designer`) coordinates three specialists. This is the contract between them.

## Roles

| Skill | Owns | Must NOT |
|---|---|---|
| `shesha-claude-designer` | ingest design, comprehend→plan, sequence, gate, verify end-to-end | author form JSON, pick hexes, push |
| `shesha-design-comprehension` | per-screen measured layout blueprint + placement verification (the probe + the diff) | author form JSON, pick hexes, push |
| `shesha-form-edit` | structure, CRUD wiring, validation, push, publish; **splits via flex `container` rows (never `columns`), sized via `desktop.dimensions.width`** | apply v7 appearance blocks itself; author `columns`; pick tokens/hexes |
| `shesha-design-system` | **all appearance**: app theme + per-component v7 style blocks + the v7 mechanics/channels docs + the capability matrix; audit | author structure, wire CRUD, push, or author `columns` |

## Contracts

**Designer → comprehension (Step 2, per screen)**
- Parent provides: design source(s) + detected fidelity tier + screen name + (Tier A) repo/source paths + pinned viewport.
- Comprehension returns: `<workdir>/blueprints/<screen>.blueprint.json` (`assets/blueprint.schema.json` — archetype + node tree + `bindings` + typed `assertions`) and the saved probe `*.layout.json`.

**Designer → shesha-form-edit (Step 4a, per screen) — "Contract A"**
- Parent provides: the screen's **`blueprint.json` path**, the entity modelType (or "resolve from module"), the form identity (module + name), and the target backend context (if headless).
- shesha-form-edit compiles it (`scripts/compile-spec.mjs` then `scripts/validate-form.mjs` — see `shesha-form-edit/references/compiling.md`), then returns: form created/edited (module + name + id), the detected version-profile facts, the resolved modelType, pushed/published state, **and a structural-integrity confirmation** — plus enough to run the placement probe (it builds the form `shesha-design-comprehension` will re-measure).

**Designer → shesha-design-system (Step 3 theme + Step 4b style)**
- Parent provides: token set / theme name, the built form (id/JSON/path), version-profile facts, recipe list.
- shesha-design-system returns: styled JSON (style blocks only, structure untouched), app-theme changes, role→colour trace, audit findings. It does NOT push — hands styled JSON back for the parent to route through `shesha-form-edit`.

**Comprehension ↔ form-edit (Step 5a.5, per screen)**
- After build+publish, comprehension re-probes the rendered form and runs `node ../shesha-design-comprehension/scripts/verify-placement.mjs <blueprint.json> <built.probe.json>` — its exit code is the gate. A non-zero exit prints each failing assertion (measured vs. asserted fact); each becomes a routed fix phrased in `shesha-form-edit`'s vocabulary (move node into the right flex `container` row, give the child its `desktop.dimensions.width`, add `display:"flex"` to a stacking row, wrap rows 2-cell, assign to the right tab). Loop until the command exits 0. `tab()` assertions are a known exception — see `shesha-design-comprehension`'s `verification-loop.md` for the disclosed gap.

## Sequencing rules

1. **Token/app theme first, once** — establish the theme + set app-level primary/font/radius before per-screen styling.
2. **Comprehend before build** — every screen has a `blueprint.json` (Step 2) before `shesha-form-edit` is invoked.
3. **Structure before style, per screen.**
4. **Gate order: 5a structural integrity → 5a.5 PLACEMENT (verify-placement.mjs exit code) → 5b visual audit.** Placement is checked *before* styling; a form that fails placement is routed back to `shesha-form-edit`, never styled over.
5. **One push path** — all writes through `shesha-form-edit`.
6. **Multi-screen** — `shesha-form-edit` may dispatch one form-author per distinct new form; `shesha-design-system` styles centrally to keep the look coherent; comprehension verifies each screen's placement independently.
