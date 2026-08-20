---
name: shesha-claude-designer
description: THE ENTRY POINT for building a multi-screen Shesha UI that must look properly designed — with or without a design source. Use when the user hands over a design to MATCH (prototype, HTML/JSX, Figma-style kit, screenshots) or only describes it in prose. Triggers: "build this design in Shesha", "turn this prototype into Shesha forms", "create an X system with N pages", "make it look properly designed, not default AntD". It conducts across screens — a blueprint each — then orchestrates shesha-design-comprehension, shesha-spec and shesha-design-system and verifies by measurement. For a SINGLE form with no design intent use shesha-spec; to restyle one working form use shesha-design-system.
---

# Shesha Claude Designer

**The conductor for design → on-brand Shesha app.** It turns each screen into a **measured layout blueprint**, plans the screens, then delegates and verifies: structure to `shesha-spec`, styling to `shesha-design-system`, comprehension + placement to `shesha-design-comprehension`.

## Step R — route before paying for the pipeline

| Task shape | Route |
|---|---|
| Single screen, no design intent ("add a checkbox to X") | Hand the whole task to `Skill(shesha-developer:shesha-spec)` and stop. |
| Single screen + a real design source | This pipeline, comprehension inline (no fan-out), placement gate on that one screen. |
| **2+ screens, with or without a design source** | **Full pipeline.** Fan out per screen. |
| An existing form that just looks wrong | `Skill(shesha-developer:shesha-design-system)` directly. |

When routing away, pass full context (backend URL, credentials, module, `$RUN_DIR`). A prose brief with no design source is still a full-pipeline job (Step 1b), not a skip-to-build.

> Cross-skill contracts (handovers, gates, sequencing): [references/handoff-contract.md](references/handoff-contract.md) — read once per session.

## Steps

### Step 0 — Pre-flight: the run directory (once per run)
One directory holds the run: `$RUN_DIR = .claude/shesha/runs/<run-slug>/` (an absolute forward-slash path, under the TARGET PROJECT root), with `manifest.json`, `access-token`, `screen-inventory.json`, `blueprints/ probes/ staged/ screenshots/` (each artifact's stage is in its filename), and `run-log.md`.

- **`$RUN_DIR` goes in every dispatch prompt**; **handoffs pass paths, not blobs.** `manifest.json` is the run's memory (plan, build order, per-screen status) — update it at each phase boundary so the run resumes after compaction.
- **Authenticate once** into `$RUN_DIR/access-token` with a `fetchedAt` stamp; readers re-authenticate if stale.

### Step 1 — Ingest the design
Read the source; detect its **fidelity tier** (readable source / runnable app / screenshots) and extract the **token set** and the **screen list**. Normalise mixed docs with markitdown for content only; never parse a compiled/offline single-file bundle — serve+run it. Details: [references/design-ingestion.md](references/design-ingestion.md).

### Step 1b — No design source? Derive the inputs (do NOT skip to building)
Step 1 still produces both artifacts:
1. **Brand: use the shipped default** `shesha-design-system/assets/themes/shesha.tokens.json` (a complete brand). Author a new `<brand>.tokens.json` only if the user names a brand or supplies tokens.
2. **Screen inventory: read it out of the brief** — each named screen → a row (name, archetype, entity, cross-links). "A bookings list, a create dialog and a details page" → `list-card`, `capture`, `record-detail`. Write to `$RUN_DIR/screen-inventory.json`.
3. **Ambiguity is a question, not a guess** — column grid vs cards are different components.

Each screen still gets a **Tier D** blueprint (a documented tier). With no source, drift is *hardest to notice* — the blueprint matters more.

### Step 2 — Comprehend each screen into a layout blueprint  ← the placement spine
**REQUIRED SUB-SKILL** `shesha-developer:shesha-design-comprehension`. Per screen it writes `$RUN_DIR/blueprints/<screen>.blueprint.md` — an annotated layout with a placement `assertions` block. With a source the layout is **measured** (Tier A/B/C); without one **derived** from the archetype + brand (**Tier D**), provenance stamped honestly. See [blueprint-ir.md](../shesha-design-comprehension/references/blueprint-ir.md).

### Step 3 — Establish the theme (once) + plan the screens
Pick the brand (user names one / hands tokens / an existing `<brand>.tokens.json` → use it; a distinct palette/type → author one from the default; else → default `shesha`). Hand the token set to `shesha-design-system` to create the brand file and set the app-level theme (primary, font, radius) **once**. Map each screen to a form type + archetype (from the blueprint, don't re-derive) and **resolve each blueprint region to a block-library block** (e.g. `flex-split-main-rail`) **+ its paired style recipe** — plan = `{archetype, blocks[], recipes[]}`; sequence the build (list → detail → create). Present plan + blueprints + cost; gate on confirmation (unless headless).

### Step 4 — Build each screen (delegate), in order
- **(a) Structure — REQUIRED `shesha-developer:shesha-spec`:** pass the screen's `blueprint.md` as the requirements (archetype → seed/blocks; `layout-tree` spans → **flex `container` rows sized via `desktop.dimensions.width`**, never the `columns` component; `bindings` → component + propertyName). It builds structure, wires CRUD, validates and publishes.
- **(b) Styling — REQUIRED `shesha-developer:shesha-design-system`:** apply the theme's per-component v7 style blocks; it returns the styled JSON path under `$RUN_DIR/staged/` (`shesha-spec` owns the push). **Not optional, least of all with no design source** — on Tier D the brand file **is** the design. Every screen gets it, dialogs included.
- **(c) Verify on disk** — read the staged file back and resolve every referenced form against the backend. Exit `0` pass · `1` fail · `2` unreadable · `3` partial; a partial is never a pass.

### Step 5 — Verify (four gates, in order)
- **5a — Structural integrity:** archetype built with native components, fully flexed, fields bound. Failures route back to `shesha-spec`.
- **5a.5 — PLACEMENT diff (REQUIRED `shesha-design-comprehension`):** re-probe the built, published, table→details form into `$RUN_DIR/probes/` and diff against the blueprint `assertions`; route mismatches back to `shesha-spec`. **On Tier D, say what it did and did not prove** — it matches the archetype's structure, not a user design.
- **5b — Visual audit:** screenshot vs theme; `shesha-design-system` audit-mode returns prop-level fixes.
- **5c — Design critique (`shesha-developer:design-critic`):** dispatch the fresh-context judge (screenshot, probe, placement, theme). Returns `excellent | acceptable | generic | broken` + three ranked fixes. **`generic` is the finding this gate exists for** — a "make it look designed" brief is not done at `generic`. Apply the fixes and re-run, or report it verbatim with your disagreement — never overrule silently; cap 2 fix cycles.

### Step 6 — Confirm
Report per screen (form id, tier + pass/fail, theme, verify-artifact + critic verdicts), cross-link navigation, and flag anything unverified as UNVERIFIED.

## Non-negotiables — conduct, don't build
- **Every screen gets a blueprint before the builder runs, and none ships unstyled** — the brand theme reaches every screen, dialogs included.
- **Delegate ownership, one push path:** this skill plans, sequences and gates but never authors JSON, picks hexes, or pushes — all writes go through `shesha-spec`. Read the source, not the bundle; be honest about gaps rather than claim an unachievable pixel match.
