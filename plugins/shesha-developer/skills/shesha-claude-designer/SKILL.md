---
name: shesha-claude-designer
description: Use when doing any Shesha 0.45 designer work — building a new form ("create an asset worklist"), editing an existing one ("add a sector dropdown"), styling or branding a form, realising a design source (wireframe, HTML/JSX prototype, runnable app, Figma-style kit, screenshot set), or delivering a whole multi-screen app. Also triggers on "build this design in Shesha", "make it match our brand", "implement this mockup across the app". THE single entry point for all designer work — routes internally to its execution layers (shesha-design-comprehension, shesha-form-edit, shesha-design-system) and verifies every deliverable by measurement. 0.45-only; sub-skills remain directly invocable for targeted work.
---

# Shesha Claude Designer

**The conductor for design → on-brand Shesha app.** It never authors form JSON or picks colours — it moves **artifacts** between the three worker skills: design source → theme tokens + screen inventory → per-screen blueprint (`.md` + `blueprint-json` twin) → compiled+pushed form → gate/oracle results → report envelope. Firm-rule ids cite `shesha-form-edit/references/_rules.json`.

## Step R — Route by weight (always first)

This skill is often invoked as a blanket entry point for tasks that don't need a conductor. Route before paying for the pipeline:

| Task shape | Route |
|---|---|
| Single screen + NO design source (prose adjectives only) | Hand the ENTIRE task to `Skill(shesha-developer:shesha-form-edit)` and stop — its pipeline ends styled [R-042] and oracle-verified. Conducting a one-screen prose build is the measured #1 cause of 30+ min runs form-edit finishes in ~8. |
| Single trivial edit ("add a checkbox to X") | Same — straight to `shesha-form-edit`. |
| Single screen + a REAL design source (files to measure) | This pipeline, comprehension inline (no dispatch), placement gate on that one screen. |
| 2+ screens, or a kit/prototype covering an app | Full pipeline. Whether to fan out or build inline sequentially is decided by the fan-out threshold, stated once in [orchestration.md](../shesha-form-edit/references/orchestration.md). |

When routing away, pass the full context (backend URL, credentials, module, workdir) and let `shesha-form-edit` own the run end-to-end, including the summary.

## Step 0 — Pre-flight (once per session)

Pin one shell, one `<workdir>`, auth once (cached BOM-free token), resolve the skill root once, one scoped metadata fetch per entity, one consolidated confirmation gate, keep the cost ledger. The conductor establishes this once per session and propagates it in every dispatch; re-establishing any of it per screen is the observed waste. The underlying session rules are canonical in `shesha-form-edit/references/contracts.md` §1–§3.

## Step 1 — Ingest the design

Identify the source and its fidelity tier: readable source (A) · runnable prototype (B — **serve it and probe it, never parse a minified bundle statically**) · screenshots/PDF (C — markitdown for content outlines ONLY, never placement). Produce two artifacts: the **token set** (palette, type, spacing, radius, shadow, status lifecycle → a `shesha-design-system` theme file) and the **screen inventory** (name, type, entity, chrome notes). Column-level layout is comprehension's job, not this step's.

## Step 2 — Comprehend each screen → blueprint

**REQUIRED SUB-SKILL `shesha-developer:shesha-design-comprehension`**, one agent per screen in parallel once past the fan-out threshold (canon: [orchestration.md](../shesha-form-edit/references/orchestration.md); below it, run inline sequentially). Provide design source(s) + fidelity tier + screen name + (Tier A) source paths + pinned viewport. Each screen yields `<workdir>/blueprints/<screen>.blueprint.md` — measured layout-tree/bindings/assertions **plus the fenced `blueprint-json` twin, validated against `shesha-design-comprehension/schemas/blueprint.schema.json` by `node shesha-design-comprehension/scripts/validate-blueprint.mjs <blueprint.json|.md>` (exit 0 = valid; the compiler runs the same validator and refuses to build otherwise)**. The twin is the build input ("no spec, no build"); never hand `shesha-form-edit` a prose brief. Name regions with the canonical archetypes from `shesha-design-system/references/default-layout-patterns.md`; measure only where the design deviates from those patterns.

## Step 3 — Theme once + plan

Brand selection: user-named brand / handed tokens / existing `<brand>.tokens.json` → use it; distinct palette in the design → author a new token file (an OVERRIDE: `"extends": "shesha"` plus only the keys that differ, key names kept); no brand but the user asks for something **"modern" / "professional" / "bolder"** → offer `shesha-bold` (the default's saturated voice, brand-tinted page-header band, same spacing/radius scales); else the default `shesha`. Hand the token set to `shesha-design-system` to set the app-level theme **once**. Map each screen to `{archetype, blocks[]}`; sequence the build (list → detail → create). Present plan + blueprints + cost; gate once (unless headless).

## Step 4 — Build (delegate)

Fan out one `shesha-form-edit` dispatch per screen, in parallel. Form-edit now **compiles** the blueprint — the dispatch prompt is: *"compile the attached blueprint (`<workdir>/blueprints/<screen>.blueprint.json` path or the blueprint-json block) with theme `<brand>` (from Step 3); return pushed+verified form facts."* Form-edit owns compile → gates → push → oracle [R-046]; agents never return unpushed markup as done.

Styling is a compile-time input, not a post-hoc pass: the theme chosen in Step 3 rides in the dispatch prompt and form-edit's compiler bakes its tokens into every node [R-042]. `shesha-design-system` supplies the token set and is invoked directly only to audit the rendered result or to re-style an already-built form — never as a second styling pass a structure agent hands work back to.

### Dispatch prompt (every per-screen build dispatch)

A dispatched agent does NOT read this skill — the dispatch prompt is its only binding:

> SKILL_ROOT: `<path>`. Pinned tool: **PowerShell tool only** (Windows) — never Bash. `<workdir>`: `<path>` (cached bearer token at `<workdir>/access-token` — reuse it, never re-authenticate). Screen: `<name>`. **Compile the attached blueprint**: `<workdir>/blueprints/<screen>.blueprint.json` (schema: `shesha-design-comprehension/schemas/blueprint.schema.json`) with theme `<brand>` (resolved in Step 3). Entity modelType: `<type>`. Form identity: module `<module>`, name `<name>`. Run the full form-edit pipeline — compile (tokens baked in [R-042]) → offline gates → publish → every verification layer you own. **Return the ONE evidence envelope from your quality-gates.md, complete. Never author `columns`; never report an unpushed or unverified form as done.** Write all scratch under `<workdir>`.

Omit any of these and the agent re-picks a shell, re-authenticates, or skips the oracle — the observed failure modes.

### Fan-out map (the parallel axis is the SCREEN)

| Stage | Mode | Why |
|---|---|---|
| 1 Ingest | serial, once | one design source → one token set + screen inventory |
| **2 Comprehend** | **∥ one agent per screen** | read-only, fully independent |
| 3 Theme | **BARRIER, once** | theme tokens resolved once; they ride in every Build-step dispatch, compiled in, not applied centrally afterward |
| **4 Build+verify (one form-edit run)** | **∥ one dispatch per screen** | distinct forms; each compiles its blueprint with theme tokens baked in and owns its gated publish AND its verification layers, returning one envelope [R-042] |
| 5 Aggregate | **serial, once** | read the envelopes, route back the ones that are not `verified` (cap 2), write the run report |

Cross-link ordering (list → detail → create) governs the **publish + verify** sequence, not the authoring. Within one screen's build, `shesha-form-edit` may fan out its own `form-author`s (its orchestration.md) — one level down; the conductor stays at the screen axis: dispatch one agent per screen in parallel.

## Step 5 — Receive envelopes (the conductor does NOT re-verify)

`shesha-form-edit` owns a screen end-to-end and returns ONE **evidence envelope** per screen — shape defined once in [shesha-form-edit/references/quality-gates.md](../shesha-form-edit/references/quality-gates.md) (`{form, blueprintHash, themeHash, gates, persistence, render, placement, visual, status}`). This step reads envelopes; it does not re-run the gates that produced them. Re-running them is a second browser pass per screen and a second owner of the same verdict.

1. **A screen is done when its envelope says `status: "verified"`.** Nothing further to do for it.
2. **`failed` or `unverified` → route the envelope back to form-edit**, naming the failing slot (`gates` / `persistence` / `render` / `placement` / `visual`) and the evidence paths it already carries. **Cap: 2 routed returns per screen**, then keep the last envelope and report it honestly.
3. **A missing slot is not a pass.** An envelope with `visual: null` (e.g. the frontend was not running) is reported "built but NOT visually verified" — never "done".

## Step 6 — Run report

Aggregate the envelopes — never re-derive their contents: per screen the envelope as returned, plus the theme applied and the screen cross-links (list→detail→create). Any screen whose envelope is not `verified` is reported UNVERIFIED.

## Non-negotiables — conduct, don't build

- **Comprehend before building** — every screen gets a schema-valid blueprint before form-edit is dispatched.
- **One completion owner per screen** — `shesha-form-edit` runs every gate and returns the envelope; the conductor routes envelopes back (capped at 2) and never re-runs a layer itself.
- **Delegate ownership**: structure/publish/verification = `shesha-form-edit` [R-046]; styling tokens = `shesha-design-system`, compiled in by form-edit, never a separate pass [R-042]; the placement SCRIPT belongs to `shesha-design-comprehension` (form-edit runs it). Splits are flex containers, never `columns` [R-028/R-029] — enforced by form-edit's gates, never patched by the conductor.
- **Set up once, propagate everywhere** — pre-flight state rides in every dispatch prompt.
- **Fan out across screens once past the threshold** ([orchestration.md](../shesha-form-edit/references/orchestration.md)); barriers (theme, report) stay serial (Step 4's fan-out map above).
- **Honesty about gaps** — if a design detail can't be expressed in Shesha, say so.

| Concern | Skill |
|---|---|
| **THE ENTRY — route, ingest, plan, orchestrate artifacts, verify end-to-end** | **this skill** |
| Design → blueprint (.md + blueprint-json) + the placement-verification script | `shesha-developer:shesha-design-comprehension` |
| Compile → gates → publish → oracle → the envelope | `shesha-developer:shesha-form-edit` |
| Tokens → app theme + v7 style blocks | `shesha-developer:shesha-design-system` |
| Ground truth (KB / schema / measured capability matrix reruns) | `/shesha-gym` command → `shesha-form-edit/references/gym.md` |

Slash commands: `/shesha-build <archetype> <entity>` compiles direct from
archetype+entity (skips comprehension, Steps 1-2 above); `/shesha-audit
<module>/<form>` is read-only verification; `/shesha-gym` regenerates ground
truth (maintenance, not a design pipeline run).
