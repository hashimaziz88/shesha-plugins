# Component registry

`assets/registry/registry-0.45.1.json` — generated from Shesha framework source,
not hand-maintained. It is the authority for which component types exist, which
props each accepts, each type's current `version`, and (per prop, where
resolvable) a coarse runtime-value type via `propTypes`. It also carries a
top-level `formSettings` entry for form-level settings (not a toolbox
component, but extracted the same way from its own settings-form markup).

## Contents
- Looking a component up
- Per-prop types (`propTypes`)
- `formSettings`
- What `authorable` means
- Regenerating
- Why this replaced the old hand-maintained index

## Looking a component up

```bash
# does this type exist, and what version should I stamp?
node -e "const r=require('./assets/registry/registry-0.45.1.json');const c=r.components['textField'];console.log(c.version, c.authorable, c.props.length)"

# is this prop valid on this type?
node -e "const r=require('./assets/registry/registry-0.45.1.json');console.log(r.components['container'].props.includes('desktop.dimensions.width'))"
```

## Per-prop types (`propTypes`)

Alongside `props` (a flat list of valid property-path strings — existence
only), each component carries `propTypes`: an **additive, partial** map of
`propertyPath -> { type, values? }`, populated only where the settings-form
control editing that prop declares an unambiguous widget (a `settingsInput`'s
`inputType`, or a `settingsInputRow` item's own `type`). `type` is one of
`boolean`, `number`, `string`, `enum` (with `values` when statically known),
`array`, or `object`. A prop absent from `propTypes` was either not
classifiable or only ever surfaced via `initModel`/migrator replay with no
settings-form leaf at all — treat it as unknown, not as "any value goes".

```bash
# what runtime type does this prop expect?
node -e "const r=require('./assets/registry/registry-0.45.1.json');console.log(r.components['checkbox'].propTypes['validate.required'])"
# { type: 'boolean' }
```

`clean-form-config`'s Step 4c is the primary consumer — see that skill's
`analysis.md` for the full runtime-type-mismatch procedure.

## `formSettings`

```json
{
  "formSettings": {
    "props": ["layout", "colon", "labelCol.span", "wrapperCol.span", "access", "permissions", "…"],
    "propTypes": { "colon": { "type": "boolean" }, "labelCol.span": { "type": "number" } }
  }
}
```

Extracted from `src/components/formDesigner/formSettings.ts` — the same
settings-form markup the framework's own "Form Settings" dialog feeds into
`ConfigurableForm`. Same `props`/`propTypes` shape as a component entry, no
component-only fields (`version`, `isInput`, …).

## What `authorable` means

`authorable: false` means **recognise it, never emit it**. Non-authorable types stay
in the registry so validation does not reject existing production forms that contain
them. `authorableReason` says why:

| reason | meaning |
|---|---|
| `hidden` | `isHidden` in the framework toolbox — e.g. `datatableContext` ("Data Context (Legacy)") |
| `legacy` | framework group `Legacy` — e.g. `paragraph`, `title`, `list` |
| `dev` | framework group `Dev` — settings-form internals such as `settingsInput`, `searchableTabs` |
| `no-settings-form` | ships no `settingsFormMarkup`, so its props cannot be validated |

Use `dataContext` (authorable) for table/list data wrapping. `datatableContext` is
the legacy predecessor and is hidden in the framework toolbox.

`version: null` means the component has no migrator; do not invent a version for it.

## Regenerating

```bash
node scripts/gen-registry.mjs --framework <path-to-shesha-framework> --version 0.45.1
npm test
```

Regenerate deliberately — on a framework version bump, never as a side effect.
The acceptance test (`tests/registry-acceptance.test.mjs`) fails if the component
count drops or scaffolding props leak back in. `registry.meta.json` records the
source branch and commit the registry was built from.

## Why this replaced the old hand-maintained index

The hand-maintained index carried 65 of 116 types, one type that does not exist
in the framework (`addressInput`), and ~15 props for `container` against a real 71.
Versions are per-component and unguessable (`tabs` 4, `container` 7, `dropdown` 11,
`datatable` 29), and a stale version silently drops a component's entire style block.
