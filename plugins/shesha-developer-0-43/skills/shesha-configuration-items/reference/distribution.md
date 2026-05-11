# Distribution (Export/Import)

Three classes enable configuration item portability across environments.

## §1 Distribution DTO

Serializable representation of the configuration item. Lives in the `Distribution/` subfolder next to the entity in the Domain project (no `Dto/` subdirectory). Only includes serializable primitives — no entity references.

```csharp
using Shesha.ConfigurationItems.Distribution;
using System;

namespace {Namespace}.Domain.{ConfigName}s.Distribution
{
    public class Distributed{ConfigName} : DistributedConfigurableItemBase
    {
        // Mirror each custom property from the entity.
        // Use primitive types only (no entity references).

        // --- Scalar properties ---
        // public int? {IntProp} { get; set; }
        // public bool? {BoolProp} { get; set; }
        // public string {StringProp} { get; set; }

        // --- References to OTHER ConfigurationItemBase entities ---
        // IMPORTANT: Use Name + Module string pairs, NOT Guid IDs.
        // This is the established Shesha framework convention so that
        // exported packages are portable across environments where IDs differ.
        //
        // public string {Related}Name { get; set; }
        // public string {Related}Module { get; set; }

        // --- References to regular (non-config) entities ---
        // Use Guid? for FK references to ordinary entities.
        // public Guid? {RegularEntityId} { get; set; }

        // --- StoredFile properties ---
        // Serialize files as base64 so they are included in the export package.
        // For each StoredFile property on the entity, add three string properties:
        //
        // /// <summary>File name of the {description}</summary>
        // public string {PropName}FileName { get; set; }
        // /// <summary>MIME type of the {description}</summary>
        // public string {PropName}FileType { get; set; }
        // /// <summary>Base64-encoded content of the {description}</summary>
        // public string {PropName}Base64 { get; set; }
    }
}
```

The base `DistributedConfigurableItemBase` already includes: `Id`, `OriginId`, `Name`, `Label`, `ItemType`, `Description`, `ModuleName`, `FrontEndApplication`, `VersionNo`, `VersionStatus`, `ParentVersionId`, `Suppress`, `BaseItem`.

## §2 Exporter

Converts from entity to distribution DTO and serializes to JSON.

### Interface

```csharp
using Shesha.ConfigurationItems.Distribution;

namespace {Namespace}.Domain.{ConfigName}s.Distribution
{
    public interface I{ConfigName}Export : IConfigurableItemExport<{ConfigName}>
    {
    }
}
```

### Implementation

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Newtonsoft.Json;
using Shesha.ConfigurationItems.Distribution;
using Shesha.Domain;
using Shesha.Services;
using System;
using System.IO;
using System.Threading.Tasks;

namespace {Namespace}.Domain.{ConfigName}s.Distribution
{
    public class {ConfigName}Export : I{ConfigName}Export, ITransientDependency
    {
        private readonly IRepository<{ConfigName}, Guid> _repository;
        // Inject IStoredFileService only if the entity has StoredFile properties
        private readonly IStoredFileService _storedFileService;

        public {ConfigName}Export(
            IRepository<{ConfigName}, Guid> repository,
            IStoredFileService storedFileService)
        {
            _repository = repository;
            _storedFileService = storedFileService;
        }

        public string ItemType => {ConfigName}.ItemTypeName;

        public async Task<DistributedConfigurableItemBase> ExportItemAsync(Guid id)
        {
            var item = await _repository.GetAsync(id);
            return await ExportItemAsync(item);
        }

        public async Task<DistributedConfigurableItemBase> ExportItemAsync(
            ConfigurationItemBase item)
        {
            if (item is not {ConfigName} config)
                throw new ArgumentException(
                    $"Expected {nameof({ConfigName})}, got {item.GetType().FullName}");

            var result = new Distributed{ConfigName}
            {
                // Base properties (always include all of these)
                Id = config.Id,
                Name = config.Name,
                ModuleName = config.Module?.Name,
                FrontEndApplication = config.Application?.AppKey,
                ItemType = config.ItemType,
                Label = config.Label,
                Description = config.Description,
                OriginId = config.Origin?.Id,
                BaseItem = config.BaseItem?.Id,
                VersionNo = config.VersionNo,
                VersionStatus = config.VersionStatus,
                ParentVersionId = config.ParentVersion?.Id,
                Suppress = config.Suppress,

                // Custom scalar properties
                // {CustomProp} = config.{CustomProp},

                // References to other ConfigurationItemBase entities:
                // Export as Name + Module strings (NOT Guid IDs).
                // {Related}Name = config.{Related}?.Name,
                // {Related}Module = config.{Related}?.Module?.Name,
            };

            // --- StoredFile properties ---
            // For each StoredFile property, read the file content and encode as base64.
            // if (config.{FileProp} != null)
            // {
            //     result.{FileProp}FileName = config.{FileProp}.FileName;
            //     result.{FileProp}FileType = config.{FileProp}.FileType;
            //
            //     using var stream = await _storedFileService.GetStreamAsync(config.{FileProp});
            //     if (stream != null)
            //     {
            //         using var memoryStream = new MemoryStream();
            //         await stream.CopyToAsync(memoryStream);
            //         result.{FileProp}Base64 = Convert.ToBase64String(memoryStream.ToArray());
            //     }
            // }

            return result;
        }

        public async Task WriteToJsonAsync(
            DistributedConfigurableItemBase item, Stream jsonStream)
        {
            var json = JsonConvert.SerializeObject(item, Formatting.Indented);
            using var writer = new StreamWriter(jsonStream);
            await writer.WriteAsync(json);
        }
    }
}
```

**Note:** When the entity has StoredFile properties, the `ExportItemAsync(ConfigurationItemBase)` method must be `async` (not returning `Task.FromResult`) because reading the file stream is an async operation.

## §3 Importer

Reads JSON and creates or updates entities in the database.

### Interface

```csharp
using Shesha.ConfigurationItems.Distribution;

namespace {Namespace}.Domain.{ConfigName}s.Distribution
{
    public interface I{ConfigName}Import : IConfigurableItemImport<{ConfigName}>
    {
    }
}
```

### Implementation

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Newtonsoft.Json;
using Shesha.ConfigurationItems.Distribution;
using Shesha.Domain;
using Shesha.Domain.ConfigurationItems;
using Shesha.Services;
using Shesha.Services.ConfigurationItems;
using System;
using System.IO;
using System.Threading.Tasks;

namespace {Namespace}.Domain.{ConfigName}s.Distribution
{
    public class {ConfigName}Import : ConfigurationItemImportBase,
        I{ConfigName}Import, ITransientDependency
    {
        private readonly IRepository<{ConfigName}, Guid> _repository;
        // Inject IStoredFileService only if the entity has StoredFile properties
        private readonly IStoredFileService _storedFileService;
        // Inject repositories for referenced ConfigurationItemBase entities
        // private readonly IRepository<{RelatedConfigItem}, Guid> _{relatedRepo};

        public {ConfigName}Import(
            IRepository<Module, Guid> moduleRepo,
            IRepository<FrontEndApp, Guid> frontEndAppRepo,
            IRepository<{ConfigName}, Guid> repository,
            IStoredFileService storedFileService
            // IRepository<{RelatedConfigItem}, Guid> relatedRepo
        ) : base(moduleRepo, frontEndAppRepo)
        {
            _repository = repository;
            _storedFileService = storedFileService;
            // _{relatedRepo} = relatedRepo;
        }

        public string ItemType => {ConfigName}.ItemTypeName;

        public async Task<ConfigurationItemBase> ImportItemAsync(
            DistributedConfigurableItemBase item,
            IConfigurationItemsImportContext context)
        {
            if (item is not Distributed{ConfigName} distributed)
                throw new NotSupportedException(
                    $"Expected {nameof(Distributed{ConfigName})}, " +
                    $"got {item.GetType().FullName}");

            var statusToImport = context.ImportStatusAs ?? item.VersionStatus;

            // Match existing item by Name + Module + IsLast
            var dbItem = await _repository.FirstOrDefaultAsync(x =>
                x.Name == item.Name
                && (x.Module == null && item.ModuleName == null
                    || x.Module != null && x.Module.Name == item.ModuleName)
                && x.IsLast);

            if (dbItem != null)
            {
                await MapPropertiesAsync(distributed, dbItem, context);
                await _repository.UpdateAsync(dbItem);
            }
            else
            {
                dbItem = new {ConfigName}();
                await MapPropertiesAsync(distributed, dbItem, context);

                dbItem.VersionNo = 1;
                dbItem.Module = await GetModuleAsync(item.ModuleName, context);
                dbItem.VersionStatus = statusToImport;
                dbItem.CreatedByImport = context.ImportResult;

                dbItem.Normalize();
                await _repository.InsertAsync(dbItem);
            }

            return dbItem;
        }

        private async Task MapPropertiesAsync(
            Distributed{ConfigName} source,
            {ConfigName} target,
            IConfigurationItemsImportContext context)
        {
            // Base properties
            target.Name = source.Name;
            target.Module = await GetModuleAsync(source.ModuleName, context);
            target.Application = await GetFrontEndAppAsync(
                source.FrontEndApplication, context);
            target.Label = source.Label;
            target.Description = source.Description;
            target.VersionNo = source.VersionNo;
            target.VersionStatus = source.VersionStatus;
            target.Suppress = source.Suppress;

            // Custom scalar properties
            // target.{CustomProp} = source.{CustomProp};

            // References to other ConfigurationItemBase entities:
            // Resolve from Name + Module strings back to entities.
            // target.{Related} = !string.IsNullOrWhiteSpace(source.{Related}Name)
            //     ? await _{relatedRepo}.FirstOrDefaultAsync(x =>
            //         x.Name == source.{Related}Name
            //         && (x.Module == null && source.{Related}Module == null
            //             || x.Module != null && x.Module.Name == source.{Related}Module)
            //         && x.IsLast)
            //     : null;

            // --- StoredFile properties ---
            // Recreate the file from base64 content.
            // if (!string.IsNullOrWhiteSpace(source.{FileProp}Base64))
            // {
            //     var fileBytes = Convert.FromBase64String(source.{FileProp}Base64);
            //     using var stream = new MemoryStream(fileBytes);
            //     var storedFile = await _storedFileService.SaveFileAsync(
            //         stream,
            //         source.{FileProp}FileName,
            //         file => file.FileType = source.{FileProp}FileType);
            //     target.{FileProp} = storedFile;
            // }
            // else
            // {
            //     target.{FileProp} = null;
            // }
        }

        public async Task<DistributedConfigurableItemBase> ReadFromJsonAsync(
            Stream jsonStream)
        {
            using var reader = new StreamReader(jsonStream);
            var json = await reader.ReadToEndAsync();

            var result = JsonConvert.DeserializeObject<Distributed{ConfigName}>(json)
                ?? throw new Exception(
                    $"Failed to deserialize {nameof({ConfigName})} from JSON");

            return result;
        }
    }
}
```

## Key Points

- **`ITransientDependency`** — both exporter and importer must implement this.
- **Match by Name + Module + IsLast** — this is how the importer finds existing items.
- **`Normalize()`** — call on new items only; sets Origin to self-reference.
- **`context.ImportStatusAs`** — allows the import caller to override the version status.
- **`GetModuleAsync` / `GetFrontEndAppAsync`** — inherited from `ConfigurationItemImportBase`; resolves or creates modules/apps as needed.

### Cross-Config-Item References (IMPORTANT)

When a configuration item has a property that references **another ConfigurationItemBase entity** (e.g., a `SettingConfiguration` referencing an editor `FormConfiguration`, or an `EntityProperty` referencing a `ReferenceList`):

| Layer | What to do |
|-------|------------|
| **Distribution DTO** | Represent the reference as **two string properties**: `{Related}Name` and `{Related}Module`. Do NOT use `Guid?`. |
| **Exporter** | Map from the entity navigation property: `{Related}Name = entity.{Related}?.Name`, `{Related}Module = entity.{Related}?.Module?.Name`. |
| **Importer** | Resolve back to the entity using `Name + Module + IsLast` query (same pattern as the main item lookup). |

**Why?** GUIDs are environment-specific — they differ between dev, staging, and production databases. Name + Module pairs are stable identifiers that make exported `.shaconfig` packages portable across environments.

**Framework examples** that follow this convention:
- `SettingExport` → exports `EditorFormName` / `EditorFormModule` (not FormConfiguration ID)
- `EntityConfigExport` → exports `ReferenceListName` / `ReferenceListModule` on entity properties (not ReferenceList ID)

**Exception — internal versioning GUIDs**: The base class properties `OriginId`, `BaseItem`, and `ParentVersionId` are exported as GUIDs because they track version lineage within the same item, not cross-references to different item types.

### StoredFile Properties (IMPORTANT)

When a configuration item has a `StoredFile` property (e.g., a document template, an uploaded image), the file content **must** be serialized into the export package so it can be recreated on import.

| Layer | What to do |
|-------|------------|
| **Distribution DTO** | Add three string properties per file: `{PropName}FileName`, `{PropName}FileType`, `{PropName}Base64`. |
| **Exporter** | Inject `IStoredFileService`. Read the file stream via `GetStreamAsync()`, copy to a `MemoryStream`, encode as `Convert.ToBase64String()`. |
| **Importer** | Inject `IStoredFileService`. Decode base64 to `byte[]`, wrap in `MemoryStream`, call `SaveFileAsync()` to create a new `StoredFile`, assign to the entity property. Set to `null` if base64 is empty. |

**Why?** StoredFile records are environment-specific database rows with file content stored in the configured blob provider. Without base64 serialization, imported configuration items would have broken file references.

## Exported Package Structure

Items are packaged into `.shaconfig` zip files with this folder structure:

```
{module-name}/
  {item-type-name}/            ← matches ItemTypeName
    {item-name}.json           ← one JSON file per item
```
