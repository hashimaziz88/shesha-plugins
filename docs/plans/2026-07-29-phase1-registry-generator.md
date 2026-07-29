# Phase 1: Ground-Truth Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the machine-readable vocabulary the rest of the pipeline consumes — the component registry, the style-role catalogue, the archetype flow manifests, and the styled-blueprint schema with its ASCII placement renderer — each validated against the registry so none can drift from the framework.

**Architecture:** A CLI (`gen-registry.mjs`) copies a Jest harness into the framework checkout, runs it to extract every registered component's settings-form prop paths and migrator version, then post-processes the raw extraction into a committed `registry-<version>.json`. Three further data artifacts are then authored against that registry and validated by it: `roles.styles.json` (role → complete 63-prop style block, values as token refs), `archetypes/*.flow.json` (archetype → complete required node set), and `blueprint.schema.json` plus a renderer that emits the ASCII placement mock from a resolved blueprint. All logic is pure and unit-tested with zero dependencies; only the CLI touches the filesystem.

**Why these four ship together:** the role catalogue can only be validated if the registry says which props a type has; the flow manifests can only be validated if the registry says which types exist; the blueprint schema references both. They are one vocabulary, and a half-built vocabulary cannot be verified. Nothing consumes them yet — the validator that enforces them is Phase 2.

**Tech Stack:** Node 25 (`node --test`, built-in — no test framework dependency), ES modules, Jest + ts-jest inside the framework checkout only (already present there).

## Global Constraints

- **Framework version pinned to 0.45.1**, source of truth = local checkout `C:/Users/Hashim/Documents/Git Repos/shesha-framework` on branch `releases/0.45` at merge commit `d16734774`.
- **Forward slashes only** in all paths written into skill docs and JSON (project rule, `CLAUDE.md`).
- **No commits without explicit user approval at phase end** (user instruction). Task steps that say "Commit" are staged only; the phase-end gate is the approval.
- **Do not modify the framework repo.** The harness is copied into a gitignored scratch directory inside it at run time and removed afterwards.
- **Zero new runtime dependencies in the plugin.** Use `node --test` and `node:assert`. The plugin ships no `node_modules`.
- **Plugin version bump** is part of the approved commit, per `CLAUDE.md`: patch for enhancements to existing skills. Current version `1.8.3`.
- **Corpus and generated scratch data never enter the repo.** Only `registry-0.45.1.json` and `registry.meta.json` are committed.

---

## Verified facts this plan depends on

Established by direct inspection, not assumption:

| Fact | Value |
|---|---|
| Components registered in framework | **116** |
| Settings forms that parse | **116 / 116**, 0 failures |
| Raw extraction shape | `{summary:{...}, components:{<type>: {name, group, isInput, isOutput, isHidden, version, propsCount, props[]}}}` |
| `type` field inside each entry | **absent on all 116** — the object key is the type |
| Hand index `assets/groups/index.json` | 65 components; keys `_meta`, `groupFiles`, `components` |
| Phantom in hand index | **`addressInput`** (not in framework) |
| Types missing from hand index | **52** |
| Scaffolding contamination in raw props | **467 entries across 58 distinct names** (`settingsTabs`, `propertyRouter1`, `pnlDimensions`, `pnlBorderStyle`, `bordericon`, `advancedPanel`, …) |
| Components with 0 props | **18** — all genuinely lack `settingsFormMarkup` in source |
| Breakdown of the 18 | 4 `isHidden`, 8 `group:"Legacy"`, 6 `group:"Dev"`, plus `dataSource`, `scheduledJobExecutionLog` |
| Components with no version (no migrator) | **7** (`paragraph`, `datatable_template`, `columnsEditorComponent`, `dataContextSelector`, `searchableTabs`, `settingsInput`, `settingsInputRow`) |
| Spot-checked versions/props | `container` v7/71 · `textField` v6/82 · `columns` v5/57 · `datatable` v29/99 · `button` v9/69 |
| `datatableContext` | name "Data Context (Legacy)", `isHidden:true`, v8, 0 props — present in 9 corpus forms |
| Extraction entry points (verified post-merge) | `getComponentDefinitions()` `providers/form/defaults/toolboxComponents.ts:294` · `makeFormBuliderFactory()` `form-factory/implementation.ts:229` · `SettingsFormMarkupFactory` `interfaces/formDesigner.ts:54,158` · `migrator.lastVersion` `utils/fluentMigrator/migrator.ts:44` |
| Shims the harness needs | jsdom `matchMedia` + `ResizeObserver`; `nanoid` and `redux-actions` ESM stubs; `?raw` and `.css` import stubs; `antd/es/*` → `antd/lib/*` moduleNameMapper |

---

## File Structure

```
plugins/shesha-developer/skills/shesha-form-edit/
├── package.json                          MODIFY  drop 3 dead scripts, add test + gen:registry
├── scripts/
│   ├── gen-registry.mjs                  CREATE  CLI: orchestrate extract → postprocess → write
│   ├── lib/
│   │   ├── classify.mjs                  CREATE  prop-path + authorability classification (pure)
│   │   └── postprocess.mjs               CREATE  raw extraction → registry schema (pure)
│   └── harness/                          CREATE  copied into framework at run time
│       ├── extract.test.ts               CREATE  walks toolbox, emits raw JSON
│       ├── jest.config.cjs               CREATE  ts-jest + moduleNameMapper for the shims
│       ├── setup.js                      CREATE  jsdom matchMedia / ResizeObserver
│       └── stubs/
│           ├── nanoid.js                 CREATE
│           ├── reduxActions.js           CREATE
│           └── raw.js                    CREATE  serves both ?raw and .css imports
├── assets/registry/
│   ├── registry-0.45.1.json              GENERATED, committed
│   └── registry.meta.json                GENERATED, committed
├── assets/archetypes/                    CREATE  Task 9 — flow manifests
│   ├── table-worklist.flow.json
│   ├── record-detail.flow.json
│   ├── capture-dialog.flow.json
│   └── standalone-capture.flow.json
├── references/archetypes.md              CREATE  Task 9 — the single archetype vocabulary
├── scripts/lib/flow.mjs                  CREATE  Task 9 — load + validate manifests
└── tests/
    ├── classify.test.mjs                 CREATE  unit
    ├── postprocess.test.mjs              CREATE  unit
    ├── flow.test.mjs                     CREATE  unit
    └── registry-acceptance.test.mjs      CREATE  asserts the committed registry's invariants

plugins/shesha-developer/skills/shesha-design-system/
├── package.json                          CREATE  node --test wiring
├── assets/roles.styles.json              CREATE  Task 8 — role → complete style block
├── scripts/lib/resolve-role.mjs          CREATE  Task 8 — token resolution + validation
└── tests/resolve-role.test.mjs           CREATE  unit + catalogue-completeness gate

plugins/shesha-developer/skills/shesha-design-comprehension/
├── package.json                          MODIFY  add node --test wiring
├── assets/blueprint.schema.json          CREATE  Task 10 — styled-blueprint schema
├── scripts/lib/render-mock.mjs           CREATE  Task 10 — ASCII placement renderer
├── references/blueprint-ir.md            MODIFY  Task 10 — three representations; fix 348/356
└── tests/render-mock.test.mjs            CREATE  unit
```

**Dependency order across the four artifacts:** registry (Tasks 1–7) → role catalogue (Task 8, validated against registry props) → flow manifests (Task 9, validated against registry types *and* roles) → blueprint schema + renderer (Task 10, references both). Tasks 8–10 cannot be reordered.

**Responsibility boundaries.** `classify.mjs` answers two yes/no questions and knows nothing about file layout. `postprocess.mjs` is a pure transform, raw object in → registry object out, and never touches the filesystem. `gen-registry.mjs` owns all I/O and process spawning. That split is what makes the interesting logic unit-testable without a framework checkout.

---

## Registry schema (produced by this phase, consumed by Phase 2)

```jsonc
{
  "frameworkVersion": "0.45.1",
  "components": {
    "textField": {
      "type": "textField",              // key lifted into the entry — raw extraction omits it
      "name": "Text Field",
      "group": "Data entry",
      "version": 6,                     // null when the component has no migrator
      "isInput": true,
      "isOutput": false,
      "isHidden": false,
      "authorable": true,               // false ⇒ recognise but never author
      "authorableReason": null,         // e.g. "legacy" | "dev" | "hidden" | "no-settings-form"
      "props": ["propertyName", "label", "desktop.dimensions.width", "..."],
      "customContainerNames": []        // child-slot keys, e.g. ["header","content","customHeader"]
    }
  }
}
```

`registry.meta.json`:

```jsonc
{
  "frameworkVersion": "0.45.1",
  "sourceRepo": "shesha-io/shesha-framework",
  "sourceBranch": "releases/0.45",
  "sourceCommit": "d16734774",
  "generatedAtUtc": "2026-07-29T...",
  "generatorVersion": 1,
  "counts": { "total": 116, "authorable": 98, "withoutVersion": 7, "withoutProps": 18 },
  "droppedScaffoldingProps": 467
}
```

---

### Task 1: Test infrastructure and package.json repair

**Files:**
- Modify: `plugins/shesha-developer/skills/shesha-form-edit/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs `node --test tests/` from the skill directory. Every later task's tests run under it.

The three existing scripts (`test`, `iterate`, `auto`) point at `test-log/`, which does not exist, so `npm test` currently fails immediately.

- [ ] **Step 1: Write the failing test**

Create `plugins/shesha-developer/skills/shesha-form-edit/tests/smoke.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner is wired up', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it to confirm the runner is broken**

Run from `plugins/shesha-developer/skills/shesha-form-edit/`:
```bash
npm test
```
Expected: FAIL — `Cannot find module '.../test-log/tracker.mjs'`.

- [ ] **Step 3: Repair package.json**

Replace the whole file:

```json
{
  "name": "shesha-form-edit",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "gen:registry": "node scripts/gen-registry.mjs",
    "setup": "npm install && npx playwright install chromium --with-deps"
  },
  "devDependencies": {
    "playwright": "^1.40.0"
  }
}
```

Note what is removed and why: `test-log/tracker.mjs`, `iterate.mjs` and `auto-cycle.mjs` do not exist anywhere in the repo. `setup` is kept because the browser-smoke step in `SKILL.md` Step 9 depends on it.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```
Expected: PASS, 1 test.

- [ ] **Step 5: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/package.json \
        plugins/shesha-developer/skills/shesha-form-edit/tests/smoke.test.mjs
```

---

### Task 2: Prop-path and authorability classification

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/classify.mjs`
- Test: `plugins/shesha-developer/skills/shesha-form-edit/tests/classify.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isScaffoldingProp(propPath: string) => boolean` — true when the path is a settings-form panel/tab/router node rather than a component model prop.
  - `classifyAuthorability(entry: {group?: string, isHidden?: boolean, propsCount?: number}) => {authorable: boolean, reason: string|null}` — `reason` ∈ `"hidden" | "legacy" | "dev" | "no-settings-form" | null`.

Two independent decisions, deliberately separated: a prop is dropped for being *scaffolding*; a component is marked non-authorable for being *legacy/dev/hidden*. Conflating them would drop `datatableContext` entirely, and the validator needs it to recognise the 9 corpus forms that use it.

- [ ] **Step 1: Write the failing test**

Create `tests/classify.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScaffoldingProp, classifyAuthorability } from '../scripts/lib/classify.mjs';

test('drops settings-form scaffolding node names', () => {
  for (const p of [
    'settingsTabs', 'propertyRouter1', 'propertyRouter',
    'pnlDimensions', 'pnlBorderStyle', 'pnlFontStyle', 'pnlShadowStyle',
    'pnlBackgroundStyle', 'pnlAxisLabelFont', 'pnlQuickView', 'pnlOnSuccess',
    'bordericon', 'advancedPanel', 'displayPanel', 'optionsPanel',
    'toolbarPanel', 'containerCustomStylePanel',
  ]) {
    assert.equal(isScaffoldingProp(p), true, `${p} should be scaffolding`);
  }
});

test('keeps real model props, including dotted style paths', () => {
  for (const p of [
    'propertyName', 'label', 'hideLabel', 'editMode', 'validate.required',
    'desktop.dimensions.width', 'border.border.all.color', 'background.gradient.colors',
    'actionConfiguration', 'dataSourceType', 'referenceListId', 'items',
  ]) {
    assert.equal(isScaffoldingProp(p), false, `${p} should be kept`);
  }
});

test('does not treat a legitimate prop ending in Panel-like text as scaffolding', () => {
  // `panelId` is a real prop on collapsiblePanel-adjacent components; only
  // exact scaffolding node names and the pnl*/propertyRouter* prefixes are dropped.
  assert.equal(isScaffoldingProp('panelId'), false);
  assert.equal(isScaffoldingProp('panelHeaderText'), false);
});

test('marks hidden components non-authorable', () => {
  assert.deepEqual(
    classifyAuthorability({ group: 'Tables and Lists', isHidden: true, propsCount: 0 }),
    { authorable: false, reason: 'hidden' },
  );
});

test('marks Legacy and Dev groups non-authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Legacy', propsCount: 3 }),
    { authorable: false, reason: 'legacy' });
  assert.deepEqual(classifyAuthorability({ group: 'Dev', propsCount: 0 }),
    { authorable: false, reason: 'dev' });
});

test('marks a component with no settings form non-authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Data Access', propsCount: 0 }),
    { authorable: false, reason: 'no-settings-form' });
});

test('ordinary components are authorable', () => {
  assert.deepEqual(classifyAuthorability({ group: 'Data entry', isHidden: false, propsCount: 82 }),
    { authorable: true, reason: null });
});

test('hidden takes precedence over group', () => {
  assert.equal(classifyAuthorability({ group: 'Legacy', isHidden: true, propsCount: 0 }).reason, 'hidden');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../scripts/lib/classify.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/classify.mjs`:

```javascript
/**
 * Settings-form scaffolding node names that the extractor picks up because they
 * carry a `propertyName`, but which are panel/tab/router containers in the
 * settings UI rather than props on the component model.
 *
 * Matched as: exact names in EXACT_SCAFFOLDING, or the two prefixes below.
 * Deliberately NOT a loose /Panel$/ match — `panelId` and `panelHeaderText`
 * are real props and must survive.
 */
const EXACT_SCAFFOLDING = new Set([
  'settingsTabs',
  'propertyRouter',
  'bordericon',
  'advancedPanel',
  'displayPanel',
  'optionsPanel',
  'toolbarPanel',
  'containerCustomStylePanel',
]);

// `pnlDimensions`, `pnlBorderStyle`, `pnlOnSuccess`, … — the settings-form
// panel convention. `propertyRouter1`, `propertyRouter2`, … — numbered routers.
const SCAFFOLDING_PREFIX = /^(pnl[A-Z]|propertyRouter\d+$)/;

export function isScaffoldingProp(propPath) {
  if (typeof propPath !== 'string' || propPath.length === 0) return true;
  if (EXACT_SCAFFOLDING.has(propPath)) return true;
  return SCAFFOLDING_PREFIX.test(propPath);
}

/**
 * A component is "authorable" when a form author may legitimately emit it.
 * Non-authorable components stay in the registry so the validator can
 * recognise them in existing markup without raising T1-TYPE-UNKNOWN —
 * e.g. `datatableContext` ("Data Context (Legacy)") appears in 9 production forms.
 *
 * Precedence: hidden > legacy > dev > no-settings-form.
 */
const NON_AUTHORABLE_GROUPS = new Map([
  ['Legacy', 'legacy'],
  ['Dev', 'dev'],
]);

export function classifyAuthorability(entry) {
  if (entry.isHidden === true) return { authorable: false, reason: 'hidden' };

  const groupReason = NON_AUTHORABLE_GROUPS.get(entry.group);
  if (groupReason) return { authorable: false, reason: groupReason };

  // No settings form means no discoverable props, so we cannot validate what
  // an author writes on it. Recognise it, never author it.
  if (!entry.propsCount) return { authorable: false, reason: 'no-settings-form' };

  return { authorable: true, reason: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```
Expected: PASS — 8 tests in `classify.test.mjs` plus the smoke test.

- [ ] **Step 5: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/classify.mjs \
        plugins/shesha-developer/skills/shesha-form-edit/tests/classify.test.mjs
```

---

### Task 3: Post-process raw extraction into the registry schema

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/postprocess.mjs`
- Test: `plugins/shesha-developer/skills/shesha-form-edit/tests/postprocess.test.mjs`

**Interfaces:**
- Consumes: `isScaffoldingProp`, `classifyAuthorability` from `./classify.mjs` (Task 2).
- Produces:
  - `postprocess(raw: {summary?: object, components: object}, opts: {frameworkVersion: string}) => {registry: object, stats: object}`
  - `registry` matches the schema above. `stats` is `{total, authorable, withoutVersion, withoutProps, droppedScaffoldingProps}` and feeds `registry.meta.json`.

Determinism is a hard requirement: same input must produce byte-identical output, so the file diffs cleanly on regeneration. That means sorted component keys and sorted prop arrays.

- [ ] **Step 1: Write the failing test**

Create `tests/postprocess.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postprocess } from '../scripts/lib/postprocess.mjs';

const raw = {
  summary: { totalTypes: 3, settingsOk: 3, settingsFail: 0 },
  components: {
    textField: {
      name: 'Text Field', group: 'Data entry',
      isInput: true, isOutput: false, isHidden: false,
      version: 6, propsCount: 4,
      props: ['label', 'propertyName', 'pnlDimensions', 'settingsTabs'],
    },
    datatableContext: {
      name: 'Data Context (Legacy)', group: 'Tables and Lists',
      isInput: true, isOutput: true, isHidden: true,
      version: 8, propsCount: 0, props: [],
    },
    collapsiblePanel: {
      name: 'Collapsible Panel', group: 'Layout',
      isInput: false, isOutput: false, isHidden: false,
      version: undefined, propsCount: 1,
      props: ['panelHeaderText'],
      customContainerNames: ['header', 'content', 'customHeader'],
    },
  },
};

test('lifts the object key into a type field', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(registry.components.textField.type, 'textField');
  assert.equal(registry.components.datatableContext.type, 'datatableContext');
});

test('drops scaffolding props and keeps real ones', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(registry.components.textField.props, ['label', 'propertyName']);
});

test('records how many scaffolding props were dropped', () => {
  const { stats } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(stats.droppedScaffoldingProps, 2);
});

test('normalises a missing version to null rather than undefined', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.equal(registry.components.collapsiblePanel.version, null);
  // null survives JSON.stringify; undefined would silently vanish.
  assert.ok(JSON.stringify(registry).includes('"version":null'));
});

test('marks the legacy hidden component non-authorable but keeps it', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  const e = registry.components.datatableContext;
  assert.equal(e.authorable, false);
  assert.equal(e.authorableReason, 'hidden');
});

test('preserves customContainerNames, defaulting to an empty array', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(registry.components.collapsiblePanel.customContainerNames,
    ['header', 'content', 'customHeader']);
  assert.deepEqual(registry.components.textField.customContainerNames, []);
});

test('output is deterministic: component keys and props are sorted', () => {
  const { registry } = postprocess(raw, { frameworkVersion: '0.45.1' });
  const keys = Object.keys(registry.components);
  assert.deepEqual(keys, [...keys].sort());
  for (const c of Object.values(registry.components)) {
    assert.deepEqual(c.props, [...c.props].sort());
  }
});

test('same input produces byte-identical output', () => {
  const a = JSON.stringify(postprocess(raw, { frameworkVersion: '0.45.1' }).registry);
  const b = JSON.stringify(postprocess(raw, { frameworkVersion: '0.45.1' }).registry);
  assert.equal(a, b);
});

test('stats count authorable, versionless and propless components', () => {
  const { stats } = postprocess(raw, { frameworkVersion: '0.45.1' });
  assert.deepEqual(stats, {
    total: 3,
    authorable: 2,          // textField + collapsiblePanel
    withoutVersion: 1,      // collapsiblePanel
    withoutProps: 1,        // datatableContext
    droppedScaffoldingProps: 2,
  });
});

test('throws a specific error when the raw extraction has no components', () => {
  assert.throws(
    () => postprocess({ components: {} }, { frameworkVersion: '0.45.1' }),
    /extracted 0 components/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../scripts/lib/postprocess.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/postprocess.mjs`:

```javascript
import { isScaffoldingProp, classifyAuthorability } from './classify.mjs';

/**
 * Turn the harness's raw extraction into the committed registry.
 *
 * Pure: no filesystem, no clock, no randomness — so it is unit-testable and
 * produces byte-identical output for identical input. Timestamps belong to
 * the caller (gen-registry.mjs), which writes registry.meta.json.
 */
export function postprocess(raw, { frameworkVersion }) {
  const rawComponents = raw?.components ?? {};
  const types = Object.keys(rawComponents);

  // Fail loudly rather than committing an empty registry: a silent 0-component
  // registry would make every Phase 2 validator check vacuously pass.
  if (types.length === 0) {
    throw new Error('postprocess: extracted 0 components — the harness did not run correctly');
  }

  const stats = {
    total: types.length,
    authorable: 0,
    withoutVersion: 0,
    withoutProps: 0,
    droppedScaffoldingProps: 0,
  };

  const components = {};
  for (const type of types.sort()) {
    const src = rawComponents[type];

    const kept = [];
    for (const p of src.props ?? []) {
      if (isScaffoldingProp(p)) stats.droppedScaffoldingProps++;
      else kept.push(p);
    }
    kept.sort();

    // classifyAuthorability keys off the REAL prop count (post-filter), so a
    // component whose only "props" were scaffolding is correctly non-authorable.
    const { authorable, reason } = classifyAuthorability({
      group: src.group,
      isHidden: src.isHidden,
      propsCount: kept.length,
    });

    // undefined disappears through JSON.stringify; null round-trips, which the
    // Phase 2 validator relies on to distinguish "no migrator" from "not read yet".
    const version = Number.isInteger(src.version) ? src.version : null;

    if (authorable) stats.authorable++;
    if (version === null) stats.withoutVersion++;
    if (kept.length === 0) stats.withoutProps++;

    components[type] = {
      type,
      name: src.name ?? type,
      group: src.group ?? null,
      version,
      isInput: src.isInput === true,
      isOutput: src.isOutput === true,
      isHidden: src.isHidden === true,
      authorable,
      authorableReason: reason,
      props: kept,
      customContainerNames: src.customContainerNames ?? [],
    };
  }

  return {
    registry: { frameworkVersion, components },
    stats,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```
Expected: PASS — 10 tests in `postprocess.test.mjs`.

- [ ] **Step 5: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/postprocess.mjs \
        plugins/shesha-developer/skills/shesha-form-edit/tests/postprocess.test.mjs
```

---

### Task 4: The extraction harness

**Files:**
- Create: `scripts/harness/extract.test.ts`
- Create: `scripts/harness/jest.config.cjs`
- Create: `scripts/harness/setup.js`
- Create: `scripts/harness/stubs/nanoid.js`
- Create: `scripts/harness/stubs/reduxActions.js`
- Create: `scripts/harness/stubs/raw.js`

**Interfaces:**
- Consumes: the framework's `getComponentDefinitions`, `makeFormBuliderFactory`, `Migrator` (paths verified post-merge).
- Produces: a JSON file at the path in `SHESHA_REGISTRY_OUT`, shaped `{summary:{totalTypes,settingsOk,settingsFail}, components:{<type>:{name,group,isInput,isOutput,isHidden,version,propsCount,props,customContainerNames}}}` — the exact input `postprocess()` (Task 3) expects.

This runs as a Jest test inside the framework checkout because it must import framework TypeScript with the framework's own `tsconfig` and `node_modules`. It is a test only as a delivery mechanism; its assertions are sanity guards.

- [ ] **Step 1: Write the harness test file**

Create `scripts/harness/extract.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { getComponentDefinitions } from '@/providers/form/defaults/toolboxComponents';
import { makeFormBuliderFactory } from '@/form-factory/implementation';
import { Migrator } from '@/utils/fluentMigrator/migrator';

/** Recursively collect every `propertyName` in a settings-form markup tree. */
function collectPropertyNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, out);
    return;
  }
  if (typeof node.propertyName === 'string' && node.propertyName.length > 0) {
    out.add(node.propertyName);
  }
  // Settings forms nest through these keys.
  for (const key of ['components', 'columns', 'tabs', 'content', 'header', 'items']) {
    if (node[key]) collectPropertyNames(node[key], out);
  }
}

describe('component registry extraction', () => {
  it('extracts every registered component', () => {
    // `getComponentDefinitions()` takes no arguments and returns every registered
    // component, Dev group included (verified: the extraction yields `settingsInput`,
    // `searchableTabs` etc.). Do NOT confuse it with `getToolboxComponents(devMode, …)`,
    // which filters by devMode — that is the designer's UI path, not ours.
    const defs = getComponentDefinitions();
    const fbf = makeFormBuliderFactory();

    const components: Record<string, any> = {};
    let settingsOk = 0;
    let settingsFail = 0;

    for (const [type, def] of defs.entries()) {
      const props = new Set<string>();
      try {
        const markup =
          typeof def.settingsFormMarkup === 'function'
            ? (def.settingsFormMarkup as any)({ fbf })
            : def.settingsFormMarkup;
        if (markup) collectPropertyNames(markup, props);
        settingsOk++;
      } catch (e) {
        // Record the failure rather than aborting the whole extraction — one
        // broken settings form must not cost us the other 115 components.
        settingsFail++;
        // eslint-disable-next-line no-console
        console.warn(`settingsFormMarkup failed for ${type}: ${(e as Error).message}`);
      }

      let version: number | undefined;
      try {
        version = def.migrator ? def.migrator(new Migrator() as any)?.lastVersion : undefined;
      } catch {
        version = undefined;
      }

      components[type] = {
        name: (def as any).name ?? type,
        group: (def as any).group ?? null,
        isInput: (def as any).isInput === true,
        isOutput: (def as any).isOutput === true,
        isHidden: (def as any).isHidden === true,
        version,
        propsCount: props.size,
        props: [...props],
        customContainerNames: (def as any).customContainerNames ?? [],
      };
    }

    const out = {
      summary: { totalTypes: defs.size, settingsOk, settingsFail },
      components,
    };

    const target = process.env.SHESHA_REGISTRY_OUT;
    if (!target) throw new Error('SHESHA_REGISTRY_OUT is not set');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');

    // Sanity guards. 100 is a deliberate floor, not the expected count — the
    // exact count is asserted in the plugin's acceptance test (Task 6), which
    // is the right place for it, because that is where a drop should fail CI.
    expect(defs.size).toBeGreaterThan(100);
    expect(settingsFail).toBe(0);
  });
});
```

- [ ] **Step 2: Write the Jest config and shims**

Create `scripts/harness/jest.config.cjs`:

```javascript
// Runs from inside <framework>/shesha-reactjs, so rootDir is that package.
const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  testEnvironment: 'jsdom',
  testMatch: ['**/.shesha-registry-gen/extract.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/.shesha-registry-gen/setup.js'],
  transform: { '^.+\\.(t|j)sx?$': ['ts-jest', { isolatedModules: true, diagnostics: false }] },
  moduleNameMapper: {
    // antd ships ESM under es/; Jest needs the CJS build.
    '^antd/es/(.*)$': 'antd/lib/$1',
    // nanoid and redux-actions are ESM-only and would need transformIgnorePatterns
    // gymnastics; the extraction never exercises their behaviour.
    '^nanoid$': '<rootDir>/.shesha-registry-gen/stubs/nanoid.js',
    '^redux-actions$': '<rootDir>/.shesha-registry-gen/stubs/reduxActions.js',
    // `?raw` text imports and CSS imports carry no props.
    '\\?raw$': '<rootDir>/.shesha-registry-gen/stubs/raw.js',
    '\\.(css|less|scss)$': '<rootDir>/.shesha-registry-gen/stubs/raw.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: ['node_modules/(?!(nanoid|redux-actions)/)'],
};
```

Create `scripts/harness/setup.js`:

```javascript
// jsdom implements neither of these, and the component modules touch both at
// import time via responsive/canvas hooks.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
}

if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
```

Create `scripts/harness/stubs/nanoid.js`:

```javascript
// Deterministic counter, not random: the extraction must be reproducible.
let n = 0;
const nanoid = () => `stub-id-${++n}`;
module.exports = { nanoid, customAlphabet: () => nanoid, urlAlphabet: '' };
```

Create `scripts/harness/stubs/reduxActions.js`:

```javascript
// Only the shapes touched at module-import time are needed.
module.exports = {
  createAction: (type, payloadCreator) => {
    const ac = (...args) => ({ type, payload: payloadCreator ? payloadCreator(...args) : args[0] });
    ac.toString = () => type;
    return ac;
  },
  handleActions: (_handlers, defaultState) => (state = defaultState) => state,
};
```

Create `scripts/harness/stubs/raw.js`:

```javascript
// `?raw` text and stylesheet imports contribute no propertyNames.
module.exports = '';
```

- [ ] **Step 3: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/scripts/harness/
```

The harness is exercised end-to-end in Task 5; it cannot be run standalone because it needs the framework checkout the CLI provides.

---

### Task 5: The CLI

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/scripts/gen-registry.mjs`
- Create: `plugins/shesha-developer/skills/shesha-form-edit/assets/registry/.gitignore`

**Interfaces:**
- Consumes: `postprocess` from `./lib/postprocess.mjs` (Task 3); the harness files (Task 4).
- Produces: `assets/registry/registry-<version>.json` and `assets/registry/registry.meta.json`. Exit 0 on success, 1 with a diagnostic on failure.

- [ ] **Step 1: Write the CLI**

Create `scripts/gen-registry.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Generate the Shesha component registry from framework source.
 *
 * Usage:
 *   node scripts/gen-registry.mjs --framework <path-to-shesha-framework> [--version 0.45.1]
 *   SHESHA_FRAMEWORK_PATH=... node scripts/gen-registry.mjs
 *
 * Copies the Jest harness into <framework>/shesha-reactjs/.shesha-registry-gen/,
 * runs it, post-processes the raw extraction, writes the registry, and removes
 * the scratch directory. The framework repo is never left modified.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postprocess } from './lib/postprocess.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');
const SCRATCH_DIR_NAME = '.shesha-registry-gen';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(`gen-registry: ${message}`);
  process.exit(1);
}

/** Read the framework's branch and commit so the registry records its provenance. */
function gitInfo(repoPath) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    sourceBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sourceCommit: git(['rev-parse', '--short', 'HEAD']),
  };
}

const frameworkPath = resolve(
  arg('--framework', process.env.SHESHA_FRAMEWORK_PATH ?? ''),
);
if (!frameworkPath || !existsSync(frameworkPath)) {
  fail('pass --framework <path> or set SHESHA_FRAMEWORK_PATH to the shesha-framework checkout');
}

const reactjsPath = join(frameworkPath, 'shesha-reactjs');
if (!existsSync(join(reactjsPath, 'package.json'))) {
  fail(`no shesha-reactjs package at ${reactjsPath}`);
}
if (!existsSync(join(reactjsPath, 'node_modules'))) {
  fail(`${reactjsPath}/node_modules is missing — run npm install there first`);
}

const scratch = join(reactjsPath, SCRATCH_DIR_NAME);
const rawOut = join(scratch, 'raw-extraction.json');

try {
  rmSync(scratch, { recursive: true, force: true });
  cpSync(join(HERE, 'harness'), scratch, { recursive: true });

  console.log('gen-registry: extracting from framework source (this takes ~60s)…');
  execFileSync(
    'npx',
    ['jest', '--config', join(SCRATCH_DIR_NAME, 'jest.config.cjs'), '--runTestsByPath',
     join(SCRATCH_DIR_NAME, 'extract.test.ts')],
    {
      cwd: reactjsPath,
      stdio: 'inherit',
      env: { ...process.env, SHESHA_REGISTRY_OUT: rawOut },
      shell: process.platform === 'win32',
    },
  );

  if (!existsSync(rawOut)) fail('the harness produced no output file');

  const raw = JSON.parse(readFileSync(rawOut, 'utf8'));
  const frameworkVersion = arg('--version', '0.45.1');
  const { registry, stats } = postprocess(raw, { frameworkVersion });

  const outDir = join(SKILL_ROOT, 'assets', 'registry');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, `registry-${frameworkVersion}.json`),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(outDir, 'registry.meta.json'),
    `${JSON.stringify({
      frameworkVersion,
      sourceRepo: 'shesha-io/shesha-framework',
      ...gitInfo(frameworkPath),
      generatedAtUtc: new Date().toISOString(),
      generatorVersion: 1,
      counts: {
        total: stats.total,
        authorable: stats.authorable,
        withoutVersion: stats.withoutVersion,
        withoutProps: stats.withoutProps,
      },
      droppedScaffoldingProps: stats.droppedScaffoldingProps,
      rawSummary: raw.summary ?? null,
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `gen-registry: ${stats.total} components ` +
    `(${stats.authorable} authorable, ${stats.withoutVersion} without version, ` +
    `${stats.withoutProps} without props); dropped ${stats.droppedScaffoldingProps} scaffolding props`,
  );
} finally {
  // Always clean up, including on failure, so the framework repo stays clean.
  rmSync(scratch, { recursive: true, force: true });
}
```

- [ ] **Step 2: Guard the raw extraction against being committed**

Create `assets/registry/.gitignore`:

```gitignore
# Only the post-processed registry and its metadata are committed.
raw-extraction.json
```

- [ ] **Step 3: Run the generator against the real framework**

```bash
node scripts/gen-registry.mjs --framework "C:/Users/Hashim/Documents/Git Repos/shesha-framework" --version 0.45.1
```
Expected: `116 components (…authorable…); dropped 467 scaffolding props`, and two files written under `assets/registry/`.

- [ ] **Step 4: Confirm the framework repo is untouched**

```bash
git -C "C:/Users/Hashim/Documents/Git Repos/shesha-framework" status --short
```
Expected: only the pre-existing untracked `shesha-reactjs-043/`. No `.shesha-registry-gen/`.

- [ ] **Step 5: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/scripts/gen-registry.mjs \
        plugins/shesha-developer/skills/shesha-form-edit/assets/registry/
```

---

### Task 6: Acceptance test on the committed registry

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/tests/registry-acceptance.test.mjs`

**Interfaces:**
- Consumes: the committed `assets/registry/registry-0.45.1.json`.
- Produces: nothing — it is the regression gate. It runs in `npm test` with no framework checkout, so it protects the registry from silent degradation on every future change.

These assertions encode the facts verified during planning. If a regeneration drops the component count or reintroduces scaffolding, this fails.

- [ ] **Step 1: Write the test**

Create `tests/registry-acceptance.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isScaffoldingProp } from '../scripts/lib/classify.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(
  readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'),
);
const C = registry.components;

test('pinned to the framework version this plugin targets', () => {
  assert.equal(registry.frameworkVersion, '0.45.1');
});

test('carries every registered component', () => {
  assert.equal(Object.keys(C).length, 116);
});

test('the hand index phantom is gone', () => {
  // `addressInput` was in assets/groups/index.json but does not exist in the framework.
  assert.equal(C.addressInput, undefined);
});

test('includes the types the hand index omitted', () => {
  for (const t of ['datatableContext', 'passwordCombo', 'divider', 'dynamicView',
                   'queryBuilder', 'labelValueEditor', 'formAutocomplete',
                   'referenceListAutocomplete', 'list', 'paragraph', 'title', 'toolbar']) {
    assert.ok(C[t], `${t} should be present`);
  }
});

test('versions match the framework, including the high ones', () => {
  assert.equal(C.container.version, 7);
  assert.equal(C.textField.version, 6);
  assert.equal(C.columns.version, 5);
  assert.equal(C.button.version, 9);
  assert.equal(C.dropdown.version, 11);
  assert.equal(C.datatable.version, 29);
  assert.equal(C.tabs.version, 4);
});

test('prop coverage is real, not the thin hand-index surface', () => {
  // The hand index gave container ~15 props.
  assert.ok(C.container.props.length >= 70, `container had ${C.container.props.length}`);
  assert.ok(C.textField.props.length >= 80);
  assert.ok(C.datatable.props.length >= 95);
});

test('no scaffolding survived into any prop list', () => {
  const leaked = [];
  for (const [type, c] of Object.entries(C)) {
    for (const p of c.props) if (isScaffoldingProp(p)) leaked.push(`${type}.${p}`);
  }
  assert.deepEqual(leaked, []);
});

test('legacy and dev components are recognised but not authorable', () => {
  assert.equal(C.datatableContext.authorable, false);
  assert.equal(C.datatableContext.authorableReason, 'hidden');
  assert.equal(C.paragraph.authorable, false);
  assert.equal(C.settingsInput.authorable, false);
  // But the current data wrapper IS authorable.
  assert.equal(C.dataContext.authorable, true);
});

test('customContainerNames capture child slots', () => {
  assert.deepEqual([...C.collapsiblePanel.customContainerNames].sort(),
    ['content', 'customHeader', 'header']);
});

test('a versionless component is null, never undefined-shaped', () => {
  const versionless = Object.values(C).filter((c) => c.version === null);
  assert.ok(versionless.length > 0, 'expected some components to have no migrator');
  for (const c of versionless) assert.equal(c.version, null);
});

test('every entry has its type field populated', () => {
  // The raw extraction omits `type`; postprocess lifts the key in.
  for (const [key, c] of Object.entries(C)) assert.equal(c.type, key);
});

test('file is deterministically sorted so regeneration diffs cleanly', () => {
  const keys = Object.keys(C);
  assert.deepEqual(keys, [...keys].sort());
});
```

- [ ] **Step 2: Run test to verify it fails if the registry is absent or wrong**

```bash
npm test
```
Expected: PASS if Task 5 produced a correct registry. If any assertion fails, the generator or the framework has changed — investigate before proceeding, do not weaken the assertion.

- [ ] **Step 3: Record the known-count facts in meta**

Confirm `assets/registry/registry.meta.json` reports `counts.total: 116` and a non-zero `droppedScaffoldingProps`. If `droppedScaffoldingProps` is 0, the denylist did not run — investigate.

- [ ] **Step 4: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/tests/registry-acceptance.test.mjs
```

---

### Task 7: Document the registry and deprecate the hand index

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/references/component-registry.md`
- Modify: `plugins/shesha-developer/skills/shesha-form-edit/SKILL.md` (the Step 5 "Component plan + index check" block, currently lines 159–171)

**Interfaces:**
- Consumes: the committed registry.
- Produces: the documented lookup path that Phase 2's validator and the skill body both reference.

The old `assets/groups/*.json` files are **not deleted in this phase** — `clean-form-config` still reads its own copies, and removing them before Phase 2 rewires the consumers would break the push path. This task marks them superseded; Phase 5 deletes them.

- [ ] **Step 1: Write the reference doc**

Create `references/component-registry.md`:

```markdown
# Component registry

`assets/registry/registry-0.45.1.json` — generated from Shesha framework source,
not hand-maintained. It is the authority for which component types exist, which
props each accepts, and each type's current `version`.

## Contents
- Looking a component up
- What `authorable` means
- Regenerating
- Why this replaced assets/groups/

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

## Why this replaced assets/groups/

The hand-maintained index carried 65 of 116 types, one type that does not exist
in the framework (`addressInput`), and ~15 props for `container` against a real 71.
Versions are per-component and unguessable (`tabs` 4, `container` 7, `dropdown` 11,
`datatable` 29), and a stale version silently drops a component's entire style block.
```

- [ ] **Step 2: Rewire the SKILL.md index check**

In `SKILL.md`, replace the numbered "Component plan + index check" list (currently items 1–5, lines 159–171) with:

```markdown
**Component plan + registry check (mandatory, blocking — before writing any component JSON)**:

1. **List every component `type` you plan to use.**
2. **Look each one up in `assets/registry/registry-0.45.1.json`** — the generated
   authority for types, props and versions ([component-registry.md](references/component-registry.md)).
   A type that is absent means you have the wrong name. A type with
   `authorable: false` must not be emitted — read `authorableReason` and pick the
   current equivalent.
3. **Take the `version` from the registry** and stamp it. `null` means the component
   has no migrator; omit `version` for those.
4. **Validate every prop against that type's `props` array.** Anything absent will be
   stripped at Step 6.
5. **Scan for a better fit** — e.g. `refListStatus` rather than `dropdown` for read-only
   status. For side-by-side layout use a flex `container` whose children are themselves
   `container`s, never the `columns` component (see the split rule below).
```

Leave the rest of Step 5 unchanged; the broader rule surgery is Phase 5.

- [ ] **Step 3: Verify no doc references a group file that this phase moved**

```bash
grep -rn "assets/groups" plugins/shesha-developer/skills/shesha-form-edit/ --include=*.md
```
Expected: the remaining hits are in files Phase 5 will rewrite. Note them; do not fix them here.

- [ ] **Step 4: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/references/component-registry.md \
        plugins/shesha-developer/skills/shesha-form-edit/SKILL.md
```

---

---

### Task 8: Style-role catalogue

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-design-system/assets/roles.styles.json`
- Create: `plugins/shesha-developer/skills/shesha-design-system/scripts/lib/resolve-role.mjs`
- Test: `plugins/shesha-developer/skills/shesha-design-system/tests/resolve-role.test.mjs`

**Interfaces:**
- Consumes: `registry-0.45.1.json` (Task 5), `assets/themes/<brand>.tokens.json`.
- Produces:
  - `resolveRole(roleName, {roles, tokens, componentType}) => {desktop, tablet, mobile}` — a fully-resolved style block with every token reference replaced by its literal value and `$inherit` expanded.
  - `validateRoles({roles, registry}) => string[]` — returns a list of problems: a role setting a prop its `componentType` does not have, or an unresolvable token reference. Empty array means valid.

The catalogue's values are token references (`"$spacing.6"`, `"$roles.pageBg"`), never literals, so a brand swap changes one file. `$inherit: "desktop"` avoids triplicating each block while still emitting all three breakpoints.

Roles required by the flow manifests in Task 9, so this task must define at minimum: `page-root`, `header-band`, `toolbar-row`, `toolbar-row-right`, `grid-surface`, `section-card`, `detail-rail`, `field-row`.

- [ ] **Step 1: Write the failing test**

Create `tests/resolve-role.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRole, validateRoles } from '../scripts/lib/resolve-role.mjs';

const tokens = {
  spacing: { 3: 12, 4: 16, 6: 24 },
  radius: { xs: 2, lg: 8 },
  palette: { surfaces: { canvas: '#F8F8F9' }, lines: { border: '#E8EAF0' } },
  roles: { pageBg: 'palette.surfaces.canvas', hairline: 'palette.lines.border' },
};

const roles = {
  'page-root': {
    componentType: 'container',
    desktop: {
      display: 'flex', flexDirection: 'column', gap: '$spacing.6',
      dimensions: { width: '100%', minHeight: 'fit-content' },
      background: { type: 'color', color: '$roles.pageBg' },
      stylingBox: { padding: '$spacing.6' },
    },
    tablet: { $inherit: 'desktop', stylingBox: { padding: '$spacing.4' } },
    mobile: { $inherit: 'desktop', stylingBox: { padding: '$spacing.3' } },
  },
};

test('resolves direct token references to literals', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.desktop.gap, 24);
  assert.equal(r.desktop.stylingBox.padding, 24);
});

test('resolves a role token that points at a palette path (two hops)', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.desktop.background.color, '#F8F8F9');
});

test('emits all three breakpoints', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  for (const bp of ['desktop', 'tablet', 'mobile']) assert.ok(r[bp], `${bp} missing`);
});

test('$inherit copies the base breakpoint then applies the override', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.tablet.display, 'flex');          // inherited
  assert.equal(r.tablet.flexDirection, 'column');  // inherited
  assert.equal(r.tablet.stylingBox.padding, 16);   // overridden ($spacing.4)
  assert.equal(r.mobile.stylingBox.padding, 12);   // overridden ($spacing.3)
});

test('$inherit does not leak the marker into output', () => {
  const r = resolveRole('page-root', { roles, tokens, componentType: 'container' });
  assert.equal(r.tablet.$inherit, undefined);
});

test('throws on an unknown role rather than returning an empty block', () => {
  assert.throws(() => resolveRole('no-such-role', { roles, tokens, componentType: 'container' }),
    /unknown role: no-such-role/);
});

test('throws on an unresolvable token reference', () => {
  const bad = { r: { componentType: 'container', desktop: { gap: '$spacing.99' } } };
  assert.throws(() => resolveRole('r', { roles: bad, tokens, componentType: 'container' }),
    /unresolvable token: \$spacing\.99/);
});

test('validateRoles rejects a prop the component type does not have', () => {
  const registry = { components: { container: { props: ['display', 'gap', 'dimensions.width'] } } };
  const bad = { r: { componentType: 'container', desktop: { display: 'flex', bogusProp: 1 } } };
  const problems = validateRoles({ roles: bad, registry });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bogusProp/);
});

test('validateRoles accepts a catalogue whose props all exist', () => {
  const registry = {
    components: { container: { props: ['display', 'flexDirection', 'gap', 'dimensions.width',
      'dimensions.minHeight', 'background.type', 'background.color', 'stylingBox'] } },
  };
  assert.deepEqual(validateRoles({ roles, registry }), []);
});

test('validateRoles rejects a role whose componentType is not in the registry', () => {
  const registry = { components: { container: { props: [] } } };
  const bad = { r: { componentType: 'notAThing', desktop: {} } };
  const problems = validateRoles({ roles: bad, registry });
  assert.match(problems[0], /notAThing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/shesha-developer/skills/shesha-design-system && npm test
```
Expected: FAIL — module not found. (Create `package.json` for this skill mirroring Task 1's, with `"test": "node --test tests/"`.)

- [ ] **Step 3: Implement `resolve-role.mjs`**

```javascript
/**
 * Resolve a style role into a complete, literal style block.
 *
 * Roles store TOKEN REFERENCES ("$spacing.6", "$roles.pageBg") so that a brand
 * swap changes one theme file. A `roles.*` token may itself point at a palette
 * path, so resolution follows references until it reaches a literal.
 */
const MAX_TOKEN_HOPS = 5;

function lookup(tokens, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tokens);
}

function resolveToken(ref, tokens) {
  let cur = ref;
  for (let hop = 0; hop < MAX_TOKEN_HOPS; hop++) {
    if (typeof cur !== 'string' || !cur.startsWith('$')) return cur;
    const found = lookup(tokens, cur.slice(1));
    if (found === undefined) throw new Error(`resolveRole: unresolvable token: ${cur}`);
    // A role token's value is a bare dotted path, not a $-prefixed one.
    cur = typeof found === 'string' && !found.startsWith('$') && found.includes('.')
      ? `$${found}`
      : found;
    if (typeof cur !== 'string' || !cur.startsWith('$')) return cur;
  }
  throw new Error(`resolveRole: token reference cycle at ${ref}`);
}

function resolveDeep(node, tokens) {
  if (Array.isArray(node)) return node.map((n) => resolveDeep(n, tokens));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$inherit') continue; // handled by the caller
      out[k] = resolveDeep(v, tokens);
    }
    return out;
  }
  return typeof node === 'string' && node.startsWith('$') ? resolveToken(node, tokens) : node;
}

/** Shallow-merge per top-level key, so `stylingBox` overrides wholesale rather than merging. */
function applyInherit(block, base) {
  const { $inherit, ...rest } = block;
  if (!$inherit) return rest;
  return { ...base, ...rest };
}

export function resolveRole(roleName, { roles, tokens }) {
  const role = roles?.[roleName];
  if (!role) throw new Error(`resolveRole: unknown role: ${roleName}`);

  const desktop = resolveDeep(role.desktop ?? {}, tokens);
  const out = { desktop };
  for (const bp of ['tablet', 'mobile']) {
    const raw = role[bp];
    // A breakpoint with no entry at all mirrors desktop — never left empty.
    out[bp] = raw ? applyInherit(resolveDeep(raw, tokens), desktop) : { ...desktop };
    if (raw?.$inherit) {
      // Re-apply overrides on top of the inherited base, resolved.
      const { $inherit, ...overrides } = raw;
      out[bp] = { ...desktop, ...resolveDeep(overrides, tokens) };
    }
  }
  return out;
}

/** Collect every leaf prop path a block sets, in registry `props` notation. */
function propPaths(node, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(node ?? {})) {
    if (k === '$inherit') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    // `stylingBox` is a single prop holding a JSON string, not a nested tree.
    if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'stylingBox') {
      out.push(...propPaths(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

export function validateRoles({ roles, registry }) {
  const problems = [];
  for (const [roleName, role] of Object.entries(roles ?? {})) {
    const type = role.componentType;
    const entry = registry?.components?.[type];
    if (!entry) {
      problems.push(`role "${roleName}": componentType "${type}" is not in the registry`);
      continue;
    }
    const valid = new Set(entry.props ?? []);
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      for (const p of propPaths(role[bp])) {
        if (!valid.has(p)) {
          problems.push(`role "${roleName}" (${bp}): "${p}" is not a prop of ${type}`);
        }
      }
    }
  }
  return problems;
}
```

- [ ] **Step 4: Author the catalogue**

Create `assets/roles.styles.json` with the eight roles named above. Every role sets, for `container` types, the complete contract: `display`, `flexDirection`, `flexWrap`, `gap`, `justifyContent`, `alignItems`, all six `dimensions.*`, `border.*`, `background.*`, `shadow.*`, `stylingBox`. Use the `page-root` block in spec §6.8 as the template. Values are token refs only — a literal hex in this file is a bug.

- [ ] **Step 5: Add a catalogue-validation test**

Append to `tests/resolve-role.test.mjs`:

```javascript
test('the shipped catalogue is valid against the registry and resolves fully', () => {
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(REG, 'registry-0.45.1.json'), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(ROOT, 'assets/themes/shesha.tokens.json'), 'utf8'));

  assert.deepEqual(validateRoles({ roles, registry }), []);

  for (const name of ['page-root', 'header-band', 'toolbar-row', 'toolbar-row-right',
                      'grid-surface', 'section-card', 'detail-rail', 'field-row']) {
    const r = resolveRole(name, { roles, tokens });
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      assert.ok(r[bp], `${name}.${bp} missing`);
      // No unresolved token markers may survive.
      assert.ok(!JSON.stringify(r[bp]).includes('"$'), `${name}.${bp} has unresolved tokens`);
    }
  }
});

test('container roles set the complete layout contract', () => {
  const roles = JSON.parse(readFileSync(join(ROOT, 'assets/roles.styles.json'), 'utf8'));
  const tokens = JSON.parse(readFileSync(join(ROOT, 'assets/themes/shesha.tokens.json'), 'utf8'));
  const REQUIRED = ['display', 'flexDirection', 'flexWrap', 'gap', 'justifyContent', 'alignItems'];
  const REQUIRED_DIM = ['width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight'];

  for (const [name, role] of Object.entries(roles)) {
    if (role.componentType !== 'container') continue;
    const r = resolveRole(name, { roles, tokens });
    for (const bp of ['desktop', 'tablet', 'mobile']) {
      for (const p of REQUIRED) {
        assert.notEqual(r[bp][p], undefined, `${name}.${bp}.${p} is unset`);
      }
      for (const d of REQUIRED_DIM) {
        assert.notEqual(r[bp].dimensions?.[d], undefined, `${name}.${bp}.dimensions.${d} is unset`);
      }
      assert.ok(r[bp].stylingBox !== undefined, `${name}.${bp}.stylingBox is unset`);
    }
  }
});
```

Add the imports these need at the top of the file: `readFileSync` from `node:fs`, `join`/`dirname` from `node:path`, `fileURLToPath` from `node:url`, and define `ROOT` (design-system skill root) and `REG` (`shesha-form-edit/assets/registry`).

- [ ] **Step 6: Run tests**

```bash
npm test
```
Expected: PASS. A failure naming an unset `dimensions.maxHeight` means the catalogue is incomplete — fill it, do not relax the test. That test is the mechanism enforcing "no empty configuration".

- [ ] **Step 7: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-design-system/assets/roles.styles.json \
        plugins/shesha-developer/skills/shesha-design-system/scripts/lib/resolve-role.mjs \
        plugins/shesha-developer/skills/shesha-design-system/tests/ \
        plugins/shesha-developer/skills/shesha-design-system/package.json
```

---

### Task 9: Archetype flow manifests

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-form-edit/assets/archetypes/table-worklist.flow.json`
- Create: `.../assets/archetypes/record-detail.flow.json`
- Create: `.../assets/archetypes/capture-dialog.flow.json`
- Create: `.../assets/archetypes/standalone-capture.flow.json`
- Create: `plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/flow.mjs`
- Create: `plugins/shesha-developer/skills/shesha-form-edit/references/archetypes.md`
- Test: `plugins/shesha-developer/skills/shesha-form-edit/tests/flow.test.mjs`

**Interfaces:**
- Consumes: `registry-0.45.1.json` (Task 5).
- Produces:
  - `loadFlow(archetype, {dir}) => flowManifest`
  - `validateFlow(flow, {registry}) => string[]` — problems: a `type` absent from the registry, a `type` that is `authorable: false`, a `role` not in the catalogue, a `slot` naming a node that does not exist, a `dependsOn` with no matching `dependencies[].id`.
  - `requiredNodes(flow) => Array<{node, type, role?, slot?, dependsOn?}>` — the flat set a build must produce.

This is the artifact that fixes blueprints whose assertions demand components the layout tree never declared. It also finally writes `references/archetypes.md`, which `blueprint-ir.md` has been citing as the definition of the eight archetypes while the file did not exist.

**Archetype vocabulary — one list, replacing the three that were in use.** The eight, each with its flow manifest and seed:

| Archetype | Flow manifest | Purpose |
|---|---|---|
| `table-worklist` | `table-worklist.flow.json` | dense admin grid: dataContext + toolbar + datatable + pager |
| `record-detail` | `record-detail.flow.json` | per-record page: header band + body split + related panels |
| `capture-dialog` | `capture-dialog.flow.json` | modal create/edit hosted by a parent's Add action |
| `standalone-capture` | `standalone-capture.flow.json` | full-page create/edit with Submit + Back |
| `list-card` | Phase 5 | datalist of row-template cards |
| `hub` | Phase 5 | landing page of navigation tiles |
| `dashboard` | Phase 5 | metric tiles + charts |
| `wizard` | Phase 5 | multi-step capture |

The four built here cover the flows the corpus and the eval cases actually exercise; the remaining four get manifests in Phase 5 rather than being stubbed now. `references/archetypes.md` states this explicitly so the list is not mistaken for complete.

- [ ] **Step 1: Write the failing test**

Create `tests/flow.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFlow, validateFlow, requiredNodes } from '../scripts/lib/flow.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'assets/archetypes');
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const roles = JSON.parse(readFileSync(
  join(ROOT, '../shesha-design-system/assets/roles.styles.json'), 'utf8'));

test('loads the table-worklist manifest', () => {
  const flow = loadFlow('table-worklist', { dir: DIR });
  assert.equal(flow.archetype, 'table-worklist');
});

test('table-worklist requires the components its assertions imply', () => {
  // The failure this fixes: a blueprint declared heading/text/datatable while its
  // assertions demanded an Add action, row action, quick search and pager.
  const types = requiredNodes(loadFlow('table-worklist', { dir: DIR })).map((n) => n.type);
  for (const t of ['dataContext', 'container', 'buttonGroup', 'datatable',
                   'datatable.quickSearch', 'datatable.pager']) {
    assert.ok(types.includes(t), `flow must require ${t}`);
  }
});

test('table-worklist declares its create and detail dependencies', () => {
  const flow = loadFlow('table-worklist', { dir: DIR });
  const ids = flow.dependencies.map((d) => d.id);
  assert.ok(ids.includes('createForm'));
  assert.ok(ids.includes('detailForm'));
  for (const d of flow.dependencies) {
    assert.ok(d.archetype, `dependency ${d.id} needs an archetype`);
    assert.ok(d.naming, `dependency ${d.id} needs a naming rule`);
  }
});

test('standalone-capture requires validationErrors and a Submit/exit pair', () => {
  const nodes = requiredNodes(loadFlow('standalone-capture', { dir: DIR }));
  assert.ok(nodes.some((n) => n.type === 'validationErrors'));
  const bg = nodes.find((n) => n.type === 'buttonGroup');
  assert.ok(bg, 'needs a buttonGroup');
  assert.match(JSON.stringify(bg), /Submit/);
  assert.match(JSON.stringify(bg), /Navigate|Close Dialog|Cancel Edit/);
});

test('every shipped manifest validates against the registry and role catalogue', () => {
  for (const a of ['table-worklist', 'record-detail', 'capture-dialog', 'standalone-capture']) {
    const problems = validateFlow(loadFlow(a, { dir: DIR }), { registry, roles });
    assert.deepEqual(problems, [], `${a}: ${problems.join('; ')}`);
  }
});

test('validateFlow rejects a type absent from the registry', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'notAThing' }] }, { registry, roles });
  assert.match(problems[0], /notAThing/);
});

test('validateFlow rejects a non-authorable type', () => {
  // datatableContext is "Data Context (Legacy)", isHidden — recognisable but never authored.
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'datatableContext' }] }, { registry, roles });
  assert.match(problems[0], /datatableContext.*authorable/);
});

test('validateFlow rejects a role missing from the catalogue', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'container', role: 'no-such-role' }] },
    { registry, roles });
  assert.match(problems[0], /no-such-role/);
});

test('validateFlow rejects a slot pointing at a node that does not exist', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'container', role: 'page-root', slot: 'ghost' }] },
    { registry, roles });
  assert.match(problems[0], /ghost/);
});

test('validateFlow rejects a dependsOn with no matching dependency', () => {
  const problems = validateFlow(
    { archetype: 'x', requires: [{ node: 'a', type: 'buttonGroup', dependsOn: 'missingDep' }],
      dependencies: [] }, { registry, roles });
  assert.match(problems[0], /missingDep/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && npm test
```
Expected: FAIL — `Cannot find module '../scripts/lib/flow.mjs'`.

- [ ] **Step 3: Implement `flow.mjs`**

```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadFlow(archetype, { dir }) {
  return JSON.parse(readFileSync(join(dir, `${archetype}.flow.json`), 'utf8'));
}

/** The flat set of nodes a build must produce for this archetype. */
export function requiredNodes(flow) {
  return flow?.requires ?? [];
}

/**
 * Validate a flow manifest against the component registry and role catalogue.
 * Returns a list of human-readable problems; empty means valid.
 */
export function validateFlow(flow, { registry, roles }) {
  const problems = [];
  const nodes = requiredNodes(flow);
  const nodeNames = new Set(nodes.map((n) => n.node));
  const depIds = new Set((flow?.dependencies ?? []).map((d) => d.id));

  for (const n of nodes) {
    const entry = registry?.components?.[n.type];
    if (!entry) {
      problems.push(`${flow.archetype}/${n.node}: type "${n.type}" is not in the registry`);
    } else if (entry.authorable === false) {
      problems.push(
        `${flow.archetype}/${n.node}: type "${n.type}" is not authorable (${entry.authorableReason})`,
      );
    }
    if (n.role && !roles?.[n.role]) {
      problems.push(`${flow.archetype}/${n.node}: role "${n.role}" is not in the catalogue`);
    }
    if (n.slot && !nodeNames.has(n.slot)) {
      problems.push(`${flow.archetype}/${n.node}: slot "${n.slot}" names no node in this flow`);
    }
    if (n.dependsOn && !depIds.has(n.dependsOn)) {
      problems.push(`${flow.archetype}/${n.node}: dependsOn "${n.dependsOn}" has no dependency entry`);
    }
    for (const child of n.children ?? []) {
      if (!nodeNames.has(child)) {
        problems.push(`${flow.archetype}/${n.node}: child "${child}" names no node in this flow`);
      }
    }
  }
  return problems;
}
```

- [ ] **Step 4: Author the four manifests**

Use the `table-worklist` manifest in spec §6.8 verbatim as the first. The other three follow the same shape. `standalone-capture` must require `validationErrors` and a `buttonGroup` carrying both `Submit`/`shesha.form` and `Navigate`/`shesha.common` — the Submit-plus-exit pair that `form-quality.md` documents as the most-forgotten case.

- [ ] **Step 5: Write `references/archetypes.md`**

The file `blueprint-ir.md:40` has been citing. Content: the eight archetypes in one table (name · flow manifest · seed/exemplar · when to use), the note that four have manifests now and four land in Phase 5, and the statement that this file is the single archetype vocabulary — superseding the partial lists in `blueprint-consumption.md` and the `$archetype` values in `assets/blocks/*.block.json`, which Phase 5 reconciles.

- [ ] **Step 6: Run tests**

```bash
npm test
```
Expected: PASS — 10 tests in `flow.test.mjs`.

- [ ] **Step 7: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-form-edit/assets/archetypes/ \
        plugins/shesha-developer/skills/shesha-form-edit/scripts/lib/flow.mjs \
        plugins/shesha-developer/skills/shesha-form-edit/references/archetypes.md \
        plugins/shesha-developer/skills/shesha-form-edit/tests/flow.test.mjs
```

---

### Task 10: Styled-blueprint schema and ASCII placement renderer

**Files:**
- Create: `plugins/shesha-developer/skills/shesha-design-comprehension/assets/blueprint.schema.json`
- Create: `plugins/shesha-developer/skills/shesha-design-comprehension/scripts/lib/render-mock.mjs`
- Modify: `plugins/shesha-developer/skills/shesha-design-comprehension/references/blueprint-ir.md`
- Test: `plugins/shesha-developer/skills/shesha-design-comprehension/tests/render-mock.test.mjs`

**Interfaces:**
- Consumes: a resolved blueprint (nodes carrying `role` and resolved style), the role catalogue (Task 8), flow manifests (Task 9).
- Produces:
  - `renderMock(blueprint) => string` — the ASCII placement mock.
  - Draws from the **same resolved tree the compiler will consume**, so the mock cannot drift from what gets built. That is the whole point: a hand-drawn wireframe drifts, a rendered one cannot.

- [ ] **Step 1: Write the failing test**

Create `tests/render-mock.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMock } from '../scripts/lib/render-mock.mjs';

const blueprint = {
  screen: 'Bookings Register',
  archetype: 'table-worklist',
  viewport: '1440x900',
  nodes: [
    { node: 'page', type: 'container', role: 'page-root',
      style: { desktop: { display: 'flex', flexDirection: 'column', gap: 24,
        dimensions: { width: '100%', minHeight: 'fit-content' }, stylingBox: { padding: 24 } } },
      children: ['pageHeader', 'toolbar', 'table'] },
    { node: 'pageHeader', type: 'container', role: 'header-band', slot: 'page',
      style: { desktop: { display: 'flex', flexDirection: 'column', gap: 4,
        dimensions: { width: '100%' } } }, children: ['title'] },
    { node: 'title', type: 'text', slot: 'pageHeader', content: 'Bookings' },
    { node: 'toolbar', type: 'container', role: 'toolbar-row', slot: 'page',
      style: { desktop: { display: 'flex', flexDirection: 'row', gap: 12,
        justifyContent: 'space-between', dimensions: { width: '100%' } } }, children: [] },
    { node: 'table', type: 'datatable', role: 'grid-surface', slot: 'page',
      columns: ['bookingReference', 'passengerLastName'], addedBy: 'flow-manifest' },
  ],
};

test('renders a box for every node', () => {
  const out = renderMock(blueprint);
  for (const n of ['page', 'pageHeader', 'toolbar', 'table']) {
    assert.match(out, new RegExp(n), `${n} missing from mock`);
  }
});

test('annotates each container with its role', () => {
  const out = renderMock(blueprint);
  assert.match(out, /role: page-root/);
  assert.match(out, /role: toolbar-row/);
});

test('shows the resolved layout values, not token references', () => {
  const out = renderMock(blueprint);
  assert.match(out, /flex column/);
  assert.match(out, /gap 24/);
  assert.match(out, /flex row/);
  assert.match(out, /justify:space-between/);
});

test('shows the dimensions contract including minH', () => {
  const out = renderMock(blueprint);
  assert.match(out, /w:100%/);
  assert.match(out, /minH:fit-content/);
});

test('nests children inside their slot parent', () => {
  const out = renderMock(blueprint).split('\n');
  const pageIdx = out.findIndex((l) => l.includes('page ') || l.includes('─ page'));
  const headerIdx = out.findIndex((l) => l.includes('pageHeader'));
  assert.ok(pageIdx < headerIdx, 'pageHeader should render inside page');
  // Indentation increases with depth.
  const indent = (l) => l.length - l.trimStart().length;
  assert.ok(indent(out[headerIdx]) > indent(out[pageIdx]));
});

test('marks nodes the flow manifest added rather than the prompt', () => {
  const out = renderMock(blueprint);
  assert.match(out, /flow/i);
});

test('renders datatable columns as a header row', () => {
  const out = renderMock(blueprint);
  assert.match(out, /bookingReference|Ref/);
});

test('output uses box-drawing characters and is stable', () => {
  const a = renderMock(blueprint);
  const b = renderMock(blueprint);
  assert.equal(a, b);
  assert.match(a, /[┌└│─]/);
});

test('throws rather than rendering an empty mock for a blueprint with no nodes', () => {
  assert.throws(() => renderMock({ nodes: [] }), /no nodes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/shesha-developer/skills/shesha-design-comprehension && npm test
```
Expected: FAIL — module not found. (Add a `package.json` with `"test": "node --test tests/"` as in Task 1.)

- [ ] **Step 3: Implement `render-mock.mjs`**

Render depth-first from the roots (nodes with no `slot`), one box per container, indenting by depth. Per container emit a summary line built from the resolved desktop style: `flex <direction> · gap <n> · justify:<v> · align:<v> · w:<width> minH:<minHeight> · pad <n>`. Annotate the box header with `<node> ─── role: <role>`, and append `(added by flow)` when `addedBy === 'flow-manifest'`. For a `datatable`, draw a header row from `columns`. Throw `new Error('renderMock: no nodes')` on an empty tree rather than emitting an empty frame.

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: PASS — 9 tests.

- [ ] **Step 5: Update `blueprint-ir.md`**

Replace the Markdown-prose `layout-tree` grammar with the three synchronised representations from spec §6.8: the ASCII mock, the machine blocks, and the flow-manifest expansion. Include the rendered Bookings mock as the worked example. Fix the two arithmetic defects while in the file: the same worked example currently says `calc(100% - 348px)` in one place and `356px` in another for a 332px rail with a 24px gap — state the derived form `calc(100% - <rail+gap>px)` and give one internally consistent example. Remove the dangling `childWidths` dependency note or mark it as Phase 2 work (the probe does not emit that field yet).

- [ ] **Step 6: Stage**

```bash
git add plugins/shesha-developer/skills/shesha-design-comprehension/
```

---

## Phase gate

Before requesting approval:

- [ ] `npm test` passes in all three skill directories — `shesha-form-edit` (smoke, classify 8, postprocess 10, acceptance 12, flow 10), `shesha-design-system` (resolve-role 12), `shesha-design-comprehension` (render-mock 9).
- [ ] `roles.styles.json` contains zero literal hex values — every colour is a token reference.
- [ ] Every `container` role sets all six `dimensions.*` on all three breakpoints (enforced by the Task 8 Step 5 test).
- [ ] All four flow manifests validate against the registry and role catalogue with zero problems.
- [ ] `references/archetypes.md` exists — `blueprint-ir.md` has cited it while it did not.
- [ ] `assets/registry/registry-0.45.1.json` and `registry.meta.json` are present and report 116 components.
- [ ] `git -C <framework> status --short` shows no scratch directory — the framework repo is clean.
- [ ] `git status` in shesha-plugins shows only intended files; no corpus JSONL, no `raw-extraction.json`.
- [ ] Plugin version bumped in `plugins/shesha-developer/.claude-plugin/plugin.json` — `1.8.3` → `1.8.4` (patch: enhancement to an existing skill).

Then present for approval. **Commit only after the user approves.** Proposed message:

```
[feature]- Generate shesha-form-edit component registry from framework source

Replaces the hand-maintained assets/groups index, which carried 65 of the
framework's 116 component types, one type that does not exist (addressInput),
and ~15 props for container against a real 71.

- scripts/gen-registry.mjs extracts types, settings-form prop paths and
  migrator versions from a pinned framework checkout (0.45.1 @ d16734774)
- lib/classify.mjs drops 467 settings-form scaffolding prop entries and
  classifies authorability, so legacy/dev/hidden types stay recognisable
  for validation without being authorable
- acceptance test locks the counts, versions and prop coverage so a
  regeneration cannot silently degrade the registry

Groups files are left in place; their consumers are rewired in Phase 5.
```

## What Phase 2 consumes from this

The validator's `T1-TYPE-UNKNOWN`, `T1-PROP-UNKNOWN`, `T1-VERSION-MISSING` and
`T1-VERSION-STALE` checks all read `registry.components`. Two behaviours this phase
establishes that Phase 2 must honour:

- `authorable: false` types are **valid in markup** but must be flagged by a separate,
  softer check (`T3-NON-AUTHORABLE-TYPE`) rather than `T1-TYPE-UNKNOWN` — otherwise the
  validator rejects the 9 corpus forms containing `datatableContext`.
- `version: null` types are **exempt from the version checks** — the framework itself
  does not version them.
