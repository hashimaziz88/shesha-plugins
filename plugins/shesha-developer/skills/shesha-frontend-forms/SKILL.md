---
name: shesha-frontend-forms
description: Build, validate and deploy Shesha 0.45 form configurations. Use when creating or editing Shesha forms, screens or views — table worklists, record details, dashboards — or when a form renders wrong, unstyled, blank, or its bindings do not resolve. Derives ground truth from the installed framework, designs in a runnable JSX mirror kit, compiles to form JSON, and gates every step against evidence rather than prose.
---

# Shesha frontend forms

A toolchain, not a document. Four principles decide every question here:

1. **The framework is executable — import it, don't describe it.** Component types, versions,
   container slots, prop surfaces and legal enum values are *derived from the installed
   `@shesha-io/reactjs`*, not from anything written down. A knowledge gap is a bug in `probe`.
2. **Design values are measured or transcribed, never chosen.** Colours, spacing and type come
   from a token file. Thresholds come from calibration runs that record their samples.
3. **Design in a medium you can see.** Author a JSX spec against the generated mirror kit,
   render it to pixels, look at it, *then* compile it down.
4. **Evidence crosses every boundary.** No status without an artefact.

Shesha **0.45 only**. If the target app is not 0.45, stop — exit code 2.

## Before anything else

```bash
cd plugins/shesha-developer/skills/shesha-frontend-forms
npm install
node scripts/shesha.mjs probe --app <path-to-shesha-app>
```

`probe` writes `<app>/.shesha/ground-truth.json` (gitignored, regenerated, never committed) by
bundling the app's own installed framework into a headless browser and asking it what exists.
Everything downstream reads that file. **Nothing works before `probe` has run.**

## The pipeline

Run in order. Each step refuses to run on unproven input from the step before.

| # | Command | Produces |
|---|---------|----------|
| 1 | `probe --app <p>` | `ground-truth.json` — registry, versions, slots, prop types, live metadata |
| 2 | `preview --spec <f.jsx> --app <p>` | `mock.png` + `mock-geometry.json` — **look at this** |
| 3 | `compile --spec <f.jsx> --app <p> -o <f.json>` | Shesha 0.45 form JSON |
| 4 | `check --file <f.json> --app <p>` | the five offline gates |
| 5 | `push --file <f.json> --form <m>/<n> --app <p>` | deployed + re-fetch diff |
| 6 | `render --form <m>/<n> --app <p>` | real screenshot + three rendered gates |
| 7 | `fidelity --form <m>/<n> --app <p>` | mock-vs-real diff + side-by-side composite |
| 8 | `smoke --form <m>/<n> --app <p>` | bindings resolve against real data |

Then dispatch the **`shesha-design-critic`** subagent with the composite, the fidelity report,
the render evidence and the active token file. It never sees your spec, so it cannot grade
intent instead of outcome.

## Instead of reading documents

```bash
node scripts/shesha.mjs explain <symptom|rule-id|component-type>
```

`explain` answers from derived ground truth and the rule registry. Prefer it to searching prose.
Never read the compiled `@shesha-io` bundle — a miss is a bug to report, not a puzzle to solve.

## The five offline gates (`check`)

structural → round-trip → rules → bindings → dead-channel. All failures are reported, not just
the first. The round-trip gate runs the framework's *own* `componentsTreeToFlatStructure` →
`upgradeComponents` → back, so a form that survives is a form the framework accepts.

`check` also prints what it did **not** check. Styled-ness and layout anatomy are not decidable
from markup; they are rendered gates, and a validator that counted style blocks is exactly how
the previous stack passed a nearly-unstyled form at 96%.

## The rendered gates (`render`)

anti-vanilla (fingerprint divergence from an unstyled baseline, plus absolute floors) → anatomy
(measured `getBoundingClientRect` geometry) → integrity (console errors, failed requests).

If the page has not actually produced form output, `render` exits **12** and skips the gates
rather than measuring a spinner. Six confident design failures were once reported against a
blank page; a gate that cannot see must say so.

## Fidelity: two channels, different authority

- **geometry — exact and blocking.** Membership, grouping, nesting, order. Never raw pixel
  positions: the kit renders approximately, Shesha renders exactly.
- **pixels — advisory, against a calibrated threshold.** Calibrate per archetype and the samples
  are recorded. An uncalibrated threshold is a number someone made up, and an invented threshold
  gets tuned until it passes.

A structurally wrong page can sit *within* the pixel threshold. That is why geometry blocks.

## Rules

57 ported rules were triaged into enforceable / compile-time / derivable / stale; later phases
added more. Every id resolves to one `check()` and one row in
`scripts/rules/MANIFEST.md` (generated — `explain --manifest --write`).

Rules never hold facts. Versions, slots, legal types and legal enum values come from
`ground-truth.json` via `ctx`. A rule that cannot get a fact **skips with a reason** rather than
guessing — guessing is how false positives get shipped against correct production markup.

## Hard-won facts that contradict older prose

Load `references/measured-facts.md` before trusting any remembered detail. The short list:

- `stylingBoxJson` **does not exist** in 0.45. The key is `stylingBox`, holding a *stringified*
  JSON string.
- `getComponentDefinitions` is **not a runtime export**. The registry is reachable only via
  `useFormDesignerComponents()` in a bare render with no provider tree.
- The working data-context type is **`dataContext`**, not `datatableContext`.
- `text` needs `textType` + `contentDisplay` + `contentType` present alongside `content`, or the
  entire `desktop.font` block is **inert** (R-059).
- Shesha's datatable is **not** an antd Table — it is a div-based react-table with
  `sha-data-table` / `sha-react-table` / `sha-table` and no `<table>` element.

## Never

- Commit generated assets. Ground truth, the mirror kit and all renders live in `<app>/.shesha/`.
- Add an interactive prompt to any script. An agent shell has no TTY; a prompt hangs forever.
- Log user prompts or command text. If you need telemetry: opt-in, metadata-only, redacted.
- Report a status whose artefact does not exist. The ledger refuses it and so should you.

## Exit codes

`0` ok · `1` gate · `2` not 0.45 · `3` backend · `4` no match · `6` spec invalid · `7`
unsatisfiable · `8` push gates · `9` http · `10` diff · `11` render missing · `12` render
deferred · `13` smoke · `14` jsx invalid · `15` not in kit · `16` vanilla · `17` anatomy · `18`
geometry drift · `20` harness · `64` usage · `70` unimplemented

## References

- `references/measured-facts.md` — every 0.45 fact measured this build, with its evidence
- `references/authoring.md` — writing a JSX spec, the mirror-kit vocabulary, the token boundary
- `references/pipeline.md` — full flag surface, the evidence contract, the ledger
- `references/troubleshooting.md` — exit code → cause → fix
