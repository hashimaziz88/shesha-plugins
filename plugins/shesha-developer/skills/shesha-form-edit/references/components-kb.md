# Component knowledge base — generated from the 0.45 renderer source

`assets/components-kb/` is **generated from the Shesha renderer source**
(`shesha-reactjs` branch `releases/0.45` — the pinned commit and source dir are
recorded in `_meta.json`). It covers **115 component types** and is the
authority for type strings, versions, and settings fields: when any hand table
or seed disagrees with the KB, the KB wins. Version drift caveat: [R-049].

## Files

- `<type>.json` — one per toolbox component:
  - `type` — exact toolbox type string (case-sensitive: `datalist`, not `dataList`).
  - `version` — CURRENT settings version [R-003]. **`version: null` = no
    migrator — OMIT the `version` prop; stamping one can be wrong.**
  - `initModel` — what the designer stamps on a fresh drop. Prefer these over
    props copied from old forms.
  - `settingsFields` / `settingsProps` — every designer-configurable property
    (`path`, `label`, `editorType`, `defaultValue`, `group`). Author only
    fields that exist here. **Style paths are NESTED** (`font.size`,
    `dimensions.width`, `background.type`, `shadow.offsetX`) and are authored
    through `desktop.`/`tablet.`/`mobile.` breakpoint blocks [R-030].
  - `slots` — `hostsChildren`, `customContainerNames` (`['tabs']`,
    `['columns']`), `detectedSlotKeys`.
  - `settingsForm.parseQuality` — `"partial"` means editorType/defaults
    unknown; verify manually (`_gaps.json` lists these).
- `_index.json` — quick lookup type → `{ version, isInput, settingsFieldCount, … }`.
- `_enums.json` — dropdown enum values extracted from the renderer source
  (consumed by the gym and the schema generator).
- `_meta.json` — pinned branch/commit/date. `_gaps.json` — partial extractions.

## Regeneration (new 0.45.x release)

```
node scripts/generate-component-kb.js <path to that release's designer-components> assets/components-kb
node scripts/extract-enums.js --source <same designer-components dir>
node scripts/generate-schema.js          # refresh the validate-schema.js input
```

Deterministic, no deps — `git diff assets/components-kb/` shows exactly what a
release changed. Full ground-truth rerun (gym + capability matrix):
[gym.md](gym.md).
