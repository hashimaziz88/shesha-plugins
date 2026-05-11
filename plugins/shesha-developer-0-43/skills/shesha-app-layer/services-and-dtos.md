# Services, DTOs, and Mapping Profiles

## §1. Application Service

**File:** `{EntityName}AppService.cs` in `Services/{EntityNamePlural}/`

```csharp
using Abp.Domain.Repositories;
using Abp.Runtime.Validation;
using Microsoft.AspNetCore.Mvc;
using Shesha;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Application.Services.{EntityNamePlural}
{
    public class {EntityName}AppService : SheshaAppServiceBase
    {
        private readonly IRepository<{EntityName}, Guid> _{entityName}Repository;

        public {EntityName}AppService(
            IRepository<{EntityName}, Guid> {entityName}Repository)
        {
            _{entityName}Repository = {entityName}Repository;
        }

        [HttpPost]
        public async Task CreateAsync({EntityName}Dto input)
        {
            var validationResults = new List<ValidationResult>();

            if (input == null)
                throw new UserFriendlyException("Input cannot be null.");

            // Add field-level validations:
            // if (input.RequiredField == null)
            //     validationResults.Add(new ValidationResult("Field is required", new[] { nameof(input.RequiredField) }));

            if (validationResults.Any())
                throw new AbpValidationException("Please correct the errors and try again", validationResults);

            var entity = new {EntityName}
            {
                // Map properties from DTO
            };

            await _{entityName}Repository.InsertAsync(entity);
        }

        [HttpPut]
        public async Task UpdateAsync({EntityName}Dto input)
        {
            if (input.Id == null)
                throw new UserFriendlyException("Id is required.");

            var entity = await _{entityName}Repository.GetAsync((Guid)input.Id);
            // Update entity properties from DTO
            await _{entityName}Repository.UpdateAsync(entity);
        }

        [HttpGet]
        public async Task<{EntityName}Dto> GetAsync(Guid id)
        {
            var entity = await _{entityName}Repository.GetAsync(id);
            return new {EntityName}Dto
            {
                Id = entity.Id,
                // Map properties
            };
        }
    }
}
```

**Key rules:**
- Inherits `SheshaAppServiceBase` (provides `Logger`, `GetCurrentPersonAsync()`, `AbpSession`, `MapJObjectToEntityAsync`)
- Constructor injection for repositories and domain managers
- `[HttpPost]` for create, `[HttpPut]` for update, `[HttpGet]` for read
- Validation: `List<ValidationResult>` + `AbpValidationException` (NOT FluentValidation)
- `UserFriendlyException` for display-safe business errors

**DynamicDto pattern** (partial JSON from frontend):

```csharp
[HttpPut]
public async Task SubmitAsync(DynamicDto<{EntityName}, Guid> request)
{
    var validationResults = new List<ValidationResult>();
    var entity = await _{entityName}Repository.GetAsync(request.Id);

    var result = await MapJObjectToEntityAsync<{EntityName}, Guid>(
        request._jObject, entity, validationResults);

    if (!result)
        throw new AbpValidationException("Please correct the errors and try again", validationResults);

    await _{entityName}Repository.UpdateAsync(entity);
}
```

---

## §2. DTO

**File:** `{EntityName}Dto.cs` in `Services/{EntityNamePlural}/`

```csharp
using System;

namespace {ModuleNamespace}.Application.Services.{EntityNamePlural}
{
    public class {EntityName}Dto
    {
        public Guid? Id { get; set; }

        // Simple value properties
        public string Name { get; set; }
        public DateTime? StartDate { get; set; }
        public decimal? Amount { get; set; }
        public bool IsActive { get; set; }

        // Reference entity IDs (NOT navigation properties)
        public Guid? PersonId { get; set; }
        public Guid? CategoryId { get; set; }

        // RefList values as nullable long
        public long? Status { get; set; }
    }
}
```

**Key rules:**
- `Guid?` for Id and FK references
- `long?` for RefList/enum properties
- Nullable types for optional fields
- No navigation properties — use `Guid?` references

---

## §3. AutoMapper Profile

**File:** `{EntityName}MappingProfile.cs` in `Services/{EntityNamePlural}/`

```csharp
using AutoMapper;
using Shesha.AutoMapper;

namespace {ModuleNamespace}.Application.Services.{EntityNamePlural}
{
    public class {EntityName}MappingProfile : ShaProfile
    {
        public {EntityName}MappingProfile()
        {
            CreateMap<{EntityName}Dto, {EntityName}>()
                .ForMember(dest => dest.NavigationProperty, opt => opt.Ignore());
                // Ignore all navigation/complex properties — resolved by ID
        }
    }
}
```

**Key rules:**
- Inherit `ShaProfile`
- `.ForMember(dest => dest.X, opt => opt.Ignore())` for navigation properties
- Module's `Initialize()` auto-scans profiles via `cfg.AddMaps(thisAssembly)`

---

## §4. File Management in Services

The Shesha framework provides built-in file management. **Do NOT create custom file upload/download endpoints or file storage logic.** Use the framework's `StoredFileController` for all upload/download operations and `IStoredFileService` when you need to work with files programmatically within services.

### When to Use `IStoredFileService` in a Service

Only inject `IStoredFileService` when your service needs to programmatically create, read, copy, or delete files as part of business logic (e.g. generating a report file, copying attachments between entities, processing uploaded content). For standard upload/download from the UI, the framework's `StoredFileController` handles everything automatically.

### Using `IStoredFileService`

```csharp
using Shesha.Services;
using Shesha.Domain;

public class InvoiceAppService : SheshaAppServiceBase
{
    private readonly IRepository<Invoice, Guid> _invoiceRepository;
    private readonly IStoredFileService _storedFileService;

    public InvoiceAppService(
        IRepository<Invoice, Guid> invoiceRepository,
        IStoredFileService storedFileService)
    {
        _invoiceRepository = invoiceRepository;
        _storedFileService = storedFileService;
    }

    /// <summary>
    /// Example: Programmatically create a file and attach it to an entity
    /// </summary>
    [HttpPost]
    public async Task GenerateReportAsync(Guid invoiceId)
    {
        var invoice = await _invoiceRepository.GetAsync(invoiceId);

        // Generate report content (e.g. PDF bytes)
        var reportBytes = GeneratePdfReport(invoice);
        using var stream = new MemoryStream(reportBytes);

        // Create a StoredFile attached to the invoice via the Owner pattern
        var fileVersion = await _storedFileService.CreateFileAsync(stream, "InvoiceReport.pdf", file =>
        {
            file.SetOwner(invoice);
            file.Category = "reports";
        });
    }

    /// <summary>
    /// Example: Read an existing file's content
    /// </summary>
    [HttpGet]
    public async Task<byte[]> GetReportContentAsync(Guid fileId)
    {
        var file = await _storedFileService.GetOrNullAsync(fileId);
        if (file == null)
            throw new UserFriendlyException("File not found");

        using var stream = await _storedFileService.GetStreamAsync(file);
        using var memoryStream = new MemoryStream();
        await stream.CopyToAsync(memoryStream);
        return memoryStream.ToArray();
    }

    /// <summary>
    /// Example: Copy all attachments from one entity to another
    /// </summary>
    [HttpPost]
    public async Task CloneAttachmentsAsync(Guid sourceInvoiceId, Guid targetInvoiceId)
    {
        var source = await _invoiceRepository.GetAsync(sourceInvoiceId);
        var target = await _invoiceRepository.GetAsync(targetInvoiceId);
        await _storedFileService.CopyAttachmentsToAsync(source, target);
    }

    /// <summary>
    /// Example: Query attachments by category
    /// </summary>
    [HttpGet]
    public async Task<List<string>> GetAttachmentNamesAsync(Guid invoiceId)
    {
        var invoice = await _invoiceRepository.GetAsync(invoiceId);
        var attachments = await _storedFileService.GetAttachmentsOfCategoryAsync(
            invoice, "supportingDocuments");
        return attachments.Select(a => a.FileName).ToList();
    }
}
```

### Key `IStoredFileService` Methods

| Method | Purpose |
| --- | --- |
| `CreateFileAsync(Stream, fileName, Action<StoredFile>?)` | Create a new file with content |
| `GetStreamAsync(StoredFile)` | Download latest version content |
| `GetStreamAsync(StoredFileVersion)` | Download specific version content |
| `GetOrNullAsync(Guid)` | Retrieve file by ID |
| `DeleteAsync(StoredFile)` | Delete file and all versions |
| `GetAttachmentsAsync(owner)` | Get all files attached to entity |
| `GetAttachmentsOfCategoryAsync(owner, category)` | Get files by category |
| `CopyAttachmentsToAsync(source, destination)` | Copy all files between entities |
| `GetNewOrDefaultVersionAsync(StoredFile)` | Create new version for upload |
| `UpdateVersionContentAsync(StoredFileVersion, Stream)` | Update version content |
| `RenameFileAsync(StoredFile, fileName)` | Rename a file |
| `MarkDownloadedAsync(StoredFileVersion)` | Track download |
| `UpdateFileAsync(StoredFile, Stream, fileName)` | Update existing file content (overwrites current version) |
| `GetLastVersionAsync(StoredFile)` | Get the latest `StoredFileVersion` for download |
| `GetFileVersionsAsync(StoredFile)` | List all versions of a file (version history) |
| `HasAttachmentsOfCategoryAsync(owner, category)` | Check if any files exist in a category for the owner |
| `GetAttachmentsCategoriesAsync(owner)` | List all distinct categories for an entity's attachments |
| `CopyToOwnerAsync(StoredFile, newOwner)` | Copy a single file to a different owner entity |
| `FileExistsAsync(Guid)` | Check if a file exists by ID |

### File Versioning Behavior

The versioning behavior depends on the `IsVersionControlled` flag on the `StoredFile`:

- **Version-controlled files** (`IsVersionControlled = true`): Each upload via `UploadNewVersion` creates a new `StoredFileVersion`. All previous versions are preserved and accessible via `GetFileVersionsAsync`. The `IsLast` flag on `StoredFileVersion` marks the most recent version.
- **Non-version-controlled files** (default): Uploading new content overwrites the existing single version — no history is kept.

**How to enable version control:**
- **At design time**: Set `IsVersionControlled = true` on the `[StoredFile]` attribute on the entity property.
- **At runtime**: Set the `IsVersionControlled` property on a `StoredFile` instance to `true`, then use `UploadNewVersion` for subsequent uploads.

### What NOT to Do in Application Services

- **Do NOT** create `[HttpPost] UploadFileAsync(IFormFile file)` endpoints — the framework's `StoredFileController` already provides these.
- **Do NOT** create `[HttpGet] DownloadFileAsync(Guid id)` endpoints — use the framework's `StoredFileController/Download`.
- **Do NOT** write file bytes to disk or cloud storage directly — `IStoredFileService` handles storage backend abstraction.
- **Do NOT** create DTOs to track file metadata (name, size, type, etc.) — the framework's `StoredFileDto` already covers this.
