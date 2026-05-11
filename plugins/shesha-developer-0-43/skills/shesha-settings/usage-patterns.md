# Usage Patterns

## §1. Reading and Writing Settings in Back-End Code

Inject the accessor interface via constructor injection. Shesha auto-generates the implementation.

```csharp
public class {ServiceName}AppService : SheshaAppServiceBase
{
    private readonly I{ModuleName}Settings _{camelModuleName}Settings;

    public {ServiceName}AppService(I{ModuleName}Settings {camelModuleName}Settings)
    {
        _{camelModuleName}Settings = {camelModuleName}Settings;
    }

    public async Task SomeMethod()
    {
        // Read a simple setting
        var value = await _{camelModuleName}Settings.{SettingName}.GetValueAsync();

        // Read a compound setting
        var settings = await _{camelModuleName}Settings.{CompoundSettingName}.GetValueAsync();
        var specificValue = settings.{PropertyName};

        // Write a simple setting
        await _{camelModuleName}Settings.{SettingName}.SetValueAsync({newValue});

        // Write a compound setting (pass a new instance)
        await _{camelModuleName}Settings.{CompoundSettingName}.SetValueAsync(new {CompoundClassName}
        {
            {PropertyName} = {newValue},
        });
    }
}
```

**Available methods:**

| Method | Description |
|--------|-------------|
| `GetValueAsync()` | Returns stored value, or default if none saved |
| `SetValueAsync(value)` | Saves a new value to the database |
| `GetValue()` | Synchronous version of `GetValueAsync()` |
| `GetValueOrNullAsync()` | Returns `null` instead of default when no value saved |

**Advanced — explicit context override:**

```csharp
var context = new SettingManagementContext
{
    AppKey = "my-frontend-app",
    TenantId = 42,
    UserId = 123
};
var value = await _{camelModuleName}Settings.{SettingName}.GetValueAsync(context);
```

Use `SettingManagementContext` only in background jobs or multi-tenant scenarios where automatic context detection is unavailable.

---

## §2. Front-End Access

Settings are available in form script editors via `application.settings`:

```
application.settings.{module}.{group}.{setting}
```

**Reading and writing:**

```javascript
const settings = application.settings.{moduleName}.{groupName};

// Read
const value = await settings.{settingName}.getValueAsync();

// Write
await settings.{settingName}.setValueAsync(newValue);
```

**Alias resolution:**
- **Module**: `Alias` property of `SheshaModuleInfo`, or module name in camelCase
- **Group**: `[Alias]` on the accessor interface, or interface name without `I` prefix and `Settings` suffix in camelCase
- **Setting**: `[Alias]` on the property, or property name in camelCase

**Example:** Interface `IMembershipSettings` with `[Alias("common")]` in module with `Alias = "membership"`, property `DebitDay`:
```javascript
application.settings.membership.common.debitDay
```

---

## §3. User-Specific Settings

User-specific settings store a separate value per user. The only difference from global settings is `IsUserSpecific = true` on the `[Setting]` attribute.

**Domain definition:**

```csharp
public class {ModuleName}SettingNames
{
    public const string {UserSettingName} = "{SettingPrefix}.{ModuleName}.{UserSettingName}";
}

[Category("{CategoryName}")]
public interface I{ModuleName}Settings : ISettingAccessors
{
    [Display(Name = "{Display Name}", Description = "{Description}")]
    [Setting({ModuleName}SettingNames.{UserSettingName}, IsUserSpecific = true)]
    ISettingAccessor<{Type}> {UserSettingName} { get; set; }
}
```

**Registration — same as global:**

```csharp
IocManager.RegisterSettingAccessor<I{ModuleName}Settings>(x =>
{
    x.{UserSettingName}.WithDefaultValue({defaultValue});
});
```

**Back-end usage — same API, Shesha scopes automatically to current user:**

```csharp
var value = await _{camelModuleName}Settings.{UserSettingName}.GetValueAsync();
await _{camelModuleName}Settings.{UserSettingName}.SetValueAsync({newValue});
```

**Front-end usage — via `application.user`:**

```javascript
// Read
const value = await application.user.getUserSettingValueAsync(
    "{SettingName}",     // setting name
    "{ModuleName}",      // module name
    {defaultValue}       // default (optional)
);

// Write
await application.user.updateUserSettingValueAsync(
    "{SettingName}",
    "{ModuleName}",
    {newValue}
);
```

**REST API endpoints (for custom front-ends):**

| Action | Method | URL |
|--------|--------|-----|
| Get value | `GET` | `/api/services/app/Settings/GetUserValue?moduleName={mod}&settingName={name}` |
| Update value | `POST` | `/api/services/app/Settings/UpdateUserValue` |

Both endpoints auto-create the user setting if it doesn't exist.
