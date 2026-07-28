---
name: shesha-claude-designer
description: Realises a DESIGN SOURCE as Shesha designer forms — a mockup, screenshot set, HTML/JSX prototype, runnable app or Figma-style kit — and delivers multi-screen apps end to end. Triggers: "build this design in Shesha", "implement this mockup across the app", "make the portal match these screens". It routes by weight, extracts brand tokens plus a screen inventory, then dispatches one shesha-frontend-engineer per screen to compile and apply it, and verifies the evidence bundles they return. NOT for a single form described only in prose with no design source, and NOT for editing one known form — both go straight to shesha-form-edit. NOT for a custom React screen: that is shesha-custom-page-designer.
---

# Shesha Claude Designer

A **router and planner**, not a pipeline. It owns four things: routing the request, ingesting
a design source into tokens plus a screen inventory, planning and sequencing the screens, and
verifying the evidence its delegates return.

It authors no form JSON, picks no colours, runs no gates and never pushes. Each screen is
executed by a dispatched `shesha-frontend-engineer` running `shesha-form-edit`'s two CLIs,
and it returns an evidence bundle path — this skill **verifies** that evidence rather than
re-deriving or believing it.

Full intent table: [plugin `instructions/routing.md`](../../instructions/routing.md).
Session rules and the dispatch contract: `shesha-form-edit/references/contracts.md`.

## 1 · Route first

Most requests that reach here do not need a conductor. Decide before spending anything:

| Request | Route |
|---|---|
| One screen, **no design source** (prose adjectives only) | Hand the whole task to `Skill(shesha-developer:shesha-form-edit)` and stop. Conducting a single prose screen is the measured top cause of 30-minute runs that form-edit finishes in about 8. |
| One targeted edit to a known form | Same — straight to `shesha-form-edit`. |
| Theme, brand or colour only | `Skill(shesha-developer:shesha-design-system)`. |
| "Doesn't match the design" on an already-built form | `Skill(shesha-developer:shesha-design-comprehension)` to diagnose placement. |
| A custom React/Next screen | `Skill(shesha-developer:shesha-custom-page-designer)`. |
| One screen **with** a real design source | Continue here; measure that screen inline, no dispatch. |
| 2+ screens, or a kit/prototype covering an app | Continue here with per-screen fan-out. |

When routing away, pass the whole context — backend URL, credentials, module, workdir — and
let the receiving skill own the run including its summary. Do not stay in the loop.

## 2 · Pre-flight (once per run)

One shell, one `<workdir>`, one authentication (cached BOM-free token), one scoped metadata
fetch per entity, one confirmation gate — recipes in `contracts.md` §1–3. Log one line per
phase to `<workdir>/run-log.md` so wall-clock is attributable.

## 3 · Ingest the design

Classify the source by fidelity tier, because it determines what can be trusted:

| Tier | Source | How |
|---|---|---|
| A | Readable HTML/JSX/CSS | Parse the grid templates directly — highest fidelity |
| B | Runnable prototype or app | **Serve it and probe the rendered DOM.** Never parse a minified bundle statically |
| C | Screenshots or PDF | Vision-read spatial layout. `markitdown` gives a content outline **only** — it flattens 2-D layout by design, so it is never the source of placement |

Emit two artifacts and nothing else: **the token set** (palette, type, spacing, radius,
shadow, status lifecycle → a `shesha-design-system` `<brand>.tokens.json`; copy
`shesha.tokens.json`, swap values, keep every key name so `roles.*` resolves) and **the
screen inventory** (per screen: name, type, entity, chrome notes). Column-level layout is
measurement, and belongs to `shesha-design-comprehension`.

## 4 · Plan the screens

Pick the brand: named by the user, handed as tokens, an existing `<brand>.tokens.json`, a
distinct palette in the design (author a new file), else the default `shesha`. Set the
app-level theme **once** via `shesha-design-system`, before any screen is built.

Map each screen to an archetype, sequence the build list → detail → create so cross-links
resolve, then present plan + inventory + expected cost and gate **once**. A global theme
change is approved separately from the per-form work — "make this form match the screenshot"
must never silently repaint the whole portal.

## 5 · Delegate per screen

The parallel axis is the **screen**, and **this thread does the fanning out** — one dispatch
per screen, so approval stays here and no agent needs to dispatch anything.

- **Measure** — `Skill(shesha-developer:shesha-design-comprehension)` per screen, in
  parallel. Returns `<workdir>/blueprints/<screen>.blueprint.md` plus its `blueprint-json`
  twin and the saved probe.
- **Build** — one `shesha-frontend-engineer` dispatch per screen. Execution is two commands,
  so the brief is short:

  > Compile `<workdir>/blueprints/<screen>.blueprint.json` with
  > `scripts/compile-blueprint.js --metadata <workdir>/<Entity>.probe.json --theme <brand>`,
  > then apply it with `scripts/apply-form.mjs --form <out> --module <mod> --name <form>`.
  > Return the evidence bundle path it prints and the exit code. Nothing else.
  > Pinned tool: PowerShell. `<workdir>`: `<path>` (token at `<workdir>/access-token` —
  > reuse it, never re-authenticate).

  The agent returns a **path and an exit code**, not prose. Brand tokens are resolved at
  compile time, so there is no styling pass to schedule.

Barriers stay serial: the app theme is set once before any screen builds, and cross-linked
screens push in list → detail → create order.

## 6 · Aggregate from the evidence, not from the summaries

Verify what came back rather than believing it — pass the returned paths, or `--ledger` for
every push this session, and `--json` for a machine-readable envelope:

```
node skills/shesha-form-edit/scripts/verify-evidence.mjs <bundle> [...] | --ledger [--json]
```

It checks each bundle exists, still hashes to its recorded digest, and records a settled
status, exiting non-zero if any screen is unverified. A screen whose agent reported success
while its bundle says `failed` is caught here — an agent's narration is not evidence, and
this thread never had to trust it.

Build the report **from that output**: per screen the form module/name/id, status, and the
bundle path behind it, plus the theme applied and the cross-links. Anything the verifier did
not pass is reported **UNVERIFIED** — not "done", and not omitted. If the frontend was not
running, the bundle says `pushed-unrendered` and that is what you report. If a design detail
cannot be expressed in Shesha, say so plainly instead of approximating it silently.

## Boundaries

- **Never author form JSON, pick a hex, or push.** Structure and every backend write belong
  to `shesha-form-edit`; appearance belongs to `shesha-design-system`; placement measurement
  belongs to `shesha-design-comprehension`.
- **Verify the evidence, never re-run the delegate's gates.** Duplicated gates were how this
  skill grew into a second pipeline; `verify-evidence.mjs` checks the bundles instead.
- **Approval stays here, and so does the fan-out.** Plan approval and any global-theme
  approval happen in this conversation, never inside a dispatched agent — which is also why
  this thread dispatches one agent per screen rather than delegating the fan-out.
