# Workflow — upgrade to a new Shesha 0.45.x release

Maintainer work. The designer surface is calibrated against one framework release: component
versions drift across point releases [R-049], and a stale `version` on a component silently
drops its whole style block or renders it read-only [R-003]. This workflow re-derives the
ground truth so the calibration matches the release the app actually runs.

Requires a running backend and admin portal on the **new** release, and Playwright installed
in `skills/shesha-form-edit`.

## 1 · Rebuild the component KB from that release's source

```
cd skills/shesha-form-edit
node scripts/generate-component-kb.js <designer-components dir of the matching renderer source> assets/components-kb
node scripts/extract-enums.js --source <the same checkout>
```

Both must read the **same** renderer checkout — settings paths have to match the KB
generation, or measurements land on paths that no longer exist.

## 2 · Regenerate and re-measure the gym

```
node scripts/generate-component-gym.js     # offline, deterministic, ~1s
node scripts/run-gym.js                    # pushes + measures against the new release
node scripts/merge-capability.js --dry-run # then without --dry-run
```

The committed `gym/manifest.json` carries **backend-specific ids** — module id, per-form
`backendId`. `run-gym.js` only re-resolves the module id when it is absent, so regenerate the
manifest before measuring against a different backend rather than reusing committed ids.

Credentials come from `SHESHA_USER`/`SHESHA_PASSWORD`, or
`--local-dev-insecure-defaults` for a throwaway local backend. Nothing is defaulted.

## 2b · Keep the golden corpus greppable

New-release seeds arrive verbose. `scripts/slim-seed.js` deterministically trims repeated
sibling shapes to two exemplars while hard-asserting that the component-type, columnType,
action-pair and reference-list sets are unchanged — it aborts rather than silently dropping
coverage. Agents grep these files, so size is a running cost:

```
node scripts/slim-seed.js --all --dry     # review, then without --dry
```

Corpus provenance and the rebuild check: [assets/golden/README-golden.md](../skills/shesha-form-edit/assets/golden/README-golden.md).

## 3 · Diff the matrices before trusting anything

Compare the new `assets/measured-capability-matrix.json` against the previous one. What matters:

- a channel that moved from `renders` to `no-op` — every recipe using it is now wrong;
- a component whose `renderStatus` became `not-registered` — it was removed from the runtime;
- version bumps, which invalidate any markup carrying the old integer.

Note that a large share of hand-matrix rows may still be `unmeasured`; an unmeasured channel
is not evidence of anything, and must not be reported as verified.

## 4 · Re-verify the checked surface

```
npm --prefix ../.. run verify
```

Then rebuild one form of each archetype against the new release and run its full oracle. A
green `verify` proves the plugin is internally consistent; only a built, rendered, critiqued
form proves the calibration is right.

## 5 · Bump compatibility and say what changed

Update the version claims in the four designer descriptions and `plugin.json` only if the
supported release actually changed. Record in the commit which channels moved and which
component versions bumped — that list is what the next upgrade diffs against.
