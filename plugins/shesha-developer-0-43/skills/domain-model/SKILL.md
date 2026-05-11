---
name: domain-model
description: Creates and modifies domain entities, reference lists, and database migrations in Shesha framework .NET applications. IMPORTANT — This skill MUST be invoked BEFORE any manual exploration or planning when the task involves creating, modifying, or implementing domain entities, entity properties, relationships, reference lists, or database migrations. Use when the user asks to create, scaffold, implement, or update the domain layer, domain model, entities, reference lists, or migrations in a Shesha project. Also use when the user asks to create, add, update, or modify a database migration, FluentMigrator migration, schema change, or table alteration — even without mentioning entities. Also use when implementing features from a PRD, specification, or API design that require new or modified entities or database schema changes.
---

# Shesha Domain Model Manager

## When to Use This Skill

- Creating new entities and domain models in a Shesha application
- **Updating existing entities** (adding, removing, or modifying properties)
- Implementing or modifying entity relationships and aggregates
- Adding **generic entity references** (`GenericEntityReference`) for polymorphic associations
- Creating database migrations for new or modified entities
- **Creating or updating standalone database migrations** (FluentMigrator migrations, schema changes, table alterations, column additions/removals) — even when no entity change is involved
- **Creating view-backed (flattened) entities** mapped to database views for read-only querying across joined tables
- Implementing or updating reference lists (code-based and data-based)
- Renaming or refactoring domain model properties

## Key Rules

**Framework-First**: Always leverage Shesha's built-in capabilities before implementing custom solutions. Use existing entities (`Person`, `Organisation`, `Account`, `Address`, `StoredFile`, `OtpAuditItem`, etc.) and the framework's metadata-driven approach. Check manifests before creating new entities.

**Use Framework File Management**: The Shesha framework provides built-in file management via `StoredFile`, `StoredFileVersion`, `IStoredFileService`, and `StoredFileController`. Do NOT create custom file entities, upload/download endpoints, or file storage logic. See [reference/DomainModelling.md](reference/DomainModelling.md) § File and Document Management for patterns and details.

**MANDATORY: Database Migrations for Every Domain Change**
Whenever making changes to domain model entity classes — whether creating new entities, adding/removing/renaming properties, changing relationships, or updating reference lists — you MUST ALWAYS create the corresponding database migration classes. No domain model change is complete without its migration.

**MANDATORY: Accurate Migration Timestamps**
Migration IDs use the format `YYYYMMDDHHmmss` and MUST reflect the **actual current UTC time**. Before creating any migration, run `date -u +"%Y%m%d%H%M%S"` (or `scripts/migration-timestamp.sh`) to get the correct timestamp. Do NOT use placeholder or rounded values — the hour, minute, and second components must be accurate. For multiple migrations in one session, increment the seconds by 1.

**MANDATORY: Offer API-based Reference List Creation for Data-Driven Reference Lists**
When a domain model change introduces a new data-driven reference list property, you MUST ask the user whether they want the reference list created via the **API** (recommended when the backend server is running) or via a **database migration**. If the user chooses the API approach, follow the [reference/ReferenceLists.md](reference/ReferenceLists.md) § Creating Data-Based Reference Lists via API section. Do NOT create migration-based reference list seeding unless the user explicitly requests it.

**MANDATORY: Report Feedback for Every Reference List Operation**
When creating or updating reference lists (via API or migration), you MUST always print clear feedback to the user showing:
- The reference list name and module
- Each item created/updated with its value and display text
- The final status (e.g., "Live") after marking it active
- Any errors encountered

## Reference Documentation

Detailed implementation patterns and examples are in these files — read the relevant ones based on the task:

- [reference/DomainModelling.md](reference/DomainModelling.md) — Entity classes, base classes, attributes, property conventions, generic entity references, file placement
- [reference/DomainService.md](reference/DomainService.md) — Domain service/manager classes
- [reference/ReferenceLists.md](reference/ReferenceLists.md) — Code-based (enum) and data-based reference lists, **including API-based creation**
- [reference/DatabaseMigrations.md](reference/DatabaseMigrations.md) — FluentMigrator migrations, table/column naming, examples

## Module Manifests - Domain Entity Reference

The `reference/manifests/` folder contains JSON manifest files documenting all available Shesha modules, their domain entities, and reference lists. Use these manifests to:
- Discover existing entities to extend or reference
- Find the correct namespaces and base classes
- Identify available reference lists and their enum names
- Understand module dependencies

### Loading and Using Manifests

When creating new entities, first check the relevant manifests to:
1. **Identify reusable entities** - Extend existing entities like `Person`, `Organisation`, `Account`, `OtpAuditItem` instead of creating new ones
2. **Find correct base classes** - Use appropriate base classes from Shesha.Core
3. **Reference existing entities** - Link to existing entities in relationships
4. **Reuse reference lists** - Use existing enums/reference lists where applicable

### Manifest JSON Structure

Each manifest file follows this structure:
```json
{
  "module": {
    "name": "Module.Name",
    "className": "Full.Qualified.ModuleClass",
    "dbPrefix": "Prefix_",
    "publisher": "Publisher",
    "dependencies": ["Dependency1", "Dependency2"]
  },
  "entities": [
    {
      "name": "EntityName",
      "namespace": "Full.Namespace",
      "description": "Entity description",
      "baseEntity": "BaseEntity",
      "isAggregate": true,
      "properties": [
        { "name": "PropertyName", "type": "PropertyType", "description": "Property description" }
      ]
    }
  ],
  "referenceLists": [
    {
      "name": "RefListName",
      "description": "Description",
      "values": ["Value1", "Value2"],
      "isEnum": true,
      "enumFullName": "Full.Qualified.EnumName"
    }
  ]
}
```

### Key Manifests for Entity Creation

| Manifest | Purpose | Key Entities |
|----------|---------|--------------|
| `shesha-core-manifest.json` | Core Shesha entities | Person, Organisation, Account, Address, Site, Notification |
| `shesha-otp-manifest.json` | OTP/2FA verification | OtpAuditItem, RefListOtpSendType, RefListOtpSendStatus |
| `shesha-enterprise-domain-manifest.json` | Enterprise business entities | FinancialAccount, Order, Invoice, Product, Employee, Contract |
| `shesha-crm-domain-manifest.json` | CRM domain entities | Contact, Lead, Opportunity, Campaign, Territory |
| `boxfusion-service-management-manifest.json` | Service/Case management | Case, CaseInteraction, SlaPolicy, Article |

### Using Manifests in Practice

**Example: Creating an entity that references Person**
```csharp
// From shesha-core-manifest.json, Person is in Shesha.Domain namespace
using Shesha.Domain;

public class MyEntity : FullAuditedEntity<Guid>
{
    // Reference the existing Person entity
    public virtual Person AssignedTo { get; set; }
}
```

**Example: Using an existing reference list**
```csharp
// From shesha-core-manifest.json, Gender enum is in Shesha.Domain.Enums
using Shesha.Domain.Enums;

public class MyEntity : FullAuditedEntity<Guid>
{
    public virtual RefListGender Gender { get; set; }
}
```

**Example: Referencing OTP audit trail**
```csharp
// From shesha-otp-manifest.json, OtpAuditItem is in Shesha.Domain namespace
using Shesha.Domain;
using Shesha.Domain.Enums;

public class ConsentApproval : FullAuditedEntity<Guid>
{
    /// <summary>
    /// Link to the OTP verification used for consent approval
    /// </summary>
    public virtual OtpAuditItem OtpVerification { get; set; }

    /// <summary>
    /// Type of channel used for OTP delivery
    /// </summary>
    public virtual RefListOtpSendType VerificationChannel { get; set; }
}
```

## MANDATORY: Test After Every Domain Model Change

After completing any domain model change **and** creating the corresponding database migrations, you **MUST ALWAYS** run the `test-entity-crud-api` skill to verify that the changes work correctly.

## Workflow

Determine the type of change, then follow the appropriate path:

**Creating a new entity?** Follow the New Entity workflow.
**Creating a view-backed (flattened) entity?** Follow the View-Backed Entity workflow.
**Modifying an existing entity?** Follow the Entity Update workflow.

### New Entity Workflow

```
- [ ] Check manifests for reusable entities and reference lists
- [ ] For file/document properties, use StoredFile (direct property or Owner pattern) — do NOT create custom file entities
- [ ] Create entity class with correct base class, attributes, and properties
- [ ] Create enum-based reference lists if needed (no migration required for these)
- [ ] For data-based reference lists: ask user whether to create via API or migration
      - API (recommended if server is running): see reference/ReferenceLists.md § API section
      - Migration: create FluentMigrator migration with ReferenceListCreate
- [ ] Create database migration for new table(s) and columns
- [ ] Run `/test-entity-crud-api` to verify all CRUD endpoints work
```

### View-Backed Entity Workflow

Use this when creating a read-only entity that flattens data from multiple tables via a database view.

```
- [ ] Read the source entities to understand all properties and their types
- [ ] Check the actual database table columns (via migrations) — do NOT assume columns like TenantId exist
- [ ] Create entity class with:
      - [Table("ModulePrefix_vw_ViewName")] attribute mapping to the view
      - [Entity] attribute with GenerateApplicationService and FriendlyName
      - [ReadonlyProperty] on ALL properties (view is read-only)
      - Nullable types for all flattened properties from joined tables
- [ ] Create database migration with CREATE OR ALTER VIEW using Execute.Sql
      - Use LEFT JOIN for all joined tables
      - Alias columns correctly: Lkp suffix for reference lists, Id suffix for FKs
      - Do NOT include TenantId unless verified to exist on the source table
      - Include audit columns from the primary table only
- [ ] Run `/test-entity-crud-api` to verify the endpoint works
```

See [reference/DomainModelling.md](reference/DomainModelling.md) § View-Backed (Flattened) Entities and [reference/DatabaseMigrations.md](reference/DatabaseMigrations.md) § Creating Database Views for detailed patterns and examples.

### Entity Update Workflow

```
- [ ] Read existing entity class and identify current migration history
- [ ] Make property/relationship changes to the entity class
- [ ] Create enum-based reference lists if needed (no migration required for these)
- [ ] For data-based reference lists: ask user whether to create via API or migration
      - API (recommended if server is running): see reference/ReferenceLists.md § API section
      - Migration: create FluentMigrator migration with ReferenceListCreate
- [ ] Create database migration to alter existing table (add/rename/modify columns)
- [ ] Run `/test-entity-crud-api` to verify all CRUD endpoints still work
```

If tests fail, use the auto-fix capabilities of the test skill or manually resolve the issues, then re-run until all tests pass. The domain model change is **not considered complete** until tests pass.
