---
name: shesha-app-layer
description: Generates Shesha application layer code artifacts for .NET applications using ABP framework with NHibernate. Creates application services, DTOs, AutoMapper profiles, domain entities, modules, and scheduled jobs. IMPORTANT — This skill MUST be invoked BEFORE any manual exploration or planning when the task involves creating or modifying Shesha application services, DTOs, or AutoMapper profiles. Use when the user asks to create, scaffold, implement, or update the application layer, application services, entities, DTOs, jobs, or modules in a Shesha project. Also use when the user references a PRD, specification, or API design for backend implementation.
---

# Shesha Application Layer Code Generation

Generate application layer artifacts for a Shesha/.NET/ABP/NHibernate application based on $ARGUMENTS.

## Instructions

- Inspect nearby files to determine the correct namespace root.
- Use `Guid` as entity ID type unless told otherwise.
- All entity properties must be `virtual` (NHibernate requirement).
- Do NOT use FluentValidation — this project uses manual `List<ValidationResult>` + `AbpValidationException`.
- Place files according to the folder structure below.

## Artifact catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Application Service | Application | [services-and-dtos.md](services-and-dtos.md) §1 |
| 2 | DTO | Application | [services-and-dtos.md](services-and-dtos.md) §2 |
| 3 | AutoMapper Profile | Application | [services-and-dtos.md](services-and-dtos.md) §3 |
| 4 | Domain Entity | Domain | [domain-and-modules.md](domain-and-modules.md) §1 |
| 5 | Application Module | Application | [domain-and-modules.md](domain-and-modules.md) §2 |
| 6 | Domain Module | Domain | [domain-and-modules.md](domain-and-modules.md) §3 |
| 7 | Scheduled Job | Application | [scheduled-jobs.md](scheduled-jobs.md) §1 |

## Folder structure

```
{ModuleName}.Application/
  {ModuleName}ApplicationModule.cs
  Services/{EntityNamePlural}/
    {EntityName}AppService.cs
    {EntityName}Dto.cs
    {EntityName}MappingProfile.cs
  Jobs/
    {JobName}Job.cs

{ModuleName}.Domain/
  {ModuleName}Module.cs
  Domain/{EntityNamePlural}/
    {EntityName}.cs
```

## Quick reference

### Base classes

| Artifact | Base Class |
|----------|-----------|
| Application Service | `SheshaAppServiceBase` |
| AutoMapper Profile | `ShaProfile` |
| Domain Entity | `FullAuditedEntity<Guid>` |
| Application Module | `SheshaSubModule<TDomainModule>` |
| Domain Module | `SheshaModule` |
| Scheduled Job | `ScheduledJobBase` + `ITransientDependency` |

### Key attributes

| Attribute | Used On |
|-----------|---------|
| `[Entity(TypeShortAlias = "...")]` | All entities |
| `[Discriminator]` | Entities extending framework types |
| `[ReferenceList("ListName")]` | Lookup/enum properties |
| `[StringLength(n)]` | String properties |
| `[ReadonlyProperty]` | Computed fields |
| `[InverseProperty("FKId")]` | Collection navigation |
| `[ScheduledJob("guid", ...)]` | Scheduled jobs |

### Common patterns

**File management — use framework capabilities, do NOT create custom endpoints:**
- For single file properties on entities, use `StoredFile` with `[StoredFile]` attribute — upload/download handled by the framework's `StoredFileController`.
- For file attachment lists, use the framework's Owner pattern (`StoredFile.Owner`) — no collection property needed on the entity.
- To work with files in services, inject `IStoredFileService` — provides `CreateFileAsync`, `GetStreamAsync`, `GetAttachmentsAsync`, `DeleteAsync`, and more.
- Do NOT create custom upload/download controllers, file storage logic, or file metadata entities.
- See [services-and-dtos.md](services-and-dtos.md) § File Management for service-layer patterns.

**Validation:**
```csharp
var validationResults = new List<ValidationResult>();
if (entity.RequiredField == null)
    validationResults.Add(new ValidationResult("Field is required",
        new[] { nameof(entity.RequiredField) }));
if (validationResults.Any())
    throw new AbpValidationException("Please correct the errors and try again", validationResults);
```

**Repository queries:**
```csharp
var entity = await _repository.GetAsync(id);
var items = await _repository.GetAll().Where(x => x.Status == RefListStatus.Active).ToListAsync();
var items = await _repository.GetAllIncluding(x => x.Person).Where(x => x.PersonId == personId).ToListAsync();
```

**Unit of Work:**
```csharp
using (var uow = _unitOfWorkManager.Begin(TransactionScopeOption.RequiresNew))
{
    await _repository.InsertAsync(entity);
    await uow.CompleteAsync();
}
```

**NHibernate SQL:**
```csharp
await _sessionProvider.Session
    .CreateSQLQuery("EXEC [dbo].[sp_Name] @Param = :param")
    .SetParameter("param", value)
    .ExecuteUpdateAsync();
```

Now generate the requested artifact(s) based on: $ARGUMENTS
