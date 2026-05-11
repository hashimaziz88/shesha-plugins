# Application Module Class Template

An Application Module contains application services, DTOs, and API endpoints. It depends on the corresponding Domain Module.

## Class Structure

The application module class must:
- Inherit from `SheshaSubModule<TDomainModule>` where `TDomainModule` is the corresponding domain module
- Include the `[DependsOn]` attribute with required dependencies
- Override the lifecycle methods as needed

## Template

Replace placeholders:
- `{ModuleName}` - The module name in PascalCase (e.g., `DEP`, `ServiceManagement`)
- `{Organization}` - The organization/company name (e.g., `Org`, `Boxfusion`)

```csharp
using Abp.AspNetCore;
using Abp.AspNetCore.Configuration;
using Abp.AutoMapper;
using Abp.Modules;
using {Organization}.{ModuleName}.Domain;
using Shesha;
using Shesha.Modules;
using System.Reflection;
using System.Threading.Tasks;

namespace {Organization}.{ModuleName}.Application
{
    /// <summary>
    /// {ModuleName} Application Module
    /// </summary>
    [DependsOn(
        typeof({ModuleName}Module),
        typeof(SheshaCoreModule),
        typeof(AbpAspNetCoreModule)
    )]
    public class {ModuleName}ApplicationModule : SheshaSubModule<{ModuleName}Module>
    {
        /// <summary>
        /// Initialize module configuration
        /// </summary>
        public override async Task<bool> InitializeConfigurationAsync()
        {
            // Import any configuration embedded as resources in this assembly on application start-up.
            return await ImportConfigurationAsync();
        }

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

            // Register controllers for this module's API endpoints
            Configuration.Modules.AbpAspNetCore().CreateControllersForAppServices(
               typeof({ModuleName}ApplicationModule).Assembly,
               moduleName: "{ModuleName}",
               useConventionalHttpVerbs: true);
        }
    }
}
```

## Key Components Explained

### Inheritance

The application module inherits from `SheshaSubModule<{ModuleName}Module>`:
- This establishes the parent-child relationship between Application and Domain modules
- The generic parameter specifies which domain module this application module extends

### DependsOn Attribute

```csharp
[DependsOn(
    typeof({ModuleName}Module),      // The corresponding domain module
    typeof(SheshaCoreModule),        // Core Shesha functionality
    typeof(AbpAspNetCoreModule)      // ASP.NET Core integration
)]
```

### InitializeConfigurationAsync Method

Used for importing configuration from embedded resources:
```csharp
public override async Task<bool> InitializeConfigurationAsync()
{
    return await ImportConfigurationAsync();
}
```

### Controller Registration

Registers application services as API controllers in `PreInitialize()`:
```csharp
Configuration.Modules.AbpAspNetCore().CreateControllersForAppServices(
   typeof({ModuleName}ApplicationModule).Assembly,
   moduleName: "{ModuleName}",
   useConventionalHttpVerbs: true);
```

## Required Using Statements

```csharp
using Abp.AspNetCore;
using Abp.AspNetCore.Configuration;
using Abp.AutoMapper;
using Abp.Modules;
using {Organization}.{ModuleName}.Domain;
using Shesha;
using Shesha.Modules;
using System.Reflection;
using System.Threading.Tasks;
```

## File Location

Place this file at:
```
backend/src/{Organization}.{ModuleName}.Application/{ModuleName}ApplicationModule.cs
```

Example:
```
backend/src/Org.DEP.Application/DEPApplicationModule.cs
```
