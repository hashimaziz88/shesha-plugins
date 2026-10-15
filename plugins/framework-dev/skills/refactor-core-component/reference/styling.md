# Styling

## Contents

- [styles.ts and className](#stylests-and-classname)
- [Default styles](#default-styles)
- [Background lost on hover, focus, validation](#background-lost-on-hover-focus-validation)
- [antd affix wrappers](#antd-affix-wrappers)
- [Repeated child elements](#repeated-child-elements)
- [Nested style sets](#nested-style-sets)
- [Custom style: box and text halves](#custom-style-box-and-text-halves)
- [Popups](#popups)
- [Read-only](#read-only)
- [Specificity traps](#specificity-traps)

## styles.ts and className

Styles go in `styles.ts` and reach the component **only through `className`**. Don't apply styles
inline on the component (allowed only in special cases), and don't compute a complete style object and
stamp it onto the element — that is what `useFormComponentStyles` did and what the refactor removes.

```ts
export const useStyles = createStyles(({ css, cx }, model: IXxxComponentProps) => {
  const xxx = cx('sha-xxx', css`
    ${borderStyles(model.border)}
    ${backgroundStyles(model.background)}
    ${shadowStyles(model.shadow)}
    ${paddingStyles(model.stylingBoxJson)}
    ${dimensionsStyles(model.dimensions)}
    .ant-xxx-input { ${fontStyles(model.font, model.styleCss)} }
  `);
  return { xxx };
});
```

```tsx
const { styles } = useStyles(model);
<Xxx className={styles.xxx} {...(isDefined(model.styleCss) ? { style: model.styleCss } : {})} />
```

The builders in `_common/styles/utils.ts` emit CSS only for values actually set, so everything else
cascades from a higher level. `model.styleCss` (the evaluated Custom style, a `CSSProperties`) is the
one inline style that stays.

Padding/margin read **`model.stylingBoxJson`** (parsed `StyleBoxValue`), not `model.stylingBox`
(a JSON string). Old models are converted by `migrateStylingBoxToJson` (migrations.md).

## Default styles

`getDefaultStyles: () => defaultStyles()` with `defaultStyles(): IStyleValue` in `utils.ts`. Make it
**complete** — font, border incl. radius, background, dimensions, shadow, `stylingBoxJson`, plus any
nested style set. It is load-bearing in three places:

- render-time fallback for every slot the model leaves unset (components ship empty properties);
- the defaults argument of the freeze migration — a missing group can't be frozen, so old forms drift;
- the inherited baseline shown by the theme editor.

**Incomplete defaults kill inheritance on individual inputs.** The inheritance popover only renders
when the default model contains that property. With only `background: { type, color }`, the size,
position, repeat, url and gradient inputs show no inheritance state. Copy the full shape from `card` /
`drawer`:

```ts
background: {
  type: 'color', color: '#fff',
  repeat: 'no-repeat', size: 'cover', position: 'center',
  gradient: { direction: 'to right', colors: {} },
  url: '',
},
```

Adding a slot changes rendering for existing forms that leave it unset — agree it rather than slipping
it into a refactor. A deliberately empty value is fine where it means something (switch leaves the
"on" track background `''` so antd's colour shows).

## Background lost on hover, focus, validation

antd's `genBaseOutlinedStyle` repaints `hoverBg` on `:hover`, `activeBg` on `:focus`/`:focus-within`,
and uses the `background` *shorthand* on error/warning (wiping images/gradients). Re-assert the
configured appearance in every state:

```ts
const configuredAppearance = `
  ${borderStyles(model.border)}
  ${backgroundStyles(model.background)}
  ${shadowStyles(model.shadow)}
`;
const statefulAppearance = `
  &&&&:hover, &&&&:focus, &&&&:focus-within,
  &&&&[class*="-status-error"], &&&&[class*="-status-warning"] {
    ${configuredAppearance}
  }
`;
```

Apply it in every render mode, including the wrapped form below.

## antd affix wrappers

With `allowClear`, a prefix/suffix, or form-injected `hasFeedback`, antd wraps the input
(`hasPrefixSuffix = !!(prefix || suffix || allowClear)`) and **the wrapper owns the visible border and
background**. Style the wrapper (antd's `classNames.root` lands on it) and neutralise the inner element,
including margin and padding so spacing isn't doubled:

```ts
&[class*="-textarea-affix-wrapper"] {
  ${configuredAppearance}
  textarea.ant-input { background: transparent; border: none; box-shadow: none; margin: 0; padding: 0; }
}
```

- `classNames.root` lands on the input itself when there is no wrapper — scope every wrapper rule
  inside the wrapper's class or the reset blanks a plain input.
- The reset must out-specify the inner element's state rules: if those use `&&&&`, use
  `&&&& textarea.ant-input` and cover `:hover`, `:focus`, `:focus-within`.
- Don't predict the DOM shape in JS — `hasFeedback` isn't knowable in the component. Let CSS decide.

## Repeated child elements

For option components (checkbox group, radio group, tags), appearance belongs on **each child**, not
the wrapper. Put the class on the group root and scope builders to a descendant selector:

```ts
.${prefixCls}-checkbox .${prefixCls}-checkbox-inner { ${borderStyles(...)} ${backgroundStyles(...)} ${dimensionsStyles(...)} }
.${prefixCls}-checkbox-checked .${prefixCls}-checkbox-inner { ${backgroundStyles(...)} ${borderStyles(...)} }
```

The checked rule repeats background/border so antd's theme doesn't override the checked state. Keep
only layout (direction/gap) inline on the group container.

## Nested style sets

Components with a second named set (switch `handleStyles`, checkboxGroup `checkbox.*`, radio `radio.*`)
have four obligations — miss one and part of the Appearance tab silently does nothing:

1. **Type it** (`INestedStyleValue<'checkbox'>` or `handleStyles?: IStyleValue`) and **include it in
   defaults**: `getDefaultStyles: () => ({ ...defaultStyles(), handleStyles: defaultHandleStyles() })`.
2. **Every nested panel gets an explicit `<prefix>.<prop>`**: `.stdDimensionsPanel('handleStyles.dimensions')`,
   `.stdBorderPanel(removeStyleRouter !== true, 'handleStyles.border')`. The trap is
   `stdCustomStylePanel()` — its default property is `'style'`, so a bare call binds to the root Custom
   style and the two editors overwrite each other. Use `.stdCustomStylePanel('checkbox.style')`.
3. **Evaluate the nested Custom style in the Factory.** The framework only executes the root
   `model.style` into `model.styleCss`; a nested script is never run for you (symptom: it saves but
   never renders). Keep `styles.ts` free of script execution:

   ```ts
   const nestedStyleJson = useActualContextExecution<CSSProperties>(model.checkbox?.style, undefined, {});
   const { styles } = useStyles({ ...model, nestedStyleJson });
   ```

   Emit it **last** in the scoped rule. `CSSProperties` isn't assignable to emotion's `CSSObject`:
   cast `as CSSObject` (precedent: `switch/styles.ts`) or use `cssPropertiesToString`.
4. **Seed the nested set under device models in migrations, never at the root** — the renderer spreads
   defaults → `desktop` → device over the model and discards a root-level set.

**Honour the set's own conventions.** Checkbox/radio indicators fill only when checked, so their
Background panel is scoped to `.ant-checkbox-checked` / `.ant-radio-checked`. Split the nested Custom
style the same way:

```ts
const customStyle = splitBackgroundProperties(model.nestedStyleJson);
// customStyle.rest       → base indicator rule
// customStyle.background → checked rule, after the panel background
```

## Custom style: box and text halves

`model.styleCss` describes both box and text, which belong on different elements.

- **Text half:** pass the whole Custom style to `fontStyles(model.font, model.styleCss)`. It extracts
  the text properties and overrides property by property (a Custom style setting only `color` keeps
  the configured size and family). Merging inside the builder keeps precedence independent of rule
  order.
- **Box half:** use `splitTextProperties` only where the box lands somewhere the text doesn't (e.g. a
  popup panel). Don't also destructure `text` — `fontStyles` derives it.

**An inline Custom style on the root does not reach the text.** These components re-assert
`fontStyles` on inner text elements, and a class rule on a child beats an inherited inline style. Put
the merged `fontStyles` on the element that holds the text:

| Component | Elements |
| --- | --- |
| autocomplete | `-select-content`, `-select-input`, `-select-placeholder`, `-select-selection-item` |
| dropdown | `-select-selector`, `-select-selection-search-input`, `-select-selection-item`, `-select-selection-placeholder` |
| dateField | `.ant-picker-input > input` |
| address | `.ant-input-affix-wrapper` and its `.ant-input` |

## Popups

**Popup styling is not part of the component standard.** It was a proposal, and reviewers pushed back
(Yulia Gradova, Alex Stephens, Sept 2026): the entityPicker modal must **not** take the input's
styles. The existing popups on dropdown, autocomplete, dateField and address keep theirs. Don't add
popup styling to another component without agreeing it with Alex Stephens first.

When maintaining one of the existing popups:

- The popup is portalled to `body`; a descendant selector can't reach it. Pass a class through the
  control's prop: `Select` → `popupClassName`; `DatePicker`/`RangePicker` →
  `classNames={{ popup: { root } }}`; address renders its own list, so pass model values as props.
- Build it with **`popupAppearanceStyles(model)`**, not the input's `configuredAppearance`.
  **Never apply the configured shadow to a popup** — a configured offset paints a band over the field
  above it; popups keep the theme's elevation. `popupAppearanceStyles` omits shadow by type.
- **Padding goes on the popup root**, not per option (it multiplies across rows).
- **Restate the font on the options**, including `-option-active` / `-option-selected`. Keep the Font
  at the control's specificity and give the Custom style its own `&&&` rule so it beats antd:

  ```ts
  .${prefixCls}-select-item { ${fontStyles(model.font, model.styleCss)} }
  &&& .${prefixCls}-select-item { ${fontStyles(model.font, model.styleCss)} }
  ```
- **Clear inner wrapper backgrounds** (`.rc-virtual-list-holder`, `.ant-select-dropdown`,
  `.ant-picker-panel` and header) — `background: transparent`.
- **A calendar is a grid**: strip `align` from both sources —
  `fontStyles({ ...model.font, align: undefined }, { ...model.styleCss, textAlign: undefined })`; don't
  recolour disabled/out-of-month cells; no `dimensionsStyles`; put panel styles on
  `.ant-picker-panel-container`, not the popup root.
- **Address** uses a themed fallback (`token.colorBgElevated`), not `white`, and a **descendant**
  selector for its list (the affix wrapper nests the input, so `>` matches nothing).

## Read-only

Read-only renders through `ReadOnlyDisplayFormItem` — style the text, not a box. The class already
gates the box half behind `enableFullStyle`; filter the inline `style` the same way, keeping
`width`/`height` (the container sizes from them).

- **Every branch passes `style`** — a read-only branch with `styleValue` but no `style` loses the
  Custom style.
- **All modes share one read-only branch** (autocomplete's URL and Entity modes both use the same
  `if (readOnly)`); a per-mode branch needs identical props on each.

## Specificity traps

- **`&&&&` is a two-way fight.** If a parent resets a child whose own class uses `&&&&`, the child
  wins. Count both sides.
- **Fixing specificity in one place can break another.** Lowering a rule that carries two settings
  with different precedence needs (Font vs Custom style) demotes one of them — split the rule.
- **A style block safe on an in-flow element can be harmful on an overlay.** Re-check each property
  when sharing a block with a popup — that's why `popupAppearanceStyles` exists.
