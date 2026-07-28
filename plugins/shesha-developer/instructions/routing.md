# Routing — which skill owns which intent

One table, authored once. The four designer skills' `description` fields are written to
agree with it. When a description and this table disagree, this table is the intent of
record and the description is the bug.

Intents are **mutually exclusive**: exactly one row should match a request. If two seem to
match, the more specific artifact wins (a custom React page is not a form; a theme change is
not a redesign).

## Designer surface (in scope for this release)

| The user wants | Route to | Not to |
|---|---|---|
| A designer-JSON form built or rebuilt from a **design source** — mockup, prototype, screenshot set, kit — or a **multi-screen** app realised | `shesha-claude-designer` | Not `shesha-form-edit` (it builds one screen, and cannot ingest a design source) |
| A **targeted change to a known form** — add/move/rewire components, wire CRUD, fix a runtime error — or one new form from **prose** requirements | `shesha-form-edit` | Not `shesha-claude-designer` (conducting a single prose screen is the measured #1 cause of long runs) |
| A **theme or brand** change — colours, type, spacing, radius — or a new brand token file | `shesha-design-system` | Not `shesha-form-edit`. It authors no structure. |
| **Measurement or placement diagnosis** — "this doesn't line up with the design", produce or refresh one screen's blueprint | `shesha-design-comprehension` | Not `shesha-form-edit` (which fixes placement, but does not diagnose it) |

## Adjacent skills (out of scope for this release — read-only here)

| The user wants | Route to |
|---|---|
| A **custom React/Next screen** under `src/screens/`, allowed to deviate from form-design guidelines — bespoke dashboards, landing pages, visual one-offs | `shesha-custom-page-designer` |
| To **scaffold and register** that screen's route and registry entry | `create-custom-page` |
| A new **designer component** in a package project (toolbox registration, settings form) | `create-custom-component` |
| **JSON cleanup only** — strip dead properties, console.logs, validate embedded script syntax | `clean-form-config` |
| A **domain prerequisite** — entities, reference lists, migrations | `domain-model` |
| An **application-layer prerequisite** — app services, DTOs, AutoMapper profiles | `shesha-app-layer` |
| To **regenerate ground truth** — components-kb, form schema, measured capability matrix. Maintainer mode; needs a running backend and portal | `shesha-gym` |

## Precedence

1. **A backend prerequisite outranks any form work.** A form cannot bind to an entity that
   does not exist. `domain-model` and `shesha-app-layer` both declare they run first, and
   they are right — resolve the entity, then build the screen.
2. **0.45 only.** Every skill here targets Shesha 0.45. A versioned 0.43-class backend
   (`versionStatus` on `GetByName`, flat-prop markup) is a handoff to the
   `shesha-developer-0-43` plugin, not an adaptation.
3. **A design source is the discriminator** between the conductor and the compiler. Files to
   measure → `shesha-claude-designer`. Prose adjectives only → `shesha-form-edit`.

## Known description conflicts (follow-ups — these two skills remain out of scope for edits)

- **`shesha-forms`** claims "Creates and modifies Shesha UI form configurations", which
  competes head-on with `shesha-form-edit` and carries no version or mechanism discriminator.
  It routes through the Shesha MCP server rather than the compiler. Its description needs a
  negative trigger pointing at `shesha-form-edit` for 0.45 work.
- **`shesha-developer-0-43`** duplicates every skill name in this plugin. Only the 0.45 side
  carries a version discriminator, so a 0.43-era prompt can match either.
