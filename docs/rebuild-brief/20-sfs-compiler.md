## Section 2 — SFS language, JSON Schema, compiler and decompiler contract

This section is the technical core. Everything in it is a program or a data file. **No rule in this section may be implemented as prose in a `SKILL.md`.** If you find yourself writing "the agent should remember to…", you have found a bug in your implementation, not a gap in this brief — go back and put it in the compiler, the schema, the registry, or a test.

Authority: strategy doc §1.1 (the artifact contract table + the eight defects), §4/L0–L2, §5 (disposition), §6 Phase 2–3 (gates), Appendix C (the worked SFS example). Cited inline as `[§x]`.

**Work-package map.** §2.0 lands in WP-0. §2.8 (registry) is WP-2. §2.2 (schema) is WP-4. §2.1/§2.3/§2.4/§2.6/§2.7 (compiler, normaliser, catalogue) are WP-5. §2.5's decompiler is split: `detect.mjs` + `tools/normalise-legacy.mjs` land in WP-1 as the oracle; the lifts and the round-trip gate land in WP-6.

**Scoped out of this session, with a `/BACKLOG.md` row each (§2.11):** `propsCompleteness: "full"` (needs the `shesha-framework` clone) → `BL-020`; the `columns`/`sizableColumns` lift → `BL-021`; versions for the 8 deferred authorable types → `BL-022`; a YAML surface → `BL-023`; round-trip ≥ 0.90 over all 12 corpus forms → `BL-002`. Do not re-scope these back in under time pressure; do not leave an unachievable gate in the repo in their place.

---

### 2.0 Package layout, ownership, and the repo-level prerequisites

**D-100: SFS ships as npm workspaces inside `shesha-plugins`.** Not a separate repo (splits CI and version pinning across two review surfaces mid-rebuild), not inside a skill folder (`CLAUDE.md` bans build systems and extraneous files there). Extraction later is `git subtree split` and is out of scope.

**Dependency arrow: `registry <- sfs <- verify`.** `packages/registry` has **zero** dependencies — not even `ajv`. Nothing in `packages/registry` imports from `packages/sfs` or `packages/verify`.

```
packages/registry/                  # L0: data + the zero-dependency shared libs
  package.json                      # see literal below
  src/index.mjs                     # load(ref) -> {components,actions,enums,formSettings,roles,limitations,decisions,_meta}
  src/coverage.mjs                  # THE coverage/verdict/exit-code implementation (Section 3 §3.1.2 lands here)
  src/gen-decisions.mjs             # /DECISIONS.md -> data/<ref>/decisions.json (GENERATED; never hand-edited)
  data/0.45.1/  _meta.json components.json actions.json enums.json
                form-settings.json roles.json limitations.json decisions.json
  schema/registry.schema.json
  config/registry-ratchet.json      # measured completeness floors; ratchets down only
  tools/gen-registry.mjs  tools/fill-gaps.mjs  tools/registry-probe.mjs
  test/registry.test.mjs  test/decisions-roundtrip.test.mjs

packages/sfs/
  package.json                      # {"name":"@shesha/sfs","private":true,"type":"module",
                                    #  "exports":{".":{"types":"./src/index.mjs","default":"./src/index.mjs"}},
                                    #  "dependencies":{"@shesha/registry":"*","ajv":"8.17.1","ajv-formats":"3.0.1"},
                                    #  "scripts":{"bless":"node tools/bless.mjs","measure":"node tools/measure-form.mjs"}}
  README.md                         # allowed here (NOT a skill folder)
  schema/
    sfs.schema.json                 # §2.2
    compile-report.schema.json      # §2.4.6
    plan.schema.json                # PATH RESERVED — Section 4 owns the content
    verdict.schema.json             # PATH RESERVED — Section 3 owns the content
  src/
    index.mjs                       # re-exports compile, decompile, normalForm
    compile/index.mjs               # the ONLY exported compile(sfs, ctx)
    compile/s1-parse.mjs s2-resolve.mjs s3-normalise.mjs s4-expand.mjs s5-stamp.mjs s6-serialise.mjs
    compile/recipes/pageShell.mjs dataRegion.mjs flexRow.mjs columnTriplet.mjs
                    statusBadge.mjs datalistRowCard.mjs actionsGroup.mjs kibBand.mjs
    decompile/index.mjs detect.mjs liftStyles.mjs liftResponsive.mjs liftActions.mjs
    errors/catalogue.json           # §2.7 — the single source of every error string
    errors/raise.mjs                # the ONLY way to produce a diagnostic
    lib/ids.mjs orderedJson.mjs tokens.mjs metadata.mjs paths.mjs normalForm.mjs
    lib/coverage.mjs                # EXACTLY: export * from '@shesha/registry/coverage';
  bin/sfsc.mjs                      # CLI: compile | decompile | roundtrip | measure | bless
  tools/measure-form.mjs            # §2.1.10 — measures any form; writes reports/measure.json
  tools/normalise-legacy.mjs        # WP-1 oracle: legacy markup -> normalised markup, no SFS involved
  tools/bless.mjs                   # regenerates every *.expected.form.json + *.expected.counts.json
  config/roundtrip-expected.json    # §2.5 — the declared clean set, exact
  config/escape-ratchet.json        # §2.1.9 — measured escape budget, ratchets down only
  test/
    fixtures/clean/*.sfs.json  clean/*.expected.form.json  clean/*.expected.counts.json
    fixtures/legacy/*.json          # decompiler inputs (bare {components,formSettings} is legal)
    fixtures/gaps/*.gap.test.mjs    # §2.5 triage; the ONLY legal home of test.todo(
    schema.test.mjs compile.test.mjs golden-defects.test.mjs determinism.test.mjs
    idempotence.test.mjs roundtrip.test.mjs errors.test.mjs mutation.test.mjs
  corpus/                           # decompiler inputs copied from the deleted assets/examples
  reports/                          # GITIGNORED: roundtrip.json escape-report.json measure.json
```

`packages/registry/package.json`, literally:

```json
{
  "name": "@shesha/registry", "private": true, "type": "module", "version": "0.0.0",
  "exports": {
    ".":         { "types": "./src/index.mjs", "default": "./src/index.mjs" },
    "./coverage":{ "types": "./src/coverage.mjs", "default": "./src/coverage.mjs" }
  },
  "scripts": { "test": "node --test test/" }
}
```

**Path decisions that bind the other sections. These are the canonical spellings; a reference elsewhere that disagrees is wrong.**

| Thing | Canonical path | Notes |
|---|---|---|
| Registry data | `packages/registry/data/0.45.1/<name>.json` | The `<ref>` segment is **mandatory**. Section 3's `packages/registry/data/form-settings.json` resolves here. `@shesha/registry`'s `load(ref)` is the only reader; no other module opens these files by path |
| Coverage arithmetic | `packages/registry/src/coverage.mjs` | One implementation. `packages/sfs/src/lib/coverage.mjs` and `packages/verify/src/coverage.mjs` are each a single line: `export * from '@shesha/registry/coverage';`. `walkComponents` is **not** here — it lives in `packages/verify/src/walk.mjs` and is exempt from the re-export rule |
| Test root | `packages/sfs/test/` (singular) | Fixtures, `*.test.mjs` and `gaps/` all live under it. Section 1's `test.todo(` carve-out path is `packages/sfs/test/fixtures/gaps/**` |
| Decisions | `/DECISIONS.md` (source) → `packages/registry/data/0.45.1/decisions.json` (generated) | §2.8.5. There is no third registry and no `OPEN-QUESTIONS.md` |
| Compiler-gap / promotion backlog | `/BACKLOG.md` rows with ids `GAP-###` and `BL-###` | §2.5. `reports/roundtrip.json` is the machine copy and is gitignored |

**Prerequisite A — root `package.json`.** The repo root has none today. Create exactly:

```json
{
  "name": "shesha-plugins", "private": true, "type": "module",
  "workspaces": ["packages/*", "plugins/shesha-developer/skills/shesha-form-edit"],
  "devDependencies": { "ajv": "8.17.1", "ajv-formats": "3.0.1" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "sfs": "node packages/sfs/bin/sfsc.mjs",
    "bless": "node packages/sfs/tools/bless.mjs",
    "registry": "node packages/registry/tools/gen-registry.mjs"
  }
}
```

`plugins/shesha-developer/skills/shesha-form-edit/package.json` already declares `"type":"module"` and stays a workspace member so `verify-artifact.mjs` and its 15 tests keep running unchanged [§5: keep + extend]. Do not move them in this session.

**Prerequisite B — dependencies.** `ajv` 8.17.1 and `ajv-formats` 3.0.1, pinned exact, hoisted at the root. `packages/sfs` declares them; `packages/registry` declares none. No other production dependency in either package. Test runner is `node --test` (Node 22).

**Prerequisite C — `.gitignore` rows Section 2 requires** (Section 1 writes the file; these rows must be in it): `/.build/`, `packages/sfs/reports/`, `.sfs-cache/`. Every acceptance command below writes only into those paths or into `.build/`.

**Gates Section 2 owns.** Each is a file under `packages/verify/src/gates/`, exits `0|1|2`, prints one `family walked/checked/uninspectable` line per family, and ships **≥2 mutations** that flip its verdict (Section 1's `g-gate-contract`). No Section 2 rule is enforced anywhere else.

| Gate | Subject | Lands in |
|---|---|---|
| `g-sfs-schema` | `sfs.schema.json` compiles under `new Ajv({strict:true})`; validates every `test/fixtures/clean/*.sfs.json`; rejects all 14 negatives of §2.2 | WP-4 |
| `g-sfs-invariants` | N1–N11 (§2.6) + the count identities + canonical key order, over every clean fixture's compiled output | WP-5 |
| `g-determinism` | banned-global scan of `packages/sfs/src/**` + 50×/3× byte identity (§2.4) | WP-5 |
| `g-no-literal-hex` | zero literal colours in `packages/sfs/src`, `packages/sfs/test/fixtures/clean/*.sfs.json`, `packages/registry/src` (§2.1.8) | WP-5 |
| `g-registry-completeness` | `registry-ratchet.json` floors, priority-13 completeness, decisions round-trip (§2.8) | WP-2 |
| `g-escape-budget` | `escape-ratchet.json` (§2.1.9) | WP-5 |

**Plugin version.** Section 2 touches `plugins/**` only when it deletes a reference file. Every such commit is a **patch** bump of `plugins/shesha-developer/.claude-plugin/plugin.json`. Section 2 asserts no absolute version number anywhere; the session's final version is a discovered value (Section 5 owns `g-plugin-version`).
### 2.1 The SFS language

#### 2.1.1 Serialisation: JSON

**Decision: SFS is JSON.** Appendix C is written in YAML for readability; that YAML is *illustration, not specification*. JSON is chosen because it is validatable by JSON Schema without a second grammar, has no significant-whitespace or implicit-typing ambiguity (`yes`/`no`/`on` coercion, `1.0` vs `"1.0"`, tab-indent errors), and round-trips byte-stably through `JSON.parse`/ordered stringify — which §2.4 requires. A YAML *surface* (`sfsc compile x.sfs.yaml`) is deferred; do not build it in this session. Files are named `<form-name>.sfs.json`.

#### 2.1.2 Top-level keys

Exactly these keys. Unknown top-level keys are a hard error (`SFS-1002`), not a warning — additive extension goes through `raw` (§2.1.9).

| Key | Type | Req | Meaning | What the compiler does with it |
|---|---|---|---|---|
| `sfs` | `"1.0"` | yes | Language version | Gate: refuse any other value (`SFS-1001`) |
| `form` | slug | yes | Form name | Envelope `Name`; id namespace input |
| `module` | slug | yes | Shesha module | Envelope `ModuleName`; `formSettings.modelType.module` |
| `kind` | enum §2.1.3 | yes | Archetype | Selects the `formSettings` profile + the page recipe + default `editMode` |
| `entity` | fully-qualified CLR type | cond | Backing entity | Envelope `ModelType`; `formSettings.modelType`; metadata root for all bindings. Required for `list\|detail\|create\|edit`; optional for `modal\|dashboard\|custom` |
| `label` | string | yes | Human title | Envelope `Label` |
| `description` | string | no | | Envelope `Description` |
| `access` | `"inherited"\|"authenticated"\|"anonymous"` | no, default `"authenticated"` | Auth | `3\|4\|5` into **both** envelope `Access` and `formSettings.access`, mirrored [§1.1 envelope contract] |
| `permissions` | string[] | no, default `[]` | | Envelope `Permissions` + `formSettings.permissions` |
| `brand` | brand id | no, default `"shesha"` | Token file selector | Selects `packages/registry/data/0.45.1/roles.json` + the theme tokens for `$role:` resolution at **compile time** [§4/L1] |
| `page` | object §2.1.4 | no | Page shell | Emits the page-shell recipe. Omit for `modal` |
| `body` | `region[]` | yes, minItems 1 | The tree | The component tree |
| `hooks` | object | no | Form-level scripts | Only keys legal for the `kind` (§2.1.3) are accepted; anything else is `SFS-1401` |
| `submits` | boolean | no, default `false` | `kind:modal` only — selects the submitting profile | Selects `dataSubmitterType` for `modal` (§2.1.3). Any other `kind` ⇒ `SFS-1002` |
| `raw` | rawBlock | no | Escape hatch | §2.1.9 |

There is **no** `version`, **no** `id`, **no** `parentId`, **no** `componentName` anywhere in SFS. Emitting any of them from an SFS document is `SFS-1003`. This is the rule that deletes the `stampTree` transcription the current SKILL.md asks the model to perform [§4/L1].

#### 2.1.3 The `kind` enum and its `formSettings` consequences

`kind` is a total function to a `formSettings` profile. The profiles live in **data**, at `packages/registry/data/0.45.1/form-settings.json`, not in code. The compiler reads the profile and emits it verbatim after substituting `modelType`, `access`, `permissions` and the legal hooks.

Base block, emitted for **every** kind (measured from the production form; `formSettings.version` is `8`):

```json
{
  "layout": "vertical", "colon": false,
  "labelCol": { "span": 24 }, "wrapperCol": { "span": 24 },
  "modelType": { "name": "<Entity>", "module": "<module>" },
  "access": 4, "permissions": [], "version": 8,
  "onBeforeDataLoad": null, "onAfterDataLoad": null,
  "onPrepareSubmitData": null, "onBeforeSubmit": null,
  "onSubmitSuccess": null, "onSubmitFailed": null
}
```

**D-104 (`verified`): `forbidden` means "present with a non-`null` value".** `form-settings.json` gives every kind `{allowed[], forbidden[]}`. A key in `forbidden` whose value is `null` is legal and is what the base block emits; a key in `forbidden` with any non-`null` value is a hard failure; a key in neither list is a hard failure. Without this rule the base block's `onBeforeDataLoad: null` fails the canonical `kind: list` fixture, which is the one artifact everything else is measured against. Enforced by `check:t2-registry:T2.20`, which ships both fixtures: `T2.20-list-form-with-submit-pipeline.json` (non-null `dataSubmitterType` → fail) and the canonical compiled fixture (`onBeforeDataLoad: null` → pass).

Per-kind deltas — this table **is** `form-settings.json`'s `allowed`/`forbidden` content:

| kind | `dataLoaderType` | `dataSubmitterType` | `dataLoadersSettings` | `dataSubmittersSettings` | Legal `hooks` keys | Page recipe | Default `editMode` stamped on inputs |
|---|---|---|---|---|---|---|---|
| `list` | `"gql"` | `"none"` | `{gql:{endpointType:"default"},custom:{}}` | *forbidden* | *(none)* | `pageShell` | `"inherited"` on containers, `"editable"` on `actions` items |
| `detail` | `"gql"` | `"none"` | as above | *forbidden* | `onAfterDataLoad` | `pageShell` | `"inherited"` |
| `create` | `"none"` | `"gql"` | `{gql:{endpointType:"default"},custom:{}}` | `{gql:{endpointType:"default"}}` | `onAfterDataLoad`, `onPrepareSubmitData`, `onBeforeSubmit`, `onSubmitSuccess`, `onSubmitFailed` | `pageShell` | `"editable"` |
| `edit` | `"gql"` | `"gql"` | as above | `{gql:{endpointType:"default",dynamicEndpoint:"    return data?.id ? form.defaultApiEndpoints.update : form.defaultApiEndpoints.create"}}` | as `create` | `pageShell` | `"editable"` |
| `modal` | `"none"` | `"gql"` if `submits:true` else `"none"` | as above | as `create` when submitting | `onAfterDataLoad`, submit hooks | **none** (no page shell in a dialog) | `"editable"` |
| `dashboard` | `"none"` | `"none"` | `{custom:{}}` | *forbidden* | *(none)* | `pageShell` | `"inherited"` |
| `custom` | from `raw.formSettings` | from `raw.formSettings` | from `raw` | from `raw` | any, all recorded as escapes | `pageShell` if `page` present | `"inherited"` |

Three decisions embedded above. All three are rows in `/DECISIONS.md` (§2.8.5), not free-standing objects:

* **`D-101` (`assumed`)** — `kind:list` keeps `dataLoaderType:"gql"`. The only list form verified in production carries `"gql"` and renders; §1.1 defect 8 indicts `dataSubmitterType`, `dynamicEndpoint` and `onBeforeDataLoad`, **not** `dataLoaderType`. Changing it is a behavioural change with no evidence. Probe `P-101`. Enforced by `check:t2-registry:T2.20`.
* **`D-102` (`verified`)** — the form-arguments hook is **`onAfterDataLoad`**, never `onDataLoaded` and never `onBeforeDataLoad`. Resolves contradiction #8 by deleting the losing sides [§6 Phase 0 item 6]. Evidence: `debug.md` rows 30 and 1. Enforced by `structural:packages/registry/data/0.45.1/form-settings.json` + `g-sfs-schema` (`hooks` has `additionalProperties:false` and no such key).
* **`D-103` (`verified`)** — `kind:list` and `kind:detail` never emit a **non-null** `dataSubmittersSettings`, `onBeforeDataLoad` or `dynamicEndpoint`. This is normaliser rule `N8` (§2.6). Enforced by `g-sfs-invariants`.
#### 2.1.4 Region and nesting grammar

`body` is an array of **regions**. A region is an object with a required `node` discriminator and a required `name`. Nesting is expressed by nesting; there is no `parentId`.

```
region := { node: <nodeKind>, name: <ident>, ...nodeProps, children?: region[],
            responsive?: responsive, style?: style, when?: binding, raw?: rawBlock }
```

`name` is **required on every region**, must match `^[a-z][A-Za-z0-9]{0,39}$`, and must be unique among its siblings. It is the identity of the node: it becomes `propertyName` and `componentName`, it is the path segment used for deterministic id derivation (§2.4.2), and it is the target of `refresh(...)`/`onSuccess` references. Auto-naming is forbidden — auto-names renumber on insertion and destroy diff reviewability, which is the whole point of §2.4.

**Node kind table.** `version` and `childrenKey` here are *documentation of registry data*, not a second source: `s5` reads them from `components.json`, and `g-registry-completeness` asserts each row below matches the registry byte for byte. Versions are the measured `components-kb` values at commit `3418e292`.

| `node` | Component `type` | v | Children emitted to | Notes |
|---|---|---|---|---|
| `row` | `container` | 7 | `components` | flex row: `display:flex`, `flexDirection:row` |
| `col` | `container` | 7 | `components` | flex column |
| `card` | `card` | 3 | **`content.components`** | `header` slot via `headerChildren`. This mapping is why §1.1's most-cited crash becomes unrepresentable |
| `panel` | `collapsiblePanel` | 9 | **`content.components`** | see `D-110` |
| `tabs` | `tabs` | 4 | **`tabs[]`** | each tab is `{name,title,children}` |
| `kib` | `KeyInformationBar` | 4 | **`columns[].components`** | SFS writes `bands:[{name,title?,width?,children[]}]`; itemSchema `kibColumn` |
| `data` | `dataContext` | 8 | `components` | requires `entity` or explicit `entityType`; emits `sourceType`, `dataFetchingMode`, `defaultPageSize` |
| `table` | `datatable` | 29 | *(leaf)* | `columns[]` (§2.1.7); requires a `data` ancestor |
| `childTable` | `childTable` | 6 | *(leaf)* | `bind` is the child collection; needs **no** `data` ancestor (it makes its own) |
| `list` | `datalist` | 11 | *(leaf)* | `rowTemplate` ref; requires a `data` ancestor |
| `pager` | `datatable.pager` | 4 | *(leaf)* | requires a `data` ancestor |
| `search` | `datatable.quickSearch` | 3 | *(leaf)* | requires a `data` ancestor |
| `actions` | `buttonGroup` | 15 | *(leaf)* | `items[]` are actions (§2.1.7) |
| `text` | `text` | 5 | *(leaf)* | `content` or `bind` |
| `status` | `refListStatus` | 6 | *(leaf)* | `refList` required; same canonical `referenceListId:{module,name}` shape as the column renderer |
| `select` | `dropdown` \| `autocomplete` | 11 \| 8 | *(leaf)* | `source:"refList"` → `dropdown`; `source:"entity"` → `autocomplete`. Default `refList` |
| `picker` | `entityPicker` | 12 | *(leaf)* | `entityType` + `columns[]` |
| `tags` | `childEntitiesTagGroup` | 3 | *(leaf)* | `bind` is the child collection |
| `attachments` | `attachmentsEditor` | 14 | *(leaf)* | |
| `field` | **resolved from metadata or `component`** | registry | *(leaf)* | the catch-all for every `isInput:true` type — see below |
| `alert` | `alert` | registry | *(leaf)* | |
| `errors` | `validationErrors` | 0 | *(leaf)* | version `0` is the measured value, not a missing value |
| `raw` | from `raw.type` | registry | `raw.childrenKey` | fully-escaped node, always counted as a structural escape |

**`field` is the extension point, and it is why the node enum does not need to grow again.** `{ "node": "field", "bind": "...", "component": "<type>" }` accepts **any** registry record with `authorable: true` and `isInput: true`. With no `component`, the type is resolved through `components.json._datatypeMap` from the bound property's datatype. Consequences, both enforced:

* Adding support for a new input component is a **registry-data change only** — no schema change, no compiler change. `g-registry-completeness` asserts every `component` value used in `test/fixtures/**` and `corpus/**` resolves to an `isInput:true` record.
* **`D-111` (`verified`)**: the decompiler's `type → node` direction is the generated reverse map `components.json[type].sfsNode`. A type with no `sfsNode` and `isInput:true` decompiles to `{node:"field", component:"<type>"}` and is **not** an escape. A type with no `sfsNode` and `isInput:false` decompiles to `node:"raw"` and **is** a structural escape. The structural-escape rate is therefore a function of container coverage alone, which is what makes §2.1.9's budget meaningful. Enforced by `g-escape-budget`.

Structural rules, enforced in stage 1 by schema and stage 2 by walk:

* **`SFS-1201`** — `table`/`list`/`pager`/`search` with no `data` ancestor. Kills `debug.md` rows 5, 6, 7 at compile time. `childTable` and `tags` are exempt (they own their data source).
* **`SFS-1301`** — an `actions` region, or any node with a `do:`/`onSuccess:`, inside a `rowTemplate` subtree. `debug.md` row 29 measured that no action type fires from inside a row template. The fix (hoist to the parent `list`'s `onListItemClick`) is stated in the error hint.

**`D-110` (`verified`)** — `collapsiblePanel` at 0.45 is `version: 9`, prop `accentStyle`, prop `collapsedByDefault` (polarity: `true` = collapsed). `containers.md`'s `version: 8` / `accent` / `isDefaultExpanded` is wrong and is **deleted**, not annotated [§1.2 contradiction 11]. Source: `components-kb/collapsiblePanel.json` → `version: 9`, `slots.customContainerNames: ["header","content","customHeader"]`. Enforced by `g-registry-completeness` + `check:t2-registry:T2.13`.

**`D-112` (`verified`)** — the banned-component list is registry data (`components.json[type].authorable: false` with a mandatory `reason` and `decision` field), never prose. `columns` (v5) and `sizableColumns` (v5) are `authorable: false`: they are legacy 24-column grid containers whose `flex`/`offset`/`push` per-column props have no sound deterministic lift, and §2.1.5's arithmetic replaces them. `SFS-1004` fires on use, hint: `use node:"row" with responsive.fixed`. This resolves contradiction #4 by deleting the mandating side [§6 Phase 0 item 6]. Consequence, declared and not hidden: legacy forms that use `columns` produce a structural escape on decompile. Exactly one form in §2.5's declared subset does (`standalone-create.json`); it is listed in `config/roundtrip-expected.json` with `"expect":"structural-escape","backlog":"BL-021"`. Lifting `columns` → `row` is `BL-021`, not this session.

`page` shorthand:

```json
"page": { "title": "Bookings", "subtitle": "All flight bookings" }
```

⇒ the `pageShell` recipe (§2.6 `N1`/`N4`): one `card` named `pageShell` with `hideHeading:true`, `hideLabel:true`, **no** `label`, **no** `labelAlign`, `className:"sha-page"` on all three breakpoint blocks, `dimensions.height:"auto"`, `border.border.all.style:"none"` on all three; `content.components = [ titleBand, ...compile(body) ]` where `titleBand` is a `col` containing `pageTitle`/`pageSubtitle` `text` nodes. **The body is a sibling of the title band, not a child of it** (`N10`).
#### 2.1.5 Responsive grammar

One declaration per region; it governs **geometry only**. Appearance never varies by breakpoint (§2.6 `N2`/`N3`/`N5`).

```json
"responsive": {
  "stack": "at:tablet" | "at:mobile" | "never",
  "fill": "<childName>",
  "fixed": { "<childName>": "180px", "<childName2>": "56px" },
  "gap": 16,
  "hide": ["mobile"]
}
```

Semantics, exhaustive:

* Breakpoint ladder is exactly `desktop > tablet > mobile`. Only these three blocks exist.
* `stack: "at:X"` — breakpoint `X` **and every narrower one** get `flexDirection:"column"`, `alignItems:"stretch"`, and every child's `dimensions.width:"100%"`. Breakpoints wider than `X` use the row arithmetic below. **`below:` syntax is not accepted** (`SFS-1501`) — it is off-by-one ambiguous, which is exactly the ambiguity that produced the golden form's incoherent tablet block (row direction with two 100%-wide children). Appendix C's `below-tablet` maps to `at:tablet`.
* Row arithmetic (`stack` not yet in force at that breakpoint):
  `reserve = Σ(fixed widths in px) + gap × count(fixed children)`
  `fill child → dimensions.width = "calc(100% - <reserve>px)"`
  `fixed child → dimensions.width = "<declared>"`
  other children → `dimensions.width = "auto"`
  Verification of the formula against production: one fixed child at `180px`, `gap:16` ⇒ `reserve = 180 + 16 = 196` ⇒ `calc(100% - 196px)`. Byte-identical to the production form. Write this as a unit test with three cases (1 fixed, 2 fixed, 0 fixed).
* Non-px `fixed` values (`%`, `rem`, `calc`) ⇒ `EXP-4104`: arithmetic is defined for px only. State the fix hint: "declare `fixed` in px, or use `raw` at `desktop`".
* `hide: ["mobile"]` ⇒ that breakpoint block gets `display:"none"`; base `hidden` stays `false`.
* `gap` defaults to `16` for `row`, `0` for `col`. Emitted as a **string** (`"16"`) — measured production shape.
* A `fill`/`fixed` name that is not a direct child ⇒ `SFS-1502`.
* A region with `fixed` but no `fill` ⇒ `SFS-1503` (the reserve has no consumer).
* `responsive` on a leaf node accepts only `hide` and `width`; `fill`/`fixed`/`stack` on a leaf ⇒ `SFS-1504`.

The compiler always emits **all three** blocks for every component whose registry record has a non-empty `breakpointChannels`, even when identical [§1.1: 6 of 11 identical is the production norm, and the framework silently no-ops a missing block]. 12 components → 33 blocks in the reference form, from **one** `responsive` line [§4/L1, Appendix C].

#### 2.1.6 Binding grammar

```
binding := "<entityPath>"                                  // shorthand
         | { path: "<entityPath>", required?: bool, editMode?: "editable"|"readOnly"|"inherited",
             label?: string, component?: "<type>" }
         | { code: "<js expression>" }                      // code-mode, always wrapped
         | { const: <json> }
```

* `entityPath` is dot-separated: `passengerName`, `customer.fullName`. Segments are camelCased **by the compiler** — `PascalCase` in, camelCase out. This kills `debug.md` row 27 (headers + row count correct, every cell blank) by construction, and settles contradiction #10 (`api.md` camelCase vs `form-quality.md` PascalCase) in favour of camelCase output regardless of what the metadata endpoint returns.
* Every path is resolved against entity metadata during stage 2. Unresolvable ⇒ `MET-2201`. **Backend absent ⇒ the binding is marked `uninspectable`, counted, and the compile verdict becomes `partial` (exit 3), never `pass`.** Zero resolvable bindings on a form that declares ≥1 binding ⇒ `partial`, not `pass`. Reuse `verify-artifact.mjs`'s existing partial/exit-3 vocabulary and move the accounting into `packages/registry/src/coverage.mjs` so both share one implementation [§5: coverage accounting as a shared library].
* `{ code: … }` compiles to `{"_mode":"code","_code":"<body>"}`. The compiler **never** emits a bare string where a code setting is expected, and never emits `_code` that is not syntax-clean — stage 6 runs every emitted `_code` through `new Function` for a parse check (`SER-6201`); a T3 tier re-checks with `node --check`.
* datatype → component is a **table in the registry** (`components.json._datatypeMap`), not code and not prose. Seed it with the nine rows currently living in `by-datatype.md`, each row carrying `{datatype, component, version, props}`. `field` with no `component` override resolves through it; a datatype with no row ⇒ `MET-2203` with the hint naming the file to extend.
* `required: true` ⇒ the compiler emits the framework's required-validation props **and** guarantees a `validationErrors` node exists in the form (auto-inserts one at the end of the innermost `card`/page body if absent, `EXP-4701`).

#### 2.1.7 Action grammar

Actions are **named intents**. The intent → `(actionName, actionOwner-class)` mapping is registry data at `packages/registry/data/0.45.1/actions.json`, generated from the framework's registered action list at the pinned ref (§2.8.3). SFS never writes `actionName` or `actionOwner`; an SFS document containing either is `SFS-1003`.

```json
{ "name": "btnAddBooking", "label": "Add booking", "style": "primary",
  "icon": "PlusOutlined",
  "do": "openDialog",
  "with": { "form": "boxfusion.test/booking-create", "title": "New booking",
            "width": "60%", "mode": "edit" },
  "onSuccess": { "do": "refresh", "with": { "target": "bookings" } } }
```

Seed `actions.json` (the generator is the authority; these entries are the measured baseline):

| intent | `actionName` | `actionOwner` | `with` keys | Evidence |
|---|---|---|---|---|
| `openDialog` | `Show Dialog` | `shesha.common` | `form`, `title`, `width`, `mode`, `footer`, `args` | production form |
| `navigate` | `Navigate` | `shesha.common` | `form`, `args` (→ `queryParameters`) | production form |
| `refresh` | `Refresh table` | **`ownerRef`** → the compiled id of the named `data` region | `target` | production form |
| `exportExcel` | `Export to Excel` | `ownerRef` → `data` region id | `target` | `debug.md` row 6 |
| `script` | `Execute Script` | `shesha.common` | `code` | `debug.md` rows 17, 29 |
| `submit` | `Submit` | `shesha.common` | — | `debug.md` row 17 |

Compiler responsibilities, all invisible to the model:

* `actionOwner` casing is **lowercase, as data**. `Shesha.Common` cannot be produced. Contradiction #9 evaporates and `actions.md`'s `"Shesha.Common"`/`"ExecuteScript"` rows are **deleted**, not annotated [§6 Phase 0 item 6].
* `ownerRef` resolution: `refresh(target: "bookings")` → the stamped id of the `data` region named `bookings`. Unknown target ⇒ `SFS-1601`. Target that is not a `data` region ⇒ `SFS-1602`.
* Emitted shape: `{"_type":"action-config", actionName, actionOwner, actionArguments, handleSuccess:true|false, handleFail:false, onSuccess?}` with `actionArguments.version` and the action-config `version` stamped from `actions.json`.
* `form: "module/name"` → `{"name":"<name>","module":"<module>"}`. A bare name with no module ⇒ `SFS-1603`. This makes the `formId` shape non-negotiable.
* `openDialog.args` accepts **static values only**. A `{code:…}` inside `args` ⇒ `EXP-4402`, whose hint is `debug.md` row 30's measured workaround verbatim: relay via `contexts.appContext` in a preceding `script` intent and read it in `onAfterDataLoad`. The compiler can emit that relay automatically when `args` contains `{relay: …}`; that is the only supported dynamic path.
* `style` enum: `primary | default | dashed | link | text | ghost` → `buttonType`. `icon` is a plain antd icon name, validated against `packages/registry/data/0.45.1/enums.json._icons`.
* `editMode` is stamped `"editable"` on **both** the `actions` group and every item [`debug.md` row 31 — an inherited button renders as `disabled` with no visual difference]. Contradiction #7 is resolved by making `editMode` a compiler output derived from `kind` (§2.1.3), never an SFS input; `edit-mode.md`'s and `by-datatype.md`'s competing claims are deleted.

Column grammar (`table.columns[]`):

```json
{ "bind": "status", "caption": "Status", "width": 150, "min": 130,
  "sortable": true, "visible": true,
  "render": { "kind": "statusBadge", "refList": "boxfusion.test/BookingStatus", "solid": true, "showName": true } }
```

* `sortOrder` is the array index — never written in SFS.
* Compiler emits the **`[not-editable]` triplet** on every non-inline column: `displayComponent:{type:"[default]"}`, `editComponent:{type:"[not-editable]"}`, `createComponent:{type:"[not-editable]"}`. This kills `debug.md` rows 20 and 21 by construction: `[default]` is illegal on edit/create (`EXP-4302`) and a flat editor with no `settings` wrapper is unrepresentable (`EXP-4301` guarantees the `{type, settings:{…version}}` wrapper).
* `render.kind` enum, each with a recipe: `statusBadge` (→ `refListStatus` v6 in the canonical `referenceListId:{module,name}` object shape — flat `module`/`referenceListName` keys are unrepresentable, settling contradictions #1, #2 and #3 by deletion), `text`, `number`, `date`, `boolean`, `link`, `custom` (`{type, props}` — counted as an escape).
* `columnType` is derived: `data` for a `bind`, `crud-operations` when `table.inline` is not `"none"` (auto-inserted with `sortOrder:-1`, killing `debug.md` row 22), `action` for a `do:`.
* `table.onRowClick` accepts **one** action intent and compiles to `rowClickActionConfiguration` **only** — see `D-120` (§2.6 `N7`).

#### 2.1.8 Style and role grammar

Appearance is declared **once per node**. There is no per-breakpoint appearance channel in SFS. Attempting one is `SFS-1701`. This single design decision makes §1.1 defects 2, 3, 5 and 6 unrepresentable.

```json
"style": {
  "surface": "card" | "flat" | "panel" | "none",
  "bg": "$role:cardBg",
  "border": "$role:hairline",
  "radius": "$radius:lg",
  "shadow": "$shadow:card",
  "pad": { "top": 0, "bottom": 16, "left": 0, "right": 0 },
  "margin": { "bottom": 5 },
  "text": { "size": "$type:title", "weight": "semibold", "color": "$role:sectionHeading", "align": "left" },
  "width": "100%", "height": "auto"
}
```

Token reference grammar — exactly five prefixes, each resolved against the brand token file selected by `brand`:

| Prefix | Resolves through | Example | Failure |
|---|---|---|---|
| `$role:` | `roles.json` → token path → theme value | `$role:cardBg` → `palette.surfaces.surface` → `#ffffff` | `TOK-2001` |
| `$type:` | `type.scale` / `type.weights` / `type.family` | `$type:title` → `24` | `TOK-2002` |
| `$space:` | `spacing` | `$space:4` → `16` | `TOK-2003` |
| `$radius:` | `radius` | `$radius:lg` → `12` | `TOK-2004` |
| `$shadow:` | `shadow` | `$shadow:card` → shadow object | `TOK-2005` |

**A literal colour anywhere in `style` is a hard error (`TOK-2010`).** The check is one JS regex, in `src/compile/s2-resolve.mjs`, applied to every string value under `style` at any depth:

```js
export const LITERAL_COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent|currentColor|[a-z]{3,20})$/i;
// a bare word matches only when it is in tokens/css-named-colours.json (148 entries, committed data)
```

The rule is **not** in `sfs.schema.json`: JSON Schema `pattern` is an ECMA-262 regex and ECMAScript has no inline `(?i)` group, so a case-insensitive pattern cannot be expressed there and ajv would throw at `compile()` time. The schema rejects literals structurally instead — `style.bg|border|radius|shadow` each `$ref` `tokenRef`, whose pattern `^\$(role|type|space|radius|shadow):[A-Za-z0-9_.-]+$` cannot match a hex by construction. `TOK-2010` covers the remaining reachable sites (`raw.props`, decompiler output, `style.text.color`), and `g-no-literal-hex` covers the repo. This resolves contradiction #13 by deleting the "recorded trade" side: literal colours were only tolerable because `bake-overlays.mjs` baked at build time. Resolution now happens at **compile time, per run, per brand** [§4/L1], so there is no reason to tolerate a literal, and doing so is exactly what made the brand-genericity claim false (48 literal hexes vs 10 `$role:` tokens; swapping the token file moved 10 of 58 colour sites). `bake-overlays.mjs` is deleted [§5].

Unresolved token ⇒ **the compile fails and writes nothing**. This is the direct fix for `bake-overlays.mjs`'s measured write-despite-failure defect: in this compiler, all output is produced in stage 6 from an in-memory tree, and stage 6 is unreachable if stage 2 raised. Add a mutation test (`mutation.test.mjs`) that injects `$role:doesNotExist` and asserts (a) non-zero exit, (b) `TOK-2001` in the diagnostics, (c) **zero files written**.

`surface` shorthands are recipes: `card` = `bg:$role:cardBg`, `border:$role:hairline`, `radius:$radius:lg`, `shadow:$shadow:card`. `style.surface` and explicit channels merge, explicit wins.

Emission mapping (`style` → v7 channels, applied identically to `desktop`, `tablet`, `mobile`):

| SFS key | Emitted channel |
|---|---|
| `bg` | `background: {type:"color", color, repeat:"no-repeat", size:"auto", position:"center", gradient:{direction:"to right",colors:{}}, url:"", storedFile:{id:null}, uploadFile:null}` |
| `border`, `radius` | `border: {hideBorder, radiusType:"all", borderType:"all", border:{all:{width,style,color},top:{},bottom:{},left:{},right:{}}, radius:{all}}` |
| `shadow` | `shadow: {offsetX,offsetY,color,blurRadius,spreadRadius}` |
| `text` | `font: {type,size,weight,color,align}` — **on the `text` node, never on a container** (capability matrix cross-cutting rule: font on a container is a no-op) |
| `pad`, `margin` | `stylingBox` — an **escaped JSON string** with canonical key order, inside each breakpoint block only; base `stylingBox` is always `"{}"` (§2.6 `N6`) |
| `width`, `height` | `dimensions: {width,height,minHeight,maxHeight,minWidth,maxWidth}` |

Legacy styling props (`fontSize`, `fontWeight`, `backgroundColor`, `customStyle`, `style`, `borderRadius`, `boxShadow`, …) are **never emitted** for any component whose registry record has non-empty `breakpointChannels`. The full legacy-prop list is registry data (`components.json[type].legacyStyleProps`). This kills §1.1 defect 5 (two competing styling channels on the same `text` node).

#### 2.1.9 The typed `raw:` escape hatch

```json
"raw": {
  "at": "base" | "desktop" | "tablet" | "mobile" | "formSettings" | "items" | "envelope",
  "reason": "one sentence, required, min 12 chars",
  "props": { "<propName>": <json> },
  "type": "<componentType>",        // only when node === "raw"
  "childrenKey": "components"       // only when node === "raw"
}
```

* `reason` is **required** (`SFS-1801`). An escape without a stated reason is indistinguishable from a mistake.
* Every `raw` block is merged **last**, after stage 4 expansion and before stage 5 stamping, so it can override any generated prop but cannot forge an `id`, `parentId` or `version` — those three keys inside `raw.props` are `SFS-1802`.
* Every escape is recorded in the compile report as `{path, at, reason, props: [names], structural: bool}`. `structural: true` when `at` is `"items"` or `node === "raw"` or the props touch a slot key.
* `npm run sfs -- roundtrip --escape-report` aggregates into `reports/escape-report.json` with `{prop, count, forms[]}` sorted descending, plus `structuralEscapeRate`. **This is the IR roadmap** [§4/L1] and the falsification instrument for the "the IR cannot express real designs" risk [§8].
* The budget is a **ratchet over a declared file set**, not a global aspiration. `packages/sfs/config/escape-ratchet.json`, literally:

```json
{ "scope": ["test/fixtures/clean/*.sfs.json", "config:roundtrip-expected.json#declaredSubset"],
  "maxStructuralEscapeRate": 0.20, "maxStructuralEscapes": 1, "measuredAt": "WP-5" }
```

  `g-escape-budget` recomputes the rate over exactly that scope, prints `escapes structural=<n> rate=<r> cap=<c>`, fails when either cap is exceeded, and **fails when the measured value is lower than the cap by more than 0.05 without the cap being lowered in the same commit** — the ratchet direction is down only. Applying the 0.20 rate to the full 12-form corpus is `BL-002` (Section 5 owns the row): the six large corpus forms are triaged, not gated, this session.

#### 2.1.10 The canonical fixture: `bookings-table.sfs.json`

Write this file literally at `packages/sfs/test/fixtures/clean/bookings-table.sfs.json`. It is the Appendix C example rendered in real SFS, and it is the input to the acceptance test in §2.6.

**No byte count in this brief is a target.** `node packages/sfs/tools/measure-form.mjs` measures `sfsBytes`, `markupBytes`, `components`, `breakpointBlocks`, `ids`, `slots`, `items` and `distinctTypeVersions` on any SFS file or any form JSON, and writes `reports/measure.json`. `npm run bless` copies the measurement into `test/fixtures/clean/<form>.expected.counts.json`. The only asserted number is the **ratio**, which is computed from the fixture alone and needs no external artifact: `g-sfs-invariants` fails unless `markupBytes / sfsBytes >= 8` on every clean fixture, and prints the measured ratio. The strategy doc's `19170` and `1180` are prior measurements of a form that is not in this repo; do not restate them as expectations.

```json
{
  "sfs": "1.0",
  "form": "bookings-table",
  "module": "boxfusion.test",
  "kind": "list",
  "entity": "boxfusion.test.Domain.Domain.Bookings.Booking",
  "label": "Bookings",
  "description": "All flight bookings. Row opens the detail page; Add opens the create dialog.",
  "access": "authenticated",
  "brand": "shesha",
  "page": { "title": "Bookings", "subtitle": "All flight bookings" },
  "body": [
    {
      "node": "data",
      "name": "bookings",
      "pageSize": 10,
      "children": [
        {
          "node": "row",
          "name": "toolbar",
          "responsive": { "stack": "at:tablet", "fill": "searchCell", "fixed": { "addCell": "180px" }, "gap": 16 },
          "style": { "pad": { "top": 0, "bottom": 16 } },
          "children": [
            { "node": "col", "name": "searchCell", "children": [
              { "node": "search", "name": "quickSearch", "label": "Search" }
            ]},
            { "node": "col", "name": "addCell", "align": "end", "children": [
              { "node": "actions", "name": "tableActions", "label": "Table actions", "items": [
                {
                  "name": "btnAddBooking", "label": "Add booking",
                  "style": "primary", "icon": "PlusOutlined",
                  "do": "openDialog",
                  "with": { "form": "boxfusion.test/booking-create", "title": "New booking", "width": "60%", "mode": "edit" },
                  "onSuccess": { "do": "refresh", "with": { "target": "bookings" } }
                }
              ]}
            ]}
          ]
        },
        {
          "node": "table",
          "name": "bookingsTable",
          "label": "Bookings",
          "freezeHeaders": true,
          "inline": "none",
          "style": { "surface": "card" },
          "onRowClick": { "do": "navigate", "with": { "form": "boxfusion.test/booking-details", "args": { "id": "{{selectedRow.id}}" } } },
          "columns": [
            { "bind": "bookingReference", "caption": "Reference",  "width": 140, "min": 130 },
            { "bind": "passengerName",    "caption": "Passenger",                "min": 180 },
            { "bind": "origin",           "caption": "From",       "width": 150, "min": 120 },
            { "bind": "destination",      "caption": "To",         "width": 150, "min": 120 },
            { "bind": "departureDate",    "caption": "Departure",  "width": 150, "min": 130 },
            { "bind": "cabinClass",       "caption": "Cabin",      "width": 150, "min": 130 },
            { "bind": "status",           "caption": "Status",     "width": 150, "min": 130,
              "render": { "kind": "statusBadge", "refList": "boxfusion.test/BookingStatus", "solid": true, "showName": true } }
          ]
        },
        { "node": "pager", "name": "bookingsPager", "style": { "pad": { "top": 14 } } }
      ]
    }
  ]
}
```

**The three clean fixtures**, so `# pass 18` in §2.9 criterion 1 is an exact number. Each is ≤ 2 KB of SFS and exists to make one kind compilable and one class of prop reachable:

| Fixture | `kind` | Exercises |
|---|---|---|
| `bookings-table.sfs.json` | `list` | the literal above: `page`, `data`, `row`+`responsive`, `search`, `actions`+`openDialog`+`onSuccess:refresh`, `table` with 7 columns and a `statusBadge`, `pager` |
| `booking-create.sfs.json` | `create` | `field` with `required: true` (⇒ auto-inserted `errors`), `select` with `source:"refList"`, `field` with an explicit `component`, `hooks.onPrepareSubmitData`, a submit `actions` group |
| `booking-details.sfs.json` | `detail` | `card` with `headerChildren`, `kib` with 3 `bands`, `tabs` with 2 tabs, `text` headings via `$type:`/`$role:`, `childTable`, `panel` with `collapsedByDefault` |

Together they cover every `node` kind except `raw`, `alert`, `picker`, `tags` and `attachments`, which are covered by `test/fixtures/gaps/` and by the negative cases. `g-sfs-invariants` prints `nodeKindsCovered=<n>/23` (the `node` enum has 23 members) and fails below 16.

---

### 2.2 `packages/sfs/schema/sfs.schema.json`

Draft 2020-12. This skeleton must validate every `test/fixtures/clean/*.sfs.json` and must **reject** each of the 14 negative cases listed after it. Every `$defs` member listed here is required. There are no `$dynamicRef`/`$dynamicAnchor` keywords: plain `$ref` is equivalent here because nothing extends the schema, and dynamic scoping is not worth one minute of session time.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://boxfusion.io/schema/sfs/1.0/sfs.schema.json",
  "title": "Shesha Form Spec 1.0",
  "type": "object",
  "additionalProperties": false,
  "required": ["sfs", "form", "module", "kind", "label", "body"],
  "properties": {
    "sfs":         { "const": "1.0" },
    "form":        { "$ref": "#/$defs/slug" },
    "module":      { "$ref": "#/$defs/moduleName" },
    "kind":        { "enum": ["list", "detail", "create", "edit", "modal", "dashboard", "custom"] },
    "entity":      { "$ref": "#/$defs/clrType" },
    "label":       { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "access":      { "enum": ["inherited", "authenticated", "anonymous"], "default": "authenticated" },
    "permissions": { "type": "array", "items": { "type": "string" }, "default": [] },
    "brand":       { "$ref": "#/$defs/slug", "default": "shesha" },
    "submits":     { "type": "boolean", "default": false },
    "page": {
      "type": "object", "additionalProperties": false,
      "required": ["title"],
      "properties": { "title": { "type": "string" }, "subtitle": { "type": "string" } }
    },
    "hooks": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "onAfterDataLoad":    { "$ref": "#/$defs/script" },
        "onPrepareSubmitData":{ "$ref": "#/$defs/script" },
        "onBeforeSubmit":     { "$ref": "#/$defs/script" },
        "onSubmitSuccess":    { "$ref": "#/$defs/script" },
        "onSubmitFailed":     { "$ref": "#/$defs/script" }
      }
    },
    "body": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/region" } },
    "raw":  { "$ref": "#/$defs/rawBlock" }
  },
  "allOf": [
    {
      "if":   { "properties": { "kind": { "enum": ["list", "detail", "create", "edit"] } }, "required": ["kind"] },
      "then": { "required": ["entity"] }
    },
    {
      "if":   { "properties": { "kind": { "const": "modal" } }, "required": ["kind"] },
      "then": { "not": { "required": ["page"] } }
    }
  ],

  "$defs": {
    "slug":       { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,63}$" },
    "moduleName": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.-]{0,127}$" },
    "clrType":    { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+$" },
    "ident":      { "type": "string", "pattern": "^[a-z][A-Za-z0-9]{0,39}$" },
    "formRef":    { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.-]*/[a-z][a-z0-9-]*$" },
    "refListRef": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.-]*/[A-Za-z][A-Za-z0-9_]*$" },
    "entityPath": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$" },
    "script":     { "type": "string", "minLength": 1 },
    "px":         { "type": "string", "pattern": "^[0-9]+px$" },
    "tokenRef":   { "type": "string", "pattern": "^\\$(role|type|space|radius|shadow):[A-Za-z0-9_.-]+$" },

    "binding": {
      "oneOf": [
        { "$ref": "#/$defs/entityPath" },
        { "type": "object", "additionalProperties": false,
          "required": ["path"],
          "properties": {
            "path":      { "$ref": "#/$defs/entityPath" },
            "required":  { "type": "boolean" },
            "editMode":  { "enum": ["editable", "readOnly", "inherited"] },
            "label":     { "type": "string" },
            "component": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false, "required": ["code"],
          "properties": { "code": { "$ref": "#/$defs/script" } } },
        { "type": "object", "additionalProperties": false, "required": ["const"],
          "properties": { "const": { "$comment": "any JSON value" } } }
      ]
    },

    "responsive": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "stack": { "enum": ["at:tablet", "at:mobile", "never"] },
        "fill":  { "$ref": "#/$defs/ident" },
        "fixed": {
          "type": "object", "minProperties": 1,
          "propertyNames": { "$ref": "#/$defs/ident" },
          "additionalProperties": { "$ref": "#/$defs/px" }
        },
        "gap":   { "type": "integer", "minimum": 0, "maximum": 64 },
        "hide":  { "type": "array", "items": { "enum": ["desktop", "tablet", "mobile"] }, "uniqueItems": true },
        "width": { "type": "string" }
      },
      "dependentRequired": { "fixed": ["fill"] }
    },

    "style": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "surface": { "enum": ["card", "flat", "panel", "none"] },
        "bg":      { "allOf": [ { "$ref": "#/$defs/tokenRef" } ] },
        "border":  { "allOf": [ { "$ref": "#/$defs/tokenRef" } ] },
        "radius":  { "allOf": [ { "$ref": "#/$defs/tokenRef" } ] },
        "shadow":  { "allOf": [ { "$ref": "#/$defs/tokenRef" } ] },
        "pad":     { "$ref": "#/$defs/boxSides" },
        "margin":  { "$ref": "#/$defs/boxSides" },
        "text": {
          "type": "object", "additionalProperties": false,
          "properties": {
            "size":   { "oneOf": [ { "$ref": "#/$defs/tokenRef" }, { "type": "integer" } ] },
            "weight": { "enum": ["regular", "medium", "semibold", "bold"] },
            "color":  { "$ref": "#/$defs/tokenRef" },
            "align":  { "enum": ["left", "center", "right"] }
          }
        },
        "width":  { "type": "string" },
        "height": { "type": "string" }
      }
    },
    "argMap": {
      "$comment": "action arguments are static scalars or a single framework mustache reference; a {code:...} here is EXP-4402",
      "type": "object",
      "additionalProperties": {
        "oneOf": [ { "type": "string", "pattern": "^(\\{\\{[A-Za-z0-9_.\\[\\]]+\\}\\}|[^{}]*)$" },
                   { "type": "number" }, { "type": "boolean" }, { "type": "null" } ]
      }
    },
    "boxSides": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "top":    { "type": "integer" }, "bottom": { "type": "integer" },
        "left":   { "type": "integer" }, "right":  { "type": "integer" }
      }
    },

    "action": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "do"],
      "properties": {
        "name":  { "$ref": "#/$defs/ident" },
        "label": { "type": "string" },
        "style": { "enum": ["primary", "default", "dashed", "link", "text", "ghost"] },
        "icon":  { "type": "string", "pattern": "^[A-Z][A-Za-z0-9]+$" },
        "do":    { "enum": ["openDialog", "navigate", "refresh", "exportExcel", "script", "submit"] },
        "with":  { "type": "object" },
        "onSuccess": { "$ref": "#/$defs/action0" },
        "onFail":    { "$ref": "#/$defs/action0" },
        "when":  { "$ref": "#/$defs/binding" }
      },
      "allOf": [
        { "if": { "properties": { "do": { "const": "openDialog" } }, "required": ["do"] },
          "then": { "properties": { "with": { "type": "object", "required": ["form"],
            "properties": { "form": { "$ref": "#/$defs/formRef" }, "title": { "type": "string" },
              "width": { "type": "string" }, "mode": { "enum": ["edit", "readonly"] },
              "footer": { "enum": ["default", "none", "custom"] }, "args": { "type": "object" },
              "relay": { "type": "object" } }, "additionalProperties": false } },
            "required": ["with"] } },
        { "if": { "properties": { "do": { "const": "navigate" } }, "required": ["do"] },
          "then": { "properties": { "with": { "type": "object", "required": ["form"],
            "properties": { "form": { "$ref": "#/$defs/formRef" }, "args": { "$ref": "#/$defs/argMap" } },
            "additionalProperties": false } }, "required": ["with"] } },
        { "if": { "properties": { "do": { "enum": ["refresh", "exportExcel"] } }, "required": ["do"] },
          "then": { "properties": { "with": { "type": "object", "required": ["target"],
            "properties": { "target": { "$ref": "#/$defs/ident" } }, "additionalProperties": false } },
            "required": ["with"] } },
        { "if": { "properties": { "do": { "const": "script" } }, "required": ["do"] },
          "then": { "properties": { "with": { "type": "object", "required": ["code"],
            "properties": { "code": { "$ref": "#/$defs/script" } }, "additionalProperties": false } },
            "required": ["with"] } }
      ]
    },
    "action0": {
      "$comment": "same as action but name/label optional — chained actions have no button",
      "type": "object", "additionalProperties": false,
      "required": ["do"],
      "properties": {
        "do": { "enum": ["openDialog", "navigate", "refresh", "exportExcel", "script", "submit"] },
        "with": { "type": "object" },
        "onSuccess": { "$ref": "#/$defs/action0" }
      }
    },

    "column": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "bind":     { "$ref": "#/$defs/entityPath" },
        "caption":  { "type": "string", "minLength": 1 },
        "width":    { "type": "integer", "minimum": 24 },
        "min":      { "type": "integer", "minimum": 24 },
        "sortable": { "type": "boolean", "default": true },
        "visible":  { "type": "boolean", "default": true },
        "render":   { "$ref": "#/$defs/render" },
        "editor":   { "type": "object" },
        "do":       { "$ref": "#/$defs/action0" },
        "raw":      { "$ref": "#/$defs/rawBlock" }
      },
      "anyOf": [ { "required": ["bind"] }, { "required": ["do"] } ]
    },
    "render": {
      "type": "object", "required": ["kind"], "additionalProperties": false,
      "properties": {
        "kind":     { "enum": ["text", "number", "date", "boolean", "link", "statusBadge", "custom"] },
        "refList":  { "$ref": "#/$defs/refListRef" },
        "solid":    { "type": "boolean" },
        "showName": { "type": "boolean" },
        "showIcon": { "type": "boolean" },
        "format":   { "type": "string" },
        "type":     { "type": "string" },
        "props":    { "type": "object" }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "statusBadge" } }, "required": ["kind"] },
          "then": { "required": ["refList"] } },
        { "if": { "properties": { "kind": { "const": "custom" } }, "required": ["kind"] },
          "then": { "required": ["type"] } }
      ]
    },

    "rawBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["reason"],
      "properties": {
        "at":          { "enum": ["base", "desktop", "tablet", "mobile", "formSettings", "items", "envelope"], "default": "base" },
        "reason":      { "type": "string", "minLength": 12 },
        "props":       { "type": "object",
                         "propertyNames": { "not": { "enum": ["id", "parentId", "version"] } } },
        "type":        { "type": "string" },
        "childrenKey": { "type": "string" }
      }
    },

    "regionCommon": {
      "type": "object",
      "required": ["node", "name"],
      "properties": {
        "node":       { "type": "string" },
        "name":       { "$ref": "#/$defs/ident" },
        "label":      { "type": "string" },
        "responsive": { "$ref": "#/$defs/responsive" },
        "style":      { "$ref": "#/$defs/style" },
        "when":       { "$ref": "#/$defs/binding" },
        "raw":        { "$ref": "#/$defs/rawBlock" },
        "children":   { "type": "array", "items": { "$ref": "#/$defs/region" } }
      }
    },

    "region": {
      "allOf": [ { "$ref": "#/$defs/regionCommon" } ],
      "unevaluatedProperties": false,
      "oneOf": [
        { "properties": { "node": { "enum": ["row", "col"] },
                          "align": { "enum": ["start", "center", "end", "stretch"] },
                          "justify": { "enum": ["start", "center", "end", "between", "around"] } } },
        { "properties": { "node": { "const": "card" },
                          "headerChildren": { "type": "array", "items": { "$ref": "#/$defs/region" } },
                          "title": { "type": "string" } } },
        { "properties": { "node": { "const": "data" },
                          "entityType": { "$ref": "#/$defs/clrType" },
                          "pageSize": { "type": "integer", "minimum": 1, "maximum": 200, "default": 10 },
                          "mode": { "enum": ["paging", "all"], "default": "paging" },
                          "filter": { "$ref": "#/$defs/binding" } } },
        { "properties": { "node": { "const": "table" },
                          "columns": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/column" } },
                          "freezeHeaders": { "type": "boolean", "default": false },
                          "inline": { "enum": ["none", "onRowSave", "oneByOne", "all"], "default": "none" },
                          "onRowClick": { "$ref": "#/$defs/action0" },
                          "onRowDoubleClick": { "$ref": "#/$defs/action0" } },
          "required": ["columns"] },
        { "properties": { "node": { "const": "list" },
                          "rowTemplate": { "$ref": "#/$defs/formRef" },
                          "onItemClick": { "$ref": "#/$defs/action0" } },
          "required": ["rowTemplate"] },
        { "properties": { "node": { "enum": ["pager", "search", "errors"] } } },
        { "properties": { "node": { "const": "kib" },
                          "bands": { "type": "array", "minItems": 1, "items": {
                            "type": "object", "additionalProperties": false,
                            "required": ["name", "children"],
                            "properties": { "name": { "$ref": "#/$defs/ident" },
                                            "title": { "type": "string" },
                                            "width": { "type": "string" },
                                            "children": { "type": "array", "items": { "$ref": "#/$defs/region" } } } } } },
          "required": ["bands"] },
        { "properties": { "node": { "const": "childTable" },
                          "bind": { "$ref": "#/$defs/entityPath" },
                          "columns": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/column" } },
                          "inline": { "enum": ["none", "onRowSave", "oneByOne", "all"], "default": "none" } },
          "required": ["bind"] },
        { "properties": { "node": { "const": "status" },
                          "bind": { "$ref": "#/$defs/binding" },
                          "refList": { "$ref": "#/$defs/refListRef" },
                          "solid": { "type": "boolean" }, "showName": { "type": "boolean" },
                          "showIcon": { "type": "boolean" } },
          "required": ["refList"] },
        { "properties": { "node": { "const": "select" },
                          "bind": { "$ref": "#/$defs/binding" },
                          "source": { "enum": ["refList", "entity"], "default": "refList" },
                          "refList": { "$ref": "#/$defs/refListRef" },
                          "entityType": { "$ref": "#/$defs/clrType" },
                          "multiple": { "type": "boolean" },
                          "placeholder": { "type": "string" } },
          "required": ["bind"] },
        { "properties": { "node": { "const": "picker" },
                          "bind": { "$ref": "#/$defs/binding" },
                          "entityType": { "$ref": "#/$defs/clrType" },
                          "columns": { "type": "array", "items": { "$ref": "#/$defs/column" } } },
          "required": ["bind"] },
        { "properties": { "node": { "enum": ["tags", "attachments"] },
                          "bind": { "$ref": "#/$defs/binding" } },
          "required": ["bind"] },
        { "properties": { "node": { "const": "actions" },
                          "items": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/action" } } },
          "required": ["items"] },
        { "properties": { "node": { "const": "text" },
                          "content": { "type": "string" },
                          "bind": { "$ref": "#/$defs/binding" },
                          "as": { "enum": ["span", "paragraph", "title"], "default": "span" },
                          "ellipsis": { "type": "boolean" } },
          "anyOf": [ { "required": ["content"] }, { "required": ["bind"] } ] },
        { "properties": { "node": { "const": "field" },
                          "bind": { "$ref": "#/$defs/binding" },
                          "component": { "type": "string", "minLength": 2 },
                          "placeholder": { "type": "string" },
                          "props": { "type": "object", "$comment": "registry-validated in s2; unknown prop => REG-2201" } },
          "required": ["bind"] },
        { "properties": { "node": { "const": "tabs" },
                          "tabs": { "type": "array", "minItems": 1, "items": {
                            "type": "object", "additionalProperties": false,
                            "required": ["name", "title", "children"],
                            "properties": { "name": { "$ref": "#/$defs/ident" },
                                            "title": { "type": "string" },
                                            "children": { "type": "array", "items": { "$ref": "#/$defs/region" } } } } } },
          "required": ["tabs"] },
        { "properties": { "node": { "const": "panel" },
                          "title": { "type": "string" },
                          "collapsedByDefault": { "type": "boolean", "default": false } } },
        { "properties": { "node": { "const": "alert" },
                          "alertType": { "enum": ["success", "info", "warning", "error"] },
                          "content": { "type": "string" } } },
        { "properties": { "node": { "const": "raw" }, "raw": { "$ref": "#/$defs/rawBlock" } },
          "required": ["raw"] }
      ]
    }
  }
}
```

`packages/sfs/test/schema.test.mjs` contains exactly these cases, and `g-sfs-schema` runs the same assertions:

**Case 0 — the schema compiles.** This case comes first because a schema that does not compile looks like a broken toolchain rather than a schema bug:

```js
import Ajv2020 from "ajv/dist/2020.js"; import addFormats from "ajv-formats";
const ajv = new Ajv2020({ strict: true, allErrors: true }); addFormats(ajv);
test("schema compiles under ajv strict", () => { assert.doesNotThrow(() => ajv.compile(schema)); });
```

**Cases 1–3 — valid.** Every `test/fixtures/clean/*.sfs.json` validates with **0 errors** (currently 3 fixtures: `bookings-table`, `booking-create`, `booking-details`).

**Cases 4–17 — invalid, one test each**, asserting both `valid === false` and the domain code `SFS-1101`:

| # | Mutation | Rejected by |
|---|---|---|
| 4 | `responsive.stack = "below:tablet"` | enum |
| 5 | any node with `"version": 3` | `unevaluatedProperties: false` |
| 6 | any node with `"id"` or `"parentId"` | `unevaluatedProperties: false` |
| 7 | `style.bg = "#ffffff"` | `tokenRef` pattern |
| 8 | `style.text.color = "RED"` | `tokenRef` pattern |
| 9 | `responsive.fixed` without `fill` | `dependentRequired` |
| 10 | `column` with neither `bind` nor `do` | `anyOf` |
| 11 | `render.kind = "statusBadge"` without `refList` | conditional |
| 12 | `raw` with no `reason` / `reason` of 6 chars | `required` / `minLength` |
| 13 | `kind: "modal"` with a `page` | top-level `allOf` |
| 14 | unknown `node` kind (`"node":"grid"`) | `oneOf` |
| 15 | unknown top-level key | `additionalProperties: false` |
| 16 | `name` containing `_` | `ident` pattern |
| 17 | `raw.props.id` present | `propertyNames.not` |

The schema printed above is **verified as printed**: `Draft202012Validator.check_schema` passes, the §2.1.10 fixture validates with **0 errors**, and all 14 negatives are rejected. Two of the rejections (cases 11 and 14) come back as `Unevaluated properties are not allowed ('bind' was unexpected)`, which is why the next rule exists.

**`oneOf` branch failures produce a useless raw message, so stage 1 never reports one.** Cases 10, 11 and 14 all report `Unevaluated properties are not allowed ('columns', 'freezeHeaders', …)` from ajv, because every branch failed and the validator reports the last. `s1-parse.mjs` **dispatches on the `node` discriminator before reporting**: read `instance.node`, select the matching branch schema by its `node` const/enum, re-validate against that branch alone, and report those errors as `SFS-1101`. An unknown `node` value reports `SFS-1101` with the legal enum listed. Case 11 additionally asserts the rendered message contains both `refList` and `statusBadge`; case 14 asserts it contains `grid` and at least 20 of the legal node names.

---

### 2.3 The compiler: six stages

`compile(sfsDoc, ctx) → { markup, envelope, report, diagnostics }`, where `ctx = { registry, metadata|null, tokens, decisions, seed }`. **Exactly one exported entry point** (`src/compile/index.mjs`), and it is the only function in the repo that writes a Shesha form — the "one push path" invariant becomes true because there is exactly one function [§4/L2].

Stages are pure functions composed left to right. Each returns `{ tree, diagnostics }`. A stage that raises an `error`-severity diagnostic halts the pipeline; later stages never run and **no file is written**. The only other severity is `info`; it accumulates, is counted in `counts.warnings`, and **never** changes a verdict. There is no `warn` verdict anywhere in this architecture (§2.4.6).

| # | Stage | In | Out | Owns (exhaustive) | Failure modes |
|---|---|---|---|---|---|
| 1 | `s1-parse` | `.sfs.json` bytes | validated `sfsDoc` | UTF-8 decode; `JSON.parse`; ajv validation against `sfs.schema.json`; ajv error → domain error translation; sibling-`name` uniqueness; `sfs` version gate; forbidden-key scan (`id`/`parentId`/`version`/`actionName`/`actionOwner`/`componentName`) | `SFS-1000` malformed JSON (with line/col) · `SFS-1001` wrong `sfs` version · `SFS-1002` unknown key · `SFS-1003` forbidden key · `SFS-1005` duplicate sibling `name` · `SFS-1101` schema violation (one per ajv error, deduped by instancePath) |
| 2 | `s2-resolve` | `sfsDoc` | annotated tree (`_type`, `_version`, `_props`, `_meta`, `_tokens` resolved) | node→component `type` + `version` from registry; prop legality + **value type** per prop; enum domain check; `authorable:false` rejection; entity metadata lookup for every binding (camelCase normalisation happens here); datatype→component resolution for `field`; reference-list ref split into `{module,name}`; `formRef` split into `{name,module}`; action intent → `(actionName, actionOwner-class)`; `ownerRef` target existence + type; every `$role:`/`$type:`/`$space:`/`$radius:`/`$shadow:` token to a literal; `decisions.json` lookup with `assumed` entries recorded | `REG-2101` unknown type · `REG-2102` non-authorable type · `REG-2201` unknown prop · `REG-2202` value-type mismatch · `REG-2203` enum out of domain · `REG-2301` unknown action intent · `REG-2302` intent/argument mismatch · `MET-2101` entity not found · `MET-2201` property not found · `MET-2202` ambiguous path · `MET-2203` no datatype mapping · `MET-2301` reference list unresolved · `MET-2401` form target not found · `TOK-2001..2005` unresolved token · `TOK-2010` literal colour. **Backend absent ⇒ `MET-*` existence checks become `uninspectable`, counted, verdict `partial`, exit 3 — never `pass`** |
| 3 | `s3-normalise` | annotated tree | canonical tree | drop every legacy style prop when a v7 channel exists; collapse duplicated wiring to one channel (`N7`); page-shell canonicalisation (`N1`,`N4`,`N10`); `formSettings` profile selection and stripping of keys illegal for the `kind` (`N8`); `stylingBox` placement (`N6`); label/`hideLabel` defaults (`N1`); strip `columns`/`sizableColumns`; strip `row-reverse`/`column-reverse` (`debug.md` row 18); canonical column `sortOrder` = index; canonical key ordering assigned to every node | `NRM-3101` two styling channels both explicitly set (unreachable from SFS; reachable from `decompile` — reported, then base wins) · `NRM-3201` conflicting row-click wirings · `NRM-3301` reversed flex direction requested via `raw` · `NRM-3401` hook illegal for `kind` |
| 4 | `s4-expand` | canonical tree | full tree | all three breakpoint blocks per node from one `style` + one `responsive`; `calc()` reserve arithmetic; registry defaults for every unstated prop; slot topology (`content.components`, `header.components`, `tabs[]`, `items[]`); column `[not-editable]` triplets; `crud-operations` column insertion; `refListStatus` v6 canonical settings; `validationErrors` auto-insert; `editMode` stamping per `kind` on group **and** item; `try/catch` wrapping of every emitted script body; recipe application (`pageShell`, `dataRegion`, `flexRow`, `statusBadge`, `datalistRowCard`, `actionsGroup`); `raw` merge (last) | `EXP-4101` responsive geometry unsatisfiable · `EXP-4104` non-px `fixed` · `EXP-4201` slot topology unknown for type · `EXP-4301` column editor shape · `EXP-4302` `[default]` on edit/create · `EXP-4303` inline enabled without CRUD column (auto-fixed, `info`) · `EXP-4402` dynamic `openDialog` args · `EXP-4701` required input with no `validationErrors` (auto-fixed, `info`) |
| 5 | `s5-stamp` | full tree | identified tree | seeded deterministic `id` per node, slot and item (§2.4.2); `parentId` = direct parent's `id`, root children `"root"`; card slot ids; `version` integer per node from registry; `actionOwner` `ownerRef` → the stamped `data` region id; action-config `version` + `actionArguments.version` | `STM-5101` id collision (two nodes resolved to the same path — a bug; include both paths) · `STM-5201` missing registry version for an authorable type · `STM-5301` unresolvable `ownerRef` after stamping |
| 6 | `s6-serialise` | identified tree | `{Markup: string, envelope: object}` + report | ordered `JSON.stringify` with the canonical key order; `stylingBox` inner-JSON stringify with canonical key order and no spaces; `Markup` = `JSON.stringify({components, formSettings})`; the 23-field envelope with `Id ≡ OriginId`, `Access` mirrored to `formSettings.access`, `ItemType:"form"`, `Suppress:false`, `BaseModules:[]`, `ConfigHash:""`; UTF-8 byte encoding on the push path; `_code` parse check; compile-report emission | `SER-6101` non-serialisable value reached stage 6 · `SER-6201` emitted `_code` fails to parse · `SER-6301` non-UTF-8-encodable content (push path) · `SER-6401` post-push `GetByName` mismatch (push path only, backend required) |

The **23 envelope fields**, in canonical order (measured from production): `Markup`, `ModelType`, `TemplateId`, `IsTemplate`, `Access`, `Permissions`, `ConfigurationForm`, `GenerationLogicTypeName`, `GenerationLogicExtensionJson`, `PlaceholderIcon`, `Id`, `OriginId`, `Name`, `Label`, `ItemType`, `Description`, `ModuleName`, `FrontEndApplication`, `Suppress`, `DateUpdated`, `BaseModules`, `Comments`, `ConfigHash`. `DateUpdated` is always `null` on write — it is server-owned, and writing a value would introduce a clock (§2.4.3).

#### 2.3.1 Deterministic responsibilities transferred from the model

Every item below is emitted by the compiler and is **unrepresentable in SFS**. This list is a contract, not a rationale: each item is asserted by the §2.6 predicate or count identity named in brackets, and `g-sfs-invariants` runs all of them.

* **s2** — camelCasing of every `propertyName` [N11]; brand `$role:`/`$type:`/`$space:`/`$radius:`/`$shadow:` resolution to literals [`g-no-literal-hex`]; action intent → `(actionName, actionOwner)` with lowercase owners and spaced action names.
* **s3** — `formSettings` selected by `kind` and stripped to `allowed ∪ forbidden` [N8]; legacy style props deleted [N5]; one wiring per event [N7]; `sortOrder` = array index [A7]; reversed flex directions dropped.
* **s4** — all three breakpoint blocks from one `style` + one `responsive` [N2, N3, A2]; `calc()` reserve arithmetic; children into the registry's `childrenKey`, including `card.content.components` [A1]; the `[not-editable]` edit/create triplet on every non-inline column; `refListStatus` v6 canonical `referenceListId:{module,name}`; `crud-operations` column insertion; `validationErrors` auto-insert; `editMode` per `kind` on group **and** item; `try/catch` around every emitted script; registry defaults for every unstated prop.
* **s5** — one v5 id per node, slot and item [A1]; `parentId` linkage with root children `"root"`; the `version` integer per component type [A4]; `ownerRef` → the stamped `data` region id.
* **s6** — canonical key order and byte-stable stringify [§2.4.4]; `Markup` escaping and `stylingBox` inner escaping [N6]; the 23-field envelope with `Id ≡ OriginId` and mirrored `Access`.

Model output shrinks by `markupBytes / sfsBytes`, measured per fixture by `tools/measure-form.mjs` and printed by `g-sfs-invariants`. The asserted floor is **8×** (§2.1.10). No count in this brief is an expectation; the counts are asserted as the identities A1–A7 of §2.6.
### 2.4 Determinism contract

#### 2.4.1 The property

`compile(sfs, ctx)` is a pure function of `(sfs bytes, registry contentHash, tokens contentHash, decisions contentHash, compilerVersion)`. Same inputs ⇒ **byte-identical** `Markup` string and envelope. Enforced by `test/determinism.test.mjs`: compile every fixture 50 times in one process and 3 times in 3 child processes; assert all outputs `===` the first. Any failure is a determinism bug, not a flake.

#### 2.4.2 Seeded id generation

`src/lib/ids.mjs`:

```js
export const SFS_ID_NAMESPACE = "3f2b7c14-9d68-5a41-b0e7-1c6a8f5d2e90"; // fixed, never change
// uuidv5(namespace, name) using node:crypto createHash('sha1'), RFC 4122 §4.3
export function nodeId(module, form, path) {
  return uuidv5(SFS_ID_NAMESPACE, `${module}/${form}|${path}`);
}
```

* `path` is built from **`name`s, never indices**: `/pageShell/bookings/toolbar/searchCell/quickSearch`. Slots: `/pageShell#slot:content`. Columns: `/bookings/bookingsTable#col:status`. Action items: `/bookings/toolbar/addCell/tableActions#item:btnAddBooking`.
* **UUIDv5, not v4** — v4 needs randomness, v5 is a hash. Both are accepted by the framework (production forms carry both UUIDs and 30-char nanoids), so the compiler standardises on v5 for every id including card slot ids, `columns[]` ids, `bands[]` ids and `items[]` ids. Every compiler-emitted id matches `^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` — **version nibble 5**. Any verifier check that tests for v4 on compiler output is wrong and rejects 100% of it (Section 3's T1.08 is written against v5 and additionally recomputes `nodeId` from the meta sidecar's `sfsPath`; a hand-edited id therefore fails).
* Every compile writes a **meta sidecar** `<out>/<form>.compiled.meta.json`: `{ "form": "...", "nodes": [ { "id": "...", "sfsPath": "/pageShell/bookings/toolbar", "name": "toolbar", "type": "container" } ] }`. This is the only input a verifier needs to recompute ids without parsing SFS, and it is what makes id-stamping checkable rather than a format check.
* `compilerVersion` is deliberately **excluded** from the id input: including it would rewrite every id on every compiler bump, destroying diff reviewability — the stated purpose of seeding [§4/L2].
* Consequence, and the reason `name` is mandatory: **inserting or reordering a sibling changes no other node's id.** A rename changes exactly that subtree's ids. Renaming is therefore a reviewable, intentional act.
* Collision (two paths hashing equal, or two nodes producing the same path) ⇒ `STM-5101` with both paths printed. Assert uniqueness over the whole tree before returning.

#### 2.4.3 No clock, no randomness

Banned in `packages/sfs/src/**`: `Date`, `Date.now`, `Math.random`, `crypto.randomUUID`, `crypto.randomBytes`, `process.hrtime`, `performance.now`, `os.hostname`, `process.cwd` (in output paths), `new Intl.*` (locale-dependent formatting). Enforced by `test/determinism.test.mjs` step 1: read every `.mjs` under `src/`, regex-scan for the banned identifiers, fail listing file and line. This is a lint implemented as a test so it runs under `npm test` — not a documented convention.

Timestamps that genuinely must exist (report `startedAt`) live only in `reports/**`, which is gitignored and excluded from every equality assertion. `registry/**/_meta.json` carries **no** `generatedAt` for the same reason (§2.8.3).

#### 2.4.4 Canonical key order

`src/lib/orderedJson.mjs` exports `orderedStringify(value, keyOrder)`. Never call `JSON.stringify` on a node directly. Node key order:

```
id, type, version, propertyName, componentName, label, hideLabel, labelAlign,
hidden, isDynamic, <type-specific props in registry declaration order>,
editMode, enableStyleOnReadonly, desktop, tablet, mobile,
items, tabs, content, header, components, parentId
```

Breakpoint-block key order: `display, flexDirection, justifyContent, alignItems, flexWrap, gap, font, background, border, shadow, dimensions, stylingBox, enableStyleOnReadonly, className`.
`dimensions` key order: `width, height, minHeight, maxHeight, minWidth, maxWidth`.
`stylingBox` inner order: `marginTop, marginRight, marginBottom, marginLeft, paddingTop, paddingRight, paddingBottom, paddingLeft`, stringified with no spaces, omitting absent sides.
`formSettings` key order: exactly as listed in §2.1.3.
Envelope key order: exactly the 23 fields of §2.3.

Any key not in the order list ⇒ `SER-6102`. The order list is not allowed to have an "everything else, alphabetically" tail: an unlisted key means the registry is incomplete, and that must fail loudly.

#### 2.4.5 Idempotence and the round-trip property

`test/idempotence.test.mjs` asserts, for every clean fixture and every form in §2.5's declared subset:

```
P1  compile(decompile(compile(x))).Markup === compile(x).Markup        // byte equality
P2  decompile(compile(decompile(m)))      deepEqual  decompile(m)      // SFS-level equality
P3  normalForm(compile(decompile(m)))     deepEqual  normalForm(normaliseLegacy(m))   // oracle agreement
```

**P1 is the only byte-equality property, and its subject is the compiler's own output.** Names inside `compile(x)` are already canonical, so the decompiler can recover them. A property of the form `compile(handWritten) === compile(decompile(legacy))` is **not** assertable and must not be written anywhere: §2.4.2 derives every id from author-chosen `name`s, and §2.5 step 7 drops `componentName`, while slot/column/item path segments have no markup counterpart at all — one differing character in one name changes that id and every descendant's `parentId`. Any acceptance criterion that demands byte-equality between a hand-written fixture and a decompiled legacy form is deleted, in this section and in every section that reads it.

`normalForm(markup)` lives in `src/lib/normalForm.mjs` and is the **name-independent** comparison used by P3 and by WP-1's oracle:

```
normalForm(markup) =
  1. parse Markup
  2. replace every `id` with its tree position string ("0.2.1", slots as "0.2.1#content", items as "0.2.1#item:3")
  3. replace every `parentId` with the position of the node it points at, or "root"
  4. delete `componentName`
  5. re-serialise with orderedStringify
```

P3 is the honest form of "the compiler agrees with the normaliser": both sides are normalised markup, `tools/normalise-legacy.mjs` never touches SFS, and the two implementations are independent. Id determinism is asserted separately, by `test/determinism.test.mjs`, which recomputes every id from the meta sidecar's `sfsPath` and asserts equality with the emitted id.
#### 2.4.6 The compile report

Every compile writes `<out>/<form>.compile.json` validated against `schema/compile-report.schema.json`:

```json
{
  "form": "boxfusion.test/bookings-table",
  "verdict": "pass" | "partial" | "fail",
  "exit": 0,
  "sfsSha256": "…", "registryRef": "0.45.1@3418e292", "registrySha256": "…",
  "brand": "shesha", "tokensSha256": "…", "compilerVersion": "1.0.0",
  "markupSha256": "…", "markupBytes": 19170,
  "counts": { "components": 12, "breakpointBlocks": 33, "ids": 22, "versionsStamped": 12,
              "columns": 7, "actions": 3, "scripts": 0 },
  "coverage": { "bindings": { "walked": 7, "checked": 7, "uninspectable": 0 },
                "refLists": { "walked": 1, "checked": 0, "uninspectable": 1 },
                "formRefs": { "walked": 2, "checked": 0, "uninspectable": 2 } },
  "ids": { "/pageShell": "…", "…": "…" },
  "escapes": [],
  "assumptions": [ { "id": "D-101", "decision": "…", "confidence": "assumed", "probe": "P-101" } ],
  "diagnostics": []
}
```

Rules, enforced in `packages/registry/src/coverage.mjs` (one implementation, shared with the verifier tiers per §5):

* `walked > 0 && checked === 0` ⇒ verdict **cannot** be `pass`. This is the zero-coverage rule `verify-artifact.mjs` lacks and `check-references.mjs` has [§1.4]; implement it once, here.
* Any `uninspectable > 0` ⇒ verdict `partial`, exit **3**, and stdout prints `A partial verdict is NOT a pass` — reuse the existing wording so operators see one vocabulary.
* Any `assumptions[]` entry with `confidence:"assumed"` is printed to stdout. An assumed decision is never silent.
* Every family is printed on every run, including families whose `walked` is 0, and the verdict union is exactly `{pass, partial, fail, notRun}` — there is no `warn` verdict anywhere in this section. Warnings are *counted* (`counts.warnings`) and never change a verdict.
* Exit codes: `0` pass, `1` fail, `2` usage/internal, `3` partial. No other value. `bin/sfsc.mjs` never calls `process.exit(0)` on a path where any family has a non-empty `failures[]`.

---

### 2.5 The decompiler, the declared subset, and the round-trip property

`decompile(envelopeOrMarkup, ctx) → { sfs, diagnostics, unlifted[], provenance }`. Steps, in order:

1. **Envelope unwrap** — accept the 23-field envelope, a bare `{components, formSettings}`, or a bare `components[]`. One unwrapper (`detect.mjs`), replacing the three disagreeing ones in the current repo [§1.4]. **Every form on disk in this repo today is the bare `{components, formSettings}` shape** — all 12 files under `shesha-form-edit/assets/examples/` are, with no `Markup` string and no envelope. When the input has no envelope, `detect.mjs` synthesises one from the 23-field defaults and sets `provenance = "ENVELOPE-SYNTHESISED"`, which is written into the report and into `<form>.compiled.meta.json`. Section 3's `file` family is `uninspectable` on any artifact whose provenance is `ENVELOPE-SYNTHESISED`; it is never a pass and never a fail.
2. **`kind` inference** — from `formSettings` (`dataLoaderType`/`dataSubmitterType`/presence of a root `datatable`/`datalist`) against the §2.1.3 table. Ambiguous ⇒ `custom` + a counted diagnostic.
3. **Node kind detection** — `components.json[type].sfsNode` (`D-111`). No `sfsNode` + `isInput:true` ⇒ `{node:"field", component:"<type>"}`, **not** an escape. No `sfsNode` + `isInput:false` ⇒ `node:"raw"` with `reason:"decompiled: no SFS container for <type>"`, **structural escape**.
4. **`liftStyles`** — read the three breakpoint blocks; if appearance channels are equal across all three, lift to one `style` and reverse-resolve literals to `$role:` tokens by exact value match against the active brand (`#ffffff` → `$role:cardBg`). Unequal appearance across breakpoints ⇒ record a **defect finding**, take the `desktop` value, emit an `NRM-3101` info diagnostic. This is how the normalisation report gets written.
5. **`liftResponsive`** — invert the reserve arithmetic: a `calc(100% - Npx)` sibling plus fixed-px siblings summing with the gap to `N` ⇒ `{fill, fixed, gap}`. Detect `stack` from the narrowest breakpoint that has `flexDirection:"column"` or all-100% children. Non-invertible geometry ⇒ `raw` at that breakpoint (non-structural).
6. **`liftActions`** — `(actionName, actionOwner)` → intent via `actions.json`; a GUID/nanoid `actionOwner` resolves to the `name` of the node with that `id`. Unmapped pair ⇒ `raw` (non-structural).
7. **Drop everything the compiler regenerates** — `id`, `parentId`, `version`, `componentName`, every prop equal to its registry default, `sortOrder`, every legacy style prop.
8. **Name synthesis** — `componentName` is dropped in step 7, so names are re-derived: `propertyName` camelCased when present, else `<node><Index>` scoped to the parent. Names are therefore **not** recoverable from markup, which is why §2.4.5 P1 is the only byte-equality property.
9. **Emit SFS** and validate against `sfs.schema.json`. Invalid SFS out of the decompiler is `DEC-7001`.

CLI:

```
npm run sfs -- decompile packages/sfs/corpus/<name>.json --out packages/sfs/corpus-sfs
npm run sfs -- roundtrip --subset packages/sfs/config/roundtrip-expected.json --report packages/sfs/reports/roundtrip.json
```

**The declared subset.** The corpus is 12 forms totalling 2.5 MB, six of which are 118 KB–730 KB. This session gates the six smallest and *triages* the six largest; a rate over all 12 is `BL-002` and belongs to Section 5's WP-6 row. `packages/sfs/config/roundtrip-expected.json`, literally:

```json
{
  "declaredSubset": [
    { "form": "entity-datalist",       "bytes": 4472,   "expect": "clean" },
    { "form": "standalone-create",     "bytes": 7681,   "expect": "structural-escape", "cause": "columns (D-112)", "backlog": "BL-021" },
    { "form": "entity-card",           "bytes": 10563,  "expect": "clean" },
    { "form": "rs-link-add-dialog",    "bytes": 16982,  "expect": "clean" },
    { "form": "inline-editable-table", "bytes": 27623,  "expect": "clean" },
    { "form": "employee-table",        "bytes": 118706, "expect": "clean" }
  ],
  "triageOnly": [
    "rs-detail-with-header", "employee-detail-with-child-tables",
    "employee-detail-without-child-tables", "employee-create",
    "rs-create-dialog", "rs-table"
  ],
  "gate": { "validates": 6, "clean": 5, "setMustMatchExactly": true }
}
```

`roundTrips(f)`, stated so the number is not negotiable:

```
roundTrips(f)  ⇔  decompile(f) validates against sfs.schema.json
                  AND structuralEscapes(decompile(f)) === 0
                  AND compile(decompile(f)).Markup === compile(decompile(compile(decompile(f)))).Markup
```

`test/roundtrip.test.mjs` and `g-escape-budget` assert, over `declaredSubset` only:

* all 6 decompile and validate (`validates === 6`) — a validation failure is a **fail**, never a skip;
* the **set** of forms with `roundTrips(f) === true` equals exactly the set marked `"expect":"clean"` (5 forms). A form that is expected clean and is not is a fail; a form expected to escape that comes out clean is **also** a fail, and the fix is to move its row to `"clean"` in the same commit. `setMustMatchExactly` forbids satisfying the gate by counting;
* every form in `triageOnly` is decompiled, its result recorded in `reports/roundtrip.json`, and reported as `uninspectable` with a `BLOCKED.md` row. It never contributes to pass or fail.

Deliberately **not** required: byte-equality with the original `f`. The original corpus contains the eight defects; equality with it would enshrine them [§2 corollary].

`reports/roundtrip.json` (gitignored — the machine copy):

```json
{ "subsetSize": 6, "validated": 6, "cleanExpected": 5, "cleanActual": 5, "pass": true,
  "triaged": [ { "form": "rs-table", "verdict": "uninspectable", "structuralEscapes": 0, "note": "" } ],
  "failures": [ { "form": "module/name", "triage": "compiler-gap" | "promote-to-sfs",
                  "gapId": "GAP-001", "evidence": ["prop names"], "note": "" } ],
  "normalisationFindings": [ { "form": "…", "defect": "N2", "detail": "…" } ] }
```

**Every failure is triaged into exactly one of two buckets, and both land in `/BACKLOG.md`** — there is no `OPEN-QUESTIONS.md` in this repo:

* `compiler-gap` — expressible in SFS, not yet produced byte-identically. Action: add a `GAP-###` row to `/BACKLOG.md`, and a failing fixture at `packages/sfs/test/fixtures/gaps/<gapId>.gap.test.mjs` whose single `test.todo("GAP-### …")` name **starts with the gap id**. That path and that naming are the only legal use of `test.todo(` in the repo (Section 1's `g-no-gate-tampering` carve-out reads `/BACKLOG.md` for the id).
* `promote-to-sfs` — not expressible; needed a structural `raw`. Action: a `BL-###` row in `/BACKLOG.md` with the prop names and the count of forms needing it, sorted by count. That list plus `reports/escape-report.json` is the IR backlog.

`test/roundtrip.test.mjs` asserts `failures.every(f => f.triage && f.gapId)` and that every `gapId` appears in `/BACKLOG.md`, so a failure cannot be silently dropped. An empty or unreadable corpus ⇒ `walked 0`, verdict `partial`, **exit 3**, never `pass`.
### 2.6 The normaliser: the eight golden-reference defects, one rule each

This is the compiler's acceptance test. `test/golden-defects.test.mjs` compiles every `test/fixtures/clean/*.sfs.json` and asserts these predicates over the produced markup. Each predicate is a function over the compiled tree, exported by name from `test/predicates.mjs` so `g-sfs-invariants` runs the identical code — one implementation, two callers.

| # | Defect (§1.1) | Rule | Mechanism | Assertion in `golden-defects.test.mjs` |
|---|---|---|---|---|
| 1 | `label:"Card1"`, `labelAlign:"right"`, `hideLabel` unset on the page-shell card | **N1 — label defaults** | The `pageShell` recipe emits `hideLabel:true` and **no** `label`/`labelAlign`. For every other node, `label` comes from SFS `label` or is omitted; `hideLabel` is `true` unless the node is a `field` with a visible label | no node has a `label` matching `/^[A-Z][a-z]+\d+$/`; every non-`field` node has `hideLabel === true`; no node has `labelAlign` unless `label` is present |
| 2 | `border.all.style`: base `solid`, desktop `none`, tablet `solid`, mobile `solid` | **N2 — appearance declared once** | SFS has no per-breakpoint appearance channel (`SFS-1701`). s4 writes the *same* resolved appearance object into all three blocks from one `style` | for every node and every channel in `{font,background,border,shadow}`: `deepEqual(desktop[c], tablet[c])` and `deepEqual(tablet[c], mobile[c])` |
| 3 | `className:"sha-page"` on `desktop` only | **N3 — class parity** | `className` is a recipe output, written to all three blocks in the same pass as N2 | every node that has `className` in any block has the identical value in all three |
| 4 | `dimensions.height:"30px"` on the page-wrapping card | **N4 — page-shell geometry** | `pageShell` recipe hardcodes `dimensions:{width:"100%",height:"auto",minHeight:"0px",maxHeight:"auto",minWidth:"0px",maxWidth:"auto"}`; `page` takes no height input | the page-shell node's `height === "auto"` at all three breakpoints; no ancestor of a `datatable` has a fixed px `height` |
| 5 | `text` nodes carry legacy `fontSize`/`fontWeight` **and** v7 `desktop.font` | **N5 — single styling channel** | `components.json[type].legacyStyleProps` lists them; s3 deletes every legacy prop when `breakpointChannels` is non-empty; s4 never emits one | no node has any key in the union of all `legacyStyleProps`; every `text` node has `desktop.font.size` |
| 6 | `stylingBox` duplicated at base **and** inside each breakpoint block | **N6 — stylingBox placement** | base `stylingBox` is always the literal `"{}"`; values live only in the three blocks (the shape the production `container` nodes already use) | for every node with `stylingBox`: `base.stylingBox === "{}"`, and each block's `stylingBox` is a parseable JSON string |
| 7 | Row navigation wired three ways (`onRowClick` code-mode + `rowClickActionConfiguration` + identical `dblClickActionConfiguration`) | **N7 — one wiring per event** | SFS has exactly one `onRowClick` and one optional `onRowDoubleClick`. s4 emits **`rowClickActionConfiguration` only**; the code-mode `onRowClick` prop and `dblClickActionConfiguration` are never emitted unless `onRowDoubleClick` is declared (`D-120`) | the table node has `rowClickActionConfiguration` and **no** `onRowClick` key and **no** `dblClickActionConfiguration` |
| 8 | `formSettings` carries `dataSubmitterType:"gql"`, `dataSubmittersSettings.gql.dynamicEndpoint`, and `onBeforeDataLoad` on a read-only list | **N8 — `formSettings` by `kind`** | s3 selects the `kind:list` profile from `form-settings.json` and drops every key not in `allowed ∪ forbidden`, and nulls every `forbidden` key. `onBeforeDataLoad` is not a legal `hooks` key for any `kind` (`D-102`) | `formSettings.dataSubmitterType === "none"`; `dataSubmittersSettings` absent; `onBeforeDataLoad === null` (present-and-null is legal — `D-104`); every key present is in `allowed ∪ forbidden`; every `forbidden` key present is `null`; `formSettings.version === 8` |

Three further rules the compiler owes, found while specifying the above. They are part of the same test file.

| # | Latent defect | Rule | Assertion |
|---|---|---|---|
| 9 | The production tablet block is `flexDirection:"row"` with **two** 100%-wide children — an incoherent geometry that neither stacks nor fits | **N9 — stack coherence** | for every row region: if any child's width is `100%` at breakpoint `b`, then that block's `flexDirection === "column"` |
| 10 | The `dataContext` is nested **inside** the title band container | **N10 — page-shell topology** | `pageShell.content.components[0].name === "titleBand"`; no `data`/`table`/`list` node is a descendant of `titleBand` |
| 11 | Column `propertyName`s copied PascalCase from `Metadata/GetProperties` (`debug.md` row 27) | **N11 — camelCase bindings** | every `items[].propertyName` and every input `propertyName` matches `^[a-z][A-Za-z0-9.]*$` |

The test must also assert positive shape, so it cannot pass vacuously on an empty tree — the zero-coverage lesson applied to the test itself. **The assertions are arithmetic identities plus a blessed snapshot, never numbers typed into this brief:**

| Assertion | Form |
|---|---|
| A1 | `counts.ids === counts.components + counts.slots + counts.items`, and each summand `> 0` |
| A2 | `counts.breakpointBlocks === 3 × counts.styledComponents` |
| A3 | `counts.components >= 8` on every clean fixture, and `>= 12` on `bookings-table` |
| A4 | `distinct(pairs(type, version)).length === distinct(types).length` — one version per type, asserted as pairs because `card` and `datatable.quickSearch` both carry `3` |
| A5 | `markupBytes / sfsBytes >= 8` |
| A6 | `deepEqual(measure(compiled), read("<form>.expected.counts.json"))` — the blessed snapshot, regenerated only by `npm run bless`, so a count change is a reviewable diff rather than a silent drift |
| A7 | column captions match `columns[].caption` of the source SFS, in order |

`npm run bless` refuses to run when `git status --porcelain packages/sfs/src` is non-empty and the working tree has uncommitted compiler changes *and* `--force` is absent, so a snapshot can never be blessed over an unreviewed compiler change.

---

### 2.7 The error catalogue

#### 2.7.1 Format

`src/errors/catalogue.json` is the **single source of every diagnostic string**. Code shape: `<DOMAIN>-<STAGE><SEQ>`, four digits, `SEQ` never reused.

| Domain | Meaning | Reserved ranges |
|---|---|---|
| `SFS` | parse / schema / language (stage 1) | 1000–1999 |
| `REG` | registry resolution (stage 2) | 2100–2199, 2900–2999 |
| `MET` | entity/reflist/form metadata (stage 2) | 2200–2499, 2900–2999 |
| `TOK` | brand token resolution (stage 2) | 2001–2099 |
| `NRM` | normalise (stage 3) | 3000–3999 |
| `EXP` | expand (stage 4) | 4000–4999 |
| `STM` | stamp (stage 5) | 5000–5999 |
| `SER` | serialise / push (stage 6) | 6000–6999 |
| `DEC` | decompiler | 7000–7099 |
| `SEM` | **reserved for Section 3's T3 tier** | 7300–7999 |
| `LIVE` | **reserved for Section 3's T4 tier** | 8000–8999 |
| `INF` | informational, never fails a build | 9000–9099 |
| `ENV` | environment, not compiler-detectable (documentation only) | 9900–9999 |

Entry shape:

```json
"MET-2201": {
  "severity": "error",
  "stage": "resolve",
  "template": "unknown property '{path}' on entity '{entity}'{didYouMean}",
  "hint": "Bind to one of: {candidates}. Property names are camelCased by the compiler, so declare '{path}' exactly as the entity spells it.",
  "debugRows": [3, 14, 27],
  "docs": "sfs://binding",
  "test": "test/errors.test.mjs#MET-2201"
}
```

Rules, each enforced by `test/errors.test.mjs`:

1. `raise(code, params)` from `src/errors/raise.mjs` is the **only** way to produce a diagnostic. A regex scan of `src/**` asserts zero `throw new Error(` and zero string literals passed to `raise`.
2. **Set equality**, both directions: `{codes referenced in src/**} ∪ {entries with "documentationOnly": true}` === `keys(catalogue.json)`. A code raised but not catalogued fails; a catalogued code no code raises fails. The catalogue therefore grows with the compiler and is never authored ahead of it.
3. Every entry with `severity:"error"` and no `documentationOnly` flag is produced by at least one test. `INF-*` and `ENV-*` entries carry `"documentationOnly": true` and are exempt. `test/errors.test.mjs` prints `catalogue codes=<n> exercised=<n> documentationOnly=<n>` and fails if `exercised < codes - documentationOnly`.
4. Every `error`-severity template renders with **no unsubstituted `{placeholder}`** for the params its call sites pass (render every entry with its test's params and regex for `/\{[a-z]/i`).
5. Every rendered message names (a) the offending value, (b) the SFS path where it occurred (`/body/1/columns/6/render`), and (c) either the legal alternatives or the exact corrective shape. A test asserts the rendered message for each code is ≥40 characters and contains the SFS path.
6. **No diagnostic may be a stack trace.** `bin/sfsc.mjs` wraps everything in a top-level catch that converts an unexpected exception into `SER-6999 internal compiler error` with the original stack written to `reports/` only. Totality [§4/L2] means every reachable state produces a domain error.

Diagnostic record emitted to the report:

```json
{ "code": "MET-2201", "severity": "error", "stage": "resolve",
  "path": "/body/0/children/1/columns/6/bind",
  "message": "…rendered template…", "hint": "…rendered hint…",
  "debugRows": [3, 14, 27] }
```

#### 2.7.2 Mapping the 31 `debug.md` symptom rows

`shesha-form-edit/references/debug.md` has **31 rows**. Every row maps to a code via the `debugRows` field of the catalogue entry, or carries `documentationOnly: true`. `test/errors.test.mjs` asserts the union of `debugRows` across `catalogue.json` covers `1..31` with no gaps and no duplicates outside the codes listed here — so no row is lost when `debug.md` is deleted and its content absorbed [§5]. Disposition key: **P** structurally prevented · **B** detected with a backend, `uninspectable` offline · **A** auto-fixed (`info`) · **T3** Section 3's semantic tier · **E** environment fact, `documentationOnly`.

| row | Symptom (abbrev.) | Code(s) | D |
|---|---|---|---|
| 1 | field won't accept input; `editMode` inherited | `EXP-4101` | P |
| 2 | button click fires nothing; `actionOwner` casing | `REG-2301` | P |
| 3 | value never persists; `propertyName` case | `MET-2201`, `NRM-3401` | P |
| 4 | anonymous page 401; `access` not 5 | `EXP-4401` | P |
| 5 | datatable/datalist shows nothing; no `dataContext` | `SFS-1201` | P |
| 6 | refresh / export / quick-search no-op | `SFS-1201`, `SFS-1601` | P |
| 7 | row-template datalist renders empty | `SFS-1201`, `MET-2401` | P+B |
| 8 | dropdown empty / shows IDs | `MET-2301` | B |
| 9 | card children in the wrong place | `EXP-4201` | P |
| 10 | conditional container won't hide; `hidden` returns a string | `REG-2202` | P |
| 11 | script fails silently, no try/catch | `EXP-4501` | P |
| 12 | push 200 but UI stale (browser cache) | `ENV-9901` | E |
| 13 | push 500, Windows-1252 encoding | `SER-6301` | P |
| 14 | push 500, NHibernate / `modelType` | `MET-2101`, `MET-2201` | B |
| 15 | `appContext` lost on hard refresh | `SEM-7301` | T3 |
| 16 | `application.user` undefined on anonymous page | `SEM-7302` | T3 |
| 17 | `Submit` vs `ExecuteScript` confusion | `REG-2302` | P |
| 18 | tab order wrong; reversed flex direction | `NRM-3301` | P |
| 19 | `e.match is not a function`; literal-array default / versionless node | `REG-2202`, `STM-5201` | P |
| 20 | `Cannot read properties of undefined (reading 'version')`; flat column editor | `EXP-4301` | P |
| 21 | `undefined.migrator`; `[default]` on edit/create | `EXP-4302` | P |
| 22 | no per-row Edit/Delete buttons | `EXP-4303` | A |
| 23 | inline reflist shows `unknown` (framework limitation) | `INF-9001` | E |
| 24 | new entity 404s (2-boot lag) | `MET-2101` | B |
| 25 | IIS Express ANCM failure | `ENV-9902` | E |
| 26 | form 404s after restart (orphaned revision) | `SER-6401` | B |
| 27 | headers + count right, every cell blank (PascalCase) | `MET-2202` | P |
| 28 | datalist card collapses / clips / inner scrollbar | `EXP-4601` | P |
| 29 | button inside a row template is inert | `SFS-1301` | P |
| 30 | dialog opens with empty fields (dynamic `formArguments`) | `EXP-4402` | P |
| 31 | button renders but is `disabled` (`editMode:"inherited"`) | `EXP-4101` | P |

22 rows become structurally impossible. 4 need a backend and degrade to `uninspectable`. 2 move to Section 3's T3. 3 are environment facts that stay documentation. **Zero are left to the model to remember.**

#### 2.7.3 Two worked messages, and the rule they demonstrate

Rules 4–6 of §2.7.1 are enforced by test; these two entries exist because they are the ones the old pipeline got wrong, and they are the shape every other entry copies.

**The anti-false-green case.** Bad: `verdict: pass — 0 bindings checked` ← the exact failure §1.4 documents in `verify-artifact.mjs`. Good:

```
verdict: PARTIAL (exit 3) — A partial verdict is NOT a pass
coverage  bindings   walked 7  checked 0  uninspectable 7
          refLists   walked 1  checked 0  uninspectable 1
          formRefs   walked 2  checked 0  uninspectable 2
MET-2900  /  entity metadata unavailable: no backend at http://localhost:21021 (ECONNREFUSED)
fix: start the backend and re-run, or accept a PARTIAL verdict — do not push on PARTIAL
     unless a human has reviewed the 7 unchecked bindings listed in reports/uninspectable.json
```

The count of unchecked things is stated, the verdict is not `pass`, and the operator's legal next actions are enumerated.

**The `bake-overlays.mjs` defect class.** Bad: writes the literal string `$role:doesNotExist` into the markup as a colour, then exits 1. Good:

```
TOK-2001  /body/0/children/1/style/bg
unresolved token '$role:cardSurface' for brand 'shesha'
known roles (24): appPrimary, appPrimaryHover, …, cardBg, cardHeaderBg, …
did you mean: cardBg
fix: add the role to packages/registry/data/0.45.1/roles.json, or use an existing role.
     NOTHING WAS WRITTEN — the compile halted at stage 2 of 6.
```

States explicitly that no output was produced, which is the invariant the old script violated, and bounds the candidate list at 5 so the message is not a dump. Every other `error` entry follows the same five-part shape: **code · SFS path · offending value in context · nearest legal alternatives (max 5) · the corrective SFS** — never the corrective markup, because SFS is all the author can edit.
### 2.8 The L0 registry contract

#### 2.8.1 What the registry is

The compiler's symbol table, as data, per pinned Shesha release, at `packages/registry/data/0.45.1/`. **The compiler contains no per-component knowledge in code** — enforced by §2.9 criterion 15 (no `if (type === '…')` outside `recipes/`).

The existing `components-kb` (121 records, 125 files, ~920 KB) is the **input**, not the output. It already supplies `type`, `version`, `isInput`, `icon`, `settingsFields`, `settingsProps.resolvedProps`, `slots` (with `customContainerNames`, which is how `card`'s `content`/`header` topology is already known) and `_enums.json`. Do not re-derive what it has. Do not delete it in this session: `gen-registry.mjs` reads it and emits the registry; the KB stays as the extractor's intermediate.

Measured facts about the KB at commit `3418e292`, reproducible with `node packages/registry/tools/fill-gaps.mjs --audit`: **121 records**, **22 with `version: null`**, **28 with empty `settingsProps.ownProps`**, and `datatable.settingsProps.resolvedProps` with **136 entries**. Prop *names* are therefore recoverable offline. Prop **value types, `required` flags and defaults are not** — `settingsFields[].editorType` records the designer *widget* (`settingsInputRow`, `labelConfigurator`), which says nothing about the value. §2.8.3 and §2.8.4 define exactly what is derivable without the framework source, and what is deferred.

#### 2.8.2 `components.json` record shape

```json
"datatable": {
  "type": "datatable", "displayName": "Data Table", "version": 29,
  "authorable": true, "sfsNode": "table", "category": "data", "isInput": true,
  "requiresAncestor": ["dataContext"],
  "propsCompleteness": "value-typed",
  "props": {
    "freezeHeaders": { "valueType": "boolean", "valueTypeSource": "observed",
                       "required": false, "requiredSource": "observed",
                       "default": false, "channel": "base" },
    "canEditInline": { "valueType": "enum", "valueTypeSource": "initModel",
                       "enum": ["no","yes","inherited","expression"], "default": "no",
                       "required": false, "requiredSource": "observed", "channel": "base" },
    "items":         { "valueType": "array", "valueTypeSource": "observed",
                       "itemSchema": "datatableColumn",
                       "required": true, "requiredSource": "observed", "channel": "items" },
    "rowClickActionConfiguration": { "valueType": "actionConfig", "valueTypeSource": "observed",
                       "required": null, "requiredSource": "unknown", "channel": "base" },
    "onRowClick":    { "valueType": "codeSetting", "valueTypeSource": "observed",
                       "required": null, "requiredSource": "unknown", "channel": "base",
                       "deprecated": true, "supersededBy": "rowClickActionConfiguration" }
  },
  "slots": { "kind": "components", "names": [], "childrenKey": "components", "hostsChildren": false },
  "breakpointChannels": ["background","border","shadow","dimensions","stylingBox"],
  "legacyStyleProps": ["backgroundColor","borderRadius","boxShadow","customStyle","style","fontSize","fontWeight"],
  "itemSchemas": { "items": "datatableColumn" },
  "limitations": ["LIM-datatable-01"],
  "provenance": { "file": "designer-components/dataTable/table/models.ts", "confidence": "kb+observed" }
}
```

`valueType` enum — **VALUE types, never designer widget names**: `string | number | integer | boolean | enum | entityPath | refListRef | formRef | permissionRef | colorRef | codeSetting | actionConfig | object | array | icon | cssSize`, or `null` when unknown.

`valueTypeSource` enum: `source-parsed | initModel | observed | probe | manual | unknown`. `requiredSource` enum: the same set.

`propsCompleteness` is a **four-state ladder**, computed by `gen-registry.mjs`, never hand-set:

| State | Means | Attainable offline |
|---|---|---|
| `none` | no prop names known | — |
| `names-only` | every prop name known (from `resolvedProps` ∪ the `extends` walk); every `valueType` is `null`, every `valueTypeSource` is `"unknown"` | yes |
| `value-typed` | every prop has a non-null `valueType` | yes, for the priority set (§2.8.4) |
| `full` | `value-typed` **and** every `required` non-null **and** every `valueTypeSource === "source-parsed"` | **no** — needs the framework TS interfaces at the pinned commit. `BL-020` |

`slots.kind` enum: `none | components | named | tabs | columns`. `childrenKey` is the literal emit path: `"components"`, `"content.components"`, `"tabs"`, `"columns"`.

Five **nested item schemas** are required, as `$defs` in `packages/registry/schema/registry.schema.json` and as records in `components.json._itemSchemas` [§4/L0 point 2 — this is exactly where `debug.md` rows 19–22 locate the crashes; today the KB describes `datatable.items` as one entry, `{"path":"items","editorType":"columnsEditorComponent"}`]:

| Schema | For | Required keys | Notes |
|---|---|---|---|
| `datatableColumn` | `datatable.items[]`, `childTable.items[]` | `id`, `itemType:"item"`, `sortOrder`, `columnType`, `propertyName`\|`columnType:"crud-operations"` | plus `caption`, `isVisible`, `allowSorting`, `minWidth`, `width`, and the `displayComponent`/`editComponent`/`createComponent` triplet, each `{type}` or `{type, settings:{…version}}` |
| `buttonGroupItem` | `buttonGroup.items[]` | `id`, `itemType:"item"`, `itemSubType:"button"\|"group"\|"separator"`, `sortOrder`, `name` | `label`, `buttonType`, `icon`, `editMode`, `buttonAction`, `actionConfiguration` |
| `tabsTab` | `tabs.tabs[]` | `id`, `key`, `title`, `components[]` | plus the `tabKey` the DOM probe cannot see — this is why placement moves to T3 [§4/L3] |
| `kibColumn` | `KeyInformationBar.columns[]` | `id`, `width`, `components[]` | emitted from SFS `bands[]` |
| `entityPickerColumn` | `entityPicker.columns[]` | `id`, `propertyName`, `caption` | |

#### 2.8.3 Reproducible generation, and what happens with no framework source

`packages/registry/tools/gen-registry.mjs` replaces the KB extractor's machine-local path. `components-kb/_meta.json` records `sourceDir: "C:/Users/Hashim/…"` — unreproducible — but it does record `sourceBranch: "releases/0.45"` and `commit: 3418e292f4422c1b515b78a16d67f20a4bae7db3`. **Pin to that commit.**

```
node packages/registry/tools/gen-registry.mjs \
  --kb    plugins/shesha-developer/skills/shesha-form-edit/assets/components-kb \
  --corpus packages/sfs/corpus \
  --commit 3418e292f4422c1b515b78a16d67f20a4bae7db3 \
  --framework <path-to-clone-or-omit> \
  --out   packages/registry/data/0.45.1
node packages/registry/tools/gen-registry.mjs --check --out packages/registry/data/0.45.1   # CI mode
node packages/registry/tools/gen-registry.mjs --ratchet                                     # rewrite measured floors
```

Rules:

* `--commit` is **mandatory**. A branch name alone is refused (`REG-2901`) — a branch moves.
* `_meta.json` records `{repo, ref, commit, sourceCommitDate, generatorVersion, kbSha256, corpusSha256, frameworkPresent, contentHash}` and **no `generatedAt`**. A clock in the registry makes `--check` impossible.
* `--check` regenerates into a temp dir and asserts byte-identity with the committed data; non-zero exit on any difference. Wired into `npm test`, so registry drift is a failing test, not silent skew.
* The npm route is closed and must not be attempted: `@shesha-io/reactjs@0.45.1` publishes a 2 KB `dist/index.d.ts` stub, and versions mined from the rolled-up bundle are migration-chain artifacts (`textField → [0,1,2,3,4,5,6]`). Source extraction at a pinned tag is the only sound path [§4/L0 point 1].
* **`--framework` omitted (the expected case this session): `frameworkPresent: false`,** and the degradation is total and explicit, not partial:
  * every prop gets `valueType` from the offline sources of §2.8.4 or `null` + `valueTypeSource:"unknown"`;
  * every prop's `required` comes from the observed rule of §2.8.4 or `null` + `requiredSource:"unknown"`;
  * no record may be stamped `provenance.confidence:"source-parsed"`; the legal values are `kb-only`, `kb+observed`, `probe`, `manual`;
  * `versionSource: "kb"` on every record, and every record with `version: null` is handled by `D-113` below;
  * `propsCompleteness` can never reach `full`; a run that claims it fails `g-registry-completeness`.
  * Every compile that touches a `kb-only` record lists it in `report.assumptions[]`. **Never stamp `source-parsed` on data you did not parse from source.**

`packages/registry/tools/registry-probe.mjs` (backend required) diffs the live app's designer metadata against the committed data and emits an upgrade-impact report. Backend absent ⇒ exit 3, `uninspectable`. Replaces `cheatsheet:74`'s non-functional stub recipe [§4/L0 point 3].

#### 2.8.4 The gaps, the priority set, and the ratchet

**28 records with empty `settingsProps.ownProps`:** `button`, `buttonGroup`, `buttons`, `chart`, `checkbox`, `checkboxGroup`, `dataContextSelector`, `datalist`, `datatable`, `datatable.pager`, `datatable.selectColumnsButton`, `datatable_template`, `dropdown`, `dynamicItemsConfigurator`, `dynamicView`, `formAutocomplete`, `headerAppControl`, `logViewer`, `notificationAutocomplete`, `permissionAutocomplete`, `radio`, `referenceListAutocomplete`, `section`, `settingsInput`, `settingsInputRow`, `sizableColumns`, `themeEditor`, `timePicker`. **All 28 are recoverable to `names-only` mechanically** by walking `extends` into `resolvedProps` — `datatable`'s props live on `ITableComponentBaseProps` and `IConfigurableFormComponent`, and `resolvedProps` already lists 136 of them.

**22 records with `version: null`:** `buttons`, `columnsEditorComponent`, `dataContextSelector`, `datatable_template`, `dynamicItemsConfigurator`, `dynamicView`, `editModeSelector`, `headerAppControl`, `imagePicker`, `labelConfigurator`, `logViewer`, `mainMenuEditor`, `metadataEditor`, `paragraph`, `permissionTagGroup`, `processMonitor`, `propertyRouter`, `searchableTabs`, `settingsInput`, `settingsInputRow`, `themeEditor`, `threeStateSwitch`.

Two decisions dispose of all 22 without inventing a single number:

* **`D-113` (`verified`)** — 14 of them are designer-internal widgets, never authored into a form: `settingsInput`, `settingsInputRow`, `labelConfigurator`, `editModeSelector`, `searchableTabs`, `themeEditor`, `metadataEditor`, `mainMenuEditor`, `columnsEditorComponent`, `dynamicItemsConfigurator`, `propertyRouter`, `headerAppControl`, `datatable_template`, `dataContextSelector`. They get `authorable: false`, `reason: "designer-internal"`, and require only `type` + `displayName`.
* **`D-114` (`verified`)** — the remaining 8 (`buttons`, `dynamicView`, `imagePicker`, `logViewer`, `paragraph`, `permissionTagGroup`, `processMonitor`, `threeStateSwitch`) are authorable in principle but their `version` cannot be established offline. They get `authorable: false`, `reason: "version unknown offline"`, `decision: "D-114"`, `backlog: "BL-022"`. Using one raises `REG-2902` whose hint names `BL-022`. The registry therefore satisfies **`authorable: true ⇒ version !== null`** by construction, and the count of deferred types (8) is a ratchet value that may only decrease.

**The priority set is 13 types**, because `props` completeness gates T2 [§4/L3] and the five most-disputed props in §1.2's contradiction table live on the first five: `datatable`, `datalist`, `dropdown`, `button`, `buttonGroup`, `datatable.pager`, `checkbox`, `checkboxGroup`, `radio`, `timePicker`, `section`, `formAutocomplete`, `referenceListAutocomplete`.

**Offline filling mechanism — exactly two mechanical sources, in this precedence order.** Anything else is a decision row, and there is no fourth option:

1. **`initModel`** — the `initModel.raw` snippet already recorded per component. Every literal default yields `default` and `valueType = typeof literal` (`string|number|boolean`, arrays → `array`, objects → `object`). `valueTypeSource: "initModel"`.
2. **`observed`** — mine `packages/sfs/corpus/**` and `packages/sfs/test/fixtures/legacy/**` for the props actually used on that type, with their JS value types. Shape rules, deterministic: `{_mode:"code"}` ⇒ `codeSetting`; `{_type:"action-config"}` ⇒ `actionConfig`; array of `{id,itemType}` ⇒ `array` + the matching `itemSchema`; a single scalar type across all instances ⇒ that type; **two or more disagreeing scalar types ⇒ `valueType: null` and a `GAP-###` row in `/BACKLOG.md`.** `valueTypeSource: "observed"`.
3. **`required`, offline rule** — for a type with `N >= 20` observed instances: a prop present on **100%** of instances ⇒ `required: true`, `requiredSource: "observed"`; present on fewer ⇒ `required: false`, `requiredSource: "observed"`. For `N < 20` ⇒ `required: null`, `requiredSource: "unknown"`. The semantics of `requiredSource:"observed"` are precisely "always present in shipped production markup", which is the property T2.07 can actually check.

**Consequences for the verifier, stated here because they are registry semantics, not tier policy:**

* T2.08 (value types) disposes a prop site `uninspectable` iff `valueType === null`, `checked` otherwise.
* T2.07 (required props) disposes a prop site `uninspectable` iff `requiredSource === "unknown"`, `checked` otherwise.
* A **priority** type whose entry is below `value-typed` is a **`fail`**, not `uninspectable`, and the failure message names the registry gap and its `BL-` id. Uninspectable is for absent evidence, not for known unfinished work on the critical path.
* A non-priority type at `names-only` produces `uninspectable` prop sites, which makes the artifact verdict `partial`. Section 3's push gate reads `T2.result === "pass"` **or** (`partial` **and** every uninspectable pointer's type is absent from the artifact) — implemented as one exported function in `packages/registry/src/coverage.mjs`, never as a hook-local exception.

**The ratchet.** `packages/registry/config/registry-ratchet.json`, literally, as committed at WP-2 with every `measured` value written by `--ratchet`:

```json
{
  "ref": "0.45.1",
  "priority": ["datatable","datalist","dropdown","button","buttonGroup","datatable.pager",
               "checkbox","checkboxGroup","radio","timePicker","section",
               "formAutocomplete","referenceListAutocomplete"],
  "demands": {
    "records": 121,
    "authorableImpliesVersion": true,
    "priorityAtLeast": "value-typed",
    "priorityValueTypeUnknown": 0,
    "itemSchemas": 5,
    "propsCompletenessFullRequired": false
  },
  "measured": { "authorable": 0, "namesOnlyOrBetter": 0, "valueTyped": 0, "deferredAuthorable": 8 },
  "direction": { "authorable": "up", "namesOnlyOrBetter": "up", "valueTyped": "up", "deferredAuthorable": "down" }
}
```

`g-registry-completeness` prints one line per key — `registry records=121 authorable=<n> namesOnlyOrBetter=<n> valueTyped=<n> deferredAuthorable=<n> priorityValueTyped=<n>/13` — and fails when: any `demands` key is violated; any `measured` key moves in the forbidden direction; any priority type is below `value-typed`; any `authorable:false` record lacks `reason`; any `authorable:false` record lacks a `decision` id when its `reason` is not `"designer-internal"`; or any of the 5 item schemas is missing.

**Deleted from this brief as unachievable in one session, with their replacements:** `propsCompleteness: "full" >= 93 of 121` → `BL-020` (needs the framework clone; ~2,400 prop annotations). `authorable: true >= 40` → replaced by the `authorable` ratchet, which starts at the measured value and may only rise. `zero authorable records with empty props` → replaced by `priorityAtLeast: "value-typed"` + the `namesOnlyOrBetter` ratchet.

#### 2.8.5 One decision registry, `limitations.json`, and the version conflict

**There is exactly one place a decision is recorded: `/DECISIONS.md`.** `packages/registry/data/0.45.1/decisions.json` is **generated** from it by `node packages/registry/src/gen-decisions.mjs`, and `g-decisions` asserts round-trip equality (`gen-decisions --check` regenerates and byte-compares). The compiler reads the JSON; humans and agents read one file. `packages/sfs/OPEN-QUESTIONS.md` **does not exist** — compiler gaps and SFS promotions are `GAP-###`/`BL-###` rows in `/BACKLOG.md` (§2.5) with the machine copy in gitignored `reports/`.

Generated record shape, one per `/DECISIONS.md` row:

```json
"D-101": {
  "decision": "kind:list emits dataLoaderType 'gql'",
  "confidence": "assumed",
  "evidence": "production bookings-table ships 'gql' and renders; §1.1 defect 8 indicts dataSubmitterType/dynamicEndpoint/onBeforeDataLoad only",
  "enforcedBy": "check:t2-registry:T2.20",
  "probe": "P-101: build a list form with dataLoaderType 'none' and assert the table populates",
  "usedBy": ["s3-normalise"]
}
```

**Section 2 owns the id block `D-100`–`D-129` and the probe block `P-100`–`P-129`.** Section 1 must not allocate a `D-1xx` id. `/DECISIONS.md` is subject to `g-prose-budget` with a **24 KB** cap; superseded rows move to `docs/decisions-archive.md`, which is outside the cap and outside the compiler's read set.

Every `assumed` decision used in a compile appears in `report.assumptions[]` and on stdout. Unsettled choices are **loud data**, not quiet code, and not a fourth markdown file.

`limitations.json` holds framework behaviours that are not defects and must never fail a build — seeded with `debug.md` row 23 (inline reflist dropdown shows `unknown` for the current value on 0.45.x). Emitted as `INF-9001`, `documentationOnly: true`.

**The `matrix.versions` conflict, resolved by deletion — `D-115` (`verified`).** `shesha-design-system/assets/capability-matrix.json` carries a `versions` map that disagrees with the KB: `dataContext: 7` there, `8` in `components-kb/_index.json` and in the production form that renders. The registry is the only version authority; `dataContext` is `8`; **delete `matrix.versions` entirely** [§5]. `packages/registry/test/registry.test.mjs` asserts: no file under `plugins/**` or `packages/**` other than `packages/registry/data/**` contains a component-name→integer version map (regex `"[a-zA-Z.]+"\s*:\s*[0-9]{1,2}\s*[,}]` inside an object whose sibling keys are ≥5 known component types). That test is what stops the drift recurring; a note explaining which one wins would not.

While there, harden the matrix per §5: per-row `id`, per-row `probeForm`, per-row `measuredAt` (today all 36 rows share one header date and several inferences are labelled "production-confirmed"), and add the missing `tabs` and `collapsiblePanel` rows. The matrix's six `crossCuttingRules` are **promoted to compiler invariants**, not kept as prose:

| Matrix rule | Where it now lives |
|---|---|
| version must match the live framework or the whole desktop block silently no-ops | s5 stamps from the registry; `REG-2902` |
| a flex container MUST set `display:"flex"` | `flexRow` recipe always emits it |
| size flex children via `desktop.dimensions.width`; `customStyle:{flex}` is inert | §2.1.5 arithmetic; `customStyle` is a `legacyStyleProp` |
| `font` on a container is a no-op — put it on the text child | `breakpointChannels` for `container` excludes `font`; `NRM-3102` if requested |
| measurement: `text`/`refListStatus` lack `data-sha-c-name` in live mode | Section 3's probe contract, not the compiler |
| measurement: dispatched DOM events do not fire React `onChange` | Section 3's T4 contract, not the compiler |
### 2.9 Section 2 acceptance criteria

Every row is a literal command. The session may not mark the owning work package complete until the command exits `0` **and** stdout contains the quoted string. Angle brackets `<>` mark a value discovered by the command itself and recorded in `packages/verify/evidence/<WP>.json` by the gate runner — never typed into a commit body by the agent.

| # | WP | Command | Exit | stdout must contain |
|---|---|---|---|---|
| 1 | WP-4 | `node --test packages/sfs/test/schema.test.mjs` | 0 | `# pass 18` and `# fail 0` (1 compile case + 3 clean fixtures + 14 negatives) |
| 2 | WP-4 | `node packages/verify/src/gates/g-sfs-schema.mjs` | 0 | `schema compiles=1 fixtures walked=3 checked=3 uninspectable=0` and `negatives walked=14 checked=14` |
| 3 | WP-5 | `node --test packages/sfs/test/golden-defects.test.mjs` | 0 | `predicates=11 fixtures=3` and `identities A1..A7 ok` and `# fail 0` |
| 4 | WP-5 | `node packages/verify/src/gates/g-sfs-invariants.mjs` | 0 | `invariants walked=<n> checked=<n> uninspectable=0` and `ratio min=<r> floor=8` |
| 5 | WP-5 | `node --test packages/sfs/test/determinism.test.mjs` | 0 | `compiles=53 distinctOutputs=1` and `bannedGlobals=0` and `idsRecomputed=<n> mismatches=0` |
| 6 | WP-5 | `node --test packages/sfs/test/idempotence.test.mjs` | 0 | `P1=<n>/<n> P2=<n>/<n> P3=<n>/<n>` with all three fractions equal on both sides |
| 7 | WP-5 | `node packages/verify/src/gates/g-no-literal-hex.mjs` | 0 | `literalColours walked=<n> checked=<n> found=0` |
| 8 | WP-5 | `node packages/verify/src/gates/g-escape-budget.mjs` | 0 | `escapes structural=1 rate=<r> cap=0.20 ratchet=ok` |
| 9 | WP-6 | `npm run sfs -- roundtrip --subset packages/sfs/config/roundtrip-expected.json` | 0 | `subset=6 validated=6 clean=5/5 setMatch=exact triaged=6 verdict=pass` |
| 10 | WP-5 | `node --test packages/sfs/test/errors.test.mjs` | 0 | `catalogue codes=<n> exercised=<n> documentationOnly=<n>` and `debugRows=31/31` and `throwNewError=0` |
| 11 | WP-2 | `node packages/registry/tools/gen-registry.mjs --check --out packages/registry/data/0.45.1` | 0 | `registry --check byte-identical` |
| 12 | WP-2 | `node packages/verify/src/gates/g-registry-completeness.mjs` | 0 | `registry records=121 authorable=<n> namesOnlyOrBetter=<n> valueTyped=<n> deferredAuthorable=8 priorityValueTyped=13/13 itemSchemas=5/5` |
| 13 | WP-2 | `node packages/registry/src/gen-decisions.mjs --check` | 0 | `decisions=<n> roundtrip=ok source=/DECISIONS.md` |
| 14 | WP-5 | `node --test packages/sfs/test/mutation.test.mjs` | 0 | `mutations=<n> flipped=<n>` with the two numbers equal, and `filesWrittenOnFailure=0` |
| 15 | WP-5 | `node --test packages/sfs/test/compile.test.mjs` | 0 | `typeBranchesOutsideRecipes=0` |
| 16 | WP-5 | `npm run bless && git diff --exit-code -- packages/sfs/test/fixtures/clean` | 0 | (no output — blessing is idempotent, so a blessed snapshot is byte-stable) |

Criterion 14 is the generalisation of `check-references.negative.mjs` — the one artifact in the repo that proves a gate fails when it should [§5]. Its mutation list is exactly:

| Mutation | Expected |
|---|---|
| `$role:doesNotExist` in a fixture | non-zero exit, `TOK-2001`, **0 files written** |
| card children placed at `components` instead of `content.components` (via `raw`) | `EXP-4201` |
| `editComponent: {type:"[default]"}` (via `raw`) | `EXP-4302` |
| `table` with no `data` ancestor | `SFS-1201` |
| `bind: "PassengerName"` | compiled `propertyName === "passengerName"` |
| one hex digit changed in a blessed `expected.form.json` id | `g-sfs-invariants` fails, family `structure` |
| a v4-shaped id injected into compiler output | `g-sfs-invariants` fails (v5 nibble check) |
| `onBeforeDataLoad: "x"` on a `kind:list` fixture | `check:t2-registry:T2.20` fails; `onBeforeDataLoad: null` passes |
| a `raw` node with `raw.type: "columns"` added to a clean fixture | `SFS-1004` (non-authorable type, `D-112`) |
| a priority registry type demoted to `names-only` | `g-registry-completeness` fails naming the type |

**Every gate this section owns ships ≥2 of those mutations.** A gate without a mutation that flips its verdict is not done, and `g-gate-contract` (Section 1) fails it.
### 2.10 Contracts this section imposes on the other sections

Each row is a fact another section must build against. A contradiction elsewhere is a defect there, not a choice.

1. **Root `package.json` with npm workspaces exists** (§2.0 Prerequisite A) and lists `packages/*`. Section 1 and Section 5 must not create a second one. `packages/registry` has zero dependencies.
2. **Canonical paths are §2.0's table.** In particular: registry data at `packages/registry/data/0.45.1/`, coverage at `packages/registry/src/coverage.mjs`, `walkComponents` at `packages/verify/src/walk.mjs`, test root `packages/sfs/test/` (singular).
3. **`SEM-73xx` and `LIVE-8xxx` code ranges are reserved for Section 3.** T2/T3/T4 diagnostics go in the same `catalogue.json` and inherit §2.7.1's format rules, including set-equality and the mutation requirement.
4. **`schema/plan.schema.json` and `schema/verdict.schema.json` paths are reserved** for Sections 4 and 3; the hooks Section 4 specifies validate against those paths, not copies.
5. **Compiler output ids are UUID **v5**.** Any T1 check that tests for v4 rejects 100% of compiler output. The stronger available check is recomputation from `<form>.compiled.meta.json`'s `sfsPath` (§2.4.2).
6. **`forbidden` in `form-settings.json` means "present with a non-null value"** (`D-104`). The canonical fixture emits `onBeforeDataLoad: null` on a `kind: list` form and must pass.
7. **No byte-equality between a hand-written fixture and a decompiled legacy form is assertable** (§2.4.5). The three legal properties are P1, P2, P3; `normalForm()` is the name-independent comparison.
8. **A `partial` verdict is never a pass, and there is no `warn` verdict.** Verdict union is exactly `{pass, partial, fail, notRun}`; exit codes are exactly `{0,1,2,3}`.
9. **`/DECISIONS.md` is the only decision registry**; `decisions.json` is generated from it; there is no `OPEN-QUESTIONS.md`. Gap and promotion ids live in `/BACKLOG.md` as `GAP-###`/`BL-###`, which is also where Section 1's `test.todo(` carve-out looks up ids. Section 2 owns `D-100`–`D-129` and `P-100`–`P-129`.
10. **`shesha-spec` (Section 4) documents SFS by ~10 worked examples, not by restating this grammar.** It references `packages/sfs/schema/sfs.schema.json` and `packages/sfs/test/fixtures/clean/` and stays under 8 KB. A prose copy of the grammar would be a second source of truth and would drift.
11. **`components-kb`, `capability-matrix.json`, `verify-artifact.mjs` + its 15 tests, `check-references.mjs` and `check-references.negative.mjs` are all kept** [§5]. `bake-overlays.mjs`, `validate-blocks.js` and `summarize.js` are deleted. `assets/examples/*.json` (2.5 MB, 12 files) is **copied into `packages/sfs/corpus/` before deletion**, and the deletion commit is gated on `reports/roundtrip.json` existing for all 12.
12. **Every form on disk is the bare `{components, formSettings}` shape.** There is no 23-field envelope and no `Markup` string anywhere in this repo. Anything that requires one either synthesises it with `provenance: "ENVELOPE-SYNTHESISED"` (and is `uninspectable` in the `file` family) or fetches it from a backend and records that it did.
13. **No section may state a byte count, component count or reduction ratio as an expectation.** They are measured by `tools/measure-form.mjs`, blessed into `*.expected.counts.json`, and asserted as identities (§2.6 A1–A7). The only hardcoded numeric floors Section 2 owns are: `markupBytes/sfsBytes >= 8`, `structuralEscapeRate <= 0.20`, `priorityValueTyped == 13/13`, `debugRows == 31/31`, `itemSchemas == 5/5`, `declaredSubset validated == 6`, `clean == 5`.

---

### 2.11 Section 2's rows in `/DECISIONS.md` and `/BACKLOG.md`

Write these rows in the work package named in the last column. `Enforced by` uses only the five legal forms: a gate id under `packages/verify/src/gates/`, `structural:<path>`, `hook:<file>`, `check:<tier-module>:<check-id>`, or `pending:<WP-id>` for an enforcer that lands later. `g-decisions` resolves `pending:` against `packages/verify/config/pending-budget.json` and hard-fails once `BUILD-LOG.md` records that WP complete with the row still pending.

| id | Decision | Conf. | Enforced by | WP |
|---|---|---|---|---|
| D-100 | SFS ships as npm workspaces in `shesha-plugins`; arrow `registry <- sfs <- verify` | verified | `structural:package.json` | WP-0 |
| D-101 | `kind:list` keeps `dataLoaderType:"gql"` | assumed | `pending:WP-3a` → `check:t2-registry:T2.20` | WP-2 |
| D-102 | the form-arguments hook is `onAfterDataLoad`; `onDataLoaded`/`onBeforeDataLoad` deleted | verified | `g-sfs-schema` | WP-4 |
| D-103 | `list`/`detail` never emit non-null `dataSubmittersSettings`/`onBeforeDataLoad`/`dynamicEndpoint` | verified | `g-sfs-invariants` | WP-5 |
| D-104 | `forbidden` means "present with a non-null value" | verified | `check:t2-registry:T2.20` | WP-2 |
| D-105 | SFS is JSON; no YAML surface this session | verified | `g-sfs-schema` | WP-4 |
| D-106 | appearance is declared once per node; no per-breakpoint appearance channel | verified | `g-sfs-invariants` (N2/N3) | WP-5 |
| D-107 | ids are UUID **v5** derived from `module/form|namePath`; `compilerVersion` excluded from the input | verified | `g-determinism` | WP-5 |
| D-108 | literal colours are rejected by one JS regex in `s2`, not by a JSON Schema pattern (ECMA-262 has no inline `(?i)`) | verified | `g-no-literal-hex` | WP-5 |
| D-109 | no byte-equality between a hand-written fixture and a decompiled legacy form; P1/P2/P3 + `normalForm()` are the properties | verified | `g-sfs-invariants` | WP-5 |
| D-110 | `collapsiblePanel` is v9 / `accentStyle` / `collapsedByDefault`; `containers.md`'s v8 shape deleted | verified | `g-registry-completeness` | WP-2 |
| D-111 | decompiler node mapping is the generated `sfsNode` reverse map; unmapped input types are `field`, unmapped containers are structural escapes | verified | `g-escape-budget` | WP-5 |
| D-112 | `columns`/`sizableColumns` are `authorable:false`; lifting them is `BL-021` | verified | `g-registry-completeness` | WP-2 |
| D-113 | 14 designer-internal widgets are `authorable:false`, no version required | verified | `g-registry-completeness` | WP-2 |
| D-114 | 8 authorable-in-principle types are deferred `authorable:false` (`version` unestablishable offline); ratchet down only | verified | `g-registry-completeness` | WP-2 |
| D-115 | the registry is the only version authority; `matrix.versions` is deleted; `dataContext` is `8` | verified | `g-registry-completeness` | WP-2 |
| D-116 | `full` prop completeness is unreachable without the framework clone; offline max is `value-typed`, and priority-13 must reach it | verified | `g-registry-completeness` | WP-2 |
| D-117 | one decision registry (`/DECISIONS.md` → generated `decisions.json`); no `OPEN-QUESTIONS.md`; gaps are `GAP-###` rows in `/BACKLOG.md` | verified | `g-decisions` + `g-prose-budget` (24 KB cap) | WP-0 |
| D-118 | the escape budget is a ratchet over a declared file set, not a global aspiration | verified | `g-escape-budget` | WP-5 |
| D-119 | the round-trip gate is the 6-form declared subset with exact set match; the other 6 are triaged `uninspectable` | verified | `structural:packages/sfs/config/roundtrip-expected.json` + `g-escape-budget` | WP-6 |
| D-120 | one wiring per event: `rowClickActionConfiguration` only; `dblClickActionConfiguration` only when `onRowDoubleClick` is declared | verified | `g-sfs-invariants` (N7) | WP-5 |
| D-121 | the error catalogue is set-equal to the codes `src/**` raises; it is never authored ahead of the code | verified | `structural:packages/sfs/test/errors.test.mjs` | WP-5 |

`/BACKLOG.md` rows Section 2 creates:

| id | Item | Acceptance command when it is picked up |
|---|---|---|
| BL-020 | `propsCompleteness: "full"` for the 121 records via the `shesha-framework` clone at commit `3418e292` | `node packages/verify/src/gates/g-registry-completeness.mjs` prints `full=121/121 valueTypeSource=source-parsed` |
| BL-021 | lift legacy `columns`/`sizableColumns` into `row` + `responsive.fixed` on decompile | `npm run sfs -- roundtrip --subset …` prints `clean=6/6` |
| BL-022 | establish `version` for the 8 deferred authorable types | `g-registry-completeness` prints `deferredAuthorable=0` |
| BL-023 | a YAML surface for SFS (`sfsc compile x.sfs.yaml`) | `npm run sfs -- compile test/fixtures/clean/bookings-table.sfs.yaml` byte-matches the JSON compile |
| BL-002 | round-trip ≥ 0.90 over all 12 corpus forms (Section 5 owns the row; listed here because §2.5 scopes it out) | `npm run sfs -- roundtrip --corpus packages/sfs/corpus` prints `rate=<r> gate=0.90 pass=true` |
