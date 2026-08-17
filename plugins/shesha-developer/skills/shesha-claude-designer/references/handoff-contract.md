# Handoff contract — roles, inputs/outputs, sequencing

The conductor (`shesha-claude-designer`) coordinates three specialists. This is the contract between them.

**Every handoff carries file paths, never file contents.** All of them are relative to `$RUN_DIR`, the single run directory created in [SKILL.md](../SKILL.md) Step 0 (`.claude/shesha/runs/<run-slug>/`) — older text saying `<workdir>` means this. Each dispatch prompt must state `$RUN_DIR` explicitly; an agent left to invent a scratch location writes somewhere nobody reads. Returning a large JSON blob through the conductor's context instead of a path is the single easiest context saving in the pipeline, and it also means the artifact still exists after a compaction.

## Roles

| Skill | Owns | Must NOT |
|---|---|---|
| `shesha-claude-designer` | ingest design, comprehend→plan, sequence, gate, verify end-to-end | author form JSON, pick hexes, push |
| `shesha-design-comprehension` | per-screen measured layout blueprint + placement verification (the probe + the diff) | author form JSON, pick hexes, push |
| `shesha-form-edit` | structure, CRUD wiring, validation, push, publish; **splits via flex `container` rows (never `columns`), sized via `desktop.dimensions.width`** | apply v7 appearance blocks itself; author `columns`; pick tokens/hexes |
| `shesha-design-system` | **all appearance**: app theme + per-component v7 style blocks + the v7 mechanics/channels docs + the capability matrix; audit | author structure, wire CRUD, push, or author `columns` |

## Contracts

**Designer → comprehension (Step 2, per screen)**
- Parent provides: `$RUN_DIR`, design source(s) + detected fidelity tier + screen name + (Tier A) repo/source paths + pinned viewport.
- Comprehension returns: **paths only** — `$RUN_DIR/blueprints/<screen>.blueprint.md` (archetype + `layout-tree` + `bindings` + `assertions`) and the saved probe `$RUN_DIR/probes/<screen>.design.layout.json`.

**Designer → shesha-form-edit (Step 4a, per screen) — "Contract A"**
- Parent provides: `$RUN_DIR`, the screen's **`blueprint.md` path**, the entity modelType (or "resolve from module"), the form identity (module + name), and the target backend context (if headless).
- shesha-form-edit returns: form created/edited (module + name + id), the detected version-profile facts, the resolved modelType, pushed/published state, the staged markup path under `$RUN_DIR/staged/`, **and a structural-integrity confirmation** — plus enough to run the placement probe (it builds the form `shesha-design-comprehension` will re-measure).
- **The conductor verifies the disk before accepting any of it:** read the staged path back and resolve every referenced form against the backend. Exit `0` pass · `1` fail · `2` unreadable · `3` partial. Agents in this pipeline have twice reported a completed form that was absent or referenced forms that did not exist; a returned verdict is a claim, the file is the evidence.

**Designer → shesha-design-system (Step 3 theme + Step 4b style)**
- Parent provides: `$RUN_DIR`, token set / theme name, the **path** to the built form under `$RUN_DIR/staged/`, version-profile facts, recipe list.
- shesha-design-system returns: **the path** `$RUN_DIR/staged/<screen>.styled.form.json` (style blocks only, structure untouched), plus app-theme changes, a role→colour trace and audit findings as compact data. It does NOT push, and it does NOT return the styled JSON inline — the parent routes the path through `shesha-form-edit`.

**Comprehension ↔ form-edit (Step 5a.5, per screen)**
- After build+publish, comprehension re-probes the rendered form into `$RUN_DIR/probes/<screen>.built-r<n>.layout.json` and diffs against the blueprint `assertions`; each mismatch is a routed fix phrased in `shesha-form-edit`'s vocabulary (move node into the right flex `container` row, give the child its `desktop.dimensions.width`, add `display:"flex"` to a stacking row, wrap rows 2-cell, assign to the right tab). Loop until all assertions pass.

## Sequencing rules

1. **Brand resolved first, once** — pick the brand and set the app-level primary/font/radius before any screen is built. Note the app theme only reaches chrome; per-screen fidelity comes from the pre-baked blocks ([app-theme.md](../../shesha-design-system/references/app-theme.md)).
2. **Comprehend before build** — every screen has a blueprint (Step 2) before `shesha-form-edit` is invoked. **With no design source this is Step 1b → a Tier D blueprint**, derived from the screen's archetype and the brand rather than measured. Tier D is a documented path, not a shortcut, and it still gets a blueprint: with nothing to compare against, structural drift is *harder* to notice.
3. **Structure and style are not separate passes.** Blocks arrive pre-styled, so a screen is built on-brand in one step ([block-library.md](../../shesha-form-edit/references/block-library.md)). `shesha-design-system` still owns the one-time app theme and re-styling forms this pipeline did not produce; anything it returns re-enters through form-edit's single push path.
4. **Gate order: 5a structural integrity → 5a.5 placement diff → 5b visual audit → 5c design critique.** A form failing placement is routed back to `shesha-form-edit`, never styled over. **5c (`design-critic`) is part of the contract** — on a brief that asked for a designed result, `generic` is not done; apply its ranked fixes and re-run, or report the verdict verbatim. Cap: 2 cycles each on 5a.5 and 5c, then an honest partial report.
   On Tier D, say what 5a.5 proved: the build matches the *archetype's* intended structure, not a user's design — there wasn't one.
5. **One push path** — all writes through `shesha-form-edit`. Sub-skills return paths, never pushes; `clean-form-config` hands back cleaned JSON and does not push either.
6. **Multi-screen** — `shesha-form-edit` may dispatch one form-author per distinct new form; comprehension verifies each screen's placement independently. **After every dispatch, verify the artifact on disk before accepting the agent's verdict** (see Contract A).
