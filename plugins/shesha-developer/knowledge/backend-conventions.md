# Backend conventions — Shesha / .NET / ABP / NHibernate

Plugin-level knowledge: **facts**, not procedure. The procedure for generating each artifact
lives in the skill that owns it — `domain-model` for entities, reference lists and
migrations; `shesha-app-layer` for services, DTOs and AutoMapper profiles; `create-module`
for project scaffolding. Read this to know the shape; read those to know the steps.

## NHibernate

- **Every mapped property must be `virtual`.** NHibernate builds runtime proxies by
  subclassing the entity and overriding its properties; a non-virtual property cannot be
  intercepted, so lazy loading and change tracking silently do not work for it. This applies
  to scalars, references and collections alike — there is no exception.
- Collections are `virtual` too, and are exposed as `IList<T>` initialised in the
  constructor, so a freshly-constructed entity is never null-collection.
- Lazy loading means a navigation property touched outside a session throws. Project into a
  DTO inside the unit of work rather than returning entities to the caller.

## Entities

- Inherit `FullAuditedEntity<Guid>` for anything user-facing — it supplies
  creation/modification/deletion audit columns and soft delete. `Entity<Guid>` exists but
  omits the audit trail, and a junction typed that way is the cause of the M:M defect where
  Guid FKs surface from dynamic CRUD as numbers or booleans.
- `[Entity]` declares Shesha metadata — `GenerateApplicationService` produces the dynamic
  CRUD surface, `FriendlyName` drives labels. Without the generated service there is no
  `/api/dynamic/<module>/<Entity>/Crud/*` for a form to bind to.
- Reference-list properties are typed as the generated `RefList<Name>` enum, not `int`.
- Column naming, which the frontend depends on: **`Lkp` suffix** for reference-list columns,
  **`Id` suffix** for foreign keys. A view-backed entity maps with
  `[Table("ModulePrefix_vw_ViewName")]`.
- An FK property name need not match its target class — an `assignedTo` FK may map to
  `EmployeeDefinition`. When metadata 404s, the EntityConfig `fullClassName` is the authority.

## Reference lists

A `[ReferenceList]` attribute **auto-creates the reference list, empty, on boot**. Seed the
items in a migration rather than creating the list again, or the second creation collides.
A reflist that exists with zero items is the common cause of a dropdown that renders and
stays empty with no console error.

## Application layer

| Artifact | Base type |
|---|---|
| Application service | `SheshaAppServiceBase` |
| AutoMapper profile | `ShaProfile` |
| Scheduled job | `ScheduledJobBase` + `ITransientDependency` |

ABP resolves dependencies by convention: implement `ITransientDependency`,
`ISingletonDependency`, or expose the service interface, and registration happens on boot —
no manual container wiring. Constructor injection only.

Anonymous write endpoints need an explicit `[AbpAllowAnonymous]` service that forces
server-side values and re-validates. Never expose raw entity CRUD to the anonymous internet.

## Modules

A module is a **pair** of projects — `{Org}.{Module}.Domain` (entities, migrations, domain
services) and `{Org}.{Module}.Application` (app services, DTOs). Modules are siblings, never
nested: `Org.DEP.Domain`, not `Org.Testing.DEP.Domain`. A `.csproj` present without its
module class is a known half-scaffolded state worth checking for before creating anything.

## Migrations

FluentMigrator, ordered by timestamped class name. Schema change and data seed belong in the
same migration only when the seed depends on that change.

**A new entity needs TWO boots**: its generated CRUD controller registers on the boot *after*
the one that seeds EntityConfig. Reference-list items and app-service code need one. Plan all
backend changes together and apply them in one build plus the required boots — serial
discover→build→discover→build is the largest avoidable wall-clock cost in full-stack work
[R-040]. Verify entity CRUD `Create` returns 200 before authoring a form against it.
