# The Shesha designer surface — how the four skills fit together

Human orientation for maintainers. Not loaded as skill context; the authoritative intent table
is [`instructions/routing.md`](../../instructions/routing.md) at the plugin root.

Four skills turn a **design** into **on-brand, correctly-built Shesha forms**, and prove the
result by scripted gates and measurement rather than by eyeballing. Each hop hands the next a
typed artifact, not prose.

```
design source
   │ 1  ingest (conductor: tokens + screen inventory)
   ▼
<brand>.tokens.json  +  screen inventory
   │ 2  measure, one dispatch per screen
   ▼
blueprint.md ── human view (layout-tree / bindings / assertions)
             └─ machine twin: fenced ```blueprint-json
   │ 3  plan + sequence + one approval gate
   │ 4  build, one dispatch per screen
   ▼
compile-blueprint.js  (style plan baked in at compile time)
   → GATES  validate-schema → validate-guardrails → resolve-bindings → validate-styledness
   → PUSH   Create / UpdateMarkup
   → ORACLE re-fetch diff → render-instrument.js → placement diff → shesha-design-critic
   │ 5  aggregate the evidence
   ▼
report envelope (form ids, gate results, verdicts, probe + screenshot paths)
```

There is no separate styling step. `shesha-design-system` exposes tokens as a validated
**style plan** and the compiler links that function, so the first emitted markup is already
on-brand.

## Who owns what

| Skill | Owns | Must not |
|---|---|---|
| `shesha-claude-designer` | Route, ingest a design source, plan screens, aggregate evidence | Author form JSON · pick colours · push · re-verify a delegate's work |
| `shesha-design-comprehension` | Measure a screen into a blueprint; re-measure the built form against its `assertions` | Author JSON · push |
| `shesha-form-edit` | Compile → four gates → the one push path → the oracle (including the visual verdict) | Pick tokens/hexes · report unpushed or unverified work as done |
| `shesha-design-system` | All appearance: brand token files, the style plan, the app AntD theme, v7 blocks | Author structure · wire CRUD · push |

## Where the shared machinery lives

- **Rule registry** — `shesha-form-edit/references/_rules.json`. Docs cite `[R-xxx]`. Each rule
  carries a `validator` naming the script that enforces it, or is marked `practice` (a working
  habit, nothing to assert) or `unenforced` (a real gap). `scripts/lint-claims.mjs` fails any
  doc that asserts MUST/enforced/fail-closed without something backing it.
- **Blueprint schema** — `shesha-design-comprehension/schemas/blueprint.schema.json`, the
  build input.
- **Style-plan contract** — `shesha-design-system/schemas/style-plan.schema.json`, produced by
  `scripts/resolve-style-plan.mjs` and consumed by the compiler.
- **Measured capability matrix** — `shesha-form-edit/assets/measured-capability-matrix.json`,
  gym-generated per release; `shesha-design-system/assets/capability-matrix.json` is hand
  annotation, overlaid by `merge-capability.js`.
- **Component KB** — `shesha-form-edit/assets/components-kb/`; `_index.json` keys are the 115
  valid type strings for this release.
- **Golden archetypes** — `shesha-form-edit/assets/golden/`, indexed by `_index.json`.
- **Plugin-level knowledge** — `knowledge/` (architecture, backend and frontend conventions).
  Agents in `agents/` are roles that stand on it; they carry no procedure.

## Editing the pipeline

| To change… | Edit |
|---|---|
| A brand, or add one | the token file in `shesha-design-system/assets/themes/`, then `resolve-style-plan.mjs <brand>` must exit 0 |
| A mechanical rule | `_rules.json` — and the validator that enforces it |
| What the compiler emits | `shesha-form-edit/scripts/compile-blueprint.js` |
| Blueprint vocabulary | `blueprint.schema.json` + `references/blueprint-ir.md`, in lockstep |
| Recorded style capability | rerun the gym ([workflows/upgrade-shesha-version.md](../../workflows/upgrade-shesha-version.md)) |
| Which skill owns an intent | `instructions/routing.md`, then the four descriptions |

Run `npm --prefix plugins/shesha-developer run verify` before committing — it chains the claims
lint, syntax and JSON checks, block validation and the unit tests.

## Slash commands

`/shesha-build <archetype> <entity>` · `/shesha-audit <module>/<form>` · `/shesha-gym`
