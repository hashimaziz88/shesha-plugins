---
name: refactor-core-component
description: Refactors an existing Shesha designer component in shesha-reactjs/src/designer-components to the current component standard while keeping saved forms working — Main/Events/Appearance settings tabs, Visible and Interaction Mode instead of Hidden/readOnly, allowInherit inheritance, useComponentApi, shared events, createStyles classes instead of useFormComponentStyles, removeStyleRouter, getDefaultStyles, previewConfiguration, and the migration chain (isNew-guarded migratePrevStyles, then migrateStylingBoxToJson, migrateHiddenToVisible, migratePermissionsToVisiblePermissions). Also fixes already-refactored components: appearance lost on hover/focus/validation or behind an antd affix wrapper, nested style sets (checkbox.*, radio.*, handleStyles.*), Custom style not reaching text, missing inheritance popovers, popup styling, and Disabled vs Read only modes. Use when asked to refactor, migrate, modernize or "make it like NumberField" an existing Shesha form component, or to fix one of these issues.
---

# Refactoring a Shesha Core Component

Bring an existing component up to the current component standard without changing how existing saved
forms render. For a brand-new component use the `create-core-component` skill instead.

Paths are relative to `shesha-reactjs/src/`. The framework source is the authority on implementation:
read the live reference files before writing code, and treat snippets here as a map.

## References

**NumberField is the canonical reference.** Pick a second reference closest to the target:

| Target shape | Second reference |
| --- | --- |
| Text-like input | `textField`, `textArea` |
| Repeated child element (options) | `radio`, `checkboxGroup` |
| Toggle with a nested style set | `switch`, `checkbox` |
| Container | `collapsiblePanel` |
| Opens a popup | `dateField`, `autocomplete`, `dropdown` |

Components still importing `useFormComponentStyles` are **not** refactored — never copy from them
(`grep -rln useFormComponentStyles src/designer-components/`).

The internal spec ("Component refactoring", Loop) is the authority on *intent*; the refactored
components are the authority on *implementation*. Where they disagree, follow the code and flag it.

Standards doc: https://docs.shesha.io/docs/framework-contributors/component-standards-and-developer-checklist/

Load the reference file a step points to:

- [reference/settings-and-api.md](reference/settings-and-api.md) — settings form, `removeStyleRouter`, Interaction Mode, component API, events
- [reference/styling.md](reference/styling.md) — `styles.ts`, default styles, stateful/wrapper styling, nested style sets, Custom style, popups, read-only
- [reference/migrations.md](reference/migrations.md) — migrator rules, refactor chain, style freeze, type-changing migrations
- [reference/helpers.md](reference/helpers.md) — catalog of `fbf` helpers, style builders, event constants, migration helpers

## Choose the path

- **Component not yet on the standard** → [Refactor workflow](#refactor-workflow).
- **Bug in an already-refactored component** (textField, numberField, textArea, checkbox,
  checkboxGroup, radio, switch, collapsiblePanel, dateField, dropdown, autocomplete, …) → go to the
  matching section of styling.md or settings-and-api.md, fix it, then run [Verify](#verify).

## Before you start

Read every file in the target folder, then the matching NumberField file side by side. List what the
target does that NumberField's pattern doesn't cover (custom formatting, multiple values, child
components) — those parts need judgement, not translation.

Two decisions are **settled** — take them from the refactored components rather than asking:

- **Property distribution across tabs**: Main carries property binding, label, placeholder/tooltip,
  `stdVisibleEditableInputs`, then component-specific panels, then `Validations` last. Events and
  Appearance are entirely `std*` helpers.
- **API shape**: extend `InputComponentApi<T>` (inputs) or `CommonComponentApi`; add only what the
  component genuinely has. Most add nothing (`TextFieldApi` is a bare alias; `NumberFieldApi` adds
  `min`/`max`; `RadioApi` adds `options`).

Ask before anything that changes the component's public API or its behaviour on existing forms.

## Refactor workflow

Work additively — existing saved forms must keep rendering exactly as before.

1. **Settings form** → three tabs titled Main / Events / Appearance with keys `common` / `events` /
   `appearance`; validation in a `Validations` panel at the end of Main; no "Enable Style On Readonly"
   input. → settings-and-api.md
2. **`removeStyleRouter`** forwarded from the factory args into `stdAppearancePanels`. → settings-and-api.md
3. **Visible / Interaction Mode** via `stdVisibleEditableInputs`; runtime reads `model.visible`,
   `model.readOnly` **and** `model.disabled`. → settings-and-api.md
4. **Inheritance**: add `allowInherit: true`; make `linkToModelMetadata` fill only unconfigured
   properties; ship empty properties apart from the critical ones (`type`, `componentName`, `propertyName`).
5. **Component API**: type in `componentsApi/componentApi.ts`; register with `useComponentApi`; local
   `focus` via a ref. → settings-and-api.md
6. **Events** onto the shared constant pair (`stdEventHandlers` / `getComponentEvents`). → settings-and-api.md
7. **Styles**: remove `useFormComponentStyles`; create `styles.ts` with `createStyles`; apply via
   `className`; keep only `model.styleCss` inline. → styling.md
8. **Defaults**: complete `defaultStyles()` in `utils.ts` + `getDefaultStyles`. → styling.md
9. **Theme editor**: `styleGroup` + `previewConfiguration`.
10. **Migrations** — append, never renumber/delete/rewrite a released step:
    - guarded freeze: `context.isNew === true ? prev : { ...migratePrevStyles(prev, defaultStyles()) }`
    - then **one** step: `migratePermissionsToVisiblePermissions(migrateHiddenToVisible(migrateStylingBoxToJson(prev)))`
    → migrations.md

### Code conventions

- String presence checks use `isNullOrWhiteSpace` / `isNotNullOrWhiteSpace` from `@/utils/nullables`,
  never `!value`, `value === ''` or `value.trim() === ''`. `isDefined` stays the check for non-strings.
  Sweep the code you touch, not just the code you add.
- Strict null checks are on; type model properties as `T | undefined` like NumberField.

## Verify

```bash
cd shesha-reactjs
npm run type-check      # then READ typescript-errors.log
npx eslint src/designer-components/<type>/
```

`npm run type-check` writes to `typescript-errors.log` and **exits 0 even with errors** — an empty log
is the pass condition. Don't create test files unless asked. If you run `npm test`, confirm a failure
reproduces on a clean tree (`git stash`) before calling it yours — the suite has failed on `main` for
environment reasons.

Then check by hand in the running designer:

- [ ] An existing saved form using the component still loads and looks the same
- [ ] A freshly dropped component inherits from metadata instead of shipping hard-coded values
- [ ] An unconfigured component renders correctly from `getDefaultStyles()`
- [ ] The freeze step passes the real `defaultStyles()` (never `{}`) and bakes all three devices
- [ ] `migrateStylingBoxToJson` is in the chain; old margins/padding still apply
- [ ] Existing permissions still apply, now via Visible / Interaction Mode
- [ ] Three tabs titled Main / Events / Appearance, keys `common` / `events` / `appearance`; validation in a `Validations` panel; no "Enable Style On Readonly" input
- [ ] All four Interaction Modes work **in the browser**: Editable edits; Disabled is greyed and out of the tab order; Read only renders text; Inherited follows the container. Clear buttons / suggestion lists are suppressed in both non-editable states
- [ ] Nested style set (if any): every nested panel binds `<prefix>.<prop>` incl. `stdCustomStylePanel('<prefix>.style')`; the nested Custom style is evaluated in the Factory; migrations seed it under device models
- [ ] Every Appearance input shows an inheritance popover, including compound background inputs; Reset to default and Override inheritance work
- [ ] Configured background survives hover, focus and a validation error, with and without Allow Clear / prefix / suffix
- [ ] The Custom style reaches the text as well as the box
- [ ] Each event on the Events tab fires at runtime
- [ ] The component appears in Settings → Theme → Components with a working preview; editing the theme restyles nothing already on a form
- [ ] No hand-rolled null/blank string checks remain in touched code

## Traps

- **Never remove a feature without checking shipped forms.** Grep the config packages first:
  `for f in shesha-core/src/*/ConfigMigrations/*.shaconfig; do unzip -l "$f" | grep -i <form>; done`.
  Removing `url` from radio broke the shipped reset-password form. If a removal is contested, restore
  it, add a comment, and raise it — spec requirements are not always final.
- **When a capability moves to another component**, migrate saved models into that type (CheckboxGroup
  single mode → Radio) — see migrations.md.
- **Check a setting is actually read** before trusting it: grep its property name in the component.
  Several panels collected values nothing consumed (nested Custom styles).
- **A declared-but-never-destructured prop is silently dropped and type-checks** — confirm ≥2 hits
  (destructure + use). `{...model}` only forwards what the child's props type declares.
- **Emotion template literals are TypeScript**: an apostrophe in a `/* CSS comment */` or a stray
  backtick terminates the literal with a misleading error far away.
- **A missing `}` in a nested rule** turns the next rule into a descendant selector that matches nothing.

## Getting agreement

Property structure and tab layout need **Alexander Slavchov's** sign-off before the PR. Changes to
shared infrastructure (`inputComponent`, `form-factory`, `_common/styles`) alter every component's
settings panel — raise them before building. Anything beyond the standard (e.g. new popup styling)
needs agreement with **Alex Stephens** first.

Testers log issues in the "Issues for reworked components" spreadsheet (Yulia Gradova, Zuki Dlomo,
Kulani John). Check the component's row before calling it done, and reply on rows that are correct by
design. Follow the repo's CLAUDE.md (strict null checks, conventional commits via `npm run commit`).
