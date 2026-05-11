# SMS Gateway Artifacts

## §1. Project File

**File:** `{Publisher}.Sms.{GatewayName}.csproj` at the project root

Standalone class library project for the gateway. Uses `$(SheshaVersion)` from `Directory.Build.props`.

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <RootNamespace>{Publisher}.Sms.{GatewayName}</RootNamespace>
    <GenerateAssemblyConfigurationAttribute>false</GenerateAssemblyConfigurationAttribute>
    <GenerateAssemblyCompanyAttribute>false</GenerateAssemblyCompanyAttribute>
    <GenerateAssemblyProductAttribute>false</GenerateAssemblyProductAttribute>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Abp" Version="9.0.0" />
    <PackageReference Include="AsyncFixer" Version="1.6.0">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="IDisposableAnalyzers" Version="4.0.8">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.VisualStudio.Threading.Analyzers" Version="17.13.2">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Shesha.Application" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.Framework" Version="$(SheshaVersion)" />
  </ItemGroup>

</Project>
```

**Key rules:**
- `RootNamespace` must match the project's top-level namespace.
- Analyzers are always included as `PrivateAssets` (dev-only).
- `$(SheshaVersion)` is resolved from `Directory.Build.props` — do not hardcode Shesha versions.

---

## §2. Settings DTO

**File:** `{GatewayName}SettingDto.cs` at the project root

The API-facing shape returned and accepted by the typed settings methods.

```csharp
namespace {Publisher}.Sms.{GatewayName}
{
    /// <summary>
    /// {GatewayName} settings DTO
    /// </summary>
    public class {GatewayName}SettingDto
    {
        public string ApiUrl { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }

        // Mirror fields from I{GatewayName}Settings
    }
}
```

**Key rules:**
- Plain POCO — no base class, no `virtual`.
- Properties should mirror those on `I{GatewayName}Settings`.
- Can omit or rename sensitive fields for security (e.g., blank out passwords on read).

---

## §3. Setting Name Constants

**File:** `{GatewayName}SettingNames.cs` at the project root

String constants used in `[Setting(…)]` attributes to avoid magic strings.

```csharp
namespace {Publisher}.Sms.{GatewayName}
{
    /// <summary>
    /// Names of the {GatewayName} gateway settings
    /// </summary>
    public static class {GatewayName}SettingNames
    {
        public const string ApiUrl = "{Publisher}.{GatewayName}.ApiUrl";
        public const string Username = "{Publisher}.{GatewayName}.Username";
        public const string Password = "{Publisher}.{GatewayName}.Password";

        // Add provider-specific setting name constants here
    }
}
```

**Key rules:**
- `static` class with `const string` fields.
- Convention: `"{Publisher}.{GatewayName}.{FieldName}"` — namespaced to avoid collisions across gateways.

---

## §4. Settings Accessor Interface

**File:** `I{GatewayName}Settings.cs` at the project root

Defines one `ISettingAccessor<string>` property per setting. Each property is individually injectable and mockable.

```csharp
using Shesha.Settings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace {Publisher}.Sms.{GatewayName}
{
    /// <summary>
    /// {GatewayName} SMS gateway settings accessor
    /// </summary>
    [Category("{GatewayName}")]
    public interface I{GatewayName}Settings : ISettingAccessors
    {
        [Display(Name = "API URL")]
        [Setting({GatewayName}SettingNames.ApiUrl)]
        ISettingAccessor<string> ApiUrl { get; }

        [Display(Name = "Username")]
        [Setting({GatewayName}SettingNames.Username)]
        ISettingAccessor<string> Username { get; }

        [Display(Name = "Password")]
        [Setting({GatewayName}SettingNames.Password)]
        ISettingAccessor<string> Password { get; }

        // Add provider-specific settings here
    }
}
```

**Key rules:**
- Must extend `ISettingAccessors`.
- Use **individual `ISettingAccessor<string>` properties** per setting — do NOT use a compound `ISettingAccessor<{GatewayName}Settings>` property.
- `[Category]` groups settings under the gateway name in the Shesha admin UI.
- Each property references one `{GatewayName}SettingNames` constant.
- In tests, each property is mocked independently via `Mock<ISettingAccessor<string>>`.

---

## §5. Gateway Marker Interface

**File:** `I{GatewayName}SmsGateway.cs` at the project root

Empty marker used for typed DI resolution.

```csharp
using Shesha.Sms;

namespace {Publisher}.Sms.{GatewayName}
{
    /// <summary>
    /// Marker interface for {GatewayName} SMS gateway
    /// </summary>
    public interface I{GatewayName}SmsGateway : IConfigurableSmsGateway<{GatewayName}SettingDto>
    {
    }
}
```

**Key rules:**
- Extends `IConfigurableSmsGateway<TDto>` so the typed interface can be injected.
- Used in Castle Windsor registration: `Component.For<I{GatewayName}SmsGateway>().Forward<{GatewayName}SmsGateway>()`.

---

## §6. Gateway Implementation

**File:** `{GatewayName}SmsGateway.cs` at the project root

The actual SMS sending logic. Selected at runtime via `[ClassUid]`.

```csharp
using Castle.Core.Logging;
using Shesha.Attributes;
using Shesha.Notifications.Dto;
using Shesha.Sms;
using System;
using System.ComponentModel.DataAnnotations;
using System.Net.Http;
using System.Threading.Tasks;

namespace {Publisher}.Sms.{GatewayName}
{
    [ClassUid("{NewGuid}")]                    // ← replace with a freshly generated GUID
    [Display(Name = "{GatewayName} SMS Gateway")]  // ← label shown in the Shesha admin UI
    public class {GatewayName}SmsGateway : ConfigurableSmsGateway<{GatewayName}SettingDto>, I{GatewayName}SmsGateway
    {
        public ILogger Logger { get; set; }
        private readonly I{GatewayName}Settings _settings;
        private readonly IHttpClientFactory _httpClientFactory;

        public {GatewayName}SmsGateway(I{GatewayName}Settings settings, IHttpClientFactory httpClientFactory)
        {
            Logger = NullLogger.Instance;
            _settings = settings;
            _httpClientFactory = httpClientFactory;
        }

        public override async Task<SendStatus> SendSmsAsync(string mobileNumber, string body)
        {
            var apiUrl = await _settings.ApiUrl.GetValueAsync();
            var username = await _settings.Username.GetValueAsync();
            var password = await _settings.Password.GetValueAsync();

            if (string.IsNullOrWhiteSpace(apiUrl))
                return SendStatus.Failed("{GatewayName} SMS gateway is not configured: ApiUrl is missing.");

            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return SendStatus.Failed("{GatewayName} SMS gateway is not configured: Username or Password is missing.");

            try
            {
                using var httpClient = _httpClientFactory.CreateClient();
                // TODO: implement provider-specific HTTP call
                // Return SendStatus.Success() on success or SendStatus.Failed(message) on failure.
                throw new NotImplementedException("Implement SMS sending logic here.");
            }
            catch (Exception ex)
            {
                Logger.ErrorFormat($"{GatewayName} SMS send failed: {ex.Message}");
                return SendStatus.Failed($"{GatewayName} SMS send failed: {ex.Message}");
            }
        }

        public override async Task<{GatewayName}SettingDto> GetTypedSettingsAsync()
        {
            return new {GatewayName}SettingDto
            {
                ApiUrl = await _settings.ApiUrl.GetValueAsync(),
                Username = await _settings.Username.GetValueAsync(),
                Password = await _settings.Password.GetValueAsync(),
            };
        }

        public override async Task SetTypedSettingsAsync({GatewayName}SettingDto dto)
        {
            await _settings.ApiUrl.SetValueAsync(dto.ApiUrl);
            await _settings.Username.SetValueAsync(dto.Username);
            await _settings.Password.SetValueAsync(dto.Password);
        }
    }
}
```

**Key rules:**
- `[ClassUid]` **must** be a unique GUID — generate a fresh one; never reuse an existing UID.
- `[Display(Name)]` controls the label shown in Shesha's SMS gateway selector UI.
- Constructor-inject `I{GatewayName}Settings` **and** `IHttpClientFactory` — never use `new HttpClient()`.
- Read settings directly: `await _settings.ApiUrl.GetValueAsync()` (not via a compound accessor).
- Guard missing config early and return `SendStatus.Failed(...)` — do not throw.
- `SendStatus.Success()` / `SendStatus.Failed(message)` are the only valid return values.
- Do NOT log raw request/response bodies — they may contain PII (phone numbers, message text).
- Use `ILogger Logger { get; set; }` (Castle property injection pattern) for logging.

---

## §7. ABP Module

**File:** `Shesha{GatewayName}Module.cs` at the project root

Wires up IoC registration and setting defaults.

```csharp
using Abp.AspNetCore;
using Abp.Modules;
using Castle.MicroKernel.Registration;
using Shesha;
using Shesha.Modules;
using Shesha.Settings.Ioc;
using System.Reflection;
using System.Threading.Tasks;

namespace {Publisher}.Sms.{GatewayName}
{
    [DependsOn(typeof(SheshaFrameworkModule), typeof(SheshaApplicationModule), typeof(AbpAspNetCoreModule))]
    public class Shesha{GatewayName}Module : SheshaModule
    {
        public const string ModuleName = "{Publisher}.{GatewayName}";

        public override SheshaModuleInfo ModuleInfo => new SheshaModuleInfo(ModuleName)
        {
            FriendlyName = "Shesha {GatewayName} SMS Gateway",
            Publisher = "{Publisher}",
        };

        public override async Task<bool> InitializeConfigurationAsync()
        {
            return await ImportConfigurationAsync();
        }

        public override void PreInitialize()
        {
            IocManager.RegisterSettingAccessor<I{GatewayName}Settings>(s =>
            {
                s.ApiUrl.WithDefaultValue("https://api.{gatewayname}.com");
                s.Username.WithDefaultValue(string.Empty);
                s.Password.WithDefaultValue(string.Empty);
            });
        }

        public override void Initialize()
        {
            IocManager.RegisterAssemblyByConvention(Assembly.GetExecutingAssembly());

            IocManager.IocContainer.Register(
                Component.For<I{GatewayName}SmsGateway>()
                         .Forward<{GatewayName}SmsGateway>()
                         .ImplementedBy<{GatewayName}SmsGateway>()
                         .LifestyleTransient()
            );
        }
    }
}
```

**Key rules:**
- `[DependsOn]` must include `SheshaFrameworkModule`, `SheshaApplicationModule`, and `AbpAspNetCoreModule`.
- `RegisterSettingAccessor<I{GatewayName}Settings>` goes in `PreInitialize` — sets individual per-setting defaults.
- `RegisterAssemblyByConvention` goes in `Initialize` — scans for conventional registrations.
- Gateway registration must use `.Forward<{GatewayName}SmsGateway>()` so the concrete type is also resolvable.
- `ModuleName` follows `"{Publisher}.{GatewayName}"` convention (e.g., `"Boxfusion.Vodacom"`).
- Add this module to the host application's `[DependsOn]` list: `typeof(Shesha{GatewayName}Module)`.

---

## §8. Test Project File

**File:** `{Publisher}.Sms.{GatewayName}.Tests.csproj` in `backend/test/{Publisher}.Sms.{GatewayName}.Tests/`

Lightweight xUnit project — no Shesha/ABP infrastructure needed.

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http" Version="8.0.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.8.0" />
    <PackageReference Include="Moq" Version="4.20.70" />
    <PackageReference Include="Shouldly" Version="4.2.1" />
    <PackageReference Include="xunit" Version="2.6.3" />
    <PackageReference Include="xunit.extensibility.execution" Version="2.6.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.5.5">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers</IncludeAssets>
    </PackageReference>
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Module\{Publisher}.Sms.{GatewayName}\{Publisher}.Sms.{GatewayName}.csproj" />
  </ItemGroup>

  <ItemGroup>
    <None Update="testsettings.json">
      <CopyToOutputDirectory>Always</CopyToOutputDirectory>
    </None>
  </ItemGroup>

</Project>
```

**Key rules:**
- No ABP or NHibernate packages — this is a pure HTTP integration test.
- `Microsoft.Extensions.Http` provides `IHttpClientFactory` via `ServiceCollection.AddHttpClient()`.
- `testsettings.json` must be copied to output so it is found at runtime.

---

## §9. Test Settings File

**File:** `testsettings.json` in the test project directory

Contains live credentials for integration tests. **Never commit real credentials.**

```json
{
  "{GatewayName}": {
    "ApiUrl": "https://api.{gatewayname}.com/send",
    "Username": "",
    "Password": "",
    "TestMobileNumber": ""
  }
}
```

**Key rules:**
- Add `**/testsettings.json` to `backend/.gitignore` immediately.
- Live integration tests must skip (return early) when credentials are blank.
- A `testsettings.json.example` with empty values can be committed as a template.

---

## §10. Test Class

**File:** `{GatewayName}SmsGateway_Tests.cs` in the test project directory

```csharp
using System;
using System.Net.Http;
using System.Threading.Tasks;
using {Publisher}.Sms.{GatewayName};
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Shesha.Notifications.Dto;
using Shesha.Settings;
using Shouldly;
using Xunit;

namespace {Publisher}.Sms.{GatewayName}.Tests;

public class {GatewayName}SmsGateway_Tests
{
    private static IConfiguration LoadSettings() =>
        new ConfigurationBuilder()
            .AddJsonFile("testsettings.json", optional: true)
            .Build();

    private static {GatewayName}SmsGateway CreateGateway(string apiUrl, string username, string password)
    {
        var apiUrlAccessor = new Mock<ISettingAccessor<string>>();
        apiUrlAccessor.Setup(x => x.GetValueAsync()).ReturnsAsync(apiUrl);

        var usernameAccessor = new Mock<ISettingAccessor<string>>();
        usernameAccessor.Setup(x => x.GetValueAsync()).ReturnsAsync(username);

        var passwordAccessor = new Mock<ISettingAccessor<string>>();
        passwordAccessor.Setup(x => x.GetValueAsync()).ReturnsAsync(password);

        var settings = new Mock<I{GatewayName}Settings>();
        settings.Setup(x => x.ApiUrl).Returns(apiUrlAccessor.Object);
        settings.Setup(x => x.Username).Returns(usernameAccessor.Object);
        settings.Setup(x => x.Password).Returns(passwordAccessor.Object);

        var services = new ServiceCollection();
        services.AddHttpClient();
        var httpClientFactory = services.BuildServiceProvider()
            .GetRequiredService<IHttpClientFactory>();

        return new {GatewayName}SmsGateway(settings.Object, httpClientFactory);
    }

    [Fact]
    public async Task SendSms_MissingApiUrl_ReturnsFailed()
    {
        var gateway = CreateGateway(string.Empty, "user", "pass");

        var result = await gateway.SendSmsAsync("+27820000000", "Test message");

        result.IsSuccess.ShouldBeFalse();
        result.Message.ShouldContain("ApiUrl is missing");
    }

    [Fact]
    public async Task SendSms_MissingCredentials_ReturnsFailed()
    {
        var gateway = CreateGateway("https://api.{gatewayname}.com/send", string.Empty, string.Empty);

        var result = await gateway.SendSmsAsync("+27820000000", "Test message");

        result.IsSuccess.ShouldBeFalse();
        result.Message.ShouldContain("Username or Password is missing");
    }

    /// <summary>
    /// Live integration test — requires credentials in testsettings.json.
    /// Skipped automatically when Username, Password, or TestMobileNumber are blank.
    /// </summary>
    [Fact]
    public async Task SendSms_WithValidSettings_EnqueuesSmsSuccessfully()
    {
        var config = LoadSettings();
        var apiUrl = config["{GatewayName}:ApiUrl"];
        var username = config["{GatewayName}:Username"];
        var password = config["{GatewayName}:Password"];
        var mobileNumber = config["{GatewayName}:TestMobileNumber"];

        if (string.IsNullOrWhiteSpace(username)
            || string.IsNullOrWhiteSpace(password)
            || string.IsNullOrWhiteSpace(mobileNumber))
            return; // credentials not configured — skip live test

        var gateway = CreateGateway(apiUrl!, username!, password!);

        var result = await gateway.SendSmsAsync(
            mobileNumber,
            $"Integration test from xUnit. {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");

        result.IsSuccess.ShouldBeTrue(result.Message);
    }

    /// <summary>
    /// Live integration test — sends to an invalid number using real credentials.
    /// Expects the gateway to report a provider-specific error.
    /// Skipped automatically when credentials are blank.
    /// </summary>
    [Fact]
    public async Task SendSms_InvalidNumber_ReturnsFailed()
    {
        var config = LoadSettings();
        var apiUrl = config["{GatewayName}:ApiUrl"];
        var username = config["{GatewayName}:Username"];
        var password = config["{GatewayName}:Password"];

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return; // credentials not configured — skip live test

        var gateway = CreateGateway(apiUrl!, username!, password!);

        var result = await gateway.SendSmsAsync("5555555", "Integration test — invalid number.");

        result.IsSuccess.ShouldBeFalse();
        // Assert provider-specific error code or message here
    }
}
```

**Key rules:**
- Mock each `ISettingAccessor<string>` property individually — do not mock the accessor interface as a single unit.
- Use `ServiceCollection.AddHttpClient()` + `BuildServiceProvider()` to get a real `IHttpClientFactory`.
- Live tests must skip when credentials are absent (return early, do not `Skip.If`).
- Include a UTC timestamp in the live test message to confirm uniqueness.
- For the invalid-number test, assert the provider-specific error code in `result.Message`.
- `result.IsSuccess` is `bool`; `result.Message` is `string` — both from `Shesha.Notifications.Dto.SendStatus`.
