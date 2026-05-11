# Specification Usage

## §1. Specification Manager Usage

Inject `ISpecificationManager` to activate specifications in a scoped context or apply them to queries.

```csharp
using Shesha.Specifications;

public class {ServiceName}AppService : SheshaAppServiceBase
{
    private readonly ISpecificationManager _specificationManager;
    private readonly IRepository<{EntityName}, Guid> _repository;

    public {ServiceName}AppService(
        ISpecificationManager specificationManager,
        IRepository<{EntityName}, Guid> repository)
    {
        _specificationManager = specificationManager;
        _repository = repository;
    }

    public async Task<List<{EntityName}>> GetFilteredAsync()
    {
        // Activate a single specification — scoped to the using block
        using (_specificationManager.Use<{SpecificationName}Specification, {EntityName}>())
        {
            // GetAll() automatically applies the specification
            var query = _repository.GetAll();
            return await AsyncQueryableExecuter.ToListAsync(query);
        }
    }

    public async Task<List<{EntityName}>> GetMultiFilteredAsync()
    {
        // Activate multiple specifications — combined with AND
        using (_specificationManager.Use(
            typeof({Spec1}Specification),
            typeof({Spec2}Specification)))
        {
            var query = _repository.GetAll();
            return await AsyncQueryableExecuter.ToListAsync(query);
        }
    }

    public async Task<List<{EntityName}>> GetUnfilteredAsync()
    {
        // Disable all specifications (including global ones)
        using (_specificationManager.DisableSpecifications())
        {
            var query = _repository.GetAll();
            return await AsyncQueryableExecuter.ToListAsync(query);
        }
    }
}
```

**Nested contexts:**

```csharp
// Specifications stack — inner context adds to outer
using (_specificationManager.Use<Spec1, Entity>())
{
    // Spec1 active
    using (_specificationManager.Use<Spec2, Entity>())
    {
        // Spec1 AND Spec2 active
    }
    // Only Spec1 active again
}
```

**Apply named specifications from client request:**

```csharp
public async Task<PagedResultDto<{EntityName}Dto>> GetAllAsync(
    FilteredPagedAndSortedResultRequestDto input)
{
    var query = _repository.GetAll();

    // Apply specifications by name (passed from front-end)
    query = _specificationManager.ApplySpecifications(query, input.Specifications);

    var totalCount = await AsyncQueryableExecuter.CountAsync(query);
    var items = await AsyncQueryableExecuter
        .ToListAsync(query.OrderBy(input.Sorting).Skip(input.SkipCount).Take(input.MaxResultCount));

    return new PagedResultDto<{EntityName}Dto>(totalCount, ObjectMapper.Map<List<{EntityName}Dto>>(items));
}
```

**Key rules:**
- `Use()` returns `IDisposable` — always wrap in a `using` block
- Scoping is `AsyncLocal<T>` — safe for async/await and parallel requests
- `GetAll()` on any repository automatically applies active specs + global specs
- Multiple specs on the same entity are combined with AND
- `DisableSpecifications()` disables ALL specs including global ones — use carefully

---

## §2. Action-Level Attributes

Apply specifications declaratively to controller actions or service methods without injecting `ISpecificationManager`.

**Apply specifications:**

```csharp
using Shesha.Specifications;

public class {ServiceName}AppService : SheshaAppServiceBase
{
    [ApplySpecifications(typeof({Spec1}Specification), typeof({Spec2}Specification))]
    public async Task<List<{EntityName}>> GetFilteredAsync()
    {
        // Specifications are automatically active for this entire method
        var query = Repository.GetAll();
        return await AsyncQueryableExecuter.ToListAsync(query);
    }

    [DisableSpecifications]
    public async Task<List<{EntityName}>> GetAllUnfilteredAsync()
    {
        // No specifications applied — returns all records
        var query = Repository.GetAll();
        return await AsyncQueryableExecuter.ToListAsync(query);
    }
}
```

**At class level:**

```csharp
[ApplySpecifications(typeof({SpecificationName}Specification))]
public class {ServiceName}AppService : SheshaAppServiceBase
{
    // All methods in this service have the specification active
}
```

**Key rules:**
- `[ApplySpecifications]` and `[DisableSpecifications]` are mutually exclusive on the same method
- Method-level attributes override class-level attributes
- Processed by `SpecificationsActionFilter` (ASP.NET Core action filter) — works on HTTP endpoints
- Simpler than injecting `ISpecificationManager` for fixed, known specifications
- Use `ISpecificationManager` instead when the spec set is dynamic or conditional

---

## §3. Client-Side Specifications (Front-End Query Builder)

Non-global specifications are automatically exposed in the front-end Query Builder. Users can apply them as filter parameters when configuring data sources.

**Making a specification available to the front-end:**

1. Create the specification class (see [specification-classes.md](specification-classes.md) §1)
2. Add `[Display(Name, Description)]` for a user-friendly label
3. The spec auto-appears in the Query Builder property list for the entity type

**Query Builder operations:**
- **Is satisfied** — the specification is always applied to the query
- **Is satisfied when** — the specification is applied only when a client-side condition evaluates to true

**Front-end request — passing specifications by name:**

```javascript
// Specifications are passed as a list of class names in the API request
const response = await httpClient.get('/api/services/app/{Entity}/GetAll', {
    params: {
        specifications: ['{SpecificationName}Specification'],
        skipCount: 0,
        maxResultCount: 10
    }
});
```

**Backend receives via `FilteredPagedAndSortedResultRequestDto`:**

```csharp
public class FilteredPagedAndSortedResultRequestDto
{
    public List<string> Specifications { get; set; } = new List<string>();
}
```

**Controlling front-end visibility:**

| Condition | Visible in Query Builder |
|-----------|-------------------------|
| No `[GlobalSpecification]` | Yes |
| Has `[GlobalSpecification]` | No (applied automatically, not user-selectable) |
| Has `[Display]` attribute | Yes, with friendly name and description |
| No `[Display]` attribute | Yes, with class name as label |

**Key rules:**
- Global specifications are never shown in the Query Builder (they're always active)
- The specification class name is used as the identifier when passed from front-end
- `ISpecificationsFinder` discovers all specifications at startup and caches the list
- Metadata endpoint exposes specs with `FriendlyName` and `Description` from `[Display]`
