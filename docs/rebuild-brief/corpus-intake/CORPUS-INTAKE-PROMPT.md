# Follow-up prompt - DB corpus intake at Phase 2

> Send this **only when the running session reports `SESSION COMPLETE - SCOPE A` and is entering Phase 2.**
> Do not send it during Phase 1: `g-corpus-immutable` holds a SHA-256 manifest and hard-fails on any
> corpus change, so an intake mid-flight either trips the gate or forces a gate edit, which is S7 territory.

---

Two SQL Server databases on `localhost,1433` hold real Shesha form configurations, already upgraded to 0.45:

- `RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade` - **primary**. This is the backend the capability matrix was measured against (`measuredAt.backend: "RequirementsStudio :21021"`), so its forms are the closest thing we have to ground truth for 0.45.
- `385xbw-new-20260817-090916-fixed` - **secondary**, unknown provenance. Extract and tag separately; never mix provenance inside one corpus directory.

An extractor and a census tool are staged at `docs/rebuild-brief/corpus-intake/`, both Node, both tested (`npm test` runs 20 tests against a mock database). Take this on as a work package inside Scope B, ahead of BL-002, because BL-002's value depends on it.

## Step 1 - Extend scope through the mechanism

Add a `DECISIONS.md` row beginning `Scope change: extend Scope B with WP-2c corpus intake - BL-013`, add `WP-2c` to `session-scope.json`, update CONTROL §3's table, and add the budget in the same commit (+200 steps / +0.4 M tokens). Do not begin extraction before that commit lands.

## Step 2 - Extract, discovery-first

**First make node resolvable.** It is managed by `fnm` and is not on the system
PATH (`BLOCKED.md` B13); a bare `node` or `npm` fails with
`The term 'node' is not recognized`.

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression ; fnm use 22 ; node --version
cd docs/rebuild-brief/corpus-intake
npm install && npm test          # 20 tests, no database required
```


```powershell
cd docs/rebuild-brief/corpus-intake
# Inspect the generated SQL before trusting it - the script assumes no table names.
./Export-SheshaForms.ps1 -Database 'RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade' `
    -SourceTag 'requirements-studio-045' -WhatIfDiscoveryOnly
./Export-SheshaForms.ps1 -Database 'RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade' `
    -SourceTag 'requirements-studio-045'
./Export-SheshaForms.ps1 -Database '385xbw-new-20260817-090916-fixed' -SourceTag '385xbw'
```

It reads only the discovered configuration-item tables - never a data table - because a production backup may hold client records and form configs are metadata. If discovery picks the wrong table, fix the discovery query rather than hardcoding a name: a hardcoded table name is a machine-local assumption, and `g-registry-provenance` already bans that class of thing.

Record in `BUILD-LOG.md`, from `manifest.json`, not from recall: `formCount`, `skippedCount`, `envelopeFieldsPresent` count, and `provenance`.

## Step 3 - The census is the baseline, and it runs before the compiler touches anything

```bash
node docs/rebuild-brief/corpus-intake/defect-census.mjs \
  <intake>/requirements-studio-045 --json packages/verify/reports/defect-census-baseline.json
```

Commit that report. It is a pure function of the JSON - no compiler, no registry, no backend - and it is validated: run against `docs/rebuild-brief/artifacts/bookings-table.revision2.json` it reports exactly the eight classes, 19,170 markup bytes, 43.9% breakpoint share, 6 byte-identical desktop/tablet blocks and 7 real leaf differences. Those figures are its self-test; if it disagrees with them, the tool is wrong, not the golden.

**This baseline is what the compiler must beat.** Re-run the census over `compile(decompile(f))` output at the end of WP-2c and commit both. Defect instances must fall to **zero** for every class the normaliser claims to own. A class the normaliser owns that still appears post-compile is a compiler defect, not a corpus defect.

## Step 4 - Land it as a corpus, honestly

- Copy readable forms to `packages/sfs/corpus/db/<sourceTag>/`, leaving `packages/sfs/corpus/` originals untouched - `g-corpus-immutable` covers both trees after this commit.
- Regenerate the corpus SHA-256 manifest and commit it in the same commit as the files. A manifest regenerated in a later commit is indistinguishable from a tampered one.
- **Provenance drives disposition.** Forms whose `manifest.json` shows `envelopeFieldsPresent = 23` are complete envelopes; forms below 23 keep `provenance: db-export-partial-envelope` and T1's `file` family disposes their absent fields `uninspectable`, with a `BLOCKED.md` row naming the missing columns. Absent is never empty.
- **BL-006 may now be liftable.** It exists because every on-disk seed is a bare `{components, formSettings}` with no envelope, which forced synthesis and a permanently-`uninspectable` `file` family. If - and only if - at least ten forms come through with all 23 fields, lift BL-006: point T1's envelope checks at real envelopes, add the fixtures, and record the lift as a `DECISIONS.md` row. If fewer than ten qualify, leave BL-006 open and say so. Do not lift it on the strength of one form.

## Step 5 - Extend the round-trip scope, and keep the threshold

Add every readable extracted form to `roundtrip-scope.json`. **Keep the gate at >=0.90 and do not lower it** - that constant is load-bearing (§6 Phase 2).

Be clear-eyed about what this does: today the gate spans 6 forms, so it tolerates exactly one failure and proves almost nothing. Across ~45 real forms it becomes a genuine falsification test of whether SFS can express the estate. **It may fail, and if it does that is stop condition S5 working as designed, not a setback.** In that case write `FINDINGS.md` with the `promote-to-sfs` list sorted by the number of forms needing each construct - with 45 forms that ordering is a prioritised IR roadmap, which is the single most valuable artifact this intake can produce. Do not chase byte-equality with any original form: they carry the defects the census just counted, and equality with them would enshrine them.

Emit a per-form structural-escape count either way, so a red result is diagnostic rather than merely red.

## Step 6 - Report

Print, all from committed files rather than from memory: forms extracted per source; envelope completeness distribution; the census baseline table; whether BL-006 was lifted and on what evidence; round-trip rate over the extended scope with the per-form escape counts; the top ten `promote-to-sfs` constructs by form count; and every `BLOCKED.md` row opened.

Then continue Phase 2 at BL-002, whose scope this work package has just replaced.
