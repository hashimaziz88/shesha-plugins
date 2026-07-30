# Shesha Claude Designer — the design → Shesha pipeline (v2, 0.45)

Four skills that turn a **design** (a runnable prototype, a screenshot set, a Figma-style kit, or an HTML/JSX mock) into **on-brand, correctly-built Shesha forms** — and prove the result by machine gates and measurement, not eyeballing. The v2 pipeline is a **compiler pipeline over artifacts**: every hop hands the next skill a typed artifact, not prose.

```
design source
   │ 1 ingest (conductor)
   ▼
theme tokens + screen inventory
   │ 2 comprehend (per screen, ∥)
   ▼
<screen>.blueprint.json — schema-validated (nodes / bindings / assertions)
   │ 3 theme once + plan {archetype, blocks}
   │ 4 build: shesha-form-edit COMPILES the blueprint
   ▼
compile-spec.mjs → validate-form.mjs (Tier 1 → Tier 2 → Tier 3) →
STYLE (design-system) →
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
| **`shesha-design-comprehension`** | Measure each screen into a blueprint (`<screen>.blueprint.json`); re-measure the built form and diff against the `assertions` (placement gate) | Author JSON · push |
| **`shesha-form-edit`** | The compiler: blueprint → markup via golden archetypes; the four gates; the one push path; the oracle | Pick tokens/hexes · ship unstyled or unverified |
| **`shesha-design-system`** | All appearance: app-level Ant theme + brand token files + per-component v7 blocks + the capability annotations | Author structure · wire CRUD · push |

## Where the shared machinery lives

- **Rule registry (single source of every mechanical fact):** `shesha-form-edit/references/_rules.json` — validators and docs cite `[R-xxx]`; prose never restates more than a sentence.
- **Blueprint schema (the build input):** `shesha-design-comprehension/assets/blueprint.schema.json` — form-edit's `compile-spec.mjs` accepts only this ("no spec, no build"). The earlier `schemas/blueprint.schema.json` + `compile-blueprint.js` pairing is retired; see "One compiler, two open questions" below.
- **Measured capability matrix (style authority):** `shesha-form-edit/assets/measured-capability-matrix.json` — gym-generated per release; effects per `component × setting-path`. The hand matrix `shesha-design-system/assets/capability-matrix.json` is annotation only (technique keys, crossCuttingRules, fixes), overlaid by `merge-capability.js`.
- **Brand token files:** `shesha-design-system/assets/themes/*.tokens.json` — `shesha` (default), `requirements-studio`, `wcg`. A new brand = copy the default, swap values, keep key names.
- **Golden archetypes (compiler fixtures):** `shesha-form-edit/assets/golden/` (indexed by `_index.json`).

1. **Ingest** (`shesha-claude-designer`) — read the design source; extract the token set + screen list. *Run* a compiled prototype and probe it; never parse a minified bundle.
2. **Comprehend** (`shesha-design-comprehension`) — each screen → `blueprints/<screen>.blueprint.json`, a measured layout node tree with a typed placement `assertions` block. This is what stops container placement from drifting.
3. **Plan** (`shesha-claude-designer`) — establish the theme **once**, then map each blueprint region to a **block** (`shesha-form-edit/assets/blocks`) + its paired **style overlay/recipe** (`shesha-design-system`). The per-screen plan is `{archetype, blocks[], recipes[]}`.
4. **Build** — for each screen: **(a)** `shesha-form-edit` **compiles** the blueprint (`scripts/compile-spec.mjs` → `scripts/validate-form.mjs`, see `shesha-form-edit/references/compiling.md`) into native structure with CRUD already wired, then pushes; **(b)** `shesha-design-system` resolves the token overlays and returns styled JSON — which `shesha-form-edit` pushes through its single push path. This is the single compiler entry point (see "One compiler, two open questions" below for what is still being reconciled on the validator/ground-truth side).
5. **Verify** — three gates in order: **structural** (native components, fully flexed, fields bound) → **placement** (`shesha-design-comprehension` re-measures the live form and `scripts/verify-placement.mjs`'s exit code is the gate against the blueprint assertions) → **visual** (screenshot vs theme). Mismatches route back to the owning skill.

The contract that wires the conductor to the sub-skills is [`references/handoff-contract.md`](references/handoff-contract.md).

### One compiler, two open questions

The compile/validate layer was built twice, independently, from the same blueprint contract.
**The blueprint format + compiler decision is now settled**: `shesha-design-comprehension/assets/blueprint.schema.json` is the one blueprint schema, and `scripts/compile-spec.mjs` → `scripts/validate-form.mjs` is the one compile/validate entry point. `schemas/blueprint.schema.json` and `scripts/compile-blueprint.js` are the retired path — `compile-blueprint.js` is kept in the tree (nothing executable still reads the retired schema file, so it still runs), but it implements the retired archetype vocabulary and is not the build path any new work should target.

What is **still open**, per `docs/RECONCILIATION.md` §"Recommended position" (a separate decision, not settled by this pass):

| | Field-validated (P2) | Registry-backed (P1 — the compiler) |
|---|---|---|
| Ground truth | `assets/components-kb/` + `gym/forms/` (live-probed) | `assets/registry/registry-0.45.1.json` (generated from settings-form source) |
| Validate | `validate-schema.js`, `validate-guardrails.js`, `validate-styledness.js` | `validate-form.mjs` (3 tiers, exit codes, `hooks/gate-policy.json`) |
| Golden corpus | `assets/golden/` | `assets/exemplars/` |

The recommended position is to **merge** the validators (P1 as chassis, porting P2's `R-015` and the `validate-styledness` coverage triad) and to **keep both** ground-truth sources with a stated division of labour — neither is decided by this schema/archetype pass. Do not delete either side's validator scripts, ground-truth assets, or corpora on the assumption the other one "is" the pipeline.

---

## The design system is generic, editable, and reusable

Nothing about a brand is hard-coded into the recipes, blocks, or skills. **Brand lives almost entirely in one token file** — as of the Task 3 hex audit, every block style-overlay resolves through `$role:`/`$palette.` references except three literal greys in `page-header-band.style.json` (`#f0f0f0`, `#8c8c8c`, `#262626`) that match no colour in `shesha.tokens.json`; see that overlay's `$note` and `.superpowers/sdd/2026-07-29-phase5-debt-paydown/task-3-report.md`.

### 1. The brand token file — the single source of brand truth
`shesha-design-system/assets/themes/<brand>.tokens.json`. **The shipped default is `shesha.tokens.json`** — the framework's own Cobalt/Navy/Athens-Grey brand, used automatically whenever no app-specific brand is named. `requirements-studio.tokens.json` ships alongside it as an **example custom brand** (LandBank green). All brand files live in this one folder. **Resolving which brand to use is a lookup, never an authoring step** — run `shesha-design-system/scripts/resolve-brand.mjs`, which returns the requested brand if its file exists and the default otherwise. Creating a new brand file is a separate, explicitly requested task and must never happen inside a design, form or styling run (see `shesha-design-system` SKILL.md Step 1 for why). Each brand file holds, as data:

- `palette` — `brand`, `accent`, `surfaces`, `lines`, `ink`, `semantic` colour groups
- `type` — font `family`, a `scale` (micro → title), `weights`, `lineHeights`
- `spacing` (4px scale), `radius` (xs → pill), `shadow` (card/overlay/rowHover), `chrome` metrics
- `statusLifecycle` — the status reflist + a per-status `badges` map (bg/fg/border) so status colour is data, not code
- `roles` — a **semantic indirection map**: e.g. `"bodyText": "palette.ink.primary"`, `"cardBg": "palette.surfaces.surface"`, `"cardRadius": "radius.lg"`
- `$antdTheme` *(default brand)* — the pre-resolved Ant Design 6.x `ConfigProvider` `{token, components}` object, applied verbatim at the app level (the "set once" theme layer)

### 2. Recipes & overlays reference **`$role:` tokens, almost never hexes**
A block style-overlay says `"color": "$role:bodyText"`, not `"#1f1f1f"`. At stamp time the overlay's `$role:` tokens are resolved through the token file's `roles` map (via [`references/token-to-prop-mapping.md`](../shesha-design-system/references/token-to-prop-mapping.md)). So **the same blocks/overlays render any brand** — you only swap the token file, for every colour channel except the three off-token greys named above (a genuine gap, not an oversight left uninvestigated: `assets/block-styles/**` carries a guard test asserting zero literal hexes outside a named, commented allowlist of exactly those three).

### 3. The capability matrix is empirical and version-stamped
[`shesha-design-system/assets/capability-matrix.json`](../shesha-design-system/assets/capability-matrix.json) (+ a readable `.md`) records which v7 style channel actually **renders** on which component, measured against a live backend. It is the source of truth for "what works" and gets **re-measured on a Shesha upgrade** (diff = upgrade-impact report). `validate-blocks.js` gates every block against it.

> **To theme a brand-new app you write next to zero code:** copy the token file, edit the values, point the designer at it. The recipes, blocks, overlays, and capability matrix are all reused as-is — except `page-header-band`'s three off-token greys, which still need a literal edit (or a new matching token) until the theme defines an equivalent colour.

---

## How to edit the pipeline

| You want to… | Edit | Notes |
|---|---|---|
| **Re-theme an existing app** (colour/type/spacing/radius/shadow) | the brand **token file** only | never edit recipes or blocks for a colour change |
| **Pick default vs custom brand** | nothing — `shesha` (`assets/themes/shesha.tokens.json`) is the automatic default; name a brand or hand over tokens to select a custom one | see `shesha-design-system/SKILL.md` Step 1 for the selection rule |
| **Add a new brand** | copy the default `assets/themes/shesha.tokens.json` → `assets/themes/<brand>.tokens.json`, edit values (keep key names), set it active | blocks/overlays/recipes are reused unchanged |
| **Add a new component block** | a skeleton in `shesha-form-edit/assets/blocks/<name>.block.json` **+** a paired overlay in `shesha-design-system/assets/block-styles/<name>.style.json` | list the matrix rows it relies on in the block's `$validatedAgainst`, then run `validate-blocks.js` |
| **Add / change an appearance recipe** | `shesha-design-system/references/component-recipes.md` | keep it `$role:`-token-based, no hexes |
| **Record a new empirical finding / re-measure after a Shesha upgrade** | `assets/capability-matrix.json` (+ `references/capability-matrix.md`) | re-run `validate-blocks.js`; a block referencing a `no-op` channel must fail |
| **Relax or tighten a design rule** | recipes in `references/shesha-design-standards.md`; **functional guardrails stay in** `shesha-form-edit/references/form-quality.md` | guardrails and relaxable recipes are deliberately kept in separate blocks |
| **Change blueprint/placement vocabulary** | `shesha-design-comprehension/references/blueprint-ir.md` + `verification-loop.md` | must move in lockstep with the flex-split idiom |
| **Change a mechanical rule** | `shesha-form-edit/references/_rules.json` | validators + docs cite it by `[R-xxx]` id; single source, don't restate the fact elsewhere |
| **Change what the compiler emits** | `shesha-form-edit/scripts/compile-spec.mjs` + the archetype flow manifests (`assets/archetypes/*.flow.json`) | `scripts/compile-blueprint.js` (the retired field-validated compiler) still reads `assets/golden/` but is not the build path — see "One compiler, two open questions" above |
| **Record new style capability / re-measure after a Shesha upgrade (gym)** | re-run the gym (`shesha-form-edit/references/gym.md`) → regenerates the measured matrix; annotate techniques in the hand matrix | distinct from the `capability-matrix.json` row above — this is the KB/gym side |

---

## Reference map — what references what

```
shesha-claude-designer/
  SKILL.md ............... conductor; invokes the 3 sub-skills below
  references/
    design-ingestion.md . fidelity tiers, token extraction, "run don't parse"
    handoff-contract.md . the {archetype, blocks[], recipes[]} contract between skills
  README.md ............. (this file)

shesha-design-comprehension/
  SKILL.md
  scripts/layout-probe.js ........ measures DOM x-clusters + computed styles (live)
  references/blueprint-ir.md ..... the measured blueprint format (flex-split, never columns)
  references/verification-loop.md  the placement gate (re-measure, verify-placement.mjs exit code vs typed assertions)

shesha-form-edit/                  ── STRUCTURE ──
  SKILL.md ....................... build/CRUD/validate/single-push; load-on-demand refs
  references/compiling.md ........ the blueprint → markup compiler contract (compile-spec.mjs + validate-form.mjs)
  references/block-library.md .... index of the blocks ▼ (non-blueprint builds)
  assets/blocks/*.block.json ..... structure skeletons; each names its $styleOverlay + $validatedAgainst
  references/blueprint-consumption.md  blueprint field mapping + compile-failure troubleshooting
  scripts/validate-blocks.js ..... gates blocks against ▼ the capability matrix

shesha-design-system/              ── APPEARANCE ──
  SKILL.md
  assets/themes/*.tokens.json .... the BRAND token file — default `shesha`, example custom `requirements-studio` (palette/type/spacing/radius/shadow/status/roles/$antdTheme)
  assets/block-styles/*.style.json  per-block style overlays (use $role: tokens, paired to a block)
  assets/capability-matrix.json .. empirical "what renders" truth (+ references/capability-matrix.md)
  references/component-recipes.md  per-archetype v7 style recipes
  references/token-to-prop-mapping.md  resolves $role: tokens → component props
  references/shesha-design-standards.md  appearance rules (relaxable recipes)
  references/styling-mechanics.md + style-channels.md  the v7 style channel mechanics
```

**The two pairings that hold it together:**
- **block ↔ overlay**: `block.$styleOverlay` names the overlay in `shesha-design-system/assets/block-styles`.
- **block ↔ matrix**: `block.$validatedAgainst` names rows in `assets/capability-matrix.json`; `validate-blocks.js` fails the block if any referenced channel is a `no-op`.

---

## Firm rules (invariants the whole pipeline obeys)

- **Splits are flex `container` rows, never the `columns` component** [R-028]. Size children via `desktop.dimensions.width` (calc/%/px) — `customStyle:{flex}` is inert on the outer div; a flex container must set `display:"flex"` [R-029].
- **Structure (form-edit) and appearance (design-system) never mix.** A hex in a block subtree is a bug — it belongs in the overlay/token file.
- **Comprehend before building; verify placement by measurement.** No screen is "done" until its placement assertions pass; placement is capped at 2 routed-fix iterations.
- **One gated push path** (form-edit). A form is delivered only when pushed AND oracle-verified [R-046]; no form ships unstyled [R-042]. Theme is set **once**, via Configuration Studio / the token file — not per-form, and not by editing frontend source.
- **Status is never colour-alone**; destructive actions are never primary; `validationErrors` is present when required inputs exist.
- **Datalist row-template cards** need the markup-only collapse/scroll fix (the `style`-overflow + reserved-`minHeight` recipe) — see the capability matrix entry "datalist-row-template card" and `component-recipes.md → Datalist row-template card`.

---

## When to use which skill directly

- A **design exists** → start at **`shesha-claude-designer`** (it routes lightweight cases away itself).
- A **single form, no design source** → **`shesha-form-edit`** (mandatory default-theme pass keeps it styled).
- **Style an already-working form** → **`shesha-design-system`**.
