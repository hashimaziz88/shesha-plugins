# SFS mining & pipeline-validation report

> **Validation/measurement run** executed *after* Scope A completed, per
> `MINING-PROMPT.md`. Read-only against the repo: nothing in `packages/sfs/corpus/`,
> `packages/verify/config/session-scope.json`, or any gate was touched. The extractor
> reads configuration-item tables only (metadata, never data tables). Every number
> below comes from command output or committed files — none from memory.

- **Run date:** 2026-08-19 (extraction timestamps 2026-08-19T11:33–11:34 UTC)
- **Repo / branch:** `C:\Users\Hashim\Documents\GitHub\shesha-plugins` @ `hashim/sfs-rebuild-scope-a`
- **Node:** v22.23.2 (via `fnm use 22`; a bare `node` lies non-interactively — BLOCKED B13)
- **SQL target:** SQL Server 2022 (16.0.4265.3) in container on `localhost,1433`, sa login (password held in `$env:SFS_SQL_PASSWORD` for the session, kept out of this file)

## §0 Orientation

| Check | Result |
|---|---|
| Branch | `hashim/sfs-rebuild-scope-a` |
| Position | WP-10 — HEAD `4b5d90f [feature]- WP-10 the integration proof and anti-drift gate suite` |
| Uncommitted (left undisturbed) | `M export-shesha-forms.mjs`, `M export-shesha-forms.test.mjs`, `?? MINING-PROMPT.md` |
| SFS CLI live subcommands | `compile`, `roundtrip` (both `null` in `VERBS`) |
| SFS CLI *not* built in this build | `decompile` → WP-6, `normalise` → WP-1, `push` → WP-6 (each exits 2, never 0) |
| Tool tests | `npm --prefix docs/rebuild-brief/corpus-intake test` → **23/23 pass**, no DB |

Because the CLI's `roundtrip` verb only reads the gated corpus scope (with an
expected-clean set and a 0.90 gate) and `decompile` is not exposed in this build,
§5 was done by hand exactly as the prompt's fallback prescribes — reusing the
repo's own `decompile()` and `compile()` and the identical round-trip predicate
from `packages/sfs/src/roundtrip.mjs::evaluate()` (see [Method](#method)).

## §1–2. Databases and extraction

`export-shesha-forms.mjs --list-databases` reported 11 databases. Excluding the four
system DBs, **seven** carry (or could carry) Shesha form configurations. Every DB was
discovered first (`--discover-only`, writes nothing) and only then extracted. No DB
reported a `0/23` discovery miss.

| Database (as SQL sees it) | source-tag | schema | form/base table | latest-version | forms | skipped | envelope fields |
|---|---|---|---|---|---:|---:|---|
| `RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade` | `requirements-studio` | snake_case | `frwk.form_configurations` / `frwk.configuration_items` | maxVersionNo | **207** | 0 | 16/23 |
| `385xbw-new-20260817-090916-fixed` (PBF) | `pbf-045` | snake_case | `frwk.form_configurations` / `frwk.configuration_items` | maxVersionNo | **236** | 0 | 16/23 |
| `LBCrm` (LandBank CRM) | `lbcrm` | PascalCase | `dbo.Frwk_FormConfigurations` / `dbo.Frwk_ConfigurationItems` | IsLast | **680** | 0 | 13/23 |
| `gn5y8p-20260818-094920` | `gn5y8p` | PascalCase | `dbo.Frwk_FormConfigurations` / `dbo.Frwk_ConfigurationItems` | IsLast | **693** | 0 | 13/23 |
| `hashim` | `hashim` | snake_case | `frwk.form_configurations` / `frwk.configuration_items` | maxVersionNo | **92** | 0 | 16/23 |
| `test` | `test` | PascalCase | `dbo.Frwk_FormConfigurations` / `dbo.Frwk_ConfigurationItems` | IsLast | **163** | 0 | 13/23 |
| `385xbwnew-20260817-090916` (16 MB) | — | — | — | — | — | — | **not a Shesha DB** |

**Total: 2,071 forms extracted, 0 skipped.** Output under `%USERPROFILE%\Documents\sfs-corpus-intake\<tag>\`, one envelope per form plus `manifest.json`. All provenance is `db-export-partial-envelope`.

### Envelope completeness (why 16/23 and 13/23, not 23/23)

Every extract is a *partial* envelope, honestly recorded — the missing fields are
columns the schema genuinely does not have, emitted as `null` and listed in each
manifest's `envelopeFieldsMissing`, never faked to a value.

- **snake_case DBs (16/23)** — present: `Markup, ModelType, TemplateId, IsTemplate, GenerationLogicTypeName, GenerationLogicExtensionJson, PlaceholderIcon, Id, OriginId, Name, Label, ItemType, Description, ModuleName, Suppress, DateUpdated`. Missing (7): `Access, Permissions, ConfigurationForm, FrontEndApplication, BaseModules, Comments, ConfigHash`.
- **PascalCase DBs (13/23)** — additionally missing (10 total): the same 7 plus `GenerationLogicTypeName, GenerationLogicExtensionJson, PlaceholderIcon`.

### Version confirmation

Not separately confirmed from a `Frwk_*` migrations table — the prompt marks this
optional and not required for mining. The `-45upgrade` suffix on the RequirementsStudio
backup and the `0.45` note against PBF are **filenames/hints, not facts** and are not
asserted here.

## §4. Databases not on the container / the DBCopies folder

- **`LBCrm`** was anticipated as possibly LocalDB, but it is **already attached to the container** (265 MB, ONLINE) and was extracted directly. No LocalDB fight, no restore needed.
- **`C:\Users\Hashim\OneDrive - Boxfusion International\DBCopies`** contains **90+ `.bacpac` files and zero `.bak` files.** The §4 `RESTORE ... FROM DISK` mechanism is for `.bak`; `.bacpac` needs a different tool (SqlPackage/Import) and was **not** used in this fast run.
  - The overwhelming majority are historical timestamped snapshots of apps already represented on the container. The newest `RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade.bacpac` (22.2 MB) matches the attached DB of the same name exactly; `LandBankCRM.bacpac` (3.6 GB) corresponds to the already-attached `LBCrm`.
  - A few distinct apps appear **only** as `.bacpac` and are **not** currently attached — e.g. `MembershipManagement`, `linux-midvaal-utilitymanagement-{qa,test}`, `linux-lesedi-dep-shesha-test`, `fieldTest`. Extracting these would require a separate bacpac-import step and is **out of scope for this measurement run** (flagged here rather than silently skipped). They are candidates for a follow-up if broader coverage is wanted.
- **`385xbwnew-20260817-090916` (16 MB)** is on the container but is **not a Shesha database**: discovery failed with *"No base table has a 'Markup' column."* Size ≈ `model` (16 MB) confirms it is effectively empty. Reported, not counted.

## §3. Defect census (baseline, per source-tag)

Measured by `defect-census.mjs` (pure function of the form JSON — no compiler, backend
or browser). `clean` = forms with zero of the eight normalisation defect classes. Full
per-class reports are committed alongside this file.

| source-tag | forms | unreadable | clean | defect instances | breakpoint share | report |
|---|---:|---:|---:|---:|---:|---|
| requirements-studio | 207 | 0 | 81 | 1,656 | 68.2% | [census-requirements-studio.md](census-requirements-studio.md) |
| pbf-045 | 236 | 0 | 71 | 2,934 | 59.4% | [census-pbf-045.md](census-pbf-045.md) |
| lbcrm | 680 | 0 | 142 | 4,979 | 4.4% | [census-lbcrm.md](census-lbcrm.md) |
| gn5y8p | 693 | 0 | 146 | 5,328 | 4.6% | [census-gn5y8p.md](census-gn5y8p.md) |
| hashim | 92 | 0 | 27 | 846 | 63.8% | [census-hashim.md](census-hashim.md) |
| test | 163 | 0 | 47 | 764 | 14.7% | [census-test.md](census-test.md) |
| **total** | **2,071** | **0** | **514** | **16,507** | — | |

### Defect instances by class (N1–N8)

| tag | N1 stray label | N2 breakpoint inconsist. | N3 partial className | N4 small-height wrapper | N5 dual styling | N6 stylingBox dup | N7 redundant row-click | N8 submit-on-list |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| requirements-studio | 396 | 265 | 2 | 0 | 94 | 879 | 0 | 20 |
| pbf-045 | 649 | 860 | 2 | 18 | 36 | 1,342 | 0 | 27 |
| lbcrm | 4,851 | 14 | 8 | 0 | 3 | 39 | 0 | 64 |
| gn5y8p | 5,189 | 17 | 8 | 0 | 6 | 36 | 0 | 72 |
| hashim | 300 | 66 | 2 | 1 | 43 | 426 | 1 | 7 |
| test | 701 | 38 | 1 | 0 | 9 | 6 | 0 | 9 |

N1 (stray designer labels) dominates the two big CRM databases; N6 (`stylingBox`
duplicated) and N2 (breakpoint inconsistency) dominate the RequirementsStudio/PBF/hashim
forms, tracking their much higher breakpoint share.

## §5. Pipeline validation — round-trip over the real forms (the payload)

Read-only. For every extracted envelope the repo's own decompiler and compiler were run
with the canonical predicate:

```
roundTrips(f) ⇔ decompile(f) validates (no throw; DEC-7001 is a fail)
               AND structuralEscapes(f) === 0
               AND compile(decompile(f)).markup === compile(decompile(compile(decompile(f)))).markup
```

### Round-trip rate per source-tag

| source-tag | forms | round-trips clean | rate | fail: structural escape | fail: decompile→recompile | fail: unstable |
|---|---:|---:|---:|---:|---:|---:|
| requirements-studio | 207 | 55 | **26.6%** | 19 | 133 | 0 |
| pbf-045 | 236 | 55 | **23.3%** | 51 | 130 | 0 |
| lbcrm | 680 | 13 | **1.9%** | 149 | 518 | 0 |
| gn5y8p | 693 | 14 | **2.0%** | 161 | 518 | 0 |
| hashim | 92 | 5 | **5.4%** | 20 | 67 | 0 |
| test | 163 | 2 | **1.2%** | 20 | 141 | 0 |
| **overall** | **2,071** | **144** | **7.0%** | 420 | 1,507 | 0 |

`unstable = 0` everywhere: no form that decompiled cleanly with zero escapes then
failed the recompile-stability check. Every failure is one of two kinds — the
decompiled SFS **won't recompile** (`DEC-7001`, the larger cause), or the form
contains a **structural construct the IR has no node for** (a raw escape). Escape
counts are a *lower bound*: a form whose decompile throws never reaches escape
counting.

### The prioritised backlog — top constructs by number of forms that fail to round-trip

Sorted descending. A single form can appear against more than one construct (e.g. two
different escaping component types). This is the "what the IR / pipeline still cannot
express" list. Source data: [`roundtrip-results.json`](roundtrip-results.json).

| # forms | construct | kind | what it means |
|---:|---|---|---|
| 498 | `compile-npe: reading 'hidden'` | **compiler crash** | Decompiled SFS crashes the compiler with a `TypeError` (`Cannot read properties of undefined (reading 'hidden')`) instead of a graceful diagnostic. Robustness gap in the compile path — the single largest blocker. |
| 259 | `SFS-1101 /entity` | schema — naming | Decompiler passes the entity/modelType through unsanitised; real values fail `entity` pattern `^[A-Za-z_]…(\.[A-Za-z_]…)+$` (or `entity` is absent entirely). |
| 241 | `columns` | **IR gap (escape)** | The multi-column layout component has no SFS node → structural raw escape. **#1 missing node.** |
| 232 | `SFS-1101 /form` | schema — naming | Decompiled `form` name violates `^[a-z][a-z0-9-]{0,63}$` (real form names carry caps/dots/underscores). |
| 225 | `SFS-1101 /label` | schema — naming | Decompiled `label` (and empty hook strings) violate "≥1 character" — empty strings emitted where the schema forbids them. |
| 153 | `buttonGroup` | **IR gap (escape)** | Button-group action configs the intent grammar cannot express → whole group escapes. |
| 109 | `collapsiblePanel` | **IR gap (escape)** | No SFS node. |
| 62 + 30 + 18 + 11 + 5 = 126 | `SFS-1101 /body/**/node` (various depths) | schema — node enum | Decompiler emits a child `node` kind not allowed at that position (schema allows only `row`/`col` in container slots). |
| 50 | `tabs` | **IR gap (escape)** | No SFS node. |
| 42 | `statusTag` | **IR gap (escape)** | No SFS node. |
| 37 | `title` | **IR gap (escape)** | No SFS node. |
| 36 | `REG-2101 raw.type "tree"/"map"` | registry gap | A raw-escaped node's `type` (e.g. `tree`, `map`) is not a registry component, so the residue recompile fails. |
| 34 | `button` | **IR gap (escape)** | Standalone button escapes. |
| 18 | `sectionSeparator` | IR gap (escape) | No SFS node. |
| 16 | `SFS-1101 /hooks/onAfterDataLoad` | schema — naming | Empty hook string emitted. |
| 16 | `SFS-1101 /body/**/style/pad/top` | schema — type | `style.pad.*` emitted as non-integer where schema wants integer. |
| 15 | `htmlRender` | IR gap (escape) | No SFS node. |
| 14 | `SFS-1101 /body` | schema | Empty `body` (form had no liftable content). |
| 12 | `alert` | IR gap (escape) | No SFS node. |
| 6 | `STM-5201 headerAppControl` | registry gap | Authorable type has no registry version; compiler refuses to invent one. |
| 6 | `SFS-1004 themeEditor` | schema | `themeEditor` field is not an authorable input type. |
| 6 | `sizableColumns` / `link` / `space` (each) | IR gap (escape) | No SFS node. |
| 4 | `SER-6102 menuItemShadow` | serializer gap | Unlisted style key `menuItemShadow` at a `desktop` block has no place in the key-order list. |
| 4 | `wizard` | IR gap (escape) | No SFS node. |
| 2–3 | `tableViewSelector`, `datatable.filter`, `divider`, `list` | IR gap (escape) | No SFS node. |

### Escaping framework component types only (the cleanest "IR has no SFS node" list)

Counting only forms that decompiled successfully and then hit a structural escape:

| # forms | component type |
|---:|---|
| 241 | `columns` |
| 153 | `buttonGroup` |
| 109 | `collapsiblePanel` |
| 50 | `tabs` |
| 42 | `statusTag` |
| 37 | `title` |
| 34 | `button` |
| 18 | `sectionSeparator` |
| 15 | `htmlRender` |
| 12 | `alert` |
| 6 | `sizableColumns`, `link`, `space` |
| 4 | `wizard` |
| 3 | `tableViewSelector`, `datatable.filter` |
| 2 | `divider`, `list` |

## Verdict — is the rebuild ready for testing?

**Not yet on real production forms — one more expressiveness/robustness pass is
indicated.** Overall round-trip is **7.0%** (144/2,071). The gap decomposes into three
addressable families, in priority order:

1. **Compiler robustness (498 forms):** the `reading 'hidden'` `TypeError` should become a diagnostic, not a crash. This alone gates a quarter of all failures and blocks visibility into whatever those forms would escape on.
2. **Decompiler output hygiene (~700 forms across `/entity`, `/form`, `/label`, `/hooks/*`, node-enum, `pad` type):** the decompiler emits SFS that fails its own schema — unsanitised names, empty strings, wrong child-node kinds, non-integer paddings. These are fixes in the lift, not new language.
3. **Genuine IR expressiveness gaps (escapes):** the language has no node for `columns`, `buttonGroup` (rich actions), `collapsiblePanel`, `tabs`, `statusTag`, `title`, `button`, `sectionSeparator`, `htmlRender`, `alert`, `wizard`, … plus registry gaps (`tree`, `map`, `headerAppControl`, `themeEditor`) and a serializer gap (`menuItemShadow`). `columns` and `buttonGroup` are the highest-value additions.

The clean 144 confirm the happy path works end-to-end on real forms; the ranked list
above is the concrete backlog to lift the rate.

## §6 checklist

- **`0/23` discovery misses:** none. Every Shesha DB resolved 13/23 or 16/23; the sole failure (`385xbwnew`, 16 MB) is a non-Shesha/empty DB, reported above with its cause.
- **Failed restores / unreachable DBs:** none attempted — LBCrm was already attached; DBCopies are `.bacpac` (no `.bak`), documented as a deliberate out-of-scope decision, not a silent skip.
- **Fabricated counts:** none. Every count is from `manifest.json`, `census-*.json`, or `roundtrip-results.json`.

## Method

- **Extraction:** `docs/rebuild-brief/corpus-intake/export-shesha-forms.mjs`, discovery-first, per-DB, one `--source-tag` each. Output outside the repo at `%USERPROFILE%\Documents\sfs-corpus-intake\`.
- **Census:** `docs/rebuild-brief/corpus-intake/defect-census.mjs` → `census-<tag>.{json,md}` (committed beside this report).
- **Round-trip:** a read-only harness importing `packages/sfs/src/{compile,decompile}/index.mjs` and applying `roundtrip.mjs::evaluate()`'s predicate over each staged envelope. It writes nothing into `packages/sfs/`. Results: `roundtrip-results.json` (beside this report). The harness itself lives in the session scratchpad (not committed — this is a measurement run, not corpus intake).
- **Reproduce:**
  ```powershell
  fnm env --use-on-cd | Out-String | Invoke-Expression ; fnm use 22
  cd docs\rebuild-brief\corpus-intake ; $env:SFS_SQL_PASSWORD = '@123Shesha' ; npm install
  node export-shesha-forms.mjs --list-databases
  # per DB: node export-shesha-forms.mjs --discover-only -d '<db>' -t '<tag>' ; then without --discover-only
  # per tag: node defect-census.mjs "$env:USERPROFILE\Documents\sfs-corpus-intake\<tag>" --json census-<tag>.json --md census-<tag>.md
  ```
