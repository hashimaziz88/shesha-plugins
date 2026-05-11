# AssemblyInfo.cs Template

The `AssemblyInfo.cs` file is required in the Domain project to define assembly-level attributes, particularly the table prefix for database entities.

## Template

Replace placeholders:
- `{Organization}` - The organization/company name (e.g., `Org`, `Boxfusion`)
- `{ModuleName}` - The module name in PascalCase (e.g., `DEP`, `ServiceManagement`)
- `{TablePrefix}` - The database table prefix (typically `{ModuleName}_`)
- `{GUID}` - A new unique GUID (generate using `Guid.NewGuid()`)

### File: `Properties/AssemblyInfo.cs`

```csharp
using System.Reflection;
using System.Runtime.InteropServices;
using Intent.RoslynWeaver.Attributes;
using Shesha.Attributes;

// General Information about an assembly is controlled through the following
// set of attributes. Change these attribute values to modify the information
// associated with an assembly.
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("")]
[assembly: AssemblyProduct("{Organization}.{ModuleName}")]

[assembly: AssemblyTrademark("")]

// Setting ComVisible to false makes the types in this assembly not visible
// to COM components.  If you need to access a type in this assembly from
// COM, set the ComVisible attribute to true on that type.
[assembly: ComVisible(false)]

// The following GUID is for the ID of the typelib if this project is exposed to COM
[assembly: Guid("{GUID}")]

[assembly: TablePrefix("{TablePrefix}")]
[assembly: IntentTemplate("Boxfusion.Modules.Domain.Properties", Version = "1.0")]
```

## Key Attributes Explained

### TablePrefix Attribute

```csharp
[assembly: TablePrefix("DEP_")]
```

This is **critical** - it defines the prefix for all database tables created by entities in this module:
- Entity `Department` becomes table `DEP_Departments`
- Prevents table name collisions between modules
- Should match the module name followed by underscore

**Examples:**
| Module Name | Table Prefix | Entity Example | Table Name |
|-------------|--------------|----------------|------------|
| DEP | `DEP_` | `Department` | `DEP_Departments` |
| ServiceManagement | `ServiceManagement_` | `ServiceRequest` | `ServiceManagement_ServiceRequests` |

### Guid Attribute

```csharp
[assembly: Guid("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")]
```

A unique identifier for the assembly. Generate a new GUID for each module:

**PowerShell:**
```powershell
[guid]::NewGuid().ToString()
```

**C#:**
```csharp
Guid.NewGuid().ToString()
```

### IntentTemplate Attribute

```csharp
[assembly: IntentTemplate("Boxfusion.Modules.Domain.Properties", Version = "1.0")]
```

Used by Intent Architect code generation tools. Keep this standard value unless using custom Intent templates.

## File Location

```
backend/src/{Organization}.{ModuleName}.Domain/Properties/AssemblyInfo.cs
```

Example:
```
backend/src/Org.DEP.Domain/Properties/AssemblyInfo.cs
```

## Important Notes

1. **Only create for Domain projects** - Application projects don't need AssemblyInfo.cs
2. **Table prefix must be unique** - No two modules should share the same prefix
3. **Generate new GUID** - Don't copy GUIDs from other projects
