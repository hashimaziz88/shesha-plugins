# Component Gym — measured capability matrix

The gym renders EVERY components-kb component against a live Shesha app and
records what each setting measurably does. Output:
`assets/measured-capability-matrix.json` — the authority over the hand-noted
`shesha-design-system/assets/capability-matrix.json` whenever both exist.

## Artifacts

| Path | What |
|---|---|
| `gym/forms/gym-<type>.json` | Generated gym form: baseline + one instance per setting variant, each wrapped in a named container (`data-sha-c-name` locator) |
| `gym/manifest.json` | Instance registry, backend ids, probe config (deterministic — reruns diff cleanly) |
| `assets/components-kb/_enums.json` | Dropdown enum values extracted from renderer source |
| `assets/measured-capability-matrix.json` | Per-component renderStatus + per-setting effect: `renders / no-op / breaks-render / changes-geometry / changes-style / not-measured / unknown` |
| `gym/merge-report.json` | Contradictions vs the hand-noted matrix |
| `gym/screenshots/`, `gym/errors/` | One PNG per component; console/network errors per form (git-ignored) |
| `assets/components-kb/` (115 types, versions, settingsFields) | `scripts/generate-component-kb.js <designer-components src> assets/components-kb` — regenerate FIRST when the release changed, settings paths downstream must match |
| `schemas/form-config.schema.json` | `scripts/generate-schema.js` — the cheapest gate; regenerate after the KB |
| `assets/component-registry.json` | `scripts/gen-registry.mjs` — the TYPED SHAPE registry (what exists, and of what type); regenerate after the KB + enums. Stamps `frameworkVersion`, `generatedFrom` (`live-backend` \| `offline-kb`), and a `provenance` block |

## Authority boundary — KB, registry, matrix

Three artifacts, three different questions, one owner each. Never conflate them:

- **`assets/components-kb/` (121 per-component `*.json`) — the CANONICAL, hand-inspectable resource.** Source-derived from the renderer, committed, and the thing you open to answer "does this component exist, and what does its settings form declare". Every other artifact here is downstream of it.
- **`assets/component-registry.json` — what EXISTS, typed.** A **GENERATED aggregate** of the KB — **never hand-edited**. Every component, every prop path, and the *type* of each typed prop (`enum` + members, `numeric-picker` + presets, `number`, `boolean`, `string`, `css-length`), plus `authorable` / `authorableReason` and any named `customContainerNames` slots. `validate-schema.js` enforces it as shape typing; `lookup.js` reads it to explain a non-authorable type; `compile/` reads its slot names for the nesting guard. It carries a `provenance` block (`generatedBy`, `generatorVersion`, `mode`, `sourceHash`, `generatedAt`), and **staleness is a test failure**: `tests/registry.test.mjs` recomputes the KB `sourceHash` and fails with *"components-kb changed since the registry was generated — regenerate via /shesha-gym"* the moment the two diverge. Fix that by regenerating, never by editing the registry or the hash.
- **`assets/measured-capability-matrix.json` — what RENDERS.** Runtime-effect evidence **only**: per-setting measured `effect` with `cssDelta`, gated by R-053. It carries no shape or typing data — a shape/typing question goes to the registry, an existence/inspection question to the KB.

`sourceHash` is a sha256 over the sorted `"<file>:sha256(content)"` list of the **non-underscore** `components-kb/*.json` — the component files only. The generated side-artifacts (`_index.json`, `_meta.json`, `_enums.json`, `_gaps.json`) are excluded because they have their own edit lifecycles and a re-index alone changes no typed prop; the trade-off is that an `_enums.json`-only refresh is not caught by the hash, which is why the rerun order below regenerates the registry immediately after `extract-enums.js`. `node scripts/gen-registry.mjs --print-source-hash` prints the current hash without generating anything.

The consequence, stated once: **a registry prop with no matrix measurement is `not-measured` — never "supported".** Existing in the registry licences *authoring the shape*; only a matrix measurement licences *claiming the effect*. The reverse gap is a registry bug, not a licence: a channel the matrix measured whose path the registry does not know means the KB parse missed a prop (`tests/registry.test.mjs` cross-checks this, with an explicit exemption set).

## Matrix schema

```jsonc
{
  "generation": "0.45",
  "sheshaVersion": "0.45.0",
  "components": {
    "<ComponentType>": {
      "renderStatus": "renders",            // does the component render at all
      "settings": {
        "<path>=<value>": {                 // e.g. "desktop.dimensions.width=317px"
          "effect": "changes-style",        // renders/no-op/breaks-render/changes-geometry/changes-style/not-measured/unknown
          "cssDelta": { "width": { "baseline": "1370px", "variant": "317px" } },
          "notes": "optional"
        }
      }
    }
  }
}
```

A `no-op` channel must never be authored; `breaks-render` is a render-killer. `cssDelta` is the measured baseline→variant computed-style evidence. This schema and the effect vocabulary are the single source — `shesha-design-system/references/capability-matrix.md` and its SKILL.md point here rather than restating it.

## Rerun procedure (per 0.45.x release)

The matrix is regenerated per release: the KB is rebuilt from that release's
renderer source, then the gym is regenerated and re-measured against a backend
running that release.

Prerequisites: backend running (default `http://localhost:21021`, admin/123qwe),
adminportal running (default `http://localhost:3000`), and in this skill folder:
`npm install && npx playwright install chromium`.

```
node scripts/generate-component-kb.js <designer-components src> assets/components-kb  # only when the release changed — KB first
node scripts/extract-enums.js --source <designer-components dir of the renderer source matching the KB>
node scripts/generate-schema.js                   # regenerate schemas/form-config.schema.json from the KB
node scripts/gen-registry.mjs                     # regenerate assets/component-registry.json (typed shape); --offline to skip the backend
node scripts/generate-component-gym.js            # all KB types; or --only textField,container
node scripts/run-gym.js                           # push + measure; --only / --skip-push / --headed
node scripts/merge-capability.js                  # overlay hand matrix; --dry-run first
node scripts/validate-blocks.js                   # re-check assets/blocks/ $validatedAgainst claims against the refreshed matrix
node scripts/generate-non-negotiables.js          # regenerate non-negotiables.md from _rules.json (run after any rule change too)
```

On a new release:
1. Regenerate the components-kb from that release's source (`generate-component-kb.js`),
   then re-run `extract-enums.js` against the same checkout, then `generate-schema.js`
   — settings paths must match the KB generation, in that order.
2. Regenerate the typed registry (`gen-registry.mjs`) from the same KB + enums. With a
   backend up it stamps that machine's real `frameworkVersion` and records live version
   drift vs the KB (R-049); `--offline` produces the same shape from the bundled KB alone
   and stamps `generatedFrom:"offline-kb"` so a report can say which it read. Either way
   the run refreshes `provenance.sourceHash`, which is what clears the staleness test.
   Run it BEFORE the gym: `validate-schema.js` types every gym form against it.
3. Regenerate + rerun. Deterministic uuids mean `git diff gym/` shows exactly what changed.
4. Set `sheshaVersion` via the runner defaults (edit `run-gym.js` constants
   or pass `--backend`/`--portal`). Compare matrices across releases before trusting
   version-specific styling advice.
5. **Verify + commit**: coverage must equal the KB type count; `validate-blocks.js`
   and `node --test tests/` green (`tests/registry.test.mjs` cross-checks the registry
   against the refreshed matrix); commit the regenerated artifacts together.

## How measurement works

- Markup is authored **KB-shaped with KB versions**; the runtime migrates it on
  load. The gym therefore measures exactly what skill-authored markup does on
  that runtime — including migration losses (a setting the migrator drops shows
  up as a measured no-op).
- Every instance sits in its own named container; the runner discovers the DOM marker
  (`[data-sha-c-name]`) automatically and diffs variant vs baseline: geometry (rect,
  descendant count), ~40 computed-style props (colors normalized, 0.1px rounding),
  text/attributes, canvas pixel signature.
- Forms are opened at `/dynamic/<module>/<form>?mode=edit` — without `mode=edit` the
  dynamic page renders read-only (no inputs → false no-ops).
- Distinctive variant values are greppable in the deltas: numbers `17` → `17px`,
  colors `#ff00aa` → `rgb(255, 0, 170)`, text `GYM-TXT-<path>`.
- `not-registered` renderStatus = the component type does not exist in the target
  runtime; its settings are `unknown`, never `no-op`.

## Measurement backlog

Channels the skill AUTHORS but the matrix records as `not-measured` — measure these on the next gym run so the claim can stop being conditional:

- `datatable.onRowClick` / `datatable.onRowDoubleClick` (and the legacy `dblClickActionConfiguration`) — the row-open affordance the compiler emits for a blueprint's `rowAction: {kind:"open-record"}`. `configurableActionConfigurator` settings are invisible to the current visual differ, so measuring them needs an INTERACTION probe (click / double-click a data row, then assert a navigation) rather than a computed-style diff. Until then the recipe in `references/components/data-tables.md` states plainly that the channel is authored-but-unmeasured, and no gate asserts it.

## Budget guards

20s max wait per form, 2 retries, always continues past failures; matrix flushes
incrementally after every component (crash keeps partial results); one screenshot
per component (~110 total).

## Non-negotiables

- A component that fails to render is **recorded** (`error`/`not-registered`), never dropped — coverage is 100% of the KB by definition.
- Effects come only from measurement; `unknown` is honest, a guessed verdict is not.
- The measured matrix is the authority; the design-system matrix (`shesha-design-system/assets/capability-matrix.json`) carries technique annotations only.

## Troubleshooting

- **Marker discovery fails**: the runner dumps the body HTML — check the form actually
  renders (auth token file `access-token` stale? delete it) and that the adminportal
  port matches `--portal`.
- **Everything no-op**: check `?mode=edit` reached the page (inputs present) and that
  component `version` fields match the KB generation (a version/shape mismatch makes
  migrations skip or drop settings silently).
- **Push 4xx**: token expired (delete `access-token`), or module rename — the runner
  resolves the module id from `/api/services/app/Module/GetAll`.
