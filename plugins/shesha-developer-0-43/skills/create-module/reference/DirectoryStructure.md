# Module Directory Structure

## Overview

When creating a new module, establish the following directory structure within `backend/src/`.

## Complete Structure

Replace `{Prefix}` and `{ModuleName}` with actual values (e.g., `Org.Testing` and `ServiceManagement`).

```
backend/src/
│
├── {Prefix}.{ModuleName}.Domain/
│   │
│   ├── Domain/
│   │   └── (Entity classes go here)
│   │
│   ├── Migrations/
│   │   └── (FluentMigrator migration classes go here)
│   │
│   ├── Properties/
│   │   └── AssemblyInfo.cs
│   │
│   ├── {ModuleName}Module.cs
│   └── {Prefix}.{ModuleName}.Domain.csproj
│
└── {Prefix}.{ModuleName}.Application/
    │
    ├── Services/
    │   └── (Application service classes go here)
    │
    ├── {ModuleName}ApplicationModule.cs
    └── {Prefix}.{ModuleName}.Application.csproj
```

## Example: ServiceManagement Module

```
backend/src/
│
├── Org.Testing.ServiceManagement.Domain/
│   │
│   ├── Domain/
│   │   ├── ServiceRequest.cs
│   │   ├── ServiceCategory.cs
│   │   └── ServiceStatus.cs
│   │
│   ├── Migrations/
│   │   └── M20240101_001_InitialSchema.cs
│   │
│   ├── Properties/
│   │   └── AssemblyInfo.cs
│   │
│   ├── ServiceManagementModule.cs
│   └── Org.Testing.ServiceManagement.Domain.csproj
│
└── Org.Testing.ServiceManagement.Application/
    │
    ├── Services/
    │   ├── ServiceRequestAppService.cs
    │   └── ServiceCategoryAppService.cs
    │
    ├── ServiceManagementApplicationModule.cs
    └── Org.Testing.ServiceManagement.Application.csproj
```

## Folder Purposes

### Domain Project Folders

| Folder | Purpose | Contains |
|--------|---------|----------|
| `Domain/` | Business entities | Entity classes, value objects, domain services |
| `Migrations/` | Database migrations | FluentMigrator migration classes |
| `Properties/` | Assembly metadata | AssemblyInfo.cs |

### Application Project Folders

| Folder | Purpose | Contains |
|--------|---------|----------|
| `Services/` | Application services | App service classes, DTOs, interfaces |

## Additional Folders (Optional)

As the module grows, you may add:

### Domain Project
```
├── Repositories/          # Custom repository implementations
├── DomainServices/        # Domain service interfaces and implementations
├── Specifications/        # Specification pattern implementations
├── Events/                # Domain events
└── Enums/                 # Enum definitions (or use ReferenceList)
```

### Application Project
```
├── Dtos/                  # Data Transfer Objects (if separated from Services)
├── Mappings/              # AutoMapper profile classes
├── Validators/            # FluentValidation validators
└── Configuration/         # Configuration embedded resources
```

## Minimum Required Files

At minimum, a new module must have:

**Domain Project:**
1. `{Prefix}.{ModuleName}.Domain.csproj`
2. `{ModuleName}Module.cs`
3. `Properties/AssemblyInfo.cs`

**Application Project:**
1. `{Prefix}.{ModuleName}.Application.csproj`
2. `{ModuleName}ApplicationModule.cs`

The `Domain/`, `Migrations/`, and `Services/` folders can be empty initially but should be created to establish the structure.
