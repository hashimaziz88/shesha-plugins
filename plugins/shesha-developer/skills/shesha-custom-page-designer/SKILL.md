---
name: shesha-custom-page-designer
description: Use when building a Shesha CUSTOM PAGE — a React/Next.js screen under src/screens/, not form-designer JSON — that is allowed to DEVIATE from the standard Shesha form design guidelines. Bespoke dashboards, landing pages, visual one-offs, marketing-style screens, and harness test cases that explicitly request deviation from the design guidelines all route here. Scaffolds via create-custom-page conventions and keeps baseline coherence from the default shesha design tokens, but intentionally skips the blueprint/comprehension machinery, the v7 style-block system, and the form-edit push pipeline. For standard data forms (tables, create/detail views, CRUD), use shesha-form-edit; to match a specific multi-screen design, use shesha-claude-designer.
---

# Shesha Custom Page Designer

A stripped, fast path for **custom pages**: screens where bespoke visual design is the point and the standard form design guidelines are a baseline to depart from, not a contract to satisfy. Output is React/TypeScript source code, never Shesha form-designer JSON.

## When to use / not

**Use for:**
- Dashboards, stats/overview pages, landing or welcome screens, visual one-offs.
- Any request that says the page should look different from the standard app pages, or a harness test case that specifies deviation from the design guidelines.
- Pages needing components Shesha's form designer doesn't offer (charts, custom visualisations, novel interactions).

**Do NOT use for:**
- Standard data forms — a table/list of an entity, create/edit/detail views, CRUD dialogs → `shesha-developer:shesha-form-edit` (its pipeline includes validation, guardrails, and a default-theme styling pass).
- Realising a specific design across screens → `shesha-developer:shesha-claude-designer`.
- Styling an existing working form → `shesha-developer:shesha-design-system`.

If the request mixes both (a bespoke dashboard page PLUS a standard entity table), build the custom page here and route the table to `shesha-form-edit`.

## Step 1 — Scaffold

**REQUIRED SUB-SKILL:** invoke `Skill(shesha-developer:create-custom-page)` for all scaffolding mechanics — file placement (`src/screens/<name>/index.tsx` + route entry under `src/app/(main)/dynamic/<route-path>/page.tsx`), the screen registry, duplicate checks, and the hook/import guardrails (`useSheshaApplication` from `@shesha-io/reactjs`; there is NO `httpClient`, NO `withAuth`, NO `PageWithLayout`). Do not restate or improvise any of that here — follow that skill's steps 1–6, then return here for design and verification.

## Step 2 — Baseline coherence (the six anchors)

Deviation is allowed and expected — but a custom page still lives inside the app shell next to standard pages. Read the default token file once:

```
plugins/shesha-developer/skills/shesha-design-system/assets/themes/shesha.tokens.json
```

(If the project has its own `<brand>.tokens.json` in that folder, use that brand's equivalents instead.)

Keep these **six anchors** even in a deviating design:

1. **Canvas** — page background `#F8F8F9` (or a deliberate full-bleed alternative; never default white by omission).
2. **Primary** — `#003BB2` for interactive affordances (buttons, links, active states) ONLY — never as decorative wash.
3. **Ink** — text is `#181818` on light surfaces, never pure black.
4. **Borders, not shadows** — structure via hairline borders (`#E8EAF0`); shadows only for genuinely floating surfaces.
5. **Type** — system-ui stack (no web fonts); weights 400/600.
6. **Semantic colour for status only** — the success/warning/danger/info tones signal state, never decoration.

Everything else is free: layout, density, novel components, charts, hero sections, illustration, animation, unconventional navigation. A "deviate from the guidelines" test case means departing on layout/density/composition — the anchors are what keep the page recognisably part of the same app. If the request explicitly overrides an anchor too ("dark hero", "brand splash page"), honour the request and note the override in the summary.

## Step 3 — Design and build

- Plain React + Ant Design (`Row`, `Col`, `Flex`, `Card`, `Statistic`, `Table`, `Typography`, …) + inline styles or CSS Modules. No other UI libraries.
- **Data**: `fetch()` with `backendUrl` + `httpHeaders` from `useSheshaApplication()`. Entity data comes from the dynamic CRUD endpoints (`/api/dynamic/<Module>/<Entity>/Crud/GetAll`) or app services. Every fetch gets a loading state (`Spin`/`Skeleton`) and an error state (`message.error` or an inline `Alert`) — a blank region on failure is a defect.
- **Charts/visualisations**: prefer composing AntD primitives or lightweight inline SVG; do not add a chart library unless the project already ships one (check `package.json` first).
- For ambitious aesthetic direction, optionally consult `Skill(frontend-design)` before building — ask the user first via `AskUserQuestion`; skip silently in headless runs.
- Responsive: the page renders inside the app shell — use fluid widths (`Row`/`Col` spans, `%`/`minmax`), never hardcode the content width to a desktop pixel size.

## Step 4 — Verify

1. Type-check/build: `npm run build` (or the project's type-check script) — zero errors in the new files.
2. Load `{base_url}/dynamic/<route-path>` in the browser (dev server running): page renders, no console errors, data regions show real data or a designed empty state.
3. Confirm the registry entry and route file exist and the screen is reachable from a fresh navigation (not just a hot-reload artifact).
4. Summarise: files created, the URL, auth mode (authenticated vs public), which anchors were kept, and any deliberate deviations/overrides.

## What this skill intentionally strips (do not re-add)

- **No `shesha-design-comprehension`** — no measured blueprints or placement re-measurement; custom pages are hand-authored source.
- **No v7 style blocks / capability matrix / `shesha-design-system` recipes** — those style form-designer JSON; here styling is React props and CSS.
- **No FormConfiguration push/versioning, no `modelType`/`dataContext` wiring, no `clean-form-config`** — this is source code committed to the repo, not form config pushed to the backend.
