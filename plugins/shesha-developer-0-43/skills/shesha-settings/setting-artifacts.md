# Setting Artifacts

## §1. Setting Name Constants

**File:** `{ModuleName}SettingNames.cs` in `Configuration/` (Domain project)

```csharp
namespace {ModuleNamespace}.Domain.Configuration
{
    /// <summary>
    /// Setting name constants for the {ModuleName} module.
    /// </summary>
    public class {ModuleName}SettingNames
    {
        /// <summary>
        /// {SimpleSettingDescription}
        /// </summary>
        public const string {SettingName} = "{SettingPrefix}.{ModuleName}.{SettingName}";

        /// <summary>
        /// {CompoundSettingDescription}
        /// </summary>
        public const string {CompoundSettingName} = "{SettingPrefix}.{ModuleName}.{CompoundSettingName}";
    }
}
```

**Key rules:**
- Use the module's root namespace as the `{SettingPrefix}` (e.g. `Shesha`, `SaGov`)
- One constants class per module — add new constants here as settings grow
- Name format: `"{Prefix}.{Module}.{Setting}"` — keeps names globally unique

---

## §2. Setting Accessor Interface

**File:** `I{ModuleName}Settings.cs` in `Configuration/` (Domain project)

```csharp
using Shesha.Settings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace {ModuleNamespace}.Domain.Configuration
{
    [Category("{ModuleName}")]
    public interface I{ModuleName}Settings : ISettingAccessors
    {
        /// <summary>
        /// {SimpleSettingDescription}
        /// </summary>
        [Display(Name = "{Display Name}", Description = "{Description shown in Settings UI}")]
        [Setting({ModuleName}SettingNames.{SettingName})]
        ISettingAccessor<{PrimitiveType}> {SettingName} { get; set; }

        /// <summary>
        /// {CompoundSettingDescription}
        /// </summary>
        [Display(Name = "{Display Name}", Description = "{Description shown in Settings UI}")]
        [Setting({ModuleName}SettingNames.{CompoundSettingName}, EditorFormName = "{editor-form-name}")]
        ISettingAccessor<{CompoundClassName}> {CompoundSettingName} { get; set; }
    }
}
```

**Key rules:**
- One accessor interface per module — add new properties as settings grow
- Extends `ISettingAccessors`
- `[Category]` at interface level groups all settings; can also be per-property
- Simple settings use primitive `T`: `int`, `bool`, `string`, `decimal`, `DateTime`
- Compound settings use a custom class `T` and specify `EditorFormName`
- `EditorFormName` must match the name of a configurable form in Shesha UI

**Optional attributes:**
- `[Alias("camelCaseName")]` on the interface — overrides front-end group name
- `[Alias("camelCaseName")]` on a property — overrides front-end setting name

---

## §3. Compound Setting Class

**File:** `{CompoundClassName}.cs` in `Configuration/` (Domain project)

```csharp
namespace {ModuleNamespace}.Domain.Configuration
{
    /// <summary>
    /// {Description of what this group of settings controls}.
    /// </summary>
    public class {CompoundClassName}
    {
        /// <summary>
        /// {PropertyDescription}
        /// </summary>
        public {Type} {PropertyName} { get; set; }

        /// <summary>
        /// {PropertyDescription}
        /// </summary>
        public {Type} {PropertyName} { get; set; }
    }
}
```

**Key rules:**
- Plain POCO — no base class, no `virtual` keyword, no attributes
- Properties use standard C# types: `int`, `bool`, `string`, `decimal`, `DateTime`, `List<T>`
- Keep related values together in one class
- Property names become camelCase field names in the editor form (e.g. `DebitDay` -> `debitDay`)

---

## §4. Module Registration

Add setting registration to the module's `Initialize()` method. This goes in the **Application module** class (or the Domain module if no Application module exists).

**Simple setting registration:**

```csharp
public override void Initialize()
{
    var thisAssembly = Assembly.GetExecutingAssembly();
    IocManager.RegisterAssemblyByConvention(thisAssembly);

    // Register settings with default values
    IocManager.RegisterSettingAccessor<I{ModuleName}Settings>(x =>
    {
        x.{SettingName}.WithDefaultValue({defaultValue});
    });
}
```

**Compound setting registration:**

```csharp
IocManager.RegisterSettingAccessor<I{ModuleName}Settings>(x =>
{
    x.{SettingName}.WithDefaultValue({defaultValue});
    x.{CompoundSettingName}.WithDefaultValue(new {CompoundClassName}
    {
        {PropertyName} = {defaultValue},
        {PropertyName} = {defaultValue},
    });
});
```

**Key rules:**
- Call `RegisterSettingAccessor<T>` once per accessor interface
- Provide sensible default values for every setting
- Registration goes in `Initialize()` after `RegisterAssemblyByConvention`
- If the module already has `RegisterSettingAccessor`, add to the existing lambda
- The `using` for the Configuration namespace must be added to the module file

---

## §5. Compound Setting Editor Form

Compound settings require a configurable form in Shesha whose **form name** matches the `EditorFormName` specified on the `[Setting]` attribute. This form provides the admin UI for editing the compound setting values.

### Creating the editor form via Shesha MCP (preferred)

Check if the Shesha MCP server is connected by looking for MCP tools with names containing `shesha` (e.g., `shesha:create_form`).

**If Shesha MCP IS available:**

1. Use the MCP `create_form` tool to create the editor form. Pass the compound setting class properties as the form requirements. Example prompt to the MCP:
   > Create a settings editor form named "{editor-form-name}" with fields for: {list each property from the compound class with its type and description}

2. The form name passed to MCP **must exactly match** the `EditorFormName` in the `[Setting]` attribute.

3. After the MCP tool completes, report to the user:
   - The form name and module it was created under
   - Any warnings or errors from the MCP
   - The test URL (via `getTestUrl` MCP tool) so they can preview the form

4. Field naming: use camelCase property names (e.g. `DebitDay` -> `debitDay`, `InitialReminder` -> `initialReminder`).

**If Shesha MCP is NOT available:**

Inform the user that the editor form must be created manually and provide instructions:

> **The Shesha MCP server is not connected**, so the editor form `{editor-form-name}` could not be created automatically.
>
> To create it manually:
> 1. In the Shesha UI, navigate to **Forms** and create a new form.
> 2. Set the form **name** to `{editor-form-name}` (must match exactly).
> 3. Add form fields for each property in the compound setting class, using camelCase names:
>    {list each property with its camelCase name and type}
> 4. Save and optionally publish the form.
>
> To enable automatic form creation in future, install the Shesha MCP server:
> ```
> claude mcp add shesha -s local --transport sse http://localhost:8000/sse \
>   -H "backend_url: http://localhost:{port}" \
>   -H "backend_username: admin" \
>   -H "backend_password: 123qwe" \
>   -H "db_server: ." \
>   -H "db_database: {DBName}"
> ```

### Editor form requirements

- Form name must exactly match `EditorFormName` in the `[Setting]` attribute
- Each property in the compound class needs a corresponding form field in camelCase
- Use appropriate field types: `number` for `int`/`decimal`, `checkbox` for `bool`, `textField` for `string`, `datePicker` for `DateTime`
- Add descriptions to fields so administrators understand what each setting controls
