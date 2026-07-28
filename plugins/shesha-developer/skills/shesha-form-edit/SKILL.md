---
name: shesha-form-edit
description: Builds and edits ONE Shesha 0.45 designer form against a live backend. Use when the user names a form and a change ("add a sector dropdown above the email field", "wire the Save button", "the table shows blank cells"), or asks for a single new form from prose requirements. Compiles a blueprint into markup from the generated component KB and brand theme tokens, runs four scripted gates (schema, guardrails, live bindings, styled-ness), pushes via Create/UpdateMarkup, then verifies by re-fetch diff and a render instrument before reporting anything as delivered. NOT for realising a design source or a multi-screen app (shesha-claude-designer), NOT for theme or brand work (shesha-design-system), and NOT for a 0.43-class backend (shesha-developer-0-43 plugin).

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
BUILD (pure, offline)                    APPLY (the only mutation)
spec → validate → compile ──────────────▶ apply-form.mjs
                                          stage → gates → snapshot → push
                                          → re-fetch diff → render → evidence
```

**Build never touches the backend.** `compile-blueprint.js` reads a metadata snapshot, so a
build is reproducible and testable offline. **`scripts/apply-form.mjs` is the only supported
way to change the backend** — it runs the gate chain, snapshots the prior markup, pushes,
re-fetches, diffs canonically, renders, and writes a content-addressed evidence bundle plus
the push ledger entry. Nothing else writes that ledger, and the Stop hook verifies the
bundle rather than trusting a summary.

Args: `$ARGUMENTS`. Flags: `--no-browser` (skip the render instrument),
`--no-style` (compile with neutral tokens instead of a brand theme).

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
- **2+ forms** → fan out one `shesha-frontend-engineer` per form; for a bulk
  mechanical change use exactly ONE, pilot-first
  ([references/bulk-operations.md](references/bulk-operations.md)). Dispatch
  contract + per-form manifest: [references/contracts.md](references/contracts.md) §4.
- **Backend prerequisites in doubt** (new entity, missing reflist/endpoint) →
  run `node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>`; it exits 1
  naming each blocker and the skill that fixes it. Plan backend changes in one
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
(`shesha-design-comprehension/schemas/blueprint.schema.json`).

- Design-driven work arrives with one (from `shesha-claude-designer` /
  `shesha-design-comprehension`) — consume it as-is.
- Prose requirements: synthesize the blueprint yourself — screen, entity
  (fullClassName + `{name,module}` modelType resolved live [R-016]), form
  identity, archetype, layout tree, bindings. "list"/cards → `datalist`;
  "table"/grid → `datatable` [R-019]. This is the judgment step: get the
  archetype and the layout tree right here, not in JSON surgery later.

Archetypes: `assets/golden/_index.json` (table-worklist · record-detail · hub
· capture · modal-dialog · list-card · inline-card · dashboard). Golden files
are compiler fixtures — grep fragments, never read one whole [R-050].

## 3 · Compile (pure — no backend)

```
node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>     # once: metadata snapshot
node scripts/compile-blueprint.js --blueprint <bp.json> --out <workdir>/<form>.json \
     --metadata <workdir>/<Entity>.probe.json [--theme <brand>]
```

The compiler **validates the blueprint itself** and exits non-zero on violation — never
assume an upstream agent validated it, because an agent that skipped the step and one that
ran it look identical from here. It also resolves the archetype against
`assets/golden/_index.json` and refuses to emit any component type the measured capability
matrix records as `not-registered` or `breaks-render`.

Without `--metadata` it still compiles, but warns: component choice falls back to declared
datatypes and reference-list identity cannot be resolved [R-015]. `--live` fetches metadata
instead of using a snapshot, for interactive work where no snapshot exists yet.

The compiler types the JSON: flex containers with `desktop.dimensions.width`
[R-028/R-029], by-datatype components, live reflist identities [R-015],
`dataContext` v8 wrappers [R-005], the validationErrors + Submit/exit floor
[R-006/R-007/R-020], KB versions [R-003], deterministic ids.

Hand-composition is the exception (no archetype fits, exotic component mix) —
note WHY in the push ledger, compose from `assets/blocks/` +
`assets/components-kb/` quick shapes, and expect the same gates. Component
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

## 5 · Style — compiled in, never a second pass

Appearance is owned by `shesha-design-system`, but it is **linked, not invoked**.
It exposes a pure function — tokens → a normalized style plan validated against
`shesha-design-system/schemas/style-plan.schema.json` — and
`compile-blueprint.js --theme <brand>` (default `shesha`) consumes that plan and
bakes concrete colour, type, radius and border values into every node. The first
output is already on-brand [R-042]; there is no later free-form styling pass to
schedule, and `shesha-design-system` never pushes.

A theme that cannot resolve every key the plan requires falls back to neutral
values **with a warning** rather than emitting half a brand — that half-styled
state is what previously shipped "styled" forms that were still grey. Inspect any
brand's plan directly:

```
node ../shesha-design-system/scripts/resolve-style-plan.mjs <brand>
```

Two things still route to `Skill(shesha-developer:shesha-design-system)` as work,
not as a pass over your output:
- **authoring or changing a brand** — a new `<brand>.tokens.json`, or a token
  value change; and **the one-time app AntD theme** (`$antdTheme` — input/table/
  button chrome), set once per app, never per form;
- **re-styling a form you did NOT compile** — a hand-composed form or a small
  edit to a live one.

Either way **you still own push + verification**. `--no-style` compiles with
neutral tokens.

## 6 · Apply — one command, one mutation path

```
node scripts/apply-form.mjs --form <workdir>/<form>.json --module <mod> --name <form>
```

It performs the whole sequence and records it: stage → the gate chain → snapshot the prior
markup → push → re-fetch → canonical diff → render → write a **content-addressed evidence
bundle** (keyed by the sha256 of the pushed markup, with a sidecar digest) plus the push
ledger entry. Exit 0 only when the push landed *and* the re-fetch matches.

Flags: `--dry-run` (everything except the mutation) · `--no-browser` (records
`pushed-unrendered`, which the Stop hook treats as not delivered) · `--allow-theme-change`
(**required** when the markup carries app-level theme settings — repainting the portal
because one form was asked to match a screenshot is what this guards) · `--evidence-dir`.

Do not push by hand. `apply-form.mjs` is the only writer of the ledger, and the Stop hook
verifies the bundle's digest — a hand-written ledger entry or an edited bundle is detected
and blocks [R-046].

The oracle judges the deliverable through four layers — a green render alone never means
done. Full model: [references/verification.md §0](references/verification.md).
1. **Re-fetch + canonical diff** — the backend holds what you sent; a 200 alone proves
   nothing [R-047]. Run inside `apply-form.mjs`.
2. **Render instrument** — navigate, probe, screenshot, console/network dump, binding smoke,
   layout-quality checks (stacked splits, collapsed inputs/buttons, overflow). Run inside
   `apply-form.mjs`; diagnose failures via [references/debug.md](references/debug.md).
3. **Placement diff** (intent) — blueprint builds re-probe against the
   blueprint's `assertions`; this is what catches "the layout I intended didn't
   happen" (comprehension owns it).
4. **Design-critic** (visual quality, MANDATORY) — dispatch the
   `shesha-design-critic` agent with the screenshot + assertions + theme tokens; it
   returns a strict verdict (per-assertion, styled-ness, top-3 fixes). The
   build is NOT done until the critic PASSes (styled ≥ acceptable). A green
   render-instrument does not substitute for it.

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
| Blueprint node grammar | [references/designing-like-react.md](references/designing-like-react.md) |
| Renderer facts + form JSON model (0.45) | [plugin knowledge/frontend-conventions.md](../../knowledge/frontend-conventions.md) |
| Verification + browser rules | [references/verification.md](references/verification.md) |
| Symptom → cause | [references/debug.md](references/debug.md) |
| Bulk / multi-form mechanics | [references/bulk-operations.md](references/bulk-operations.md) |
| Ground-truth rerun (gym) | [references/gym.md](references/gym.md) |
| Version facts / 0.43 handoff | [references/versioning.md](references/versioning.md) |
| Quality floor + grading | [references/form-quality.md](references/form-quality.md) |
| Navigation menu wiring | [references/navigation-menu.md](references/navigation-menu.md) |
| Backend rebuild/restart | [references/backend-restart.md](references/backend-restart.md) |
| Full-stack prerequisites | [references/full-stack-prereqs.md](references/full-stack-prereqs.md) |
