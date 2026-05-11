# Project File (.csproj) Templates

## Domain Project Template

Replace placeholders:
- `{Organization}` - The organization/company name (e.g., `Org`, `Boxfusion`)
- `{ModuleName}` - The module name in PascalCase (e.g., `DEP`, `ServiceManagement`)

### File: `{Organization}.{ModuleName}.Domain.csproj`

Example: `Org.DEP.Domain.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <GenerateAssemblyConfigurationAttribute>false</GenerateAssemblyConfigurationAttribute>
    <GenerateAssemblyCompanyAttribute>false</GenerateAssemblyCompanyAttribute>
    <GenerateAssemblyProductAttribute>false</GenerateAssemblyProductAttribute>
    <!-- Optional: Embed source files within the PDBs -->
    <EmbedAllSources>true</EmbedAllSources>

    <!-- Generate full debug information embedded in the DLLs -->
    <DebugType>embedded</DebugType>
    <DebugSymbols>true</DebugSymbols>

    <!-- Include DLLs and XML documentation files in the NuGet package output -->
    <AllowedOutputExtensionsInPackageBuildOutput>.dll;.xml;.pdb</AllowedOutputExtensionsInPackageBuildOutput>
  </PropertyGroup>

  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Debug|AnyCPU'">
    <DebugType>embedded</DebugType>
  </PropertyGroup>

  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Release|AnyCPU'">
    <DebugType>full</DebugType>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Abp" Version="9.0.0" />
    <PackageReference Include="FluentMigrator" Version="5.0.0" />
    <PackageReference Include="Intent.RoslynWeaver.Attributes" Version="2.1.3" />
    <PackageReference Include="Shesha.Application" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.Core" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.Framework" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.NHibernate" Version="$(SheshaVersion)" />
  </ItemGroup>

  <ItemGroup>
    <Folder Include="Domain\" />
    <Folder Include="Migrations\" />
  </ItemGroup>

</Project>
```

## Application Project Template

### File: `{Organization}.{ModuleName}.Application.csproj`

Example: `Org.DEP.Application.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <RootNamespace>{Organization}.{ModuleName}</RootNamespace>
    <Nullable>enable</Nullable>
    <!-- Optional: Embed source files within the PDBs -->
    <EmbedAllSources>true</EmbedAllSources>

    <!-- Generate full debug information embedded in the DLLs -->
    <DebugType>embedded</DebugType>
    <DebugSymbols>true</DebugSymbols>

    <!-- Include DLLs and XML documentation files in the NuGet package output -->
    <AllowedOutputExtensionsInPackageBuildOutput>.dll;.xml;.pdb</AllowedOutputExtensionsInPackageBuildOutput>
  </PropertyGroup>

  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Debug|AnyCPU'">
    <DebugType>embedded</DebugType>
  </PropertyGroup>

  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Release|AnyCPU'">
    <DebugType>full</DebugType>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Abp" Version="9.0.0" />
    <PackageReference Include="Intent.RoslynWeaver.Attributes" Version="2.1.3" />
    <PackageReference Include="Shesha.Application" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.Core" Version="$(SheshaVersion)" />
    <PackageReference Include="Shesha.Framework" Version="$(SheshaVersion)" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\{Organization}.{ModuleName}.Domain\{Organization}.{ModuleName}.Domain.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Folder Include="Services\" />
  </ItemGroup>

</Project>
```

## Key Differences

| Aspect | Domain Project | Application Project |
|--------|---------------|---------------------|
| RootNamespace | Not specified (uses folder name) | Explicitly set |
| FluentMigrator | Included | Not included |
| Shesha.NHibernate | Included | Not included |
| Project References | None | References Domain project |
| Default Folders | Domain/, Migrations/ | Services/ |

## Package Version Notes

- `$(SheshaVersion)` is typically defined in `Directory.Build.props` at the solution level
- If not defined, replace with actual version numbers (e.g., `3.0.0`)
- `Abp` version should match the Shesha framework requirements
