# Settings form, Interaction Mode, API and events

## Contents

- [Settings form](#settings-form)
- [removeStyleRouter](#removestylerouter)
- [Visible and Interaction Mode](#visible-and-interaction-mode)
- [Component API](#component-api)
- [Events](#events)

## Settings form

`settingsForm.ts` exports `getSettings: SettingsFormMarkupFactory = ({ fbf, removeStyleRouter }) => ...`
built with the fluent builder — copy the shape of `numberField/settingsForm.ts`:

```ts
fbf('root').addSearchableTabs({ id: searchableTabsId, propertyName: 'settingsTabs', label: 'Settings', hideLabel: true, labelAlign: 'right', size: 'small',
  tabs: [
    { key: 'common', title: 'Main', id: commonTabId, components: fbf(commonTabId)
      .addContextPropertyAutocomplete({ propertyName: 'propertyName', label: 'Property Name', styledLabel: true, size: 'small', validate: { required: true } })
      .addLabelConfigurator({ propertyName: 'hideLabel', label: 'Label', hideLabel: true })
      .stdPlaceholderDescriptionInputs()
      .stdVisibleEditableInputs('full')
      .stdCollapsiblePanel('Format', (fb) => fb /* component-specific inputs */)
      .stdCollapsiblePanel('Validations', (fb) => fb
        .addSettingsInput({ inputType: 'switch', propertyName: 'validate.required', label: 'Required', size: 'small', layout: 'horizontal', jsSetting: true }))
      .toJson() },
    { key: 'events', title: 'Events', id: eventsTabId,
      components: fbf(eventsTabId).stdEventHandlers([...ALL_INPUT_EVENTS_WITHOUT_DOUBLE_CLICK], DataTypes.string).toJson() },
    { key: 'appearance', title: 'Appearance', id: appearanceTabId,
      components: fbf(appearanceTabId).stdAppearancePanels(['font', 'dimensions', 'border', 'background', 'shadow', 'marginPadding', 'customStyle'], removeStyleRouter).toJson() },
  ],
})
```

Rules:

- **Tab titles are Main / Events / Appearance; keys are `common` / `events` / `appearance`.** The first
  tab was renamed from "Common" to "Main" (shesha-framework issue #5480) while its key stayed
  `common`. Keys are load-bearing — the theme editor extracts the Appearance tab by the key
  `'appearance'`, and keys are planned for automatic property positioning — so never invent or rename
  a key. Older docs/spec text saying "Common" or "Data, Events, Appearance" is out of date.
- **Validation is a `Validations` collapsible panel at the end of Main.** Never a separate tab.
  Include only the rules the component has (`validate.required`, `validate.minValue`/`maxValue`,
  `validate.minLength`/`maxLength`, `regExp`, `validate.message`, `validate.validator`, …).
- **Visible / Interaction Mode come from `stdVisibleEditableInputs(...)`** — don't hand-add `hidden` /
  `readOnly` inputs. It emits both with `permissionSettings: true`, which is where permissions attach.
- **Keep the existing label binding** (`'hideLabel'` vs `'label'`) when refactoring — renaming it
  breaks saved forms.
- **Component-specific settings go in collapsible panels between Visible/Interaction Mode and
  Validations.** Compare NumberField's `Format` panel with TextArea's `Behaviour` panel.
- **No "Enable Style On Readonly" input.** `stdAppearancePanels` deliberately omits it. The
  `enableStyleOnReadonly` model property still exists, is carried by the style migrations and is read
  at runtime (`enableFullStyle={model.enableStyleOnReadonly}`) — keep those, just never render a
  settings input for it.
- If you are writing font/border/background inputs by hand, you are missing a helper — see helpers.md.

## removeStyleRouter

**Thread it through; never set it.** It arrives as a factory argument and must be forwarded into
`stdAppearancePanels(panels, removeStyleRouter)`. Don't hard-code it and don't drop the argument.

`stdAppearancePanels` wraps the Appearance inputs in a property router whose name becomes a prefix on
every nested input:

| Caller | Passes | Router | Values bind to |
| --- | --- | --- | --- |
| Form designer (component properties panel) | nothing | on | `desktop.font`, `desktop.border`, … (per device) |
| Theme editor (`componentSettingsPanel.tsx`) | `removeStyleRouter: true` | off | `font`, `border`, … → `theme.components[<type>]` |

It also switches the border/background panels to their non-device variants.

**Symptom when dropped:** the router stays on in the theme editor, inputs bind to `desktop.*`, nothing
reaches `theme.components[<type>]` — the theme editor's panel silently does nothing and inheritance
misbehaves.

**Theme styles are a snapshot, not a live merge.** When a component is added to a form, the designer
bakes `theme.components[<type>]` into its `desktop` model (`applyThemeStylesToComponent`,
`providers/form/utils.ts`). Rendering uses `getDefaultStyles()` → `model.desktop` → active device; it
never reads the theme. Editing the theme restyles nothing already on a form. (`dynamicView` components
regenerate every render and so re-snapshot.)

## Visible and Interaction Mode

Legacy → current:

- `hidden` → `visible` (migration: `migrateHiddenToVisible`)
- `readOnly` / `disabled` / old edit mode → `editMode` (migration: `migrateReadOnly`)

The runtime reads `model.visible`, `model.readOnly` and `model.disabled` (the framework derives the
last two from `editMode`).

**Interaction Mode has four values and an input must honour all of them.** `editModeSelector` offers
Editable, Disabled, Read only and Inherited, resolved into two independent booleans. Wiring only one
leaves a mode that silently does nothing, and type-checking can't catch it:

```tsx
model.readOnly === true
  ? <ReadOnlyDisplayFormItem value={value} enableFullStyle={model.enableStyleOnReadonly} style={model.styleCss} styleValue={model} />
  : <SomeInput disabled={model.disabled === true} ... />
```

Read only shows the value as selectable text; Disabled greys the control and removes it from the tab
order — not interchangeable. Failure modes seen in this repo:

- **`disabled={readOnly}`** — when read-only already returns early, this is dead code and Disabled
  renders an editable control (`address/control.tsx`, `components/dropdown/dropdown.tsx`).
- **`disabled` declared but never destructured** — silently dropped. Grep for it; expect ≥2 hits.
- **A presentational child with no `disabled` prop** — a parent's `{...model}` spread can't pass it.
  Add the prop to the child.

Pass `readOnly` / `disabled` as native props on antd inputs. Suppress anything read-only makes
meaningless (clear button, suggestions list, option key handling) in **both** non-editable states.
Verify all modes in the browser, not by reading code.

## Component API

The API is assembled from:

- `KnownFormComponent` — standard properties/methods for all components
- `EventsAndApiValueProcessor` — value handling
- the component — only its specific remainder

Base interfaces already carry `value`, `visible`, `interactionMode`, `required`, `isValid()`,
`getErrors()`, `reset()`. Check `componentsApi/componentApi.ts` first — some types were declared ahead
of their refactor.

**1. Describe the type** in `componentsApi/componentApi.ts` with JSDoc (the file is imported `?raw`
and drives IntelliSense/validation in the JS editors):

```ts
/** Number field API */
export interface NumberFieldApi extends InputComponentApi<number | undefined> {
  /** Minimum allowed value */
  min: number | undefined;
  /** Maximum allowed value */
  max: number | undefined;
}
```

**2. Register it** with the `useComponentApi` hook from `@/providers/componentApi/hooks` — it wraps
`updateApi` in a `useEffect`, defaults `level` to 3, builds the type definition from `typeName`, and
removes the API on unmount. Don't hand-roll `updateApi` / `useEffectOnce` (older components that do
are not the pattern to copy):

```tsx
const inputRef = useRef<InputNumberRef>(null);
useComponentApi<NumberFieldApi>({ model, typeName: 'NumberFieldApi',
  properties: [
    { name: 'min', getter: () => model.validate?.minValue, setter: (value) => apiContext?.updateApiModel({ validate: { minValue: value } }) },
  ],
  api: { focus: () => inputRef.current?.focus() },
}, [model.validate?.minValue]);
```

The second argument lists the values the getters read. **`focus` is implemented here**, not in
`KnownFormComponent`, because it needs a ref to the DOM node — add it to every component that can
take focus.

## Events

Use one shared constant pair (from `_common/events.ts`) at both call sites so the form can't advertise
an event the runtime never binds:

| Settings form (`stdEventHandlers`) | Runtime (`getComponentEvents`) |
| --- | --- |
| `ALL_INPUT_EVENTS` | `ALL_INPUT_EVENTS_WITHOUT_CHANGE` |
| `ALL_INPUT_EVENTS_WITHOUT_DOUBLE_CLICK` | `ALL_INPUT_EVENTS_WITHOUT_CHANGE_AND_DOUBLE_CLICK` |
| `FILE_EVENTS` | `FILE_EVENTS_WITHOUT_CHANGE` |

Most inputs use the `WITHOUT_DOUBLE_CLICK` pair. Include only events the component really emits.

```tsx
onChange={(e) => {
  const newValue = e.target.value;
  ctx?.handleEvent(undefined, { value: newValue }, model.onChangeCustom);
  onChange(newValue);
}}
{...getComponentEvents<string>(model, ALL_INPUT_EVENTS_WITHOUT_CHANGE_AND_DOUBLE_CLICK, ctx, value, DataTypes.string)}
```

Custom handler props are `<event>Custom` (`onChangeCustom`, `onBlurCustom`, …). `ctx` is the fourth
argument of the `ConfigurableFormItem` render function.
