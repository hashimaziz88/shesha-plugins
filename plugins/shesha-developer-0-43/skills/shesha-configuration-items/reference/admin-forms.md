# Admin Forms

Configuration items need admin forms so users can manage them through the Shesha UI. Typically you create:

1. **Table/list form** — displays all instances of the configuration item
2. **Create form** — allows creating new instances
3. **Details/edit form** — allows viewing and updating existing instances

## Creating Forms via Shesha MCP

If a Shesha MCP server is available, use it to create the forms automatically.

### Check for Shesha MCP

Before attempting to create forms, check if the Shesha MCP server is available by looking for MCP tools with names containing "shesha" or "form" (e.g., `Shesha:form_create`, `Shesha:create_form`, or similar).

### If Shesha MCP is Available

Use the MCP tools to create three forms for the configuration item:

**1. Table/List Form**
- Entity type: `{FullyQualifiedEntityName}` (e.g., `YourModule.Domain.ApprovalConfigs.ApprovalConfig`)
- Form type: Table/Index
- Include columns for: `Name`, `Label`, `Module`, `VersionStatus`, and key custom properties
- Filter by `IsLast == true` to show only the latest version of each item
- Add create and edit actions

**2. Create Form**
- Entity type: same as above
- Form type: Create
- Include fields for: `Name`, `Label`, `Description`, `Module`, and all custom properties
- Mark `Name` and `Module` as required

**3. Details/Edit Form**
- Entity type: same as above
- Form type: Details/Edit
- Include all fields from the create form plus `VersionStatus`
- Show audit information (CreatedBy, CreationTime)

### If Shesha MCP is NOT Available

Notify the user:

> "Admin forms for `{ConfigName}` need to be created manually through the Shesha Form Designer. The forms should be configured with entity type `{FullyQualifiedEntityName}` and should include these forms:
> 1. A **table view** (filter by `IsLast == true`) with columns: Name, Label, Module, VersionStatus, {key custom properties}
> 2. A **create form** with fields: Name, Label, Description, Module, {all custom properties}
> 3. A **details/edit form** with all create fields plus VersionStatus and audit info
>
> I was unable to create these automatically because the Shesha MCP server is not connected. To create them, open the Shesha Form Designer in your browser and configure the forms manually."

## Important Fields for Configuration Items

| Field | Source | Notes |
|-------|--------|-------|
| `Name` | `ConfigurationItemBase` | Unique within module. Used for import/export matching. |
| `Label` | `ConfigurationItemBase` | User-friendly display name. |
| `Module` | `ConfigurationItemBase` | Dropdown of available modules. |
| `Description` | `ConfigurationItemBase` | Multiline text area. |
| `VersionStatus` | `ConfigurationItemBase` | Read-only on edit forms (managed via status transitions). |
| `IsLast` | `ConfigurationItemBase` | Use as table filter, not as a visible field. |

## Form Naming Convention

Use a consistent naming pattern for forms:

- Table: `{config-item-type-name}-table` (e.g., `approval-config-table`)
- Create: `{config-item-type-name}-create` (e.g., `approval-config-create`)
- Details: `{config-item-type-name}-details` (e.g., `approval-config-details`)
