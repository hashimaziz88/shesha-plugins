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
No `reason` is recorded either, so an unmeasured row is indistinguishable from one that was
never attempted. Measured 2026-07-28: **43% of setting rows (875 / 2034) are
`not-measured`.**

The consequence, verified rather than assumed:

- `desktop.*` appearance paths are measured for **45 of 115** components — those whose KB
  `settingsFields` happen to include them.
- **`container` is not one of them.** Its KB carries 28 settings and **none** for `border`,
  `border.radius`, `dimensions.minHeight` or `font` — so those channels can never be
  measured for it, no matter how many times the gym is rerun.
- The `hasStandardAppearance` flag is `true` for exactly **one** component (`image`), which
  does not match the 45 that actually have appearance rows. The flag is not what drives
  appearance measurement, and it is very likely a `generate-component-kb.js` detection gap.

This is why 19 of the 34 rows in `shesha-design-system/assets/capability-matrix.json` sit at
`unmeasured` — they document appearance *techniques* (container borders and radius, text
letter-spacing, refListStatus pill colours, datatable header styling), and the gym generates
no variants for them. Several of the rest need bound data or a parent record the gym has no
way to supply (`permanentFilter by parent data.id`, collection counts, row-template
conditional visibility).

**Unmeasured is not the same as broken.** `container:desktop.dimensions.width` is unmeasured
yet demonstrably works — the compiler emits it for the table-worklist toolbar and the rendered
page puts the pager flush against the grid edge. Treat `unmeasured` as "no evidence either
way" and rely on the renderer facts in `knowledge/frontend-conventions.md`; only a measured
`no-op` is evidence of absence.

Closing this gap means teaching the variant generator to vary the shared appearance block and
to build data-bound fixtures — a change to the gym itself, not a rerun.

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
