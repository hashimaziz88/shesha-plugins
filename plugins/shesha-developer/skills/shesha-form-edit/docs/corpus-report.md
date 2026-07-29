# Corpus grading and threshold calibration (Phase 2, Task 5)

Answers one question with evidence: **does the validator accuse real, working
production forms of things that are not actually wrong?**

## Corpus mined

Two SQL Server schema shapes exist across the four databases. `RequirementsStudio`
and `MembershipManagement` use the current `frwk.form_configurations` /
`configuration_item_revisions` / `configuration_items` join (the shape in the
brief). `AssetManagement2` and `UtilityManagement` store the same data in an
older `dbo.Frwk_FormConfigurations` / `dbo.Frwk_ConfigurationItems` schema
(`Id` join, filtered to `IsLast = 1 AND IsDeleted = 0` for the current
revision). `scripts/grade-corpus.mjs` doesn't know about this split — the JSONL
dump was mined with a small ad-hoc PowerShell script (not committed; SQL
mining is not `grade-corpus.mjs`'s job, grading is) — but the split matters
for triage below, so it's recorded here.

| DB | Rows mined |
|---|---|
| RequirementsStudio | 100 |
| MembershipManagement | 42 |
| AssetManagement2 | 255 |
| UtilityManagement | 538 |
| **Total** | **935** |

All 935 forms parsed and graded cleanly (0 parse errors). A separate 15-form
**bundled-seed cohort** (`assets/examples/*.json` + `assets/patterns/*.json`)
was graded alongside — these are read directly from this skill's own
committed assets (not corpus data) since the brief calls out that their
conformance "matters more per-form" than the corpus's. **This cohort changed
in Task 9** (below): 3 unreadably-large seeds retired, 2 curated
`assets/exemplars/` forms added — see the Task 9 section for the current
14-form cohort and its re-measured rates.

Corpus data (the JSONL dumps, and every per-form report) lives only in the
scratchpad directory outside this repo and was never committed. `git status`
was checked clean of it before every commit in this task.

**Important caveat discovered during grading:** the four databases are NOT
schema-uniform. `RequirementsStudio` markup consistently uses the current
per-breakpoint (`desktop`/`tablet`/`mobile`) style shape this skill's registry
(`registry-0.45.1.json`) was generated from. `AssetManagement2` and
`UtilityManagement` markup is visibly older/flatter (missing `version` on many
nodes, `name` instead of `componentName`, no breakpoint nesting on many
containers) — consistent with the user's own record that the Asset Management
project runs an older Shesha release. This means some codes (flagged below)
have their hit rate inflated by grading forms built for a different framework
version than this validator's registry encodes — a genuine finding about
**corpus/registry version mismatch**, not necessarily "the corpus is broken"
or "the check is broken." Where this applies, the per-DB breakdown is called
out explicitly in that code's triage.

## Frequency table (after fixes), full 935-form corpus

Ranked by forms-affected. `T2-SKIPPED` findings are excluded (no `archetype`/
`knownForms` were supplied to this grading run, so `T2-FLOW-INCOMPLETE` and
`T2-DANGLING-FORMREF` never ran — this is expected, not a corpus result).

| Code | Forms | % | Instances | Verdict |
|---|---|---|---|---|
| T1-PROP-UNKNOWN | 878/935 | 93.9% | 24,114 | **Mostly FIXED** (was 889/935, 53,963 instances) — residual is a lower-confidence long tail, see below |
| T1-VERSION-STALE | 784/935 | 83.9% | 10,908 | **GENUINE, but see per-DB split** |
| T3-LABEL-CASING | 776/935 | 83.0% | 5,549 | GENUINE DEFECT |
| T2-STYLE-INCOMPLETE | 645/935 | 69.0% | 4,519 | GENUINE DEFECT |
| T2-FLEX-NO-DISPLAY | 583/935 | 62.4% | 3,342 | GENUINE DEFECT |
| T2-EDITMODE-MISMATCH | 521/935 | 55.7% | 3,787 | **PARTIALLY FIXED** (was 559/935) — residual GENUINE |
| T3-PRIMARY-COUNT | 363/935 | 38.8% | 534 | GENUINE DEFECT (observe-only) |
| T2-PROPERTYNAME-CASE | 341/935 | 36.5% | 1,761 | **PARTIALLY FIXED** (was 390/935) — residual GENUINE |
| T3-NON-AUTHORABLE-TYPE | 323/935 | 34.5% | 563 | Informational by design (observe-only) |
| T1-PARENT-MISSING | 310/935 | 33.2% | 4,943 | **PARTIALLY FIXED** (was 388/935) — residual GENUINE |
| T3-HEADER-FONT-INCOMPLETE | 301/935 | 32.2% | 1,134 | GENUINE DEFECT (observe-only) |
| T2-LOOSE-BUTTON | 282/935 | 30.2% | 736 | GENUINE DEFECT (matches brief's measured baseline) |
| T1-VERSION-MISSING | 256/935 | 27.4% | 2,238 | GENUINE, same version-mismatch caveat as T1-VERSION-STALE |
| T2-DROPDOWN-SOURCE | 224/935 | 24.0% | 562 | **PARTIALLY FIXED** (was 277/935) — residual GENUINE |
| T2-COLUMNS-PRESENT | 218/935 | 23.3% | 668 | GENUINE DEFECT (matches brief's measured baseline) |
| T3-RAW-HEX | 204/935 | 21.8% | 15,522 | **PARTIALLY FIXED** (was 216/935, 38,902 instances) |
| T2-MODELTYPE-SHAPE | 204/935 | 21.8% | 204 | **MOSTLY FIXED** (was 928/935 — 99.3%) |
| T2-WIDTH-ON-NONCONTAINER | 186/935 | 19.9% | 4,907 | GENUINE DEFECT (brief already confirmed on seeds) |
| T1-JSON-UNSAFE | 145/935 | 15.5% | 318 | GENUINE DEFECT |
| T2-VALIDATIONERRORS-MISSING | 144/935 | 15.4% | 144 | GENUINE DEFECT |
| T2-FLEXCHILD-NOT-CONTAINER | 117/935 | 12.5% | 545 | GENUINE DEFECT |
| T1-ID-DUPLICATE | 107/935 | 11.4% | 2,640 | GENUINE DEFECT |
| T3-ORPHAN-CONTAINER | 96/935 | 10.3% | 114 | GENUINE DEFECT (observe-only) |
| T2-STYLE-OFF-TOKEN | 85/935 | 9.1% | 3,299 | **PARTIALLY FIXED** (was 152/935, 9,001 instances) |
| T1-DOUBLE-SLOT | 61/935 | 6.5% | 260 | below 10% — not triaged in depth |
| T1-DEFAULTVALUE-NONSTRING | 49/935 | 5.2% | 95 | below 10% |
| T1-TYPE-UNKNOWN | 36/935 | 3.9% | 49 | **FIXED** (was 126/935, 744 instances) |
| T1-SCRIPT-SYNTAX | 21/935 | 2.2% | 32 | below 10% |
| T2-SUBMIT-WIRING | 18/935 | 1.9% | 20 | below 10% |
| T2-DATACONTEXT-PROPS | 4/935 | 0.4% | 4 | **FIXED** (was 40/935, 115 instances) |
| T2-DATE-COMPONENT | 4/935 | 0.4% | 5 | below 10% |
| T1-EDITCOMPONENT-SHAPE | 2/935 | 0.2% | 2 | below 10% |
| T2-EXIT-MISSING | 1/935 | 0.1% | 1 | below 10% |
| T1-ID-NOT-UUID | 0/935 | 0% | 0 | **FIXED** (was 894/935 — 95.6%, renamed to T1-ID-EMPTY) |

## Triage — every code with a pre-fix hit rate above ~10%

Each ruling quotes a concrete example and states the reasoning. "GENUINE
DEFECT" = the rule stands as written. "FALSE POSITIVE" = the check itself was
wrong; fixed in this task (see the "Fixes applied" section for the diff
summary and the exact evidence).

### T1-ID-NOT-UUID — 894/935 (95.6%) → **FALSE POSITIVE, FIXED**

A 95.6% hit rate is the textbook "broken check, not a broken corpus" signal
the brief warned about. Example: `id: "5f75c7e54d6f4d5ebd7c622cce"` (26
dashless hex chars) on `RequirementsStudio/.../api-definition-table`.
Framework-source verification (`shesha-reactjs/src/utils/uuid.ts`) found the
designer's OWN id generator mints `nanoid(30)` — not an RFC4122 v4 UUID — and
`id` is used purely as an opaque string key (`allComponents[id]`, a React
`key`, a `data-sha-c-id` DOM attribute; `formComponent.tsx`,
`providers/form/utils.ts`). No code path anywhere rejects a non-UUID-shaped
id. Renamed to **T1-ID-EMPTY**: only a missing/blank/non-string id is a real
renderability risk now; two components sharing one id is still caught
separately by T1-ID-DUPLICATE.

### T2-MODELTYPE-SHAPE — 928/935 (99.3%) → **FALSE POSITIVE, FIXED**

Example: `formSettings.modelType: "Shesha.RequirementsStudio.Domain.ApiDefinition"`
on 90/100 RS forms; only 1/100 used the `{name, module}` object. Framework
verification: `IFormSettingsCommon.modelType` is typed `IEntityTypeIdentifier
| string` in current `releases/0.45` source; every metadata consumer
(`metadataDispatcher/dispatcher.ts`'s `getMetadata`/`isEntityType`,
`entityMetadataFetcher.ts`) branches on `isEntityTypeIdentifier()` and calls
symmetrically-implemented fetchers (`getByTypeId`/`getByClassName`, both
delegating to the same `getByEntityType`) for either shape. The object shape
is a newer, ADDITIVE convention (commit `30ea93c93`), not a replacement — the
`0.43` worktree only ever had the string form. Fixed: either shape is now
accepted; only a genuinely missing/empty/malformed modelType fails.

### T1-PROP-UNKNOWN — 889/935 (95.1%) → **MOSTLY FALSE POSITIVE, PARTIALLY FIXED**

Aggregating flagged `type :: path` pairs on the RS-100 cohort showed the
overwhelming majority were NOT type-specific typos but a shared style-editor
sub-schema (border/background/shadow/font panels, plus `direction`,
`overflow`, `shadowStyle`, `enableStyleOnReadonly`, `menuItemShadow`) that the
registry's per-type scraper (`gen-registry.mjs`, out of this task's scope)
inconsistently captured across component types — e.g. `border.hideBorder`
alone fired on 26 DISTINCT component types (2,321 instances on the RS-100
cohort), `background.gradient.direction` on 28 types (2,248 instances),
`font.align`/`font.weight` on 7 types each. Fixed by adding these prefixes to
a `COMMON_STYLE_PROP_PREFIXES` allowance (mirrors the existing
`UNIVERSAL_KEYS` mechanism). Result: instances dropped 55% corpus-wide
(53,963 → 24,114); forms-affected barely moved (889→878) because a **residual
long tail remains genuine or unconfirmed** — component-specific settings the
registry also misses but that only fire on their OWN type (`datatable ::
noDataText/rowPadding/rowBorder/headerFontSize/headerFontWeight/crud`,
`sectionSeparator :: titleMargin/dashed/lineThickness`, `text ::
fontSize/fontWeight/strong/padding/color`, `button ::
sortOrder/itemType/actionType`, bare top-level `hideBorder` distinct from
`border.hideBorder`, dropdown's `tag.*` sub-editor). These are **NOT fixed
this pass** — deliberately left flagged. They are lower-volume, single-type,
and I could not independently verify each is a genuine registry gap rather
than a real typo without regenerating the registry (out of scope). This is
the single largest remaining source of noise and the report's top
recommendation for follow-up (see go/no-go).

### T2-STYLE-OFF-TOKEN — 152/935 (16.3%) and T3-RAW-HEX — 216/935 (23.1%) → **PARTIALLY FALSE POSITIVE, FIXED**

Sampled color literals on containers were near-universally `#d9d9d9`
(border), `#ffffff` (background), `#1a1a1a` (font), `#000`/`#000000`
(shadow) — always appearing together, identically mirrored across
`desktop`/`tablet`/`mobile` and the flat top level. Framework verification
confirmed `#d9d9d9` (border) and `#000`/`#000000` (shadow) are hardcoded
defaults the container's own migrator stamps on every load
(`designer-components/container/containerComponent.tsx`'s v7 migrator,
`_common-migrations/migrateStyles.ts`), never a deliberate brand choice;
`#ffffff` carries the same evidence via the framework's `initialStyles.ts`
default generator. `#1a1a1a` (font.color) has **no confirmed framework-default
origin** (exhaustive repo + git-history search found nothing) and remains a
live finding — deliberately not exempted. Fixed: a literal color exactly
matching one of the three confirmed defaults no longer requires `overrides[]`
provenance. Instance counts dropped sharply (T2: 9,001→3,299; T3:
38,902→15,522); forms-affected dropped more modestly since most flagged forms
also carry at least one non-default literal color elsewhere.

### T1-TYPE-UNKNOWN — 126/935 (13.5%) → **FALSE POSITIVE (100% of RS-cohort instances), FIXED**

On the RS-100 cohort, **100% of T1-TYPE-UNKNOWN's 113 instances** were
datatable column-KIND values (`"data"`, `"action"`, `"item"`, `"group"`) at a
path ending `.items[N]`, not real unregistered component types. Root cause:
`walk.mjs`'s `flatten()` (out of this task's scope) includes any node
carrying a `type` key on the assumption that `items[]` entries never have
one — true for buttonGroup buttons (`itemType`/`itemSubType`), false for
datatable COLUMN definitions, which carry their own `type` meaning "column
kind" (see `references/components/inline-editable-tables.md`) — a namespace
collision with component `type`. Example: a column
`{ "itemType": "item", "columnType": "action", "type": "action", ... }` on
`api-definition-table` got checked as if `type: "action"` were a component
type. Fixed in `tier1.mjs` (can't touch `walk.mjs`): skip
type/prop/version/parent-missing checks for any node reached via an
`.items[N]` path — matching the design already evident elsewhere in the file
(`checkEditComponentShape` reads `node.items[].editComponent` directly,
bypassing `flatten()` for exactly this reason). Corpus-wide: 126→36 forms,
744→49 instances. On the RS-100 cohort specifically: 23→0 forms, fully
resolved.

### T1-PARENT-MISSING — 388/935 (41.5%) → **PARTIALLY FALSE POSITIVE, PARTIALLY FIXED**

Same root cause as T1-TYPE-UNKNOWN: on the RS-100 cohort, 113 of 504 instances
(22%) were the same `.items[N]` pseudo-node leak (a datatable column
definition, which never carries `parentId`, isn't a real tree node). Fixed by
the same guard. Residual (391 instances on RS-100, 4,943 corpus-wide after
the fix) is via non-`items[]` paths — genuine `parentId` mismatches — and
remains flagged. Corpus-wide: 388→310 forms, 5,630→4,943 instances.

### T2-DATACONTEXT-PROPS — 40/935 (4.3% corpus, but 37/100 on RS) → **FALSE POSITIVE, FIXED**

Every single flagged `dataContext` node was missing ONLY `uniqueStateId`
(never `entityType`/`sourceType`/`dataFetchingMode`/`defaultPageSize`).
Framework verification: `uniqueStateId` is not, and has never been, a
property of the `dataContext` component — `IDataContextComponentProps`
(`designer-components/dataContextComponent/interfaces.ts`) has no such field,
and `dataContextComponent/settings.tsx` doesn't offer it. `uniqueStateId` IS a
real property, but of unrelated LEGACY components (table/dataSource/
entityPicker/wizard/button), tolerantly migrated to `name` there via
`prev['uniqueStateId'] ?? prev['name']` — never a hard requirement even on
the types that once had it. The check was validating a property against the
wrong component's contract. Fixed: removed from `DATACONTEXT_REQUIRED`.
RS: 37→1 forms; corpus: 40→4 forms.

### T2-PROPERTYNAME-CASE — 390/935 (41.7%) → **PARTIALLY FALSE POSITIVE, PARTIALLY FIXED**

Example: `propertyName: "baseProject.name"` flagged as non-camelCase. This is
the sanctioned Shesha convention for reaching a related entity's property —
present throughout this skill's OWN bundled seeds
(`rs-detail-with-header.json`, `rs-table.json`,
`rs-subtable-tab-fragment.json`: `usedModule.name`, `baseProject.status`,
etc.). The original regex had no notion of a path separator, so any nested
binding was flagged even when every segment was correctly camelCase. Fixed:
`isCamel()` now checks each dot-separated segment independently. Genuine
violations (e.g. `propertyName: "tvs_api_definiti"`, snake_case;
`"kib_http_action"`) remain flagged correctly. Corpus: 390→341 forms,
2,292→1,761 instances.

### T2-EDITMODE-MISMATCH — 559/935 (59.8%) → **PARTIALLY FALSE POSITIVE, PARTIALLY FIXED**

Sampled `actual` values on the RS-100 cohort were almost entirely
`"readOnly"` (7/8 samples) and one `null`. `references/components/edit-mode.md`
documents THREE legitimate `editMode` values —
`'editable' | 'readOnly' | 'inherited'` — and states `readOnly` "always wins"
regardless of form type: a deliberate, permanent read-only field (e.g. a
computed/audit value), unrelated to the detail/dialog-lifecycle distinction
this check exists to police. Fixed: `editMode: 'readOnly'` is now exempted
on either form type. Residual (RS: 54→38 forms; corpus: 559→521 forms) is
genuinely missing `editMode` or the wrong value from the
`editable`/`inherited` pair — confirmed by re-sampling post-fix (`null` and
`'inherited'`-on-a-non-detail-form), which is exactly what the check should
catch.

### T2-DROPDOWN-SOURCE — 277/935 (29.6%) → **PARTIALLY FALSE POSITIVE, PARTIALLY FIXED**

Example: `entityType: "Shesha.RequirementsStudio.Domain.ModuleDefinition"`
(bare string) on an `entitiesList`-sourced dropdown, flagged for not being
`{name, module}`. Same underlying mechanism as T2-MODELTYPE-SHAPE: framework
verification confirmed `entityPicker`'s `entityType` prop is typed `string |
IEntityTypeIdentifier` and normalized through the identical
`isEntityTypeIdentifier`/`getEntityTypeIdentifier` path
(`providers/metadataDispatcher/entities/utils.ts`). Fixed: either shape
accepted; only a genuinely absent/empty entityType (one sampled instance) is
a real defect. RS: 41→12 forms; corpus: 277→224 forms.

### High-hit-rate codes ruled GENUINE DEFECT (rule stands, no change)

- **T1-VERSION-STALE** (784/935, 83.9% — but see per-DB split below) — sampled
  findings show real version drift (`node.version: 11` vs registry's `29` for
  `datatable`, etc.). **Per-DB breakdown is essential here**: RequirementsStudio
  25%, MembershipManagement 42.9%, AssetManagement2 92.5%, UtilityManagement
  93.9%. The two much-higher-rate DBs are the ones independently confirmed to
  use an OLDER, flatter Shesha markup shape (see the corpus-mining caveat
  above) — grading THEIR forms against a 0.45.1-derived registry is comparing
  across framework versions, not detecting genuine staleness within a single
  project. **Verdict: genuine where the registry version matches the
  project's Shesha version (confirmed on RequirementsStudio); a corpus/registry
  version-mismatch artifact, not evidence the check is wrong, on
  AssetManagement2/UtilityManagement.** Not fixed — this needs a
  per-project registry selection, not a tier1.mjs code change.
- **T3-LABEL-CASING** (776/935, 83.0%) — sampled labels (`"Menu List2"`,
  `"HTTP Action"`, `"Sha Page"`, `"Detail Tabs"`) are un-edited, Title-Case
  designer-default labels derived from componentName. The check's own
  acronym exemption already works correctly (`"HTTP"` is preserved,
  `"Action"` is correctly flagged as the violating second word). This is
  real, user-visible cosmetic debt — genuine, and Tier 3 (observe-only,
  never blocks).
- **T2-STYLE-INCOMPLETE** (645/935, 69.0%) — missing props are spread fairly
  evenly across desktop/tablet/mobile (2,924/3,066/3,066 missing-prop
  occurrences) — not merely "tablet/mobile is never touched," genuinely
  incomplete style authoring on all three breakpoints. Genuine.
- **T2-FLEX-NO-DISPLAY** (583/935, 62.4%) — sampled findings show
  `flexDirection`/`gap`/`justifyContent`/`alignItems` set with `display: null`
  — exactly the silent-inert-props bug the check documents. Genuine.
- **T2-LOOSE-BUTTON** (282/935, 30.2%) and **T2-COLUMNS-PRESENT** (218/935,
  23.3%) and **T2-WIDTH-ON-NONCONTAINER** (186/935, 19.9%) — match the
  brief's already-measured baseline (35/100, 22/100 on the RS-100 cohort) and
  the brief's own confirmation that these fire genuinely on the bundled
  seeds. Not re-litigated.
- **T3-NON-AUTHORABLE-TYPE** (323/935, 34.5%) — this code is explicitly
  documented as informational-only, "legitimate in existing markup" per its
  own header comment; a high rate here is expected, not a defect signal.
- **T3-PRIMARY-COUNT** / **T3-HEADER-FONT-INCOMPLETE** / **T3-ORPHAN-CONTAINER**
  — sampled and consistent with their documented mechanisms; Tier 3,
  never blocking. Not re-litigated in depth given the time budget; no
  evidence of a check-level bug surfaced.

## Normalizer impact (findings mechanically cleared)

Measured on Tier 1 + Tier 2 findings only (the ones a push-hook gate would
enforce) — Tier 3 is observe-only and isn't part of the "should this exist"
argument.

| Cohort | Forms w/ findings cleared | Findings cleared |
|---|---|---|
| RS-100, before tier1/2/3 fixes | 100/100 | 8,102 |
| RS-100, after tier1/2/3 fixes | 98/100 | 5,468 |
| Full 935-corpus, before fixes | 924/935 | 51,718 |
| Full 935-corpus, after fixes | 907/935 | 35,293 |
| Bundled seeds (15), after fixes | 14/15 | 698 |

The drop in total findings cleared (fixes reduce the count of Tier 1/2
findings that exist to BE cleared, since several were false positives the
normalizer was dutifully "fixing" that never needed fixing) is expected and
does not mean the normalizer got weaker — `normalize-form.mjs` itself was not
touched in this task.

## Bundled-seed cohort (15 forms) — separate reporting per the brief

| Code | Forms | Instances |
|---|---|---|
| T1-PROP-UNKNOWN | 15/15 (100%) | 302 |
| T2-STYLE-INCOMPLETE | 15/15 (100%) | 112 |
| T3-RAW-HEX | 13/15 (86.7%) | 1,325 |
| T3-LABEL-CASING | 12/15 (80%) | 144 |
| T2-WIDTH-ON-NONCONTAINER | 11/15 (73.3%) | 424 |
| T2-FLEX-NO-DISPLAY | 10/15 (66.7%) | 75 |
| T2-PROPERTYNAME-CASE | 9/15 (60%) | 71 |
| T1-PARENT-MISSING | 8/15 (53.3%) | 95 |
| T3-HEADER-FONT-INCOMPLETE | 8/15 (53.3%) | 12 |
| T1-VERSION-MISSING | 7/15 (46.7%) | 45 |
| T2-FLEXCHILD-NOT-CONTAINER / T2-COLUMNS-PRESENT | 6/15 (40%) each | 20 / 12 |
| T2-STYLE-OFF-TOKEN | 5/15 (33.3%) | 236 |
| T3-PRIMARY-COUNT / T1-VERSION-STALE | 4/15 (26.7%) each | 9 / 5 |
| T2-EDITMODE-MISMATCH / T2-MODELTYPE-SHAPE | 3/15 (20%) each | 21 / 3 |
| T3-ORPHAN-CONTAINER / T1-DEFAULTVALUE-NONSTRING / T2-LOOSE-BUTTON | 2/15 (13.3%) each | 3 each |
| T1-JSON-UNSAFE / T2-VALIDATIONERRORS-MISSING | 1/15 (6.7%) each | 1 each |

Even after every fix in this task, **T1-PROP-UNKNOWN and T2-STYLE-INCOMPLETE
fire on 100% of the skill's own canonical seeds**, and per-form finding
counts on individual seeds are large (`rs-detail-with-header.json`: 75 Tier-1
+ 435 Tier-2 findings). This is the most important single fact for the
go/no-go call below — the brief already anticipated genuine seed
non-conformance (T2-COLUMNS-PRESENT, T2-WIDTH-ON-NONCONTAINER confirmed
genuine there), and this task's fixes did not, and could not, resolve it: the
seeds' remaining findings are either genuine (style-incomplete containers
that really don't carry the full breakpoint contract) or a residual,
lower-confidence subset of the T1-PROP-UNKNOWN long tail described above.
Fixing the seed files themselves is out of this task's scope (`assets/examples/`
was not on the list of files this task may modify).

## Calibrated thresholds (`assets/thresholds.json`)

`calibrated: true`. Derivation exactly per the brief's formula, measured
against the full 935-form corpus:

1. Rank every form (with >=1 binding) by its Tier 3 score computed WITHOUT
   `T3-COMPONENT-RATIO` (i.e. the score `tier3()` produces when no budget is
   configured — `grade-corpus.mjs` deliberately never loads
   `assets/thresholds.json`, to avoid biasing the very numbers being derived).
   735 of 935 forms had at least one binding.
2. Take the top quartile by that score: 184 forms, score cutoff 94/100.
3. **`componentBindingRatioBudget` = 75th percentile of `components/bindings`
   within that cohort = 1.** 156 of 184 top-quartile forms (85%) carry a
   `propertyName` on literally every component, including containers and
   buttons — a corpus-wide authoring convention (mirroring `componentName`
   into `propertyName` on structural nodes, not just data-bound fields) —
   so `bindings` as this check defines it (`propertyName` present and
   non-empty) is much closer to total component count than to "how many
   fields are actually bound to data" in practice. This is a real, measured
   property of the corpus's authoring convention, not a script bug (verified:
   `grade-corpus.mjs`'s `componentCount`/`bindings` now exactly mirror
   `tier3.mjs`'s own `checkComponentRatio` arithmetic via the shared
   `flatten()` — an earlier version of the grading script used a different,
   deeper traversal that inflated `bindings` by also counting datatable
   column `propertyName`s that `componentCount` didn't count, producing a
   spuriously low ratio; this was caught and fixed before finalizing).
4. **`evalPassScore` = median Tier 3 score of that SAME top-quartile cohort,
   recomputed with the now-known budget applied = 96** (98 before the ratio
   deduction is added back in; some top-quartile forms still exceed their own
   cohort's 75th percentile and take the flat 15-point hit).

**Caveat carried into `assets/thresholds.json`'s own notes field:** because
the calibrated budget is this tight, `T3-COMPONENT-RATIO` will now fire on
roughly 32% of the full corpus (any form with even one purely-structural
component lacking a `propertyName`). This is acceptable ONLY because Tier 3 is
observe-only and never blocks the push hook (`validate-form.mjs`'s explicit
rule) — this budget must NOT be reused for a Tier 1/2-style blocking gate
without re-deriving it against a corpus that doesn't stamp `propertyName`
onto structural nodes.

| | Before (provisional) | After (calibrated) |
|---|---|---|
| `calibrated` | `false` | `true` |
| `componentBindingRatioBudget` | 4 (guess) | 1 (measured) |
| `evalPassScore` | 70 (guess) | 96 (measured) |

## Go / no-go recommendation for the Task 6 push hook

**NO-GO for a hard "deny on ANY Tier 1/2 finding" gate as currently scoped.**
Go, with a **curated code subset**, is achievable now; a blanket gate is not.

Reasoning:

1. This task fixed every confirmed false positive that could be fixed within
   `tier1.mjs`/`tier2.mjs`/`tier3.mjs` — six confirmed false positives
   (T1-ID-NOT-UUID→T1-ID-EMPTY, T1-PROP-UNKNOWN's common-style-schema gap,
   T1-TYPE-UNKNOWN/T1-PARENT-MISSING's `items[]`-pseudo-node leak,
   T2-MODELTYPE-SHAPE, T2-DATACONTEXT-PROPS, T2-PROPERTYNAME-CASE's dotted
   paths, T2-EDITMODE-MISMATCH's `readOnly` exemption, T2-DROPDOWN-SOURCE's
   entityType shape, and the shared framework-default-color exemption for
   T2-STYLE-OFF-TOKEN/T3-RAW-HEX) — all evidenced against framework source,
   not guessed.
2. Even after every one of those fixes, **the skill's own bundled seeds still
   trip Tier 1/2 findings on 100% of forms** for at least two codes
   (T1-PROP-UNKNOWN's residual long tail, T2-STYLE-INCOMPLETE), and several
   more at 40-73% (T2-WIDTH-ON-NONCONTAINER, T2-FLEX-NO-DISPLAY,
   T1-PARENT-MISSING, T2-PROPERTYNAME-CASE). Some of these are CONFIRMED
   GENUINE (T2-WIDTH-ON-NONCONTAINER, T2-COLUMNS-PRESENT per the brief) — the
   seeds themselves need remediation, which is out of this task's scope. A
   blanket gate today would deny pushes built from the skill's own
   recommended starting point ("copy the matching example... push" per
   `SKILL.md`), which is the single fastest way a team disables the gate.
3. The corpus mixes at least two Shesha framework-schema generations
   (confirmed: `AssetManagement2`/`UtilityManagement` markup is visibly
   older/flatter than `RequirementsStudio`'s). T1-VERSION-STALE's hit rate
   swings from 25% (RequirementsStudio) to ~93% (the two older-schema DBs)
   purely on this axis — a real risk that a project running an older Shesha
   release would see the gate fire on nearly every push for reasons that have
   nothing to do with that push's quality.

**What would have to change before a blanket gate is safe:**

- Remediate `assets/examples/*.json`/`assets/patterns/*.json` so the seeds
  the skill teaches from are clean against Tier 1/2 (a follow-up task, not
  this one — those files were out of scope here).
- Resolve or explicitly accept the T1-PROP-UNKNOWN long tail (either
  regenerate the registry with a fuller per-type prop scrape, or extend the
  common-style-schema allowance further with the same evidence standard used
  in this task).
- Pin the push hook's registry/thresholds to the TARGET PROJECT's actual
  Shesha version rather than a single global 0.45.1 registry, so
  T1-VERSION-STALE/MISSING don't fire on version-mismatch noise for projects
  on an older release.

**What CAN go live now:** a curated subset of low-hit-rate, high-confidence
codes that fire rarely and are unambiguous when they do —
T1-ID-DUPLICATE, T1-TYPE-UNKNOWN (post-fix), T1-SCRIPT-SYNTAX,
T1-JSON-UNSAFE, T1-EDITCOMPONENT-SHAPE, T1-DOUBLE-SLOT,
T1-DEFAULTVALUE-NONSTRING, T2-SUBMIT-WIRING, T2-EXIT-MISSING,
T2-DATACONTEXT-PROPS (post-fix), T2-MODELTYPE-SHAPE (post-fix),
T2-DROPDOWN-SOURCE (post-fix), T2-DATE-COMPONENT, T2-VALIDATIONERRORS-MISSING.
None of these exceed 24% hit rate post-fix, all have concrete confirmed
defect examples, and none fire on the bundled seeds at a rate that would
block the skill's own recommended workflow. This is a real, useful gate today
— it should ship as the Task 6 default, with the remaining higher-hit-rate
codes wired as WARN (visible, non-blocking) until the three items above are
addressed.

## Task 8 — six checks derived from a forensic analysis of two real failed builds

Two live sessions built 9 Shesha forms (`flight-details`, `flight-create`,
`flight-booking-create`, `flight-booking-details`, `flights`,
`flight-bookings`, `asset-create`, `asset-detail`, `asset-table`) whose
create/detail pages came out visibly broken, even though design comprehension,
blueprints, and entity metadata were all correct — the defects were introduced
downstream, in hand-written blueprint→markup compiler scripts. The pushed
markup for all 9 forms was analyzed directly (never committed to this repo)
to derive six new Tier 2 codes, each proven to fire on the specific broken
form(s) it was derived from and NOT on the forms confirmed clean. The full
935-form corpus + 15 bundled seeds were then re-graded with all six in place.

### The six codes

| Code | Corpus rate | Seed rate | Normalizer fixes it? | Group |
|---|---|---|---|---|
| `T2-SPLIT-WIDTH-ON-LEAF` | 0.4% (4/935, 12 instances) | 0% | Yes | B |
| `T2-SLOT-STYLE-MISMATCH` | 0% (0/935) | 0% | Yes | B |
| `T2-ROWLIST-NO-VGAP` | 3.7% (35/935, 52 instances) | 6.7% (1/15) | Yes | B |
| `T2-CODEMODE-TITLE` | 1.2% (11/935, 23 instances) | 0% | No (deliberately) | A |
| `T2-DUPLICATE-CAPTION` | 0.9% (8/935, 10 instances) | 0% | No | A |
| `T2-LABELCOL-VS-NARROW-ROW` | 1.8% (17/935, 17 instances) | 6.7% (1/15) | No | A |

All six are comfortably below every existing Group C threshold (lowest
existing Group C entry is 9.1%) — none needed to be placed in Group C
regardless of how useful they are; that discipline is the point of Group C.

**1. `T2-SPLIT-WIDTH-ON-LEAF`** — a proportional width (`%`, `calc()`) on a
non-container leaf. Fires on all four flight-* detail/create forms (30, 30,
34, 30 findings respectively — 62 of 69 real inputs, matching the brief's own
measurement) and on 0 findings for `asset-create`/`asset-detail` (the
`wrap_cells.py`-fixed negative fixture). Evidence: `flight-details`'
`rowService` container holds `flightNumber`/`airline` textFields directly,
each carrying `calc(50% - 6px)` on itself — Form.Item forces that leaf's
wrapper to `width:100% !important`, so the calc() resolves against an
already-100%-wide box and the fields render at intrinsic content width
(257/285/247px measured, not ~446px).

**Supersede vs. scope-apart decision for `T2-SPLIT-WIDTH-ON-LEAF` vs.
`T2-WIDTH-ON-NONCONTAINER`: scoped apart, not superseded.**
`T2-WIDTH-ON-NONCONTAINER`'s existing Group B classification and its
(pre-task-8) 19.9% corpus rate covered EVERY width value on a non-container —
proportional, fixed px, and the literal "100%" alike. Collapsing it into the
new, narrower check would throw away that broader coverage (a fixed px
"190px toolbar filter" is still worth flagging as inert, even though it's
benign compared to a proportional split). Instead, `T2-WIDTH-ON-NONCONTAINER`
was narrowed to exclude BOTH a proportional value (now
`T2-SPLIT-WIDTH-ON-LEAF`'s exclusive territory) AND the literal `"100%"`
(the exact value `T2-SPLIT-WIDTH-ON-LEAF`'s own fix stamps onto a leaf —
flagging it here would mean the two checks' fixed points could never both be
satisfied for the same node at once). The two codes now partition the space
instead of overlapping on the same node/path; re-measured post-narrowing,
`T2-WIDTH-ON-NONCONTAINER`'s corpus rate is 13.3% (124/935 forms, 1,182
instances) — down from 19.9%, entirely because "100%"-on-a-leaf (2,985
corpus instances, always harmless/redundant, never a real defect) and
proportional widths no longer count under this code at all.

**2. `T2-SLOT-STYLE-MISMATCH`** — a component whose children live in a
separate `content`/`header`/`customHeader` slot must have that layout style
(display/flexDirection/gap/justifyContent/alignItems) on the SLOT itself, not
only on the component's own top-level props (scoped to slots with 2+ children
— a single-child slot has no adjacency to collapse). Fires on `flight-details`
and `flight-booking-details` (2 each: `statusPanel` + `metaPanel`), 0
elsewhere. Evidence: `statusPanel`'s `content = {id, components: [...]}`
carries no style at all while the card itself declares
`desktop:{display:"flex",flexDirection:"column",gap:16}` — its two children
(a hideLabel "Status" text + a hideLabel `refListStatus` chip) collapse into
the literal run-on string `"StatusFlight status"`. Not present anywhere in
the 935-form historical corpus or the 15 bundled seeds (0% both cohorts) —
this exact pattern appears to be specific to the newer ad-hoc compiler script
that produced the flight-*/asset-* forms, not the historically-graded
production corpus. Placed in Group B anyway: the direct clearing proof against
the real evidence forms (4/4 instances cleared to 0) plus the inherent low
noise of the `>=2` children threshold make a 0%-measured rate the safest
possible Group B candidate, not a reason to withhold it.

**3. `T2-ROWLIST-NO-VGAP`** — a container/tab/column whose direct children are
2+ row-containers (each with its own horizontal gap) must declare its OWN
vertical gap, or row-to-row spacing falls back to each row's intrinsic
content height (a `dateField` picker row sits taller than a `textField` row,
producing visibly uneven gaps even though every row's horizontal gap is
identical). Fires on `flight-details` (3: `service`/`schedule`/`commercial`
tabs) and `flight-booking-details` (2), 0 on the other seven forms. 3.7% of
the corpus (35/935, 52 instances), 6.7% of seeds (`rs-detail-with-header.json`).

### Normalizer transforms added (Group B — mechanically fixed)

All three run in `scripts/normalize-form.mjs` and were proven to clear their
own finding to 0/instances across the FULL 935-form corpus (not just the
evidence forms), with zero normalizer crashes:

- **`wrapSplitWidthLeaves`** (new Phase A2.2, runs before A3): wraps ANY
  non-container child, in any of a node's child slots, that carries a
  proportional width — independent of the pre-existing `isFlexRowNode`/A3
  flex-row-only detection, which real corpus containers were found to defeat
  entirely (they carry `display`/`flexDirection` only nested under
  `desktop`/`tablet`/`mobile`, with no top-level mirror — `isFlexRowNode`
  checks the top level only). Reuses A3's own `wrapFlexChild`/
  `extractAndStripWidth` verbatim for the actual repair. Runs before A3 so a
  child this step already wrapped (now `type:"container"`) is skipped by A3's
  own non-container check — no double-wrap.
- **`propagateSlotStyle`** (new Phase A2.1): copies a node's own resolved
  layout style directly onto its `content`/`header`/`customHeader` slot when
  the slot has 2+ children and none of its own.
- **`normalizeRowListGap` / `normalizeTabRowListGap`** (new Phase A2, a
  SEPARATE pass run strictly after the whole Phase A per-node walk
  completes — not inlined into it): stamps a vertical gap directly on a real
  `container` hosting 2+ row-children; wraps a tab pane's rows in one new
  gap-bearing child container when the pane itself can't carry a gap (the
  registry's `tabs` component schema gives tab-pane objects — `{id, key,
  title, components}` — no style props at all). This had to become its own
  pass, run AFTER Phase A's per-node walk finishes for the whole tree, rather
  than being inlined into `visitStructural`'s own top-down walk: a parent
  evaluating "are 2+ of my children row-like" needs each child's OWN
  `display` already fixed (Phase A's A6 step, applied to that child later in
  the SAME top-down recursion) to answer reliably. Inlined, a first
  `normalize()` pass under-counted (children still pre-A6), while a second
  pass (`normalize(normalize(x))`) saw the same children already fixed and
  counted differently — a genuine idempotence break, caught by the
  100-form corpus idempotence test and fixed by moving this to its own later
  pass (plus calling `ensureDisplayFlex` immediately after stamping a NEW gap,
  so the display fix lands in the same pass that introduced the trigger).

`T2-CODEMODE-TITLE`, `T2-DUPLICATE-CAPTION`, and `T2-LABELCOL-VS-NARROW-ROW`
were deliberately NOT wired into the normalizer — each repair requires a
judgment call a mechanical transform must not make unilaterally (which
separator string the author intended; which of two duplicated captions to
delete; whether to switch the whole form to vertical layout or resize every
`labelCol`/`wrapperCol` span). All three are Group A instead.

### Idempotence

`normalize(normalize(f))` deep-equals `normalize(f)` across the full 100-form
`forms-rs.jsonl` corpus dump after every task-8 transform was added — the
existing `tests/normalize.test.mjs` idempotence test (and its determinism/
preservation siblings) all still pass. One real idempotence break was found
and fixed during this task (the row-list-gap ordering issue described above)
before landing.

### Hook path bug

`hooks/validate-push.mjs`'s `loadMarkupTree` resolved a command's file
reference against `cwd` using win32 Node's own `path.resolve`/`isAbsolute`,
which does not understand a POSIX-style drive path — `pwd` under Git Bash
(the primary shell on this machine) emits `/c/Users/Hashim/...`, and
`fs.existsSync("/c/Users/...")` on win32 Node returns `false` (it resolves the
leading `/` against the current drive, producing a bogus path with a spurious
extra segment) while `"C:/Users/..."` returns `true`. Any push script that
derived its path from `$(pwd)` silently hit the "could not read markup file"
branch and fell through to fail-open `skip` — the gate was a no-op for the
single most common case on this machine.

Fixed with `translatePosixDrivePath(p, { platform })`, applied to both `cwd`
and the extracted file reference before resolution: `/c/...` → `C:/...`
(Git Bash) and `/mnt/c/...` → `C:/...` (WSL), gated to `platform === 'win32'`
(on a genuine POSIX platform, `/c/...` could in principle be a real absolute
path, so the translation only applies where the underlying bug exists). Any
other path shape — including a genuinely unresolvable one — passes through
untouched, preserving the existing fail-open behaviour, which is correct and
was not changed. A new end-to-end test (`evaluatePreToolUse: a Git-Bash-style
path ... actually GATES`) proves a Git-Bash-style `cwd` + file reference now
resolves AND reaches a real `deny` decision on a Group A finding — not merely
that the path resolves, but that the gate it was silently bypassing is
restored.

## Task 9 — remediating the bundled seeds, so the gate can widen on real evidence

The go/no-go above named the seeds' own non-conformance as the #1 blocker to
widening the gate past the curated subset: a blanket gate would reject the
plugin's own canonical starting point. This task remediated the seed cohort
and re-graded to find out how much of that blocker that actually clears.

### T1-PROP-UNKNOWN verdict: mostly a registry gap, not a seed defect

Framework-source investigation (`shesha-reactjs`, branch `releases/0.45`,
read-only) against every distinct `type::path` firing on the seed cohort
found **11 genuinely invalid props** (seed bugs, now fixed) out of roughly 60
distinct paths investigated:

- `datatable::useMultiSelect` — casing typo; the real field is
  `useMultiselect` (lowercase s), confirmed in `dataTable/table/models.ts`
  and two migrations. Fixed: renamed in the seeds that had it.
- `text::fontWeight` (bare/top-level) — no such field exists; the real path
  is nested `font.weight` (`text/settingsForm.ts`). Fixed: merged into
  `font.weight`.
- `text::disabled`, `text::context`, `refListStatus::context`,
  `autocomplete::allowClear`, `dataContext::uniqueStateId`,
  `dataContext::dataSourceType`, `dataContext::dataSourceEntity`,
  `container::layout`, `textArea::rows` — no field, interface member,
  migrator reference, or settings-form control found anywhere in the
  framework source for any of these nine. Fixed: deleted from every seed
  that had them.

**Everything else — the majority of the long tail — is a confirmed registry
gap, not a seed defect**, and was deliberately left alone per the brief's
instruction not to delete valid props to satisfy a wrong check:

- Bare `hideBorder` (textField/dateField/numberField/dropdown/autocomplete)
  — real, `IInputStyles.hideBorder` (`providers/form/models.ts`) plus
  several components re-declaring it directly in their own interface.
- `dropdown::tag.*` (border.hideBorder, background.gradient.direction,
  stylingBox) — real, `IDropdownProps.tag?: IStyleType` exposes a full style
  sub-object with the same shape as any other component's style block.
- `datatable::rowPadding/rowBorder/headerFontSize/headerFontWeight/`
  `headerFontFamily/rowHeight` — real but `@deprecated` in
  `dataTable/table/models.ts` (pointing at newer replacements); still
  genuinely producible fields, not typos. `datatable::noDataText/`
  `noDataSecondaryText/crud/flexibleHeight` — real (the latter two only
  visible via the component's own migrator, not the current interface).
- `datatable::tableSettings.*` (all 11 flagged sub-fields) — real:
  `getTableSettingsDefaults()`/`getTableDefaults()`
  (`dataTable/table/utils.ts`) builds a runtime object with more fields than
  the TS return-type annotation declares — a framework
  type/runtime mismatch, not a seed error.
- `collapsiblePanel::headerStyles.*` — real, `IStyleType` reused verbatim;
  the settings-form UI for this one sub-panel just never wired width
  controls (schema-confirmed, UI-incomplete — still not a seed bug).
- `sectionSeparator::titleMargin/lineThickness/dashed`, `button::block`,
  `dropdown`/`autocomplete::useRawValues`, `dataList::listItemWidth/`
  `showBorder`, `text::fontSize/strong/padding/color`, `image::width/height`,
  `autocomplete::validate.message` — each individually confirmed real via
  interface fields, migrators, or (for `validate.message`) the base
  component model shared by every type.

**Blocking status: none of this changes anything today.** T1-PROP-UNKNOWN is
Group C (report-only) regardless of which paths are genuine vs. gaps — this
verdict matters for NOT deleting real props from seeds, and for a future
registry-regeneration task, not for this task's gate.

**A related check bug found in passing, reported not fixed (tier1.mjs is on
the do-not-modify list):** `T1-PROP-UNKNOWN`'s `collectOwnPropPaths` has no
exemption for the `overrides` key, even though `overrides[]` (`{prop, value,
source, evidence}`) is a first-class, documented convention that
`T2-STYLE-OFF-TOKEN` and `T3-RAW-HEX` both already treat as covered
provenance (see their own header comments in `tier2.mjs`/`tier3.mjs`).
Adding an `overrides[]` entry to satisfy those two checks mechanically
creates NEW `T1-PROP-UNKNOWN` findings for `overrides`/`overrides[].prop`/
`.value`/`.source`/`.evidence` (visible in the before/after table below —
several seeds' `T1-PROP-UNKNOWN` instance count goes UP after remediation for
exactly this reason). Recommend `UNIVERSAL_KEYS` or a sibling exemption set
add `overrides` in a future task.

### Seeds retired, and their exemplar replacements

Three seeds were unreadable by construction — `SKILL.md` told the model to
copy them while separately forbidding reading them:

| Retired | Lines | Why |
|---|---|---|
| `rs-detail-with-header.json` | 25,010 | ~189k tokens |
| `employee-detail-with-child-tables.json` | 14,334 | ~175k tokens (estimate per brief) |
| `employee-detail-without-child-tables.json` | 8,799 | ~99k tokens (estimate per brief) |

Replaced with two curated exemplars, both derived from the highest
Tier-3-scoring real corpus form for their archetype (deterministic
selection: highest score, ties broken by fewest components then name),
restricted to the two current-schema DBs (`RequirementsStudio`,
`MembershipManagement` — `AssetManagement2`/`UtilityManagement` use the
older/flatter markup shape this report already documents; picking an
exemplar from them would teach that older shape as canonical), then
normalized, stripped to the minimum, and hand-fixed to validate clean:

| Exemplar | Lines | Derived from | Tier1/2 findings | Tier3 score |
|---|---|---|---|---|
| `assets/exemplars/record-detail-simple.json` | 339 | `MembershipManagement/Shesha/form-template-details` (score 85, 12 components) | 0 | 100/100 |
| `assets/exemplars/record-detail-with-children.json` | 400 | `RequirementsStudio/Shesha.RequirementsStudio/service-definition-details` (score 61, 58 components) | 0 | 100/100 |

Both PASS `validate-form.mjs` outright (`exitCode 0`) and are well under the
~400-line curation ceiling.

### The two minified patterns: pretty-printed, not retired

`assets/patterns/auth-login.json` (0 lines, 21KB single-line) and
`dashboard.json` (1 line, 36KB single-line) were pretty-printed (2,673 and
1,119 lines respectively) rather than retired — the corpus offered no
better-fitting equivalent for either (auth-style anonymous pages and
metric-tile dashboards aren't represented anywhere else in the seed set),
and once pretty-printed the "open with Grep/offset" escape hatch works on
them exactly like every other seed. Both were then remediated the same way
as the `assets/examples/` files (below).

### Deliverable 2 — remediating the other 10 examples + 2 patterns

Pipeline applied to every remaining seed: `normalize-form.mjs` (mechanical:
versions, parentIds, ids, columns→flex, split widths, display:flex, slot
styles, row-list gaps, customStyle) → strip/rename the 11 confirmed-invalid
`T1-PROP-UNKNOWN` paths above → hand-fix whatever survived. Hand fixes
applied, each evidenced against the check's own contract:

- **`employee-create.json`, `rs-create-dialog.json`,
  `standalone-create.json`** — `T2-LABELCOL-VS-NARROW-ROW` (Group A):
  `formSettings.layout` switched from `"horizontal"` to `"vertical"`. This
  check's own message names exactly two valid fixes (vertical layout, or
  resize every labelCol/wrapperCol span); vertical layout has no row-width
  dependency at all, so it's the safe default for any form with a column
  split, matching this check's own suggested remedy verbatim.
- **`rs-create-dialog.json`** — `T1-DEFAULTVALUE-NONSTRING` (Group A): two
  checkboxes carried literal `defaultValue: false`. Removed — unchecked is
  already the natural default; no template-string coercion needed.
- **`auth-login.json`** — `T1-DEFAULTVALUE-NONSTRING`: the "Remember me"
  checkbox carried literal `defaultValue: true`; removed the same way.
  **`T1-JSON-UNSAFE`**: an `onSuccess` expression's raw embedded newlines
  were collapsed to one line (joined on `; `/`{`/`}` boundaries) rather than
  replaced with the literal 2-character sequence `\n` — replacing the
  newline BYTE with literal backslash-n text would have corrupted the value
  into invalid source once `new Function()` parses it (verified: this was
  tried first, and immediately tripped `T1-SCRIPT-SYNTAX` instead).
  Collapsing whitespace preserves byte-identical semantics (braces and
  semicolons already delimit every statement) while satisfying both checks
  at once. **`T2-VALIDATIONERRORS-MISSING`**: the form has required fields
  but no `validationErrors` node anywhere in the tree; added one.
- **`dashboard.json`** — `T2-FLEXCHILD-NOT-CONTAINER` (Group B, but survived
  normalization): a bare `button` and a bare `text` sat as direct children of
  containers whose flex-row style lives ONLY under `desktop`/`tablet`/
  `mobile` with no top-level mirror — the exact real-corpus shape task 8's
  own `wrapSplitWidthLeaves` note already documented as defeating
  `normalize-form.mjs`'s top-level-only `isFlexRowNode`/A3 detection, but for
  a NON-split-width child this time (A3 only wraps proportional-width
  leaves; a plain button/text child with no width at all isn't in its
  scope). Hand-wrapped both in a neutral, non-row container (reusing
  `neutralContainerStyle` from `expand-style.mjs`) — reported as a
  normalizer gap below, not fixed in `normalize-form.mjs` itself (out of
  scope for this task).
- **`entity-card.json`, `rs-subtable-tab-fragment.json`, `rs-table.json`,
  `dashboard.json`** — `T2-STYLE-OFF-TOKEN` (26 container-level instances
  across the four): added `overrides[]` provenance entries (`{prop, value,
  source: "vendor-seed-capture", evidence: "..."}`) rather than deleting the
  colors — these ARE deliberate vendor styling captured verbatim from a
  live rendering backend at seed-capture time, so the provenance claim is
  honest, not gamed. This is what let `T2-STYLE-OFF-TOKEN` promote below.

**Not fixed — reported instead (genuine check/normalizer gaps found in
passing, out of this task's file-touch scope):**
- `tier1.mjs`'s `T1-PROP-UNKNOWN` missing an `overrides` exemption (above).
- `normalize-form.mjs`'s A3 flex-child-wrap only handling
  proportional-width children, not the general "any bare non-container
  child of a flex-row container whose flex style lives only under
  `desktop`/`tablet`/`mobile`" case `T2-FLEXCHILD-NOT-CONTAINER` actually
  checks for (dashboard.json, above).

### Per-seed before/after (Tier 1 + Tier 2 findings)

"Blocking" = findings in a code currently in Group A, or Group B (the only
things `validate-push.mjs` can actually deny on). "All T1+T2" = every Tier
1/2 finding regardless of group, for context — Group C findings still
appear in the log but never block.

| Seed | Blocking before | Blocking after | All T1+T2 before | All T1+T2 after |
|---|---|---|---|---|
| `employee-create.json` | 22 | **0** | 74 | 52 |
| `employee-table.json` | 8 | **0** | 40 | 31 |
| `entity-card.json` | 4 | **0** | 25 | 12 |
| `entity-datalist.json` | 0 | **0** | 8 | 5 |
| `inline-editable-table.json` | 2 | **0** | 8 | 5 |
| `rs-create-dialog.json` | 30 | **0** | 59 | 28 |
| `rs-link-add-dialog.json` | 1 | **0** | 8 | 5 |
| `rs-subtable-tab-fragment.json` | 7 | **0** | 34 | 18 |
| `rs-table.json` | 6 | **0** | 35 | 18 |
| `standalone-create.json` | 15 | **0** | 19 | 3 |
| `auth-login.json` (pattern) | 13 | **0** | 27 | 12 |
| `dashboard.json` (pattern) | 35 | **0** | 80 | 40 |
| `record-detail-simple.json` (new exemplar) | — | **0** | — | 0 |
| `record-detail-with-children.json` (new exemplar) | — | **0** | — | 0 |

**Every seed in the cohort now has zero blocking (Group A/B) findings.** The
skill's own recommended starting point no longer trips the push gate — the
#1 blocker named in the original go/no-go is cleared. Some "all T1+T2" counts
went up on a few files (e.g. `rs-table.json` 7→14 `T1-PROP-UNKNOWN`
instances) purely from the `overrides` exemption gap documented above — an
artifact of this task's own remediation technique, not new defects.

### Bundled-seed cohort re-measured (14 forms — 3 retired, 2 exemplars added)

| Code | Forms (before, 15) | Forms (after, 14) |
|---|---|---|
| T1-PROP-UNKNOWN | 15/15 (100%) | 12/14 (85.7%) |
| T2-STYLE-INCOMPLETE | 15/15 (100%) | 12/14 (85.7%) |
| T3-RAW-HEX | 13/15 (86.7%) | 10/14 (71.4%) |
| T3-LABEL-CASING | 12/15 (80%) | **0/14** |
| T2-WIDTH-ON-NONCONTAINER | 11/15 (73.3%) | **0/14** |
| T2-FLEX-NO-DISPLAY | 10/15 (66.7%) | **0/14** |
| T2-PROPERTYNAME-CASE | 9/15 (60%) | 6/14 (42.9%) |
| T1-PARENT-MISSING | 8/15 (53.3%) | **0/14** |
| T3-HEADER-FONT-INCOMPLETE | 8/15 (53.3%) | 5/14 (35.7%) |
| T1-VERSION-MISSING | 7/15 (46.7%) | **0/14** |
| T2-FLEXCHILD-NOT-CONTAINER | 6/15 (40%) | **0/14** |
| T2-COLUMNS-PRESENT | 6/15 (40%) | **0/14** |
| T2-STYLE-OFF-TOKEN | 5/15 (33.3%) | **0/14** |
| T3-PRIMARY-COUNT | 4/15 (26.7%) | 1/14 (7.1%) |
| T1-VERSION-STALE | 4/15 (26.7%) | **0/14** |
| T2-EDITMODE-MISMATCH | 3/15 (20%) | 3/14 (21.4%) |
| T2-MODELTYPE-SHAPE | 3/15 (20%) | 3/14 (21.4%) |
| T3-ORPHAN-CONTAINER | 2/15 (13.3%) | 2/14 (14.3%) |
| T1-DEFAULTVALUE-NONSTRING | 2/15 (13.3%) | **0/14** |
| T2-LOOSE-BUTTON | 2/15 (13.3%) | 2/14 (14.3%) |
| T1-JSON-UNSAFE | 1/15 (6.7%) | **0/14** |
| T2-VALIDATIONERRORS-MISSING | 1/15 (6.7%) | **0/14** |

Every Group A/B code (bold **0/14** rows) is now fully clear on the seed
cohort. The remaining nonzero rows are all Group C (never block) plus two —
`T2-EDITMODE-MISMATCH`, `T2-MODELTYPE-SHAPE` — that stayed roughly flat
(considered for promotion below, not promoted).

### Deliverable 4 — gate widening on the new evidence

Re-graded the full 935-form corpus (unchanged — this task didn't touch
corpus data) and the remediated 14-form seed cohort together. Promotion
rule applied strictly: a Group C code promotes only when **both** the
corpus rate and the seed rate are low — corpus rate is authoritative for
what real projects look like; a clean seed cohort alone is not sufficient
(that would recreate exactly the problem this task fixes).

**Promoted: `T2-STYLE-OFF-TOKEN`, Group C → Group A.**
Corpus 9.1% (85/935) — already comfortably inside the existing Group A
range (0.1%-15.5%) before this promotion. Seed: 33.3% (5/15) → **0/14**
post-remediation. Not normalizer-fixable (adding truthful provenance is a
human/blueprint judgment call, matching the same reasoning as
`T2-VALIDATIONERRORS-MISSING`/`T2-DATACONTEXT-PROPS`), so Group A not B.

**Considered, NOT promoted** (every other Group C code with a seed rate
that improved):

| Code | Corpus rate | Seed rate (14) | Verdict |
|---|---|---|---|
| T2-DROPDOWN-SOURCE | 24.0% | 0/14 (0%) | **NOT promoted** — textbook "seeds clean, corpus real" case: seed evidence alone doesn't justify gating a code that still fires on 1 in 4 real forms. |
| T2-MODELTYPE-SHAPE | 21.8% | 3/14 (21.4%) | **NOT promoted** — both rates nearly identical and both exceed every current Group A member (max 15.5%); not normalizer-fixable so Group B isn't an option; the underlying fix is only one calibration cycle old (Task 5). |
| T2-PROPERTYNAME-CASE | 36.5% | 6/14 (42.9%, down from 60%) | **NOT promoted** — both cohorts well above the current Group B ceiling (23.3%). |
| T2-EDITMODE-MISMATCH | 55.7% | 3/14 (21.4%) | **NOT promoted** — corpus rate alone rules this out regardless of seed improvement. |
| T1-PROP-UNKNOWN, T1-VERSION-STALE, T2-STYLE-INCOMPLETE, T2-LOOSE-BUTTON | all >30% corpus | mixed | **NOT promoted** — corpus rate is the hard blocker for all four; see each code's own Group C justification in `gate-policy.json` (unchanged this task). |

### What still cannot be gated, and why

- **T1-PROP-UNKNOWN** (93.9% corpus) — mostly a registry-scraper gap (this
  task's investigation, above), not fixable by seed edits or by this task's
  scope (regenerating the registry is explicitly out of scope — "do NOT
  regenerate the registry yourself"). Recommend a follow-up registry
  regeneration task using the ~50 confirmed-real paths above as a checklist.
- **T1-VERSION-STALE** (83.9% corpus, but 25% on `RequirementsStudio` alone)
  — a corpus/registry version-mismatch artifact for the two older-schema
  DBs, not something seed remediation touches. Needs per-project registry
  pinning (unchanged recommendation from the original go/no-go).
- **T2-STYLE-INCOMPLETE** (69.0% corpus, 85.7% seed) — genuine defect,
  seed rate actually WORSE than before proportionally (12/14 vs 15/15, but a
  smaller denominator) since the two new exemplars are clean while several
  real captured seeds still carry partial style blocks the normalizer's role
  mechanism doesn't retrofit onto pre-existing markup (only newly-authored/
  role-tagged containers get a role's full style). Not touched further —
  fully filling in every incomplete container across 8+ real vendor-captured
  forms was judged out of proportion to this task's remaining budget; flagged
  for a follow-up.
- **T2-EDITMODE-MISMATCH, T2-PROPERTYNAME-CASE, T2-LOOSE-BUTTON,
  T2-MODELTYPE-SHAPE, T2-DROPDOWN-SOURCE** — see the promotion table above;
  all rejected on corpus-rate grounds even where seed evidence improved or
  was already clean.
- **Two reported (not fixed) check/normalizer gaps** — `tier1.mjs`'s
  `T1-PROP-UNKNOWN` missing an `overrides` exemption, and
  `normalize-form.mjs`'s A3 flex-child wrap only covering proportional-width
  children, not the general bare-child case. Both are on the do-not-modify
  list for this task; both are documented above with the exact evidence that
  surfaced them.

## Task 10 — closing three gaps: the registry-scraper root cause, the
## universal-container rule, and the `overrides` exemption

### Gap 1: the registry gap's root cause, and the generic fix

Root cause (framework-source investigation, `scripts/harness/extract.test.ts`
against `shesha-reactjs` `releases/0.45`): the harness only ever harvested
literal `propertyName` leaves out of a component's `settingsFormMarkup` tree.
Every one of Task 9's ~50 confirmed-real gap paths, without exception, turned
out to be a prop that is genuinely producible at runtime — by a component's
`initModel` defaulting hook, or by one of its `migrator` steps — but that no
settings-form control has ever been wired up for (datatable's
`tableSettings.*` is literally built by `getTableSettingsDefaults()` inside
`initModel`, "a framework type/runtime mismatch"; `crud`/`flexibleHeight`/
`noDataText` are "only visible via the component's own migrator"; bare
`hideBorder` is `IInputStyles.hideBorder`, still declared on several
components' own Props interface even though the settings form for those
types only exposes the nested `border.hideBorder` replacement).

The fix (`scripts/harness/extract.test.ts`, `collectModelSourcePaths`) is
generic, not a hand list: for every component, in addition to the existing
`settingsFormMarkup` walk, it now (1) calls `initModel({})` with an empty
seed, and (2) replays every registered `migrator` step in order from an
empty seed, collecting the UNION of keys seen after EACH step (not just the
final result — this is what recovers a field a later step stops setting,
e.g. deprecated-but-real `datatable::rowPadding`/`rowBorder`/
`headerFontSize`/`headerFontWeight`/`headerFontFamily`). Both sources are
best-effort (try/catch per step/component — a migration step written
assuming a pre-populated shape against our empty synthetic seed must not
abort the rest of the extraction). The harvested runtime keys are flattened
into dotted paths by a second walker (`collectValuePaths`) that mirrors
tier1.mjs's own `collectOwnPropPaths` exactly: `components`/`columns`/
`tabs`/`content`/`header`/`customHeader`/`items` are excluded at any depth
(child-COMPONENT slots, never props — an early version of this fix, before
this exclusion, leaked literal `"components"` into `container`'s own prop
list from its `initModel({}).components: []`), and `desktop`/`tablet`/
`mobile` wrappers are transparent at the top level only (without this, every
style leaf appeared 4 times over — bare, and once per breakpoint — for a
~5x registry bloat that was pure noise, not signal, since tier1's own
`isKnownProp` already flattens breakpoint nesting away before matching).

Before/after prop counts (measured, `node scripts/gen-registry.mjs
--framework <shesha-framework> --version 0.45.1`):

| Type | Before | After |
|---|---|---|
| container | 63 | 99 |
| textField | 74 | 101 |
| datatable | 92 | 157 |
| columns | 50 | 52 |
| button | 61 | 94 |
| dropdown | 133 | 183 |
| tabs | 96 | 98 |

Spot-checked against Task 9's evidence list: `datatable` now declares all 11
`tableSettings.*` sub-fields plus `crud`/`flexibleHeight`/`noDataText`/
`noDataSecondaryText`/`rowPadding`/`rowBorder`/`headerFontSize`/
`headerFontWeight`/`headerFontFamily`; `textField`/`autocomplete` now declare
bare `hideBorder`; `dropdown` now declares the full `tag.*` style block
(`tag.border.hideBorder`, `tag.background.gradient.direction`,
`tag.stylingBox`, etc.) — every category Task 9 named as a confirmed
registry gap is now present. `registry-acceptance.test.mjs`'s thresholds
were raised to these measured counts (kept as floors, `>=`, per the brief);
every other invariant it protects (116 components, `addressInput` absent,
`datatableContext` present/non-authorable, `dataContext` version null, zero
scaffolding leakage, keys sorted, `type` populated) still holds — verified
directly, not just by the test passing.

**T1-PROP-UNKNOWN corpus rate: 93.9% → 89.0%** (832/935 forms, 14,410
instances; measured via `scripts/grade-corpus.mjs` against the same 935-form
corpus dump). **Not promoted.** 89.0% remains far above every current Group A
member (max 15.5%) and Group B's ceiling — the fix closed the registry-gap
share of the problem (verified: the paths named above no longer appear in
the corpus's unknown-prop tally at all), but the residual 89% is now
dominated by genuinely invalid real-world usage (typos and pre-Task-9-style
mistakes baked into production forms, e.g. `text::disabled`, `textArea::rows`
— the exact 11 paths Task 9's own investigation already confirmed invalid)
plus a smaller residue of props a component only ever RECEIVES via a
metadata-linking hook (`linkToModelMetadata`) or via a migration that
CONSUMES an old field name without re-emitting it (e.g. `entityTypeShortAlias`)
— neither of which `initModel`/`migrator`-replay can recover, since nothing
in either path ever assigns those exact keys to the object this task's
extraction inspects. Flagged for a possible future follow-up; out of this
task's scope.

### Gap 2: the universal container rule, extended to every bare leaf

`normalize-form.mjs`'s A3 step (`isFlexRowNode`) determined "is this a flex
row container" from the node's TOP-LEVEL `display`/`flexDirection` only.
Real corpus containers (Task 9's dashboard.json case) carry that style
ONLY nested under `desktop`/`tablet`/`mobile`, with no top-level mirror —
under the old check, A3 never even recognised such a container as a flex
row, so its child-wrap step never ran on it at all, regardless of whether a
child carried a width. `isFlexRowNode` now uses the same merged
top-level-then-`desktop`-override view (`desktopView()`) the file's own
A2.1/A8 steps already use, and — by construction — the identical definition
tier2.mjs's `T2-FLEXCHILD-NOT-CONTAINER` (`isFlexRow()`/`bpView(node,
'desktop')`) already checks, so the two are now provably consistent: whatever
the check would flag, the normalizer now fixes.

Per the project owner's stated rule ("every component should sit inside its
own container, with the layout settings applied on that container"),
`wrapFlexChild` (shared by A3 and A2.2) now also stamps the wrapped leaf's
own `dimensions.width` to the literal string `"100%"` — an honest statement
of what the antd Form.Item chain already forces, rather than leaving the
value silently absent. A5 (`stripDimensionsWidth`) was taught to leave
exactly `"100%"` alone (only a REAL, non-`"100%"` width is still stripped),
since without that carve-out A5 would erase A3's own stamp the moment it
revisits the same leaf later in the same top-down walk.

**Idempotence: PASS.** `normalize(normalize(f))` deep-equals `normalize(f)`
across all 100 forms in `forms-rs.jsonl` (existing corpus-wide test,
unaffected in shape by this change) plus a new dedicated fixture test
exercising exactly the reported gap (a bare, no-width leaf under a
desktop-only flex row) — both pass.

**Tier 3 component-count exemption: confirmed BROKEN, reported, not fixed
(`tier3.mjs` is on the do-not-modify list).** `T3-COMPONENT-RATIO` divides
total component count by bound-field count with no allowance for
normalizer-inserted wrappers — verified directly: a 4-node form (1 flex-row
container + 3 bare bound leaves) scores ratio 1.33 (no finding, budget 1.5);
after `normalize()` correctly wraps each leaf per the fix above, the same
form has 7 nodes for the same 3 bindings, ratio 2.33, and NOW trips
`T3-COMPONENT-RATIO` — a finding that did not exist before normalization,
solely because of wrappers the normalizer itself added. This directly
contradicts the minimalism rule's stated exemption for normalizer-inserted
structural wrappers, and this task's Gap 2 fix makes the effect MORE visible
(more bare leaves now get wrapped than before). Needs a follow-up in
`tier3.mjs` (e.g. excluding nodes with no `propertyName`, no styling of their
own, and exactly one child from the numerator) — out of this task's scope to
fix.

### Gap 3: `tier1.mjs`'s `overrides` exemption

`T1-PROP-UNKNOWN`'s `collectOwnPropPaths` had no exemption for the
`overrides` key, even though `overrides[]` (`{prop, value, source,
evidence}`) is the project's sanctioned style-provenance contract
(`../shesha-design-comprehension/assets/blueprint.schema.json`) already
honoured by `T2-STYLE-OFF-TOKEN` (`tier2.mjs`) and `T3-RAW-HEX` (`tier3.mjs`)
— both of which already skip `overrides`/`styleOverrides` in their own
own-key collection. `tier1.mjs` now does the same (`key === 'overrides'`,
matching the sibling checks' unconditional-of-depth scope exactly), so
satisfying T2-STYLE-OFF-TOKEN/T3-RAW-HEX by adding an `overrides[]` entry no
longer mechanically creates a brand-new T1-PROP-UNKNOWN finding for
`overrides`/`overrides[].prop`/`.value`/`.source`/`.evidence`. Covered by a
new test in `tests/tier1.test.mjs`.

### Tests

All four suites pass: hooks 33/33, shesha-form-edit 208/208 (206 baseline +
2 new: the `overrides` exemption test, the desktop-only-flex-row wrap test),
shesha-design-system 14/14, shesha-design-comprehension 37/37. Framework repo
(`shesha-reactjs`) left clean — `git status --short` shows only the
pre-existing untracked `shesha-reactjs-043/`.
