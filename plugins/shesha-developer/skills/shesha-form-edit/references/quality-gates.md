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
  gym-verified container shape via `compile-blueprint.js`, proven to render [R-028/R-029].
- **Consistency from a fixed scale** — spacing (`xs..2xl`), heading levels,
  gaps and card treatment come from the compiler's scales and the theme tokens,
  not per-form invention. Every form draws from the same system.
- **Selection over generation** — clone the closest golden archetype
  (`assets/golden/`); you inherit production chrome and only swap content.
- **Never unstyled** — theme tokens are baked in at compile, mandatory for every build [R-042].

## Layer 2 — Objective render gate (`render-instrument.js`, fail-closed)

Proves the form LOADS and is geometrically not-broken, from the live DOM
(scoped by the reliable `data-sha-c-*` markers, reading flex from the inner
container div per the two-div rule [R-032]). Hard-fails on:

- still loading (spinner / unstable component count / no inputs hydrated),
- a declared flex-row whose children **wrapped/stacked** instead of splitting,
- inputs collapsed `<60px` wide, content overflowing the viewport,
- an action row collapsed to an overflow "…" (no visible labelled button),
- console errors, failed requests, empty bound regions with `--expect-data`.

Every run writes three artifacts per form into `--out` —
`<module>--<name>.png`, `.evidence.json` (THE canonical render evidence) and a
slim `.verdict.json` that points at it — which are the
inputs to Layers 3 and 4 (see the tiers below).

**A PASS here is necessary, not sufficient.** It cannot judge *intent* ("the
two columns I designed") or *aesthetics* ("does this look professional") — those
are Layers 3 and 4.

### Browser-verification tiers — one browser boot per verify cycle

**Artifacts fan out; browsers don't.** One `render-instrument` run per form per fix
cycle produces the whole evidence set — screenshot + the ONE
`<module>--<name>.evidence.json` — and Layers 3 and 4 read those files. Batch a set of forms
with `--forms mod/a,mod/b,...`: ONE Chromium launch, ONE login, per-form
artifacts (the reused `storageState` makes repeat cycles cheaper still).

| Tier | When | Browser work allowed |
|---|---|---|
| **0 — no browser** | fleet/bulk mid-flight forms; a small edit to a form already verified this session | none — mechanical gates only (schema, guardrails, bindings, styled-ness) + the re-fetch diff |
| **1 — DEFAULT** | every form you push and intend to report done | exactly ONE `render-instrument` run per form per fix cycle (batch the set in one launch). A **green** instrument **CLOSES** browser work for that form |
| **2 — exception** | (i) the instrument **FAILed** and [debug.md](debug.md) routes the symptom to interactive diagnosis, or (ii) the user explicitly asked for interaction testing (dialog flows, navigation wiring) | interactive Playwright MCP, scoped to the named symptom/flow. **Never on a green run** |

**Kill this rationalization verbatim: "a green instrument does not need a manual
confirmation lap."** Re-driving a browser through a form whose verdict is already
PASS adds no evidence — it only spends the run. (Measured: one session spent
44/143 tool calls — 31% — inside Playwright MCP; another re-verified an
already-green instrument across 12 interactive calls.) The Stop hook records the
count as `BROWSER: <n> instrument-boots, <m> mcp-calls` in the session log; a
large `mcp-calls` next to a green boot is the waste this table exists to prevent.

A Tier-1 green verdict does **not** shorten the stack: Layers 3 and 4 still run —
they just consume the artifacts instead of a browser.

## Layer 3 — Intent gate (blueprint assertions / placement diff)

The blueprint carries `assertions` (stable-property placement contracts, e.g.
"mainSplit has two children side-by-side; status fields inside the rail").
`shesha-design-comprehension/scripts/verify-placement.mjs` evaluates them
mechanically against the instrument's `<module>--<name>.evidence.json`
(`--spec <blueprint> --evidence <file>`; exit 0 pass · 1 required mismatch or
unverifiable · 3 malformed evidence) — no second browser session; its own probe
run is the fallback when that artifact is absent (capped iterations). This is what catches **"the layout I intended didn't
happen"** — the render-instrument alone can't, because it doesn't know intent.
Write assertions for every non-trivial placement.

## Layer 4 — Visual quality gate (`design-critic`, MANDATORY)

A fresh-context vision agent judges what mechanical DOM heuristics cannot: whether
the deliverable looks designed. Its inputs are the whole evidence set — screenshot,
the canonical `.evidence.json`, the **mechanical placement verdict from Layer 3**,
the resolved theme, `artDirection` when the blueprint carries it, and the
console/network warnings. The placement verdict is an INPUT, not a question: the
critic never re-litigates a typed placement assertion, it judges design.

**Verdict scale (the one scale, cited everywhere):** `excellent` · `acceptable` ·
`generic` · `broken`. `generic` is the specific finding this gate exists for — the
form renders, nothing is broken, and it looks like nobody designed it.

| Verdict | Meaning | What happens |
|---|---|---|
| `excellent` | the design reads as intentional | report done |
| `acceptable` | competent, unremarkable | report done |
| `generic` | default-looking; no design voice | ONE full fix-and-reverify cycle (below) |
| `broken` | collapsed/illegible/unusable | back to the builder as a defect, not a polish |

**The critic is a blocking gate, not optional.** A build is not "done" below
`acceptable`. Skipping it — as in the incident that motivated this doc, where a green
render-instrument masked a poor layout — is the failure mode this stack exists to
prevent.

**On `generic`: apply the top-3 fixes ONCE, then FULLY re-verify.** Recompile →
offline gates → republish (`apply-form.mjs`) → re-render evidence → re-verify
placement → final critic verdict. **The delivered result is the judged result** — a
form patched after its last verdict was never judged. One cycle, not a loop to
convergence; if the second verdict is still `generic`, report it as such with the
remaining fixes named.

## The evidence envelope (the Layer contract)

Every completed form returns exactly ONE envelope — the shape below, documented here
and nowhere else. Each layer fills its own slot; the conductor and the run report
read it and never re-run the layers that produced it.

```json
{
  "form":          { "module": "His.Facilities", "name": "asset-hub", "id": "<guid>" },
  "blueprintHash": "<sha256>",
  "themeHash":     "<sha256>",
  "gates":         { "validate-schema.js": "pass", "validate-guardrails.js": "pass",
                     "resolve-bindings.js": "pass", "validate-styledness.js": "pass" },
  "persistence":   { "pushed": "created|updated", "refetchDiff": { "byteEqual": true,
                     "structuralEqual": true, "differences": [] }, "ledger": "verified" },
  "render":        { "verdict": "PASS|FAIL", "evidence": "<path>.evidence.json",
                     "screenshot": "<path>.png" },
  "placement":     { "verdict": "pass|fail|unverifiable", "mismatches": [] },
  "visual":        { "critic": "excellent|acceptable|generic|broken", "fixesApplied": 0 },
  "status":        "verified|unverified|failed"
}
```

- `blueprintHash` / `themeHash` come from `compile-blueprint.js`'s structured stdout —
  they name WHICH inputs produced this deliverable.
- `gates` + `persistence` come from `scripts/apply-form.mjs`'s JSON result.
- `status` is `verified` only when every populated slot passed. Anything else is
  reported UNVERIFIED, never as done [R-046].

## Layer 5 — Persistence gate (Stop hook, `push-ledger.json`)

The four layers above judge a form; this one judges that it exists on the
backend. `scripts/apply-form.mjs` is the ONE publication path and drives the whole
sequence (gates → record authored → push → record pushed → re-fetch → byte diff →
`verified`); `scripts/ledger.mjs` remains the sole writer of
`<git root>/.claude/cache/shesha-form-edit/push-ledger.json`, and the Stop hook reads
it. All three resolve the git root through the same
`scripts/lib/session-root.cjs` — one resolver, so the file the gate reads is the file
the writer wrote. The **one fail-open** left is narrow: no ledger file *and* no
form-publishing evidence in the session activity log → the session did no form work.
No ledger but a logged publish (an `apply-form.mjs` run or a `FormConfiguration`
write) BLOCKS — skipping the recording is not an exit. Everything else BLOCKS too — a
stale ledger (>12h, it cannot vouch for this session), malformed or empty JSON (it
is script-written, so a broken file means it was hand-edited or truncated), and
any entry whose status is not `verified`/`abandoned`. `node scripts/ledger.mjs
verify` runs the same check on demand [R-046].

## The rule

`compile (Layer 1) → offline gates → apply-form (publish + re-fetch + ledger) →
render-instrument (Layer 2) → placement diff (Layer 3) → design-critic (Layer 4) →
one envelope`. Every gate fail-closed; every layer catches what the one below cannot.
Report a form done only when its envelope says `status: "verified"`.
