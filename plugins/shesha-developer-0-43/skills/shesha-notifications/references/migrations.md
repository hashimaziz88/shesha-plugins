# Notification Migrations

## Contents
- Creating notification types and templates via FluentMigrator
- Adding templates to existing types
- Updating and deleting templates
- Migration naming conventions

## Creating Notification Types with Templates

Use `this.Shesha().NotificationCreate(moduleName, notificationName)` to create a notification type and chain template methods.

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
            // Create a notification type with an email template
            this.Shesha().NotificationCreate("{ModuleName}", "{NotificationName}")
                .SetDescription("{Description of when this notification is sent}")
                .AddEmailTemplate(
                    "{GUID}".ToGuid(),
                    "{TemplateName}",
                    "{SubjectTemplate with {{Placeholders}}}",
                    @"{BodyTemplate with {{Placeholders}}}");
        }

        public override void Down()
        {
            throw new NotImplementedException();
        }
    }
}
```

### Template Methods

**Email** — creates template with `RichText` (HTML) message format:
```csharp
.AddEmailTemplate(
    "GUID-STRING".ToGuid(),     // Unique template ID
    "Template Name",             // Display name
    "Subject: {{Placeholder}}", // Title template (Mustache syntax)
    @"<p>Body with {{Placeholder}}</p>")  // Body template (HTML)
```

**SMS** — creates template with `PlainText` message format (no subject):
```csharp
.AddSmsTemplate(
    "GUID-STRING".ToGuid(),
    "Template Name",
    "Plain text body with {{Placeholder}}")
```

**Push** — creates template with `PlainText` message format:
```csharp
.AddPushTemplate(
    "GUID-STRING".ToGuid(),
    "Template Name",
    "Push subject",
    "Push body with {{Placeholder}}")
```

### Multi-Channel Example

A single notification type can have templates for multiple channels:

```csharp
this.Shesha().NotificationCreate("MyModule", "OrderConfirmed")
    .SetDescription("Sent when an order is confirmed.")
    .AddEmailTemplate(
        "A1B2C3D4-0000-0000-0000-000000000001".ToGuid(),
        "Order Confirmed Email",
        "Your order {{OrderNumber}} is confirmed",
        @"<p>Dear {{FullName}},</p>
          <p>Your order <strong>{{OrderNumber}}</strong> placed on {{OrderDate}} has been confirmed.</p>")
    .AddSmsTemplate(
        "A1B2C3D4-0000-0000-0000-000000000002".ToGuid(),
        "Order Confirmed SMS",
        "Hi {{FullName}}, order {{OrderNumber}} confirmed.");
```

## Adding Templates to Existing Types

Use `NotificationUpdate` to add templates to an already-created notification type:

```csharp
this.Shesha().NotificationUpdate("{ModuleName}", "{NotificationName}")
    .AddSmsTemplate(
        "NEW-GUID".ToGuid(),
        "SMS Template Name",
        "SMS body with {{Placeholder}}");
```

## Updating Templates

```csharp
this.Shesha().NotificationTemplateUpdate("EXISTING-TEMPLATE-GUID".ToGuid())
    .SetName("Updated Name")
    .SetSubject("Updated subject")
    .SetBody("Updated body with {{NewPlaceholder}}")
    .SetBodyFormat(Domain.Enums.RefListNotificationTemplateType.PlainText)
    .SetSendType(Domain.Enums.RefListNotificationType.Email);
```

Available update methods: `SetName`, `SetSubject`, `SetBody`, `SetBodyFormat`, `SetSendType`, `Enable`, `Disable`.

## Deleting Templates

```csharp
this.Shesha().NotificationTemplateDelete("TEMPLATE-GUID".ToGuid());
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Migration class | `M{YYYYMMDDHHmmss}` | `M20250226120000` |
| Migration attribute | `[Migration({YYYYMMDDHHmmss})]` | `[Migration(20250226120000)]` |
| Module name | Match your Shesha module name | `"MyApp"`, `"Leave"`, `"Hcm"` |
| Notification name | PascalCase descriptive name | `"OrderConfirmed"`, `"LeaveDecisionNotification"` |
| Template GUIDs | Generate unique GUIDs per template | Use any GUID generator |
| File location | `{Module}.Domain/Migrations/` | — |

## Key Rules

- Template **placeholders** (`{{FullName}}`) must match properties on your `NotificationData` subclass (case-insensitive).
- Each template's **message format** must match the channel: Email expects `RichText`, SMS expects `PlainText`.
- The **notification name** in the migration must exactly match the name used in `_notificationTypeRepo.FirstOrDefaultAsync(x => x.Name == "...")` in your sender code.
- Generate a **new GUID** for every template — never reuse template IDs.
