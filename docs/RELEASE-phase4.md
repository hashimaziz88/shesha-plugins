# Shesha designer overhaul — release notes for testing

**Branch:** `plugins-rework` on `origin` (the `hashimaziz88/shesha-plugins` fork)
**Written:** 2026-07-29, at the end of an unattended run covering Phases 1–4.

Read this if you have not followed the work. It says what changed, what to test, what "good" looks like, and — at the end — every known limitation, including the ones that are easy to trip over.

> ## State of this run — verified
>
> **Phases 1–4 are complete, tested, merged and pushed.** 457 tests green across six suites, and the evals harness exits 0.
>
> | Suite | Tests |
> |---|---|
> | `plugins/shesha-developer/tests` (skill-description guard) | 7 |
> | `plugins/shesha-developer/evals` | 16 |
> | `plugins/shesha-developer/hooks` | 33 |
> | `skills/shesha-form-edit` | 293 |
> | `skills/shesha-design-system` | 24 |
> | `skills/shesha-design-comprehension` | 84 |
> | **Total** | **457** |
>
> Re-verify any time with one command from the worktree root:
>
> ```bash
> for d in plugins/shesha-developer/tests plugins/shesha-developer/evals plugins/shesha-developer/hooks plugins/shesha-developer/skills/shesha-form-edit plugins/shesha-developer/skills/shesha-design-system plugins/shesha-developer/skills/shesha-design-comprehension; do echo "== $d"; (cd "$d" && npm test) || break; done && (cd plugins/shesha-developer/evals && node run-evals.mjs --runs 3)
> ```
>
> An Anthropic-side outage (API 529s plus a safety-classifier outage) interrupted the run near the end and blocked all shell access for a stretch. It cost two subagents mid-task and left the Phase 4 files written but unverified overnight; they have since been run, two real bugs in them fixed, and everything committed. The one item it genuinely stopped is the harness classifier — see its section below.
>
> Nothing in the `saa-testmanager` repo was touched.

## Contents
- [What the problem was](#what-the-problem-was)
- [What now exists](#what-now-exists)
- [How to test it](#how-to-test-it)
- [What good looks like](#what-good-looks-like)
- [Known limitations](#known-limitations)
- [Things I got wrong, corrected](#things-i-got-wrong-corrected)
- [What is not done](#what-is-not-done)

---

## What the problem was

Backend skills in this plugin produced reliable output; the form/design skills produced inconsistent, non-production-quality layouts run to run. The diagnosis, from three independent evidence sources rather than intuition:

**Telemetry** (ClaudeLog, 8,000 events, 345 sessions, $282 over six days). Across the 10 sessions that invoked `shesha-claude-designer`: `shesha-design-comprehension` ran **0 times**, no blueprint was produced, no layout probe ran, and `Metadata/GetProperties` was called **0 times** despite being documented as mandatory. 32 render-crash signatures in two days. `clean-form-config` was invoked from two different plugins, so which version ran was nondeterministic.

**A corpus census** of 100 real production forms (3,068 components). Production forms did not follow the rules the skills stated: `validationErrors` present in 47/100, a loose `button` in 35/100, 164 versionless components, `columns` in 22/100, and `customStyle` — discussed in seven places across the docs — appearing **0 times**.

**An audit** of the four skills. ~250 normative rules across 430 lines, 14 outright contradictions, and a single design run loading 110k–145k tokens of instruction before touching any data. `columns` was banned in 21 places, mandated in 6, and present in 12 spots across 6 seeds including `standalone-create.json` — the default seed for the commonest request.

The conclusion: the backend skills work because the C# compiler and CRUD tests are **external oracles**, so their prose only has to be approximately right. The design skills had no oracle, so their prose had to be exactly right — and it was contradictory.

---

## What now exists

| Layer | What it does |
|---|---|
| **Registry** | 116 components generated from framework source (`releases/0.45` @ `d16734774`), replacing a hand-maintained index that had 65 types, one type that does not exist (`addressInput`), and ~15 props for `container` against a real 99 |
| **Role catalogue** | 15 style roles, each a *complete* style block across all three breakpoints, values as token references only — zero literal hexes |
| **Flow manifests** | 8 archetypes, each declaring the complete node set a working flow requires, so nothing is left for the model to infer |
| **Validator** | 12 Tier 1 renderability + 25 Tier 2 contract checks with real exit codes; Tier 3 scores and never blocks |
| **Normalizer** | Expands a role into the full style block and repairs 13 defect classes mechanically. Idempotent across 100 real forms |
| **Compiler** | Blueprint → markup. The model authors a typed blueprint; the compiler emits everything mechanical |
| **Placement gate** | 5 typed predicates evaluated against a DOM probe, with an exit code — not a model grading itself |
| **Push hook** | Normalize → validate → deny, on a curated evidence-selected code set |
| **Evals** | 10 cases whose assertions are the validator's own verdict, reporting pass rate and stddev |

### The headline number

The real broken `flight-details` form — one of the forms whose screenshots started this work — scores **114** Tier 1+Tier 2 findings. The same form compiled from a blueprint scores **0**.

---

## How to test it

All commands are run from the repo root unless stated. Node 25.

**1. The test suites.** Each skill has its own runner:

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && npm test
```

Repeat for `shesha-design-system`, `shesha-design-comprehension`, and `plugins/shesha-developer/hooks`.

**2. Compile an archetype and validate it.** This is the core loop:

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && node scripts/compile-spec.mjs ../shesha-design-comprehension/assets/blueprint-examples/table-worklist.blueprint.json --out /tmp/out.json
```

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && node scripts/validate-form.mjs /tmp/out.json --archetype table-worklist
```

**3. Validate one of your own existing forms.** This is the most interesting test, because it tells you what the validator thinks of real work:

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && node scripts/validate-form.mjs <path-to-a-form.json>
```

**4. Run the evals:**

```bash
cd plugins/shesha-developer/evals && node run-evals.mjs --runs 3
```

**5. Regenerate the registry** (only if you bump the framework version — takes ~90 seconds):

```bash
cd plugins/shesha-developer/skills/shesha-form-edit && node scripts/gen-registry.mjs --framework "C:/Users/Hashim/Documents/Git Repos/shesha-framework" --version 0.45.1
```

---

## What good looks like

- Every suite green, zero failures.
- All 8 archetypes compile to **zero Tier 1 and zero Tier 2** findings, Tier 3 at 85.
- Compiling the same blueprint twice is **byte-identical**.
- `compile` followed by `normalize` is a **no-op** — the compiler and normalizer agree.
- The evals harness exits 0, **and the one deliberately-broken case fails**. A harness that passes everything is measuring nothing.
- Validating one of your own real forms produces findings. That is expected and correct — see the limitation below about corpus hit rates.

---

## Known limitations

Read this section before concluding something is broken.

**The push gate is curated, not blanket — deliberately.** `T1-PROP-UNKNOWN` fires on **89%** of 935 real production forms, and before remediation the plugin's own bundled seeds tripped Tier 1/2 at 100%. A blanket gate would have blocked all legitimate work on day one. Group A blocks 14 high-confidence codes including all four render-crash causes; Group B blocks only what survives normalization; Group C reports without blocking. The policy is data, in `hooks/gate-policy.json` — change what blocks without touching code.

**`tab()` placement verification needs every tab activated once first.** Ant Design does not mount a tab pane until it has been activated, so a pane never clicked is not in the DOM at all and the probe cannot see it. Click through every tab before the final probe.

**The compiler owns *authoring*, not *editing*.** Building a form from a blueprint is `compile-spec.mjs`. Editing an existing live form still uses the GET → edit → PUT round-trip in `shesha-form-edit`. Do not expect the compiler to modify a form in place.

**The evals harness measures tooling variance, not model variance.** Compilation is deterministic, so stddev over identical inputs is 0. That is correct and it establishes an objective floor — but do not read a 0 stddev as evidence the model is consistent. Measuring that needs a real agent driven per run, which this harness deliberately does not do.

**`T2-SLOT-STYLE-MISMATCH` is proven on two forms, not at scale.** It measures 0% on both the 935-form corpus and the seeds. It is real — it is the check for the defect that produced the literal `StatusFlight status` text on screen — but it has not been corpus-validated.

**The `requirements-studio` brand is incomplete.** It is missing ~198 of the default theme's keys, so resolving the role catalogue against it *throws* on `$chrome.detailRailWidth` and `$chrome.formColMax`. That is deliberately loud rather than silently wrong, but it means that brand is unusable with the catalogue until its token file is completed.

**One live check remains unrun.** `tab()` was verified against a DOM mock built from the real rc-tabs source, not against a running Shesha form — the portal was unreachable during the unattended run. Worth a smoke test.

---

## Things I got wrong, corrected

Recorded because they are the clearest argument for having an oracle at all. Each of these was in the skills as an authoritative rule, and each was false:

- **"Component ids must be UUIDs."** The framework mints **nanoid**. This check fired on 95.6% of real forms before being corrected. The rule had been in `SKILL.md` all along.
- **"`modelType` must be the `{name, module}` object."** The string form is valid at runtime. 99.3% false-positive rate.
- **"`dataContext` requires `uniqueStateId`."** That prop never existed on `dataContext`.
- **A header `text` carries `fontSize`/`fontWeight`.** The registry says `font.size`/`font.weight`; the flat spelling does not exist, so the check flagged correctly-authored forms.
- **The prop-count expectations in my own plan** conflated raw extraction (71 for `container`) with the post-filter registry (63). An implementer refused to hit them rather than fabricate props, which was the right call.

Three further workarounds were caught and removed rather than shipped: the compiler self-stamping fake `overrides[]` provenance to satisfy a colour check, aliasing a component type that does not exist, and synthesising a placeholder `modelType` for forms that legitimately have no entity. All three were the same anti-pattern — bending output to satisfy a check that is wrong — and all three were fixed at the real fault site instead.

---

## The harness classifier — diagnosed, deliberately not applied

Phase 4 was meant to fix the SAA harness classifying **13 of 15** design test cases as `unknown`, so the eval that should catch design defects cannot grade them. I diagnosed it but did **not** change it, because an infrastructure outage left me unable to run that repository's Python test suite, and an unverified change to a grading harness silently corrupts evaluation results — worse than a known `unknown`.

The diagnosis, for you to apply and test. In `saa-testmanager/harness/saa_harness/form_classifier.py`:

**Cause 1 — it matches a component vocabulary the framework has moved on from.** Line 181 keys table detection on `datatableContext`:

```python
elif ctype == "datatableContext":
    signals.has_datatable_context = True
```

The generated registry marks `datatableContext` as `isHidden` / "Data Context (Legacy)". Current forms use **`dataContext`** — 115 occurrences against 9 in the corpus census. So `_is_table_view` never fires for a modern table form. Line 184 has the same shape for dashboards, keying on `KeyInformationBar`, which the plugin's own docs deprecate in favour of a flex row of cells.

**Cause 2 — the declared-type override was designed but never built.** The module docstring already says: *"Test authors can override via `TestCase.FormType` once that backend column lands (Phase 4)."* That override is the real fix for a design test case, which has no markup to classify at the point the rubric is chosen.

Both fixes are additive and safe by construction — a defaulted parameter and an extra accepted type — so neither changes behaviour for existing callers:

```python
def classify_form(form_config: dict, declared_type: str | None = None) -> FormType:
    if declared_type:
        try:
            return FormType(declared_type)
        except ValueError:
            pass  # fall through to inference; a bad declared value must not crash grading
    ...

# and, in _walk:
elif ctype in ("dataContext", "datatableContext"):
    signals.has_datatable_context = True
```

Run `pytest` in `harness/` before and after.

## What is not done

- **Widening the push gate.** Needs `T1-PROP-UNKNOWN` resolved; its residual is genuinely-invalid corpus data plus a class that runtime-replay cannot recover.
- **Bulk remediation of the 233 existing production forms.** `docs/corpus-report.md` ranks them; fixing them is separate, pilot-first work.
- **Visual-regression gating.** Valuable but needs deterministic rendering — seeded data, fixed dates, no animation.
- **The `copilot-toolkit` folder.** Assessed as ~85% duplication of what Claude plugins already do; the one additive idea needs `.claude/rules/`, which a plugin cannot ship.
