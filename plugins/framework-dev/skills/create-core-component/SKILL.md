---
name: create-core-component
description: Creates new Shesha core designer components in shesha-reactjs/src/designer-components that meet the current component standard from day one — Main/Events/Appearance settings tabs built with the fluent builder, Visible and Interaction Mode, allowInherit inheritance from metadata, a typed component API registered with useComponentApi, shared event handling, createStyles classes, removeStyleRouter, complete getDefaultStyles, styleGroup and previewConfiguration for the theme editor, and toolbox registration. Use when asked to create, add, build or scaffold a new form/designer component in the Shesha framework (input, display or container). For bringing an existing component up to standard, use refactor-core-component instead.
---

# Creating a Shesha Core Component

Build a new designer component that already meets the component standard, so it never needs the
refactor. Paths are relative to `shesha-reactjs/src/`.

**Copy patterns from NumberField** (`designer-components/numberField/`) and one component closest in
shape: `textField` (text input), `radio` / `checkboxGroup` (repeated options), `switch` (nested style
set), `collapsiblePanel` (container). Read the live files — they evolve. Never copy from a component
that still imports `useFormComponentStyles`; it is not on the standard.

## 1. Gather requirements

Ask for anything not given: `type` (camelCase, unique), display name, purpose, toolbox category,
input/output, container or not, bound data type(s), component-specific settings, API members beyond
the base interface, events it emits, icon (`@ant-design/icons`).

## 2. Files

In `designer-components/{type}/`:

| File | Contents |
| --- | --- |
| `interfaces.ts` | props + `ComponentDefinition` type |
| `settingsForm.ts` | `getSettings` (fluent builder) |
| `styles.ts` | `useStyles = createStyles(...)` |
| `utils.ts` | `defaultStyles()` |
| `{type}.tsx` | component definition |

Plus the API type in `componentsApi/componentApi.ts` and the toolbox entry.

## 3. interfaces.ts

```ts
export interface IXxxComponentProps extends IConfigurableFormComponent, IInputStyles {
  placeholder?: string | undefined;
  // component-specific props, every one `T | undefined` (strict null checks)
}
export type XxxComponentDefinition = ComponentDefinition<'xxx', IXxxComponentProps>;
```

Containers and display components extend the matching base instead of `IInputStyles` — check the
closest reference.

## 4. settingsForm.ts

Exactly three tabs — **titles Main / Events / Appearance, keys `common` / `events` / `appearance`**.
The keys are load-bearing (the theme editor extracts the Appearance tab by key), so never change them.

```ts
export const getSettings: SettingsFormMarkupFactory = ({ fbf, removeStyleRouter }) => {
  const searchableTabsId = nanoid();
  const commonTabId = nanoid();
  const eventsTabId = nanoid();
  const appearanceTabId = nanoid();

  return {
    components: fbf('root')
      .addSearchableTabs({ id: searchableTabsId, propertyName: 'settingsTabs', label: 'Settings', hideLabel: true, labelAlign: 'right', size: 'small',
        tabs: [
          { key: 'common', title: 'Main', id: commonTabId, components: fbf(commonTabId)
            .addContextPropertyAutocomplete({ propertyName: 'propertyName', label: 'Property Name', styledLabel: true, size: 'small', validate: { required: true } })
            .addLabelConfigurator({ propertyName: 'hideLabel', label: 'Label', hideLabel: true })
            .stdPlaceholderDescriptionInputs()
            .stdVisibleEditableInputs('full')
            .stdCollapsiblePanel('Behaviour', (fb) => fb /* component-specific settings */)
            .stdCollapsiblePanel('Validations', (fb) => fb
              .addSettingsInput({ inputType: 'switch', propertyName: 'validate.required', label: 'Required', size: 'small', layout: 'horizontal', jsSetting: true }))
            .toJson() },
          { key: 'events', title: 'Events', id: eventsTabId,
            components: fbf(eventsTabId).stdEventHandlers([...ALL_INPUT_EVENTS_WITHOUT_DOUBLE_CLICK], DataTypes.string).toJson() },
          { key: 'appearance', title: 'Appearance', id: appearanceTabId,
            components: fbf(appearanceTabId).stdAppearancePanels(['font', 'dimensions', 'border', 'background', 'shadow', 'marginPadding', 'customStyle'], removeStyleRouter).toJson() },
        ],
      })
      .toJson(),
    formSettings: { colon: false, layout: 'vertical' as FormLayout, labelCol: { span: 24 }, wrapperCol: { span: 24 } },
  };
};
```

Rules:

- **Validation lives in a `Validations` collapsible panel at the end of Main** — never its own tab.
- **Visible and Interaction Mode come from `stdVisibleEditableInputs`**, which also attaches
  permissions. Never add `hidden` / `readOnly` inputs or a Security tab.
- **Forward `removeStyleRouter` into `stdAppearancePanels`** — never hard-code or drop it. The form
  designer leaves it unset (values bind to `desktop.*`); the theme editor passes `true` (values bind
  flat to `theme.components[<type>]`). Dropped, the theme editor's panel silently does nothing.
- **Never hand-write font/border/background inputs** — use the `std*` helpers. Only list the
  Appearance panels the component actually renders.
- **No "Enable Style On Readonly" input.**

## 5. Component definition

```tsx
const XxxComponent: XxxComponentDefinition = {
  type: 'xxx',
  name: 'Xxx',
  icon: <XxxOutlined />,
  isInput: true,
  isOutput: true,
  canBeJsSetting: true,
  allowInherit: true,               // exact spelling — "allowInherite" silently does nothing
  styleGroup: 'inputs',             // 'inputs' | 'common' | 'common-containers' | 'buttons'
  preserveDimensionsInDesigner: true,
  dataTypeSupported: ({ dataType }) => dataType === DataTypes.string,
  Factory: ({ model }) => {
    const inputRef = useRef<InputRef>(null);
    useComponentApi<XxxApi>({ model, typeName: 'XxxApi', api: { focus: () => inputRef.current?.focus() } });
    const { styles } = useStyles(model);

    return (
      <ConfigurableFormItem<string> model={model}>
        {(value, onChange, _, ctx) => model.readOnly === true
          ? <ReadOnlyDisplayFormItem value={value} enableFullStyle={model.enableStyleOnReadonly} style={model.styleCss} styleValue={model} />
          : <Input
              ref={inputRef}
              value={value}
              disabled={model.disabled === true}
              placeholder={model.placeholder}
              className={styles.xxx}
              {...(isDefined(model.styleCss) ? { style: model.styleCss } : {})}
              onChange={(e) => {
                const newValue = e.target.value;
                ctx?.handleEvent(undefined, { value: newValue }, model.onChangeCustom);
                onChange(newValue);
              }}
              {...getComponentEvents<string>(model, ALL_INPUT_EVENTS_WITHOUT_CHANGE_AND_DOUBLE_CLICK, ctx, value, DataTypes.string)}
            />}
      </ConfigurableFormItem>
    );
  },
  settingsFormMarkup: getSettings,
  getDefaultStyles: () => defaultStyles(),
  linkToModelMetadata: (model, metadata) => ({ ...model /* derive from metadata; never overwrite configured values */ }),
  // Theme editor preview — set every option that affects appearance (prefix, suffix, ...)
  previewConfiguration: { type: 'xxx', id: 'xxx', propertyName: 'xxxAppearance', label: 'Xxx Label', version: 'latest' },
};
```

What each part guarantees:

- **Inheritance.** `allowInherit: true` plus a `linkToModelMetadata` that only fills properties the
  user hasn't configured. Don't seed defaults in `initModel` — the component ships empty and inherits.
- **All four Interaction Modes.** The framework resolves Editable / Disabled / Read only / Inherited
  into `model.readOnly` and `model.disabled`. Read only renders `ReadOnlyDisplayFormItem` (selectable
  text, every branch passes `style`); Disabled passes `disabled` to the control. Never write
  `disabled={readOnly}`. Suppress clear buttons, suggestion lists and option key handling in both
  non-editable states. If the control is a child component, give it a real `disabled` prop — a
  `{...model}` spread only forwards declared props.
- **Events.** The settings form and runtime use one constant pair from `_common/events.ts` so they
  can't drift: `ALL_INPUT_EVENTS_WITHOUT_DOUBLE_CLICK` ↔ `ALL_INPUT_EVENTS_WITHOUT_CHANGE_AND_DOUBLE_CLICK`
  (or `ALL_INPUT_EVENTS` ↔ `ALL_INPUT_EVENTS_WITHOUT_CHANGE`, `FILE_EVENTS` ↔ `FILE_EVENTS_WITHOUT_CHANGE`).
  `onChange` is wired inline. Only list events the component really emits.
- **API.** `useComponentApi` (from `@/providers/componentApi/hooks`) registers and cleans up the API.
  Pass component-specific `properties` (`{ name, getter, setter }`, setters call
  `apiContext?.updateApiModel(...)` — take `apiContext` from the Factory args) and list the values the
  getters read as the second argument. Implement `focus` here via a ref for any focusable component.
- **No migrator.** A new component has no saved forms. Add the first migration only when a persisted
  shape changes after release — then use `refactor-core-component`'s migration rules.

## 6. API type

In `componentsApi/componentApi.ts`, with JSDoc (it drives IntelliSense in the JS editors). Extend
`InputComponentApi<T>` for inputs, `CommonComponentApi` otherwise; add only real extras:

```ts
/** Xxx API */
export type XxxApi = InputComponentApi<string | undefined>;
```

## 7. styles.ts and utils.ts

Styles reach the component **only through `className`**; the only inline style is the evaluated Custom
style (`model.styleCss`). Builders from `_common/styles/utils.ts` emit CSS only for values set, so
everything else cascades.

```ts
export const useStyles = createStyles(({ css, cx }, model: IXxxComponentProps) => {
  const configuredAppearance = `
    ${borderStyles(model.border)}
    ${backgroundStyles(model.background)}
    ${shadowStyles(model.shadow)}
  `;
  const xxx = cx('sha-xxx', css`
    ${configuredAppearance}
    ${paddingStyles(model.stylingBoxJson)}
    ${dimensionsStyles(model.dimensions)}
    ${fontStyles(model.font, model.styleCss)}

    /* antd repaints the background on hover, focus and validation status - re-assert it */
    &&&&:hover, &&&&:focus, &&&&:focus-within,
    &&&&[class*="-status-error"], &&&&[class*="-status-warning"] {
      ${configuredAppearance}
    }
  `);
  return { xxx };
});
```

Get these right first time:

- **Padding/margin read `model.stylingBoxJson`**, not the `stylingBox` string.
- **Put `fontStyles(model.font, model.styleCss)` on the element that holds the text.** antd styles
  inner text elements directly, and a class rule there beats an inline style inherited from the root —
  so the Custom style's colour/font only shows if it is merged into that rule.
- **antd affix wrappers** (Allow Clear, prefix/suffix, form `hasFeedback`) move the visible border and
  background onto a wrapper. If the control can have one, apply `configuredAppearance` inside the
  wrapper's own class selector and reset the inner element (`background: transparent; border: none;
  box-shadow: none; margin: 0; padding: 0`). Let CSS detect the wrapper — `hasFeedback` isn't knowable
  in JS.
- **Repeated options** (checkbox/radio style): style each child via a descendant selector from the group
  class, and repeat background/border under the checked state.
- **Nested style set** (like switch `handleStyles`): type it, include it in `getDefaultStyles`, give every
  nested panel an explicit `'<prefix>.<prop>'` — including `stdCustomStylePanel('<prefix>.style')` (bare,
  it collides with the root `style`) — and evaluate the nested Custom style in the Factory with
  `useActualContextExecution`, since the framework only evaluates the root one.
- **Popups:** don't style a popup/modal with the input's appearance unless agreed with Alex Stephens —
  it isn't part of the standard.
- **Emotion literals are TypeScript:** no apostrophes in `/* CSS comments */`; check brace balance (a
  missing `}` silently turns the next rule into a descendant selector).

`utils.ts` — `defaultStyles(): IStyleValue` must be **complete**: it is the render fallback for an
unconfigured component and the theme editor's inherited baseline, and an input only shows an
inheritance popover if its property exists in the defaults:

```ts
export const defaultStyles = (): IStyleValue => ({
  font: { weight: '400', size: 14, color: '#000', type: 'Segoe UI', align: 'left' },
  border: { border: { all: { width: 1, style: 'solid', color: '#d9d9d9' } }, radius: { all: 8 }, borderType: 'all', radiusType: 'all' },
  background: { type: 'color', color: '#fff', repeat: 'no-repeat', size: 'cover', position: 'center', gradient: { direction: 'to right', colors: {} }, url: '' },
  dimensions: { width: '100%', height: '32px', minHeight: '0px', maxHeight: 'auto', minWidth: '0px', maxWidth: 'auto' },
  shadow: { spreadRadius: 0, blurRadius: 0, color: '#000', offsetX: 0, offsetY: 0 },
  stylingBoxJson: { _type: 'styleBox', marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0', paddingTop: '0', paddingRight: '0', paddingBottom: '0', paddingLeft: '0' },
});
```

## 8. Register in the toolbox

`providers/form/defaults/toolboxComponents.ts`: import the component and add it to the right category
(`'Data entry'`, `'Data display'`, `'Advanced'`, `'Layout'`, …) in `getToolboxComponents`.

## Conventions

- String presence checks use `isNullOrWhiteSpace` / `isNotNullOrWhiteSpace` from `@/utils/nullables`
  (type guards; cover `undefined`, `null`, whitespace). Use `isDefined` for non-strings.
- Property structure and tab layout need **Alexander Slavchov's** sign-off before the PR.

## Verify

```bash
cd shesha-reactjs
npm run type-check      # then READ typescript-errors.log — it exits 0 even with errors
npx eslint src/designer-components/<type>/
```

Then in the running designer:

- [ ] Appears in the toolbox; drag & drop works; data saves and loads
- [ ] Three tabs Main / Events / Appearance (keys `common` / `events` / `appearance`); validation in a `Validations` panel
- [ ] Dropped onto a bound property, it inherits from metadata
- [ ] Unconfigured, it renders correctly from `getDefaultStyles()`; every Appearance input shows an inheritance popover
- [ ] Editable / Disabled / Read only / Inherited all behave correctly in the browser
- [ ] Configured background survives hover, focus and a validation error (and with Allow Clear / prefix / suffix if supported)
- [ ] The Custom style reaches the text as well as the box
- [ ] Each event on the Events tab fires
- [ ] API members and `focus()` work from a JS setting
- [ ] Shows in Settings → Theme → Components with a working preview, and theme edits apply to newly dropped instances
