# Conducting — session setup, roles, contracts, fan-out

Everything the conductor establishes once and propagates: the pre-flight, who owns what, the per-dispatch contract, and the parallel/barrier map. The cross-skill session rules themselves (pinned shell, auth-once/BOM-free token, scratch-under-workdir, one gated push path, dispatch contract) are canonical in **`shesha-form-edit/references/contracts.md`** — this file is how the conductor *applies* them across screens.

## Pre-flight (once per session, before ingesting)

Most of the waste in a design run is the same setup repeated per screen. Establish once:

1. **Pinned shell + `<workdir>`** — one interpreter for the whole run (PowerShell tool on Windows, bash elsewhere) and one session scratch dir (`$env:TEMP/shesha-designer/<app-slug>` / `${TMPDIR}/shesha-designer/<app-slug>`); everything transient (blueprints, probes, staged markup, build scripts, run log, token) lives under it. Forward slashes, quoted paths; no `jq` (absent on Windows — parse JSON with `node -e` / `ConvertFrom-Json`). Full rules: contracts.md §1/§3.
2. **Auth once** → cache the token BOM-free at `<workdir>/access-token`; every sub-skill and the playwright smoke read it back; never inline the JWT. Full recipe: contracts.md §2.
3. **Skill root once** — resolve the installed plugin skill root (e.g. `.claude/plugins/cache/<marketplace>/shesha-developer/<version>/skills`) once and record it; never `find`-hunt per use.
4. **Scoped metadata once per entity** — fetch `GetProperties` once, distill to `<entity>.summary.md`, reuse across screens; never read a raw metadata dump inline (can exceed the Read limit).
5. **One consolidated confirmation** — plan + blueprints + cost in one gate (Step 3), not per screen/push; hand sub-skills the headless context block so routine pushes don't re-prompt.
6. **Cost ledger** — append one line per phase to `<workdir>/run-log.md`: `<ISO-timestamp> | phase | agents_dispatched | backend_calls | builds | boots | files_read (flag >50KB) | screenshots`. Consecutive timestamps show which phase ate the wall-clock. Ground truth comes from the harness (`claude -p --output-format json` → `usage` + `total_cost_usd`). Waste signals: agents > one per screen, a 2nd rebuild/boot cycle, >1 screenshot per screen, opening a >50KB seed.
7. **Within-session dedup** — a reference doc read once stays in context; never re-read one this run already loaded.

## Roles

| Skill | Owns | Must NOT |
|---|---|---|
| `shesha-claude-designer` | ingest, comprehend→plan, sequence, gate, verify end-to-end | author form JSON, pick hexes, push |
| `shesha-design-comprehension` | per-screen measured blueprint + placement verification (probe + diff) | author form JSON, pick hexes, push |
| `shesha-form-edit` | compile the blueprint-json → gates → push → oracle; CRUD wiring; flex-row splits (never `columns` [R-028]) | apply v7 appearance blocks; pick tokens/hexes |
| `shesha-design-system` | ALL appearance: app theme + per-component v7 blocks + capability matrix; audit | author structure, wire CRUD, push |
| `form-author` (agent) | draft NEW structure markup from a seed; return JSON only | style / apply a theme (dispatching it with a styling prompt is a contract violation), push |

## Contracts

**Designer → comprehension (Step 2, per screen):** provide design source(s) + fidelity tier + screen name + (Tier A) source paths + pinned viewport. Returns `<workdir>/blueprints/<screen>.blueprint.md` — archetype + `layout-tree` + `bindings` + `assertions` **plus the `blueprint-json` machine twin, validated against `shesha-design-comprehension/schemas/blueprint.schema.json`** — and the saved probe `*.layout.json`.

**Designer → shesha-form-edit (Step 4, per screen) — "Contract A" (the compiler handoff):** provide the **blueprint-json path** (the extracted twin, or the `.blueprint.md` carrying it), entity modelType (or "resolve from module"), form identity (module + name), the headless backend context, the pinned shell/tool, and `<workdir>` (locates the cached token). Form-edit compiles the blueprint (`compile-blueprint.js`), runs its gates, pushes through its one gated path, and runs its oracle. Returns: **form id (module + name + id) + gate results (schema/guardrails/bindings/styledness) + oracle verdict (re-fetch diff, render instrument)**. It NEVER pushes unstyled [R-042] or reports an unverified form as done [R-046].

**Designer → shesha-design-system (Step 3 theme + Step 4b style):** provide token set / theme name, the built form, version-profile facts, recipe list. Returns styled JSON (style blocks only, structure untouched) + app-theme changes + role→colour trace — it does NOT push; the styled JSON routes through `shesha-form-edit`.

**Comprehension ↔ form-edit (gate 5a.5, per screen):** after build+publish, re-probe the rendered form, diff against the blueprint `assertions`; each mismatch becomes a routed fix in `shesha-form-edit`'s vocabulary. **Capped at 2 routed-fix iterations** — then a placement report (see the comprehension verification loop).

### Dispatch prompt (Contract A) — every per-screen build dispatch

A dispatched agent does NOT read this skill — the dispatch prompt is its only binding:

> SKILL_ROOT: `<path>`. Pinned tool: **PowerShell tool only** (Windows) — never Bash. `<workdir>`: `<path>` (cached bearer token at `<workdir>/access-token` — reuse it, never re-authenticate). Screen: `<name>`. **Compile the attached blueprint**: `<workdir>/blueprints/<screen>.blueprint.json` (schema: `shesha-design-comprehension/schemas/blueprint.schema.json`). Entity modelType: `<type>`. Form identity: module `<module>`, name `<name>`. Run the full form-edit pipeline — compile → gates → style → push → oracle. **Return pushed+verified form facts: form id + gate results + oracle verdict. Never author `columns`; never report an unpushed or unverified form as done.** Write all scratch under `<workdir>`.

Omit any of these and the agent re-picks a shell, re-authenticates, or skips the oracle — the observed failure modes.

## Fan-out map (the parallel axis is the SCREEN)

| Stage | Mode | Why |
|---|---|---|
| 1 Ingest | serial, once | one design source → one token set + screen inventory |
| **2 Comprehend** | **∥ one agent per screen** | read-only, fully independent |
| 3 Theme | **BARRIER, once** | app theme set once before any screen is styled |
| **4 Build (form-edit run)** | **∥ one dispatch per screen** | distinct forms; each compiles its blueprint and owns its gated push + oracle |
| 4 Style | central | `shesha-design-system` styles centrally for coherence; styled JSON re-pushes through form-edit |
| 5 Verify | **serial** | placement + visual are browser-bound (one Playwright session) |

Cross-link ordering (list → detail → create) governs the **push + verify** sequence, not the authoring. Within one screen's build, `shesha-form-edit` may fan out its own `form-author`s (its orchestration.md) — one level down; the conductor stays at the screen axis. Orchestrate with `superpowers:dispatching-parallel-agents`.

**Threshold:** 1 screen → inline, no dispatch. 2+ screens → MUST fan out Steps 2 + 4a, one agent per screen; a multi-screen build run serially is a defect.

**Sequencing rules:** theme first, once → comprehend before build → structure before style, per screen → gates in order (5a structural → 5a.5 placement → 5b visual; a form failing placement is routed back, never styled over) → one push path → one agent per screen is the target (more is waste, fewer for 2+ screens is a defect).
