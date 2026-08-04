# The pipeline, in full

One CLI: `scripts/shesha.mjs`. Every subcommand takes `--help`, writes JSON to stdout and
diagnostics to stderr, and **never prompts** — an agent shell has no TTY, so a prompt hangs
forever.

`--app <path>` is required almost everywhere: it names the Shesha app whose installed framework is
the authority and whose `.shesha/` directory holds all evidence.

---

## probe

```bash
node scripts/shesha.mjs probe --app <p> [--backend <url>] [--output <f>]
```

Writes `<app>/.shesha/ground-truth.json` plus `<app>/.shesha/.gitignore` containing `*` — a
self-ignoring directory, because the target app's own `.gitignore` does not cover `.shesha/` and
generated assets must never be committed.

Two halves, deliberately independent:

- **framework** — bundles the app's own `@shesha-io/reactjs` into headless chromium and asks it
  what exists: 116 types with versions, container slots, prop surfaces, 4188 typed props / 700
  enums, and the `dataTypeSupported` matrix sampled over `{dataType, dataFormat}` pairs that
  actually occur in this app.
- **backend** — entity metadata, reference lists, theme settings, modules.

Backend unreachable → **exit 3**, and the framework half is still written so work is not blocked.
Not 0.45 → **exit 2**, with the version found. Harness failure → **exit 20**, with every in-page
console error and the first exception verbatim. A silent harness failure would make the whole
approach untrustworthy, so it is never silent.

Probes twice, with `application.isDevMode` false then true, because `getToolboxComponents` gates
on dev mode; the delta is marked `devOnly`.

**Timing.** Cold ~8s (esbuild dominates), warm 66–123ms. The bundle cache is keyed on framework
version + dist sha256 + harness source + esbuild version, so an upgrade under you invalidates it
rather than serving a stale registry.

## explain

```bash
node scripts/shesha.mjs explain <symptom|rule-id|component-type|entity>
node scripts/shesha.mjs explain --manifest [--write]
```

Answers from derived ground truth and the rule registry. **Use this instead of reading
documents.** Never read the compiled `@shesha-io` bundle — a knowledge miss is a bug to report,
not a puzzle to solve by slicing a minified file. No match → exit 4.

## preview

```bash
node scripts/shesha.mjs preview --spec <f.jsx> --app <p> [--theme <name>]
```

The forward model: renders the spec to `mock.png` + `mock-geometry.json` in ~0.7s so design
decisions are made against pixels. `--theme` switches the token file only.

## compile

```bash
node scripts/shesha.mjs compile --spec <f.jsx> --app <p> -o <f.json>
```

JSX → Shesha 0.45 JSON. A capture shim aliases `@shesha-mirror/kit` and builds with esbuild's
`jsxFactory: 'h'`, so the spec becomes a descriptor tree **in Node, with no browser and no
React**. Ids are deterministic (`nanoid(30)` seeded by spec path), so recompiling is stable and
diffs stay readable.

`chooseType` *validates* a declared type rather than selecting one — a compiler that guesses at
component types is a compiler that silently picks wrong.

Exits: **6** spec invalid · **14** JSX will not parse · **15** component not in the kit.

## check

```bash
node scripts/shesha.mjs check --file <f.json> --app <p>
```

Five offline gates, all reported: **structural → round-trip → rules → bindings → dead-channel**.
Accepts raw markup, a `{formSettings, components}` document, a stringified `markup` blob (which is
how `UpdateMarkup` carries it), an ABP `{result}` envelope, and a BOM.

The round-trip gate runs the framework's own `componentsTreeToFlatStructure` → `upgradeComponents`
→ `componentsFlatStructureToTree`. Without the framework it **degrades to a warning** rather than
claiming a pass. Field diffs on migrated components are summarised once instead of printed 23
times.

`check` prints what it did **not** check. Styled-ness and layout anatomy are not decidable from
markup; a validator that counted style blocks is how the previous stack passed a nearly-unstyled
form at 96%, seven of whose nine style blocks were inert.

## push

```bash
node scripts/shesha.mjs push --file <f.json> --form <module>/<name> --app <p>
```

**The only write path.** Runs `check` first and refuses on failure (**exit 8**). Then
`UpdateMarkup`, then **re-fetches and canonically diffs** what the server actually stored.
Canonical diff treats re-ordered keys and `null` ↔ absent as equal; array order is significant.
Any difference → **exit 10** with the diff. Verified means re-fetched, not "the POST returned 200".

Creating: `CreateItem` needs `discriminator: 'form'` and takes no markup; markup follows via
`UpdateMarkup`.

## render

```bash
node scripts/shesha.mjs render --form <m>/<n> --app <p> [--base <url>] [--baseline] [--theme <t>]
```

One boot, one login, one evaluate, **exactly one screenshot** — no screenshot means FAIL, never
"probably fine". Auth is injected into `localStorage` as base64 JSON. Form caches are cleared via
CDP `Storage.clearDataForOrigin` first (R-056), otherwise IndexedDB serves a ghost.

Three rendered gates: **anti-vanilla** (fingerprint divergence from an unstyled baseline plus
absolute floors) → **anatomy** (measured `getBoundingClientRect`) → **integrity** (console errors,
failed requests).

Readiness is required before measuring: real form output and no `.ant-spin-spinning`, else **exit
12** with the gates skipped. Anatomy assertions are conditional on what the form declares
(`expectBand`, `expectSurface`, `declaredGroups`, `expectStatTiles`, `enforceRhythm`) — asserting
a band on a form with no band is a false positive.

`--baseline` records this render as the theme-stripped reference. Without a baseline the per-axis
divergence assertions **skip with a reason** and only the concrete floors run.

Writes `<m>.<n>.png`, `<m>.<n>.evidence.json` and `<m>.<n>.geometry.json`.
Exits: **16** vanilla · **17** anatomy · **11** render failed · **12** deferred.

## fidelity

```bash
node scripts/shesha.mjs fidelity --form <m>/<n> --app <p> [--archetype <a>]
node scripts/shesha.mjs fidelity --calibrate --form <m>/<n> --app <p> --archetype <a> [--runs <n>]
```

Geometry is blocking (**exit 18**), pixels advisory. Emits a side-by-side composite — mock left,
render right — which is the artefact a human already approved on one side.

Calibration re-renders for each sample, so the recorded spread is real render-to-render movement
rather than the determinism of the diff. `--no-resample` uses the cheap path and records that no
variance was measured. Threshold is `max(observed) × 1.25`; samples are stored so the number can
be audited instead of trusted.

An axis that cannot be observed reports as `notAsserted` — never as agreement, never as drift.

## smoke

Post-push binding check against real data — **bindings, not styling**. Exit **13**.

## ledger

`<app>/.shesha/ledger.jsonl`, append-only. Statuses run `authored → pushed → verified → rendered`,
and `record()` **refuses a status whose artefact does not exist**. `stopGate()` fails closed: an
unreadable payload still runs the check, and a killed mid-push run blocks the stop rather than
passing silently.

## Hooks

`plugins/shesha-developer/hooks/scripts/shesha-frontend-forms-gate.cjs` runs on PostToolUse and
Stop, fail-closed. Two defects fixed there are worth remembering: it silently passed when the cwd
did not match (now tries several candidates), and it skipped entirely on an unreadable payload
(now runs the Stop check anyway).

## eval

```bash
node scripts/shesha.mjs eval --app <p> [--golden <f.json>] [--runs <n>] [--json]
```

Offline. Grades the gate chain against the chain's **own** verdicts — no judge, no rubric, no
scoring of prose. Two halves:

- **positive** — a valid form produces zero failures.
- **negative** — a named mutation must provoke a **named rule id**. A chain that returned nothing
  on everything would pass every positive case, so this half is what tests the gates rather than
  trusting them. Firing a *different* rule fails the case; an inapplicable mutation is a **skip
  with a reason**, never a pass, because "we could not break it" is not evidence.

Negative cases are mutations of currently-valid markup, not fixture files: a broken fixture rots
silently as the compiler improves.

Plus compile determinism and theme invariance (structure identical, resolved values different —
identical bytes means the theme is not reaching the output and fails).

**Read a zero spread as "the compiler is deterministic", never as "the model is consistent."**
Measuring model variance would mean driving a real agent per run and grading N independently
authored specs; this harness deliberately does not. It prints what it does not cover.

The harness has its own tests, and the load-bearing one asserts that a mutation which breaks
nothing is graded as a **failure**. An eval harness that cannot fail is decoration.

## Budget

```bash
node --test tests/budget.test.mjs
```

Asserts the skill's own constraints: SKILL.md ≤ 250 lines and ≤ 3000 tokens, `references/` ≤ 5
files one level deep, tracked file count under 55. Every MUST in this build maps to a validator,
including the ones about the build itself.
