# Design: Port the Shesha design pipeline to `shesha-developer-0-43`

**Date:** 2026-07-01
**Author:** Hashim (with Claude Code)
**Status:** Proposed — awaiting approval

## 1. Problem

The Shesha "Claude design" pipeline — `shesha-claude-designer` (orchestrator) plus
`shesha-form-edit`, `shesha-design-system`, `shesha-design-comprehension` and
`clean-form-config` — lives only in the **0.45.x** `shesha-developer` plugin. The
version-pinned **`shesha-developer-0-43`** plugin does not contain these five skills at
all.

The pipeline's push path was written for 0.45.x, where the **Configuration Studio** hides
form versioning: it resolves a form to its currently-Live id and writes markup straight
onto it via `UpdateMarkup` / `ImportJson`. On **0.43.x** forms are versioned
`ConfigurationItem`s (Draft → Ready → Live → Retired/Cancelled). The current behaviour
therefore **clobbers the Live version in place** — the exact bug the user reported:
*"currently it's only updating the latest live form version and I need it able to
distinguish."*

Beyond versioning, the 0.45 skills hardcode 0.45 component `version` integers, use the
0.45 data-wrapper component type `dataContext`, and point humans at the Configuration
Studio — none of which are correct on 0.43.

## 2. Goal

Create a 0.43-correct copy of the five pipeline skills (plus the four agents they
dispatch) inside `plugins/shesha-developer-0-43/`, so the pipeline builds and edits forms
on a 0.43.x backend **respecting the version lifecycle** and using 0.43 component
versions/types, while leaving the 0.45 `shesha-developer` plugin untouched.

## 3. Source of truth (resolved)

The `shesha-plugins` marketplace is configured in `~/.claude/settings.json` as a **local
path pointing at this git repo**, so the harness loads skills **from the git working tree,
not the plugin cache**. The git working tree is therefore "what currently works for 0.45"
and is the copy source. (The plugin cache is stale/divergent and is ignored.) One piece of
0.43 research that exists only in the cache — a `version-compatibility.md` version table —
is transcribed into this spec's §6 and re-authored fresh, since the git-source `form-edit`
has no versioning knowledge at all.

## 4. Scope

**Copy + adapt into `plugins/shesha-developer-0-43/skills/`:**
`shesha-claude-designer`, `shesha-form-edit`, `shesha-design-system`,
`shesha-design-comprehension`, `clean-form-config`.

**Copy + adapt into `plugins/shesha-developer-0-43/agents/`** (the pipeline dispatches
these; the 0-43 plugin has no `agents/` dir yet):
`form-author`, `form-auditor`, `fleet-transformer`, `fullstack-prereq-checker`.

**Out of scope:** any change to the 0.45 `shesha-developer` plugin; new features;
re-styling the pipeline's own docs.

The adaptation is grounded in an 8-agent audit of the source tree (178 findings). ~70–75%
of the pipeline is version-agnostic and copies verbatim; the changes cluster into six
categories below.

## 5. The version lifecycle (the crux)

Confirmed against the live 0.43 backend (`:21021` swagger). Status enum:
`1=Draft, 2=Ready, 3=Live, 4=Cancelled, 5=Retired`. Endpoints on
`.../Shesha/FormConfiguration/`:

- `GetByName` — resolves latest/Live; optional `version` query param.
- `GetAll` + filter `IsLast==true` — latest version per Origin; used to find an in-flight Draft/Ready.
- `CreateNewVersion` — `POST {id}` → clones to a new **Draft** (`VersionNo+1`, same `Origin`), returns the new id.
- `UpdateStatus` — `PUT {filter, status}` → validates `Draft→Ready→Live` and **auto-retires** the previous Live.
- `CancelVersion` — abandons a Draft.
- `UpdateMarkup` / `ImportJson` — write markup to a **specific version id**.

**Algorithm the 0.43 push step must follow:**

```
RESOLVE: GetByName (or GetAll+IsLast==true) → id, versionNo, versionStatus, Origin
BRANCH on versionStatus:
  brand-new (fresh Create):  Create → UpdateMarkup(initial Draft) → UpdateStatus 1→2→3 → clear cache
  Live (3):                  CreateNewVersion{id} → capture NEW DRAFT id
                             → UpdateMarkup on the NEW DRAFT id  (never the Live id)
                             → verify/fix loop edits THIS SAME draft (no second CreateNewVersion)
                             → once gates pass: UpdateStatus 1→2→3 (auto-retires old Live) → clear cache
  Draft(1)/Ready(2) in flight: REUSE newest non-Live version (UpdateMarkup on it); publish when gates pass
  Retired(5)/Cancelled(4):   NEVER edit — resolve to latest non-terminal version first
```

**Invariants:** (1) *reuse-draft* — `CreateNewVersion` at most once per edit session; every
re-push targets the same Draft; publish once. (2) *never-terminal* — never write Retired/Cancelled.
**Failure recovery:** if `UpdateStatus` fails after a good `UpdateMarkup`, offer "retry
UpdateStatus" (never re-`CreateNewVersion`); on abort optionally `CancelVersion` the orphan.
**Verification:** after publish, by-name-latest must be `versionStatus==3` with the new
`versionNo` and the old Live must be Retired(5); verify against the published id, not the pre-edit id.

This is **net-new content** authored as `references/version-lifecycle.md` in the 0-43
`shesha-form-edit`, referenced from Step 7, `api.md`, `verification.md`, and reused by
`clean-form-config`'s push step. The lifecycle rewrites touch: form-edit `SKILL.md`
(Steps 3/7/8 + failure recovery), `api.md`, `verification.md` (§1/§6), `backend-restart.md`,
`orchestration.md` (fleet), `debug.md`, `examples.md`, `bulk-operations.md`;
clean-form-config `api.md` §5; and lifecycle-aware caveats in the orchestrator
(`claude-designer` SKILL/handoff-contract, `design-comprehension` verification-loop).

## 6. Component versions & the data wrapper

**Data wrapper:** 0.45 `dataContext` (v8) → 0.43 **`datatableContext` (v7)** — same props,
different type name. A 0.45 `dataContext` on 0.43 renders an empty data area. This is a
**deterministic type-name rename** across prose, assets, the clean-form-config index/props
map, and the L5 layout check. **Trap:** two block files (`rail-panel`,
`requirement-datalist-row`) already carry `dataContext` **at v7** — rename the type, keep v7;
a blind "v8→v7" flip misses them.

**Version integers — probe-primary (decision, see §8).** Confirmed 0.43 values (live probe):

| type | 0.43 | type | 0.43 | type | 0.43 |
|---|---|---|---|---|---|
| container | 6 | dateField | 5 | datatable.pager | 3 |
| columns | 2 | autocomplete | 6 | datatable.quickSearch | 2 |
| text | 2 | checkbox | 4 | button | 7 |
| textField | 5 | refListStatus | 4 | buttonGroup | 10 |
| textArea | 4 | datatable | 10–11 | collapsiblePanel | 8 |
| numberField | 4 | datalist | 7–8 | dropdown | 7 |
| datatableContext | 7 | alert | 2 | tableViewSelector | 2 |

*Inversions:* `numberField`, `refListStatus`, `collapsiblePanel` are **higher** on 0.43.
*Probe-resolve (no confirmed value):* `checkboxGroup`, `card`, `progress`, `sectionSeparator`,
`tabs`, `switch`, `notes`, `link`, `image`, `subForm`, `validationErrors`, `KeyInformationBar`.

The seed corpus is internally inconsistent (numberField appears as both @3 and @5,
refListStatus universally @6, autocomplete @8 and @12 in one file), so a static value
find-replace is unsafe. The 0-43 skill instead **probes the live backend once per session**
(`FormConfiguration/GetAll`, max-per-type) and **re-stamps** every authored component's
`version` from that census; the table above is a documented fallback. The broken
placeholder probe in `component-cheatsheet.md` is rewritten into a working walker and
elevated to the primary step. Shipped seed assets are re-stamped to the confirmed 0.43
values as a sane baseline (via a probe-driven re-stamp script run against the live 0.43
backend), and every `0.45.x` provenance string is re-stamped to `0.43.x`.

## 7. Remaining categories

- **Cross-plugin references (52, mechanical):** every literal `shesha-developer:` →
  `shesha-developer-0-43:` in `Skill(...)` calls, agent dispatches, prose and tables. **Do
  not** re-namespace `frontend-design`, `playwright`, `superpowers:*`, `shesha-utils:*`, or
  relative sibling-file paths (all five skills + four agents ship together).
- **Configuration Studio → 0.43:** replace `/configuration-studio` references with the
  legacy form designer / `/settings` pages / direct REST. Files: design-system
  `app-theme.md` + `shesha.tokens.json`, claude-designer `README.md`, form-edit
  `data-tables.md` / `navigation-menu.md` / `api.md` §9 / SKILL Step 8.5. Keep the
  version-agnostic settings-API path (`sha-frontend-application: default-app`, value as object).
- **`dataLoaderType: "none"` on page forms:** 0.43 create/edit **page** forms need it or
  they hang on a spinner. Files: form-edit SKILL Step 4.5 + non-negotiable, `form-shape.md`.
- **Broader cache clearing:** after create+publish, clear `forms/entities/ref-lists/misc`
  IndexedDB (not just `form`/`form_lookup`) from `/favicon.ico`. Files: `verification.md` §2,
  SKILL 8.5, `debug.md`, design-comprehension `verification-loop.md`.
- **buttonGroup v10 overflow-collapse:** add a "verify inline render, adjust width" guard
  wherever buttonGroup is authored/flipped.

## 8. Decisions

1. **Version integers: probe-primary + baseline re-stamp (recommended).** Make the runtime
   version-probe the authoritative source; ship seeds re-stamped to confirmed 0.43 values;
   treat the table as fallback. Rationale: a static flip is provably unsafe (inconsistent
   corpus, ~12 types with no known 0.43 value) and wrong versions fail silently; the probe
   is future-proof across BoxStack point releases. *Alternative rejected:* pure static flip.
2. **Also copy the four agents** into the 0-43 plugin and re-namespace their refs, so the
   pipeline is self-contained and never dispatches a 0.45 agent.
3. **Copy from the git working tree** (§3), not the cache.

## 9. Implementation order

1. Scaffold: copy all 5 skills + 4 agents verbatim into `shesha-developer-0-43`; set plugin
   manifest.
2. Mechanical cross-plugin ref rewrite (52) across all copies (scriptable + verified).
3. Author `version-lifecycle.md`; wire form-edit Steps 3/7/8, `api.md`, `verification.md`,
   and clean-form-config §5 to it; add lifecycle caveats to the orchestrator.
4. Data-wrapper rename `dataContext`→`datatableContext` (mind the two v7-block traps and
   property-name false positives); update clean-form-config index/props/L5.
5. Rewrite the version-probe into a working walker; re-stamp seed assets from a live 0.43
   probe; update cheatsheet/capability-matrix tables + provenance.
6. Configuration-Studio, dataLoaderType, cache-clearing, buttonGroup prose edits.
7. Verify (see §10).

## 10. Verification

- **Static:** no `shesha-developer:` refs remain (only `shesha-developer-0-43:` and the
  allowed foreign plugins); no `"type": "dataContext"` remains in any 0-43 asset; every 0-43
  asset `datatableContext` is v7; all relative sibling refs resolve; `node --check` on scripts.
- **Live (against the running 0.43 `AssetManagement` backend):** version-probe returns a
  sane census; an edit-existing-Live-form run produces a new Draft, publishes to Live, and
  the previous version becomes Retired; a browser smoke of a built table renders data (proving
  the `datatableContext` wrapper).
- **Fresh eyes:** spec/self-review already applied; final adversarial audit of the adapted
  form-edit + a diff review before commit.
