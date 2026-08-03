---
name: shesha-form-edit
description: Use when building or editing one specific Shesha form — compiling a blueprint IR (or a spec synthesized from prose requirements) into markup, or when the user names a specific form and edit ("add a sector dropdown above the email field", "wire the Save button"). Enter via shesha-claude-designer for full designs; invoke directly for this targeted, single-form work. The build executor of the v2 compiler pipeline — types markup against the measured capability matrix, bakes in theme tokens from shesha-design-system at compile time, gates it mechanically, pushes via Create/UpdateMarkup, and verifies the deliverable. 0.45-only — versioned 0.43-class backends belong to the shesha-developer-0-43 plugin. Every new no-design form compiles with the default `shesha` theme's tokens baked in — no form ships unstyled.
allowed-tools:
  - Bash
  - PowerShell
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - WebFetch
  - Skill
  - Task
---

# Shesha Form Edit (v2 — 0.45 only)

The model does two things: **understand the requirement** and **make design
judgments**. Everything else is a script with a machine-checkable contract.
Mechanical facts live ONCE in [references/_rules.json](references/_rules.json)
— docs and validators cite `[R-xxx]`; when prose and the registry disagree, the
registry wins.

```
SPEC (blueprint IR) → COMPILE → GATES (hooks) → STYLE → PUSH → ORACLE → REPORT
```

Args: `$ARGUMENTS`. Flags: `--no-browser` (skip the render instrument),
`--no-style` (skip the default-theme pass — the only thing that skips it).

## Headless runs

When invoked non-interactively or with a supplied context block (Backend URL /
credentials / Module / Working dir): never call `AskUserQuestion`; the context
block overrides discovery. Missing form identity → resolve from the module's
form list, else create `{entity-kebab}-{type}` in the context module. Always
end with a summary naming every form created or modified (module + name + id)
— and a form is only "created" once the ORACLE step passes [R-046].

## 0 · Route

- **0.43-class backend detected** (`versionStatus` on GetByName, flat-prop
  markup)? Stop — that's the `shesha-developer-0-43` plugin. See
  [references/versioning.md](references/versioning.md).
- **Pure styling request** → `shesha-developer:shesha-design-system`.
- **Small edit to an existing form** (add/move/rewire a few components): skip
  the compiler; fetch → edit in place (preserve ids [R-025]) → GATES onward.
- **New form(s) or a structural rebuild**: full pipeline below.
- **4+ forms** → (threshold: [references/orchestration.md](references/orchestration.md))
  (fan out `form-author` agents; ONE `fleet-transformer` for bulk mutations).
- **Backend prerequisites in doubt** (new entity, missing reflist/endpoint) →
  dispatch `fullstack-prereq-checker` first; plan backend changes in one
  build + double-boot [R-040].

## 1 · Pre-flight (once per session)

[references/contracts.md](references/contracts.md) has the exact recipes:
pin one shell, one `<workdir>`, resolve the backend URL, authenticate once
(cache the token BOM-free [R-027]), resolve the module id. API routes are per
service — never guessed [R-026]: [references/api.md](references/api.md).

For entity-bound work run `scripts/backend-probe.mjs` — one probe returns
entity resolution, metadata, and reflist existence
([references/entity-binding.md](references/entity-binding.md)).

## 2 · Spec — no spec, no build

Every build has a spec: a **blueprint IR** JSON
(`shesha-design-comprehension/schemas/blueprint.schema.json`), validated by
`node ../shesha-design-comprehension/scripts/validate-blueprint.mjs <bp.json|.md>`
— the compiler runs that same validator first and exits 2, writing nothing, on a
finding.

- Design-driven work arrives with one (from `shesha-claude-designer` /
  `shesha-design-comprehension`) — consume it as-is.
- Prose requirements: synthesize the blueprint yourself — screen, entity
  (fullClassName + `{name,module}` modelType resolved live [R-016]), form
  identity, archetype, layout tree, bindings. "list"/cards → `datalist`;
  "table"/grid → `datatable` [R-019]. This is the judgment step: get the
  archetype and the layout tree right here, not in JSON surgery later.

Archetypes: the schema enum is the single authority — 11 values, see
`shesha-design-comprehension/schemas/blueprint.schema.json`:
<!-- archetype-enum -->
`record-detail` · `hub` · `list-card` · `capture` · `dashboard` ·
`solution-map` · `wizard` · `inline-card` · `table-worklist` ·
`modal-dialog` · `auth-page`.
(no goldens yet: solution-map, wizard). Golden files
(`assets/golden/_index.json`) are the seed/reference tier for
hand-composition and regression comparison — the compiler builds from the
blueprint tree directly and never reads them — grep fragments, never read one
whole [R-050].

## 3 · Compile

```
node scripts/compile-blueprint.js --blueprint <bp.json> --out <workdir>/<form>.json
```

The compiler types the JSON: flex containers with `desktop.dimensions.width`
[R-028/R-029], by-datatype components, live reflist identities [R-015],
`dataContext` v8 wrappers [R-005], the validationErrors + Submit/exit floor
[R-006/R-007/R-020], KB versions [R-003], deterministic ids.

Hand-composition is the exception (no archetype fits, exotic component mix) —
note WHY in the push ledger, compose from `assets/blocks/` (catalogue +
assembly workflow: [references/block-library.md](references/block-library.md))
+ `assets/components-kb/` quick shapes, and expect the same gates. Component
shapes and per-type recipes: [references/components/](references/components/)
(routed by `scripts/lookup.js` — run it for every component type you author;
a no-hit is a gate violation).

## 4 · Gates (hooks — not optional)

Every markup write triggers the validate-on-write hook; run them yourself
before push in any case, cheapest first:

```
node scripts/validate-schema.js <form.json>       # known types, id/version shapes
node scripts/validate-guardrails.js <form.json> [metadata.json]   # render-killers, cites [R-xxx]
node scripts/resolve-bindings.js <form.json>      # live: properties, dotted paths, reflists, endpoints
node scripts/validate-styledness.js <form.json>   # structure-only forms are defects [R-042]
```

Entity-bound forms MUST pass `resolve-bindings.js` (live backend) before push.
Fix findings by rule id; never bypass a gate. JSON-safety for embedded scripts:
[R-013] + [references/components/scripts.md](references/components/scripts.md).

## 5 · Style — compiled in, not a second pass

Design is a **compile-time input**: `compile-blueprint.js --theme <brand>`
(default `shesha`) resolves brand colour, type scale, radius, spacing and
borders from `shesha-design-system/assets/themes/<brand>.tokens.json` and bakes
them into every node, so the first output is already on-brand [R-042]. No
separate styling pass is needed for a compiled form.

Two things still route to `Skill(shesha-developer:shesha-design-system)`:
- **the one-time app AntD theme** (`$antdTheme` — input/table/button chrome), set
  once per app, not per form ([app-theme.md](../shesha-design-system/references/app-theme.md));
- **re-styling a form you did NOT compile** (a hand-composed form, a small edit,
  or matching a brand that has no token file yet).

Either way **you still own push + verification**. `--no-style` / an unknown
theme falls back to neutral tokens.

## 6 · Push + Oracle

Push: `POST FormConfiguration/Create` (new) / `PUT UpdateMarkup` (existing) —
[references/api.md](references/api.md). Record every form through the script —
never hand-write the ledger JSON:
`node scripts/ledger.mjs record --form <module>/<name> --id <guid> --status pushed`,
then `update --status verified` once the re-fetch diff is clean (or
`--status abandoned --note "<reason>"`). The Stop hook blocks session end while
any entry is open, and also blocks on a stale/malformed/hand-made ledger
[R-046]; `node scripts/ledger.mjs verify` is the same check on demand.

The oracle judges the deliverable through four fail-closed layers — a green
render alone never means done. Full model: [references/quality-gates.md](references/quality-gates.md).
1. **Re-fetch + diff** — the pushed markup equals what you sent; a 200 alone
   proves nothing [R-047] ([references/verification.md](references/verification.md)).
2. **Render instrument** (objective, unless `--no-browser`):
   `node scripts/render-instrument.js --form <module>/<name>` — or, for a set,
   `--forms <module>/<a>,<module>/<b>` (ONE Chromium launch, ONE login, per-form
   artifacts). Navigate, probe, screenshot, console/network dump, binding smoke,
   layout-quality checks (stacked splits, collapsed inputs/buttons, overflow).
   Writes `<module>--<name>.{png,verdict.json,layout-probe.json}`. Exit ≠ 0 →
   fix and re-run; diagnose via [references/debug.md](references/debug.md).
3. **Placement diff** (intent) — blueprint builds diff the blueprint's
   `assertions` against the instrument's `layout-probe.json`; this is what
   catches "the layout I intended didn't happen" (comprehension owns it).
4. **Design-critic** (visual quality, MANDATORY) — dispatch the
   `design-critic` agent with the screenshot + assertions + theme tokens; it
   returns a strict verdict (per-assertion, styled-ness, top-3 fixes). The
   build is NOT done until the critic PASSes (styled ≥ acceptable). A green
   render-instrument does not substitute for it.

**Browser budget — one boot per verify cycle.** Artifacts fan out; browsers
don't. Full tier table: [references/quality-gates.md](references/quality-gates.md).

| Tier | When | Browser work |
|---|---|---|
| 0 | fleet/bulk mid-flight forms; small edit to a form already verified this session | none — gates + re-fetch diff only |
| 1 (default) | every form you push and report done | ONE `render-instrument` run per form per fix cycle (batch with `--forms`). A green verdict **closes** browser work — layers 3 and 4 read its artifacts |
| 2 (exception) | the instrument FAILed and [references/debug.md](references/debug.md) routes to interactive diagnosis, **or** the user asked for interaction testing (dialog flows, nav wiring) | interactive Playwright MCP, scoped to that symptom/flow — never on a green run |

**A green instrument does not need a manual confirmation lap.** Re-driving a
browser over a PASSing verdict adds no evidence. The Stop hook logs
`BROWSER: <n> instrument-boots, <m> mcp-calls`.

## 7 · Report

One summary: every form (module + name + id), archetype used, gate results,
oracle verdict, ledger state. Anything unverified is reported as UNVERIFIED,
never as done.

## Reference map

| Topic | File |
|---|---|
| Rule registry (single source) | [references/_rules.json](references/_rules.json) |
| Session/shell/token contracts | [references/contracts.md](references/contracts.md) |
| API routes + push recipes | [references/api.md](references/api.md) |
| Entity binding + metadata probe | [references/entity-binding.md](references/entity-binding.md) |
| Component recipes (per type) | [references/components/](references/components/) via `scripts/lookup.js` |
| Block library (hand-composition tier) | [references/block-library.md](references/block-library.md) |
| Renderer physics (0.45) | [references/renderer-physics.md](references/renderer-physics.md) |
| Verification + browser rules | [references/verification.md](references/verification.md) |
| Symptom → cause | [references/debug.md](references/debug.md) |
| Bulk / multi-form orchestration | [references/orchestration.md](references/orchestration.md) |
| Ground-truth rerun (gym) | [references/gym.md](references/gym.md) |
| Version facts / 0.43 handoff | [references/versioning.md](references/versioning.md) |
| Quality floor + grading | [references/form-quality.md](references/form-quality.md) |
| Navigation menu wiring | [references/navigation-menu.md](references/navigation-menu.md) |
| Backend rebuild/restart | [references/backend-restart.md](references/backend-restart.md) |
| Full-stack prerequisites | [references/full-stack-prereqs.md](references/full-stack-prereqs.md) |
