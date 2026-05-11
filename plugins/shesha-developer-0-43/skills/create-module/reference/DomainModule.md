# Domain Module Class Template

A Domain Module contains the core business logic: entities, repositories, domain services, and database migrations.

## Class Structure

The domain module class must:
- Inherit from `SheshaModule`
- Include the `[DependsOn]` attribute with required dependencies
- Implement the `ModuleInfo` property
- Override the lifecycle methods as needed

## Template

Replace placeholders:
- `{ModuleName}` - The module name in PascalCase (e.g., `DEP`, `ServiceManagement`)
- `{Organization}` - The organization/company name (e.g., `Org`, `Boxfusion`)
- `{Publisher}` - Same as `{Organization}` (the organization is the publisher)
  - Example: If namespace is `Org.DEP.Domain`, then `{Organization}` and `{Publisher}` are both `Org`

```csharp
using Abp.AspNetCore.Configuration;
using Abp.AutoMapper;
using Abp.Modules;
using Shesha;
using Shesha.Modules;
using System.Reflection;

namespace {Organization}.{ModuleName}.Domain
{
    /// <summary>
    /// {ModuleName} Module
    /// </summary>
    [DependsOn(
        typeof(SheshaCoreModule),
        typeof(SheshaApplicationModule)
    )]
    public class {ModuleName}Module : SheshaModule
    {
        /// <summary>
        /// Module information
        /// </summary>
        public override SheshaModuleInfo ModuleInfo => new SheshaModuleInfo("{Organization}.{ModuleName}")
        {
            FriendlyName = "{ModuleName}",
            Publisher = "{Publisher}",
        };

        /// <inheritdoc/>
        public override void Initialize()
        {
            var thisAssembly = Assembly.GetExecutingAssembly();
            IocManager.RegisterAssemblyByConvention(thisAssembly);

            Configuration.Modules.AbpAutoMapper().Configurators.Add(
                // Scan the assembly for classes which inherit from AutoMapper.Profile
                cfg => cfg.AddMaps(thisAssembly)
            );
        }

        /// <inheritdoc/>
        public override void PreInitialize()
        {
            base.PreInitialize();
        }

        /// <inheritdoc/>
        public override void PostInitialize()
        {
            Configuration.Modules.AbpAspNetCore().CreateControllersForAppServices(
                typeof({ModuleName}Module).Assembly,
                moduleName: "{ModuleName}",
                useConventionalHttpVerbs: true);
        }
    }
}
```

## Key Components Explained

### DependsOn Attribute

Specifies the modules this module depends on:
- `SheshaCoreModule` - Core Shesha framework functionality
- `SheshaApplicationModule` - Shesha application services

### ModuleInfo Property

Provides metadata about the module:
- **Name**: Full module identifier (e.g., `Org.DEP`)
- **FriendlyName**: Human-readable name for display
- **Publisher**: Organization that publishes this module (same as the organization name)

**Publisher Examples:**
| Namespace | Publisher |
|-----------|-----------|
| `Org.DEP.Domain` | `Org` |
| `Boxfusion.HR.Domain` | `Boxfusion` |
| `Acme.Sales.Domain` | `Acme` |

### Lifecycle Methods

| Method | When Called | Purpose |
|--------|-------------|---------|
| `PreInitialize()` | Before initialization | Configure settings, register dependencies |
| `Initialize()` | During initialization | Register assemblies, configure AutoMapper |
| `PostInitialize()` | After initialization | Register API controllers |

## Required Using Statements

```csharp
using Abp.AspNetCore.Configuration;
using Abp.AutoMapper;
using Abp.Modules;
using Shesha;
using Shesha.Modules;
using System.Reflection;
```

## File Location

Place this file at:
```
backend/src/{Organization}.{ModuleName}.Domain/{ModuleName}Module.cs
```

Example:
```
backend/src/Org.DEP.Domain/DEPModule.cs
```
