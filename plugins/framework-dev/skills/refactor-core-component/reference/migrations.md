# Migrations

## Contents

- [Rules](#rules)
- [Refactor chain](#refactor-chain)
- [The style freeze](#the-style-freeze)
- [Type-changing migrations](#type-changing-migrations)
- [New components](#new-components)

## Rules

Migrations upgrade saved forms. `migrator: (m) => m.add<Props>(n, (prev, context) => ...)` runs every
step above the model's stored `version`, in order.

- **Append only. Never renumber, delete, or change the body of a released step.** A component already
  at version 6 or 7 skips an edited step 5, so the change never reaches it and old forms end up in two
  different shapes. The one safe edit is adding an `isNew` guard, which only affects new drops.
  Changing a released step is acceptable only when the step itself was broken (every form that ran it
  was already broken and has been fixed by hand) — and then call it out in the PR.
- **Every step that writes defaults or styles returns `prev` when `context.isNew === true`.** Migrations
  also run on newly dropped components; style/default back-fills exist only for old forms. This is the
  most common mistake:

  ```ts
  .add<IXxxProps>(n, (prev, context) => context.isNew === true ? prev : { ...migratePrevStyles(prev, defaultStyles()) })
  ```
- **Rename-only steps run unguarded**, for new and old alike: `migrateHiddenToVisible`,
  `migrateStylingBoxToJson`, `migratePermissionsToVisiblePermissions`.

## Refactor chain

Append, after the component's existing steps:

```ts
// N: freeze the old look (guarded)
.add<IXxxProps>(N, (prev, context) => context.isNew === true
  ? prev
  : { ...migratePrevStyles(prev, defaultStyles()) })
// N+1: renames — one step
.add<IXxxProps>(N + 1, (prev) => migratePermissionsToVisiblePermissions(migrateHiddenToVisible(migrateStylingBoxToJson(prev))))
```

- `migrateStylingBoxToJson` (from `_common-migrations/migrateSettings`) converts the legacy
  `stylingBox` string into `stylingBoxJson` on each device model. It is **required on every refactored
  component** (Alex Stephens added it Aug 2026) — the style builders read `stylingBoxJson`, so without
  it old forms lose their margin/padding.
- Chain the three renames in **one** step: one version number, one place to debug. Already-released
  components split them across two steps (textField 7+8, checkbox 6+7, textArea 6+7, numberField 6+7)
  — leave those as they are.
- If the component still lacks the earlier legacy steps (`migratePropertyName`/`migrateCustomFunctions`,
  `migrateVisibility`, `migrateReadOnly`, `migrateFormApi.eventsAndProperties`), they are already in
  its chain from before — don't add them again.
- Component-specific moves go in the same pattern (NumberField moves `min`/`max` into `validate`).
  Keep the `isNew` guard on anything that writes defaults.

## The style freeze

The guarded freeze bakes explicit values into the persisted `desktop`/`tablet`/`mobile` models so an
old component keeps its look. Render precedence is `getDefaultStyles()` → `desktop` → active device,
with `undefined` falling through — any slot the freeze leaves `undefined` follows the code defaults
and drifts when they change.

- **Pass the component's real `defaultStyles()`**, never `{}`. `migrateStyles(prev, {}, 'desktop')`
  freezes nothing.
- **Use `migratePrevStyles(prev, defaultStyles())`**, which bakes all three devices and carries
  `enableStyleOnReadonly`. A step that writes only `desktop` leaves tablet/mobile unfrozen.

NumberField and radio shipped their freeze as `migrateStyles(prev, {}, 'desktop')`. Those steps are
released and can't change — **follow textField / checkbox / textArea / dateField / dropdown** for this
step, not NumberField.

Some components first gather legacy loose props into `desktop` in a guarded step before the freeze
(see textField step 5, numberField step 4). Keep that if the component has loose legacy style props.

Nested style sets (`handleStyles`, `checkbox`, `radio`) are seeded inside the frozen device models,
never at the model root — see styling.md.

## Type-changing migrations

When a capability moves to another component, migrate the saved component into that type. Example:
CheckboxGroup lost single-selection mode (that is a Radio), so its migrator converts legacy single-mode
models into radios:

```ts
.add<IEnhancedICheckboxGroupProps | IRadioComponentProps>(6, (prev) => {
  if (!hasLegacySingleMode(prev)) return prev;
  const { mode: _mode, checkbox, ...rest } = prev;
  const radioDefaults = radioDefaultStyles();
  return migratePrevStyles({ ...rest, type: 'radio', radio: checkbox ?? radioDefaults.radio, version: 8 }, radioDefaults);
})
```

- Set `type` to the target and `version` to the target's **latest** migration index, so the target's
  migrator doesn't replay its legacy steps on an already-current model.
- Map nested style sets across (`checkbox` → `radio`) and freeze with the **target's** defaults.
- Before removing the capability, check shipped forms (`.shaconfig` packages) depend on it.

## New components

A brand-new component has no saved forms, so it needs **no migrator**. Add the first step only when a
persisted shape changes after release, and apply the rules above from then on.
