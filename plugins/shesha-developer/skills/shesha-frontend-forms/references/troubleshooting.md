# Troubleshooting

Exit code → what it means → what to do. Every code is distinct on purpose: overloading one is how
a pipeline reports "it failed" and leaves you guessing.

## Exit codes

| Code | Meaning | First move |
|---|---|---|
| 0 | ok | — |
| 1 | a gate failed | read the gate output; all failures are listed, not just the first |
| 2 | not Shesha 0.45 | wrong app. The version found is printed. This toolchain is 0.45-only |
| 3 | backend down | start it. `probe` still wrote the framework half |
| 4 | no match | `explain` found nothing. If the fact should exist, that is a `probe` bug — report it |
| 6 | spec invalid | the JSX parsed but is not a legal spec (bad `archetype`, missing `entity`) |
| 7 | unsatisfiable | the spec asks for something the framework cannot express |
| 8 | push gates failed | `push` ran `check` and refused. Fix the form, do not bypass |
| 9 | http error | backend rejected the call; the body is printed |
| 10 | re-fetch diff | the server stored something different from what was sent. **Do not retry blindly** — read the diff |
| 11 | render missing | no screenshot or no geometry. Re-run `render` |
| 12 | render deferred | the page never became ready. Gates skipped deliberately |
| 13 | smoke failed | bindings do not resolve against real data |
| 14 | JSX invalid | syntax error in the spec |
| 15 | not in kit | you used a component the mirror kit does not expose |
| 16 | vanilla | the form rendered unstyled |
| 17 | anatomy | measured layout does not match what the form declares |
| 18 | geometry drift | the render is structurally different from the approved mock |
| 20 | harness failed | the browser probe died. Console errors are printed verbatim |
| 64 | usage | bad flags |
| 70 | unimplemented | that feature belongs to a later phase |

---

## The form renders blank or shows a placeholder

An **unregistered component type fails soft**: `upgradeComponents` skips it and the renderer shows
a placeholder with no error. So a typo produces a silently broken form. `check` catches it (R-003).

Also check you used **`dataContext`**, not `datatableContext` — the legacy type renders nothing.

## Every table cell is blank but the pager count is right

A PascalCase binding. Shesha camelCases the query, but the cell accessor reads the literal
`propertyName`, so the rows arrive and the cells cannot find their values. R-004 catches it. Fix
the `bind` to the camelCase property.

## Table columns do not appear

Columns live in **`items`**, not `columns`.

## Text ignores its font settings

The text contract: `content` needs `textType` + `contentDisplay` + `contentType` present or the
whole `desktop.font` block is inert (R-059). For a font **colour** specifically, `contentType`
must be `custom` (R-052).

## A style block has no effect

Candidates, in order of likelihood:

1. `stylingBoxJson` — **does not exist**. The key is `stylingBox`, a stringified JSON string.
2. A stale `version` silently drops the entire `desktop` style block. Use the version from the
   type's own migrator chain.
3. Field-level `labelCol` is a dead channel (R-033).
4. `customStyle: {flex}` never reaches the outer div; size flex children with
   `desktop.dimensions.width` (R-028).
5. `desktop.background` without a `type` renders `url(null)` (R-054).
6. `position: absolute` on an image collapses it to 0×0 (R-055).

## `render` exits 12 every time

The page is not producing form output. Check the frontend is actually up at `--base`, that auth
succeeded, and that the form was pushed. Exit 12 is the gate refusing to measure a spinner — it is
protecting you from six confident design failures against a blank page.

## `render` reports failures that look wrong

Two historical false positives worth ruling out:

- **Scope.** Measuring `document.body` sweeps in the adminportal shell, so `pageBackground` reads
  transparent and `fontFamily` reads `-apple-system`. Every colour axis then fails on a correctly
  themed form.
- **Baseline.** Without `--baseline` captured, per-axis divergence assertions skip; if they are
  firing, confirm the baseline came from a genuinely unstyled render of the *same* archetype.

If a gate asserts something it cannot observe, that is a bug in the gate. It should report
`notAsserted`. Report it rather than working around it.

## `fidelity` says geometry drift but the page looks right

Read `observations` in the report. If `rolesObservable` is `false`, the render predates class-name
capture — re-run `render`. If a role count is 0 on the Shesha side for something clearly on
screen, the role matcher is wrong for this framework version: Shesha's datatable is **not** an
antd Table and has no `<table>` element, and that exact mistake produced a blocking false
positive. Fix the matcher against the measured DOM; do not relax the gate.

## `fidelity` pixel percentage is large

Expected. The mock and Shesha are two different renderers, so a large *stable* baseline is normal
— which is why pixels are advisory and the threshold comes from a calibration run. If it is
`uncalibrated`, calibrate the archetype. Never hand-pick a threshold: an invented number gets
tuned until it passes.

## `push` exits 10

The server stored something different. Read the diff before retrying — canonical diff already
ignores key order and `null` ↔ absent, so a reported difference is real. Common cause: sending
`modelType` on `UpdateMarkup`, which the body does not take.

## `CreateItem` returns HTTP 500 "Parameter 'key'"

Missing `discriminator: 'form'`. `CreateItem` also takes **no** markup — send it with
`UpdateMarkup` afterwards.

## "Current user did not login" with a valid password

A UTF-8 BOM in the cached token. The cache is written BOM-free for exactly this reason; if you see
this, something rewrote it.

## Changes do not appear after a push

IndexedDB `form` / `form_lookup` are serving a ghost. `render` clears them via CDP
`Storage.clearDataForOrigin` (R-056). In a browser you drive yourself, clear site data.

## The harness will not build (exit 20)

`probe` reads the console errors and prints them. Known causes already handled: the
`react-big-calendar` CSS import, `next/*` imports, and `react-icons` 5.6.0 dropping `SiCss3`
inside Shesha's declared `^5.1.0` range. A *new* resolution failure usually means a bare specifier
needs `nodePaths`, or a new static import needs a stub in `lib/framework.mjs` — the only file
permitted to reach into the app's `node_modules`.

## A rule fires on markup you believe is correct

It may be right — R-059 caught a fixture that claimed to pass every gate while its heading
rendered unstyled. But false positives on correct production markup have happened repeatedly
(`isInput` is true for `datatableContext`; a slot child's `parentId` is the slot's id; a centred
row read as wrapped). Check the rule's note in `scripts/rules/MANIFEST.md`, then verify against a
real render before changing the form. If the rule is wrong, fix the rule and add the correct
markup as a passing fixture.
