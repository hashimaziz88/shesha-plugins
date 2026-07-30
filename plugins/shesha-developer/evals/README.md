# Evals

An objective regression harness for the blueprint → compile → validate pipeline.

## Contents
- Why this exists
- What it measures, and what it does not
- Running it
- Adding a case
- Reading the output

## Why this exists

Before this harness there were **zero** `evals/` directories in the plugin, so every change across three phases was unfalsifiable — including several that turned out to be wrong. Rules that had sat in `SKILL.md` as authoritative and were false: that component ids must be UUIDs (the framework mints nanoid; the check fired on 95.6% of real forms), that `modelType` must be an object (the string form works at runtime; 99.3% false-positive rate), that `dataContext` requires `uniqueStateId` (that prop never existed), and that a header `text` carries flat `fontSize`/`fontWeight` (the registry says `font.size`/`font.weight`).

Each was caught by measurement, not by review. This harness is how the next one gets caught.

## What it measures, and what it does not

**An eval case's assertion is the validator's own verdict, never a model's opinion.** A case supplies a blueprint; the harness compiles it with `compileSpec()` and grades it with the same `tier1`/`tier2`/`tier3` functions the `validate-form.mjs` CLI calls. A case passes when there are **zero Tier 1 and zero Tier 2 findings** and the Tier 3 score is at or above the case's own threshold. Mechanical and reproducible by construction.

**It measures tooling variance. It does not measure model variance.**

`compileSpec()` is a pure function of its blueprint, so compiling the same blueprint N times is byte-identical and the reported stddev over identical runs is **0**. That number is correct and expected — and it is *not* evidence that a real agent is consistent. It only proves the deterministic chain downstream of a fixed blueprint has no variance of its own.

Measuring model variance would mean driving a real agent per run and grading N independently-authored blueprints. This harness deliberately does not do that. What it gives you is the objective floor: given a fixed blueprint, does the tooling reproduce a clean, scored build every single time.

Read a 0 stddev as "the compiler is deterministic", never as "the model is consistent".

## Running it

```bash
cd plugins/shesha-developer/evals && node run-evals.mjs --runs 3
```

One case only:

```bash
cd plugins/shesha-developer/evals && node run-evals.mjs --case archetype-table-worklist
```

Machine-readable, for CI:

```bash
cd plugins/shesha-developer/evals && node run-evals.mjs --runs 3 --json
```

The harness's own unit tests:

```bash
cd plugins/shesha-developer/evals && npm test
```

Exit code is **0** when every case met its threshold on every run, **1** otherwise.

## Adding a case

Create `cases/<id>.json` and add its path to the `cases` array in `evals.json`:

```jsonc
{
  "id": "archetype-table-worklist",
  "description": "The table-worklist archetype compiles clean.",
  "archetype": "table-worklist",
  "blueprint": "../skills/shesha-design-comprehension/assets/blueprint-examples/table-worklist.blueprint.json",
  "threshold": 80
}
```

`blueprint` is resolved relative to this directory, never the caller's cwd. If `archetype` is set and the blueprint declares a different one, the case fails loudly rather than silently picking one — a stale case is a bug worth surfacing.

**Keep at least one case that must fail.** `broken-dropdown-missing-source` exists so that a harness which passes everything is detectably wrong. If you ever find every case green including that one, the harness is broken, not the code.

## Reading the output

```
[PASS] archetype-table-worklist — passRate 100% — score 85.0 (stddev 0.00) — threshold 80
[FAIL] broken-dropdown-missing-source — passRate 0% — score 71.0 (stddev 0.00) — threshold 80
    run 1: Tier1 0 finding(s), Tier2 1 finding(s), Tier3 score 71 (threshold 80)
      [T2-DROPDOWN-SOURCE] components[0]... — dropdown "status" declares no dataSourceType
```

A failing case prints every Tier 1 and Tier 2 finding with its path and message, because those messages are written to be actionable on their own — the same text the push hook feeds back when it denies a push.

The summary reports cases passed, overall pass rate, and **mean stddev across cases**. That last figure is the one to watch over time: the project's founding complaint was that the same prompt produced materially different output run to run, so variance is the metric of record.
