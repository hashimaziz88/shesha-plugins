# Shesha architecture — what lives where

Plugin-level orientation. Read this to know which layer a change belongs in, then read the
layer's conventions ([backend-conventions.md](backend-conventions.md),
[frontend-conventions.md](frontend-conventions.md)) and the owning skill's procedure
([instructions/routing.md](../instructions/routing.md) maps intent to skill).

## Two kinds of artifact, and why the distinction matters

Shesha applications are built from two materially different things:

- **Code** — C# entities, services, DTOs, migrations; React screens under `src/screens/`.
  Compiled, versioned in git, deployed with the app.
- **Configuration items** — forms, reference lists, settings, permissions, notification
  templates. Stored **in the database**, edited at runtime through the admin portal, and
  moved between environments by export/import rather than by deployment.

A form is configuration, not code. That is why building one means authenticating to a running
backend and pushing markup, and why "the file on disk is correct" is never evidence that the
form was delivered — the file is a staging artifact, the database row is the deliverable.

## Backend layers

```
{Org}.{Module}.Domain          entities · reference lists · domain services · migrations
{Org}.{Module}.Application     application services · DTOs · AutoMapper profiles
```

Modules are independent siblings. The framework generates a dynamic CRUD surface for any
entity marked `[Entity(GenerateApplicationService = …)]`, exposed at
`/api/dynamic/<module>/<Entity>/Crud/*` — this is what a data-bound form talks to, so no
hand-written controller is needed for ordinary CRUD. Write a custom application service when
behaviour goes beyond CRUD, or when an endpoint must be anonymous.

## Frontend surfaces

| Surface | What it is | Lives in |
|---|---|---|
| Designer form | Configuration-item JSON, rendered by the framework | the database |
| Custom page | A React/Next screen, registered in the screen registry, routed under `/dynamic/` | `src/screens/` |
| Custom component | A component added to the designer toolbox | a package project |

Prefer a designer form for anything data-shaped — tables, create/edit/detail, CRUD dialogs.
Reach for a custom page when the screen genuinely is not a form.

## Metadata is the contract between the layers

The frontend does not read C#. It reads **metadata** the backend publishes per entity —
property paths, data types, reference-list names, entity types — and a form binds to those
strings. Consequences worth internalising:

- `formSettings.modelType` is the `{ name, module }` object from live EntityConfig, resolved
  at build time, never guessed.
- Metadata paths are PascalCase; form `propertyName` is camelCase. That single mismatch is the
  cause of the blank-column defect.
- A reference-list name comes from the *property's* metadata, not from the property or entity
  name — a `status` property can bind `BookingStatus`.
- Backend and frontend can therefore disagree silently. Nothing fails loudly when a form
  binds to a property that no longer exists; the value just never persists. This is why
  binding resolution runs against the live backend before any push.

## Environments

Because configuration lives in the database, an environment is a backend URL plus its data.
The same form can exist at different versions in different environments, and a form id from
one is meaningless in another. Anything carrying environment-specific ids — module ids, form
ids, backend ids in a generated manifest — must be re-resolved per environment rather than
reused.
