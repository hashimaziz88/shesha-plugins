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

## Rerun procedure (per Shesha version)

Prerequisites: backend running (default `http://localhost:21021`, admin/123qwe),
adminportal running (default `http://localhost:3000`), and in this skill folder:
`npm install && npx playwright install chromium`.

```
node scripts/extract-enums.js --source <designer-components dir of the renderer source matching the KB>
node scripts/generate-component-gym.js            # all 108; or --only textField,container
node scripts/run-gym.js                           # push + measure; --only / --skip-push / --headed
node scripts/merge-capability.js                  # overlay hand matrix; --dry-run first
```

On a NEW Shesha version:
1. Regenerate the components-kb from that version's source (`generate-component-kb.js`),
   then re-run `extract-enums.js` against the same checkout — settings paths must
   match the KB generation (0.43 KB = flat `fontSize`; 0.45 source = nested `font.size`).
2. Regenerate + rerun. Deterministic uuids mean `git diff gym/` shows exactly what changed.
3. Set `generation`/`sheshaVersion` via the runner defaults (edit `run-gym.js` constants
   or pass `--backend`/`--portal`). Compare matrices across generations before trusting
   version-specific styling advice.

## How measurement works

- Markup is authored **KB-shaped with KB versions** (0.43 flat props); a newer runtime
  migrates it on load. The gym therefore measures exactly what skill-authored markup
  does on that runtime — including migration losses (e.g. flat `borderColor` is a
  measured no-op on 0.45, while `fontColor`/`fontSize` migrate correctly).
- Every instance sits in its own named container; the runner discovers the DOM marker
  (`[data-sha-c-name]`) automatically and diffs variant vs baseline: geometry (rect,
  descendant count), ~40 computed-style props (colors normalized, 0.1px rounding),
  text/attributes, canvas pixel signature.
- Forms are opened at `/dynamic/<module>/<form>?mode=edit` — without `mode=edit` the
  dynamic page renders read-only (no inputs → false no-ops).
- Distinctive variant values are greppable in the deltas: numbers `17` → `17px`,
  colors `#ff00aa` → `rgb(255, 0, 170)`, text `GYM-TXT-<path>`.
- `not-registered` renderStatus = the component type does not exist in the target
  runtime (e.g. `chart` on 0.45); its settings are `unknown`, never `no-op`.

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
