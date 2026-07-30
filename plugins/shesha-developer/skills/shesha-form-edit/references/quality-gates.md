# Quality gates — how a design is guaranteed not to come out poorly

A form that merely *works* can still look horrendous (stacked splits, cramped
fields, a button collapsed to "…", no chrome). Quality is never left to the
model's care in the moment — it is **built in by construction and enforced by
layered, fail-closed gates**. No single gate is sufficient; the guarantee is
the stack.

## Layer 1 — Correct by construction (the common case is right by default)

The model does not hand-write Shesha markup, so it cannot express the broken
shapes. Instead:

- **Design in the React grammar** ([designing-like-react.md](designing-like-react.md))
  — Stack/Row/Grid/Card/Field/Actions. Each primitive compiles to ONE
  gym-verified container shape via `compile-spec.mjs`. There is exactly one
  way to make a Row and it is proven to render (flex model in the `desktop`
  block, child `minWidth:0`, width as the split lever) [R-028/R-029].
- **Consistency from a fixed scale** — spacing (`xs..2xl`), heading levels,
  gaps and card treatment come from the compiler's scales and the theme tokens,
  not per-form invention. Every form draws from the same system.
- **Selection over generation** — clone the closest golden archetype
  (`assets/golden/`); you inherit production chrome and only swap content.
- **Never unstyled** — theme tokens are a **compile-time input**, baked into
  every node by the compiler [R-042]. A structurally-complete default-grey form
  is a compiler defect, not a missing follow-up pass; there is no separate
  styling step to forget.

## Layer 2 — Objective render gate (`render-instrument.js`, fail-closed)

Proves the form LOADS and is geometrically not-broken, from the live DOM
(scoped by the reliable `data-sha-c-*` markers, reading flex from the inner
container div per the two-div rule [R-032]). Hard-fails on:

- still loading (spinner / unstable component count / no inputs hydrated),
- a declared flex-row whose children **wrapped/stacked** instead of splitting,
- inputs collapsed `<60px` wide, content overflowing the viewport,
- an action row collapsed to an overflow "…" (no visible labelled button),
- console errors, failed requests, empty bound regions with `--expect-data`.

**A PASS here is necessary, not sufficient.** It cannot judge *intent* ("the
two columns I designed") or *aesthetics* ("does this look professional") — those
are Layers 3 and 4.

## Layer 3 — Intent gate (blueprint assertions / placement diff)

The blueprint carries `assertions` (stable-property placement contracts, e.g.
"mainSplit has two children side-by-side; status fields inside the rail").
`shesha-design-comprehension` re-probes the built form and diffs against them
(capped iterations). This is what catches **"the layout I intended didn't
happen"** — the render-instrument alone can't, because it doesn't know intent.
Write assertions for every non-trivial placement.

## Layer 4 — Visual quality gate (`design-critic`, MANDATORY)

A fresh-context vision agent reads the screenshot + assertions + theme tokens
and returns a strict verdict (per-assertion pass/fail, styled-ness
excellent|acceptable|default-antd|broken, top-3 fixes). This is the reliable
judge of professional polish — the thing mechanical DOM heuristics cannot do.

**The critic is a blocking gate, not optional.** A build is not "done" until the
critic PASSes (styled ≥ acceptable, no failed assertions). Skipping it lets a green
render-instrument mask a poorly styled layout — the failure mode this stack exists to prevent.

## The rule

`compile (Layer 1) → render-instrument (Layer 2) → placement diff (Layer 3) →
design-critic (Layer 4)`. Every gate fail-closed; every layer catches what the
one below cannot. Report a form done only when all four have passed.
