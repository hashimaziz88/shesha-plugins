---
name: shesha-fluent-validators
description: Creates FluentValidation validators for Shesha entity CRUD endpoints. Generates validator classes, module IoC registration, and custom app service integration. Covers conditional validation rules, auto-population of related properties, and cross-property business logic. Use when the user asks to add validation, business rules, conditional required fields, auto-populate properties, or enforce constraints on entity create or update. Also use when the user wants to add logic that runs automatically on CRUD endpoints without modifying the entity or creating a custom app service. Trigger phrases include "validate", "required when", "auto-populate", "auto-fill", "set automatically", "conditional required", "business rule on save", "enforce constraint".
---

# Shesha FluentValidation Validators

Generate FluentValidation validators for Shesha entity CRUD endpoints based on $ARGUMENTS.

## Instructions

- Inspect the target entity to determine its properties, relationships, and namespace.
- Inspect the Domain module class to check if validator IoC registration already exists.
- Validators go in the **Domain layer** alongside the entity they validate.
- **CRITICAL**: Module IoC registration is required — see §2 in [reference/validator-artifacts.md](reference/validator-artifacts.md).
- All validators must implement both `AbstractValidator<TEntity>` and `ITransientDependency`.
- For custom app services that bypass `DynamicCrudAppService`, inject `IValidator<TEntity>` and call it manually — see §3.

## Artifact catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Validator Class | Domain | [reference/validator-artifacts.md](reference/validator-artifacts.md) §1 |
| 2 | Module IoC Registration | Domain | [reference/validator-artifacts.md](reference/validator-artifacts.md) §2 |
| 3 | Custom AppService Integration | Application | [reference/validator-artifacts.md](reference/validator-artifacts.md) §3 |

## Folder structure

```
{ModuleName}.Domain/
  Domain/{EntityNamePlural}/
    {EntityName}.cs              # existing entity
    {EntityName}Validator.cs     # NEW — validator class
  {ModuleName}Module.cs          # MODIFY — add IoC registration

{ModuleName}.Application/        # only if custom app service exists
  Services/{EntityNamePlural}/
    {EntityName}AppService.cs    # MODIFY — inject and call validator
```

## How it works

Shesha's `DynamicCrudAppService` calls `FluentValidationsOnEntityAsync<TEntity>()` during both create and update. This method:

1. Checks `StaticContext.IocManager.IsRegistered(typeof(IValidator<TEntity>))`
2. If registered, resolves all `IValidator<TEntity>` implementations
3. Calls `ValidateAsync()` on each and maps errors to `AbpValidationException`

**If the validator is not registered correctly, validation is silently skipped.**

## Critical: IoC registration gotchas

There are **three requirements** that must all be met for validators to work:

### 1. Implement `ITransientDependency`

```csharp
public class MyValidator : AbstractValidator<MyEntity>, ITransientDependency
```

This alone is NOT sufficient — ABP registers the class by Self + DefaultInterfaces, which does NOT include `IValidator<T>`.

### 2. Register BEFORE `RegisterAssemblyByConvention`

Castle Windsor uses "first registration wins". If `RegisterAssemblyByConvention` runs first, it registers the validator class by Self only. Subsequent attempts to register it with `IValidator<T>` are silently ignored.

```csharp
// CORRECT — validators registered first with IValidator<T> interface
IocManager.IocContainer.Register(
    Classes.FromAssembly(thisAssembly)
        .BasedOn(typeof(IValidator<>))
        .WithServiceAllInterfaces()
        .LifestyleTransient()
);
IocManager.RegisterAssemblyByConvention(thisAssembly);

// WRONG — RegisterAssemblyByConvention wins, IValidator<T> never registered
IocManager.RegisterAssemblyByConvention(thisAssembly);
IocManager.IocContainer.Register(
    Classes.FromAssembly(thisAssembly)
        .BasedOn(typeof(IValidator<>))
        .WithServiceAllInterfaces()  // silently ignored!
        .LifestyleTransient()
);
```

### 3. Use `WithServiceAllInterfaces()` not `WithServiceBase()`

- `WithServiceBase()` registers as `AbstractValidator<T>` (the base class) — framework cannot find it
- `WithServiceAllInterfaces()` registers as `IValidator<T>` (the interface) — framework resolves this

### 4. Custom app services need manual invocation

Custom app services that use `_repository.InsertAsync()` directly bypass the `DynamicCrudAppService` validation pipeline. You must inject `IValidator<TEntity>` and call `ValidateAsync()` manually.

## Quick reference — common rule patterns

| Pattern | Code | Use Case |
|---------|------|----------|
| Required field | `RuleFor(x => x.Name).NotEmpty()` | Always required |
| Conditional required | `RuleFor(x => x.Province).NotNull().When(x => x.Role == Role.Head)` | Required based on another field |
| Auto-populate | `RuleFor(x => x.Prop).Custom((v, ctx) => { ctx.InstanceToValidate.Other = ...; })` | Set derived values on save |
| Max length | `RuleFor(x => x.Name).MaximumLength(100)` | String constraints |
| Must match | `RuleFor(x => x.Email).EmailAddress()` | Format validation |
| Custom error | `.WithMessage("Province is required for Provincial Head.")` | User-friendly messages |
| Cross-property | `RuleFor(x => x.EndDate).GreaterThan(x => x.StartDate)` | Date/range validation |
| Unique check | `RuleFor(x => x.Code).CustomAsync(async (v, ctx, ct) => { ... })` | DB uniqueness (inject repository) |

## Checklist

Before generating, verify:
- [ ] Entity exists and you know its full namespace and properties
- [ ] Domain module class located (for IoC registration)
- [ ] Check if IoC registration already exists (avoid duplicates)
- [ ] Check if entity has custom app services that need manual validator calls
- [ ] Determine which properties need validation vs auto-population

Now generate the requested artifact(s) based on: $ARGUMENTS
