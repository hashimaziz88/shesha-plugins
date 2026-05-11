# Module Registration

Register the manager, exporter, and importer in the **Application module's** `PreInitialize()` method.

## Template

```csharp
using Abp.Modules;
using Shesha;
using Shesha.ConfigurationItems;
using {EntityNamespace};
using {Namespace}.Domain.{ConfigName}s;
using {Namespace}.Domain.{ConfigName}s.Distribution;

namespace {Namespace}.Application
{
    [DependsOn(typeof(SheshaCoreModule), typeof(SheshaApplicationModule))]
    public class {Module}ApplicationModule : SheshaSubModule<{Module}Module>
    {
        public override void PreInitialize()
        {
            IocManager
                .RegisterConfigurableItemManager<{ConfigName},
                    I{ConfigName}Manager, {ConfigName}Manager>()
                .RegisterConfigurableItemExport<{ConfigName},
                    I{ConfigName}Export, {ConfigName}Export>()
                .RegisterConfigurableItemImport<{ConfigName},
                    I{ConfigName}Import, {ConfigName}Import>();
        }
    }
}
```

## Adding to an Existing Module

If the Application module already exists, add the registration calls to the existing `PreInitialize()` method:

```csharp
public override void PreInitialize()
{
    // ... existing registrations ...

    // Add configuration item registrations
    IocManager
        .RegisterConfigurableItemManager<{ConfigName},
            I{ConfigName}Manager, {ConfigName}Manager>()
        .RegisterConfigurableItemExport<{ConfigName},
            I{ConfigName}Export, {ConfigName}Export>()
        .RegisterConfigurableItemImport<{ConfigName},
            I{ConfigName}Import, {ConfigName}Import>();
}
```

## Selective Registration

Only register what you implemented:

| Implemented | Registration call |
|---|---|
| Manager only | `RegisterConfigurableItemManager` |
| Export only | `RegisterConfigurableItemExport` |
| Import only | `RegisterConfigurableItemImport` |
| All three | Chain all three calls |

All methods return `IIocManager` and can be chained. All services are registered as **Transient**.
