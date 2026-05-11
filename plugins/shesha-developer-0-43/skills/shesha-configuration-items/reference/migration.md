# Database Migration for Configuration Items

## New Table Migration Template

The joined table shares its `Id` with `Frwk_ConfigurationItems`. The FK is mandatory.

```csharp
using FluentMigrator;
using Shesha.FluentMigrator;

namespace {Namespace}.Migrations
{
    [Migration({YYYYMMDDHHmmss})]
    public class M{YYYYMMDDHHmmss} : Migration
    {
        public override void Up()
        {
            Create.Table("{Prefix}_{ConfigName}s")
                .WithIdAsGuid()
                // Boolean column
                .WithColumn("{Prefix}_{PropName}").AsBoolean().WithDefaultValue(false)
                // Nullable int column
                .WithColumn("{Prefix}_{PropName}").AsInt32().Nullable()
                // Required int with default
                .WithColumn("{Prefix}_{PropName}").AsInt32().WithDefaultValue(1)
                // Bounded string
                .WithColumn("{Prefix}_{PropName}").AsString(2000).Nullable()
                // Large text
                .WithColumn("{Prefix}_{PropName}").AsStringMax().Nullable()
                // Decimal
                .WithColumn("{Prefix}_{PropName}").AsDecimal().Nullable()
                // DateTime
                .WithColumn("{Prefix}_{PropName}").AsDateTime().Nullable()
                // Reference list (stored as long)
                .WithColumn("{Prefix}_{PropName}Lkp").AsInt64().Nullable()
                // TimeSpan (stored as ticks)
                .WithColumn("{Prefix}_{PropName}Ticks").AsInt64().Nullable();

            // MANDATORY: FK to base ConfigurationItems table
            Create.ForeignKey("FK_{Prefix}_{ConfigName}s_Frwk_ConfigurationItems_Id")
                .FromTable("{Prefix}_{ConfigName}s")
                .ForeignColumn("Id")
                .ToTable("Frwk_ConfigurationItems")
                .PrimaryColumn("Id");

            // Optional: FK columns to other tables
            // IMPORTANT: FK columns in [JoinedProperty] tables MUST also use the {Prefix}_ prefix
            // NHibernate expects ALL columns in joined tables to be prefixed with the table prefix
            Alter.Table("{Prefix}_{ConfigName}s")
                .AddForeignKeyColumn("{Prefix}_{RelatedEntity}Id", "{RelatedTable}").Nullable();
        }

        public override void Down()
        {
            throw new NotImplementedException();
        }
    }
}
```

## Add Column Migration Template

For adding properties to an existing configuration item:

```csharp
[Migration({YYYYMMDDHHmmss})]
public class M{YYYYMMDDHHmmss} : Migration
{
    public override void Up()
    {
        Alter.Table("{Prefix}_{ConfigName}s")
            .AddColumn("{Prefix}_{NewPropName}").AsBoolean().WithDefaultValue(false);

        // For FK columns - MUST use {Prefix}_ prefix in [JoinedProperty] tables:
        Alter.Table("{Prefix}_{ConfigName}s")
            .AddForeignKeyColumn("{Prefix}_{RelatedEntity}Id", "{RelatedTable}").Nullable();
    }

    public override void Down()
    {
        throw new NotImplementedException();
    }
}
```

## Column Naming Rules

| C# Property Type | Column Pattern | FluentMigrator Type |
|-------------------|---------------|---------------------|
| `bool` | `{Prefix}_{Name}` | `.AsBoolean().WithDefaultValue(false)` |
| `int?` | `{Prefix}_{Name}` | `.AsInt32().Nullable()` |
| `decimal?` | `{Prefix}_{Name}` | `.AsDecimal().Nullable()` |
| `string` (bounded) | `{Prefix}_{Name}` | `.AsString(maxLength).Nullable()` |
| `string` (max) | `{Prefix}_{Name}` | `.AsStringMax().Nullable()` |
| `DateTime?` | `{Prefix}_{Name}` | `.AsDateTime().Nullable()` |
| `TimeSpan?` | `{Prefix}_{Name}Ticks` | `.AsInt64().Nullable()` |
| `RefList*` (enum) | `{Prefix}_{Name}Lkp` | `.AsInt64().Nullable()` |
| `Entity` (FK) | `{Prefix}_{Name}Id` | `.AddForeignKeyColumn("{Prefix}_{Name}Id", "{Table}")` |
| `JsonEntity` | `{Prefix}_{Name}` | `.AsStringMax().Nullable()` |

## Real-World Example

From `LeaveTypeConfig` initial migration:

```csharp
Create.Table("Leave_LeaveTypeConfigs")
    .WithIdAsGuid()
    .WithColumn("Leave_AllowBackDating").AsBoolean().Nullable()
    .WithColumn("Leave_NumBackDatingDays").AsInt32().Nullable()
    .WithColumn("Leave_MaxConsecutiveDaysAllowed").AsInt32().Nullable()
    .WithColumn("Leave_AllowNegativeBalance").AsBoolean().Nullable()
    .WithColumn("Leave_RollOverRemainingCredits").AsBoolean().Nullable()
    .WithColumn("Leave_PolicyInfo").AsString().Nullable()
    .WithColumn("Leave_ProcessorTypeName").AsString(200).Nullable();

Create.ForeignKey("FK_Leave_LeaveTypeConfigs_Frwk_ConfigurationItems_Id")
    .FromTable("Leave_LeaveTypeConfigs")
    .ForeignColumn("Id")
    .ToTable("Frwk_ConfigurationItems")
    .PrimaryColumn("Id");
```

## Migration Timestamp

Use the current UTC timestamp in `YYYYMMDDHHmmss` format. The class name and `[Migration]` attribute value must match: `M{timestamp}` and `[Migration({timestamp})]`.
