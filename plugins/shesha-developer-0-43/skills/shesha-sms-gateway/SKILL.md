---
name: shesha-sms-gateway
description: Creates and registers a custom ISmsGateway implementation in a Shesha .NET application. Scaffolds all required artifacts as a standalone integration project: gateway class, settings DTO, setting name constants, settings accessor interface, marker interface, module registration, and an xUnit integration test project. Use when the user asks to add, create, implement, register, or scaffold a new SMS gateway, SMS provider, SMS integration, or ISmsGateway in a Shesha project.
---

# Shesha SMS Gateway

Generate all artifacts to add a new `ISmsGateway` implementation to a Shesha .NET application based on $ARGUMENTS.

## Instructions

- Inspect nearby files to determine the correct namespace root, publisher name, and `$(SheshaVersion)` variable usage.
- The gateway lives in its own standalone project: `backend/src/Module/{Publisher}.Sms.{GatewayName}/`.
- Settings use **individual `ISettingAccessor<string>` properties** on the accessor interface — do NOT use a compound `ISettingAccessor<{GatewayName}Settings>` object.
- The `[ClassUid]` on the gateway class **must** be a newly generated GUID — generate a fresh UUID; never reuse an existing one.
- The `[Display(Name = "...")]` value on the gateway class is what appears in the Shesha admin UI gateway selector.
- Inject `IHttpClientFactory` into the gateway constructor — never use `new HttpClient()`.
- Register the module with `[DependsOn(typeof(SheshaFrameworkModule), typeof(SheshaApplicationModule), typeof(AbpAspNetCoreModule))]`.
- `RegisterSettingAccessor<I{GatewayName}Settings>` goes in `PreInitialize`; `RegisterAssemblyByConvention` goes in `Initialize`.
- The gateway is selected at runtime via `[ClassUid]` — the UID stored in `SmsSettings.SmsGateway` must match the GUID on the class.
- Implement `ConfigurableSmsGateway<TSettings>` (not `ISmsGateway` directly).
- `ITransientDependency` is NOT required — Castle Windsor picks up the gateway via `RegisterAssemblyByConvention`.
- Do NOT log raw request/response bodies — they may contain PII (phone numbers, message content).
- Always scaffold the integration test project alongside the gateway project.
- Add `**/testsettings.json` to `backend/.gitignore` before committing.

## Artifact catalog

| # | Artifact | Location | Template |
|---|----------|----------|----------|
| 1 | Project `.csproj` | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §1 |
| 2 | Settings DTO | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §2 |
| 3 | Setting name constants | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §3 |
| 4 | Settings accessor interface | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §4 |
| 5 | Gateway marker interface | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §5 |
| 6 | Gateway implementation | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §6 |
| 7 | ABP Module | Gateway project root | [gateway-artifacts.md](gateway-artifacts.md) §7 |
| 8 | Test project `.csproj` | Test project root | [gateway-artifacts.md](gateway-artifacts.md) §8 |
| 9 | Test settings file | Test project root | [gateway-artifacts.md](gateway-artifacts.md) §9 |
| 10 | Test class | Test project root | [gateway-artifacts.md](gateway-artifacts.md) §10 |

## Folder structure

```
backend/src/Module/{Publisher}.Sms.{GatewayName}/
  {Publisher}.Sms.{GatewayName}.csproj    §1  project file
  {GatewayName}SettingDto.cs                        §2  API-facing DTO
  {GatewayName}SettingNames.cs                      §3  string constants
  I{GatewayName}Settings.cs                         §4  setting accessor interface
  I{GatewayName}SmsGateway.cs                       §5  marker interface
  {GatewayName}SmsGateway.cs                        §6  gateway implementation
  Shesha{GatewayName}Module.cs                      §7  ABP module + IoC registration

backend/test/{Publisher}.Sms.{GatewayName}.Tests/
  {Publisher}.Sms.{GatewayName}.Tests.csproj  §8  test project file
  testsettings.json                                     §9  live credentials (gitignored)
  {GatewayName}SmsGateway_Tests.cs                     §10 xUnit test class
```

## Wiring the project into the solution

After creating the project files, wire them up:

### 1. Add to solution file (`backend/boxfusion.dsdnpo.sln`)

Add both projects under the appropriate solution folders. Use new GUIDs for each:

```
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "{Publisher}.Sms.{GatewayName}", "src\Module\{Publisher}.Sms.{GatewayName}\{Publisher}.Sms.{GatewayName}.csproj", "{NEW-GUID-1}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "{Publisher}.Sms.{GatewayName}.Tests", "test\{Publisher}.Sms.{GatewayName}.Tests\{Publisher}.Sms.{GatewayName}.Tests.csproj", "{NEW-GUID-2}"
EndProject
```

Nest them under solution folders in `GlobalSection(NestedProjects)` if the solution uses folder nesting.

### 2. Reference the gateway project from the Web.Host project

In `backend/src/{Product}.Web.Host/{Product}.Web.Host.csproj`, add:

```xml
<ProjectReference Include="..\Module\{Publisher}.Sms.{GatewayName}\{Publisher}.Sms.{GatewayName}.csproj" />
```

### 3. Add the module to the host's `[DependsOn]`

In the host startup module (e.g., `SheshaWebHostModule.cs`), add:

```csharp
using {Publisher}.Sms.{GatewayName};

// ...

[DependsOn(
    // ... existing modules ...
    typeof(Shesha{GatewayName}Module)
)]
public class SheshaWebHostModule : AbpModule { ... }
```

### 4. Gitignore test credentials

In `backend/.gitignore`, add:

```
**/testsettings.json
```

## Quick reference

### Key base classes and interfaces

| Type | Purpose |
|------|---------|
| `ConfigurableSmsGateway<TSettings>` | Base for gateways with settings; implements `ISmsGateway` |
| `ISmsGateway` | Raw interface if no settings needed |
| `IConfigurableSmsGateway<TSettings>` | Extended interface adding typed get/set settings |
| `ISettingAccessors` | Base for setting accessor interfaces |
| `ISettingAccessor<T>` | Per-setting accessor property type (`GetValueAsync()`, `SetValueAsync()`, `WithDefaultValue()`) |
| `SheshaModule` | Base for ABP modules |

### Key attributes

| Attribute | Target | Purpose |
|-----------|--------|---------|
| `[ClassUid("…guid…")]` | Gateway class | Unique ID for runtime gateway selection |
| `[Display(Name = "…")]` | Gateway class | Label shown in admin UI |
| `[Category("…")]` | Settings interface | Groups settings in admin |
| `[Setting(name)]` | Accessor property | Maps to a Shesha setting by name |
| `[DependsOn(…)]` | Module class | ABP module dependency declaration |

### SendStatus (Shesha.Notifications.Dto)

| Member | Usage |
|--------|-------|
| `SendStatus.Success()` | SMS sent successfully |
| `SendStatus.Failed(string message)` | SMS failed; include reason |
| `result.IsSuccess` | `bool` — true if success |
| `result.Message` | `string` — failure reason or null on success |

### How gateway selection works

1. Admin sets `SmsSettings.SmsGateway` to the gateway's `ClassUid` GUID string.
2. At resolve time, `SheshaApplicationModule` uses `ITypeFinder` to find the `ISmsGateway` type whose `[ClassUid]` matches that string.
3. It resolves that type from IoC — so the gateway **must** be registered as its concrete type.

Now generate the requested SMS gateway artifact(s) based on: $ARGUMENTS
