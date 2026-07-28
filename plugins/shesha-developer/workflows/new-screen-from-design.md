# Workflow — a screen from a design source

Use when there is something concrete to match: a mockup, a screenshot set, an HTML/JSX
prototype, a runnable app, a kit. If the request is prose adjectives only ("make a clean
booking form"), this workflow is overhead — go straight to
`Skill(shesha-developer:shesha-form-edit)`.

## 1 · Enter at the conductor

`Skill(shesha-developer:shesha-claude-designer)`. It routes by weight first, so a
single-screen or theme-only request leaves the pipeline immediately rather than paying for it.

## 2 · Ingest — tokens and an inventory, nothing else

The fidelity tier decides what can be trusted:

| Tier | Source | Trust |
|---|---|---|
| A | Readable HTML/JSX/CSS | parse the grid templates |
| B | Runnable prototype | **serve it and probe the DOM** — never parse a minified bundle |
| C | Screenshots / PDF | vision-read layout; markitdown gives content only, never placement |

Out: a `<brand>.tokens.json` and a screen inventory. Validate the brand before relying on it:

```
node skills/shesha-design-system/scripts/resolve-style-plan.mjs <brand>
```

Exit 0 means every key the compiler needs resolves. A partially-resolved theme silently
produces a form that looks styled and is not.

## 3 · Measure each screen

`Skill(shesha-developer:shesha-design-comprehension)`, one dispatch per screen, in parallel.
Each returns a blueprint — container tree, split-child counts, native widths, tab keys,
bindings — plus the `assertions` that will be re-measured after the build, and the saved probe.

Measurement is the point. A blueprint written from prose intuition is a prose brief with
better formatting.

## 4 · Build — one dispatch per screen, from this thread

The main thread fans out; no agent dispatches anything, so approval stays where a human can
reach it. Each `shesha-frontend-engineer` runs two commands and returns **an evidence bundle
path and an exit code** — not a summary:

```
node scripts/compile-blueprint.js --blueprint <bp.json> --metadata <Entity>.probe.json --out <form.json>
node scripts/apply-form.mjs --form <form.json> --module <mod> --name <form>
```

## 5 · Aggregate — verify the evidence

```
node scripts/verify-evidence.mjs <bundle> [...] | --ledger [--json]
```

Exits non-zero if any screen is unverified, and catches a screen whose agent claimed success
while its bundle records a failure. Build the report from that output — per screen the form
id, status and bundle path. Anything it did not pass stays UNVERIFIED. If a design detail
cannot be expressed in Shesha, say so rather than approximating it silently.

## Approval boundaries

Plan approval happens in the main conversation. A **global theme change is approved separately
from per-form work** — "make this form match the screenshot" must never repaint the whole
portal as a side effect.
