# Conducting — session setup, roles, contracts, fan-out

Everything the conductor establishes once and propagates: the pre-flight, who owns what, the per-dispatch contract, and the parallel/barrier map. The cross-skill session rules themselves (pinned shell, auth-once/BOM-free token, scratch-under-workdir, one gated push path, dispatch contract) are canonical in **`shesha-form-edit/references/contracts.md`** — this file is how the conductor *applies* them across screens.

## Pre-flight (once per session, before ingesting)

Session setup — pinned shell + `<workdir>`, auth-once BOM-free token, skill-root resolution, scoped metadata, one consolidated confirmation, the cost ledger, within-session dedup — is canonical in `shesha-form-edit/references/contracts.md` §1–§3. The conductor establishes it once per session and propagates it in every dispatch; re-establishing any of it per screen is the observed waste.

## Roles

The conductor sequences, gates, and verifies end-to-end but never authors form JSON, picks colours, or pushes. Full ownership table (who owns structure/styling/comprehension/verification): [shesha-claude-designer/SKILL.md](../SKILL.md).

## Contracts

**Designer → comprehension (Step 2, per screen):** provide design source(s) + fidelity tier + screen name + (Tier A) source paths + pinned viewport. Returns `<workdir>/blueprints/<screen>.blueprint.md` — archetype + `layout-tree` + `bindings` + `assertions` **plus the `blueprint-json` machine twin, validated against `shesha-design-comprehension/schemas/blueprint.schema.json`** — and the saved probe `*.layout.json`.

**Designer → shesha-form-edit (Step 4, per screen) — "Contract A" (the compiler handoff):** provide the **blueprint-json path** (the extracted twin, or the `.blueprint.md` carrying it), entity modelType (or "resolve from module"), form identity (module + name), the headless backend context, the pinned shell/tool, and `<workdir>` (locates the cached token). Form-edit compiles the blueprint (`compile-blueprint.js`), runs its gates, pushes through its one gated path, and runs its oracle. Returns: **form id (module + name + id) + gate results (schema/guardrails/bindings/styledness) + oracle verdict (re-fetch diff, render instrument) + criticVerdict (design-critic's PASS/FAIL, styled rating, top-3 fixes)**. It NEVER pushes unstyled [R-042] or reports an unverified form as done [R-046].

**Designer → shesha-design-system (Step 3, once):** provide token set / theme name; brand selection per Step 3. Returns the resolved theme file (+ app-level AntD theme applied once). There is no hand-back-styled-JSON loop: the resolved theme name/tokens ride in every Step 4 dispatch to `shesha-form-edit`, whose compiler bakes them into each node at compile time [R-042]. `shesha-design-system` is invoked directly again only in Step 5, to audit the rendered result or restyle an already-built form — never as a second pass over freshly compiled markup.

**Comprehension ↔ form-edit (gate 5a.5, per screen):** after build+publish, re-probe the rendered form, diff against the blueprint `assertions`; each mismatch becomes a routed fix in `shesha-form-edit`'s vocabulary. **Capped at 2 routed-fix iterations** — then a placement report (see the comprehension verification loop).

### Dispatch prompt (Contract A) — every per-screen build dispatch

A dispatched agent does NOT read this skill — the dispatch prompt is its only binding:

> SKILL_ROOT: `<path>`. Pinned tool: **PowerShell tool only** (Windows) — never Bash. `<workdir>`: `<path>` (cached bearer token at `<workdir>/access-token` — reuse it, never re-authenticate). Screen: `<name>`. **Compile the attached blueprint**: `<workdir>/blueprints/<screen>.blueprint.json` (schema: `shesha-design-comprehension/schemas/blueprint.schema.json`) with theme `<brand>` (resolved in Step 3). Entity modelType: `<type>`. Form identity: module `<module>`, name `<name>`. Run the full form-edit pipeline — compile (tokens baked in [R-042]) → gates → push → oracle. **Return pushed+verified form facts: form id + gate results + oracle verdict. Never author `columns`; never report an unpushed or unverified form as done.** Write all scratch under `<workdir>`.

Omit any of these and the agent re-picks a shell, re-authenticates, or skips the oracle — the observed failure modes.

## Fan-out map (the parallel axis is the SCREEN)

| Stage | Mode | Why |
|---|---|---|
| 1 Ingest | serial, once | one design source → one token set + screen inventory |
| **2 Comprehend** | **∥ one agent per screen** | read-only, fully independent |
| 3 Theme | **BARRIER, once** | theme tokens resolved once; they ride in every Step 4 dispatch, compiled in, not applied centrally afterward |
| **4 Build (form-edit run)** | **∥ one dispatch per screen** | distinct forms; each compiles its blueprint with theme tokens baked in and owns its gated push + oracle [R-042] |
| 5 Verify | **serial** | placement + visual (design-system audits in place, never re-pushes) are browser-bound (one Playwright session) |

Cross-link ordering (list → detail → create) governs the **push + verify** sequence, not the authoring. Within one screen's build, `shesha-form-edit` may fan out its own `form-author`s (its orchestration.md) — one level down; the conductor stays at the screen axis. Orchestrate with `superpowers:dispatching-parallel-agents`.

**Threshold:** 1 screen → inline, no dispatch. 2+ screens → MUST fan out Steps 2 + 4, one agent per screen; a multi-screen build run serially is a defect.

**Sequencing rules:** theme resolved first, once → comprehend before build → tokens compiled in at build time, per screen, never a later pass → gates in order (5a structural → 5a.5 placement → 5b visual; a form failing placement is routed back, never styled over) → one push path → one agent per screen is the target (more is waste, fewer for 2+ screens is a defect).
