# corpus-intake

Pull real Shesha form configurations out of SQL Server and measure them. Two Node
programs and a prompt.

This directory sits **outside** `packages/sfs/corpus/`, so nothing here is covered
by `g-corpus-immutable` until a corpus-intake work package copies forms into the
guarded tree. Staging and corpus are different things, and the hash gate should
only ever cover the latter.

| File | What it is |
|---|---|
| `export-shesha-forms.mjs` | Discovery-first extractor. Finds the form-configuration table instead of assuming its name, resolves as many of the 23 envelope fields as the schema actually has, writes one JSON envelope per form plus a provenance `manifest.json`. |
| `export-shesha-forms.test.mjs` | 20 tests. Runs the whole extract against a mock database with no SQL Server, using the real golden form as the row payload. |
| `defect-census.mjs` | Normalisation-defect census with baseline comparison. A pure function of the form JSON: no compiler, registry, backend or browser. |
| `CORPUS-INTAKE-PROMPT.md` | The follow-up prompt that lands an extract at Phase 2 through the `Scope change:` mechanism. |
| `Export-SheshaForms.ps1` | Superseded stub - it throws and points here. Delete it when convenient; the device bridge cannot remove files. |

## Why Node and not PowerShell

This repository already depends on Node 22, and the extract logic is
**unit-testable** there — `node --test` exercises discovery, query construction,
envelope building, version collapsing and the full extract against a mock, with
the real 19,170-byte golden form as the payload. A PowerShell version could not be
tested from the development environment, which is exactly how two parse failures
shipped.

Windows PowerShell 5.1 also imposed two problems Node does not have.
`ConvertTo-Json` is backed by `JavaScriptSerializer` and throws
*"the length of the string exceeds the value set on the maxJsonLength property"*
on large payloads — Shesha markup reaches ~700 KB. And a BOM-less UTF-8 `.ps1` is
read as ANSI, so a single em-dash inside a string corrupts parsing and cascades
into a dozen misleading errors.

## Before anything: make node resolvable

**A bare `node` or `npm` does not work in a fresh PowerShell on this machine.**
Node is managed by `fnm` and is not on the system PATH - this is recorded as
`BLOCKED.md` B13. Every command below fails with
`The term 'node' is not recognized` until you deal with it.

Two ways. Pick either.

```powershell
# A. One-shot, no shell changes. Most reliable.
fnm exec --using=22 -- node --version
fnm exec --using=22 -- npm install

# B. Activate fnm for this shell, then use node normally.
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm use 22
node --version        # expect v22.x
```

If `fnm` itself is not recognised, list what is installed with `fnm list` from a
shell where it does work, or add the fnm activation line to your PowerShell
profile so every new shell has node:

```powershell
notepad $PROFILE      # add: fnm env --use-on-cd | Out-String | Invoke-Expression
```

The rest of this README writes plain `node` and `npm` for readability. If you have
not activated fnm, prefix each with `fnm exec --using=22 --`.

## Setup

```powershell
cd docs/rebuild-brief/corpus-intake
fnm exec --using=22 -- npm install     # one dependency: mssql (pure JS, no native build)
fnm exec --using=22 -- npm test        # 20 tests, no database required
```

## Environment

Confirmed target: SQL Server 2022 in a container, port published to the host.

```
CONTAINER      IMAGE                                        PORTS
d2c7a0263df7   mcr.microsoft.com/mssql/server:2022-latest    0.0.0.0:1433->1433/tcp
```

Three consequences, all handled:

- **SQL logins only.** The `mssql/server` images have no Windows authentication,
  so `--user` defaults to `sa` and the password comes from `--password`, the
  `SFS_SQL_PASSWORD` environment variable, or an interactive prompt.
- **Comma, not colon.** `localhost,1433`. Pass `localhost:1433` and it is
  normalised for you, with a note.
- **Self-signed certificate.** The connection sets `encrypt: true` and
  `trustServerCertificate: true`, matching the application's own configuration.

## Extract

Assumes fnm is activated for this shell. If not, prefix each with
`fnm exec --using=22 --`.

```powershell
# 1. What databases does SQL Server actually have? A restored backup is often
#    named differently from its .bak file.
node export-shesha-forms.mjs --list-databases

# 2. Connect, discover the schema, print the generated SQL. Writes nothing.
node export-shesha-forms.mjs --discover-only `
  -d 'RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade' `
  -t requirements-studio-045

# 3. Extract.
node export-shesha-forms.mjs `
  -d 'RequirementsStudio-backup-202606221027-withpdtraveldata-45upgrade' `
  -t requirements-studio-045

# 4. And the second database, tagged separately - never mix provenance.
node export-shesha-forms.mjs -d '385xbw-new-20260817-090916-fixed' -t 385xbw
```

Output lands in `~/Documents/sfs-corpus-intake/<source-tag>/` unless you pass
`--out`.

### What `--source-tag` is for

A short filesystem-safe label — lowercase, digits, hyphens — that becomes the
output directory name, the `sourceTag` in the manifest, and later the corpus path
`packages/sfs/corpus/db/<source-tag>/`. Its job is keeping two databases from
blending into one undifferentiated pile. Six months from now, when a form
round-trips badly, you need to know whether it came from the 0.45-upgraded
RequirementsStudio backup — the backend the capability matrix was measured
against — or from a source whose provenance nobody recorded.

### Options

| Option | Default | Notes |
|---|---|---|
| `-d`, `--database` | — | required unless `--list-databases` |
| `-t`, `--source-tag` | — | required; validated against `^[a-z0-9][a-z0-9-]*$` |
| `--server` | `localhost,1433` | colon form accepted and normalised |
| `--user` | `sa` | container images support SQL logins only |
| `--password` | *(prompted)* | or `SFS_SQL_PASSWORD` |
| `--out` | `~/Documents/sfs-corpus-intake` | keep it outside the repo until intake |
| `--list-databases` | — | list databases and exit |
| `--discover-only` | off | connect, discover, print SQL, write nothing |
| `--include-all-versions` | off | off means latest version only |
| `--timeout` | `600` | request timeout in seconds |

## Three commitments the extractor makes

**Discovery, not assumption.** No table or column name is hardcoded. It finds the
base table carrying a `Markup` column, locates the sibling configuration-item
table by looking for one with `Id` + `Name` + `ItemType`, finds a joinable modules
table for `ModuleName`, and builds the `SELECT` from what exists. `COALESCE` is
emitted only where a column exists on both joined sides — a test covers that,
because referencing an unjoined alias is a query that will not compile. If
discovery picks wrong, fix the discovery query: a hardcoded table name is a
machine-local assumption, and that class of thing is what
`g-registry-provenance` bans elsewhere in this repo.

**Absent is never empty.** An envelope field that cannot be resolved is emitted as
`null` *and* listed in `manifest.json` under `envelopeFieldsMissing`, with
`provenance` set to `db-export-partial-envelope` rather than
`db-export-complete-envelope`. A downstream tier can then dispose those fields
`uninspectable` instead of mistaking a missing column for a blank value. That is
the rule the rebuild enforces everywhere: degrade honestly, never to `pass`.

**Metadata only.** It reads the discovered configuration-item tables and nothing
else. Form configurations are metadata; a production backup — particularly one
named `withpdtraveldata` — may hold client records, and this program has no path
to them.

Two behaviours worth knowing: latest-version selection filters `IsLast = 1` when
that column exists and otherwise collapses to the highest `VersionNo` per
module/name after fetching, recording which it used as `latestVersionMethod` —
"45 forms" means something different under each. And two forms whose names slug
identically once invalid characters are replaced both survive, the second
suffixed `~2`, rather than one silently overwriting the other.

## Measure

```bash
node defect-census.mjs ~/Documents/sfs-corpus-intake/requirements-studio-045 \
  --json census-baseline.json --md census-baseline.md
```

| Option | Effect |
|---|---|
| `--json <path>` | machine-readable report, including every instance |
| `--md <path>` | committable markdown report |
| `--compare <baseline.json>` | per-class before/after/delta against an earlier run |
| `--fail-on-regression` | with `--compare`, exit 1 if any class got worse |
| `--detail <N>` | print up to N example instances per class (default 3) |
| `--quiet` | suppress the console report |

Exit codes: `0` measured, `1` regression under `--fail-on-regression`, `2`
unusable input.

**It is a measurement instrument, not a gate.** It asserts nothing and exits 0
whether it finds one defect or ten thousand. Conflating instrument with gate is
how a repository ends up with green signals that check nothing, so
`--fail-on-regression` exists to make gating something you opt into explicitly.

### The eight classes

Each was measured in `bookings-table` revision 2, a hand-authored, human-reviewed
production form.

| Class | Defect | Rule |
|---|---|---|
| N1 | Stray designer label | `label` matches `^[A-Z][A-Za-z]*\d+$` and `hideLabel` is not true |
| N2 | Breakpoint style inconsistency | a leaf under `border`/`background`/`shadow`/`font` disagrees across base and breakpoints. `dimensions` is excluded: it is the legitimate channel for responsive intent |
| N3 | `className` on some breakpoints only | present in 1 or 2 of the 3 breakpoint blocks |
| N4 | Fixed small height on a wrapper | a breakpoint pins `dimensions.height` under 100px on a node with 3 or more descendants |
| N5 | Dual styling channels | legacy `fontSize`/`fontWeight` alongside a v7 `desktop.font` |
| N6 | `stylingBox` duplicated | present at the node root *and* inside breakpoints |
| N7 | Redundant row-click wiring | `onRowClick` alongside `rowClickActionConfiguration` |
| N8 | Submit plumbing on a read-only list | `formSettings` carries submit or argument plumbing while the form has a datatable/datalist and no inputs |

### Self-test

Run it against the committed golden reference and it must report exactly this:

```bash
node defect-census.mjs ../artifacts/bookings-table.revision2.json
```

| Measure | Expected |
|---|---|
| Components | 12 |
| Max depth | 5 |
| Markup bytes | 19170 |
| Breakpoint-block bytes | 8422 (43.9% of markup) |
| Components carrying breakpoints | 11 |
| `desktop === tablet` byte-identical | 6 |
| Real desktop/tablet leaf differences | 7 |
| Classes found | N1 to N8, all eight |
| Defect instances | 13 |

Those figures were measured by hand from that form. **If the tool disagrees with
them, the tool is wrong — not the golden.** Test 20 in the suite asserts three of
them end to end, from extract through to census.

## Division of labour

The extractor deliberately does **not** parse `Markup`. It does a structural check
— complete JSON object, non-trivial length — records `markupBytes` and a SHA-256,
and leaves `componentCount` and `maxDepth` as `null` for the census to fill. The
census owns parsing, envelope unwrapping and tree walking.

That keeps tree-walking logic in exactly one place. The pre-rebuild repository had
five mutually inconsistent walkers and three envelope unwrappers, and the
divergence between them is a documented source of defects. This split exists so
that history does not repeat one directory over.

## Why the census matters before the compiler exists

It produces the **baseline the compiler has to beat**. Run it now over the raw
extract and commit the report. Later, run it over `compile(decompile(f))` output:

```bash
node defect-census.mjs .build/normalised --compare census-baseline.json \
  --md census-after.md --fail-on-regression
```

Every class the normaliser claims to own must fall to **zero** instances. A class
that survives is a compiler defect, not a corpus defect. That turns "the
normaliser removes the eight defects" from an assertion into a measurement, which
is the whole point of the rebuild.

## Sequencing

Send `CORPUS-INTAKE-PROMPT.md` only once the running session reports
`SESSION COMPLETE - SCOPE A`. During Phase 1, `g-corpus-immutable` holds a
SHA-256 manifest and hard-fails on any corpus change, so an intake mid-flight
either trips the gate or pressures the session into editing it — and editing a
gate to make work fit is stop condition S7, the one failure mode this rebuild
exists to make impossible.
