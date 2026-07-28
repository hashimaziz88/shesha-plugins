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

# Shesha Form Edit (0.45 only)

The model does two things: **understand the requirement** and **make design judgments**.
Everything else is a script with a machine-checkable contract. Mechanical facts live ONCE in
[references/_rules.json](references/_rules.json) — docs and validators cite `[R-xxx]`; when
prose and the registry disagree, the registry wins.

```
BUILD (pure, offline)                    APPLY (the only mutation)
spec → validate → compile ──────────────▶ apply-form.mjs
                                          stage → gates → snapshot → push
                                          → re-fetch diff → render → evidence
```

`compile-blueprint.js` reads a metadata snapshot, so a build is reproducible and testable
offline. **`scripts/apply-form.mjs` is the only supported way to change the backend** — it
writes the evidence bundle and the push ledger, and the Stop hook verifies that bundle rather
than trusting a summary.

Args: `$ARGUMENTS`.

**Headless runs** — with a supplied context block (backend URL / credentials / module /
workdir): never call `AskUserQuestion`; the context block overrides discovery. Missing form
identity → resolve from the module's form list, else create `{entity-kebab}-{type}` in the
context module. Always end by naming every form created or modified (module + name + id), and
a form counts as delivered only once its evidence bundle records `verified` [R-046].

## 0 · Route

- **0.43-class backend** (`versionStatus` on GetByName, flat-prop markup)? Stop — that is the
  `shesha-developer-0-43` plugin ([references/versioning.md](references/versioning.md)).
- **Pure styling request** → `shesha-developer:shesha-design-system`.
- **Small edit to an existing form** (add/move/rewire a few components): skip the compiler;
  fetch → edit in place (preserve ids [R-025]) → gates onward.
- **New form or a structural rebuild**: the pipeline below.
- **2+ forms** → one `shesha-frontend-engineer` per form; for a bulk mechanical change use
  exactly ONE, pilot-first ([references/bulk-operations.md](references/bulk-operations.md)).
  Dispatch contract + per-form manifest: [references/contracts.md](references/contracts.md) §4.
- **Backend prerequisites in doubt** → `scripts/backend-probe.mjs` exits 1 naming each blocker
  and the skill that fixes it. Plan all backend changes in one build + double-boot [R-040].

## 1 · Pre-flight (once per session)

Pin one shell, one `<workdir>`, resolve the backend URL, authenticate once (cache the token
BOM-free [R-027]), resolve the module id — recipes in
[references/contracts.md](references/contracts.md). API routes are per service, never guessed
[R-026]: [references/api.md](references/api.md).

## 2 · Spec — no spec, no build

Every build has a **blueprint IR** (`shesha-design-comprehension/schemas/blueprint.schema.json`).
Design-driven work arrives with one — consume it as-is. From prose, synthesize it: screen,
entity (fullClassName + `{name,module}` modelType, both required [R-016]), form identity,
archetype, layout tree, bindings. "list"/cards → `datalist`; "table"/grid → `datatable`
[R-019]. **This is the judgment step** — get the archetype and layout tree right here, not in
JSON surgery later. Node grammar: [references/designing-like-react.md](references/designing-like-react.md).

Archetypes are the keys of `assets/golden/_index.json`. Golden files are compiler fixtures —
grep fragments, never read one whole [R-050].

## 3 · Compile (pure — no backend)

```
node scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>     # once: metadata snapshot
node scripts/compile-blueprint.js --blueprint <bp.json> --metadata <Entity>.probe.json \
     --out <workdir>/<form>.json [--theme <brand>]
```

It **validates the blueprint itself** and exits non-zero — never assume an upstream agent
validated it, because one that skipped the step and one that ran it look identical from here.
It resolves the archetype against the golden corpus and refuses any component type the
measured capability matrix records as `not-registered` or `breaks-render`.

Emitted shape: flex containers with `desktop.dimensions.width` [R-028/R-029], by-datatype
components, live reflist identities [R-015], `dataContext` v8 wrappers [R-005], the
validationErrors + Submit/exit floor [R-006/R-007/R-020], KB versions [R-003], path-seeded
deterministic ids.

Without `--metadata` it still compiles but warns — component choice falls back to declared
datatypes and reflist identity cannot be resolved [R-015]. `--live` fetches metadata instead,
for interactive work with no snapshot yet.

Hand-composition is the exception (no archetype fits): compose from `assets/blocks/` +
`assets/components-kb/`, expect the same gates. Per-type recipes live in
[references/components/](references/components/), routed by `scripts/lookup.js` — run it for
every component type you author.

## 4 · Gates

Every markup write triggers the validate-on-write hook; run them yourself before applying,
cheapest first:

```
node scripts/validate-schema.js <form.json>       # known types, id/version shapes
node scripts/validate-guardrails.js <form.json> [metadata.json]   # render-killers, cites [R-xxx]
node scripts/resolve-bindings.js <form.json>      # live: properties, dotted paths, reflists, endpoints
node scripts/validate-styledness.js <form.json>   # structure-only forms are defects [R-042]
```

Entity-bound forms must pass `resolve-bindings.js` against the live backend before applying.
Fix findings by rule id; never bypass a gate. JSON-safety for embedded scripts: [R-013] +
[references/components/scripts.md](references/components/scripts.md).

## 5 · Style — compiled in, never a second pass

`shesha-design-system` is **linked, not invoked**: it exposes tokens as a style plan
(`schemas/style-plan.schema.json`) and `--theme <brand>` (default `shesha`) bakes concrete
values into every node, so the first output is on-brand [R-042]. An incomplete theme falls
back to neutral **with a warning** rather than emitting half a brand. Inspect a plan:
`node ../shesha-design-system/scripts/resolve-style-plan.mjs <brand>`. `--no-style` compiles
neutral.

Invoke that skill as *work*, not as a pass over your output: to author or change a brand or
the one-time app `$antdTheme`, or to restyle a form you did not compile. You still own the
apply step either way.

## 6 · Apply — one command, one mutation path

```
node scripts/apply-form.mjs --form <workdir>/<form>.json --module <mod> --name <form>
```

Stage → gate chain → snapshot prior markup → push → re-fetch → canonical diff → render →
write a content-addressed evidence bundle (keyed by the sha256 of the pushed markup, with a
sidecar digest) plus the ledger entry. **Exit 0 only when the push landed and the re-fetch
matches** [R-047]. The bundle path is printed on stdout on every outcome.

Flags: `--dry-run` · `--no-browser` (records `pushed-unrendered`, which the Stop hook treats
as not delivered) · `--allow-theme-change` (**required** when the markup carries app-level
theme settings — one form matching a screenshot must not repaint the portal) · `--evidence-dir`.

**Do not push by hand.** `apply-form.mjs` is the only writer of the ledger, and a hand-written
entry or an edited bundle is detected by digest and blocks [R-046].

Two gates sit outside that command, and a green render satisfies neither — full model in
[references/verification.md §0](references/verification.md):

- **Placement diff** — blueprint builds re-probe against the blueprint's `assertions`; this is
  what catches "the layout I intended didn't happen". `shesha-design-comprehension` owns it.
- **`shesha-design-critic`** — dispatch it with the screenshot + assertions + theme tokens for
  a strict verdict (per-assertion, styled-ness, top-3 fixes). Not done until it PASSes with
  styled ≥ acceptable.

Diagnose render failures via [references/debug.md](references/debug.md).

## 7 · Report

Every form: module + name + id, archetype, gate results, and the bundle `status` behind them.
Verify rather than assert — `node scripts/verify-evidence.mjs <bundle>`. Anything not
`verified` is reported UNVERIFIED, never as done.

## Reference map

| Topic | File |
|---|---|
| Rule registry (single source) | [references/_rules.json](references/_rules.json) |
| Session/shell/token contracts | [references/contracts.md](references/contracts.md) |
| API routes + push recipes | [references/api.md](references/api.md) |
| Entity binding + metadata probe | [references/entity-binding.md](references/entity-binding.md) |
| Component recipes (per type) | [references/components/](references/components/) via `scripts/lookup.js` |
| Blueprint node grammar | [references/designing-like-react.md](references/designing-like-react.md) |
| Consuming a design blueprint | [references/blueprint-consumption.md](references/blueprint-consumption.md) |
| Renderer facts + form JSON model | [plugin knowledge/frontend-conventions.md](../../knowledge/frontend-conventions.md) |
| Verification + browser rules | [references/verification.md](references/verification.md) |
| Symptom → cause | [references/debug.md](references/debug.md) |
| Bulk / multi-form mechanics | [references/bulk-operations.md](references/bulk-operations.md) |
| Ground-truth rerun (gym) | [references/gym.md](references/gym.md) |
| Version facts / 0.43 handoff | [references/versioning.md](references/versioning.md) |
| Quality floor + grading | [references/form-quality.md](references/form-quality.md) |
| Navigation menu wiring | [references/navigation-menu.md](references/navigation-menu.md) |
| Backend rebuild/restart | [references/backend-restart.md](references/backend-restart.md) |
| Full-stack prerequisites | [references/full-stack-prereqs.md](references/full-stack-prereqs.md) |
