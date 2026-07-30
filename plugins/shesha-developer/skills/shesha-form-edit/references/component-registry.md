# Component registry

`assets/registry/registry-0.45.1.json` — generated from Shesha framework source,
not hand-maintained. It is the authority for which component types exist, which
props each accepts, and each type's current `version`.

## Contents
- Looking a component up
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
