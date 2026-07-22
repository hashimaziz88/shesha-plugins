---
name: shesha-claude-designer
description: THE MAIN SKILL for all Shesha 0.45 designer work — the single entry point whether the user wants to build a new form ("create an asset worklist"), edit an existing one ("add a sector dropdown"), style or brand a form, realise a design source (wireframe, HTML/JSX prototype, runnable app, Figma-style kit, screenshot set), or deliver a whole multi-screen app. Triggers include "build this design in Shesha", "create a form for X", "make it match our brand", "implement this mockup across the app". It routes by weight internally and drives the v2 compiler pipeline (spec → compile → gates → style → push → oracle) through its execution layers — shesha-design-comprehension (measured blueprints), shesha-form-edit (compile/gates/push/oracle), shesha-design-system (tokens + v7 style blocks) — verifying every deliverable by measurement. Enter here first; the sub-skills remain directly invocable for targeted work.
---

# Shesha Claude Designer

**The conductor for design → on-brand Shesha app.** It never authors form JSON or picks colours — it moves **artifacts** between the three worker skills: design source → theme tokens + screen inventory → per-screen blueprint (`.md` + `blueprint-json` twin) → compiled+pushed form → gate/oracle results → report envelope. Roles, contracts and the fan-out map: **[references/conducting.md](references/conducting.md)**. Firm-rule ids cite `shesha-form-edit/references/_rules.json`.

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

## Step 2 — Comprehend each screen → blueprint

**REQUIRED SUB-SKILL `shesha-developer:shesha-design-comprehension`**, one agent per screen in parallel (MUST for 2+; Contract in [conducting.md](references/conducting.md)). Each screen yields `<workdir>/blueprints/<screen>.blueprint.md` — measured layout-tree/bindings/assertions **plus the fenced `blueprint-json` twin, validated against `shesha-design-comprehension/schemas/blueprint.schema.json`**. The twin is the build input ("no spec, no build"); never hand `shesha-form-edit` a prose brief. Name regions with the canonical archetypes from `shesha-design-system/references/default-layout-patterns.md`; measure only where the design deviates from those patterns.

## Step 3 — Theme once + plan

Brand selection: user-named brand / handed tokens / existing `<brand>.tokens.json` → use it; distinct palette in the design → author a new token file (copy the default `shesha`, swap values, keep key names); else the default `shesha`. Hand the token set to `shesha-design-system` to set the app-level theme **once**. Map each screen to `{archetype, blocks[]}`; sequence the build (list → detail → create). Present plan + blueprints + cost; gate once (unless headless).

## Step 4 — Build (delegate)

Fan out one `shesha-form-edit` dispatch per screen, in parallel. Form-edit now **compiles** the blueprint — the dispatch prompt is: *"compile the attached blueprint (`<workdir>/blueprints/<screen>.blueprint.json` path or the blueprint-json block); return pushed+verified form facts."* Form-edit owns compile → gates → push → oracle [R-046]; agents never return unpushed markup as done.

Styling goes through `shesha-developer:shesha-design-system` ONLY — theme blocks per the plan; form-edit re-pushes the styled result through its one gated path. A styling prompt to a structure agent is a contract violation.

## Step 5 — Verify (three gates, in order)

1. **Structural** — form-edit's own oracle: re-fetch diff + render instrument + gate results. Failures go back to form-edit before any styling.
2. **Placement diff** — `shesha-design-comprehension` re-probes the built, published, table→details-navigated form and diffs against the blueprint `assertions`. **Cap: 2 routed-fix iterations per screen**, then a placement report. Record the probe `*.layout.json` path — no recorded probe = not done.
3. **Visual audit** — one final screenshot + console/network per screen in the adminportal; `shesha-design-system` audit-mode returns prop-level fixes. **Cap: 2 fix cycles; waits ≤ 20 s.** When the `design-critic` agent is present, it consumes this gate and returns the verdict. If the frontend isn't running, report "built but NOT visually verified" — never "done".

## Step 6 — Report envelope

One aggregate envelope for the run: per screen — form (module + name + id), blueprint + schema-validation state, gate results, oracle verdict, placement diff outcome, visual verdict, probe/screenshot paths; plus theme applied and screen cross-links (list→detail→create). Anything unverified is reported UNVERIFIED.

## Non-negotiables — conduct, don't build

- **Comprehend before building** — every screen gets a schema-valid blueprint before form-edit is dispatched.
- **Placement and visual gates are BLOCKING and CAPPED** (2 iterations / 2 cycles) — an honest partial-match report beats an unconverging loop.
- **Delegate ownership**: structure/push = `shesha-form-edit` [R-046]; styling = `shesha-design-system` only; placement = `shesha-design-comprehension`. Splits are flex containers, never `columns` [R-028]; flex containers set `display:"flex"` [R-029] — enforced by form-edit's gates, never patched by the conductor.
- **Set up once, propagate everywhere** — pre-flight state rides in every dispatch prompt.
- **Fan out across screens (MUST for 2+)**; barriers (theme, push, verify) stay serial ([conducting.md](references/conducting.md)).
- **Honesty about gaps** — if a design detail can't be expressed in Shesha, say so.

| Concern | Skill |
|---|---|
| **THE ENTRY — route, ingest, plan, orchestrate artifacts, verify end-to-end** | **this skill** |
| Design → blueprint (.md + blueprint-json) + placement verify | `shesha-developer:shesha-design-comprehension` |
| Compile blueprint → gates → push → oracle | `shesha-developer:shesha-form-edit` |
| Tokens → app theme + v7 style blocks | `shesha-developer:shesha-design-system` |
| Ground truth (KB / schema / measured capability matrix reruns) | `shesha-developer:shesha-gym` |

Slash commands: `/shesha-build <archetype> <entity>` · `/shesha-audit
<module>/<form>` · `/shesha-gym` — each enters this pipeline at the right step.
