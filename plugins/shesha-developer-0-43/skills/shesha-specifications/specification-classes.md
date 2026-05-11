# Specification Classes

## §1. Basic Specification

**File:** `{EntityNamePlural}{Description}Specification.cs` in `Domain/{EntityNamePlural}/` (Domain layer) or `Specifications/` (Application layer)

```csharp
using Shesha.Specifications;
using System;
using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;

namespace {ModuleNamespace}.Domain.{EntityNamePlural}
{
    /// <summary>
    /// {Description of what this specification filters}.
    /// </summary>
    [Display(Name = "{Friendly Name}", Description = "{Description shown in Query Builder}")]
    public class {EntityNamePlural}{Description}Specification : ShaSpecification<{EntityName}>
    {
        public override Expression<Func<{EntityName}, bool>> BuildExpression()
        {
            return x => {FilterExpression};
        }
    }
}
```

**Key rules:**
- One specification class per filter concern — keep them focused and single-purpose
- `BuildExpression()` must return a LINQ expression (translatable to SQL by NHibernate)
- Avoid in-memory operations inside the expression — stick to properties and simple comparisons
- `[Display]` is optional but recommended for Query Builder visibility
- Specifications inside `BuildExpression()` are automatically disabled to prevent infinite loops

**With dependency injection:**

```csharp
[Display(Name = "{Friendly Name}")]
public class {EntityNamePlural}{Description}Specification : ShaSpecification<{EntityName}>
{
    private readonly IRepository<{RelatedEntity}, Guid> _{relatedRepo};

    public {EntityNamePlural}{Description}Specification(IRepository<{RelatedEntity}, Guid> {relatedRepo})
    {
        _{relatedRepo} = {relatedRepo};
    }

    public override Expression<Func<{EntityName}, bool>> BuildExpression()
    {
        // Resolve context data (specs are disabled here, so no recursion)
        var currentPerson = _{relatedRepo}.GetAll()
            .FirstOrDefault(p => p.User != null && p.User.Id == AbpSession.UserId);

        return x => x.{Property} == currentPerson.{Property};
    }
}
```

**Using IocManager for static resolution:**

```csharp
public override Expression<Func<{EntityName}, bool>> BuildExpression()
{
    var repo = IocManager.Resolve<IRepository<{EntityName}, Guid>>();
    // Use repo to look up reference data
    return x => x.{FilterExpression};
}
```

---

## §2. Global Specification

**File:** `{EntityNamePlural}{Description}Specification.cs` in `Domain/{EntityNamePlural}/` (Domain layer) or `Specifications/` (Application layer)

Global specifications apply automatically to ALL queries of the entity type via `Repository.GetAll()`. Use for security, data isolation, or access control.

```csharp
using Shesha.Specifications;
using System;
using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;

namespace {ModuleNamespace}.Domain.{EntityNamePlural}
{
    /// <summary>
    /// {Description — e.g. restricts data to the current user's region/unit/tenant}.
    /// </summary>
    [GlobalSpecification]
    [Display(Name = "{Friendly Name}")]
    public class {EntityNamePlural}{Description}Specification : ShaSpecification<{EntityName}>
    {
        private readonly {InjectedService} _{service};

        public {EntityNamePlural}{Description}Specification({InjectedService} {service})
        {
            _{service} = {service};
        }

        public override Expression<Func<{EntityName}, bool>> BuildExpression()
        {
            // Look up current user context
            var currentUser = {ResolveCurrentUserLogic};

            return x => x.{Property} == currentUser.{Property};
        }
    }
}
```

**Key rules:**
- Use `[GlobalSpecification]` sparingly — it affects EVERY query for this entity type
- Global specs are NOT exposed in the front-end Query Builder (filtered out)
- Global specs are combined with AND when multiple exist for the same entity
- Use `[DisableSpecifications]` on specific actions that need unfiltered access (e.g. admin endpoints)
- Constructor injection works — inject `ICurrentUser`, repositories, or other services
- Global specs are ideal for: row-level security, multi-tenant isolation, organizational unit filtering

**Common patterns for global specifications:**

```csharp
// Tenant isolation
return x => x.TenantId == AbpSession.TenantId;

// Organizational unit filtering
return x => x.OrganisationUnit.Id == currentPerson.OrganisationUnitId;

// Soft-delete visibility (only active records)
return x => x.IsActive;

// Region-based filtering
return x => x.AreaLevel1 == currentPerson.AreaLevel1;
```

---

## §3. Parameterized Specification

**File:** `{EntityNamePlural}{Description}Specification.cs` in `Domain/{EntityNamePlural}/` (Domain layer) or `Specifications/` (Application layer)

Parameterized specifications accept constructor arguments. They are typically not auto-discovered for the Query Builder but are used programmatically via `ISpecificationManager`.

```csharp
using Shesha.Specifications;
using System;
using System.Linq.Expressions;

namespace {ModuleNamespace}.Domain.{EntityNamePlural}
{
    /// <summary>
    /// Filters {EntityName} by {parameter description}.
    /// </summary>
    public class {EntityNamePlural}{Description}Specification : ShaSpecification<{EntityName}>
    {
        public {ParamType} {ParamName} { get; private set; }

        public {EntityNamePlural}{Description}Specification({ParamType} {paramName})
        {
            {ParamName} = {paramName};
        }

        public override Expression<Func<{EntityName}, bool>> BuildExpression()
        {
            return x => x.{Property} == {ParamName};
        }
    }
}
```

**Generic parameterized specification (for shared interfaces):**

```csharp
/// <summary>
/// Filters any entity implementing {InterfaceName} by {parameter description}.
/// </summary>
public class By{PropertyName}Specification<TEntity> : ShaSpecification<TEntity>
    where TEntity : {InterfaceName}
{
    public {ParamType} {ParamName} { get; private set; }

    public By{PropertyName}Specification({ParamType} {paramName})
    {
        {ParamName} = {paramName};
    }

    public override Expression<Func<TEntity, bool>> BuildExpression()
    {
        return x => x.{Property} == {ParamName};
    }
}
```

**Key rules:**
- Use for specifications that need runtime values (user input, config values, etc.)
- Not auto-applied — must be used programmatically via `ISpecificationManager` or custom code
- Constructor parameters make specs composable and testable
- Generic specs with interface constraints enable reuse across multiple entity types
