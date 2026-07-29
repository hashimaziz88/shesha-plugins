# The form-push validation hook

`plugins/shesha-developer/hooks/` ships a `PreToolUse` hook that can deny a
`Bash`/`PowerShell` tool call before it reaches the Shesha backend, if the
command pushes a form (`UpdateMarkup` or `ImportJson`) and the markup fails a
curated subset of `validate-form.mjs`'s checks. It is **enabled by default**
for that curated subset — not for every Tier 1/2 finding.

## Why not "deny on any Tier 1/2 finding"?

That was the original design (Phase 2 plan, Task 6). Task 5 graded 935 real
production forms plus this skill's own 15 bundled seeds against the
validator and found a blanket gate would be unusable in practice:

- `T1-PROP-UNKNOWN` fires on 93.9% of real forms and **100% of this plugin's
  own bundled seeds**.
- `T1-VERSION-STALE` fires on 83.9% corpus-wide (though that number hides a
  registry/project version-mismatch artifact — see
  `docs/corpus-report.md`).
- Several more Tier 2 codes sit between 20% and 69%.

A gate that blocks the skill's own recommended starting point ("copy the
matching example... push", per `SKILL.md`) gets disabled on day one, and the
whole exercise is wasted. So the hook gates a **small, evidence-selected
subset** instead, and it **normalizes before validating** — anything
`normalize-form.mjs` can mechanically repair never reaches the gate.

## What it gates: the three groups

The groups live in `hooks/gate-policy.json`, each code carrying its measured
corpus hit-rate and a one-line justification. Edit that file to change what
blocks a push — no code change needed.

### Group A — BLOCK (normalizer cannot fix these)

Render-crash family (32 crash signatures recorded in a 2-day telemetry
window) plus low-rate structural contract breaks:

| Code | Corpus rate |
|---|---|
| `T1-JSON-UNSAFE` | 15.5% |
| `T1-SCRIPT-SYNTAX` | 2.2% |
| `T1-DEFAULTVALUE-NONSTRING` | 5.2% |
| `T1-EDITCOMPONENT-SHAPE` | 0.2% |
| `T1-TYPE-UNKNOWN` | 3.9% |
| `T1-DOUBLE-SLOT` | 6.5% |
| `T2-VALIDATIONERRORS-MISSING` | 15.4% |
| `T2-SUBMIT-WIRING` | 1.9% |
| `T2-EXIT-MISSING` | 0.1% |
| `T2-DATACONTEXT-PROPS` | 0.4% |
| `T2-DATE-COMPONENT` | 0.4% |

### Group B — NORMALIZE THEN BLOCK

`normalize-form.mjs` repairs these mechanically. Because the hook always
normalizes before validating, a Group B code appearing in the validator's
output means normalization already ran and the finding **survived** it —
that's what makes blocking here safe.

| Code | Corpus rate (pre-normalize) | What fixes it |
|---|---|---|
| `T1-ID-DUPLICATE` | 11.4% | Phase B `fixId` mints a deterministic replacement id |
| `T1-PARENT-MISSING` | 33.2% | Phase B stamps `parentId` from the walked tree |
| `T1-VERSION-MISSING` | 27.4% | Phase B stamps `version` from the registry |
| `T2-WIDTH-ON-NONCONTAINER` | 19.9% | Phase A5 strips `dimensions.width` off non-containers |
| `T2-FLEXCHILD-NOT-CONTAINER` | 12.5% | Phase A3 wraps bare flex-row children |
| `T2-COLUMNS-PRESENT` | 23.3% | Phase A2 converts `columns` to a flex container |
| `T2-FLEX-NO-DISPLAY` | 62.4% | Phase A6 sets `display:"flex"` when a flex prop is set without it |

### Group C — REPORT ONLY, never blocks

Every Tier 3 code (observe-only by design), plus the Tier 1/2 codes measured
too noisy or too freshly-fixed to gate today: `T1-PROP-UNKNOWN`,
`T1-VERSION-STALE`, `T2-STYLE-INCOMPLETE`, `T2-EDITMODE-MISMATCH`,
`T2-PROPERTYNAME-CASE`, `T2-LOOSE-BUTTON`, `T2-MODELTYPE-SHAPE`,
`T2-DROPDOWN-SOURCE`, `T2-STYLE-OFF-TOKEN`. These still show up in the
validation log so they stay visible — they just can't halt a push.

## How the hook decides

1. Fires on `PreToolUse` for `Bash`/`PowerShell` commands. If the command
   doesn't contain `UpdateMarkup` or `ImportJson`, the hook is a total
   no-op (**ignored**, nothing printed, nothing logged).
2. Extracts the markup file path from the command:
   - `ImportJson` uploads the tree directly (`-F "file=@path.json"`).
   - `UpdateMarkup` ships it wrapped in a DTO (`-d @body.json` where
     `body.json` is `{ id, markup: "<stringified tree>" }`) — the hook
     unwraps the `markup` field before validating.
   - **If the path can't be found, or the file can't be read/parsed, the
     hook allows the call and logs a `skip`.** This is deliberate: a hook
     that blocks what it cannot parse halts all legitimate work.
3. Runs `normalize()` then `tier1()`/`tier2()` on the result.
4. Denies only if a **Group A** finding is present, or a **Group B**
   finding survived normalization. Everything else (Group C, and any
   unlisted code) is reported in the log but never blocks.
5. On deny, `permissionDecisionReason`/`additionalContext` lead with the
   finding count, then list findings with path + message, truncated well
   under the 10,000-character hook output cap (the full list is always in
   the log).
6. Every decision — `allow`, `deny`, `skip`, `bypass` — is appended as one
   JSON line to `${CLAUDE_PLUGIN_DATA}/validation-log.jsonl`. (`ignore`
   decisions, i.e. ordinary non-push commands, are not logged.)
7. A `Stop` hook checks, conservatively, whether any form pushed this
   session ended in a `deny` with no later passing push for that same
   path; if so it blocks the stop, naming the form. Any ambiguity —
   missing log, unreadable line, unknown session — allows.

## Narrowing, widening, or bypassing

- `SHESHA_SKIP_FORM_VALIDATION=1` — bypasses validation entirely for a
  single call. Always logged as `bypass`. Use sparingly; it defeats the
  point of the gate.
- `SHESHA_FORM_GATE=off|groupA|full` — controls which findings can deny:
  - **unset (default) / `full`** — Group A and Group B-survived both block.
  - **`groupA`** — only Group A blocks; Group B findings are reported but
    never deny, even if they survived normalization. Use this to narrow the
    gate on a project where the normalizer's Group B fixes aren't trusted
    yet.
  - **`off`** — nothing blocks; the hook still runs, still normalizes and
    validates, still logs, but the `permissionDecision` is always `allow`.
    Use this to widen back to observe-only without uninstalling the hook.

## Reading the log

`${CLAUDE_PLUGIN_DATA}/validation-log.jsonl` — one JSON object per line,
newest last. Common fields: `ts`, `sessionId`, `toolName`, `decision`
(`allow`/`deny`/`skip`/`bypass`), `command`, `formPath`, `gateMode`, and for
`deny`/`allow` respectively `blockingCodes`/`reportedCodes` with their
counts. Grep it for `"decision":"deny"` to see every push this gate has
stopped, or for a specific `formPath` to see a form's full validation
history across pushes.

## Changing what's gated

Edit `hooks/gate-policy.json` — move a code between groups, or add a new
one — and re-run `hooks/tests/validate-push.test.mjs`. No change to
`validate-push.mjs` itself is needed unless the *mechanism* (how a decision
is made) changes, not just *which codes* are in which group.
