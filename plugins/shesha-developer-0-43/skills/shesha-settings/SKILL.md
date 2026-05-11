---
name: shesha-settings
description: Creates and updates application settings in Shesha framework .NET applications. Scaffolds setting accessor interfaces, setting name constants, compound setting classes, module registration with defaults, and editor form references. Supports simple (primitive), compound (custom class), and user-specific settings. Use when the user asks to create, scaffold, implement, add, or update application settings, setting accessors, setting classes, or module settings in a Shesha project. Also use when implementing features from a PRD or specification that require configurable application settings.
---

# Shesha Application Settings

Generate application setting artifacts for a Shesha/.NET/ABP application based on $ARGUMENTS.

## Instructions

- Inspect the target module's Domain and Application projects to determine namespace root and existing settings.
- If a setting accessor interface already exists for the module, **add to it** rather than creating a new one.
- Follow the one-accessor-per-module convention: `I{ModuleName}Settings` in `Configuration/`.
- Prefer **compound settings** over multiple simple settings when values are related.
- Setting names follow the pattern `"{Namespace}.{ModuleName}.{SettingName}"`.
- All entity properties must be `virtual` (NHibernate requirement) — this applies to domain entities, NOT setting classes.
- Compound setting classes are plain POCOs (no `virtual`, no base class).
- When creating compound settings, **attempt to create the editor form via the Shesha MCP** — see [setting-artifacts.md](setting-artifacts.md) §5.

## Artifact catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Setting Name Constants | Domain | [setting-artifacts.md](setting-artifacts.md) §1 |
| 2 | Setting Accessor Interface | Domain | [setting-artifacts.md](setting-artifacts.md) §2 |
| 3 | Compound Setting Class | Domain | [setting-artifacts.md](setting-artifacts.md) §3 |
| 4 | Module Registration | Application | [setting-artifacts.md](setting-artifacts.md) §4 |
| 5 | Compound Setting Editor Form | Front-End | [setting-artifacts.md](setting-artifacts.md) §5 |
| 6 | Reading/Writing in Services | Application | [usage-patterns.md](usage-patterns.md) §1 |
| 7 | Front-End Access | Front-End | [usage-patterns.md](usage-patterns.md) §2 |
| 8 | User-Specific Settings | Domain | [usage-patterns.md](usage-patterns.md) §3 |

## Folder structure

```
{ModuleName}.Domain/
  Configuration/
    {ModuleName}SettingNames.cs          ← setting name constants
    I{ModuleName}Settings.cs             ← accessor interface
    {CompoundSettingName}Settings.cs      ← compound setting class (if any)

{ModuleName}.Application/
  {ModuleName}ApplicationModule.cs       ← register settings in Initialize()
  Services/
    {ServiceName}AppService.cs           ← inject & use settings
```

## Quick reference

### Key types

| Type | Purpose |
|------|---------|
| `ISettingAccessors` | Base interface for setting accessor interfaces |
| `ISettingAccessor<T>` | Property type for each setting (`T` = `int`, `bool`, `string`, or custom class) |
| `[Setting(name)]` | Links property to its unique setting name |
| `[Category("...")]` | Groups settings in the UI (interface or property level) |
| `[Display(Name, Description)]` | Label and tooltip in Settings UI |

### Setting attribute options

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | Unique setting name (falls back to property name) |
| `IsClientSpecific` | `bool` | Different values per front-end client |
| `IsUserSpecific` | `bool` | Separate value per user |
| `EditorFormName` | `string` | Configurable form name for compound setting editors |

### Simple vs compound decision

| Use simple when | Use compound when |
|----------------|-------------------|
| Standalone toggle or number | Two or more related values |
| No relation to other settings | Values logically form a group |
| Default editor is sufficient | Custom editor form needed |

### Front-end alias resolution

| Level | Resolution |
|-------|-----------|
| Module | `Alias` property of `SheshaModuleInfo`, or module name in camelCase |
| Group | `[Alias]` on the interface, or interface name without `I`/`Settings` in camelCase |
| Setting | `[Alias]` on the property, or property name in camelCase |

Access pattern: `application.settings.{module}.{group}.{setting}`

Now generate the requested artifact(s) based on: $ARGUMENTS
