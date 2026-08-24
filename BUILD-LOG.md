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

## WP-5c — Compiler robustness: the leaf-record crash — 2026-08-19

Status: complete
Gate: `node --test packages/sfs/test/compile-robustness.test.mjs` -> exit 0 (3 pass)
Evidence: packages/verify/evidence/WP-5c.json
Decisions added: none
Blocked: none new
Next: WP-5d (decompiler output hygiene)

The first Scope-B WP, and the single largest round-trip blocker the mining run found: the
`compile-npe: reading 'hidden'` on 498 of 2,071 real forms (MINING-REPORT.md §5). Root cause: only
18 of 121 registry records carry a `defaults` block and only one (`card`) stores `slots` as an
array — the other 103 have no `defaults` and store `slots` as an object `{kind, names, …}`. The
compiler's s4-expand assumed the rich shape, so a field of any leaf input type (checkbox, switch,
radio, and 100 others) crashed twice in sequence: `rec.defaults.hidden` (defaults undefined), then
`(rec.record.slots || []).includes` (slots an object). The clean fixtures use only the 18 rich
types, which is why Scope A stayed green while real forms did not.

Two guards in `s4-expand.mjs::expandNode`: `rec.defaults || {}` (a missing defaults block means "no
defaults to apply", not a crash), and a `slots` normaliser that reads `slots.names` when `slots` is
the object shape and the array directly for `card`. `packages/sfs/test/compile-robustness.test.mjs`
compiles a one-field form for checkbox/switch/radio and asserts each yields markup with
`hidden:false` rather than throwing; the pre-fix crash was reproduced (`git stash` of the fix →
`reading 'hidden'`) before the guard was written. Q1 stays BYTE-EQUAL on all 14 clean fixtures — the
guards are inert for the rich types (`card` still uses its array; `container`/`text` stay
`undefined → []`). `prove-b` gains its first step (`compiler robust`). The two divergent `slots`
representations in the registry data are latent tech debt worth normalising in a later pass; the
compiler now tolerates both.

## WP-5d — Decompiler output hygiene — 2026-08-19

Status: complete
Gate: `node --test packages/sfs/test/decompile-hygiene.test.mjs` -> exit 0 (3 pass)
Evidence: packages/verify/evidence/WP-5d.json
Decisions added: none
Blocked: none new
Next: WP-5e (IR nodes for the escaping constructs)

The second mining front (~700 forms): the decompiler emitted SFS that failed its OWN schema, so
those forms never even reached escape-counting. The lift passed the envelope header through
unchanged, so real names, labels and CLR types decompiled straight into SFS-1101 violations —
/entity (259 forms), /form (232), /label (225), plus the smaller /hooks and /style/pad classes
(MINING-REPORT.md §5). Six sanitisers in `packages/sfs/src/decompile/index.mjs`: `form` is coerced
to a slug (`toSlug`), `module` guarded against `moduleName`, `entity` emitted only when it matches
`clrType` (a single-segment or malformed CLR name is omitted — a custom form legally has none),
`label` falls back to the form slug when the envelope's Label is absent or blank, pad/margin are
rounded to integers, and empty/whitespace hook bodies are skipped like nulls.

`packages/sfs/test/decompile-hygiene.test.mjs` (3 pass) decompiles a deliberately hostile header
(`Name:"My Form.V2! (Draft)"`, whitespace `Label`, single-segment `ModelType`, `ModuleName:"123
bad"`) and asserts the result recompiles; pre-fix that threw `DEC-7001 … SFS-1101 … in 3 place(s)`
(reproduced by `git stash` of the fix). The 18 existing round-trip/oracle/self-consistency tests
still pass, Q1 stays BYTE-EQUAL on all 14 clean fixtures, and the corpus round-trip stays `rate
1.00` — the sanitisers are inert for already-clean headers. `prove-b` gains its `decompiler hygiene`
step. The node-enum class (SFS-1101 /body/**/node, 126 forms — a child node kind the schema forbids
at that position) is structural, not scalar, and is scoped to WP-5e with the IR-node work.

## WP-5e — Lift the columns grid to a flex row — 2026-08-19

Status: complete
Gate: `node --test packages/sfs/test/columns-lift.test.mjs` -> exit 0 (2 pass)
Evidence: packages/verify/evidence/WP-5e.json
Decisions added: D-101 (the columns->row lift rule and its equal-spans boundary)
Blocked: none new
Next: WP-2b (registry completeness)

The #1 IR gap in the mining run: the `columns` layout component (an AntD 24-grid) escaped on 241
real forms (MINING-REPORT.md §5). D-035 already decided multi-column layout is a flex row, but the
mapping was undefined because SFS `col`s carry no width — layout widths come from the row's
`responsive` (px `fixed`/`fill`), which cannot express a 24-grid RATIO. D-101 resolves this with an
honest boundary: a `columns` grid whose flex spans are all EQUAL (the common halves/thirds case)
lifts to a flex `row` of equal-width `col`s (auto-distributed); an UNEQUAL grid stays a structural
escape rather than lift to an invented width the round-trip gate could not catch as wrong.

The lift is a special case in the decompiler's null-kind branch (`columns` has `sfsNode: null`),
before the raw escape: it builds a `row` whose `col` children carry each grid column's components.
`packages/sfs/test/columns-lift.test.mjs` (2 pass) proves an equal grid lifts to `row -> col,col`
with `structuralEscapes === 0` and round-trips (markup stable after one compile cycle), and an
unequal grid still escapes (`structuralEscapes === 1`, counted not hidden). The corpus round-trip
stays `rate 1.00` and Q1 stays BYTE-EQUAL — the clean fixtures use no `columns`, and no triaged
corpus form flipped status. `prove-b` gains its `columns lift` step.

One commit per WP means WP-5e ships the columns lift; the remaining escaping constructs (buttonGroup
and its action grammar per GAP-001, collapsiblePanel, tabs, statusTag, title, button, alert, wizard,
sectionSeparator, htmlRender) plus unequal-span `columns` are filed as BL-024, still graceful
escapes today. `wp-table.json`'s WP-5e goal is updated to match what shipped.

## WP-1c — Re-enable noUncheckedIndexedAccess tree-wide — 2026-08-19

Status: complete
Gate: `npm run typecheck` (now with `noUncheckedIndexedAccess:true`) -> exit 0; `node packages/verify/src/gates/g-workspace-hygiene.mjs` -> exit 0
Evidence: packages/verify/evidence/WP-1c.json
Decisions added: D-102 (scope change: WP-1c delivers BL-010; BL-001/006/014 stay BACKLOG)
Blocked: none new
Next: WP-3b (T3 semantic tier)

BL-010 (D-024): `noUncheckedIndexedAccess` is on tree-wide, so every indexed access is a checked
`T | undefined`. It had been deferred — g-workspace-hygiene asserted the flag ABSENT with a BL-010
note; that check now asserts it `=== true`, with a new mutation (turning it off flips the verdict).
The flag surfaced 209 type errors across registry/sfs/verify; a three-agent fan-out (one per
package, disjoint files — D-058-clean, agents never touched the index) fixed them, each fix verified
deterministically by `tsc` (unlike a semantic parse, a type-fix is caught by the compiler, so
fan-out is safe here). Fixes are JSDoc `@type` casts (a `!` is invalid in a `.mjs`) with a per-site
"provably in-bounds" justification, plus guards and `?? default`s. The change is type-only: full
`npm run green` (tests + 24 gates + mutations) passes unchanged, which is the behaviour proof. The
casts bloated `tools/normalise-legacy.mjs` past its 12288 B cap (g-oracle-independence#bytes); it was
trimmed back under. BL-001 (3-arm SAA token/step cost) is unmeasurable from inside this session —
the very reason D-050 deferred it — and BL-006/BL-014 are their own efforts, so D-102 keeps all
three as visible BACKLOG rows rather than block WP-1c forever. `prove-b` gains its `strict index` step.

## WP-7 — Thin the design skills, clear the prose debt — 2026-08-19

Status: complete
Gate: `node packages/verify/src/gates/g-prose-budget.mjs` -> exit 0 with 0 waivers whose `until` is BL-007 or BL-012
Evidence: packages/verify/evidence/WP-7.json
Decisions added: none
Blocked: none new
Next: WP-3b (T3 semantic tier)

BL-007 + BL-012: the nine D-063 prose waivers are gone, and the underlying debt with them. A
three-agent fan-out (disjoint skill files, D-058-clean) thinned `shesha-claude-designer/SKILL.md`
(16449 -> 7937 B) and `shesha-design-comprehension/SKILL.md` (9806 -> 7922 B) under the Tier-A 8192 B
cap, each kept a working ROUTER — frontmatter, the routing table, the Step 0-6 pipeline, the REQUIRED
sub-skill delegations, and the load-bearing rules and worked examples (the flex-container-vs-columns
width rule, `$RUN_DIR` layout, verify exit codes, the four gates in order, the design-critic verdict
enum). Cuts were duplication, restated rules, dot-graph diagrams and history. I read both thinned
skills back to confirm the routing, gates and examples survived and every referenced file still
exists — the gate checks size and archaeology, not usefulness, so a human read is the quality proof.
Archaeology was stripped from seven files (design-ingestion, capture-pipeline, capability-matrix x3,
clean-form-config/analysis, DomainModelling x2, gateway-artifacts) and `add-public-portal`'s
frontmatter `name` was fixed to equal its folder. The nine waivers were then removed from
`prose-budget.json`; the gate's `waivers#none-declared` path keeps the waiver-expiry family covered
at zero. The commit touches `plugins/**`, so `plugin.json` is bumped 1.9.0 -> 1.9.1 and
`g-plugin-version`'s floor raised to match. `prove-b` gains its `prose thin` step.

BL-007's description also floated renaming `shesha-claude-designer` -> `shesha-designer`. That is not
part of the waiver acceptance (the skill is thin and clean under its current name), and a rename
churns the marketplace id and every cross-skill reference, so it is left as a separate concern rather
than bundled here.

## WP-3b.1 — Compiler placement sidecar (§3.3.1) — 2026-08-20

Status: complete
Gate: `node packages/verify/src/gates/g-compiled-meta.mjs` -> exit 0 (schema 2 · sidecar 13 · placement 248, 0 failures); `npm run green` -> exit 0 (25 gates, mutations=77 caught=77)
Evidence: packages/verify/evidence/WP-3b.1.json
Decisions added: D-103 (Scope change: WP-3b splits into WP-3b.1..WP-3b.4, the full-brief T3 sequence); D-104 (the compiler emits the §3.3.1 provenance sidecar, validated by g-compiled-meta)
Blocked: none new
Next: WP-3b.2 (the placement predicate engine)

WP-3b is the full-brief T3 (30-verifier.md §3.2.4/§3.3), which is a multi-context subsystem: the
placement predicates read `cell.sizing`/`rowGroup`/`region`/`tabKey` from a compiler-emitted sidecar
that did not exist — `meta.nodes[]` carried only `{id,sfsPath,name,type}` — and `g-check-references`
cannot lift while 12 dangling plugin refs fail its own baseline. D-103 splits WP-3b into WP-3b.1
(this sidecar), WP-3b.2 (the 18-name predicate engine, closes D-014), WP-3b.3 (the T3 tier + the
`.build/wp3b --tiers t1,t2,t3` acceptance), WP-3b.4 (the check-references lift, closes D-049), each an
independently-green commit (CONTROL §6, mirrors the WP-3a splits D-096/D-098).

This WP threads the §3.3.1 member set onto every stamp record in `s5-stamp.mjs` — `parent`, `depth`,
`region` (page/header/body from the pageShell/titleBand/#header sfsPath markers), `tabKey` (null: no
clean fixture declares a `tabs` region, and tab-membership derivation lands with the tabs subject in
WP-3b.3), `cell{row,index,count,sizing,px,reservePx}`, `rowGroup{row,index,members}` and `align`.
`cell.sizing` is read back from the node's own `desktop.dimensions.width` — the `calc(100% - Npx)` /
`Npx` / auto string s4 already wrote from the responsive intent, which is the exact inverse §3.3.1
blesses for `--legacy` and is the compiler reading its own declaration within one compile, never
inferring geometry from CSS. `s6-serialise.mjs` emits the container as `{schemaVersion, provenance:
"COMPILED", form, kind, nodes}`, keeping `form`/`kind` (the load-bearing fields T1.08/T2.20 read) and
the array shape T1.10 requires. A latent defect surfaced and was fixed, not papered over: the
auto-inserted crud-operations column carries `caption:""`, so `name ?? caption ?? "item"` resolved to
the empty string — `itemName()` now falls through empty strings so no sidecar node has an empty join
key. New: `packages/sfs/schema/compiled-meta.schema.json` and `g-compiled-meta` (compiles every clean
fixture, validates its sidecar against the schema, and asserts the semantics the predicates depend on
— a fill cell reserves, the page shell reads region page); its two mutations tighten the schema past
what the compiler emits and both flip the verdict. All 13 clean fixtures validate; the full green
suite (tests + 25 gates + 77 mutations) passes unchanged, which is the behaviour proof. `prove-b`
gains its `placement sidecar` step.

## WP-3b.2 — The placement predicate engine (D-014) — 2026-08-20

Status: complete
Gate: `node packages/verify/src/gates/g-no-prose-assertions.mjs` -> exit 0 (registry 22 · prose 157, 0 failures); `node --test packages/verify/test/predicates.test.mjs` -> 6/6; `npm run green` -> exit 0 (26 gates, all mutations flip)
Evidence: packages/verify/evidence/WP-3b.2.json
Decisions added: D-105 (the placement predicate engine: frozen 18-name registry, config==engine==schema, contracts are declarative rows); D-014 closed — its `pending:BL-003` becomes the live `g-no-prose-assertions` enforcer (executable predicates now exist), so it archives
Blocked: none new
Next: WP-3b.3 (the T3 semantic tier + the .build/wp3b acceptance)

D-014 ("placement is executable predicates over the compiled tree, not English a model judges") becomes
real. `packages/verify/src/predicates/` is the frozen 18-name engine (`index.mjs` + `tree.mjs`): each
predicate reads placement off the WP-3b.1 sidecar — `cellSizing`/`cellPx`/`ratio` from the declared
`cell`, `parent`/`ancestors`/`nextSibling`/`rowGroupSizes` from the by-parent index, `region`/`tab`/
`align`/`componentType`/`count` direct. `ratio` is a declared-intent width at a 1440px reference
(fill = 1440 − Σfixed − reserve), never a measured pixel; `searchCell:addCell` reads 1024/200 = 5.12
off the toolbar row, which is what makes the DOM's `1fr`→`962px` collapse irrelevant. A predicate on a
missing node returns ABSENT, which the evaluator disposes fail (the node must exist), never
uninspectable. `assertions.schema.json` fixes the contract-row shape `{id,tier,predicate,args,expect}`
with the closed comparator set; `predicates.json` is the single source the engine and schema must both
match. The sidecar gained a per-node `orientation` (row/col) so `rowGroupSizes`/`rowGroupMembers` can
tell a horizontal row from a vertical stack — a col of 2-cell rows sizes `[2,2]`, a col of standalone
panels `[1,1]`. New gate `g-no-prose-assertions` fails on any ```` ```assertions ```` prose block under
`plugins/**` and on any drift between config/engine/schema; its two mutations (smuggle a prose block,
drop a registry name) both flip. It caught a real one: the design-comprehension `blueprint-ir.md` still
carried the English A1–A7 ```` ```assertions ```` block D-014 deletes, so this WP converts the skill's
blueprint format to the executable `contract` block (the exact §3.3.3 conversion — the seven sentences
become predicate rows) across `blueprint-ir.md`, `SKILL.md` and `verification-loop.md`; no code parses
the fence, so the rename is safe. The commit touches `plugins/**`, so `plugin.json` bumps 1.9.1→1.9.2
and `g-plugin-version`'s floor with it. `prove-b` gains its `placement predicates` step.

## WP-3b.3 — The T3 semantic tier (offline core) — 2026-08-20

Status: complete
Gate: `node packages/verify/src/verify.mjs .build/wp3b --screen inline-editable-table --tiers t1,t2,t3` -> exit 0 (t1/t2/t3 all pass); `node --test packages/verify/test/tier-mutations.test.mjs` -> 50/50 (10 t3 mutations flip); `npm run green` -> exit 0
Evidence: packages/verify/evidence/WP-3b.3.json
Decisions added: D-106 (Scope change: WP-3b.3 splits into WP-3b.3 offline core + WP-3b.3b contract checks + WP-3b.3c metadata substrate)
Blocked: none new
Next: WP-3b.3b (the contract checks T3.20/21/22 + fixtures + g-fixture-manifest/g-verdict-integrity)

The full brief T3 is 22 checks across three data sources — offline (tree + registry + sidecar), backend
(entity metadata), and contract (plan.json predicate rows) — so D-106 splits WP-3b.3 into the offline
core (this WP), the contract checks (WP-3b.3b, over the WP-3b.2 predicate engine), and the metadata
substrate (WP-3b.3c, the 6 backend checks + a recorded-snapshot loader, closing D-036). The key finding
that shapes the split: an offline-only tier that declares no backend checks yet PASSES on the clean
`inline-editable-table` (no uninspectable), so BL-003's bare `verify.mjs .build/wp3b --tiers t1,t2,t3`
command already exits 0 here — the exit-0 acceptance lands now, and WP-3b.3c keeps it at 0 by
auto-loading a recorded InventoryItem snapshot when it adds the backend checks.

`packages/verify/src/tiers/t3-semantic.mjs` is the rewrite the quarantine required (D-038/D-049): it
defines no `verdictOf` and no walked/checked pair (D-005), declaring its 8 families with `families()`
and yielding to the driver's `verdictOf`, exactly like `t2-registry`. It ships 10 offline checks over
the single `walkComponents` walker: T3.04 (no duplicate propertyName within a data scope), T3.08 (a
component whose registry `requiredProps` includes `formId` carries one), T3.10 (`onSuccess` resolves to
an in-tree id or a known global-action owner), T3.12 (data components have a `dataContext` ancestor with
the four required props), T3.13 (`dataContext.entityType` equals the form entity), T3.14 (at most one
primary button per zone), T3.16 (submit pipeline matches kind — list has none, create/edit has one),
T3.17 (embedded scripts parse, via the AsyncFunction constructor — the same syntax check as `node
--check`, without a subprocess per script), T3.18 (mustache roots are one of the six known scopes), T3.19
(a row-click surface is not wired both by `onRowClick` and `rowClickActionConfiguration`). It is wired
into `verify.mjs` (replacing the `notRun` stub), passing the form entity from the envelope's `ModelType`.
`g-mutation-coverage` and `tier-mutations.test.mjs` gain the t3 tier; all 10 mutations flip their named
family (`tier-mutations` 50/50), and each was adversarially confirmed to reject the wrong answer, not
merely pass clean. The six backend checks (T3.01/02/05/06/07/09), the datatype/action-owner registry
checks (T3.03/T3.11) and the three contract checks (T3.20/21/22) are added to `checks[]` by WP-3b.3b/3c,
so `g-mutation-coverage` never sees an uncovered id. `prove-b` gains its `T3 semantic tier` step.

## WP-3b.3b — The T3 contract checks (placement, columns, tabs) — 2026-08-20

Status: complete
Gate: `node packages/verify/src/gates/g-verdict-integrity.mjs` -> exit 0; `node packages/verify/src/gates/g-fixture-manifest.mjs` -> exit 0; `node packages/verify/src/verify.mjs .build/wp3b --screen employees-table --tiers t3` -> exit 0 (placement 7 · columns 1 · tabs 1); `npm run green` -> exit 0
Evidence: packages/verify/evidence/WP-3b.3b.json
Decisions added: D-107 (the T3 contract checks read a per-screen contract fixture and evaluate it through the WP-3b.2 engine; g-fixture-manifest validates it, g-verdict-integrity recomputes it)
Blocked: none new
Next: WP-3b.3c (the metadata substrate + the 6 backend checks; closes D-036)

The three contract checks make D-014's placement predicates verify a real screen. `t3-semantic.mjs`
gains the `placement`, `columns` and `tabs` families and checks T3.21 (every non-tab contract
predicate evaluates true), T3.22 (every `tab` predicate evaluates true), and T3.20 (the compiled
datatable's data-column captions equal the contract's declared set, in order). The contract is
declarative data at `packages/sfs/test/fixtures/contracts/<screen>.contract.json` — `{acceptance:
[predicate rows], columns:{<datatable>:[captions]}}`; `verify.mjs` loads it (a run-dir copy overrides
the committed one) and the tier evaluates each row through the WP-3b.2 engine, one row one pointer, no
eval. A screen with no contract walks these families zero, so the `inline-editable-table` exit-0
acceptance is unchanged; `employees-table` gains a committed contract (8 acceptance rows + an 8-column
set) that is TRUE of its compiled form. Two new gates: `g-fixture-manifest` (each contract is
schema-valid against assertions.schema.json, names only registry predicates, targets a real screen,
and is within its 32 KB cap) and `g-verdict-integrity` (recomputes every contract over its
freshly-compiled screen and fails on drift — a contract that no longer matches its form is caught,
never trusted; both also assert determinism). All four new checks/gates are adversarially verified:
the tier's three contract mutations flip (`tier-mutations` 53/53), and each gate's two mutations flip
(a drifted contract row, a wrong column set; an unknown predicate, a ghost screen). `g-mutation-
coverage` now covers T3.20/21/22; the gate ratchet rises 26 -> 28. T3.22's real tabbed-form coverage
(sidecar `tabKey` is `null` until the compiler resolves `tabs` regions) lands with the tabs fixture in
WP-3b.3c/later; here it is exercised by an `isNull` contract row and a mutation. `prove-b` gains its
`placement contract` step.

## WP-3b.3c — The T3 metadata substrate (backend checks) — 2026-08-20

Status: complete
Gate: `node packages/verify/src/verify.mjs .build/wp3b --screen inline-editable-table --tiers t1,t2,t3` -> exit 0 (snapshot auto-loads, T3.01/02 resolve); `node packages/verify/src/verify.mjs .build/wp3b2 --screen bookings-table --tiers t3` -> exit 3 (partial, 14 uninspectable, no snapshot); `node packages/verify/src/gates/g-uninspectable-budget.mjs` -> exit 0; `npm run green` -> exit 0
Evidence: packages/verify/evidence/WP-3b.3c.json
Decisions added: D-108 (the T3 backend checks resolve against a recorded metadata snapshot verify.mjs auto-loads, degrade to uninspectable without one, and are bounded by uninspectable-budget.json); D-036 closed — its `pending:BL-003` becomes the live `check:t3-semantic:T3.02` enforcer (the executable casing check now exists)
Blocked: none new
Next: WP-3b.4 (fix the 12 dangling plugin refs, lift g-check-references; closes D-049)

The five backend checks make T3 read entity metadata without a live backend. `t3-semantic.mjs` gains
T3.01 (a data-column binding names a property that exists on the bound entity), T3.02 (the binding is
camelCase as the metadata spells it — the §1.2#10 blank-cell defect, D-036), T3.06 (referenceListId
resolves), T3.07 (formId {name,module} resolves) and T3.09 (a datalist row-template exists and differs
from its own form). Their source is a recorded snapshot — `packages/sfs/test/fixtures/metadata/
<screen>.metadata.json`, the D-036 `result.properties[]` shape with PascalCase paths — that `verify.mjs`
auto-loads per screen (an explicit `--metadata` or a run-dir copy overrides it); absent a snapshot each
check disposes `cannot("metadata unavailable…", <id>)` → uninspectable → partial, exit 3, never a pass
(§3.2.4 backend-degradation rule). An `inline-editable-table` InventoryItem snapshot ships so BL-003's
bare command stays exit 0 now that the backend checks are declared; `bookings-table`, with no snapshot,
correctly degrades to partial (14 uninspectable). `uninspectable-budget.json` + `g-uninspectable-budget`
bound the licence to say "I couldn't look" to exactly these five ids (each with a reason pattern and the
admitting decision D-108); its two mutations (a check id no tier exports; the set past its max) flip.
D-036 closes: its enforcer moves from `pending:BL-003` to `check:t3-semantic:T3.02`, so `g-decisions`'
inputPaths gain `packages/verify/src/tiers` (the first `check:` enforcer needs the tier staged in the
mutation harness). All eighteen T3 checks are covered — `tier-mutations` 58/58, `g-mutation-coverage`
green — and every backend mutation was adversarially confirmed to flip its family with the snapshot in
place. T3.03 (datatype-component pairing), T3.05 (required inputs on create/edit) and T3.11 (action-owner
ownership) stay deferred: they need entity metadata or registry data (datatype-components, action-owners)
that must be sourced from the framework, not guessed — WP-2b territory (D-108). The gate ratchet rises
28 -> 29. `prove-b` gains its `T3 metadata substrate` step.

## WP-3b.4 — Lift g-check-references out of quarantine — 2026-08-20

Status: complete
Gate: `node packages/verify/src/gates/g-check-references.mjs` -> exit 0 (links 138 · paths 8 · skills 14 · roles 4 · groups 65, 0 failures); `node packages/verify/src/gates/g-disposition.mjs` -> exit 0; `npm run green` -> exit 0 (30 gates)
Evidence: packages/verify/evidence/WP-3b.4.json
Decisions added: D-109 (WP-3b lifts the two BL-003 quarantined files; supersedes D-049, which is now superseded-by-D-109 and enforced by the live g-check-references)
Blocked: none new
Next: WP-2b (registry completeness) — the last offline T3-adjacent WP done; the T3 subsystem is complete

The second half of D-049. `check-references.mjs` becomes `packages/verify/src/gates/g-check-references.mjs`
on the one coverage implementation, closing both holes the quarantine recorded: it declares its family
set up front with `families()` (the lazy `fam()` that let 9 pointers vanish silently is gone — R2), and
every JSON read goes through `readJsonGuarded` (a malformed data file is one named failure, never the
uncaught SyntaxError that read as a clean exit). Six families survive: links, paths, skills, roles,
groups, and skill/agent-id resolution (folded into `skills` — the current design skills dispatch agents
in prose, not the old `` `x` agent`` pattern, so a separate always-empty `agents` family would trip R1;
every `shesha-developer:X` ref now must resolve to a skill OR an agent). The original's `overlays` (block
`$styleOverlay` files) and `versions` (component versions vs an in-plugin components-kb) are dropped, not
weakened: their subjects left with shesha-form-edit — the block library (D-010 resolves styling at
compile time, no overlay pass) and the KB (relocated to packages/sfs/kb, D-095, where the registry owns
version authority).

Lifting it required cleaning the debt WP-7a's deletion of shesha-form-edit left: 68 dead references to
the deleted skill across 19 design-skill and agent files. A pilot-disciplined fan-out repointed every
skill-delegation reference to `shesha-spec` (the SFS-authoring replacement) and removed every dead
file/asset link (the 32 deleted reference files, the block library, the relocated KB, the 3
gate-flagged dead paths); `grep shesha-form-edit` now returns zero. The quarantine's two BL-003 files
(t3-semantic.mjs — already superseded by the T3 tier in WP-3b.3 — and check-references plus its negative
script) are deleted, their `quarantine.json` rows removed (only BL-005's layout-probe remains), with
disposition delete rows against WP-3b.4. `g-disposition` gained a move-then-delete rule: a completed
move whose destination a later completed WP deletes (a lift) is legitimate, not a failed move; its
mutations still flip. The lift touches `plugins/**`, so `plugin.json` bumps 1.9.2 -> 1.9.3 and the
floor with it. The gate ratchet rises 29 -> 30. `prove-b` gains its `check-references lift` step. With
this, WP-3b is complete: the full-brief T3 tier, its placement engine, its metadata substrate, and both
quarantined files lifted.

## WP-9 — Precedent retrieval, shape-indexed (Index A) — 2026-08-20

Status: complete
Gate: `node --test packages/precedent/test/*.test.mjs` -> 11/11 (includes the 5000-row scan <= 50ms); `node packages/verify/src/gates/g-rag-isolation.mjs` -> exit 0; `npm run green` -> exit 0 (31 gates)
Evidence: packages/verify/evidence/WP-9.json
Decisions added: D-110 (precedent is a deterministic shape Index A over the compiled corpus, JSONL not node:sqlite, no embedding; RAG is never a correctness lookup, enforced by g-rag-isolation)
Blocked: none new
Next: WP-2b (registry >= 93/121) — the last large offline WP

`packages/precedent` replaces its `E_NOT_IMPLEMENTED` scaffold with real shape-indexed retrieval
(BL-009, §4.7). Per the strategy doc the primary index is SHAPE, not embedding: `shapeOf(form)`
computes a form's kind, entity depth, node multiset, region topology (the component-type tree
serialised depth-first), column count, action intents, tabs and responsive signature — all exact, no
GPU, no model, no network, reproducible across machines. `similarity` is
`0.5·nodeMultiset-jaccard + 0.3·topology-trigram-jaccard + 0.2·kind`; the trigram shingle is a
deterministic proxy for normalised tree-edit distance that keeps a full 5000-row scan under the 50 ms
budget (`shape.test.mjs` asserts it) — a real O(n^2) edit distance would blow it, which is the whole
argument against a vector extension at this corpus size. The package is dependency-layer 0
(g-workspace-hygiene): it imports nothing from `@shesha/sfs` or `@shesha/registry`, so it carries its
own tiny node walk and shapes the corpus markup directly rather than reaching up to the decompiler
(which also fails on 4 corpus forms until BL-024). Storage is one gitignored JSONL file, never
`node:sqlite` (flag-gated on Node 22; an unflagged import throws); Index B's `Float32Array` embeddings
are BL-H1 — a request for `method:"embedding"` degrades to shape and sets `degraded`, never a silent
empty, and an empty index is a hard `E_EMPTY_INDEX`, never a false "no precedent exists". The RAG
prohibition (§4.7.1) ships as `g-rag-isolation` (3 mutations, all flipping): the compiler and verifier
never import the retrieval package, precedent never imports the compiler, and no skill routes a
props/versions/enums question to it (patterns in `rag-forbidden.json`); its detection regexes live in
`source-patterns.json` so the gate never matches its own source. The gate ratchet rises 30 -> 31.
`prove-b` gains its `precedent index` step.

## WP-6 — Corpus round-trip, the biggest-wins lift (4 -> 7 clean) — 2026-08-20

Status: complete
Gate: `npm run sfs -- roundtrip --scope packages/sfs/config/roundtrip-expected.json` -> exit 0, `rate 1.00 (clean 7/7)`; `node packages/verify/src/gates/g-escape-budget.mjs` -> exit 0 (rate 0.20 -> 0.125); `npm run green` -> exit 0
Evidence: packages/verify/evidence/WP-6.json
Decisions added: D-111 (the datatable-column + action-grammar lift; enforcer g-escape-budget). Closes GAP-001; refines BL-024 to name the remaining corpus node-types
Blocked: none new — the four still-triaged forms need the sectionSeparator/collapsiblePanel/tabs node-types (BL-024)
Next: WP-2b (needs the framework source at the pinned commit — see the resource note)

WP-6/BL-002 asks the corpus round-trip to clear `rate >= 0.90`. The scope answer for this session
was "biggest wins only" (the user's directive): lift the shared root-cause defects that clear the most
forms, and leave the long tail — the container node-types no *cheap* fix reaches — as backlog. Two
root causes were doing all the damage. First, the **datatable-column decompile** produced schema-invalid
SFS on four forms (DEC-7001): it copied an empty `caption` (min-length 1) and an empty `propertyName`
into a `bind` the pattern rejects, emitted no SFS node for an `action` column, and produced a dotted
`referenceListId.name` (`Shesha.RequirementsStudio.RsStatus`) the `refListRef` pattern forbade.
`liftColumns` now omits an empty bind/caption, lifts an action column to a `do` (or drops it as a
counted escape, DEC-7306, when its config will not lift), and the schema's `refListRef` name segment
allows the dotted qualified names production actually carries; the compiler's action-column path is its
column index (unique when two action columns share or drop a caption). Second, **the action-intent
grammar** (§2.1.7, GAP-001) voided the lift of every production `Show Dialog`/`Submit`/edit config:
`openDialog` gained an `argIgnore` for the framework-internal `version`/`customWidth`/`showCloseIcon`
(regenerated, not user-meaningful), the `confirm` (Show Confirmation Dialog), `closeDialog`, `startEdit`
and `cancelEdit` intents were added (all measured from the corpus, the same provenance basis as the
seed six), the action `do` enum grew to admit them, and `openDialog`'s `with.args` accepts the script
string `formArguments` genuinely is. Together these raised the corpus round-trip from **4 to 7 clean
and stable** forms (employee-table, employee-create, rs-table joined the declared clean set) and closed
GAP-001; `g-escape-budget` ratcheted the structural-escape rate down 0.20 -> 0.125. The four forms that
remain `triageOnly` escape *only* on three container/leaf node-types the compiler does not yet emit —
`sectionSeparator`, `collapsiblePanel`->`panel`, `tabs` — each of which needs a registry `sfsNode`
overlay, bespoke compiler expansion, and a decompiler lift (tabs also feeds T3's tabKey). Those are the
genuine BL-024 long tail; lifting them to reach all-12 is WP-6's remaining path, best paired with the
framework source (for D-097-faithful node contracts). `prove-b` gains its `corpus round-trip` step,
which reports the honest 7-of-12 breakdown, not a bare rate.

## WP-2b — The full registry, source-parsed from the framework (12 -> 93 full) — 2026-08-21

Status: complete
Gate: `node packages/registry/src/validate.mjs` -> exit 0, `full 93/121 · deferredAuthorable 7`; `node packages/registry/tools/parse-framework-props.mjs --check` + `gen-registry --check` -> byte-identical; `node packages/verify/src/gates/g-registry-completeness.mjs` -> exit 0 (5 mutations, all flip); `npm run green` -> exit 0
Evidence: packages/verify/evidence/WP-2b.json
Decisions added: D-113 (the reproducible settings-form extractor lifts full 12 -> 93; `full >= 93` and `deferredAuthorable <= 7` become §2.8.4 demands; `framework-verified` counts as full-derived; `paragraph` reclassified legacy; enforcer g-registry-completeness). D-098 archived earlier (WP-9 fix); this commit archives one more closed row to hold the DECISIONS byte ratchet.
Blocked: none new — the 7 remaining deferred widgets genuinely carry no migrator in the source, so no version can be assigned without inventing one (D-114 upheld)
Next: WP-16b (brief-bundle relocation), then the restart/backend-gated WP-8, WP-3c, WP-3d

WP-2b/§2.8.4 (BL-004/020/022) asks the registry to reach `full >= 93/121` and shrink the deferred set
below 8, using the framework source at the pinned commit (present at `.build/framework` @ `3418e292f`).
The original `_framework-props.json` covered only the 13 priority types and was an ad-hoc hand parse; a
**reproducible extractor** — `packages/registry/tools/parse-framework-props.mjs` — now replaces it. Per
the L0 lesson (2026-08-19: agents that read only the TS interface GUESS `colorRef`/`cssSize`/`codeSetting`
from prop NAMES), the extractor reads the authoritative signal — each component's SETTINGS FORM — and maps
the per-prop editor kind DETERMINISTICALLY to a registry valueType (`colorPicker`->colorRef,
`codeEditor`->codeSetting, `contextPropertyAutocomplete`->entityPath, `referenceListAutocomplete`->refListRef,
`iconPicker`->icon, `permissions`->permissionRef, `configurableActionConfigurator`->actionConfig,
`formAutocomplete`->formRef, `dropdown`/`radio`->enum from a literal option domain, else the primitive). A
prop whose editor kind is not mappable is OMITTED, never guessed; `required` comes from `validate.required`;
enum domains come from a literal `dropdownOptions`/`values` array (never invented). It parses both fluent-builder
`.ts` and json-markup `.json` forms via the TS AST, and is byte-deterministic (`--check`). `gen-registry.mjs`
now applies its Layer-2 salient replacement to every framework-typed component (not just the 13 priority
anchors, which stay preserved verbatim); a component is `full` when its whole salient set (base contract +
own props) is framework-derived. Three real fixes carried the last three: a null overlay prop no longer
clobbers a source-parsed one; `completenessOf` counts the compiler's `framework-verified` provenance
(container.direction, dataContext.uniqueStateId, datatable.crud — all confirmed in source) as full-derived
alongside source-parsed; and `paragraph`, which ships under the framework's `_legacyComponents/`, is
reclassified `legacy` rather than version-unknown, dropping deferredAuthorable 8 -> 7. The 7 that remain
deferred were proven to carry no migrator at all in the source, so no honest version exists to establish
(D-114's "without inventing a number" upheld). Result: `full` rises **12 -> 93/121**, `valueTyped` 13 -> 93,
`deferredAuthorable` 8 -> 7; `registry-ratchet.json` gains the `fullAtLeast:93`/`deferredAuthorableMax:7`
demands and a `full` up-ratchet, and `g-registry-completeness` gains two mutations that flip on a full
regression and a deferred rise. A 4-slice adversarial workflow audited all 88 non-priority entries against
the source and returned **PARSE-HONEST** (0 blockers, 0 concerns): every semantic ref type was confirmed
against the real editor kind, no enum values were invented, no base name leaked, no layout kind became a
prop. Its one note — json-markup dropdowns carry the option domain under a `values` key — was closed by
reading that key too, upgrading ~8 props (image.objectFit, space.direction, link.target, …) from `string`
to a precise `enum`. `prove-b` gains its `full registry` step.

## WP-8a — Run-dir + 7 handoff schemas (operating layer, part 1 of D-115) — 2026-08-24

Status: complete
Gate: `node --test packages/verify/test/schemas.test.mjs` -> `# pass 14 # fail 0` (7 ajv-strict compiles + `--test-name-pattern "plan rejects"` -> 5); `node packages/verify/src/gates/g-run-dir-location.mjs` -> exit 0 (2 families); `npm run green` -> exit 0 (32 gates)
Evidence: packages/verify/evidence/WP-8a.json
Decisions added: D-116 (the 7 handoff schemas + the plan schema's five structural impossibilities; enforcer schemas.test), D-117 (run dirs live at runs/<runId>/, not the pre-rebuild .claude/shesha/runs/; enforcer g-run-dir-location)
Blocked: none new
Next: WP-8b (the 6 runner/decide hooks + hooks.test + g-hook-contract/g-hook-liveness + push-admissible, plus the `sfs validate`/`run` CLI the hooks spawn)

WP-8a is the first of the four WP-8 sub-WPs (D-115): the run-directory contract. It ships the **seven handoff schemas** in `packages/sfs/schema/` — `plan`, `manifest`, `verdict`, `dispatch`, `sfs-meta`, `lock`, `blueprint` — each draft-2020-12, `$id` `https://boxfusion.io/shesha/sfs/<name>.schema.json`, `additionalProperties:false` at every object level, and compilable under `new Ajv2020({strict:true})` (a `(?i)` inline flag or a missing `type` throws at `compile()`, not at validate; the one union type — `manifest.screens[].tokens` — is `{}` any, since `{strict:true}` rejects a multi-type array without `allowUnionTypes`). `schemas.test.mjs` asserts the seven compile (row 2) and the **five defect classes the plan schema makes structurally impossible** (row 3): a screen with no `contract` (required); an all-visual contract (`predicates.contains {tier:{const:"T3"}}`); a **prose** assertion (`predicate` must match `^[a-z][A-Za-z0-9]{2,39}$`, so `"body is a 2-column split; ratio ≈ 18:6"` cannot validate); a repair loop above 3 (`repairPolicy.maxRounds const:3`); two authors on one form (`fanout.withinScreen const:1`). `g-run-dir-location` (D-117) fails on any file at the pre-rebuild `.claude/shesha/runs/` path and on a `runs/` that is not gitignored — two families, two verdict-flipping mutations; the gate-ratchet floor rises 31 -> 32. `prove-b` gains its `handoff schemas` step. The `sfs validate`/`run` CLI that D-115 grouped under 8a moves to WP-8b, where the hooks that spawn it live and exercise it — the schemas it validates against are frozen here.

