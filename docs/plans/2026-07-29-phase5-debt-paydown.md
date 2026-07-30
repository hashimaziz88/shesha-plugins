# Phase 5: Debt Paydown — Registry Cutover, Boundary Repair, De-duplication

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Retire the artifacts the first four phases superseded but left standing, and make three claims true that are currently false.

**Architecture:** No new machinery. This phase deletes, moves and de-duplicates — every change is traceable to something that now has a single authoritative owner. The registry supersedes the hand-maintained component index; the compiler supersedes hand-authoring; `theme-tokens.mjs` supersedes per-check colour logic; one `clean-form-config` supersedes two.

**Tech Stack:** Node 25, `node --test`, zero dependencies.

## Global Constraints

- Test baseline that must not regress: `tests` **7** · `evals` **16** · `hooks` **33** · `shesha-form-edit` **293** · `shesha-design-system` **24** · `shesha-design-comprehension` **84** = **457**. Plus `node run-evals.mjs --runs 3` exits 0.
- Framework pinned to 0.45.1; never regenerate `assets/registry/registry-0.45.1.json`.
- Never emit a `columns` component; never put a proportional width on an input leaf.
- Forward slashes only in paths written into files. Zero new dependencies.
- Do not modify the framework repo at `C:/Users/Hashim/Documents/Git Repos/shesha-framework`.
- **All `saa-testmanager` work is deferred out of this phase** by explicit instruction.
- Do not commit corpus data. Leave the untracked `shesha-design-system/assets/themes/skyline.tokens.json` and the modified root `.gitignore` alone.
- Plugin version bump per `CLAUDE.md`; currently `1.8.28`.

## The debt, and why each item is real

| # | Debt | Evidence it matters |
|---|---|---|
| 1 | `assets/groups/*.json` still shipped and still referenced, though the generated registry supersedes it | The hand index has 65 of 116 types, a phantom (`addressInput`), and ~15 props for `container` against a real 99. `clean-form-config` carries its **own** copy — 7,255 lines, ~54k tokens — and loads it on **every push** |
| 2 | `clean-form-config` exists in **two** plugins (`shesha-developer` and `shesha-utils`) | Telemetry shows both invoked in one window, so which version ran was nondeterministic |
| 3 | `assets/block-styles/*.style.json` carry **43 literal hexes against 10 token references** | The README's headline claim — "brand lives entirely in one token file", "to theme a new app you write zero code" — is therefore false. Swapping brands changes ~10 of ~53 colour decisions |
| 4 | Ownership boundaries leak in both directions | `form-edit` ships 24 hexes and v7 style blocks (`components/containers.md`, `components/detail-page-pattern.md`, `references/form-quality.md:186-190`) plus `references/design.md`, a **fourth** styling authority. `design-system` ships re-parenting and CRUD-wiring instructions (`component-recipes.md`, `style-channels.md`) |
| 5 | Three archetype vocabularies still coexist | `references/archetypes.md` defines 8; `assets/blocks/*.block.json` use `$archetype` values `fragment` and `list`, which are not archetypes |
| 6 | `requirements-studio.tokens.json` is missing ~198 of the default's keys | Resolving the role catalogue against it **throws** on `$chrome.detailRailWidth` and `$chrome.formColMax`, so the one shipped custom brand is unusable |
| 7 | `form-author` agent drafts form markup | The compiler now owns authoring. Two agents with overlapping remits is the same nondeterminism as item 2 |

---

### Task 1: Registry cutover — delete the hand index

**Files:** Delete `shesha-form-edit/assets/groups/*.json`; modify the 4 surviving references (`references/components/form-shape.md:68`, `:103`, `references/components/scripts.md:17`, `SKILL.md:216`); handle `clean-form-config/assets/groups/*.json` and its SKILL.md Step 1.

The registry is the authority and has been since Phase 1. Two indexes means two answers.

- [ ] **Step 1** Grep every reference to `assets/groups` across the whole plugin and list them. Repoint each at `assets/registry/registry-0.45.1.json` and `references/component-registry.md`.
- [ ] **Step 2** `clean-form-config` is the harder half — it reads its own copy on every push. Repoint it at the shared registry. If it cannot reach across skills, say so and state the options rather than duplicating the registry.
- [ ] **Step 3** Delete both `assets/groups/` trees.
- [ ] **Step 4** Add a test asserting no file under `plugins/` references `assets/groups` — this is a one-way door and should stay shut.
- [ ] **Step 5** Run all six suites. Commit.

---

### Task 2: One `clean-form-config`

**Files:** `plugins/shesha-developer/skills/clean-form-config/`, `plugins/shesha-utils/skills/clean-form-config/`

Two copies, both live, both invoked in the same telemetry window.

- [ ] **Step 1** Diff them. Report what actually differs — if they have diverged, which behaviours exist in only one copy matters more than the line count.
- [ ] **Step 2** Keep the `shesha-developer` copy (it is the one the design pipeline references) and retire the `shesha-utils` one, leaving a one-line pointer so an existing `/clean-form-config` invocation still lands somewhere sensible.
- [ ] **Step 3** Grep for references to the retired path and fix them.
- [ ] **Step 4** Commit.

---

### Task 3: Token-ise the block-style overlays

**Files:** `shesha-design-system/assets/block-styles/*.style.json`, and the README claim that depends on them

43 literal hexes against 10 `$role:` references. Worst offenders: `rail-panel` 11 hexes / 1 role, `dashed-add-button` 7 / 0, `requirement-datalist-row` 8 / 3.

- [ ] **Step 1** For each literal hex, find the token whose value it equals — `theme-tokens.mjs`'s `collectThemeTokenColors` already flattens the theme, so this is mechanical, not a judgement call. Replace with the `$role:`/`$palette.` reference.
- [ ] **Step 2** Any hex matching **no** token is a finding: either the theme is missing a token or the overlay invented a colour. Report which, per hex. Do not invent a token to make a hex go away.
- [ ] **Step 3** Add a test asserting zero literal hexes in `assets/block-styles/**` — the same guard `roles.styles.json` already has.
- [ ] **Step 4** Re-verify the README's "brand lives entirely in one token file" claim. If it is now true, leave it; if hexes survive for a stated reason, amend the claim to match reality.
- [ ] **Step 5** Commit.

---

### Task 4: Boundary repair

**Files:** `shesha-form-edit/references/{components/containers.md, components/detail-page-pattern.md, form-quality.md, design.md}`; `shesha-design-system/references/{component-recipes.md, style-channels.md}`

The three-way split (structure / layout / style) is asserted in five separate role tables. The volume of restatement is the tell that it is not real.

- [ ] **Step 1** Move every hex and v7 style block out of `form-edit`'s references into `design-system`, leaving a pointer.
- [ ] **Step 2** Move `references/design.md` — an entire aesthetic-critique workflow wired to `frontend-design` — into `design-system`. It is a fourth styling authority inside the structure skill.
- [ ] **Step 3** Move `design-system`'s structural instructions into `form-edit`: `component-recipes.md`'s re-parenting and `onAfterDataLoad` CRUD scripts, `style-channels.md`'s re-parenting note.
- [ ] **Step 4** Collapse the five role tables to one, in the orchestrator's README, and have the others point at it.
- [ ] **Step 5** Commit.

---

### Task 5: Reconcile the archetype vocabulary and retire `form-author`

**Files:** `shesha-form-edit/assets/blocks/*.block.json`, `references/archetypes.md`, `references/block-library.md`, `agents/form-author.md`

- [ ] **Step 1** The blocks' `$archetype` values (`fragment`, `list`) are not archetypes — they are block *kinds*. Rename the field to `$kind` and reserve `$archetype` for the eight, or map each block to a real archetype. Pick one and justify it.
- [ ] **Step 2** Add a test asserting every `$archetype` value in `assets/blocks/**` is one of the eight (or that the field no longer exists).
- [ ] **Step 3** `form-author` drafts markup, which `compile-spec.mjs` now owns. Narrow its description to the case it still serves (editing/drafting where no blueprint exists) or retire it with a pointer to `shesha-form-designer`. **Do not silently delete it** — an agent a user may be invoking gets a deprecation note.
- [ ] **Step 4** Commit.

---

### Task 6: The `requirements-studio` brand

**Files:** `shesha-design-system/assets/themes/requirements-studio.tokens.json`

Missing ~198 of the default's 290 keys, so the role catalogue throws against it. The throw is correct — loud beats silently wrong — but it means the brand does not work.

- [ ] **Step 1** Diff its key set against `shesha.tokens.json` and report exactly what is missing.
- [ ] **Step 2** Add the **structural/metric** keys (`chrome.*`, and any `roles.*` the overlays reference), deriving colours from RS's existing palette where a defensible mapping exists.
- [ ] **Step 3** Anything requiring a genuine brand decision — a colour with no analogue in the RS palette — is **reported, not invented**. A wrong brand colour shipped silently is worse than a missing key that throws.
- [ ] **Step 4** Add a test asserting every role in the catalogue resolves against **every** shipped brand, or that a brand's gaps are explicitly declared.
- [ ] **Step 5** Commit.

---

## Phase gate

- [ ] All six suites green at or above baseline; `run-evals.mjs` exits 0.
- [ ] Zero references to `assets/groups` anywhere under `plugins/`, guarded by a test.
- [ ] One `clean-form-config`.
- [ ] Zero literal hexes in `assets/block-styles/**`, guarded by a test.
- [ ] Every `$archetype` value in `assets/blocks/**` is one of the eight, or the field is gone — guarded by a test.
- [ ] Every catalogue role resolves against every shipped brand, or the gaps are declared.
- [ ] `form-author`'s remit no longer overlaps the compiler.
- [ ] No corpus data in the repo; framework repo clean.

## Explicitly out of scope

- All `saa-testmanager` / harness work — deferred by instruction until the plugin rework is finished.
- Widening the push gate — still needs `T1-PROP-UNKNOWN` resolved.
- Bulk remediation of the 233 existing production forms.
