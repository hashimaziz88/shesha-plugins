# Domain/Application Module Class Guidelines

## Overview

In the Shesha framework, every back-end project (`.csproj`) requires a module class that defines its dependencies, configuration, and initialization logic. These modules form the foundation of the application's architecture and establish the relationship between different components.

## Module Types

There are three main types of module classes in Shesha:

- **Domain Module**: Contains domain entities, repositories, and domain services.
- **Application Module**: Contains application services and APIs.
- **Combined Module**: Contains both domain and application components.

## Naming Conventions

| Module Type   | Class Naming Convention       |
|---------------|-------------------------------|
| Domain        | `[ModuleName]Module`          |
| Application   | `[ModuleName]ApplicationModule` |
| Combined      | `[ModuleName]Module`          |

## Module Implementation Guidelines

### Domain Module Implementation

A **Domain Module** should:

- Inherit from `SheshaModule`.
- Include appropriate `[DependsOn]` attributes.
- Implement the `ModuleInfo` property.
- Override necessary lifecycle methods.

```csharp
/// <summary>
/// HisCommon Module
/// </summary>
[DependsOn(
    typeof(SheshaCoreModule),
    typeof(SheshaApplicationModule)
)]
public class HisModule : SheshaModule
{
    public override SheshaModuleInfo ModuleInfo => new SheshaModuleInfo("Boxfusion.His")
    {
        FriendlyName = "His",
        Publisher = "Boxfusion",
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
            typeof(HisModule).Assembly,
            moduleName: "His",
            useConventionalHttpVerbs: true);
    }
}
```

### Application Module Implementation

An **Application Module** should:

- Inherit from `SheshaSubModule<TDomainModule>` where `TDomainModule` is the corresponding domain module.
- Include appropriate `[DependsOn]` attributes.
- Implement configuration initialization.
- Override necessary lifecycle methods.

```csharp
/// <summary>
/// His Application Module
/// </summary>
[DependsOn(
    typeof(HisModule),
    typeof(SheshaCoreModule),
    typeof(AbpAspNetCoreModule)
)]
public class HisApplicationModule : SheshaSubModule<HisModule>
{
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
        
        // Register controllers for API endpoints
        Configuration.Modules.AbpAspNetCore()
            .CreateControllersForAppServices(
                typeof(SheshaCoreModule).GetAssembly()
            );
            
        // Additional controller registrations for other modules
        Configuration.Modules.AbpAspNetCore()
             .CreateControllersForAppServices(
                 typeof(SheshaApplicationModule).GetAssembly()
             );
             
        // Register controllers for this module
        Configuration.Modules.AbpAspNetCore().CreateControllersForAppServices(
           typeof(HisApplicationModule).Assembly,
           moduleName: "His",
           useConventionalHttpVerbs: true);
    }
}
```

## Key Module Methods

| Method                     | Purpose                                | Usage                                      |
|----------------------------|----------------------------------------|--------------------------------------------|
| `ModuleInfo`               | Provides metadata about the module    | Define the module name, friendly name, and publisher |
| `PreInitialize()`          | Called before module initialization   | Configure dependencies, register settings |
| `Initialize()`             | Primary initialization method         | Register assemblies, configure AutoMapper |
| `PostInitialize()`         | Called after initialization           | Register controllers for API endpoints    |
| `InitializeConfigurationAsync()` | Initialize module configuration | Import configuration from embedded resources |

## Module Dependencies

Use the `[DependsOn]` attribute to specify module dependencies. Common dependencies include:

- `SheshaCoreModule`: Core Shesha framework functionality.
- `SheshaApplicationModule`: Shesha application services.
- `AbpAspNetCoreModule`: ASP.NET Core integration.

## Best Practices

- **Proper Dependency Management**: Ensure your module explicitly depends on all modules it requires.
- **Assembly Registration**: Always register the current assembly using `IocManager.RegisterAssemblyByConvention()`.
- **AutoMapper Configuration**: Register AutoMapper profiles from the assembly.
- **API Controller Registration**: Register app services as controllers in the appropriate lifecycle method.
- **XML Documentation**: Include proper XML documentation comments for the module class.
- **Inheritance Hierarchy**: Domain modules should inherit from `SheshaModule`, while application modules should inherit from `SheshaSubModule<TDomainModule>`.
- **Clear Naming**: Use consistent naming that reflects the module's purpose.

## Integration with Shesha Framework

When developing new modules, ensure they properly integrate with the Shesha framework by:

- Following the inheritance hierarchy.
- Implementing all required methods.
- Registering dependencies correctly.
- Using proper namespaces that match your module structure.
