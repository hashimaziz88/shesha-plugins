---
name: shesha-claude-designer
description: THE MAIN SKILL for all Shesha 0.45 designer work — the single entry point whether the user wants to build a new form ("create an asset worklist"), edit an existing one ("add a sector dropdown"), style or brand a form, realise a design source (wireframe, HTML/JSX prototype, runnable app, Figma-style kit, screenshot set), or deliver a whole multi-screen app. Triggers include "build this design in Shesha", "create a form for X", "make it match the design", "implement this mockup across the app". It routes by weight internally and drives the compiler pipeline (blueprint → compile → gates → style → push → oracle) through its execution layers — shesha-design-comprehension (measured blueprints), shesha-form-edit (compile/gates/push/oracle), shesha-design-system (tokens + v7 style blocks) — verifying every deliverable by measurement. Enter here first; the sub-skills remain directly invocable for targeted work.
---

# Shesha Claude Designer

**The conductor for design → on-brand Shesha app.** It never authors form JSON or picks colours — it moves **artifacts** between the three worker skills: design source → theme tokens + screen inventory → per-screen blueprint (`<screen>.blueprint.json`) → compiled+pushed form → gate/oracle results → report envelope. Roles, contracts and the fan-out map: **[references/conducting.md](references/conducting.md)**. The full pipeline diagram lives in **[README.md](README.md)** — read it once per session, not per screen. Firm-rule ids cite `shesha-form-edit/references/_rules.json`.

## Step R — Route by weight (always first)

This skill is often invoked as a blanket entry point for tasks that don't need a conductor. Route before paying for the pipeline:

| Task shape | Route |
|---|---|
| Single screen + NO design source (prose adjectives only) | Hand the ENTIRE task to `Skill(shesha-developer:shesha-form-edit)` and stop — its pipeline ends styled [R-042] and oracle-verified. Conducting a one-screen prose build is the measured #1 cause of 30+ min runs form-edit finishes in ~8. |
| Single trivial edit ("add a checkbox to X") | Same — straight to `shesha-form-edit`. |
| Single screen + a REAL design source (files to measure) | This pipeline, comprehension inline (no dispatch), placement gate on that one screen. |
| 2+ screens, or a kit/prototype covering an app | Full pipeline with per-screen fan-out. |

When routing away, pass the full context (backend URL, credentials, module, workdir) and let `shesha-form-edit` own the run end-to-end, including the summary.

## Step 0 — Pre-flight (once per session)

Pin one shell, one `<workdir>`, auth once (cached BOM-free token), resolve the skill root once, one scoped metadata fetch per entity, one consolidated confirmation gate, keep the cost ledger. Checklist: [conducting.md §Pre-flight](references/conducting.md); the underlying session rules are canonical in `shesha-form-edit/references/contracts.md`.

## Step 1 — Ingest the design

Identify the source and its fidelity tier: readable source (A) · runnable prototype (B — **serve it and probe it, never parse a minified bundle statically**) · screenshots/PDF (C — markitdown for content outlines ONLY, never placement). Produce two artifacts: the **token set** (palette, type, spacing, radius, shadow, status lifecycle → a `shesha-design-system` theme file) and the **screen inventory** (name, type, entity, chrome notes). Column-level layout is comprehension's job, not this step's.

## Step 2 — Comprehend each screen into a layout blueprint ← the placement spine

**REQUIRED SUB-SKILL `shesha-developer:shesha-design-comprehension`**, one agent per screen in parallel (MUST for 2+; contract in [conducting.md](references/conducting.md)). Each screen yields `<workdir>/blueprints/<screen>.blueprint.json`, validated against `shesha-design-comprehension/assets/blueprint.schema.json`: a measured node tree with explicit grid columns/spans, nesting, tab assignment, bindings, and a placement `assertions` block (typed predicates, not prose). The blueprint is the build input ("no spec, no build") — this is what stops container placement from drifting; never hand `shesha-form-edit` a prose brief. Name regions with the canonical archetypes from `shesha-design-system/references/default-layout-patterns.md`; measure only where the design deviates from those patterns.

## Step 3 — Establish the theme (once) + plan the screens

**Resolve the brand — a lookup, not an authoring task.** Run `node ../shesha-design-system/scripts/resolve-brand.mjs [<brand>]`. It returns an existing brand file, or the shipped **default `shesha`** when the requested one does not exist. **Never author a new `<brand>.tokens.json` during a design run** — not because a design's palette looks distinct, and not because a blueprint's `theme:` field names a brand that has no file. Brand authoring is a separate, explicitly requested, separately costed task — an easy way to sink a run's turns into an unrequested theme file. Full rule: `shesha-developer:shesha-design-system` SKILL.md Step 1.

Then hand the token set to `shesha-developer:shesha-design-system` to ensure the brand theme file exists and the app-level theme (primary, font, radius) is set **once**. Then map each design screen to a Shesha form type + archetype (read the archetype straight from each blueprint — don't re-derive it), **resolve each blueprint region to a block-library block** (`shesha-form-edit/assets/blocks` — e.g. `flex-split-main-rail`, `page-header-band`, `rail-panel`) **+ its paired style overlay/recipe** (`shesha-design-system`), so the per-screen plan is `{archetype, blocks[], recipes[]}`; and sequence the build order (list → detail → create is typical). Present the plan + blueprints + cost; gate on user confirmation (unless headless).

## Step 4 — Build each screen (delegate)

Fan out one `shesha-form-edit` dispatch per screen, in parallel. This is a **compile, not an authoring task** — dispatch prompt: *"compile the attached blueprint (`<workdir>/blueprints/<screen>.blueprint.json`) via `scripts/compile-spec.mjs`; return pushed+verified form facts."* Form-edit owns compile → gates → push → oracle [R-046]; agents never return unpushed markup as done.

**Styling is baked in at compile, not applied afterwards** [R-042]. The theme resolved in Step 3 is a *compile input* — form-edit's compiler bakes tokens into every node, so each screen arrives already on-brand and there is no unstyled intermediate to gate or to follow up on. `shesha-developer:shesha-design-system` still owns two things the compiler doesn't: the **one-time app AntD theme**, and **re-styling a form this compiler did not produce** (hand-composed forms, audits of live screens). Anything it returns still goes back through form-edit's single gated push path. Dispatching a *styling* prompt to a structure agent — or asking for a second styling pass over compiled output — is a contract violation.

## Step 5 — Verify against the design (three gates, in order)

1. **Structural** — form-edit's own oracle: re-fetch diff + render instrument + gate results (archetype built, native components only, layout fully flexed, fields bound). Failures route back to `shesha-form-edit`, not on to styling.
2. **Placement diff (REQUIRED `shesha-design-comprehension`)** — re-probe the built, published, table→details-navigated form (`layout-probe.js`), then run `node ../shesha-design-comprehension/scripts/verify-placement.mjs <blueprint.json> <built.probe.json>` — **its exit code is the gate**, not a model judgement. Exit 0 only when every typed assertion (`same-cluster`, `parent-of`, `ratio`, `same-rowband`, `tab`) passes; a non-zero exit prints each failing assertion with the measured vs. asserted fact — route those concrete failures back to `shesha-form-edit`, rebuild, re-probe, re-run until clean. **Cap: 2 routed-fix iterations per screen**, then an honest placement report — record the probe `*.layout.json` path; no recorded probe = not done. **`tab(a, key)` evaluates against a real build**: `layout-probe.js` reads Ant Design/rc-tabs' actual DOM (`role="tabpanel"`, `data-node-key`) and stamps a `tabKey` + `hidden` flag onto every node, descending into inactive-but-mounted panes (`display:none`) rather than skipping them. **One capture-order requirement:** a tab pane never activated during capture is never mounted into the DOM at all (rc-tabs' default), so click through every tab at least once before the final probe run that feeds this gate — see `shesha-design-comprehension`'s `references/verification-loop.md` step 3.
3. **Visual audit** — one final screenshot + console/network per screen in the adminportal; `shesha-design-system` audit-mode returns prop-level fixes (suggestions). **Cap: 2 fix cycles; waits ≤ 20 s.** When the `design-critic` agent is present, it consumes this gate and returns the verdict. If the frontend isn't running, report "built but NOT visually verified" — never "done".

## Step 6 — Report envelope

One aggregate envelope for the run: per screen — form (module + name + id), blueprint + schema-validation state, gate results, oracle verdict, placement diff outcome, visual verdict, probe/screenshot paths; plus theme applied and screen cross-links (list→detail→create). Anything unverified is reported UNVERIFIED.

## Non-negotiables — conduct, don't build

- **Comprehend before building.** Every screen gets a measured, schema-valid blueprint (Step 2) before `shesha-form-edit` is invoked. A prose layout description is the thing that drifts — never hand one to the builder in place of a blueprint.
- **Placement is verified by an exit code, not assumed or eyeballed** — BLOCKING and CAPPED (2 iterations). Gate 5.2 runs `verify-placement.mjs` against a re-probe of the built form; a screen is "done" only when that command exits 0 (every assertion PASS, including `tab()` — see Step 5 for the one capture-order requirement it carries). Visual gate is likewise capped (2 cycles) — an honest partial-match report beats an unconverging loop.
- **Delegate ownership.** Structure/push = `shesha-form-edit` [R-046]; styling = `shesha-design-system` ONLY; comprehension + placement verification = `shesha-design-comprehension`. Splits are flex containers, never `columns` [R-028]; flex containers set `display:"flex"` [R-029] — enforced by form-edit's gates, never patched by the conductor. This skill plans, sequences, and gates — it does not author JSON, pick hexes, or push.
- **Set up once, propagate everywhere** — pre-flight state (Step 0) rides in every dispatch prompt.
- **Fan out across screens (MUST for 2+)**; barriers (theme, push, verify) stay serial ([conducting.md](references/conducting.md)).
- **Read the source, not the bundle.** Run/serve a compiled prototype and probe it (or read un-minified source); never parse a minified single-file bundle.
- **Honesty about gaps.** If a design detail can't be expressed in Shesha, say so — don't claim a pixel match that isn't achievable.

| Concern | Skill |
|---|---|
| **THE ENTRY — route, ingest, plan, orchestrate artifacts, verify end-to-end** | **this skill** |
| Design → blueprint (.md + blueprint-json) + placement verify | `shesha-developer:shesha-design-comprehension` |
| Compile blueprint → gates → push → oracle | `shesha-developer:shesha-form-edit` |
| Tokens → app theme + v7 style blocks | `shesha-developer:shesha-design-system` |
| Ground truth (KB / schema / measured capability matrix reruns) | `shesha-developer:shesha-gym` |

Slash commands: `/shesha-build <archetype> <entity>` · `/shesha-audit
<module>/<form>` · `/shesha-gym` — each enters this pipeline at the right step.

For the full ownership split — who owns what, and what each skill must NOT do — see the canonical "Skill | Owns | Must NOT" table in [`README.md`](README.md), asserted in one place, not five.
