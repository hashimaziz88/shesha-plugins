# Shesha Claude Designer — the design → Shesha pipeline (v2, 0.45)

Four skills that turn a **design** (a runnable prototype, a screenshot set, a Figma-style kit, or an HTML/JSX mock) into **on-brand, correctly-built Shesha forms** — and prove the result by machine gates and measurement, not eyeballing. The v2 pipeline is a **compiler pipeline over artifacts**: every hop hands the next skill a typed artifact, not prose.

```
design source
   │ 1 ingest (conductor)
   ▼
theme tokens + screen inventory
   │ 2 comprehend (per screen, ∥)
   ▼
blueprint.md  ──  human view (layout-tree / bindings / assertions)
              └─  machine twin: fenced ```blueprint-json  (schema-validated)
   │ 3 theme once + plan {archetype, blocks}
   │ 4 build: shesha-form-edit COMPILES the blueprint
   ▼
compile-blueprint.js → GATES (validate-schema → validate-guardrails →
resolve-bindings → validate-styledness) → STYLE (design-system) →
PUSH → ORACLE (re-fetch diff + render-instrument.js + design-critic verdict*)
   │ 5 verify: structural (oracle) · placement diff (≤2 iter) · visual audit (≤2 cycles)
   ▼
report envelope (form ids, gate results, verdicts, probe paths)
```
\* render-instrument.js and the design-critic agent are being built; until present, the visual gate is the screenshot + design-system audit.

## The four skills

| Skill | Owns | Must NOT |
|---|---|---|
| **`shesha-claude-designer`** (conductor — start here) | Route by weight, ingest, sequence screens, move the artifacts, gate on verification | Author form JSON · pick colours · push |
| **`shesha-design-comprehension`** | Measure each screen into a blueprint (`.md` + `blueprint-json` twin); re-measure the built form and diff against the `assertions` (placement gate) | Author JSON · push |
| **`shesha-form-edit`** | The compiler: blueprint → markup via golden archetypes; the four gates; the one push path; the oracle | Pick tokens/hexes · ship unstyled or unverified |
| **`shesha-design-system`** | All appearance: app-level Ant theme + brand token files + per-component v7 blocks + the capability annotations | Author structure · wire CRUD · push |

## Where the shared machinery lives

- **Rule registry (single source of every mechanical fact):** `shesha-form-edit/references/_rules.json` — validators and docs cite `[R-xxx]`; prose never restates more than a sentence.
- **Blueprint schema (the build input):** `shesha-design-comprehension/schemas/blueprint.schema.json` — form-edit's `compile-blueprint.js` accepts only this ("no spec, no build").
- **Measured capability matrix (style authority):** `shesha-form-edit/assets/measured-capability-matrix.json` — gym-generated per release; effects per `component × setting-path`. The hand matrix `shesha-design-system/assets/capability-matrix.json` is annotation only (technique keys, crossCuttingRules, fixes), overlaid by `merge-capability.js`.
- **Brand token files:** `shesha-design-system/assets/themes/*.tokens.json` — `shesha` (default), `requirements-studio`, `wcg`. A new brand = copy the default, swap values, keep key names.
- **Golden archetypes (compiler fixtures):** `shesha-form-edit/assets/golden/` (indexed by `_index.json`).

## Firm rules (registry-backed)

- Splits are flex `container` rows sized via `desktop.dimensions.width`, never the `columns` component [R-028]; a flex container must set `display:"flex"` [R-029].
- One gated push path; a form is delivered only when pushed AND oracle-verified [R-046]; no form ships unstyled [R-042].
- Comprehend before building; placement is verified by re-measurement, capped at 2 routed-fix iterations.

## How to edit the pipeline

| You want to… | Edit |
|---|---|
| Re-theme / add a brand | the token file in `shesha-design-system/assets/themes/` only |
| Change a mechanical rule | `shesha-form-edit/references/_rules.json` (validators + docs follow it) |
| Change what the compiler emits | `shesha-form-edit/scripts/compile-blueprint.js` + the golden archetypes |
| Change blueprint vocabulary | `shesha-design-comprehension/schemas/blueprint.schema.json` + `references/blueprint-ir.md` (in lockstep) |
| Record new style capability | re-run the gym (`shesha-form-edit/references/gym.md`) → regenerates the measured matrix; annotate techniques in the hand matrix |
| Change an appearance recipe | `shesha-design-system/references/component-recipes.md` ($role tokens, no hexes) |

## When to use which skill directly

- A **design exists** → start at **`shesha-claude-designer`** (it routes lightweight cases away itself).
- A **single form, no design source** → **`shesha-form-edit`** (mandatory default-theme pass keeps it styled).
- **Style an already-working form** → **`shesha-design-system`**.
