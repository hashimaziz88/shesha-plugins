# Validator Artifacts

## §1. Validator Class

**File:** `{EntityName}Validator.cs` in `Domain/{EntityNamePlural}/`

### Basic validator (no dependencies)

```csharp
using Abp.Dependency;
using FluentValidation;

namespace {ModuleNamespace}.Domain.{EntityNamePlural}
{
    public class {EntityName}Validator : AbstractValidator<{EntityName}>, ITransientDependency
    {
        public {EntityName}Validator()
        {
            // Required field
            RuleFor(x => x.{PropertyName})
                .NotEmpty()
                .WithMessage("{PropertyName} is required.");

            // Conditional required — field required when another field has a specific value
            RuleFor(x => x.{DependentProperty})
                .NotNull()
                .WithMessage("{DependentProperty} is required when {ConditionProperty} is {ConditionValue}.")
                .When(x => x.{ConditionProperty} == {ConditionValue});

            // Auto-populate a related property from a navigation property
            RuleFor(x => x.{SourceNavProperty})
                .Custom((source, context) =>
                {
                    if (source?.{DerivedProperty} != null)
                    {
                        context.InstanceToValidate.{TargetProperty} = source.{DerivedProperty};
                    }
                })
                .When(x => x.{SourceNavProperty} != null);
        }
    }
}
```

### Validator with injected dependencies

Use when validation requires database lookups (e.g., uniqueness checks, reference data).

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using FluentValidation;
using NHibernate.Linq;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Domain.{EntityNamePlural}
{
    public class {EntityName}Validator : AbstractValidator<{EntityName}>, ITransientDependency
    {
        private readonly IRepository<{EntityName}, Guid> _repository;

        public {EntityName}Validator(IRepository<{EntityName}, Guid> repository)
        {
            _repository = repository;

            // Async uniqueness check
            RuleFor(x => x.{UniqueField})
                .CustomAsync(async (value, context, cancellationToken) =>
                {
                    if (string.IsNullOrWhiteSpace(value))
                        return;

                    var entity = context.InstanceToValidate;
                    var exists = await _repository.GetAll()
                        .AnyAsync(x => x.{UniqueField} == value && x.Id != entity.Id);

                    if (exists)
                        context.AddFailure("{UniqueField}", "{UniqueField} must be unique.");
                });

            // Auto-generate a value when empty
            RuleFor(x => x.{AutoField})
                .Custom((value, context) =>
                {
                    if (string.IsNullOrWhiteSpace(value))
                        context.InstanceToValidate.{AutoField} = GenerateValue();
                });
        }

        private string GenerateValue()
        {
            // Custom generation logic
            return $"REF-{DateTime.Now:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpper()}";
        }
    }
}
```

**Key rules:**
- Always implement both `AbstractValidator<TEntity>` **and** `ITransientDependency`.
- Place in the Domain layer alongside the entity (same namespace).
- Name convention: `{EntityName}Validator`.
- Use `Custom()` for auto-population logic — it runs during validation and can modify the entity.
- Use `CustomAsync()` when the rule needs async operations (DB queries).
- Use `.When()` for conditional rules — the condition is evaluated first, and the rule only runs if true.
- Multiple validators per entity are supported — all registered validators will execute.
- Validators run on both create and update via the `DynamicCrudAppService`.
- Validators do NOT run on delete.

---

## §2. Module IoC Registration

**File:** `{ModuleName}Module.cs` (modify existing)

This is the **most critical step**. Without it, validators are silently ignored.

### Add to existing module

Add these using statements if not already present:

```csharp
using Castle.MicroKernel.Registration;
using FluentValidation;
```

Modify the `Initialize()` method — validators MUST be registered BEFORE `RegisterAssemblyByConvention`:

```csharp
public override void Initialize()
{
    var thisAssembly = Assembly.GetExecutingAssembly();

    // Register FluentValidation validators BEFORE RegisterAssemblyByConvention.
    // Castle Windsor uses "first registration wins" — if RegisterAssemblyByConvention
    // runs first, it registers validator classes by Self only (not IValidator<T>).
    // The framework resolves validators via IValidator<T>, so they would not be found.
    IocManager.IocContainer.Register(
        Classes.FromAssembly(thisAssembly)
            .BasedOn(typeof(IValidator<>))
            .WithServiceAllInterfaces()
            .LifestyleTransient()
    );

    IocManager.RegisterAssemblyByConvention(thisAssembly);

    // ... rest of Initialize (AutoMapper, etc.)
}
```

**Key rules:**
- This registration is per-assembly. If validators exist in multiple projects (Domain, Application), each module must register its own assembly.
- The `Classes.FromAssembly().BasedOn(typeof(IValidator<>))` call scans for ALL classes implementing `IValidator<T>` in the assembly — you only need this once per module, not per validator.
- Adding new validator classes to the same assembly requires NO additional registration — the assembly scan picks them up automatically.
- Check if the module already has this registration before adding it (avoid duplicates).
- If the module already has `RegisterAssemblyByConvention`, move it AFTER the validator registration.

### Verification checklist

After adding registration, verify:
1. `using Castle.MicroKernel.Registration;` is present
2. `using FluentValidation;` is present
3. Validator registration appears BEFORE `RegisterAssemblyByConvention`
4. Uses `WithServiceAllInterfaces()` (NOT `WithServiceBase()`)

---

## §3. Custom AppService Integration

**File:** Modify existing `{EntityName}AppService.cs` in `Services/{EntityNamePlural}/`

Custom app services that call `_repository.InsertAsync()` or `_repository.UpdateAsync()` directly **bypass** the `DynamicCrudAppService` validation pipeline. You must inject and call the validator manually.

### Add validator injection

```csharp
using FluentValidation;
using ValidationResult = System.ComponentModel.DataAnnotations.ValidationResult;
```

Add to class fields and constructor:

```csharp
private readonly IValidator<{EntityName}> _{entityName}Validator;

public {EntityName}AppService(
    // ... existing parameters ...
    IValidator<{EntityName}> {entityName}Validator)
{
    // ... existing assignments ...
    _{entityName}Validator = {entityName}Validator ?? throw new ArgumentNullException(nameof({entityName}Validator));
}
```

### Call validator before save

Place this after the entity is fully built (all properties set, navigation properties loaded) but before the repository save call:

```csharp
// Run FluentValidation rules
var fluentResult = await _{entityName}Validator.ValidateAsync(entity);
if (!fluentResult.IsValid)
{
    var fluentErrors = fluentResult.Errors
        .Select(e => new ValidationResult(e.ErrorMessage, new[] { e.PropertyName }))
        .ToList();
    throw new AbpValidationException("Please correct the errors and try again", fluentErrors);
}

// Now safe to save
await _repository.InsertAsync(entity);
```

**Key rules:**
- The `using ValidationResult = System.ComponentModel.DataAnnotations.ValidationResult;` alias is needed because `FluentValidation` also defines a `ValidationResult` type.
- Call the validator AFTER all entity properties are set (including navigation properties loaded from repositories) so that conditional rules and auto-population logic have the full entity state.
- Call the validator BEFORE the repository save call.
- This pattern works for both create and update operations.
- If the custom service has multiple save paths (e.g., `CreateAsync` and `UpdateAsync`), add validation to each path.
- If no custom app service exists (entity only uses `DynamicCrudAppService`), this artifact is not needed — the framework calls validators automatically via §2 registration.
