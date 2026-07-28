---
name: shesha-claude-designer
description: Realises a DESIGN SOURCE as Shesha designer forms — a mockup, screenshot set, HTML/JSX prototype, runnable app or Figma-style kit — and delivers multi-screen apps end to end. Triggers: "build this design in Shesha", "implement this mockup across the app", "make the portal match these screens". It routes by weight, extracts brand tokens plus a screen inventory, then delegates each screen to shesha-design-comprehension (measure), shesha-form-edit (compile, gate, push, verify) and shesha-design-system (tokens), and aggregates their evidence. NOT for a single form described only in prose with no design source, and NOT for editing one known form — both go straight to shesha-form-edit. NOT for a custom React screen: that is shesha-custom-page-designer.
---

# Shesha Claude Designer

A **router and planner**, not a pipeline. It owns exactly four things:

1. routing an incoming request to the skill that should handle it,
2. ingesting a design source into brand tokens plus a screen inventory,
3. planning and sequencing the screens,
4. aggregating the evidence its delegates return.

It authors no form JSON, picks no colours, runs no gates and never pushes. Each screen's
build is owned end to end by `shesha-form-edit`, including that screen's verification —
this skill reads the evidence, it does not re-derive it.

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
fetch per entity, one confirmation gate. Recipes: `shesha-form-edit/references/contracts.md`
§1–3. Append one line per phase to `<workdir>/run-log.md` so wall-clock is attributable.

## 3 · Ingest the design

Classify the source by fidelity tier, because it determines what can be trusted:

| Tier | Source | How |
|---|---|---|
| A | Readable HTML/JSX/CSS | Parse the grid templates directly — highest fidelity |
| B | Runnable prototype or app | **Serve it and probe the rendered DOM.** Never parse a minified bundle statically |
| C | Screenshots or PDF | Vision-read spatial layout. `markitdown` gives a content outline **only** — it flattens 2-D layout by design, so it is never the source of placement |

Emit two artifacts and nothing else:

- **the token set** — palette, type scale, spacing, radius, shadow, status lifecycle, written
  as a `shesha-design-system` `<brand>.tokens.json` (copy `shesha.tokens.json`, swap the
  values, keep every key name so `roles.*` still resolves);
- **the screen inventory** — per screen: name, type, entity, chrome notes.

Column-level layout is not this step's job. That is measurement, and it belongs to
`shesha-design-comprehension`.

## 4 · Plan the screens

Pick the brand: named by the user, handed as tokens, an existing `<brand>.tokens.json`, a
distinct palette in the design (author a new file), else the default `shesha`. Set the
app-level theme **once** via `shesha-design-system`, before any screen is built.

Map each screen to an archetype, sequence the build list → detail → create so cross-links
resolve, then present plan + inventory + expected cost and gate **once**. A global theme
change is approved separately from the per-form work — "make this form match the screenshot"
must never silently repaint the whole portal.

## 5 · Delegate per screen

The parallel axis is the **screen**. For 2+ screens, fan out one dispatch per screen;
barriers (theme, then push, then report) stay serial.

- **Measure** — `Skill(shesha-developer:shesha-design-comprehension)` per screen, in
  parallel. Returns `<workdir>/blueprints/<screen>.blueprint.md` plus its `blueprint-json`
  twin and the saved probe.
- **Build** — one `shesha-form-edit` dispatch per screen: *"compile
  `<workdir>/blueprints/<screen>.blueprint.json`; return pushed and verified form facts."*
  Form-edit owns compile → gates → push → oracle, and the oracle includes the visual
  verdict. Brand tokens are resolved at compile time, so there is no separate styling pass
  to schedule.

Every dispatch carries the pre-flight state (pinned shell, workdir, token-file path) — an
agent that has to re-pick a shell or re-authenticate re-breaks quoting and wastes the run.

## 6 · Aggregate the evidence

One envelope for the run. Per screen: form module + name + id, the blueprint path, gate
results, oracle verdict, placement outcome, visual verdict, and the probe/screenshot paths
that back them. Plus the theme applied and the cross-links between screens.

Read the delegates' evidence — do not restate their summaries as your own conclusion, and do
not re-run their checks. Anything a delegate reported as unverified stays **UNVERIFIED**
here. If the frontend was not running, say "built, not visually verified" rather than "done".
If a design detail cannot be expressed in Shesha, say so plainly instead of approximating it
silently.

## Boundaries

- **Never author form JSON, pick a hex, or push.** Structure and every backend write belong
  to `shesha-form-edit`; appearance belongs to `shesha-design-system`; placement measurement
  belongs to `shesha-design-comprehension`.
- **Never re-verify what a delegate already verified.** Duplicated gates were how this skill
  grew into a second pipeline.
- **Approval stays here.** Plan approval and any global-theme approval happen in this
  conversation, never inside a dispatched agent.
