# Multi-agent orchestration for form fleets

When work spans many forms (or many full-stack pages), single-context editing degrades — context fills with markup, later forms get sloppier, and verification gets skipped. This file is the dispatch playbook. Mechanics of the transforms themselves: [bulk-operations.md](bulk-operations.md). Routing thresholds: SKILL.md Step R (fleet mode past ~3 forms changed or a multi-page/app brief; below that stay inline).

---

## The canonical fleet loop

```
audit-all (auditor fan-out, 1 agent/form)
   → classify failures, decide the transform
   → pilot (ONE fleet-transformer, 1 form) → browser-verify pilot (verification.md)
   → roll out (same transformer, same script, all targets)
   → re-audit (auditor fan-out)
   → synthesize report
```

Exit criteria per stage: audit = every target has a verdict; pilot = assertions pass AND browser checks pass (computed styles, not screenshots); rollout = every push re-fetched and asserted; re-audit = zero `fail` verdicts **including the `appearance` family**.

**Audit and re-audit specs MUST include the `appearance` check family** (the appearance floor in `form-quality.md` / the auditor's `appearance` checks). A built-but-unstyled form is a `fail`, not a cosmetic nit — styling silently dropping on later forms is the single most common fleet defect.

---

## The agents (defined in this plugin — dispatch via the Task tool)

| Agent | Use for | Model | Never |
|---|---|---|---|
| `shesha-developer:form-author` | Drafting genuinely distinct new forms, one agent per form, in parallel | inherit | pushing |
| `shesha-developer:form-auditor` | Read-only verdict per form, before bulk pushes and after rollouts | sonnet | editing |
| `shesha-developer:fleet-transformer` | ONE per bulk mutation — writes the transform script, pilots, rolls out | sonnet | one-per-form |
| `shesha-developer:fullstack-prereq-checker` | Backend readiness before entity-bound work | haiku | fixing |

---

## Shared state between agents

Authenticate ONCE; write the bearer token to a workspace file (e.g. `<workspace>/.token`) and pass the path in every dispatch prompt — agents `cat` it instead of re-authenticating. Put the audit spec / transform spec in a JSON file and pass its path too. Every dispatch prompt must include: the skill root path, backend URL, token-file path, module, the form(s), and the expected output contract.

## Per-form manifest (mandatory for any multi-form run)

Maintain `<workspace>/form-manifest.json` — one entry per target form, updated after **every** stage:

```json
[
  { "module": "MyModule", "name": "person-create", "id": "<guid|null>",
    "built": true, "styled": true, "audited": true, "pushed": true, "verified": false }
]
```

- Create the manifest when the plan is made (every planned form gets an all-`false` entry) — forms are forgotten at planning time, not build time.
- **No run is complete while any form has `styled: false` or `verified: false`.** "Built but unstyled" and "pushed but never re-fetched" are the two states that silently ship broken.
- The final summary is generated **from the manifest**, never from memory — list every form with its flags. A form missing from the summary is a form missing from the manifest, which is the defect.

## Dispatch prompt template — auditor fan-out

> You are auditing one Shesha form. SKILL_ROOT: `<path>`. Backend: `<url>`, bearer token in `<token-file>`. Form: module `<module>`, name `<form>`. Audit spec: `<spec-file>` (run check families: `<families>`). Fetch via GetByName — `result.markup` is double-stringified (parse the envelope, then parse the markup string). Return ONLY the JSON verdict contract from your agent definition.

## Dispatch prompt template — fleet transform

> SKILL_ROOT: `<path>`. Backend `<url>`, token `<token-file>`. Targets: `<form list>`. Pilot: `<form>`. Approval mode: pilot-stop. Transform spec: `<spec-file>`. Assertions: `<list — e.g. field-set unchanged, component delta == N>`. Follow references/bulk-operations.md exactly.

## Synthesis

One final agent (or do it inline): aggregate the verdicts; use ONLY the data provided — do not invent issues; report per-form pass/fail, the failure clusters, and what was NOT covered (no silent truncation).

---

## Cost guidance — when fan-out pays

| Situation | Do |
|---|---|
| ≤ 3 forms | Single context, no agents. Dispatch overhead exceeds the benefit. |
| Audits / verification, > 3 forms | Fan out `form-auditor`, one per form — read-heavy, independent, parallel. Proven at 16+ forms. |
| The same mechanical change on N forms | ONE `fleet-transformer`. The script costs the same for 1 or 50 forms; per-form agents multiply cost AND drift. |
| N genuinely distinct new forms | Parallel `form-author` dispatches (judgment is per-form; wall-clock wins). Push + audit centrally afterwards. |
| Entity-bound work, unverified backend | One `fullstack-prereq-checker` first — a haiku-priced gate that prevents authoring against missing entities. |

Pilot-first is itself a cost control: a wrong fleet rollout costs 2× (rollback + redo); the pilot caps the blast radius at one form.

---

## Permissions caveat

Plugin agents do not inherit a `permissionMode`. The fleet-transformer's `curl` pushes will hit permission prompts in strict sessions — pre-approve the Bash patterns (`curl` against the backend) or run fleet operations in an accept-edits/bypass session. In fully headless runs (test harness) this is already bypassed.

---

### Worked example (project-specific)

Provenance: shaped by live 2026-06 fleet rollouts — a 16-form auditor fan-out with a strict verdict schema, a one-script KIB transform piloted then rolled to 16 forms with component-count-delta guards, and a 33-form scripted cleanup audited to 0 issues pre- and post-push.