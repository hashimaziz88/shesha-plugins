# Analysis Steps

Steps 2–8 of the `clean-form-config` skill.

---

## Normalisation

Load the file provided by the user with the `Read` tool. Extract `{ components, formSettings }` from the various input shapes:

| Input shape | How to extract |
|---|---|
| `{ "Markup": "...", "Name": "..." }` (exported file) | `JSON.parse(obj.Markup)` |
| `{ "result": { "markup": "..." } }` (ABP API response) | `JSON.parse(obj.result.markup)` |
| `{ "markup": "..." }` (raw DTO) | `JSON.parse(obj.markup)` |
| `{ "components": [...], "formSettings": {} }` | use directly |

Verify you have an object with a `components` array before continuing.

---

## Step 3: Load the component registry

The registry lives in the sibling `shesha-form-edit` skill, one directory up from this skill's own root:

```
../shesha-form-edit/assets/registry/registry-0.45.1.json
```

**Loading procedure:**

1. Read that one file. There is nothing else to load and nothing to cache-merge — each component type's entry already carries its full, flattened prop set (component-specific props plus the props every component gets, such as `customStyle`, `hidden`, `onChangeCustom`).
2. For each unique component type in the form, look up `registry.components[type]`.

**File structure:**

```json
{
  "frameworkVersion": "0.45.1",
  "components": {
    "textField": {
      "type": "textField",
      "name": "Text field",
      "group": null,
      "version": 6,
      "isInput": true,
      "isOutput": true,
      "isHidden": false,
      "authorable": true,
      "authorableReason": null,
      "props": ["background", "background.color", "…", "hidden", "onChangeCustom", "…"],
      "propTypes": {
        "hidden": { "type": "boolean" },
        "labelCol.span": { "type": "number" },
        "layout": { "type": "enum", "values": ["horizontal", "vertical"] }
      }
    }
  },
  "formSettings": {
    "props": ["layout", "colon", "labelCol.span", "wrapperCol.span", "access", "permissions", "…"],
    "propTypes": {
      "colon": { "type": "boolean" },
      "labelCol.span": { "type": "number" },
      "access": { "type": "enum", "values": [3, 4, 5] }
    }
  }
}
```

`props` is a **flat list of valid property-path strings** — existence only, as before. `propTypes` is an **additive, partial** map alongside it: `propertyPath -> { type, values? }`, populated only for props whose settings-form control declares an unambiguous widget. It comes from the exact same settings-form leaf that already yields `propertyName` — a `settingsInput`'s `inputType` (e.g. `inputType: 'switch'`), or a `settingsInputRow` item's own `type` (e.g. `type: 'numberField'`) — so it is derived from framework source, not hand-maintained. `type` is one of:

| `type` | meaning | source control types |
|---|---|---|
| `boolean` | a true/false toggle | `switch`, `checkbox` |
| `number` | a numeric field | `numberField`, `slider` |
| `string` | free text / code / colour | `textField`, `textArea`, `codeEditor`, `colorPicker`, `Password`, `link`, `text` |
| `enum` | one of a fixed set, with `values` when the set is statically known | `dropdown`, `customDropdown`, `radio`, `editModeSelector` |
| `array` | a list-shaped value | `permissions`, `multiColorPicker`, `editableTagGroup`, `labelValueEditor`, `filtersList`, `columnsList` |
| `object` | a compound/nested editor, not a scalar leaf | everything else classifiable (autocompletes, `queryBuilder`, `styleBox`, `iconPicker`, `fileUpload`, …) |

A prop with **no** `propTypes` entry means the extractor could not resolve a control type for it (e.g. it only surfaced via `initModel`/migrator replay, with no settings-form leaf at all) — treat it exactly like before: ambiguous, skip type-checking.

There is now also a top-level **`registry.formSettings`** entry — form-level settings (`layout`, `colon`, `labelCol`/`wrapperCol`, `dataLoaderType`, `access`, `permissions`, lifecycle scripts, …) are edited through their own settings-form markup (`src/components/formDesigner/formSettings.ts`, fed into the same `ConfigurableForm` the Form Settings dialog uses), extracted exactly like a component's settings form. It carries the same `props`/`propTypes` shape as a component entry, just without the component-only fields (`version`, `isInput`, …).

For each component being analyzed, build:

```
allowedKeys = new Set(registry.components[component.type]?.props ?? [])
propTypes   = registry.components[component.type]?.propTypes ?? {}
```

If `component.type` is not a key in `registry.components` at all, treat it as **`[TYPE UNKNOWN — manual review]`** per Step 4 — do not attempt a base-only fallback check (there is no separate "base" prop set to fall back to; every known type's `props` array is already fully flattened).

For `formSettings`, build the equivalent from `registry.formSettings.props` / `registry.formSettings.propTypes` — see Step 4 below.

**Capability change from the old hand-maintained per-type index** (retired because its data no longer existed anywhere, and duplicating it back into this skill would have recreated exactly the problem the registry migration fixed — since resolved by extending the registry generator instead, see `shesha-form-edit`'s [component-registry.md](../shesha-form-edit/references/component-registry.md)):
- **Existence-based dead-property / unknown-type detection for components is fully preserved** — this is the core of Step 4 and is unaffected; it is now checked against the accurate 116-type registry instead of the old 65-type hand index.
- **Component-level runtime-type-mismatch detection (Step 4c) is restored** — using `propTypes`, scoped to the `boolean` and `number` categories only (the categories a quoted-string / wrong-primitive mistake is unambiguous for). `string`/`enum`/`array`/`object` props are still not type-checked — too many legitimate shapes (templates, code-bound options, JSON blobs) to check safely without false positives.
- **`formSettings` dead-property detection is restored** — using `registry.formSettings.props`, walking only `formSettings`'s own top-level keys (mirroring how component-level Step 4 already only checks top-level keys). `formSettings` runtime-type-mismatch detection is restored too, using `registry.formSettings.propTypes`, on the same `boolean`/`number`-only basis as components.
- **What is still genuinely unavailable, and therefore still not checked**: no `options`/enum-membership validation beyond the static `values` a `dropdown`/`radio` control happens to declare (many enums are computed via a script and carry no static list), no `JsReturnType`/`async`/`context`/`keyCase` script descriptor. These were never recovered because the settings-form leaf carries no equivalent information — inventing them would be exactly the hand-index mistake this skill exists to avoid repeating.
- **The Step 4g keyCase-driven style-script check still names its three known style-returning props directly** (`customStyle`, `style`, `wrapperStyle`) instead of reading `keyCase` off a prop descriptor — this is a fixed, well-known set, not a per-type index, so hardcoding it does not reintroduce the hand-index problem.

---

## Step 4: Walk the component tree and identify dead properties

The `components` array is a **nested tree** — each component may have a child `components` array. Walk it recursively.

For each component:

1. Get `component.type`.
2. Build `allowedKeys` as described in Step 3.
3. For each key on the component object:
   - Skip keys starting with `_` or `shesha:`.
   - Skip the key `components`.
   - If the key is **not in `allowedKeys`** → dead property candidate.
4. If the type is **not in the registry at all** (unknown/custom type):
   - Tag the whole component as `[TYPE UNKNOWN — manual review]`.
   - Do **not** attempt key-level dead-property detection for it, and do **not** include it in the auto-clean list.

**`formSettings` dead-property detection (restored).** The registry carries a top-level `formSettings.props` list (see Step 3), extracted from the real form-level settings-form markup. Build `formSettingsAllowedKeys = new Set(registry.formSettings.props)` and walk **only the top-level keys** of the `formSettings` object (mirroring the component walk above — nested objects are not deep-cleaned here either):

1. Skip keys starting with `_` or `shesha:`.
2. Skip the structural `version` key (set by the framework's migration machinery, not by the settings form).
3. If the key is **not in `formSettingsAllowedKeys`** → dead property candidate, tagged `formSettings` rather than a component id/type.

Report and apply exactly like a component's dead properties (Steps 5/7/8), just grouped under the `formSettings` pseudo-row.

---

## Step 4b: Scan for console.log calls in string properties

Walk the **entire** parsed JSON object recursively (not just component top-level keys). For every `string` value encountered, check whether it contains `console.log`. This catches values nested in `IPropertySetting` wrappers (`{ _mode, _value, _code }`) and any other nested structure automatically.

Use this regex to find and remove console.log calls from each matching string:

```
/console\.log\s*\((?:[^)(]|\((?:[^)(]|\([^)(]*\))*\))*\)\s*;?\s*/g
```

Replace each match with `''`. After replacement, collapse excess blank lines: replace `/\n{3,}/g` with `\n\n`.

Track each removal:
- Which component it belongs to (look up the nearest ancestor component by `id`)
- Which property key the string was found in (e.g. `onChangeCustom`, or `customVisibility._code` for nested wrappers)
- How many `console.log` calls were removed from that string

---

## Step 4c: Runtime-type mismatch detection for known properties (restored)

The registry's `propTypes` map (see Step 3) gives each classifiable prop a coarse category (`boolean`, `number`, `string`, `enum`, `array`, `object`), sourced from the settings-form control that actually edits it. This step uses only the `boolean` and `number` categories — the two a value can be unambiguously wrong for (a quoted `"true"`/`"false"` where a real boolean belongs; a numeric-looking string like `"42"` where a real number belongs). The other categories (`string`, `enum`, `array`, `object`) are **not** checked — too many legitimate shapes (templates, code-bound options, JSON blobs) to check safely without false positives.

`propTypes` keys are **dotted paths**, and most of the boolean/number-classified ones are one or two levels deep (e.g. `hidden` is top-level, but `validate.required`, `labelCol.span`, `shadow.blurRadius` are nested inside an object at that top-level key). Unlike Step 4's dead-property walk — which stays top-level-only because blind existence-checking of arbitrary nested keys against a flat allow-list risks misreading a legitimate container key as a dead leaf — this step does a **targeted** lookup: it already knows the exact dotted path and its expected category from `propTypes`, so it can resolve that one path directly without walking or guessing at anything else.

Run this for both components (against `registry.components[type].propTypes`) and `formSettings` (against `registry.formSettings.propTypes`):

1. For each `path -> { type }` entry in `propTypes` where `type` is `boolean` or `number`:
   - Resolve `path` against the real component/`formSettings` object by walking its dot segments (`path.split('.')`), stopping (skip this entry) as soon as an intermediate segment is missing, `null`, or not an object — that means the value is simply absent, not a mismatch.
   - If the resolved value is an `IPropertySetting` wrapper (`{ _mode, _value, _code }`): use `_value` when `_mode === 'value'`; **skip entirely** when `_mode === 'code'` — a script's return type cannot be statically checked.
   - Skip if the resolved value is `null` or `undefined`.
2. **`type === 'boolean'`**: flag if the resolved value is not literally `true` or `false` — most commonly a quoted string `"true"`/`"false"`, but any other type also counts.
   - Classify `[AUTO-FIXABLE]` when the value is exactly the string `"true"` or `"false"` → fix is `value === 'true'`.
   - Otherwise `[MANUAL REVIEW]`.
3. **`type === 'number'`**: flag if the resolved value is not literally a JS `number` — most commonly a numeric-looking string like `"42"` or `"3.5"`.
   - Classify `[AUTO-FIXABLE]` when the value is a string that parses cleanly via `Number(value)` (i.e. `!Number.isNaN(Number(value)) && value.trim().length > 0`) → fix is `Number(value)`.
   - Otherwise `[MANUAL REVIEW]`.
4. If `component.type` is not in the registry at all (`[TYPE UNKNOWN]` per Step 4), skip type-checking for it entirely — there is no `propTypes` map to consult.

**Concrete lookup example** (from the sibling registry, Step 3's path):

```bash
node -e "const r=require('../shesha-form-edit/assets/registry/registry-0.45.1.json'); console.log(r.components.checkbox.propTypes['validate.required'])"
# { type: 'boolean' }
node -e "const r=require('../shesha-form-edit/assets/registry/registry-0.45.1.json'); console.log(r.formSettings.propTypes['colon'])"
# { type: 'boolean' }
node -e "const r=require('../shesha-form-edit/assets/registry/registry-0.45.1.json'); console.log(r.formSettings.propTypes['labelCol.span'])"
# { type: 'number' }
```

So a `checkbox` component with `"validate": { "required": "true" }` (string, not boolean) is an `[AUTO-FIXABLE]` finding at path `validate.required`, and a `formSettings` object with `"colon": "true"` is likewise `[AUTO-FIXABLE]` at path `colon`.

Report under Step 5c; apply under Step 7; summarise under Step 8.

---

## Step 4d: Validate `values` item shape for dropdown components

For every component where **`type === 'dropdown'`** and **`dataSourceType === 'values'`**:

1. Skip if `values` is absent, `null`, or not an array.
2. For each item in the array, check:
   - **Required keys present**: `label` (string), `value` (string).
   - **Known keys**: `label`, `value`, `color` (string), `icon` (string), `id` (string). Any other key is an **unknown key**.
   - **Type check**: `label` and `value` must be strings. `color` and `icon`, if present, must be strings.
3. Classify each issue:
   - Missing `label` or `value` → **[MANUAL REVIEW]**
   - Missing `color` → **[AUTO-FIXABLE]** — add `"color": ""`
   - Wrong type for `label`, `value`, `color`, or `icon` → **[MANUAL REVIEW]**
   - Unknown extra key on an item → **[MANUAL REVIEW]**
4. Report issues grouped by component under "Step 5d". Track auto-fixable vs manual.

---

## Step 4e: Run layout checks

Read [layout-checks.md](layout-checks.md) and run all checks (L1, L2, …) against the full component tree and `formSettings`. Collect results into two lists: **auto-fixable layout issues** and **manual-review layout issues**. Report under Steps 5e and 5f.

---

## Step 4f: Scan scripts for label used instead of propertyName

Build a lookup of every component that has **both** a non-empty `label` (string) **and** a non-empty `propertyName` (string) where `label !== propertyName`.

Walk all JS code strings in the form config (same strings scanned in Step 4b). For each label in the lookup, search the string for the label appearing in data-access patterns:

```
// bracket notation (works for labels with spaces)
(?:data|formData|initialValues|values|form)\s*(?:\?\.)?\s*\[\s*['"]LABEL['"]\s*\]

// dot notation (only relevant when label has no spaces)
(?:data|formData|initialValues|values|form)\s*(?:\?\.)?\s*\.LABEL\b
```

For each match, record:
- The component id and property key where the script lives
- The label string found
- The correct `propertyName` to use instead

These are **never auto-fixable** — script replacements could change logic. Report under Step 5f.

---

## Step 4g: Validate JavaScript syntax of code strings

**Scope:** Collect all JS code strings from the component tree:
- `IPropertySetting` objects where `_mode === 'code'` — use the `_code` string.
- Standalone string values that contain JS indicators: `function`, `=>`, `return `, `if(`, `var `, `let `, `const `.

For each code string, check for these syntax problems:

| Heuristic | How to detect |
|---|---|
| Unmatched braces/parens/brackets | Count opens vs closes for `{`, `[`, `(` — flag if the totals differ |
| Unclosed string literal | Count unescaped `'`, `"`, `` ` `` occurrences — flag if any count is odd |
| Template literal `${` without closing `}` | Count `${` vs `}` inside template literals — flag mismatch |
| `function` missing closing `)` or `{` | Check that each `function(` or `function name(` has a matching `)` followed by `{` |

These are heuristics — reason about the script content to identify the most likely issue. When a script is too long to analyze fully, check the first and last 300 characters for obvious unclosed constructs.

Severity: **`[CRITICAL]`** — invalid scripts throw runtime errors and break form functionality.
**Never auto-fixable** — repair requires developer intent.

Output format per finding:
```
[CRITICAL] Script syntax error
  Component: <id> (<type>)
  Property:  <key>
  Issue:     <description, e.g. "unmatched braces: 3 opens, 2 closes">
  Excerpt:   <first 120 chars of script>
```

**Additional check for style-returning scripts (`customStyle`, `style`, `wrapperStyle`):**

For any script property whose key is `customStyle`, `style`, or `wrapperStyle` (these three are the known style-returning, camelCase-keyed script props — the registry carries no `keyCase` descriptor to look this up dynamically), attempt to extract the returned object literal from the script string (look for `return {` or an arrow-function implicit `({`). For each key found in the object literal:

- Flag any key in kebab-case (contains `-`) as `[WARNING — use camelCase key]`
- Flag any value that is a bare number without units (e.g. `fontSize: 14` instead of `fontSize: '14px'`) as `[WARNING — value should be a quoted string]`

Severity: **`[WARNING]`** — the component will likely not style correctly at runtime.
**Never auto-fixable** — the correct unit/value requires developer intent.

Output format:
```
[WARNING] customStyle object rule violation
  Component: <id> (<type>)
  Property:  <key>
  Issue:     kebab-case key "font-size" — use camelCase "fontSize"
             bare number value for "opacity: 1" — use quoted string "opacity: '1'"
```

---

## Step 4h: Detect API calls missing try-catch

Walk all JS code strings (same set as Step 4g).

**API call patterns to match (regex):**
- `axios\s*\.\s*(get|post|put|delete|patch|request)\s*\(`
- `fetch\s*\(`
- `\b(getHttp|postHttp|putHttp|deleteHttp|patchHttp)\s*\(` (Shesha HTTP helpers)
- `http\s*\.\s*(get|post|put|delete|patch)\s*\(`

For each script containing a match, check whether the call site is inside a try-catch block:
- Heuristic: scan backwards from the match position for a `try\s*{` that has not yet been closed by a matching `}`.
- If no enclosing try-catch is found → attempt auto-fix.

**Auto-fix algorithm:**
1. Locate the outermost function body (between the opening `{` after the function signature and its matching closing `}`).
2. If the script contains exactly **one** top-level function and no existing partial try-catch wrapping the same call, replace the function body with:
   ```
   try {
     <original body>
   } catch (error) {
     console.error('API call failed:', error);
   }
   ```
3. If the script has **multiple top-level functions**, nested function declarations that own the API call, or a partially existing try-catch at the same level → fall back to `[MANUAL REVIEW]`.

Severity: **`[AUTO-FIXABLE]`** for simple single-function scripts; **`[MANUAL REVIEW]`** for complex ones.

Output format per finding:
```
[AUTO-FIXABLE — try-catch added]
  Component: <id> (<type>)
  Property:  <key>
  API call:  <matched text excerpt>

[MANUAL REVIEW — add try-catch]
  Component: <id> (<type>)
  Property:  <key>
  API call:  <matched text excerpt>
  Reason:    <why auto-fix was skipped, e.g. "multiple top-level functions">
```

---

## Step 4i: Detect API calls missing async/promise handling

Walk all JS code strings (same set as Step 4g). Use the API call patterns from Step 4h.

**Async-context property keys** — these Shesha lifecycle hooks must return a Promise or be declared async:

```
onFinish, onSubmit, getData, postData, customValidators,
onValuesChange, onInitialized, onComplete
```

Detect the following two scenarios and attempt auto-fix:

**Scenario A — `await` used outside an `async` function:**
- Script contains `await ` (with trailing space or opening paren) **and**
- The containing function is NOT declared `async`: none of `async function`, `async (`, `async\s+\w+\s*(` match.
- This is broken JavaScript — `await` in a non-async context is a syntax/runtime error.

**Auto-fix for Scenario A:** Add `async` before the function keyword or arrow:
- `function name(` → `async function name(`
- `(params) =>` → `async (params) =>`
- Named arrow assigned to `const name = (params) =>` → `const name = async (params) =>`
- Fall back to `[MANUAL REVIEW]` if there are multiple function declarations and it is ambiguous which one owns the `await`.

**Scenario B — API call in an async-context property without async handling:**
- The property key matches the async-context list above **and**
- The script contains an API call pattern **and**
- The function is NOT async (no `async function` / `async (`) **and**
- The call is NOT chained with `.then\s*(` **and**
- The script does NOT contain `return new Promise\s*(`.
- Result: the hook executes the call but does not await the response — the operation silently runs in the background and any return value is lost.

**Auto-fix for Scenario B:**
1. Add `async` to the function signature (same rules as Scenario A fix).
2. Prepend `await ` before each matched API call expression that is not already preceded by `await`.
3. Fall back to `[MANUAL REVIEW]` if the function structure is ambiguous (e.g., multiple top-level functions, generator functions).

Output format per finding:
```
[AUTO-FIXABLE] Missing async/promise handling
  Component: <id> (<type>)
  Property:  <key>  (async context — must return a Promise)
  Scenario:  A — await used in non-async function  →  added async to function signature
             B — API call result not awaited        →  added async + await to call site(s)
  API call:  <matched text excerpt>

[MANUAL REVIEW] Missing async/promise handling
  Component: <id> (<type>)
  Property:  <key>  (async context — must return a Promise)
  Scenario:  A or B
  API call:  <matched text excerpt>
  Reason:    <why auto-fix was skipped>
  Fix:       declare the function async and await the call
```

---

## Step 4j: Detect API calls using .then() chaining

Walk all JS code strings (same set as Step 4g). Use the API call patterns from Step 4h.

For each script where an API call pattern is followed by `.then\s*\(`, flag it as a style issue — `.then()` chaining works but is inconsistent with the async/await style used throughout Shesha.

Only flag cases where the `.then(` directly follows an API call pattern or is chained within the same expression. Do not flag `.then(` on non-API call chains.

Severity: **`[MANUAL REVIEW]`** — converting `.then()` callbacks to async/await requires restructuring the callback body, so this is never auto-fixed.

> **Note:** Step 4i still skips Scenario B detection for scripts that use `.then()` (they are handling the async result), but Step 4j will flag those same scripts here for style conversion.

Output format per finding:
```
[MANUAL REVIEW — replace .then() with async/await + try-catch]
  Component: <id> (<type>)
  Property:  <key>
  API call:  <matched text excerpt including .then(>
  Fix:       declare the function async, await the call,
             and wrap in try { ... } catch (error) { ... }
```

---

## Step 5: Present the dead property findings

If no dead properties are found, skip this section. `formSettings` dead properties (Step 4, restored) are reported in the same table, using the row label `formSettings` in place of a component name/id.

Component (and `formSettings`) dead properties:

```
Found N dead properties across M components:

Component                    | Type         | Dead Properties
-----------------------------|--------------|-----------------------------
"First Name" (id: abc…)      | textField    | fontColor, borderRadius
"Submit" (id: def…)          | button       | backgroundColor
formSettings                 | —            | legacyOnInitialized

Details:
  • "First Name" (textField)
      - fontColor:     "#333333"
      - borderRadius:  4

  • "Submit" (button)
      - backgroundColor:  "#0070f3"

  • formSettings
      - legacyOnInitialized:  "..."
```

For each dead property value, truncate strings longer than 60 characters with `…`.

---

## Step 5b: Present console.log findings

If no console.log calls were found, skip this section.

Otherwise show:

```
console.log cleanup:
  • "My Component" (textField) → onChangeCustom: removed 2 console.log call(s)
  • "Submit" (button) → customVisibility._code: removed 1 console.log call(s)

Total: 3 console.log calls removed from 2 components
```

---

## Step 5c: Present type mismatch findings (restored)

If no runtime-type mismatches were found (Step 4c), skip this section.

Otherwise show auto-fixable items first, then manual-review items:

```
Runtime-type mismatches (N found):
  Auto-fixable (value will be converted):
  • "Accept Terms" (checkbox) [validate.required]: "true" (string) → should be boolean [AUTO-FIXABLE]
  • formSettings [labelCol.span]: "6" (string) → should be number [AUTO-FIXABLE]

  Manual review required (not changed):
  • "Discount" (numberField) [defaultValue]: "" (empty string) → should be number [MANUAL REVIEW]

Total: N issues (X auto-fixable, Y manual review)
```

---

## Step 5d: Present values shape findings

If no issues were found, skip this section.

Otherwise show:

```
values shape issues:
  • "Category" (dropdown) — item[1]: missing color [AUTO-FIXABLE]
  • "Status" (dropdown) — item[0]: label is not a string [MANUAL REVIEW]
  • "Status" (dropdown) — item[2]: unknown key "extraProp" [MANUAL REVIEW]

Total: N issues (X auto-fixable, Y manual review)
```

---

## Step 5e: Present layout findings

If no layout issues were found, skip this section.

Otherwise show auto-fixable issues first, then manual-review issues:

```
Layout issues:
  [L2 — span] formSettings: wrapperCol.span=null → set to 16 [AUTO-FIXABLE]
  [L1 — overflow] "Container1" (container) — desktop: width 200% [MANUAL REVIEW]
  [L2 — span] "First Name" (textField): 10+10=20 ≠ 24 [MANUAL REVIEW]

Total: N issues (X auto-fixable, Y manual review)
```

---

## Step 5f: Present script label reference findings

If no matches were found, skip this section.

Otherwise show:

```
Script label references (N found):
  • "Submit" (button) [customAction]: uses data['First Name'] — should be data['firstName'] [MANUAL REVIEW]
  • "Panel" (container) [onLoad]: uses data['Status'] — should be data['status'] [MANUAL REVIEW]
```

---

## Step 5g: Present script syntax error findings

If no syntax errors were found, skip this section.

Otherwise show:

```
Script syntax errors (N found — CRITICAL):
  • "Submit" (button) [customAction]
      Issue:   unmatched braces: 3 opens, 2 closes
      Excerpt: function onSubmit(data) { if (data.id) { return axios.post('/api/...
  • "Panel" (container) [onLoad]
      Issue:   unclosed string literal (odd number of " characters)
      Excerpt: const label = "First Name;
```

---

## Step 5h: Present missing try-catch findings

If no API calls without try-catch were found, skip this section.

Show auto-fixable items first, then manual-review items:

```
API calls missing try-catch (N found):
  Auto-fixable (try-catch will be added):
  • "Submit" (button) [onFinish]
      API call:  axios.post('/api/services/...')
  • "Load Data" (customComponent) [getData]
      API call:  getHttp('/api/...')

  Manual review required (not changed):
  • "Complex" (customComponent) [onLoad]
      API call:  axios.get('/api/...')
      Reason:    multiple top-level functions — cannot determine wrapping scope
```

---

## Step 5i: Present missing async/promise findings

If no async/promise issues were found, skip this section.

Show auto-fixable items first, then manual-review items:

```
API calls missing async/promise handling (N found):
  Auto-fixable (will be updated):
  • "Submit" (button) [onFinish]  (async context — must return a Promise)
      Scenario: B — API call not awaited or chained
      API call:  axios.post('/api/services/...')
      Fix:       add async to function signature + await before call
  • "Validator" (textField) [customValidators]  (async context — must return a Promise)
      Scenario: A — await used in non-async function
      API call:  fetch('/api/...')
      Fix:       add async to function signature

  Manual review required (not changed):
  • "Complex" (button) [onFinish]  (async context — must return a Promise)
      Scenario: B — API call not awaited or chained
      API call:  axios.post('/api/...')
      Reason:    ambiguous — multiple top-level functions
      Fix:       declare the function async and await the call
```

---

## Step 5j: Present .then() chaining findings

If no `.then()` chaining on API calls was found, skip this section.

Otherwise show:

```
API calls using .then() chaining (N found — manual review recommended):
  • "Submit" (button) [onFinish]
      API call:  axios.post('/api/services/...').then(result => {
      Fix:       declare function async, await the call, wrap in try { ... } catch (error) { ... }
  • "Load Data" (customComponent) [getData]
      API call:  getHttp('/api/...').then(data => {
      Fix:       declare function async, await the call, wrap in try { ... } catch (error) { ... }
```

---

## Step 6: Confirm removal

Ask the user a **single** confirm prompt covering all findings:

> Apply N cleanups:
>   - X dead properties removed (including formSettings)
>   - Y console.log calls removed
>   - W runtime-type mismatches fixed (Z items need manual review — listed above)
>   - V values shape fixes (U items need manual review — listed above)
>   - X layout fixes (Y items need manual review — listed above)
>   - N script label references (manual review only — listed above)
>   - S script syntax error(s) — CRITICAL, manual fix required
>   - T API call(s) missing try-catch auto-fixed (M need manual review — listed above)
>   - U API call(s) missing async handling auto-fixed (P need manual review — listed above)
>   - V API call(s) using .then() — manual review recommended (listed above)
>
> Proceed? (yes / no)

Adjust to omit whichever counts are zero. If there is nothing to clean, tell the user and stop.

- **no** → stop, output nothing.
- **yes** → apply everything (dead props + console.log + all auto-fixable values/layout/API fixes).

---

## Step 7: Output the cleaned form

1. Deep-clone the markup object.
2. Walk the component tree. For each component flagged in Step 4, delete the dead property keys. Also delete any `formSettings` dead property keys flagged in Step 4 (top-level only, per that step).
3. Apply console.log cleanup: for every string value that contained `console.log`, replace with the regex-stripped, blank-lines-collapsed version.
4. Apply auto-fixable runtime-type fixes (Step 4c `[AUTO-FIXABLE]` items): for each flagged path, replace the value at that path (walking the same dotted segments used to find it) with the converted value — `value === 'true'` for a boolean target, `Number(value)` for a number target. Do **not** modify `[MANUAL REVIEW]` type-mismatch items.
5. Apply auto-fixable values shape fixes:
   - For each item flagged with missing `color` → add `"color": ""` to the item.
   - Do **not** modify items flagged `[MANUAL REVIEW]`.
6. Apply auto-fixable layout fixes (L2 span fixes only):
   - For each `[AUTO-FIXABLE]` L2 issue: set the absent/null span to `24 − knownSpan` on the same object (`formSettings`, `component.labelCol`, or `component.wrapperCol`).
   - Do **not** modify `[MANUAL REVIEW]` layout items.
7. Do **not** auto-fix script label references from Step 4f — these are manual review only.
8. Apply auto-fixable try-catch fixes (Step 4h `[AUTO-FIXABLE]` items):
   - For each flagged script, locate the outermost function body and wrap its content in `try { ... } catch (error) { console.error('API call failed:', error); }`.
   - Update the property string value in the cloned component/formSettings object.
   - Do **not** modify `[MANUAL REVIEW]` try-catch items.
9. Apply auto-fixable async/await fixes (Step 4i `[AUTO-FIXABLE]` items):
    - **Scenario A**: In the script string, find the function declaration or arrow that owns the `await` and insert `async` before the `function` keyword or before the parameter list of an arrow function.
    - **Scenario B**: Apply the Scenario A async-add first, then prepend `await ` before each matched API call expression that is not already preceded by `await `.
    - Update the property string value in the cloned component/formSettings object.
    - Do **not** modify `[MANUAL REVIEW]` async items.
10. Do **not** auto-fix `.then()` chaining findings from Step 4j — these are manual review only.
11. Do **not** modify component structure or any valid non-flagged properties.
12. Output the cleaned `{ components, formSettings }` object as a formatted JSON code block.

---

## Step 8: Summary

```
Cleaned form — N changes applied:

Dead properties removed:
  • "First Name" (textField): fontColor, borderRadius
  • "Submit" (button): backgroundColor
  • formSettings: legacyOnInitialized

console.log calls removed:
  • "My Component" (textField) → onChangeCustom: 2 call(s)
  • "Submit" (button) → customVisibility._code: 1 call(s)

Runtime-type mismatches fixed:
  • "Accept Terms" (checkbox) [validate.required]: "true" → true
  • formSettings [labelCol.span]: "6" → 6

Runtime-type mismatches needing manual review (not changed):
  • "Discount" (numberField) [defaultValue]: "" is not a number

Values shape fixes applied:
  • "Category" (dropdown) → item[1]: added color ""

Values items needing manual review (not changed):
  • "Status" (dropdown) → item[0]: label is not a string

Layout fixes applied:
  • [L2] formSettings: wrapperCol.span set to 16

Layout issues needing manual review (not changed):
  • [L1] "Container1" (container) — desktop: width 200% (wrap enabled)
  • [L2] "First Name" (textField): labelCol=10 + wrapperCol=10 = 20

Script label references needing manual review (not changed):
  • "Submit" (button) [customAction]: uses data['First Name'] — should be data['firstName']

Script syntax errors — CRITICAL, fix required:
  • "Submit" (button) [customAction]: unmatched braces: 3 opens, 2 closes
  • "Panel" (container) [onLoad]: unclosed string literal

Try-catch fixes applied:
  • "Submit" (button) [onFinish]: wrapped function body in try/catch
  • "Load Data" (customComponent) [getData]: wrapped function body in try/catch

Try-catch needing manual review (not changed):
  • "Complex" (customComponent) [onLoad]: multiple top-level functions

Async/await fixes applied:
  • "Submit" (button) [onFinish]: added async + await before axios.post(...)
  • "Validator" (textField) [customValidators]: added async to function signature

Async/await needing manual review (not changed):
  • "Complex" (button) [onFinish]: ambiguous — multiple top-level functions

API calls using .then() — manual review recommended (not changed):
  • "Submit" (button) [onFinish]: axios.post(...).then(result => {
  • "Load Data" (customComponent) [getData]: getHttp(...).then(data => {

Original size:  XX,XXX chars
Cleaned size:   YY,YYY chars
Reduction:      ZZZ chars (P%)
```

Omit whichever sections have no entries.
