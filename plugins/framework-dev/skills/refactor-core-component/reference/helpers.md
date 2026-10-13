# Shared helpers catalog

A map of the shared building blocks. They live in shesha-reactjs and change — confirm signatures in
the source when precision matters.

## Contents

- [Fluent settings builder (fbf)](#fluent-settings-builder-fbf)
- [Style builders](#style-builders)
- [Events](#events)
- [Migration helpers](#migration-helpers)
- [Component API](#component-api)
- [Component definition members](#component-definition-members)
- [Null/blank helpers](#nullblank-helpers)

## Fluent settings builder (fbf)

Source: `form-factory/implementation.ts`. `getSettings` is a `SettingsFormMarkupFactory` receiving
`{ fbf, removeStyleRouter }`; root is `fbf('root').addSearchableTabs({ ... tabs: [Main, Events, Appearance] }).toJson()`.

Main tab (key `common`):

| Helper | Purpose |
| --- | --- |
| `addContextPropertyAutocomplete({ propertyName: 'propertyName', ... })` | Property binding |
| `addLabelConfigurator({ propertyName: 'hideLabel', ... })` | Label — keep the component's existing binding |
| `stdPlaceholderDescriptionInputs()` | Placeholder + tooltip row |
| `stdVisibleEditableInputs(interactionType)` | Visible switch + Interaction Mode selector, both with permissions; `'full'` for most inputs |
| `stdPrefixSuffixInputs(visibleJs?)` | Prefix/suffix text + icon rows |
| `stdCollapsiblePanel(label, fb => ..., meta?)` | Grouped inputs (Format, Behaviour, Validations) |
| `addSettingsInput({ inputType, propertyName, ... })` | Single input |
| `addSettingsInputRow({ inputs: [...], visibleJs? })` | Row of inputs |

Events tab: `stdEventHandlers(events, valueType)` — `events` is one of the constants below,
`valueType` a `DataTypes` value.

Appearance tab: `stdAppearancePanels(panels, removeStyleRouter)` with panels from
`'font' | 'dimensions' | 'border' | 'background' | 'shadow' | 'marginPadding' | 'customStyle'`.
Individual panels for a custom order or a nested set: `stdFontPanel`, `stdDimensionsPanel`,
`stdBorderPanel`, `stdBackgroundPanel`, `stdShadowPanel`, `stdMarginPaddingPanel`,
`stdCustomStylePanel` — each accepts a property name (`'handleStyles.border'`); `stdCustomStylePanel`
defaults to `'style'`.

## Style builders

`createStyles` from `@/styles`; builders from `designer-components/_common/styles/utils.ts`. Each emits
CSS only for set values.

| Builder | Input |
| --- | --- |
| `borderStyles(model.border, important?)` | also `borderLinesStyles`, `borderRadiusStyles` |
| `backgroundStyles(model.background)` | |
| `shadowStyles(model.shadow, propertyName?, important?)` | |
| `paddingStyles(model.stylingBoxJson)` / `marginStyles(...)` | parsed `StyleBoxValue`, not `stylingBox` |
| `dimensionsStyles(model.dimensions)` | |
| `fontStyles(model.font, model.styleCss?)` | merges the Custom style's text half property by property |
| `popupAppearanceStyles(model)` | background + border for a popup; no shadow by design |
| `cssPropertiesToString(style)` | `CSSProperties` → CSS declarations (kebab-case, `px` only where units apply) |
| `splitBackgroundProperties(style)` | → `{ background, rest }` (all `background*` keys) |
| `splitTextProperties(style)` | → `{ text, box }` |

Combine a stable class with the generated one: `cx('sha-xxx', css\`...\`)`.

## Events

`designer-components/_common/events.ts`:

| Settings form | Runtime |
| --- | --- |
| `ALL_INPUT_EVENTS` | `ALL_INPUT_EVENTS_WITHOUT_CHANGE` |
| `ALL_INPUT_EVENTS_WITHOUT_DOUBLE_CLICK` | `ALL_INPUT_EVENTS_WITHOUT_CHANGE_AND_DOUBLE_CLICK` |
| `FILE_EVENTS` | `FILE_EVENTS_WITHOUT_CHANGE` |

`getComponentEvents<TValue>(model, events, ctx, value, valueType)` returns antd handlers (all but
`onChange`) calling `ctx.handleEvent`. Custom handler props are `<event>Custom`.

## Migration helpers

`designer-components/_common-migrations/`:

| Helper | File | Notes |
| --- | --- | --- |
| `migratePropertyName`, `migrateCustomFunctions` | `migrateSettings.ts` | early legacy |
| `migrateVisibility` | `migrateVisibility.ts` | legacy `visibility` → `hidden` |
| `migrateReadOnly(prev, defaultValue?)` | `migrateSettings.ts` | `readOnly`/`disabled` → `editMode` |
| `migrateFormApi.eventsAndProperties(prev)` | `migrateFormApi1.ts` | |
| `migrateHiddenToVisible(prev)` | `migrateSettings.ts` | rename; unguarded |
| `migrateStylingBoxToJson(prev)` | `migrateSettings.ts` | `stylingBox` → `stylingBoxJson` per device; unguarded |
| `migratePermissionsToVisiblePermissions(prev)` | `migratePermissionsToVisiblePermissions.ts` | rename; unguarded |
| `migratePrevStyles(prev, defaults?)` | `migrateStyles.ts` | whole model, all three devices; guard with `isNew` |
| `migrateStyles(prev, defaults?, screen)` | `migrateStyles.ts` | one device's `IStyleValue`; guard with `isNew` |

## Component API

`componentsApi/componentApi.ts`:

- `CommonComponentApi` — `componentName`, `context`, `propertyName`, `style`, `visible`, `interactionMode`
- `InputComponentApi<T>` — adds `required`, `focus()`, `isValid()`, `getErrors()`, `reset()`, `value: T`
- `InteractionMode = 'editable' | 'readOnly' | 'disabled' | 'inherited' | boolean`

Register with `useComponentApi<TApi>({ model, typeName, properties?, api?, level?, typeDefinition? }, deps?)`
from `@/providers/componentApi/hooks`. `properties` entries are `{ name, getter, setter }`; setters call
`apiContext?.updateApiModel({...})`.

## Component definition members

Type: `ComponentDefinition<'<type>', IProps, ICalculated?>` (`interfaces/formDesigner.ts`).

| Member | Notes |
| --- | --- |
| `type`, `name`, `icon` | required |
| `isInput`, `isOutput`, `canBeJsSetting` | |
| `allowInherit: true` | temporary flag on standard components |
| `styleGroup` | `'inputs' \| 'common' \| 'common-containers' \| 'buttons'` — theme editor grouping |
| `showInThemeEditor` | default `true` |
| `previewConfiguration` | a model rendered as the theme editor preview |
| `preserveDimensionsInDesigner`, `dataTypeSupported` | |
| `Factory`, `settingsFormMarkup: getSettings`, `getDefaultStyles` | |
| `linkToModelMetadata(model, metadata)` | fill only unconfigured properties |
| `initModel`, `calculateModel`, `validateSettings`, `migrator` | optional |

## Null/blank helpers

`@/utils/nullables`: `isNullOrWhiteSpace`, `isNotNullOrWhiteSpace` (string type guards), `isDefined`
(non-strings).
