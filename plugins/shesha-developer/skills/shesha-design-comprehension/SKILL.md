---
name: shesha-design-comprehension
description: Use when a Shesha form must match a specific visual design and container/component placement keeps drifting — columns, nesting, tabs, or grouping landing in the wrong place. Also use to diagnose why an already-built form doesn't match its design. Turns a design source (readable HTML/JSX, a runnable prototype, or screenshots/PDF) into a measured, annotated layout blueprint — or, when there is no design source, derives the same blueprint from the screen's archetype and the resolved brand tokens (Tier D) — and verifies a built Shesha form against it by measurement. Invoked by shesha-claude-designer once per screen; pairs with shesha-spec (structure) and shesha-design-system (style).
---

# Shesha Design Comprehension

## What this skill does

**Placement is measured, not guessed.** Building a form from a *prose* description ("a header, then a two-column body, then related panels") forces the builder to re-imagine where every container sits — so columns, nesting depth, tab assignment and grouping drift. This skill removes the guessing: it produces a **layout blueprint** — a hybrid-Markdown IR carrying the *exact* container tree, flex-row split-child counts, native widths, tab keys and field bindings — then **verifies the built form by re-measuring the rendered DOM** against it. The blueprint is a placement *contract*.

It is the layer between "I have a design" and "build the form". It does **not** author form JSON, pick colours, or push.

## When to use

- Before building a Shesha form/page from any concrete design — readable HTML/JSX source, a runnable prototype/app, or screenshots/PDF.
- When a built form "doesn't line up with the design" — wrong columns, panels misplaced, a collapsed rail, merged tabs, fields stacked that should be side-by-side.
- Whenever `shesha-claude-designer` realises a multi-screen build — it calls this skill once per screen. **This includes runs with no design source**: the blueprint is then derived from the screen's archetype and brand tokens (**Tier D**, see [blueprint-ir.md](references/blueprint-ir.md)) rather than measured. It is worth writing either way — with no design to compare against, structural drift is *harder* to spot.

**Do NOT use** to author component structure/CRUD (`shesha-spec`), to apply colours/theme (`shesha-design-system`), or for a single form with no design intent ("add a sector dropdown") — that goes straight to `shesha-spec`.

## What it produces (per screen)

1. A **layout blueprint** — `$RUN_DIR/blueprints/<screen>.blueprint.md`. Format + worked example: [references/blueprint-ir.md](references/blueprint-ir.md).
2. A **capture** of the design's real layout — via one of three fidelity tiers (source / runnable / screenshot): [references/capture-pipeline.md](references/capture-pipeline.md).
3. A **placement verification** of the built form against the blueprint: [references/verification-loop.md](references/verification-loop.md).

## The pipeline

Flow: detect fidelity tier → capture layout → write blueprint.md → `shesha-spec` builds → re-probe the built form and diff vs the contract → route any mismatch back to the build.

1. **Detect the fidelity tier** — readable source (A, best), runnable app (B), screenshots/PDF (C). See [capture-pipeline.md](references/capture-pipeline.md).
2. **Capture the layout.** For a runnable design or any rendered page, use the verifier package's layout probe: it walks the DOM at a pinned viewport and emits column counts, spans, nesting and row grouping per container. For readable source, parse the grid templates directly. For screenshots/PDF, normalise content with markitdown and vision-read spatial layout.
3. **Write the blueprint** in [blueprint-ir.md](references/blueprint-ir.md) format — three fenced machine blocks per region: `layout-tree`, `bindings`, `contract`.
4. **Hand the blueprint to `shesha-spec`** as the build's requirements (archetype + seed + column spans + per-field binding). **REQUIRED PARTNER:** `shesha-developer:shesha-spec` builds the structure.
5. **Verify by measurement.** Re-probe the built, published, table→details-navigated form; diff actual placement against `contract`; route mismatches back to `shesha-spec`. See [verification-loop.md](references/verification-loop.md).

## markitdown is one layer, not the engine

markitdown (`convert_to_markdown`) **flattens 2-D layout by design** — it strips CSS, grid columns and positioning, turning a two-column row into two sequential lines. So it is **never** the source of placement: use it only to (a) normalise mixed inputs (PDF / `.docx` / `.pptx` / domain-model `.md`) into a content/label outline that *names* fields and cross-checks bindings, and (b) caption a screenshot. Spatial intent always comes from the probe (B), parsed source grid templates (A), or vision-reading the image (C) — details in [capture-pipeline.md](references/capture-pipeline.md). Treating markitdown as the layout engine reproduces the exact flattening bug this skill exists to fix.

## The layout probe

| Use | How |
|---|---|
| This environment | the probe's `--emit-eval --screen <name>` mode, then pass its output to `mcp__playwright__browser_evaluate` |
| Locally (CI / playwright) | the probe's `--url <url> --screen <name> --out <file>.json` mode |
| Read the signal | the `multiColumnContainers` array = split-child count + child widths per container; record widths in native units (px/fr/%) and map each child to a flex-container `desktop.dimensions.width` for the blueprint |

Pin **one** viewport (default 1440×900) for both capture and verification. Assert on split-child **membership / grouping / nesting depth / tab key**, never absolute pixels.

## Non-negotiables

- **Measure, don't guess.** Every split-child count / span comes from a probe measurement, a parsed source grid template, or (Tier C only) explicit vision reading — never prose intuition. Stamp every blueprint with its fidelity tier and confidence.
- **The blueprint is a contract.** Whatever the `contract` block states MUST be re-verified after the build. A blueprint without verification is just a prettier prose brief.
- **Splits are flex-container children, NEVER the Shesha `columns` component.** Build a split as a `container` with `display:"flex"` + `flexDirection:"row"` + a `gap`, and map each child's native span onto that child container's `desktop.dimensions.width` — the only channel that reaches the outer div. A filling main column is `width:"calc(100% - <rail+gap>px)"`; a fixed rail is `width:"332px"` with matching min/max. Per-child `customStyle:{flex:…}` is INERT for outer sizing (it lands on the inner div). Full rules + the worked width mapping: [blueprint-ir.md](references/blueprint-ir.md).
- **Stay in your lane.** Produce blueprints + verification verdicts. Never author form JSON, set colours, or push — route those to `shesha-spec` and `shesha-design-system`.
- **One viewport.** Never compare measurements taken at different viewports; record the viewport in every capture.

## Common mistakes

- **Parsing a compiled/minified single-file bundle** — it yields gibberish; *run* it (Tier B) and probe the rendered DOM, or read un-minified source (Tier A).
- **Skipping the re-probe** — if you don't measure the built form, you've re-described placement, not verified it.

## Relationship to the other skills

| Concern | Skill |
|---|---|
| Ingest design, plan screens, orchestrate, verify end-to-end | `shesha-developer:shesha-claude-designer` (calls this per screen) |
| **Comprehend design → measured blueprint + placement verification** | **this skill** |
| Build correct structure, CRUD, validate, push | `shesha-developer:shesha-spec` |
| Map tokens → app theme + per-component v7 style blocks | `shesha-developer:shesha-design-system` |
