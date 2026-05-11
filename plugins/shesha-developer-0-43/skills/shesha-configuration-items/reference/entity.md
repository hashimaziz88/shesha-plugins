# Configuration Item Entity

## Template

```csharp
using Shesha.Domain;
using Shesha.Domain.Attributes;
using Shesha.JsonEntities;
using System.ComponentModel.DataAnnotations;

namespace {Namespace}.Domain.{ConfigName}s
{
    /// <summary>
    /// {Description}
    /// </summary>
    [DiscriminatorValue(ItemTypeName)]
    [JoinedProperty("{Prefix}_{ConfigName}s")]
    public class {ConfigName} : ConfigurationItemBase
    {
        public const string ItemTypeName = "{item-type-name}";
        public override string ItemType => ItemTypeName;

        public {ConfigName}()
        {
            VersionStatus = ConfigurationItemVersionStatus.Live;    // Default to live version or else won't be available for export.
        }


        // --- Custom properties ---

        // Boolean property
        public virtual bool {BoolProp} { get; set; }

        // Nullable int property
        public virtual int? {IntProp} { get; set; }

        // Bounded string (specify max length)
        [StringLength(2000)]
        public virtual string {StringProp} { get; set; }

        // Large text field
        [StringLength(int.MaxValue)]
        public virtual string {LargeTextProp} { get; set; }

        // Reference list (single value)
        [ReferenceList("{RefListName}")]
        public virtual RefList{RefListName}? {RefListProp} { get; set; }

        // Reference list (multi-value / flags)
        [MultiValueReferenceList("{RefListName}")]
        public virtual RefList{RefListName}? {MultiRefListProp} { get; set; }

        // FK to another entity
        public virtual {RelatedEntity} {RelatedProp} { get; set; }

        // FK to another config item (self-referencing supported)
        public virtual {ConfigName} {SelfRefProp} { get; set; }

        // Flexible extension data (JSON column)
        [StringLength(int.MaxValue)]
        public virtual JsonEntity ExtensionJson { get; set; }
    }
}
```

## Required Elements

1. **`[DiscriminatorValue(ItemTypeName)]`** — marks the TPH discriminator value
2. **`[JoinedProperty("{Prefix}_{ConfigName}s")]`** — names the joined table
3. **`const string ItemTypeName`** — kebab-case, e.g. `"approval-config"`
4. **`override string ItemType => ItemTypeName`** — returns the discriminator

## ItemTypeName Convention

Use kebab-case. The value is stored in the `ItemType` column in `Frwk_ConfigurationItems` and used as the folder name in exported `.shaconfig` packages.

Examples from real projects:
- `"leave-type-configs"`
- `"leave-calendar-configs"`
- `"notification-channel"`
- `"notification-type"`
- `"performancemanagementprocess-config"`

## Property Patterns

### Reference List Enums

Co-locate reference list enums in the same folder as the entity:

```csharp
using Shesha.Domain.Attributes;

namespace {Namespace}.Domain.{ConfigName}s
{
    [ReferenceList("{RefListName}")]
    public enum RefList{RefListName} : long
    {
        Option1 = 1,
        Option2 = 2,
        Option3 = 3
    }
}
```

For flags-based (multi-value) enums, use powers of 2:

```csharp
[Flags]
[ReferenceList("{RefListName}")]
public enum RefList{RefListName} : long
{
    Monday = 1,
    Tuesday = 2,
    Wednesday = 4,
    Thursday = 8,
    Friday = 16,
    Saturday = 32,
    Sunday = 64
}
```

### Child Collections (one-to-many)

```csharp
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;

// On the parent config item:
[InverseProperty("PartOfId")]
public virtual IList<ChildEntity> Children { get; set; }
```

### JsonEntity for Extensibility

Add this when the config item may need flexible additional properties without schema changes:

```csharp
[StringLength(int.MaxValue)]
public virtual JsonEntity ExtensionJson { get; set; }
```

## Real-World Examples

### LeaveCalendarConfig (simple)

```csharp
[DiscriminatorValue(ItemTypeName)]
[JoinedProperty("Leave_LeaveCalendarConfigs")]
public class LeaveCalendarConfig : ConfigurationItemBase
{
    public const string ItemTypeName = "leave-calendar-configs";
    public override string ItemType => ItemTypeName;

    public virtual TimeSpan? WorkdayStart { get; set; }
    public virtual TimeSpan? WorkDayEnd { get; set; }
    public virtual TimeSpan? LunchStart { get; set; }
    public virtual TimeSpan? LunchEnd { get; set; }

    [MultiValueReferenceList("ApplicableDays")]
    public virtual RefListApplicableDays? ApplicableDays { get; set; }
}
```

### PerformanceManagementProcessConfig (complex, with child collections and FK references)

```csharp
[DiscriminatorValue(ItemTypeName)]
[JoinedProperty("Pmds_PerformanceManagementProcessConfigs")]
public class PerformanceManagementProcessConfig : ConfigurationItemBase
{
    public const string ItemTypeName = "performancemanagementprocess-config";
    public override string ItemType => ItemTypeName;

    public virtual WorkflowDefinition AgreementWorkflowDefinition { get; set; }

    [InverseProperty("PartOfId")]
    public virtual IList<StandardKeyResultArea> KeyResultAreas { get; set; }

    [StringLength(200)]
    public virtual string BehaviorTypeName { get; set; }

    public virtual JsonEntity ExtensionJson { get; set; }
    public virtual bool AutoInstantiate { get; set; }
    public virtual int? AutoInstantiateMonth { get; set; }

    [Display(Name = "PDF Template")]
    public virtual FileTemplateConfiguration Template { get; set; }

    [ReferenceList("Level")]
    public virtual long? Level { get; set; }

    [MultiValueReferenceList("JobLevel")]
    public virtual RefListJobLevel? JobLevels { get; set; }
}
```
