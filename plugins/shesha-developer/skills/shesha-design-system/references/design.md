# Design integration — `frontend-design` skill

> This is an aesthetic-critique
> workflow — a fourth styling authority — and belongs in the appearance skill, not the
> structure skill. Neither integration point below is a mandatory step in
> `shesha-form-edit`'s own `0 · Route` … `7 · Report` pipeline — the **pre-build
> consultation** is an optional, explicitly-requested extra a caller (a user, or
> `shesha-claude-designer`'s own Step 1 "Ingest the design") may run before handing
> requirements to `shesha-form-edit` at all; the **post-render review** is the
> optional 5th, ask-first oracle layer `shesha-form-edit/SKILL.md`'s `6 · Push +
> Oracle` names explicitly (non-blocking, never a substitute for the mandatory
> design-critic layer). Both are named **pre-build** / **post-render** below —
> not step numbers — since neither owns a numbered slot in either skill's scheme.

Two integration points: **pre-build consultation** for new forms / major restructures (run before `shesha-form-edit` is ever invoked), and **post-render review** (the optional 5th oracle layer in `shesha-form-edit`'s `6 · Push + Oracle`) for aesthetic review of the rendered output.

The `frontend-design` skill is published by Anthropic; it's about creating distinctive, production-grade interfaces (typography, color, motion, spatial composition). It generates *design thinking and reference code* — we apply its output by tuning Shesha component props (`desktop.font`, `desktop.background`, `stylingBox`, `border.radius`, `shadow`, etc.), not by emitting React/HTML.

## Install (one-time)

If `frontend-design` is not in the available-skills list, the user has to install it:

```
/plugin install frontend-design
```

(or the equivalent in their Claude Code version — the plugin is in the `claude-plugins-official` marketplace.)

The skill must be reachable as `Skill(skill="frontend-design", ...)`. If invocation returns "skill not found", warn the user and **continue without** the design pass — `shesha-form-edit`'s `5 · Style` still works on its own (compile-time token bake-in, no `frontend-design` dependency). Don't block the flow.

---

## Pre-build — Design consultation

**Always ask the user first** via `AskUserQuestion` — never invoke `frontend-design` silently. The check has a real cost (extra round-trip, more tokens) and only pays off for substantial design work.

**Ask when:**
- Brand-new form (will be created via `Create` + `UpdateMarkup`).
- Major restructure (user words like "redesign", "rebuild the layout", "rework", "make this look better").

**Don't ask (skip silently) for:**
- Trivial edits (add a field, fix a script, correct a propertyName, change an action target).
- Bug fixes.
- Row-template / sub-form / utility forms with no top-level visual identity.
- User passes `--no-design` in `$ARGUMENTS`.

### Question template

> Want a design consultation from the `frontend-design` skill for this form? It returns aesthetic direction (~30s extra) before authoring.
> - **Yes — get a design plan** (recommended for new pages / major restructures)
> - **No — author from seeds only** (good for adding fields, small tweaks, internal forms)

If user picks No, proceed straight to seed-first authoring (`shesha-form-edit`'s normal path — no design source); cache a one-line `# Skipped — user declined` at `.claude/cache/shesha-form-edit/design-plans/<form-name>.md` so the post-render review below also knows to skip.

### Invocation (on Yes)

```
Skill(skill="frontend-design", args="<directive>")
```

Directive template:

> Design direction for a Shesha form. Context:
> - Form type: <auth-page | entity-edit | dashboard | datalist-host | wizard | row-template>
> - Entity: <modelType, e.g. Acme.Membership.Domain.Member> (omit if anonymous)
> - Audience: <e.g. members of a professional association, age 30-65, both individual and corporate>
> - Tone: <one of brutally minimal, refined editorial, organic/natural, luxury, playful, brutalist, art deco, soft/pastel, industrial — pick what fits the brand; if unclear, ask>
> - Brand colors / fonts (if any): <hex values from existing seeds — e.g. brand green #1F9D4D / dark green #0E5A2A>
> - Constraints: implementation is Shesha JSON form configuration; styling is via component `desktop` / `tablet` / `mobile` style blocks (`font`, `background`, `border`, `dimensions`, `stylingBox`, `shadow`). No custom CSS files; no React. Animation/motion limited to AntD defaults.
> - Requirements (user-supplied): <verbatim from user>
>
> Return a **design plan** as concise markdown:
> 1. Aesthetic direction (one paragraph).
> 2. Type system (display font, body font, sizes, weights — applied via `desktop.font`).
> 3. Color palette (4-6 hex values, with roles — primary, accent, surface, ink, muted).
> 4. Spatial system (gutter sizes, card radius, shadow intensity — applied via `stylingBox`, `border.radius`, `shadow`).
> 5. Section list — what sections / cards / rows the form should contain, in order.
> 6. The single most-memorable detail (the "one thing").
>
> Do NOT emit React/HTML/CSS code — return only the plan. Length cap: 500 words.

### Caching the plan

Save the returned plan to `.claude/cache/shesha-form-edit/design-plans/<form-name>.md`. `shesha-form-edit`'s optional aesthetic-review layer (the 5th layer of **6 · Push + Oracle**) reads it back to grade the rendered output against the spec.

### Applying the plan to Shesha JSON

Translate plan items into component props:

| Plan element | Shesha props |
|---|---|
| Display font | `desktop.font.type`, `desktop.font.size`, `desktop.font.weight` on text components / headings |
| Body font | Same on regular `text` and on input `font` |
| Primary color | Button `desktop.background.color`, link `desktop.font.color` |
| Surface color | Card / container `desktop.background.color` |
| Card radius | `desktop.border.radius.all` |
| Shadow | `desktop.shadow.{offsetX, offsetY, blurRadius, color}` |
| Section list | Outer container's `components` array order, with sub-containers per section |

Reference existing seeds (`shesha-form-edit/assets/golden/auth-page--auth-login.json`, `shesha-form-edit/assets/golden/dashboard--dashboard.json`) for shape — copy the structure, override the style blocks with the plan's values.

---

## Post-render — Aesthetic review

This is `shesha-form-edit`'s optional 5th, ask-first oracle layer (`SKILL.md`'s `6 · Push + Oracle`) — non-blocking, and never a substitute for that section's mandatory design-critic layer. **Ask the user first** via `AskUserQuestion`:

> Run an aesthetic review on the rendered form via `frontend-design`? It compares the screenshot against the design plan and returns up to 5 prop-level tweaks.
> - **Yes — review and suggest tweaks**
> - **No — confirm and finish**

On No, proceed straight to `7 · Report`. On Yes, invoke `frontend-design` as a critic, not a generator.

```
Skill(skill="frontend-design", args="<critique directive>")
```

Critique directive template:

> Aesthetic review of a rendered Shesha form. Inputs:
> - Original requirements: <verbatim from user>
> - Design plan (if any): <paste from .claude/cache/shesha-form-edit/design-plans/<form>.md>
> - Screenshot: <path to playwright screenshot>
>
> Identify aesthetic gaps between the plan and the rendered output. Focus on what's actually adjustable via Shesha component style props: typography, color, spacing, alignment, hierarchy, shadow, border-radius. Ignore things you can't change (browser default form controls, layout impossible without custom JS, etc.).
>
> Return up to 5 concrete edits, each as:
> - Component (by `propertyName` if visible in screenshot, else by visual position)
> - Prop to change (e.g. `desktop.font.size`, `desktop.stylingBox.paddingTop`)
> - Suggested value
> - Why (one sentence — the design rationale)
>
> Length cap: 300 words. Order findings by impact, highest first.

### Acting on findings

Findings are **suggestions, not blockers**. Surface them to the user as a numbered list. Ask: "Want me to apply any of these?" — accept/reject per item. On accept, loop back to `shesha-form-edit`'s `5 · Style` (apply targeted edits to the cached form JSON — recompile if the tweak is structural), then re-run `6 · Push + Oracle`.

If the form is acceptable as-rendered, skip the loop and confirm (`7 · Report`). The aesthetic pass is opt-in to apply.

---

## When NOT to invoke

- The user has explicitly indicated time pressure ("just add the field", "I need it now", "quick fix"). Don't burn a Step 0 round on a 30-second edit.
- Re-running the skill on a form the user already approved aesthetically. Cache the approval; don't re-critique.
- The form is a row template / sub-form / utility form (no top-level visual identity to design).

If you skip, leave a one-line note in the cached design-plan path: `# Skipped — <reason>` so future runs know.
