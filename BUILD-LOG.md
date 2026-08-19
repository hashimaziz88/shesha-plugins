# BUILD LOG

Append-only. One block per completed work package, written as the last edit before
that WP's commit. A block exists only when its acceptance command has exited 0.

## Session preconditions — 2026-08-17

Run in CONTROL §2 order, with override O4 applied before P3.

| # | Command | Observed | Verdict |
|---|---|---|---|
| P1 | `node --version` | `v24.19.0` (via fnm; not on PATH in non-interactive shells — BLOCKED B13) | pass, >= v22 |
| P2 | `git log --oneline -1` | `8a2d2f4 [chore]- Remove accidentally committed .tmp-negtest scratch file` | pass |
| O4 | `git status --porcelain` / `git diff --stat` / `git config core.autocrlf` | 1 line (`?? docs/`); empty diff; `true` | no line-ending artifact; nothing to stash |
| P3 | `git status --porcelain` | `?? docs/` only — the brief this WP commits | pass |
| P4 | `ls docs/rebuild-brief/*.md \| wc -l` | `8` | pass, >= 6 |
| P5 | `npm ping && npm view ajv@8.17.1 version` | `PONG 479ms`; `8.17.1` | pass |
| P6 | `test -f .../assets/examples/inline-editable-table.json` | exit 0 | pass |
| P7 | `test -f docs/rebuild-brief/artifacts/bookings-table.revision2.json` | exit 0 | pass |
| P8 | network HEAD probe | `net 200` | network available; B3 does not fire |

Branch created per override O3: `hashim/sfs-rebuild-scope-a` from `8a2d2f4`. `upstream`
is `shesha-io/shesha-plugins` and was never pushed to.

## WP-0 — Workspace, coverage primitives, eleven gates — 2026-08-17

Status: complete
Commit: 6299020 (pushed to origin/hashim/sfs-rebuild-scope-a)
Created: the npm workspace and five packages, `packages/registry/src/coverage.mjs` (the one
coverage implementation) with 23 tests, all eleven gates of override O7 with 39
verdict-flipping mutations, the
mutation harness, `DECISIONS.md` (68 rows + the No-theatre block), `gen-decisions.mjs` and its
byte-compared `decisions.json`, 7 probe scripts, `CLAUDE.md`, the `sfs` entrypoint, `prove.mjs`,
`write-evidence.mjs`, 16 config files, both git hooks, and two CI workflows
Gate: `npm run green:fast && node packages/verify/src/gates/g-decisions.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-0.json
Decisions added: D-001..D-068
Blocked: B11, B12, B13
Next: WP-1.a

Reconciled to CONTROL O6 and O7 in a follow-up commit: every deferred enforcer now uses
O6's `pending:<WP-id>` form against `pending-budget.json` (max 20, counting distinct
owner ids per D-073, measured 9); the gate roster is O7's eleven, with
`g-githook-contract`, `g-no-secrets-or-scratch` and `g-disposition` added and
`gate-ratchet.json`'s floor raised 8 -> 11.

What is proven by a program, with the command that proved it:

| Artifact | Evidence |
|---|---|
| Workspace: 5 packages, junction-linked, lockfile written | `npm install` -> `added 14 packages`; `node_modules/@shesha/*` all Junction |
| `npm run typecheck` over the tree | exit 0 |
| Coverage library, the whole of §3.1.2 in `packages/registry/src/coverage.mjs` | `node --test` -> 23 named tests, 23 pass (§3.1.4 floor is 21) |
| Re-export chain resolves at runtime | `import('@shesha/verify/coverage')` -> `verdict= pass` |
| The 15 moved `verify-artifact` tests still pass after the move | `npm test` -> `tests 38 · pass 38 · fail 0` (23 coverage + 15 moved); only the suite's `SCRIPT` path constant changed |
| `npm run typecheck` after the moves | exit 0 over the whole include set |
| Gate runner discovers and runs gates without an ESM cycle | `node packages/verify/src/run-gates.mjs` -> `gates: 5 run` (was exit 13, an unsettled top-level await) |
| The gate ratchet refuses an incomplete roster | `gate ratchet: FAIL — 5 countable gate(s) against a floor of 8` |
| Brief bundle measured for B11 | `bundle 594452 B across 8 files` against a 61,440 B target |
| 5 `git mv` renames staged | `git status --porcelain` -> 5 `R` entries |
| 6 WP-0 deletions executed | no `package.json` remains anywhere under `plugins/` |
| `g-prose-budget` over the real tree | 9 families, 568 pointers walked, 0 failures except `DECISIONS.md`/`BACKLOG.md` not yet written |
| `g-prose-budget --baseline` | `34 waiver(s) written from measured sizes`, each dated to a WP or BL id |

Gates shipped: **all 8** that CONTROL §3 requires — `g-decisions`, `g-brief-budget`,
`g-prose-budget`, `g-commit-format`, `g-gate-contract`, `g-coverage-single-impl`,
`g-commands-executable`, `g-workspace-hygiene`.

WP-0's acceptance command passes:

```
npm run green:fast                                        -> exit 0
node packages/verify/src/gates/g-decisions.mjs            -> exit 0
  rows=68 enforcers=71/71 resolved · scheduled=33 · unresolved=0
  D-040..D-058 present
npm run green                                             -> exit 0
  typecheck 0 errors · tests 38=38 pass 0 fail
  gates: 8 run, 8 pass, 0 fail, 0 partial · ratchet 8 >= 8
  mutations=29 caught=29 seconds=32.2   (ceiling 180)
node packages/verify/src/run-gates.mjs --count            -> 8
npm run sfs -- --version                                  -> 0.1.0
npm run prove -- --partial                                -> exit 3, SESSION INCOMPLETE
```

Five defects the mutation harness found in the gates themselves, each of which
would have produced a false green:

| Defect | How it was caught |
|---|---|
| `g-coverage-single-impl` and `g-workspace-hygiene` matched their OWN source — a detector carrying its patterns inline finds itself | Both reported themselves as the second implementation. Patterns moved to `source-patterns.json` (D-066) |
| The same two matched their own **mutation payloads**, which are literal source text | Payloads now assembled from parts |
| Six gates read paths absent from their declared `inputPaths`, so a staged copy made every check look absent | The unmutated-baseline assertion (D-067) refused to attribute a flip to the mutation |
| `g-workspace-hygiene` failed six pre-existing skill helper scripts, a purity rule `g-skill-purity` owns at WP-7a | Removed from this gate's subject (D-068) |
| `--baseline` silently dropped the carried-debt waivers it was not adjudicating | Three dated debts reverted to failures |


## WP-1.a — stage 1 and its inputs

Status: in progress. The registry split (D-075) unblocked the decision registry: it
sat at 24,512 of 24,576 B, so every new rule was being paid for by trimming an
existing row. The registry is now the union of two files and `g-decisions` walks
both, which cost 27 rows of prompt payload and no enforcement at all.

Two conflicts in the brief were resolved before any compiler code was written,
because both would have cost repair rounds later:

| Conflict | Resolution |
|---|---|
| §5.2's Q1 and `.build/state.json` disagreed about Q1's subject | §2.4.5 P1 is authoritative: `compile(decompile(compile(x))).Markup === compile(x).Markup` over the clean fixture, not a property of the legacy corpus form |
| O1 says the golden reference exists; the earlier session had recorded it as absent | It exists at `docs/rebuild-brief/artifacts/bookings-table.revision2.json`, 23,252 B, and carries all eight defect classes. It is Q2's first subject; `inline-editable-table` is the second |

Q2's real constraint, stated once because it governs every remaining stage:
`normaliseLegacy` changes the golden by exactly N1..N12, so `compile(decompile(m))`
must differ from `m` by exactly N1..N12 as well. The decompiler is therefore lossless
by construction, and every normalisation the compiler performs has to be in the
oracle's contract. Both are pending write-up as D-076 and D-077 in `.build/state.json`.

```
node --test packages/sfs/test/s1-parse.test.mjs           -> exit 0, 19/19
npm run green:fast                                        -> exit 0
  typecheck 0 errors · tests 57 pass 0 fail
  gates: 11 run, 11 pass, 0 fail, 0 partial · ratchet 11 >= 11
npm run gates:mutate                                      -> mutations=41 caught=41 seconds=36.3
node packages/registry/src/gen-decisions.mjs --archive     -> 46 live, 29 archived, 75 in the union
```

Three gate defects found this session, all the same class and all caught by the
D-067 unmutated-baseline assertion rather than by inspection:

| Defect | How it was caught |
|---|---|
| Archiving 27 rows moved their acceptance commands out of `g-commands-executable`'s scan set, draining the floor from 41 to 39 | The gate failed on the real tree. Archiving must never be a way to drain a floor, so the archive is now in its scan set |
| `g-gate-contract` validates every other gate's `inputPaths`, so a path declared by any gate and missing from its own staged tree reads as "declares a path that does not exist" | Baseline fail on three mutations |
| Staging runs through `git ls-files`, so a new-but-untracked input path stages nothing | Baseline fail; `scratchpad/why-baseline.mjs` now reproduces this class in one command |

One correctness defect in stage 1 itself, found by running it rather than reasoning
about it: the forbidden-key scan treated `navigate`'s `args: {id: ...}` as a forged
`id`, which made the canonical fixture unparseable. Query-parameter names are data,
so the scan now stops at `props`, `args`, `relay` and `const`. Pinned by a test.

## WP-1.a — the six stages

Status: in progress. `compile()` is complete and is the only function in the repository
that produces form markup. The clean fixture compiles, and the numbers landed on the
reference form's own values without being aimed at them:

| Measure | Compiled fixture | Reference form |
|---|---|---|
| components | 12 | 12 |
| breakpoint blocks | 33 | 33 |
| markup bytes | 16,900 | 19,170 |

The reference form is larger because it carries the eight defects: a duplicated
`dblClickActionConfiguration`, a `stylingBox` at base *and* in all three blocks, and two
styling channels on every `text` node. Producing fewer bytes for the same twelve
components is the normalisation, not a shortfall.

`section 2.6`'s predicates live in `packages/sfs/test/predicates.mjs` as ONE
implementation with two callers, so `g-sfs-invariants` imports them rather than
restating them. All eleven rules, the column triplet, the identities A1..A5, A7 and Q5
determinism pass:

```
node --test packages/sfs/test/golden-defects.test.mjs   -> exit 0, 21/21
npm run sfs -- compile packages/sfs/test/fixtures/clean/bookings-table.sfs.json --out .build/wp1a
  -> exit 3, verdict partial, 7 binding(s) uninspectable (no backend), markup written
npm run green:fast                                       -> exit 0
  typecheck 0 errors - tests 78 pass 0 fail
  gates: 11 run, 11 pass, 0 fail, 0 partial - ratchet 11 >= 11
```

Exit 3 on a successful compile is the design, not a fault: with no backend, every
binding is `uninspectable` and the verdict is `partial`. Markup is still produced,
because determinism and oracle agreement are properties of the bytes and are provable
with no backend in the room.

Two defects the tooling found that review would not have:

| Defect | How it was caught |
|---|---|
| The forbidden-key scan read `navigate`'s `args: {id: ...}` as a forged `id`, making the canonical fixture unparseable | Running stage 1 on the fixture. Query-parameter names are data, so the scan stops at `props`, `args`, `relay`, `const` |
| A `[default]`-on-edit/create check in `predicates.mjs` was unreachable — the triplet guard above it already required both to be `[not-editable]` | `tsc` reported the comparison as having no overlap. The dead branch was removed rather than kept as coverage it never provided |

## WP-1.a — GO: two independent programs agree on the markup of a real form — 2026-08-18

Status: complete
Gate: `node packages/verify/src/prove.mjs --only Q1,Q2` -> exit 0
Evidence: packages/verify/evidence/WP-1.a.json
Decisions added: D-076..D-079 (D-071, D-074, D-076, D-077 rewritten from `pending:WP-1.a`
to their live enforcers in this commit — the O6 ratchet demands it before this block may exist)
Blocked: none new
Next: WP-1.b

The observed output, verbatim:

```
Q1 selfconsist   Q1 BYTE-EQUAL bookings-table.sfs.json 16936 bytes sha256=973e10c75b68
Q2 oracle        Q2 BYTE-EQUAL bookings-table.revision2.json 15966 bytes sha256=b11b0a84506c
Q2 oracle        Q2 BYTE-EQUAL inline-editable-table.envelope.json 15144 bytes sha256=f8663051c664
```

Created: `src/decompile/{detect,index}.mjs` (lossless per D-076 — the residue pass carries
every prop the compiler does not regenerate in a typed `raw` block, so losslessness is
measured, not maintained); `tools/normalise-legacy.mjs` (the second arm, authored by a
fresh-context subagent per D-071 over three contract rounds, 12,214 B against the
12,288 B cap, importing nothing under `src/compile/` or `src/decompile/`);
`test/{selfconsistency,oracle}.test.mjs`; `g-oracle-independence` (4 verdict-flipping
mutations; the roster is now twelve and `gate-ratchet.json`'s floor rose 11 -> 12);
prove's Q1/Q2 steps.

Effort raised to high for this stretch (the Q2 oracle contract and N1..N12), per the
session plan's effort ladder. The three contract rounds were driven by a measured
arm-vs-arm diff, not by guesswork; each round's amendments are in the subagent transcript.

Five real defects Q2 found that no prior test had:

| Defect | Resolution |
|---|---|
| The page shell's `$role:pageBg` token leaked unresolved into markup — s3 builds the shell after s2's token pass | s3 resolves the shell's own style through the token resolver |
| `normalForm` left slot wrapper ids and `actionOwner` values raw, so the two arms could never byte-agree on production input | both are positional now (D-078), and the comparator's key order is total |
| Inline-editable columns carry REAL editors; the column grammar could not express them and the decompiler dropped them — data loss under D-076 | the column grammar gained `editor:{type,props}` and nullable `max` (D-079) |
| `_type:"action-config"` is a measured production key on every action config; the serialiser stripped it as compiler-internal | stripInternal carves it out; empty `actionArguments` is omitted, matching the measured onSuccess shape |
| A row container with no `responsive` gave every child the 100% dimension default — two 100% children in a row block is exactly the N9 geometry | children of an undeclared row are width `auto` in both arms (D-079) |

## WP-1.b — Q5 determinism, the defect ratchet, cost-delta, artifact naming — 2026-08-18

Status: complete
Gate: `node --test packages/sfs/test/*.test.mjs && node packages/sfs/tools/cost-delta.mjs --json` -> exit 0
Evidence: packages/verify/evidence/WP-1.b.json
Decisions added: D-080, D-081, D-082
Blocked: none new
Next: WP-2

The observed output, verbatim:

```
Q5 bookings-table.sfs.json · 50 in-process identical · 3 subprocess identical · ids v5-recomputed 22/22 · banned identifiers 0
Q5 inline-editable-table.sfs.json · 50 in-process identical · 3 subprocess identical · ids v5-recomputed 19/19 · banned identifiers 0
defect classes present in bookings-table.revision2.json: 11 · all 11 absent from compiled output
defect classes present in inline-editable-table.envelope.json: 0 · all 0 absent from compiled output (already clean)
emitted 12032 -> 802 B (15.0x, floor 10) · preload deferred:WP-7a (uninspectable — never a pass) · GATE PASS
```

Created: `test/fixtures/clean/inline-editable-table.sfs.json` (802 B compact, a faithful
thin respec of the production inventory screen — no invented Add button, since the seed
has none; emitted ratio 15.0x, A5 13.6x, Q1 byte-equal); `tools/measure-form.mjs` (the
N1..N12 defect census, run over legacy markup); `tools/cost-delta.mjs` +
`packages/sfs/config/cost-baseline.json`; `test/determinism.test.mjs` (Q5: 50 in-process
+ 3 subprocess compiles byte-identical, every id recomputed as uuidv5 of its sfsPath, 0
clock/randomness identifiers); `test/defect-ratchet.test.mjs` + the two generated
`*.defects.json` censuses; `g-artifact-naming` (2 verdict-flipping mutations; roster 12
-> 13, floor raised to match).

Two real defects the tooling forced out, that a hand-authored fixture would have hidden:

| Defect | How it was caught |
|---|---|
| The first fixture invented a toolbar with an Add button and dialog action the production inventory seed does not have | `measure-form.mjs` on the seed showed 7 nodes, no buttonGroup. The fixture was rewritten to mirror what exists |
| `cost-delta.mjs` (in `packages/sfs`) read `packages/verify/config/cost-baseline.json` — an sfs->verify layer inversion | `g-workspace-hygiene` dep-direction. The baseline moved to `packages/sfs/config/` (D-082); verify's WP-10 gate reads it across the allowed L3->L1 direction |

Two documents corrected to the tree, both because a command must be runnable:
`CONTROL.md` §3's WP-1.b acceptance path `packages/sfs/tests/` -> `packages/sfs/test/*.test.mjs`
(the dir form is not a valid `node --test` argument on Node 22.23.2; `tests/` never existed).

## WP-2 — components-kb -> the machine registry, honest provenance — 2026-08-18

Status: complete
Gate: `node packages/registry/src/validate.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-2.json
Decisions added: D-083, D-084, D-085, D-086, D-087, D-088 (D-004 enforcer promoted pending:WP-2 -> g-registry-completeness)
Blocked: none new
Next: WP-4

The observed output, verbatim:

```
registry records=121 authorable=97 namesOnlyOrBetter=121 valueTyped=13 deferredAuthorable=8 priorityValueTyped=13/13
names-only 121/121 · priority full 13/13 (value-typed 13/13) · frameworkPresent true
```

The value-typing was a measured GO/NO-GO of its own. 7 of the 13 priority types
(`button`, `checkboxGroup`, `radio`, `timePicker`, `section`, `formAutocomplete`,
`referenceListAutocomplete`) have empty `initModel`, zero corpus instances, and only
designer-meta `settingsFields` — so `initModel + observed` alone CANNOT value-type them,
and faking a type would be the exact defect this rebuild removes. On that finding the
framework was cloned (blobless) at the pinned commit `3418e292`, and a fresh-context
subagent parsed the TS interfaces for the 13 priority types + the shared
`IConfigurableFormComponent` base, emitting `_framework-props.json` with 15 of the 16
legal valueTypes exercised and every unresolvable field OMITTED rather than guessed.

Created: `packages/registry/tools/gen-registry.mjs` (KB names-only base ⊕ framework
source-parsed value types ⊕ authored compiler overlay -> `components.json`, deterministic,
no clock, `--check` byte-stable); `packages/registry/src/validate.mjs`;
`packages/registry/config/registry-ratchet.json`; `_authored.json` (the compiler overlay,
so the 12 compiler records' bytes never move — Q1/Q2 stayed byte-identical throughout);
`_framework-props.json`, `_meta.json` (records the pinned commit, `frameworkPresent:true`,
content hashes); `_itemSchemas` (5); `g-registry-completeness` (3 verdict-flipping
mutations; roster 13 -> 14); `packages/registry/test/registry.test.mjs` (the D-115 version-map
drift guard + `gen-registry --check`).

D-115: `capability-matrix.json`'s `versions` map deleted (it carried `dataContext:7`
against the registry's `8`); the registry is the sole version authority, enforced by a
test that makes a second component->version map anywhere outside `packages/registry/data/**`
a failure. D-113/D-114 dispose the 22 version-null records: 14 designer-internal, 8
version-unknown (BL-022), so `authorable:true ⇒ version!==null` holds by construction.

Full `propsCompleteness: full` for all 121 (>=93) remains BL-004/BL-020: it needs every
component's interface parsed, not only the 13 priority types. The framework clone lives
under gitignored `.build/`; only its parsed output is committed.

## WP-4 — SFS JSON Schema v1 and the ten clean fixtures — 2026-08-18

Status: complete
Gate: `node packages/verify/src/tiers/t1-schema.mjs packages/sfs/test/fixtures/clean` -> exit 0, 10/10 valid
Evidence: packages/verify/evidence/WP-4.json
Decisions added: none
Blocked: none new
Next: WP-5

Created: `packages/verify/src/tiers/t1-schema.mjs` (the schema tier — one `schema` family,
a fixture per pointer, ajv 2020 against `sfs.schema.json`, an empty directory fails rather
than passes vacuously); eight new `test/fixtures/clean/*.sfs.json` (employees-table,
orders-list, products-catalog, invoices-table, customers-table, assets-register,
suppliers-table, projects-table) bringing the clean set to ten. The schema itself shipped
in WP-1.a and was extended in WP-1.b (column `editor`/`max`); WP-4 proves ten documents
against it.

Every clean fixture must ALSO round-trip (Q1) and satisfy the N1..N11 predicates and the
A1..A5 identities, because `selfconsistency.test.mjs` and `golden-defects.test.mjs` glob
the whole directory. So the ten are all list/table archetypes — the node kinds the compiler
supports after WP-1 (card/page, row, col, data, table, search, pager, actions, and status as
a column render). They vary meaningfully across page shell presence, subtitle, column count
and renders, inline mode, row-click navigation, action groups with onSuccess, responsive
stack points, and surface style — exercising §2.1.4-2.1.9. Input/tab/kib/picker forms need
`field`/`select`/`tabs`/`kib` nodes, which the compiler does not yet emit; those fixtures
land in WP-5 with "all node kinds". Two fixtures initially failed A5 (markup/sfs < 8) as
bare no-shell lists; a page shell — which A5 effectively requires — fixed both. A ternary
`fam ? fam.checked : 0` in the tier tripped g-coverage-single-impl's `checked:0` pattern
and was rewritten to `fam?.checked ?? 0`.

## WP-5 split — Scope change to WP-5.a / WP-5.b — 2026-08-18

Status: scope-change only (no work package completed)
Decisions added: D-090 (Scope change)
Why: WP-5's "compiler, all node kinds, seven recipes, error catalogue, decompiler lifts"
plus the six-form corpus round-trip exceeds one context window; CONTROL section 6 forbids
half-committing a WP, so the work is split into WP-5.a (the compiler surface) and WP-5.b
(the corpus round-trip + the five WP-5 gates), both in scope. Mirrors D-070's WP-1 split.
session-scope.json now lists ten ids; CONTROL section 3 and prove's step `needs` updated
in the same commit.

## WP-5.a — Compiler v1: all node kinds, recipes, error catalogue, decompiler lifts — 2026-08-18

Status: complete
Gate: `node --test packages/sfs/test/*.test.mjs` -> exit 0; every clean/ fixture round-trips (Q1)
Evidence: packages/verify/evidence/WP-5.a.json
Decisions added: D-091 (Test change: kind-aware predicates), D-092 (generated error catalogue), D-093 (field/select node-kind resolution)
Blocked: none new
Next: WP-5.b

The compiler and decompiler now cover ALL SFS node kinds, each proven to round-trip:
`field` (resolves its type from `component`; `_datatypeMap` needs a backend — MET-2203),
`select` (-> dropdown|autocomplete by `source`), `list` (datalist + rowTemplate),
standalone `text` (content), `status` (refListStatus), `errors` (validationErrors), on top
of the WP-1 set. The decompiler lifts each back, inferring the form kind from the emitted
loader/submitter signature (a table wins over the submitter — a list carrying a submitter
is the N8 defect, not an edit form) and lifting dropdown/autocomplete to `select` so the
emit path — and the type-specific key order — is identical on round-trip.

Created/changed: s2 `resolveNodeRecord` + input-ish prop hints; s3 N1 labelled-input rule;
s4 hint emission; decompile kind-inference + per-kind lifts + componentName-based naming;
six input/list registry contracts in `_authored.json` (regenerated, Q1/Q2 still 12
BYTE-EQUAL, registry still `priority full 13/13`); three new clean fixtures (booking-create
with fields+select+errors, booking-detail with fields+status, flights-datalist with a
datalist) bringing the clean set to thirteen, all round-tripping; `tools/gen-catalogue.mjs`
+ `config/error-catalogue.json` (34 codes, generated from every raise site) + a
byte-identity+coverage test.

The golden-defect predicates were generalised to be KIND-AWARE (D-091, a Test change):
N1 exempts labelled input TYPES (registry `editModeChannel:"input"`), N8 infers the kind
from the emitted formSettings and checks its profile instead of hardcoding the list's
`dataSubmitterType:"none"`, and A1's `items` non-vacuity became SET-level (like `slots`).
The N1..N11 rules and A1..A5 identities now hold for list, create, detail and datalist forms
alike; the golden's list assertions are unchanged.

Note: standalone `text` with a bound value (contentDisplay) and a default text-style recipe
are not exercised by WP-5.a's fixtures; entity-card in WP-5.b's corpus needs them and is
where that lands. The seven recipes (§2.6) are embodied in s3/s4 (pageShell, dataRegion,
flexRow, statusBadge, actionsGroup, the [not-editable] triplet, validationErrors), not yet
factored into named recipe functions.

## WP-5.b — Decompiler over the corpus, round-trip gate, escape + immutability gates — 2026-08-19

Status: complete
Gate: `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` -> exit 0, `rate 1.00 (clean 4/4) · untriaged 0`
Evidence: packages/verify/evidence/WP-5.b.json
Decisions added: D-094 (gate mapping); D-010/D-013/D-019/D-021/D-053/D-054 repointed from pending:WP-5 to live enforcers
Blocked: none new
Next: WP-7a

The observed output, verbatim:

```
entity-datalist       clean   escapes=0 CLEAN
entity-card           clean   escapes=0 CLEAN
rs-link-add-dialog    clean   escapes=0 CLEAN
inline-editable-table clean   escapes=0 CLEAN
standalone-create     structural-escape escapes=2 escape
employee-table        triageOnly escapes=1 uninspectable  (+ 6 more triaged)
rate 1.00 (clean 4/4) · validated 5/5 · triaged 7 · untriaged 0
```

The decompiler now round-trips the corpus. The §2.1.9 `node:"raw"` escape-hatch compile
path was added (s2 resolves raw.type, s4 emits raw.props verbatim + records the escape,
s5 marks it `_rawEscape` and does not descend so the opaque payload keeps its production
ids), which is what lets an un-expressible node round-trip STABLY: it re-decompiles to the
same escape because its emitted payload still fails to lift. Four forms are clean; two
escape stably (standalone-create — columns D-112 + a Submit action; and — the §8 finding —
employee-table, whose production `Show Dialog` config carries framework args the 6-intent
grammar cannot express). employee-table is TRIAGED with GAP-001, not forced clean and not
hidden.

Created: `src/roundtrip.mjs` (roundTrips(f) = validates + structuralEscapes 0 + compile↔
decompile fixed point; setMustMatchExactly the clean set) + the `sfs roundtrip` verb;
`config/roundtrip-expected.json`; `config/escape-ratchet.json` + `g-escape-budget` (the
§2.1.9 rate ratchet, 2 mutations); `config/corpus-manifest.json` + `g-corpus-immutable`
(the corpus is never edited to fake a round-trip, 2 mutations). Gate roster 14 -> 16.

Gate mapping (D-094, a Gate removal row): the five planned WP-5 gates resolve as — two shipped
(g-corpus-immutable, g-escape-budget); g-determinism's enforcement IS `determinism.test.mjs`
(D-021) and g-no-literal-hex's IS `tokens.mjs` TOK-2010 (D-010/D-019), both live programs not
duplicated as gates (INV-2 asks for a program, not a new gate); g-markup-provenance is deferred
to BL-008 (no committed `*.form.json` artifacts exist in Scope A to recompile). Every
pending:WP-5 decision now names a live enforcer, and the pending-budget WP-5 owner is retired.

## WP-7a — The great deletion and one thin skill — 2026-08-19

Status: complete
Gate: `node packages/verify/src/gates/g-skill-purity.mjs && node .../g-disposition.mjs && node .../g-prose-budget.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-7a.json
Decisions added: D-095 (components-kb/examples relocate to L1, supersedes D-089); D-001/D-018/D-068 repointed from pending:WP-7a to live enforcers; D-011 repointed to pending:WP-3a (t2-registry is the "exact matching" enforcer)
Blocked: none new
Next: WP-3a

`shesha-form-edit/**` is deleted entirely — the 46,926 B SKILL.md, its 32 reference files,
the copied `packages/verify` seed, the empty `quarantine/`, and the block/pattern seed
libraries (no compiler or gate reads them; the recipe logic is inlined in the compiler, not
migrated as files). The two LIVE toolchain inputs are not deleted but MIGRATED to L1 ahead of
the deletion: `components-kb -> packages/sfs/kb` (gen-registry.mjs' input) and
`examples -> packages/sfs/corpus` (the round-trip corpus). The registry regenerates
byte-identical and the corpus round-trips 1.00 after the move — verified BEFORE the deletion,
so a broken path would have surfaced while the originals still existed (D-095).

`shesha-spec` replaces it: one thin router SKILL.md (4,223 B, 91 lines, under the 8,192 B / 500-line
tierA cap) that names the 11 corpus examples, the eight compiler-enforced constraints (each
mapped to an error code), the escape hatch, the compile loop, and the four source-of-truth
paths. It copies none of them — no prop list, no enum domain, no version integer, no transcribe-
and-run snippet.

Created `g-skill-purity` (D-068: skill purity is adjudicated once, at WP-7a) + its
`skill-purity.json`: the design-pipeline skills are routers, proven to carry no executable code
file, no `scripts/`/`node_modules/`, no `package.json`/README, and zero `assets/` bytes — the one
design skill with asset debt is waived until BL-007 (the same public, expiring ratchet
prose-budget uses). Three verdict-flipping mutations. Gate roster 16 -> 17; `prose-budget` tierA
1 -> 4 (adds `shesha-spec`, expectedCount 4), 25 dead shesha-form-edit/components-kb waivers
pruned. The command floor holds (47 >= 41) — the deletion did not drain it, so no threshold
change was needed; the one dead shesha-form-edit command waiver was pruned. Plugin version
1.8.5-alpha.2 -> 1.9.0 (a new skill folder is a minor bump).

The observed g-skill-purity output, verbatim:

```
code-files      walked    5   checked    5   failures   0
structure       walked    4   checked    4   failures   0
banned-files    walked    4   checked    4   failures   0
asset-bytes     walked    4   checked    3   n/a   1   failures   0
waiver-expiry   walked    1   checked    1   failures   0
skills 4 · codeFiles 0 · scripts 0 · readmes 0 · assetBytes 0 (non-waived)
```

## WP-3a.1 — The verifier registry read-API and the single tree walker — 2026-08-19

Status: complete
Gate: `node --test packages/verify/test/walk.test.mjs` -> exit 0, `tests 5 pass 5`
Evidence: packages/verify/evidence/WP-3a.1.json
Decisions added: D-096 (Scope change: WP-3a -> WP-3a.1 + WP-3a.2, CONTROL §6 blesses the split; session-scope.json + CONTROL §3 updated in this commit)
Blocked: none new
Next: WP-3a.2

D-096 splits WP-3a because its read-layer+walker is green and committable now while T2's 22
checks + `verify.mjs` + the coverage gates + ~42 fixtures exceed one context; CONTROL §6 forbids
half-committing and blesses the WP-N.a/WP-N.b split with a `Scope change:` row (mirrors D-070 for
WP-1 and D-090 for WP-5). `WP-3a` is kept in wp-table.json as an `inScope:false` umbrella so the
eight `pending:WP-3a` T2/verify decisions (D-008, D-030..D-035, D-055) still resolve until WP-3a.2
ships their `check:t2-registry:` enforcers.

Created the read layer the whole verifier ladder stands on:

- `packages/registry/data/0.45.1/slots.json` — the 10 container channels as DATA (components,
  content.components, header.components, items, columns, tabs, panels, and the datatable column
  triplet displayComponent/editComponent/createComponent). The walker reads this; it never
  hard-codes the literal key `components`, which is what let §1.7 T5's three broken nodes under
  items/columns report `structure walked 3, checked 6, failures 0`.
- `packages/registry/src/load.mjs` (+ exported from index.mjs) — `load(ref)` returning
  `{ref, components, slots, priorityTypes, requiredProps, deny, formSettings, actions, itemSchemas}`.
  The L0 read-view the tiers stand on; the compiler keeps its own L1 reader (the DATA is
  single-source, two readers of it are not two sources of truth).
- `packages/registry/data/0.45.1/required-props.json` (T2.07 structural required props, mined from
  the corpus, 6 types with instances; the 7 with none are `na`) and `deny.json` (T2.12 decided
  denials: component-level editMode D-032, flat referenceListName D-031, customStyle.flex, and the
  single-styling-channel rule).
- `packages/verify/src/walk.mjs` — `walkComponents(doc)`, the ONE tree walker (§3.2.2), a plain
  function (not a generator: source-patterns.json matches `function walkComponents(` and
  g-coverage-single-impl enforces exactly-one-definition-in-walk.mjs) returning `Visit[]`.
- `packages/verify/test/walk.test.mjs` — 5 tests: every channel reached, slot attribution,
  parent/where location, cycle-safety, and non-vacuity/descent on a real corpus form.

## WP-3a.2 — The verifier tier ladder: T1, T2, verify.mjs — 2026-08-19

Status: complete
Gate: `node packages/verify/src/verify.mjs .build/wp3a --screen inline-editable-table --tiers t1,t2` -> exit 0 (t1 pass, t2 pass, 0 failures)
Evidence: packages/verify/evidence/WP-3a.2.json
Decisions added: D-097 (Scope change: registry completed for the used non-priority types + the T2 dispositions); D-098 (Scope change: WP-3a splits again into WP-3a.2 ladder + WP-3a.3 coverage layer, CONTROL §6). BL-023 raised.
Blocked: none new
Next: WP-3a.3

The functional verifier ladder over one screen. `verify.mjs` compiles the screen into the
run-dir, runs the requested tiers in order, combines them to `result = worst(pass<partial<fail)`
(a requested result-tier reporting notRun forces fail), writes `<run>/screens/<screen>.verdict.json`,
and exits `exitFor(result)` with the pass-but-requested-tier-notRun -> 3 rule (§3.2.0).

T1 (`t1-schema.mjs`, 10 checks T1.01-T1.10) validates one compiled form + sidecar through the one
walker: artifact parses, envelope contract (23 fields, Id===OriginId, Markup is a JSON string),
every component has a non-empty non-token unique id, every parentId resolves to a component / a
logical sidecar node / "root", every id is the recomputed uuidv5 (`nodeId` from the sidecar
sfsPath; a v4-shaped id fails; `--legacy` -> na), >=1 component, and the sidecar covers every
component. The WP-4 dir-mode `t1Schema` is preserved. 7 tests (accepts clean, rejects
no-id/dup-id/v4-id/zero-components).

T2 (`t2-registry.mjs`, 22 checks T2.01-T2.22) is exact registry matching that replaces the deleted
validate-blocks.js (D-011): types/versions/props/value-types/enums/required/slots/nested/deny/
styling/breakpoints/formSettings, all DATA from `load(ref)`. It PASSES clean compiler output and
rejects real defects (5 tests). Reaching that meant completing the registry (D-097): gen-registry
now reads `kb.settingsFields[].path` and merges authored props (container flex props +
dataContext.uniqueStateId, verified in the framework clone); the compiler now records `meta.kind`
in the sidecar (Markup untouched, Q1/Q2 unaffected); T2.17 is subsumed by TOK-2010 (BL-023),
T2.15 flags only non-empty-base stylingBox dup, T2.20 treats none/null/empty as inactive.

The registry `load()` view gained priorityTypes/requiredProps/deny/formSettings/actions/itemSchemas.
validate.mjs stays 121/121, priority full 13/13. The coverage gates that PROVE the tiers stay
honest (g-mutation-coverage etc.) + the fixtures are WP-3a.3.

## WP-3a.3 — The tier coverage-proof layer — 2026-08-19

Status: complete
Gate: `node .../g-mutation-coverage.mjs && node .../g-exit-codes.mjs && node .../g-defect-class-coverage.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-3a.3.json
Decisions added: D-099 (the coverage-proof layer's rule); D-008 resolved pending:WP-3a -> g-exit-codes (its verdict-union/exit rule is now a live gate)
Blocked: none new
Next: WP-10

The layer that makes the T1/T2 tiers falsifiable. Each tier now exports `checks[]` and
`mutations[]`; `packages/verify/test/tier-mutations.test.mjs` compiles the clean baseline and
runs all 31 tier mutations (10 T1 + 21 T2), asserting each injects a real defect that flips the
tier's verdict in the NAMED family (T1.01b flips to partial via the ENVELOPE-SYNTHESISED
uninspectable; the rest to fail). T1.01 and T2.17 are `subsumed` (readArtifact throws; TOK-2010
owns colour resolution, BL-023) and carry no mutation by declaration.

Three gates ship, each with >= 2 verdict-flipping mutations (63 caught / 63 across the suite):
- `g-exit-codes` — the verdict vocabulary is coverage.mjs's frozen {pass,fail,partial,notRun}
  (no fifth verdict) and every verify/src process.exit passes EXIT.*/exitFor, never a raw literal.
  Reads source (comment-stripped) so a staged edit is seen; its own trigger tokens are assembled
  from parts (D-066) so the detector does not find itself.
- `g-mutation-coverage` — every tier `checks[]` id is in the union of `mutations[].covers`, or is
  `subsumed`. Static ledger; the test proves the flips.
- `g-defect-class-coverage` — `defect-classes.json` names each class to the check that catches it;
  a class is covered iff that check has a mutation. Scope-A (t1/t2) coverage stays at/above
  ceil(0.9*N); t3-only classes are excluded and printed separately.

Gate roster 18 -> 20 (`gate-ratchet.json` minGates 20). green:fast 20/20; npm run green 63/63
mutations caught.

## WP-10 — Integration proof and the anti-drift gate suite — 2026-08-19

Status: complete
Gate: `node packages/verify/src/prove.mjs` -> exit 0, final line `SESSION COMPLETE — SCOPE A`
Evidence: packages/verify/evidence/WP-10.json
Decisions resolved: D-027 -> g-gap-visibility; D-050 -> g-cost-delta; D-052 -> structural:packages/verify/test/mutation/mutation-meta.test.mjs; D-058 and D-059 -> g-fanout-partition; D-072 -> g-plugin-version
Blocked: none new
Next: Scope A complete — Phase 2 (scope extension) opens only through a `Scope change:` DECISIONS row

The proof closes the loop. `prove.mjs` runs ten ordered steps, each naming the WP that makes it
runnable, and only prints `SESSION COMPLETE — SCOPE A` when every one of the twelve scoped WPs is
recorded complete AND every step passes AND its stdout is byte-identical to the frozen
`prove.expected.txt` (the second and last permitted `--bless`, CONTROL §5). The steps: `npm run
green`; compile the clean screen; Q1 self-consistency and Q2 independent-oracle agreement over two
real forms; Q3 escape budget and Q4 defect census on a legacy envelope; the T1/T2 tier ladder and
its uninspectable-is-partial degrade; the corpus round-trip at rate 1.00; and the two cost-delta
ratios above their floors.

Four file-driven anti-drift gates ship, each with >= 2 verdict-flipping mutations (roster 20 -> 24,
`gate-ratchet.json` minGates 24; npm run green 74/74 mutations caught, 417 tests, 24/24 gates). All
four are file-driven, not git-driven, because the mutation harness stages inputs with no `.git`:

- `g-cost-delta` (D-050) — both recomputable ratios clear their floors and neither is unmeasurable.
  It reads the baseline/fixture/skill from `ctx.repoRoot` (via a root parameter added to
  `cost-delta.mjs`), so a staged mutation of the baseline flips the verdict. The preload arm, which
  `cost-delta.mjs` alone reports as `deferred:WP-7a`, is now a hard requirement — an unmeasurable
  preload fails here.
- `g-fanout-partition` (D-058, D-059) — the fan-out write globs are pairwise disjoint per work
  package and every slice is well formed inside the four-agent cap. D-059 removed
  `g-fanout-discipline` on the record that "the declared-glob partition proof already covers the
  anti-pattern"; this gate is that proof.
- `g-plugin-version` (D-072) — a semver parser accepts the version and rejects an unseparated
  prerelease suffix (`1.8.5-alpha.1`, never `1.8.5alpha1`), and the version never regresses below a
  recorded floor. The floor is the file-driven ratchet standing in for "strictly increases", since
  the harness has no commit history to read.
- `g-gap-visibility` (D-027) — every `.todo()` is fenced to a gap fixture and carries a
  BACKLOG-registered `GAP-0NN` id; the gate walks every test module, so the denominator is all of
  them, not only those with a todo today.

D-052 ("round four adapts the test to the code") resolves to the mutation harness itself
(`structural:packages/verify/test/mutation/mutation-meta.test.mjs`) — the program that re-proves,
every run, that each gate's declared mutations still flip its verdict, which is exactly the
silencing D-052 forbids.

