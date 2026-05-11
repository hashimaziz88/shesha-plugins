---
name: create-module
description: Creates properly structured Shesha framework module projects (Domain and Application) following existing codebase conventions.
---

# Create Module Skill

This skill creates new Shesha framework module projects following the established patterns in the codebase.

## Overview

In the Shesha framework, modules are organized into paired projects:
- **Domain Project**: Contains entities, repositories, domain services, and migrations
- **Application Project**: Contains application services, DTOs, and API endpoints

## Before You Begin

1. **Identify the organization name** by examining the `backend/src/` directory
   - Look for existing `.Domain` and `.Application` projects
   - Example: `Org.Testing.Domain` indicates the organization is `Org` and `Testing` is one module

2. **Determine the new module name** from the user's request
   - Example: User requests "DEP" module under organization `Org`
   - This becomes `Org.DEP.Domain` and `Org.DEP.Application`
   - **NOT** `Org.Testing.DEP.Domain` - modules are independent, not nested

## Decision Flowchart

```
User requests module "{ModuleName}"
           │
           ▼
┌─────────────────────────────────┐
│ Does {Prefix}.{ModuleName}.Domain │
│ directory/csproj exist?          │
└─────────────────────────────────┘
           │
     ┌─────┴─────┐
     │           │
    YES          NO
     │           │
     ▼           ▼
┌─────────┐  ┌─────────────┐
│ Does    │  │ SCENARIO B  │
│ Module  │  │ Create full │
│ class   │  │ project     │
│ exist?  │  │ structure   │
└─────────┘  └─────────────┘
     │
  ┌──┴──┐
  │     │
 YES    NO
  │     │
  ▼     ▼
DONE  ┌─────────────┐
      │ SCENARIO A  │
      │ Create only │
      │ module class│
      └─────────────┘
```

## Scenarios

This skill handles two distinct scenarios:

### Scenario A: Project Exists, Module Class Missing

The `.csproj` file exists but the module class file is missing. This is common when:
- Projects were scaffolded but not fully implemented
- The WebCoreModule references modules that don't exist yet

**Detection:**
```
backend/src/MyOrg.MyProject.Domain/MyOrg.MyProject.Domain.csproj  ← EXISTS
backend/src/MyOrg.MyProject.Domain/TestingModule.cs          ← MISSING
```

**Action:** Only create the missing module class file(s).

### Scenario B: Entirely New Module

Neither the project directory nor the module class exists.

**Detection:**
```
backend/src/MyOrg.ServiceManagement.Domain/        ← MISSING (entire folder)
```

**Action:** Create the full project structure (directory, .csproj, module class, AssemblyInfo).

---

## Step-by-Step Process

### Step 1: Analyze Existing Structure

Search for existing module patterns:
```
backend/src/**/*.csproj
backend/src/**/*Module.cs
```

**Critical Analysis:**
1. List all `.csproj` files to find existing projects
2. List all `*Module.cs` files to find existing module classes
3. Compare the two lists to identify:
   - Projects with missing module classes (Scenario A)
   - Module names that need new projects (Scenario B)

**Example Analysis:**
```
Found .csproj files:
  - MyOrg.MyProject.Domain.csproj           → Expects: MyProjectModule.cs
  - MyOrg.MyProject.Application.csproj      → Expects: MyProjectApplicationModule.cs

Found *Module.cs files:
  - (none in Domain or Application)

Result: Scenario A - Create MyProjectModule.cs and MyProjectApplicationModule.cs
```

### Step 2: Determine Naming Convention

**CRITICAL: Understanding the Module Hierarchy**

Each module is **independent** under the organization. Modules are NOT nested.

**Pattern:** `{Organization}.{ModuleName}.{Type}`
- `{Organization}` - The company/organization name (e.g., `Org`, `Boxfusion`, `Acme`)
- `{ModuleName}` - The module name (e.g., `Testing`, `DEP`, `ServiceManagement`)
- `{Type}` - Either `Domain` or `Application`

**Examples:**
| Existing Project | Organization | Module Name | New Module Example |
|------------------|--------------|-------------|-------------------|
| `Org.Testing.Domain` | `Org` | `Testing` | `Org.DEP.Domain` (NOT `Org.Testing.DEP.Domain`) |
| `Boxfusion.HR.Domain` | `Boxfusion` | `HR` | `Boxfusion.Payroll.Domain` |
| `Acme.Sales.Domain` | `Acme` | `Sales` | `Acme.Inventory.Domain` |

**Deriving the Publisher:**
The publisher is the organization name (first part before the first dot):
- From `Org.Testing.Domain` → Publisher is `Org`
- From `Boxfusion.HR.Domain` → Publisher is `Boxfusion`
- From `Acme.Sales.Domain` → Publisher is `Acme`

**Deriving module class name from project name:**
| Project Name | Module Class Name |
|--------------|-------------------|
| `Org.Testing.Domain` | `TestingModule` |
| `Org.Testing.Application` | `TestingApplicationModule` |
| `Org.DEP.Domain` | `DEPModule` |
| `Org.DEP.Application` | `DEPApplicationModule` |
| `Org.ServiceManagement.Domain` | `ServiceManagementModule` |

### Step 3: Create Based on Scenario

#### For Scenario A (Missing Module Class Only)

Skip directory and .csproj creation. Only create:
1. **Domain Module Class** - Place in existing Domain project root
2. **Application Module Class** - Place in existing Application project root

Example for `MyOrg.MyProject.Domain` missing `MyProjectModule.cs`:
```
backend/src/MyOrg.MyProject.Domain/MyProjectModule.cs  ← CREATE THIS
```

#### For Scenario B (New Module Project)

Create full directory structure:

For a new module named `DEP` under organization `Org`:

```
backend/src/
├── Org.DEP.Domain/
│   ├── Domain/                    # Entity classes
│   ├── Migrations/                # FluentMigrator migrations
│   ├── Properties/
│   │   └── AssemblyInfo.cs
│   ├── DEPModule.cs
│   └── Org.DEP.Domain.csproj
│
└── Org.DEP.Application/
    ├── Services/                  # Application services
    ├── DEPApplicationModule.cs
    └── Org.DEP.Application.csproj
```

### Step 4: Create Files

#### For Scenario A (Module Class Only)

Create only the missing module class files:

1. **Domain Module Class** - See [reference/DomainModule.md](reference/DomainModule.md)
   - Place at: `backend/src/{Prefix}.Domain/{ModuleName}Module.cs`
2. **Application Module Class** - See [reference/ApplicationModule.md](reference/ApplicationModule.md)
   - Place at: `backend/src/{Prefix}.Application/{ModuleName}ApplicationModule.cs`

**Example:** For `MyOrg.MyProject.Domain` project, create:
```
backend/src/MyOrg.MyProject.Domain/TestingModule.cs
backend/src/MyOrg.MyProject.Application/TestingApplicationModule.cs
```

#### For Scenario B (Full Project)

Create all files in order:

1. **Domain .csproj** - See [reference/ProjectFiles.md](reference/ProjectFiles.md)
2. **Domain AssemblyInfo.cs** - See [reference/AssemblyInfo.md](reference/AssemblyInfo.md)
3. **Domain Module Class** - See [reference/DomainModule.md](reference/DomainModule.md)
4. **Application .csproj** - See [reference/ProjectFiles.md](reference/ProjectFiles.md)
5. **Application Module Class** - See [reference/ApplicationModule.md](reference/ApplicationModule.md)

### Step 5: Register in Solution (Scenario B Only)

Skip this step for Scenario A (projects already in solution).

For Scenario B, add the new projects to the `.sln` file using `dotnet sln add`:
```bash
dotnet sln backend/{Solution}.sln add backend/src/{Organization}.{ModuleName}.Domain/{Organization}.{ModuleName}.Domain.csproj
dotnet sln backend/{Solution}.sln add backend/src/{Organization}.{ModuleName}.Application/{Organization}.{ModuleName}.Application.csproj
```

**Example:**
```bash
dotnet sln backend/Org.Testing.sln add backend/src/Org.DEP.Domain/Org.DEP.Domain.csproj
dotnet sln backend/Org.Testing.sln add backend/src/Org.DEP.Application/Org.DEP.Application.csproj
```

### Step 6: Add Project References to Web.Core (Scenario B Only)

**CRITICAL STEP** - Without this, the WebCoreModule won't be able to reference the new modules.

Skip this step for Scenario A (references already exist).

For Scenario B, add project references to the `Web.Core` project's `.csproj` file:

1. Find the Web.Core project (typically `{Organization}.Testing.Web.Core`, `{Organization}.{AppName}.Web.Core`, or similar)
2. Locate the `<ItemGroup>` containing `<ProjectReference>` elements
3. Add `<ProjectReference>` elements for both the new Domain and Application projects

**Example for `Org.Testing.Web.Core.csproj`:**
```xml
<ItemGroup>
  <ProjectReference Include="..\Org.Testing.Application\Org.Testing.Application.csproj" />
  <ProjectReference Include="..\Org.DEP.Application\Org.DEP.Application.csproj" />
  <ProjectReference Include="..\Org.DEP.Domain\Org.DEP.Domain.csproj" />
  <ProjectReference Include="..\Org.Testing.Domain\Org.Testing.Domain.csproj" />
</ItemGroup>
```

### Step 7: Wire Up Dependencies in WebCoreModule

Add the new modules to the WebCoreModule's `[DependsOn]` attribute:
```csharp
[DependsOn(
    // ... existing dependencies ...
    typeof(ServiceManagementModule),
    typeof(ServiceManagementApplicationModule)
)]
```

Add the required `using` statements to the WebCoreModule:
```csharp
using {Organization}.{ModuleName}.Domain;
using {Organization}.{ModuleName}.Application;
```

**Example:**
```csharp
using Org.DEP.Domain;
using Org.DEP.Application;
```

## Naming Rules

| Component | Naming Pattern | Example |
|-----------|---------------|---------|
| Domain Project | `{Organization}.{ModuleName}.Domain` | `Org.DEP.Domain` |
| Domain Module Class | `{ModuleName}Module` | `DEPModule` |
| Application Project | `{Organization}.{ModuleName}.Application` | `Org.DEP.Application` |
| Application Module Class | `{ModuleName}ApplicationModule` | `DEPApplicationModule` |
| Publisher | Same as `{Organization}` | `Org` |
| Table Prefix | `{ModuleName}_` | `DEP_` |
| ModuleInfo Name | `{Organization}.{ModuleName}` | `Org.DEP` |

**Important:** Modules are independent and NOT nested. If you have `Org.Testing.Domain`, a new module should be `Org.DEP.Domain`, NOT `Org.Testing.DEP.Domain`.

## Critical Checks

### Before Creating

1. **Determine the scenario:**
   - [ ] Check if `.csproj` exists → If yes, check if module class exists
   - [ ] Scenario A: `.csproj` exists, module class missing
   - [ ] Scenario B: Neither exists (new module)

2. **Verify naming:**
   - [ ] Confirm the organization prefix from existing projects
   - [ ] Ensure the module name follows PascalCase
   - [ ] Check WebCoreModule for expected module type names (may already reference missing modules)

### After Creating

**For Scenario A:**
- [ ] Verify module class compiles (check namespaces match project)
- [ ] Verify WebCoreModule `[DependsOn]` already includes the module types
- [ ] Verify the solution builds successfully

**For Scenario B:**
- [ ] Verify projects are added to the solution
- [ ] Verify WebCoreModule has been updated with dependencies
- [ ] Verify the solution builds successfully

## Reference Files

- [ModuleClass.md](reference/ModuleClass.md) - Overview of module architecture
- [DomainModule.md](reference/DomainModule.md) - Domain module class template
- [ApplicationModule.md](reference/ApplicationModule.md) - Application module class template
- [ProjectFiles.md](reference/ProjectFiles.md) - .csproj file templates
- [AssemblyInfo.md](reference/AssemblyInfo.md) - AssemblyInfo.cs template
- [DirectoryStructure.md](reference/DirectoryStructure.md) - Expected folder structure
