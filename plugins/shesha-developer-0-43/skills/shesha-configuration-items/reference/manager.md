# Configuration Item Manager

The manager handles versioning lifecycle: copy, create new version, status transitions, move to module, and delete.

## Interface Template

```csharp
using Shesha.ConfigurationItems;

namespace {Namespace}.Domain.{ConfigName}s
{
    public interface I{ConfigName}Manager : IConfigurationItemManager<{ConfigName}>
    {
    }
}
```

## Implementation Template

```csharp
using Abp.Domain.Repositories;
using Abp.Domain.Uow;
using Shesha.ConfigurationItems;
using Shesha.ConfigurationItems.Models;
using Shesha.Domain.ConfigurationItems;
using Shesha.Dto.Interfaces;
using System;
using System.Threading.Tasks;

namespace {Namespace}.Domain.{ConfigName}s
{
    public class {ConfigName}Manager
        : ConfigurationItemManager<{ConfigName}>, I{ConfigName}Manager
    {
        public {ConfigName}Manager(
            IRepository<{ConfigName}, Guid> repository,
            IRepository<Module, Guid> moduleRepository,
            IUnitOfWorkManager unitOfWorkManager
        ) : base(repository, moduleRepository, unitOfWorkManager)
        {
        }

        public override async Task<{ConfigName}> CopyAsync(
            {ConfigName} item, CopyItemInput input)
        {
            var newItem = new {ConfigName}
            {
                // Base properties from input
                Name = input.Name,
                Module = item.Module,
                Label = input.Label,
                Description = input.Description,
                VersionNo = 1,
                VersionStatus = ConfigurationItemVersionStatus.Draft,

                // Copy all custom properties
                // {CustomProp} = item.{CustomProp},
            };

            // Normalize sets Origin to self-reference (required for first version)
            newItem.Normalize();
            await Repository.InsertAsync(newItem);
            return newItem;
        }

        public override async Task<{ConfigName}> CreateNewVersionAsync(
            {ConfigName} item)
        {
            var newVersion = new {ConfigName}
            {
                // Versioning properties
                Origin = item.Origin,
                Name = item.Name,
                Module = item.Module,
                Label = item.Label,
                Description = item.Description,
                VersionNo = item.VersionNo + 1,
                ParentVersion = item,
                VersionStatus = ConfigurationItemVersionStatus.Draft,

                // Copy all custom properties
                // {CustomProp} = item.{CustomProp},
            };

            await Repository.InsertAsync(newVersion);
            return newVersion;
        }

        public override Task<IConfigurationItemDto> MapToDtoAsync({ConfigName} item)
        {
            return Task.FromResult<IConfigurationItemDto>(null);
        }
    }
}
```

## Inherited Methods (no override needed)

The base `ConfigurationItemManager<T>` provides:

| Method | Behavior |
|--------|----------|
| `UpdateStatusAsync(item, status)` | Validates status transitions (Draft->Ready->Live), auto-retires previous Live version |
| `CancelVersionAsync(item)` | Sets status to Cancelled |
| `MoveToModuleAsync(item, input)` | Moves all versions to a new module, validates uniqueness |
| `DeleteAllVersionsAsync(item)` | Soft-deletes all versions matching Name + Module |

## Important: Normalize vs Origin

- **`Normalize()`** — call on first-ever version (in `CopyAsync`). Sets `Origin` to self.
- **`Origin = item.Origin`** — set on subsequent versions (in `CreateNewVersionAsync`). Links to the same origin as the source item.
