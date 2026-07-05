# Multi-agent orchestration for form fleets

When work spans many forms (or many full-stack pages), single-context editing degrades — context fills with markup, later forms get sloppier, and verification gets skipped. This file is the dispatch playbook. Mechanics of the transforms themselves: [bulk-operations.md](bulk-operations.md). Routing thresholds: [levels.md](levels.md).

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

Exit criteria per stage: audit = every target has a verdict; pilot = assertions pass AND browser checks pass (computed styles, not screenshots); rollout = every push re-fetched and asserted **against the published version** (versionStatus==3, new versionNo); re-audit = zero `fail` verdicts.

### 0.43 — each per-form push in the fleet follows the version lifecycle

On 0.43, forms are versioned ConfigurationItems, so a fleet transform is **not** a bare `UpdateMarkup` per
target. For **each** form the transform script must resolve status and branch (status `1=Draft, 2=Ready,
3=Live, 4=Cancelled, 5=Retired`; full algorithm in [version lifecycle](version-lifecycle.md#edit-algorithm)):

- **Live(3):** `CreateNewVersion{id}` → `UpdateMarkup` the returned **Draft** id → `UpdateStatus` 1→2→3 (auto-retires old Live). Never `UpdateMarkup` the Live id in place — that clobbers the published form.
- **Draft(1)/Ready(2) in flight:** reuse that version (`UpdateMarkup` on it), publish when the assertions pass.
- **Retired(5)/Cancelled(4):** skip / resolve to the latest non-terminal version first — never write a terminal revision.

Per-form invariant: `CreateNewVersion` **at most once** per form per rollout; if the pilot/verify loop
re-pushes, it re-pushes to the **same** Draft, and publishes **once**. The **pilot** proves the whole
branch→push→publish path on ONE form before the rollout replicates it across all targets — so a lifecycle
mistake (e.g. clobbering Live) is caught on one form, not N.

---

## The agents (defined in this plugin — dispatch via the Task tool)

| Agent | Use for | Model | Never |
|---|---|---|---|
| `shesha-developer-0-43:form-author` | Drafting genuinely distinct new forms, one agent per form, in parallel | inherit | pushing |
| `shesha-developer-0-43:form-auditor` | Read-only verdict per form, before bulk pushes and after rollouts | sonnet | editing |
| `shesha-developer-0-43:fleet-transformer` | ONE per bulk mutation — writes the transform script, pilots, rolls out | sonnet | one-per-form |
| `shesha-developer-0-43:fullstack-prereq-checker` | Backend readiness before entity-bound work | haiku | fixing |

---

## Shared state between agents

Authenticate ONCE; write the bearer token to a workspace file (e.g. `<workspace>/.token`) and pass the path in every dispatch prompt — agents `cat` it instead of re-authenticating. Put the audit spec / transform spec in a JSON file and pass its path too. Every dispatch prompt must include: the skill root path, backend URL, token-file path, module, the form(s), and the expected output contract.

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

The RequirementsStudio 2026-06 rollouts that shaped this playbook: a 16-form auditor fan-out (sonnet) verified subtable canon with a strict verdict schema (`{form, pass, formLoads, checkResults[], summary}` — per-tab fields like `addForm/labelOk/iconOk/actionOk/formArgsParentFkOk`); the KIB divider redesign ran as ONE transform script (`transform-kib-all.js`) piloted on `module-definition-details` then rolled to 16 forms with component-count-delta guards; the create-forms cleanup fixed 33 forms in one scripted pass with field-set assertions, audited to 0 issues pre- and post-push.
