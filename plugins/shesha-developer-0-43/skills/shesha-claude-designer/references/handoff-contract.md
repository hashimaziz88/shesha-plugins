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
- Comprehension returns: `<workdir>/blueprints/<screen>.blueprint.md` (archetype + `layout-tree` + `bindings` + `assertions`) and the saved probe `*.layout.json`.

**Designer → shesha-form-edit (Step 4a, per screen) — "Contract A"**
- Parent provides: the screen's **`blueprint.md` path**, the entity modelType (or "resolve from module"), the form identity (module + name), and the target backend context (if headless).
- shesha-form-edit returns: form created/edited (module + name + id), the detected version-profile facts, the resolved modelType, pushed/published state, **and a structural-integrity confirmation** — plus enough to run the placement probe (it builds the form `shesha-design-comprehension` will re-measure).
- **0.43 version-lifecycle outcome (required in the return):** because 0.43 forms are versioned ConfigurationItems, shesha-form-edit must also report the lifecycle transition it performed — whether it created a new Draft (`CreateNewVersion`) or reused an in-flight Draft/Ready, the `versionNo` and the `UpdateStatus` path taken (Draft(1)→Ready(2)→Live(3)), whether the prior Live was auto-retired, **and the id of the now-Live version to re-probe**. The Step 5a.5 placement probe must measure this newly published Live id, never a stale/Retired one. Full algorithm: [version lifecycle](../../shesha-form-edit/references/version-lifecycle.md).

**Designer → shesha-design-system (Step 3 theme + Step 4b style)**
- Parent provides: token set / theme name, the built form (id/JSON/path), version-profile facts, recipe list.
- shesha-design-system returns: styled JSON (style blocks only, structure untouched), app-theme changes, role→colour trace, audit findings. It does NOT push — hands styled JSON back for the parent to route through `shesha-form-edit`.

**Comprehension ↔ form-edit (Step 5a.5, per screen)**
- After build+publish, comprehension re-probes the rendered form and diffs against the blueprint `assertions`; each mismatch is a routed fix phrased in `shesha-form-edit`'s vocabulary (move node into the right flex `container` row, give the child its `desktop.dimensions.width`, add `display:"flex"` to a stacking row, wrap rows 2-cell, assign to the right tab). Loop until all assertions pass.

## Sequencing rules

1. **Token/app theme first, once** — establish the theme + set app-level primary/font/radius before per-screen styling.
2. **Comprehend before build** — every screen has a `blueprint.md` (Step 2) before `shesha-form-edit` is invoked.
3. **Structure before style, per screen.**
4. **Gate order: 5a structural integrity → 5a.5 PLACEMENT diff → 5b visual audit.** Placement is checked *before* styling; a form that fails placement is routed back to `shesha-form-edit`, never styled over.
   - **0.43 fix loop reuses one Draft:** on a 0.43 backend each edit to a Live form spawns a new version, so the build→verify→fix loop must keep editing the **same in-flight non-Live Draft/Ready** version (`CreateNewVersion` at most **once per edit session**, then re-`UpdateMarkup` that same Draft for every routed fix). Publish (`UpdateStatus`→Live, which auto-retires the current Live) **only once** the placement and visual gates pass — this avoids a proliferation of versions and premature auto-retirement of the current Live. After publish, clear the adminportal IndexedDB caches (`forms`/`entities`/`ref-lists`/`misc`) before the re-probe. See [version lifecycle](../../shesha-form-edit/references/version-lifecycle.md).
5. **One push path** — all writes through `shesha-form-edit`.
6. **Multi-screen** — `shesha-form-edit` may dispatch one form-author per distinct new form; `shesha-design-system` styles centrally to keep the look coherent; comprehension verifies each screen's placement independently.
