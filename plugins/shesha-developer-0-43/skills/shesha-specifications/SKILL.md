---
name: shesha-specifications
description: Creates specification classes for reusable, combinable entity filters in Shesha framework .NET applications. Scaffolds ShaSpecification<T> implementations, global specifications for security/access control, action-level specification attributes, parameterized specifications, and specification manager usage. Use when the user asks to create, scaffold, implement, add, or update specifications, entity filters, query filters, reusable filters, data access policies, global filters, or row-level security in a Shesha project. Also use when implementing features from a PRD or specification that require named, reusable filtering logic for entities.
---

# Shesha Specifications

Generate specification classes and usage code for a Shesha/.NET/ABP application based on $ARGUMENTS.

## Instructions

- **Domain layer specs** (entity filters, global specs, access control): place in the **same folder as the entity** (e.g. `Domain/Accounts/`).
- **Application layer specs** (service-specific, cross-entity, or depend on application services): place in a `Specifications/` folder in the Application project.
- Name specs as `{PluralizedEntityName}{Description}Specification.cs` — e.g. `AccountsWhereActiveSpecification.cs`, `OrdersForCurrentUserSpecification.cs`.
- Specifications must inherit from `ShaSpecification<T>` and implement `BuildExpression()`.
- All specifications are auto-discovered at startup — no manual registration needed.
- Specifications are `ITransientDependency` by default (via `ShaSpecification<T>` base class).
- Constructor injection is supported — specs can inject services like `IRepository<T, Guid>`, `ICurrentUser`, etc.
- Specifications are automatically disabled inside `BuildExpression()` to prevent infinite loops.
- Use `[GlobalSpecification]` sparingly — it applies to ALL queries of that entity type application-wide.
- Use `[Display(Name, Description)]` on specification classes to set friendly names visible in the front-end Query Builder.

## Artifact catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Basic Specification | Domain | [specification-classes.md](specification-classes.md) §1 |
| 2 | Global Specification | Domain | [specification-classes.md](specification-classes.md) §2 |
| 3 | Parameterized Specification | Domain | [specification-classes.md](specification-classes.md) §3 |
| 4 | Specification Manager Usage | Application | [specification-usage.md](specification-usage.md) §1 |
| 5 | Action-Level Attributes | Application | [specification-usage.md](specification-usage.md) §2 |
| 6 | Client-Side Specifications | Application | [specification-usage.md](specification-usage.md) §3 |

## Folder structure

```
{ModuleName}.Domain/
  Domain/{EntityNamePlural}/
    {EntityName}.cs
    {EntityNamePlural}{Description}Specification.cs   ← co-located with entity

{ModuleName}.Application/
  Specifications/
    {EntityNamePlural}{Description}Specification.cs   ← application-layer specs
  Services/{EntityNamePlural}/
    {EntityName}AppService.cs          ← inject ISpecificationManager or use attributes
```

### Placement guidance

| Place in | When |
|----------|------|
| **Domain** (`Domain/{EntityNamePlural}/`) | The spec filters a single entity using only domain concepts (properties, navigation, session context). This is the **default and most common** placement. |
| **Application** (`Specifications/`) | The spec depends on application services, crosses multiple entity boundaries, or contains orchestration logic that doesn't belong in the domain layer. |

### Naming convention

`{PluralizedEntityName}{Description}Specification.cs`
or
`{EntityName}PermissionsSpecification.cs` for specifications, specifically for the enforcement data visibility rules based on user permissions.

| Entity | Specification | File name |
|--------|--------------|-----------|
| `Account` | Active accounts | `AccountsWhereActiveSpecification.cs` |
| `Organisation` | In user's region | `OrganizationsInUserRegionSpecification.cs` |
| `Order` | Current year | `OrdersForCurrentYearSpecification.cs` |
| `Person` | Age 18+ | `PersonsWhereAge18PlusSpecification.cs` |
| `Client` | Permitted by user based on assigned permissions. (Permissions convention). | `ClientPermissionsSpecification.cs` |

## Quick reference

### Base class and interface

| Type | Purpose |
|------|---------|
| `ShaSpecification<T>` | Base class — inherit and implement `BuildExpression()` |
| `ISpecification<T>` | Interface (implemented by `ShaSpecification<T>`) |
| `ISpecificationManager` | Activate/deactivate/query specifications at runtime |
| `ISpecificationsFinder` | Discover all registered specifications (singleton, cached) |

### Available properties in ShaSpecification<T>

| Property | Type | Description |
|----------|------|-------------|
| `AbpSession` | `IAbpSession` | Current session (UserId, TenantId) |
| `IocManager` | `IIocManager` | Resolve services inside `BuildExpression()` |
| `SpecificationManager` | `ISpecificationManager` | Disable specs inside expression building |

### Attributes

| Attribute | Target | Description |
|-----------|--------|-------------|
| `[GlobalSpecification]` | Class | Auto-applies to ALL queries of the entity type |
| `[ApplySpecifications(typeof(...))]` | Method, Class | Applies named specs to a specific action |
| `[DisableSpecifications]` | Method, Class | Disables all specs for a specific action |
| `[Display(Name, Description)]` | Class | Friendly name and description for Query Builder |

### ISpecificationManager methods

| Method | Description |
|--------|-------------|
| `Use<TSpec, TEntity>()` | Activate a specification in a scoped context (returns `IDisposable`) |
| `Use(params Type[])` | Activate multiple specifications |
| `DisableSpecifications()` | Temporarily disable all active specifications (returns `IDisposable`) |
| `ApplySpecifications<T>(IQueryable<T>)` | Apply current context specifications to a query |
| `ApplySpecifications<T>(IQueryable<T>, List<string>)` | Apply named specifications by name |
| `GetSpecifications<T>()` | Get active specification instances for entity type |

### Key behaviors

- Specs are combined with logical **AND** when multiple are active for the same entity
- `Repository.GetAll()` **automatically** applies all active specs (global + context)
- Specs support **polymorphic inheritance** — a spec on `Animal` works on `Dog : Animal`
- `AsyncLocal<T>` scoping — specs are async-safe and scoped per call chain
- Front-end Query Builder exposes non-global specs with "Is satisfied" / "Is satisfied when" operations

Now generate the requested artifact(s) based on: $ARGUMENTS
