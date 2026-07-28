# Component Gym — measured capability matrix

The gym renders EVERY components-kb component against a live Shesha app and
records what each setting measurably does. Output:
`assets/measured-capability-matrix.json` — the authority over the hand-noted
`shesha-design-system/assets/capability-matrix.json` whenever both exist.

## Artifacts

`gym/forms/` and `gym/manifest.json` are **generated but committed**, so the corpus is
reproducible offline: `generate-component-gym.js` rebuilds them from `assets/components-kb/`
in under a second, and deterministic uuids mean a rerun diffs cleanly. Screenshots and
error dumps are not committed.

**The committed manifest carries backend-specific ids** — module name + id, per-form
`backendId`, `lastPushedAt`. `run-gym.js` only re-resolves the module id when it is absent,
so before measuring against a *different* backend, regenerate the manifest rather than
reusing the committed ids.

| Path | What |
|---|---|
| `gym/forms/gym-<type>.json` | Generated gym form: baseline + one instance per setting variant, each wrapped in a named container (`data-sha-c-name` locator) |
| `gym/manifest.json` | Instance registry, backend ids, probe config (deterministic — reruns diff cleanly) |
| `assets/components-kb/_enums.json` | Dropdown enum values extracted from renderer source |
| `assets/measured-capability-matrix.json` | Per-component renderStatus + per-setting effect: `renders / no-op / breaks-render / changes-geometry / changes-style / not-measured / unknown` |
| `gym/merge-report.json` | Contradictions vs the hand-noted matrix |
| `gym/screenshots/`, `gym/errors/` | One PNG per component; console/network errors per form (git-ignored) |

## Rerun procedure (per 0.45.x release)

The matrix is regenerated per release: the KB is rebuilt from that release's
renderer source, then the gym is regenerated and re-measured against a backend
running that release.

Prerequisites: backend running (default `http://localhost:21021`) with credentials in
`SHESHA_USER`/`SHESHA_PASSWORD` (or `--local-dev-insecure-defaults` for a throwaway local backend),
adminportal running (default `http://localhost:3000`), and in this skill folder:
`npm install && npx playwright install chromium`.

```
node scripts/extract-enums.js --source <designer-components dir of the renderer source matching the KB>
node scripts/generate-component-gym.js            # all KB types; or --only textField,container
node scripts/run-gym.js                           # push + measure; --only / --skip-push / --headed
node scripts/merge-capability.js                  # overlay hand matrix; --dry-run first
```

On a new release:
1. Regenerate the components-kb from that release's source (`generate-component-kb.js`),
   then re-run `extract-enums.js` against the same checkout — settings paths must
   match the KB generation.
2. Regenerate + rerun. Deterministic uuids mean `git diff gym/` shows exactly what changed.
3. Set `sheshaVersion` via the runner defaults (edit `run-gym.js` constants
   or pass `--backend`/`--portal`). Compare matrices across releases before trusting
   version-specific styling advice.

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

## What the gym does NOT measure — and why a rerun cannot fix it

**The gym can only vary settings the KB lists for that component.** It is not a coverage
oracle; `not-measured` means "no variant was generated", not "measured and inconclusive".
Every skipped row does carry a `reason` in `gym/manifest.json` (`capped`,
`dropdown with unresolved enum values`, `compound-only channel`, …), so a gap is always
attributable rather than silent.

### The appearance-extraction fix (2026-07-28)

The KB parser was a 0.43-era parser reading a 0.45 source tree, and it under-reported
appearance by an order of magnitude. Three separate causes, all now fixed in
`generate-component-kb.js`:

1. **First-match-only extraction.** `fieldsFromFluent` took one `propertyName` per
   `.addXxx()` call, but 0.45 packs many inputs into one `.addSettingsInputRow({inputs:[…]})`.
   Each call is now split per input (`inputWindows`), so every input keeps its own
   label and editor type.
2. **Helper-generated inputs were invisible.** Border and radius inputs come from
   `getBorderInputs()` / `getCornerInputs()` in `_settings/utils/border/utils.tsx` as
   template literals (`${borderProp}.all.width`). No static parse can see them, so they
   are expanded at the call site with the helper's real `path` argument. Their style
   dropdown values come from the same helper and are supplied by `extract-enums.js`.
3. **The 0.43 flat style model.** `SHARED_STYLE_FIELDS` (`borderSize`, `fontColor`, …)
   described paths that do not exist on 0.45, and the `hasStandardAppearance` flag it
   drove was true for exactly one component. Both are deleted. `appearanceFieldPaths`
   is now computed from the 0.45 families (`border`, `font`, `dimensions`, `background`,
   `shadow`, `overflow`, `stylingBox`, `style`, `customStyle`, `size`).

Effect on the corpus — generated, not yet measured:

| | before | after |
|---|---|---|
| KB settings fields | 1,880 | 3,554 |
| KB appearance paths | 131 | 1,860 |
| components carrying appearance | 45 | 68 |
| gym variant instances | 1,610 | 2,675 |

`container` went from 28 settings (2 appearance: `style`, `stylingBox`) to 62 settings
(44 appearance), and from 5 measured `desktop.*` rows to 40 distinct varied paths
including `border.border.{all,top,right,bottom,left}.{width,style,color}`,
`border.radius.*` and `dimensions.minHeight`.

Two allocation bugs surfaced once appearance grew and are also fixed in
`generate-component-gym.js`: the per-form budget was spent bucket-by-bucket in strict
priority order (appearance alone then exceeded the cap on 40 components, dropping all
their data/validation/events rows), and multi-value enums crowded out whole families
(20 `border.*.style` variants displaced every `border.radius` path). Allocation is now
round-robin across buckets, and every path gets its first value before any path gets a
second. The cap itself moved 28 → 56; see the constant's comment for the measured
trade-off.

### What a rerun still cannot fix

`container` has **no `font` family in the 0.45 source** — its `fontStylePnlId` panel
actually holds display/layout inputs. That is a renderer fact, not a parser gap, so no
KB change will produce it. Rows needing bound data or a parent record are likewise out
of reach of the current corpus: `permanentFilter by parent data.id`, collection counts,
and row-template conditional visibility all need fixtures the gym does not build.

**The committed matrix predates this fix.** `assets/measured-capability-matrix.json` was
measured against the old corpus, so its coverage figures describe the old KB. The
appearance rows above are *generated and awaiting measurement* — a gym rerun against a
live backend is required before any of them can be cited as measured.

**Unmeasured is not the same as broken.** Treat `unmeasured` as "no evidence either way"
and rely on the renderer facts in `knowledge/frontend-conventions.md`; only a measured
`no-op` is evidence of absence.

## Budget guards

20s max wait per form, 2 retries, always continues past failures; matrix flushes
incrementally after every component (crash keeps partial results); one screenshot
per component (~110 total).

## Troubleshooting

- **Marker discovery fails**: the runner dumps the body HTML — check the form actually
  renders (auth token file `access-token` stale? delete it) and that the adminportal
  port matches `--portal`.
- **Everything no-op**: check `?mode=edit` reached the page (inputs present) and that
  component `version` fields match the KB generation (a version/shape mismatch makes
  migrations skip or drop settings silently).
- **Push 4xx**: token expired (delete `access-token`), or module rename — the runner
  resolves the module id from `/api/services/app/Module/GetAll`.
