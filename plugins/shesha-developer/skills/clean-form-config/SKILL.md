---
name: clean-form-config
description: Analyzes a Shesha form configuration JSON and removes dead/obsolete component and formSettings properties (checked against the shared component registry), flags runtime-type mismatches (e.g. a boolean prop carrying the string "true", a numeric prop carrying "42") using the registry's per-prop type metadata, strips console.log calls from JS code strings, validates the shape of dropdown values items, detects scripts referencing component labels instead of propertyNames, runs layout validations (container dimension overflow, labelCol+wrapperCol span checks, device-specific style path conflicts), validates JavaScript syntax of embedded code strings, auto-fixes API calls missing try-catch by wrapping the function body in try/catch, and auto-fixes API calls in async-context properties that are missing async/await by adding the async keyword and awaiting calls. Falls back to manual review when function structure is ambiguous. Also detects API calls using .then() chaining and flags them for conversion to async/await + try-catch. Use when a form has been migrated, components have been refactored, or you want to clean up stale properties and debug statements.
---

# Clean Form Configuration

Identify and remove **dead properties** (component and `formSettings`) and **console.log debug statements** from a Shesha form configuration, flag **runtime-type mismatches** against the registry's per-prop type metadata, plus a set of narrower structural/script validations (dropdown values shape, layout, script syntax, try-catch/async coverage).

---

## Step 1: Load the component registry

Read the shared registry from the sibling `shesha-form-edit` skill (relative to this skill's own root — the same cross-skill path `shesha-design-system`'s test suite already reads):

```
plugins/shesha-developer/skills/shesha-form-edit/assets/registry/registry-0.45.1.json
```

i.e. `../shesha-form-edit/assets/registry/registry-0.45.1.json` from `SKILL_ROOT`. This is the same generated-from-framework-source registry `shesha-form-edit` uses (116 component types); it replaced this skill's own hand-maintained per-type index copy, which carried only 65 of those types and materially wrong prop counts (e.g. ~15 for `container` against a real 99). See Step 3 of [analysis.md](analysis.md) for what the registry does and does not cover, and proceed directly to Step 2.

> **Note for skill maintainers:** the registry is regenerated from `shesha-form-edit/scripts/gen-registry.mjs` (see that skill's [component-registry.md](../shesha-form-edit/references/component-registry.md)) — never hand-edit it here or duplicate it into this skill.

---

## Step 2: Load the form config

Choose one of:

**Option A — Fetch from API**: Follow [api.md](api.md) to resolve the base URL, authenticate, and retrieve the form by module + name.

**Option B — Local file**: Ask the user for the file path, then use `Read` to load it.

In both cases normalise to `{ components, formSettings }` as described in the Normalisation section of [analysis.md](analysis.md) before continuing.

---

## Step 3–8: Analyse and clean

Follow [analysis.md](analysis.md) for:

- **Step 3** — Load and interpret the component registry (`assets/registry/registry-0.45.1.json` in the sibling `shesha-form-edit` skill), including its per-prop `propTypes` metadata and its top-level `formSettings` entry.
- **Step 4** — Walk the component tree; identify dead properties and unknown types. Also identifies `formSettings` dead properties (restored — top-level keys only, against `registry.formSettings.props`).
- **Step 4b** — Scan all string values for `console.log` calls.
- **Step 4c** — Runtime-type mismatch detection (restored) — using the registry's `propTypes` map, flags a `boolean`-typed prop carrying a non-boolean value (e.g. the string `"true"`) or a `number`-typed prop carrying a non-numeric value (e.g. the string `"42"`), for both components and `formSettings`. Auto-fixable when the value is an unambiguous quoted-primitive.
- **Step 4d / 4e / 4f** — validate dropdown `values` item shapes; run layout checks (overflow, span, device-style path); scan scripts for label used instead of propertyName.
- **Step 4g** — Validate JavaScript syntax of all embedded code strings; flag broken scripts as `[CRITICAL]`.
- **Step 4h** — Detect API calls missing try-catch; auto-fix by wrapping the function body in try/catch where the structure is unambiguous; fall back to `[MANUAL REVIEW]` for complex scripts.
- **Step 4i** — Detect API calls in async-context properties (onFinish, onSubmit, getData, etc.) missing async/await; auto-fix by adding `async` to the function signature and `await` before the call; fall back to `[MANUAL REVIEW]` for ambiguous structures. Also detects `await` used outside an `async` function (Scenario A) and auto-fixes it.
- **Step 4j** — Detect API calls using `.then()` chaining; flag as `[MANUAL REVIEW]` with a recommendation to convert to async/await + try-catch.
- **Step 5 / 5b / 5c / 5d / 5e / 5f / 5g / 5h / 5i / 5j** — Present findings (dead props including `formSettings`, console.log, runtime-type mismatches, values shape issues, layout issues, label references, script syntax errors, missing try-catch, missing async/promise, .then() chaining).
- **Step 6** — Single confirmation prompt.
- **Step 7** — Apply all cleanups and output cleaned JSON.
- **Step 8** — Summary with size reduction.

Layout checks are defined in [layout-checks.md](layout-checks.md) — new checks can be appended there as L3, L4, etc.

---

## Step 9: Push cleaned config back to the API (optional)

After producing the cleaned JSON, ask the user:

> The form has been cleaned. Would you like to push the updated config back to the Shesha backend via the API? (yes / no)

**If no** → skip this step, work is done.

**If yes** → follow Section 5 of [api.md](api.md) to call `ImportJson`.

- If the form was loaded via the API (Step 2 Option A), `FORM_ID` and `ACCESS_TOKEN` are already available — use them directly.
- If the form was loaded from a local file (Step 2 Option B), or `FORM_ID` / `ACCESS_TOKEN` are not available, first follow [api.md](api.md) sections 1–2 to resolve the base URL and authenticate, then ask the user:
  > Please enter the form's `itemId` (the UUID of the form configuration record):

---

## Notes

- **Conservative approach**: ambiguous properties go to manual review, not auto-clean.
- **Structural keys are never removed**: `id`, `type`, `parentId`, `components`, and (for `formSettings`) `version`.
- **Dead-property detection is not deep-cleaned**: only top-level component/`formSettings` keys are checked for existence (Step 4).
- **Runtime-type mismatch detection (Step 4c) IS restored** and does resolve nested dotted paths (e.g. `validate.required`, `labelCol.span`) directly, because it targets one known path from `propTypes` rather than blindly walking every key — see Step 4c in [analysis.md](analysis.md). It is scoped to the registry's `boolean`/`number` categories only; `string`/`enum`/`array`/`object`-typed props are still not type-checked.
- **`IPropertySetting` wrappers** (`{ _mode, _value, _code }`) are valid for any property; type-checking uses `_value` when `_mode === 'value'` and skips `_mode === 'code'` entirely.
- To regenerate the registry after a shesha-reactjs upgrade, follow the `shesha-form-edit` skill's own regeneration process ([component-registry.md](../shesha-form-edit/references/component-registry.md)) — do not add a local index here.
