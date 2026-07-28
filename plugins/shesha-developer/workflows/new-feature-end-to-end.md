# Workflow — a feature, end to end

Entity → service → form → verified. Use when a request needs both backend and frontend work,
which is most "add X to the app" requests. The ordering is not stylistic: a form cannot bind
to metadata that does not exist yet, and a new entity needs two boots before its CRUD surface
answers.

## 1 · Establish the backend first

`Skill(shesha-developer:domain-model)` — entities, reference lists, migrations.
Then `Skill(shesha-developer:shesha-app-layer)` if the feature needs behaviour beyond CRUD.

**Plan every backend change together and apply them in one build.** Serial
discover → build → discover → build is the largest avoidable cost in full-stack work [R-040].
A new entity needs **two boots**; reference-list items and app-service code need one.
Conventions: [`knowledge/backend-conventions.md`](../knowledge/backend-conventions.md).

## 2 · Prove the backend can carry the form

```
node skills/shesha-form-edit/scripts/backend-probe.mjs <baseUrl> <tokenFile> <spec.json>
```

Exit 0 means entity registered, metadata readable, reference lists populated, dynamic CRUD
answering, permissions allowing the operation. Exit 1 lists each blocker with the skill that
fixes it. **Do not author a form against a non-ready backend** — it will look correct in
markup and fail at runtime.

## 3 · Build the screens

`Skill(shesha-developer:shesha-form-edit)` per screen, sequenced list → detail → create so
cross-links resolve. If the feature is being built to match a design, enter at
`Skill(shesha-developer:shesha-claude-designer)` instead and let it measure and delegate.

Brand theming is resolved at compile time — there is no separate styling pass.

## 4 · Verify, and report honestly

Each form is delivered only when it has been pushed **and** verified: re-fetch diff, render
instrument, and the `shesha-design-critic` verdict. A validated file on disk is not a
delivered form [R-046].

Report what is verified, what is not, and — if you changed the backend — whether the reader
still needs to boot.

## Common failure

Building the form first because it is the visible part, then discovering the entity, the
reference-list items and the CRUD endpoint one runtime error at a time. Each discovery costs
a rebuild. Step 2 exists to collapse all of them into one exit code.
