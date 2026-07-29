# Phase 2: Validator, Normalizer and the Blocking Hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the external oracle the design pipeline has never had — a deterministic validator with real exit codes, a normalizer that fills in what the model would otherwise omit, and a `PreToolUse` hook that makes "you cannot push an invalid form" a fact rather than a prose rule.

**Architecture:** `validate-form.mjs` reads the Phase 1 registry and reports findings in three tiers: Tier 1 renderability and Tier 2 contract are hard failures with exit 1; Tier 3 is a 0–100 score that never blocks. `normalize-form.mjs` is a pure, idempotent transform that expands a node's `role` into the complete style block from the Phase 1 role catalogue and strips provably-inert values. A plugin hook runs normalize→validate on every form push and denies the tool call on a Tier 1/2 failure.

**Tech Stack:** Node 25, `node --test` (built in), zero dependencies.

## Global Constraints

- **Framework pinned to 0.45.1.** Registry: `shesha-form-edit/assets/registry/registry-0.45.1.json`, 116 components, generated from `releases/0.45` @ `d16734774`. Never regenerate it in this phase.
- **Forward slashes only** in paths written into files.
- **Zero dependencies.** No `node_modules` in the plugin. `node:test` + `node:assert/strict` only.
- **Never author or emit a `columns` component.** Flex `container`s are the only split mechanism.
- **`authorable: false` types are VALID in existing markup.** They must never raise a Tier 1 unknown-type failure — only a Tier 3 observation. Nine production forms contain `datatableContext`; rejecting them would make the hook unusable.
- **`version: null` types are exempt from every version check.** 21 of 116 genuinely have no migrator, including `dataContext`.
- **Tier 3 never blocks.** It scores. Only Tier 1 and Tier 2 gate a push.
- **The hook ships disabled** until Task 5 measures its false-positive rate against the real corpus. Shipping a blocking gate on an unmeasured validator is worse than shipping no gate.
- Plugin version bump per `CLAUDE.md`: currently `1.8.8`; patch per push.

## Facts established in Phase 1 that this phase consumes

| Fact | Value |
|---|---|
| Registry components | 116 · 97 authorable · 21 `version: null` · 18 with 0 props |
| Prop surface (post-filter) | `container` 63 · `textField` 74 · `datatable` 92 · `columns` 50 · `button` 61 · `dropdown` 133 · `tabs` 96 |
| Style roles | 15, in `shesha-design-system/assets/roles.styles.json` |
| Role resolution | `resolveRole(name, {roles, tokens})` → `{desktop, tablet, mobile}`, all token refs resolved to literals; throws on an unknown role or unresolvable token |
| Role completeness contract | every role sets `display`, `flexDirection`, `flexWrap`, `gap`, `justifyContent`, `alignItems`, all six `dimensions.*`, `stylingBox` on all three breakpoints |
| Archetype manifests | 8, in `shesha-form-edit/assets/archetypes/*.flow.json` |
| Flow API | `loadFlow(archetype,{dir})`, `validateFlow(flow,{registry,roles})`, `requiredNodes(flow)` |
| Corpus access | SQL Server `localhost,1433`, `sa`/`@123Shesha`; table `frwk.form_configurations` joined via `frwk.configuration_item_revisions` → `frwk.configuration_items` → `frwk.modules`. DBs: `RequirementsStudio` (233 forms), `AssetManagement2`, `MembershipManagement`, `UtilityManagement` |
| Corpus baseline (100 RS forms, 3,068 components) | `validationErrors` in 47/100 · loose `button` in 35/100 · 164 versionless components · 22/100 use `columns` · 49/100 have no split at all · `customStyle` 0 occurrences · 1,132 non-containers carry `dimensions.width` |

That last row is why Task 5 exists: the corpus does **not** satisfy the rules, so the validator's first real run will produce thousands of findings. Distinguishing "the corpus is genuinely wrong" from "my check is wrong" is the gate on enabling the hook.

## File Structure

```
plugins/shesha-developer/skills/shesha-form-edit/
├── scripts/
│   ├── validate-form.mjs              CREATE  CLI: exit 0/1, --json
│   ├── normalize-form.mjs             CREATE  CLI: pure, idempotent
│   ├── grade-corpus.mjs               CREATE  mine + normalize + validate + rank
│   └── lib/
│       ├── walk.mjs                   CREATE  one tree walker, shared
│       ├── tier1.mjs                  CREATE  renderability checks
│       ├── tier2.mjs                  CREATE  contract checks
│       ├── tier3.mjs                  CREATE  scoring
│       └── expand-style.mjs           CREATE  role -> complete block (bridges to design-system)
├── tests/
│   ├── walk.test.mjs                  CREATE
│   ├── tier1.test.mjs                 CREATE  one failing fixture per code
│   ├── tier2.test.mjs                 CREATE  one failing fixture per code
│   ├── tier3.test.mjs                 CREATE
│   ├── normalize.test.mjs             CREATE  incl. idempotence over the corpus
│   └── fixtures/                      CREATE  minimal per-code form fixtures
plugins/shesha-developer/hooks/
├── hooks.json                         CREATE  PreToolUse + Stop
└── validate-push.mjs                  CREATE  hook entry point
```

**Why `tier1`/`tier2`/`tier3` are separate files:** each is a list of independent predicates, they change at different rates, and a reviewer can accept one tier's checks while rejecting another's. `walk.mjs` exists because all three need identical traversal semantics — a tree walked two different ways is two different validators.

---

### Task 1: The tree walker

**Files:** Create `scripts/lib/walk.mjs`, `tests/walk.test.mjs`

**Interfaces produced:**
- `walk(components, visit)` — depth-first over a form's component tree. `visit(node, ctx)` where `ctx` is `{depth, parent, path, slot}`. `path` is a JSON-pointer-ish string for finding a node in error messages (`components[0].components[2]`).
- `flatten(components) => Array<{node, ctx}>`
- `CHILD_KEYS` — the exported list of keys that hold children.

Child-bearing keys, from the registry's `customContainerNames` plus the framework's own container conventions: `components`, `columns`, `tabs` (array of `{components}`), `content.components`, `header.components`, `customHeader.components`, `items`. A `columns` component holds slot objects that have no `type` of their own — the walker must descend through them without treating them as components.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk, flatten, CHILD_KEYS } from '../scripts/lib/walk.mjs';

const tree = [
  { id: 'a', type: 'container', components: [
    { id: 'b', type: 'textField' },
    { id: 'c', type: 'card', content: { components: [{ id: 'd', type: 'text' }] } },
  ] },
  { id: 'e', type: 'tabs', tabs: [
    { key: 't1', components: [{ id: 'f', type: 'textField' }] },
    { key: 't2', components: [{ id: 'g', type: 'textField' }] },
  ] },
];

test('visits every typed node exactly once', () => {
  const seen = [];
  walk(tree, (n) => seen.push(n.id));
  assert.deepEqual(seen.sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('reports depth and parent', () => {
  const byId = {};
  walk(tree, (n, ctx) => { byId[n.id] = { depth: ctx.depth, parent: ctx.parent?.id ?? null }; });
  assert.deepEqual(byId.a, { depth: 0, parent: null });
  assert.deepEqual(byId.b, { depth: 1, parent: 'a' });
  assert.deepEqual(byId.d, { depth: 2, parent: 'c' });
  assert.deepEqual(byId.f, { depth: 1, parent: 'e' });
});

test('descends through a card content slot', () => {
  const seen = [];
  walk(tree, (n) => seen.push(n.id));
  assert.ok(seen.includes('d'), 'card content.components child was missed');
});

test('records the tab key a node sits under', () => {
  const slots = {};
  walk(tree, (n, ctx) => { slots[n.id] = ctx.slot; });
  assert.equal(slots.f, 't1');
  assert.equal(slots.g, 't2');
  assert.equal(slots.b, undefined);
});

test('descends through columns slot objects without treating them as components', () => {
  const withCols = [{ id: 'x', type: 'columns', columns: [
    { flex: 12, components: [{ id: 'y', type: 'textField' }] },
  ] }];
  const seen = [];
  walk(withCols, (n) => seen.push(n.id));
  // The slot object has no `type`, so it is traversed but not visited.
  assert.deepEqual(seen, ['x', 'y']);
});

test('produces a path usable in an error message', () => {
  const paths = {};
  walk(tree, (n, ctx) => { paths[n.id] = ctx.path; });
  assert.match(paths.b, /components/);
  assert.notEqual(paths.b, paths.g);
});

test('flatten returns one entry per node', () => {
  assert.equal(flatten(tree).length, 7);
});

test('tolerates a malformed tree without throwing', () => {
  assert.doesNotThrow(() => walk([null, undefined, { id: 'z' }, { type: 'text' }], () => {}));
});

test('CHILD_KEYS covers the framework slot names', () => {
  for (const k of ['components', 'columns', 'tabs', 'items']) assert.ok(CHILD_KEYS.includes(k));
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`, expect module-not-found.
- [ ] **Step 3: Implement `walk.mjs`.** Handle: arrays, `null`/`undefined` entries, nodes without `type` (traverse, don't visit), `tabs[].components` carrying the tab `key` into `ctx.slot`, and `content`/`header`/`customHeader` object slots.
- [ ] **Step 4: Run — all pass.**
- [ ] **Step 5: Commit.**

---

### Task 2: Tier 1 — renderability checks

**Files:** Create `scripts/lib/tier1.mjs`, `tests/tier1.test.mjs`, `tests/fixtures/`

**Interfaces produced:** `tier1(markup, {registry}) => Finding[]` where a `Finding` is
`{tier: 1, code, severity: 'fail', path, message, expected, actual}`.

Every check below has a real crash story in this codebase — telemetry recorded 32 render-crash signatures in a 2-day window.

| Code | Predicate | Why |
|---|---|---|
| `T1-TYPE-UNKNOWN` | `node.type` exists in `registry.components` | an unknown type renders nothing |
| `T1-PROP-UNKNOWN` | every own prop key of the node exists in that type's `props` | unknown props are stripped, so the setting silently does nothing |
| `T1-VERSION-MISSING` | node has an integer `version` — **skipped when the registry says `version: null`** | absent version is treated as `-1`, re-running the entire legacy migration chain, which throws `e.match is not a function` / `reading 'migrator'` |
| `T1-VERSION-STALE` | `version` equals the registry's version for that type | a stale version can silently drop the component's whole `desktop` style block |
| `T1-ID-NOT-UUID` | `id` matches a v4-shaped UUID | the renderer ignores components with non-UUID ids, blanking the form |
| `T1-ID-DUPLICATE` | ids unique tree-wide | the renderer keys by id: one renders twice, the other vanishes |
| `T1-PARENT-MISSING` | `parentId` present, and resolves to an ancestor id or the literal `"root"` | missing `parentId` crashes the renderer with no useful error |
| `T1-DEFAULTVALUE-NONSTRING` | `defaultValue`, if present, is a string | the resolver calls `.match()` on it; a literal array/number/object throws |
| `T1-EDITCOMPONENT-SHAPE` | a datatable column's `editComponent`/`createComponent` is `{type:"[not-editable]"}` or `{type, settings:{…}}` | `[default]` → `reading 'migrator'`; a flat model without `settings` → `reading 'version'` |
| `T1-DOUBLE-SLOT` | no `card`/`collapsiblePanel` has children in BOTH `content.components` and `components[]` | renders its body twice, often with colliding ids |
| `T1-SCRIPT-SYNTAX` | every script-valued string parses | a broken script string produces a JSON parse error in the browser |
| `T1-JSON-UNSAFE` | no script/endpoint string contains a template literal or a raw newline | breaks the outer `JSON.stringify` on push |

- [ ] **Step 1: Write one minimal failing fixture and one assertion per code.** Each fixture is the smallest form that trips exactly that code, in `tests/fixtures/t1-<code>.json`. Also write a `t1-clean.json` that trips nothing, and assert `tier1(clean) === []`.

Representative assertions:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier1 } from '../scripts/lib/tier1.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(ROOT, 'assets/registry/registry-0.45.1.json'), 'utf8'));
const fx = (n) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/${n}.json`), 'utf8'));
const codes = (m) => tier1(m, { registry }).map((f) => f.code);

test('a clean form produces no Tier 1 findings', () => {
  assert.deepEqual(tier1(fx('t1-clean'), { registry }), []);
});

test('flags an unknown component type', () => {
  assert.ok(codes(fx('t1-type-unknown')).includes('T1-TYPE-UNKNOWN'));
});

test('does NOT flag a non-authorable type as unknown', () => {
  // datatableContext is isHidden/legacy but appears in 9 production forms.
  // Rejecting it here would make the push hook unusable on real projects.
  const m = { components: [{ id: crypto.randomUUID(), type: 'datatableContext', parentId: 'root', version: 8 }] };
  assert.ok(!codes(m).includes('T1-TYPE-UNKNOWN'));
});

test('exempts a registry-null-version type from the version checks', () => {
  // dataContext genuinely has no migrator; demanding a version would be wrong.
  const m = { components: [{ id: crypto.randomUUID(), type: 'dataContext', parentId: 'root' }] };
  const c = codes(m);
  assert.ok(!c.includes('T1-VERSION-MISSING'));
  assert.ok(!c.includes('T1-VERSION-STALE'));
});

test('flags a versionless component whose type IS versioned', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root' }] };
  assert.ok(codes(m).includes('T1-VERSION-MISSING'));
});

test('flags a stale version', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'datatable', parentId: 'root', version: 11 }] };
  assert.ok(codes(m).includes('T1-VERSION-STALE'));  // registry says 29
});

test('flags a literal-array defaultValue', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root',
    version: 6, defaultValue: ['a', 'b'] }] };
  assert.ok(codes(m).includes('T1-DEFAULTVALUE-NONSTRING'));
});

test('accepts a mustache-string defaultValue', () => {
  const m = { components: [{ id: crypto.randomUUID(), type: 'textField', parentId: 'root',
    version: 6, defaultValue: '{{data.name}}' }] };
  assert.ok(!codes(m).includes('T1-DEFAULTVALUE-NONSTRING'));
});

test('every finding carries a path and a diagnosable message', () => {
  for (const f of tier1(fx('t1-id-duplicate'), { registry })) {
    assert.ok(f.path, `${f.code} has no path`);
    assert.ok(f.message && f.message.length > 10, `${f.code} message is not diagnosable`);
    assert.equal(f.tier, 1);
  }
});
```

- [ ] **Step 2: Run — fails on the missing module.**
- [ ] **Step 3: Implement `tier1.mjs`** using `walk` from Task 1. Each check is a small named function; `tier1` composes them. Error messages must name the offending value and the expected one — a validator whose message is "invalid" cannot be acted on.
- [ ] **Step 4: Run — all pass, and `t1-clean` yields zero findings.**
- [ ] **Step 5: Commit.**

---

### Task 3: Tier 2 — contract checks

**Files:** Create `scripts/lib/tier2.mjs`, `tests/tier2.test.mjs`, more fixtures

**Interfaces produced:** `tier2(markup, {registry, roles, flows}) => Finding[]`, `Finding.tier === 2`.

| Code | Predicate |
|---|---|
| `T2-COLUMNS-PRESENT` | no `columns` component anywhere |
| `T2-FLEXCHILD-NOT-CONTAINER` | every direct child of a flex-row container is itself a `container` |
| `T2-WIDTH-ON-NONCONTAINER` | no `dimensions.width` on a non-container type |
| `T2-FLEX-NO-DISPLAY` | a container setting `gap`/`flexDirection`/`justifyContent`/`alignItems` also sets `display:"flex"` |
| `T2-NODEFAULTSTYLING-DROPS-STYLE` | no container has `noDefaultStyling:true` while also carrying `dimensions`/`border`/`background`/`shadow` |
| `T2-STYLE-INCOMPLETE` | every container carries the full layout contract on all three breakpoints |
| `T2-STYLE-OFF-TOKEN` | every style value matches a theme token, or is an override carrying `source` + `evidence` |
| `T2-VALIDATIONERRORS-MISSING` | a `validationErrors` node exists when any input has `validate.required` |
| `T2-SUBMIT-WIRING` | the Save item is `actionName:"Submit"`, `actionOwner:"shesha.form"` |
| `T2-EXIT-MISSING` | a paired exit action exists for the host type |
| `T2-LOOSE-BUTTON` | no standalone `button` in an action row |
| `T2-PROPERTYNAME-CASE` | every `propertyName` is camelCase, including datatable column `propertyName`s |
| `T2-DROPDOWN-SOURCE` | `dataSourceType` present with its mandatory config |
| `T2-DATE-COMPONENT` | date/date-time properties use `dateField` |
| `T2-MODELTYPE-SHAPE` | `formSettings.modelType` is `{name, module}` |
| `T2-EDITMODE-MISMATCH` | `editMode` matches the form-type table |
| `T2-DATACONTEXT-PROPS` | `dataContext` carries `entityType`, `sourceType`, `dataFetchingMode`, `defaultPageSize`, `uniqueStateId` |
| `T2-FLOW-INCOMPLETE` | every node the archetype's manifest requires is present |
| `T2-DANGLING-FORMREF` | every `actionArguments.formId` / row-action `targetUrl` names a form that exists |

`T2-FLOW-INCOMPLETE` needs the form's archetype. Take it from an explicit argument when supplied, otherwise skip the check — **never guess an archetype**, because a wrong guess produces a wall of false failures. `T2-DANGLING-FORMREF` needs a form list; when none is supplied, skip it. Both skips must be reported in the output so a caller knows the check did not run.

- [ ] **Step 1: Write one failing fixture and assertion per code**, plus a `t2-clean.json`. Include these three specifically, because they encode decisions that cost real debugging:

```javascript
test('flags a bare input as a flex-row child', () => {
  // dimensions.width on a bare input lands inside the antd Form.Item chain,
  // which is forced width:100% !important — two such fields do NOT split 50/50.
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7,
    display: 'flex', flexDirection: 'row',
    components: [{ id: ID(), type: 'textField', parentId: 'p', version: 6,
      desktop: { dimensions: { width: '50%' } } }] }] };
  const c = tier2(m, ctx).map((f) => f.code);
  assert.ok(c.includes('T2-FLEXCHILD-NOT-CONTAINER'));
  assert.ok(c.includes('T2-WIDTH-ON-NONCONTAINER'));
});

test('flags gap without display:flex as inert', () => {
  // getAlignmentStyle only emits flexDirection/flexWrap when display === 'flex'.
  const m = { components: [{ id: ID(), type: 'container', parentId: 'root', version: 7, gap: 16 }] };
  assert.ok(tier2(m, ctx).map((f) => f.code).includes('T2-FLEX-NO-DISPLAY'));
});

test('skips flow completeness rather than guessing an archetype', () => {
  const findings = tier2(fx('t2-clean'), { registry, roles, flows });  // no archetype supplied
  assert.ok(!findings.some((f) => f.code === 'T2-FLOW-INCOMPLETE'));
  assert.ok(findings.some((f) => f.code === 'T2-SKIPPED' && /archetype/.test(f.message)));
});
```

- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement `tier2.mjs`.**
- [ ] **Step 4: Run — all pass; `t2-clean` yields only `T2-SKIPPED` entries.**
- [ ] **Step 5: Commit.**

---

### Task 4: Tier 3 scoring and the `validate-form.mjs` CLI

**Files:** Create `scripts/lib/tier3.mjs`, `scripts/validate-form.mjs`, `tests/tier3.test.mjs`

**Interfaces produced:**
- `tier3(markup, {registry, blueprint?}) => {score, findings}` — score 0–100, findings `severity: 'observe'`.
- CLI: `node scripts/validate-form.mjs <form.json> [--registry p] [--roles p] [--flows d] [--archetype a] [--json]`. **Exit 0** when no Tier 1/2 findings, **exit 1** otherwise, regardless of the Tier 3 score.

Tier 3 checks: label casing canonical · one `primary` per action zone · destructive never `primary` · header `text` carries `fontSize`+`fontWeight` · no raw hex outside tokens · component-count ratio · no orphan wrapper containers · `T3-NON-AUTHORABLE-TYPE`.

The two calibrated values (component-count budget, eval pass threshold) are **set in Task 5 from the corpus**, not invented here. Until then `tier3` reads them from a `thresholds.json` that Task 5 writes; ship it with an explicit `"calibrated": false` flag and have `tier3` note in its output when it is running uncalibrated.

- [ ] **Step 1: Write the failing tests** — including that the CLI exits 1 on a Tier 1 fixture, exits 0 on `t1-clean`, and **exits 0 on a form with a low Tier 3 score but no Tier 1/2 findings** (proving Tier 3 cannot block).
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — all pass.**
- [ ] **Step 5: Commit.**

---

### Task 5: Corpus grading and threshold calibration

**Files:** Create `scripts/grade-corpus.mjs`, `assets/thresholds.json`, `docs/corpus-report.md`

**This task is the gate on Task 6.** It answers: does the validator accuse real, working production forms of things that are not actually wrong?

- [ ] **Step 1: Mine the corpus.** Query the four DBs (connection details in Global Constraints). Write JSONL to a path **outside the repo** — corpus data must never be committed. Report the row count per DB.
- [ ] **Step 2: Run validate over every form**, collecting findings by code.
- [ ] **Step 3: Produce `docs/corpus-report.md`** — per code: how many forms trip it, and 3 example forms. Ranked by frequency.
- [ ] **Step 4: Triage every code with a high hit rate.** For each, decide and record: **genuine defect** in the corpus (the rule stands), or **false positive** (the check is wrong and must be fixed). Expect real defects — the Phase 1 baseline already showed `validationErrors` present in only 47/100 forms and loose buttons in 35/100. But a code tripping on ~100% of forms is far more likely to be a broken check than a universally broken corpus; treat that as the signal it is.
- [ ] **Step 5: Fix every confirmed false positive** in the relevant tier module, re-run, and record the before/after rate.
- [ ] **Step 6: Calibrate `thresholds.json`** — component-count budget = the 75th percentile of `components/bindings` among forms in the top quartile on the other Tier 3 checks; eval pass threshold = the median Tier 3 score of that same top quartile. Set `"calibrated": true`.
- [ ] **Step 7: Commit** the report and thresholds. Not the corpus.

---

### Task 6: The blocking hook

**Files:** Create `plugins/shesha-developer/hooks/hooks.json`, `hooks/validate-push.mjs`

**Interfaces produced:** a `PreToolUse` hook on `Bash`/`PowerShell` whose command contains `UpdateMarkup` or `ImportJson`; and a `Stop` hook.

Behaviour:
1. Extract the staged markup path from the command. **If it cannot be determined, allow the call and log** — a hook that blocks what it cannot parse would halt all legitimate work.
2. Run normalize→validate on that markup.
3. On any Tier 1/2 finding, return `permissionDecision: "deny"` with the findings as the `reason`.
4. Append every decision to `${CLAUDE_PLUGIN_DATA}/validation-log.jsonl`.
5. `Stop` hook: if a push happened this session with no passing validation record, return `decision: "block"` naming the form.
6. Honour `SHESHA_SKIP_FORM_VALIDATION=1` as an escape hatch, and log every bypass.

- [ ] **Step 1: Write tests** for the hook entry point as a pure function of its stdin payload: a push command with an invalid form denies; with a valid form allows; an unparseable command allows-with-log; the env var bypasses.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** Read the current hook JSON contract from the Claude Code docs rather than assuming field names — `permissionDecision`, `decision`, `reason` and `additionalContext` semantics differ per event, and `additionalContext` is capped at 10,000 characters, so truncate the findings list.
- [ ] **Step 4: Run — all pass.**
- [ ] **Step 5: Ship it DISABLED.** `hooks.json` present, with the matcher commented or gated behind `SHESHA_FORM_HOOK_ENABLED=1`, and a `references/push-hook.md` explaining how to turn it on and what Task 5 measured. Enabling it is a deliberate, separate decision.
- [ ] **Step 6: Commit.**

---

### Task 7: The normalizer

**Files:** Create `scripts/normalize-form.mjs`, `scripts/lib/expand-style.mjs`, `tests/normalize.test.mjs`

**Interfaces produced:** `normalize(markup, {registry, roles, tokens}) => markup`. Pure, deterministic, **idempotent**.

| Transform | Deletes this prose rule |
|---|---|
| `role` → complete style block per breakpoint via `resolveRole` | the model authoring style blocks at all |
| stamp `version` from the registry (skip `version: null` types) | the hardcoded version list in `SKILL.md` |
| stamp `parentId`; root-level → `"root"` | the `parentId` rule + its inline snippet |
| mint UUIDs for non-UUID ids; de-duplicate collisions | the UUID rule |
| canonicalise label casing to **sentence case** | the `"First Name"` vs `"First name"` contradiction |
| rewrite `columns` → flex `container` + one child `container` per col, widths derived from `flex`/24 | the `columns` ban, restated 21× |
| wrap bare non-container flex-row children in a `container`, moving `dimensions.width` to the wrapper | the "sized via `dimensions.width`" rule and its 348/356 constants |
| strip `customStyle`; strip `dimensions.width` from remaining non-containers | 7 discussions of a prop with 0 corpus occurrences |
| add `display:"flex"` where `gap`/`flexDirection` present | that rule, restated 6× |
| canonical prop ordering | — |

- [ ] **Step 1: Write the failing tests.** Mandatory:
  - **Idempotence over the whole corpus:** `normalize(normalize(f))` deep-equals `normalize(f)` for every corpus form. This is the single most important test in the phase — a non-idempotent normalizer behind a hook produces infinite churn.
  - **Preservation:** component count, ids and `propertyName`s survive except where a transform is specified.
  - **`normalize` then `validate` clears every code the normalizer claims to fix** — assert per code, so a transform cannot silently stop working.
  - `columns` → flex conversion preserves child order and total width.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.** `expand-style.mjs` imports `resolveRole` from `shesha-design-system` by relative path; if that coupling proves awkward, copy the resolver and note the duplication rather than inventing a second resolution semantics.
- [ ] **Step 4: Run — all pass, including corpus idempotence.**
- [ ] **Step 5: Commit.**

---

## Phase gate

- [ ] `npm test` green in all three skills; total ≥ 97 + the new tests.
- [ ] `validate-form.mjs` exits 1 on every Tier 1/2 fixture and 0 on the clean ones.
- [ ] `normalize(normalize(x)) === normalize(x)` holds across the entire corpus.
- [ ] `docs/corpus-report.md` committed, every high-frequency code triaged as defect-or-false-positive with the reasoning recorded.
- [ ] `thresholds.json` has `"calibrated": true`.
- [ ] The hook is present but **disabled**, with `references/push-hook.md` explaining enablement.
- [ ] No corpus data anywhere in the repo.
- [ ] Plugin version bumped.

## Sequencing note

Task 5 (corpus grading) deliberately precedes Task 6 (the hook) and Task 7 (the normalizer). Grading with the validator alone tells us whether the *checks* are right; grading again after the normalizer tells us how much of the corpus the normalizer can mechanically repair. Enabling the hook before either number exists would be shipping a gate on faith.
