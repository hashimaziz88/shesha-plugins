---
name: shesha-notifications
description: Implements notifications in Shesha framework .NET applications. Creates notification data models, sender services, custom notification channels, and FluentMigrator migrations for notification types and templates. Also supports API-based creation of notification types and templates against a running backend (no migrations required). Supports Email, SMS, Push, and custom channels with the INotificationSender service. Use when the user asks to create, scaffold, implement, or add notifications, notification senders, notification channels, notification templates, or notification migrations in a Shesha project. Also use when the user asks to create notification types or templates via the API, or when implementing features from a PRD or specification that require sending Email, SMS, Push, or custom channel notifications.
---

# Shesha Notification Implementation

Generate notification artifacts for a Shesha/.NET/ABP/NHibernate application based on $ARGUMENTS.

## Instructions

- Inspect nearby files to determine the correct namespace root and module name.
- Follow existing project conventions for naming and folder layout.
- Generate a new GUID for each notification template ID (use `"GUID-STRING".ToGuid()`).
- All entity properties must be `virtual` (NHibernate requirement).
- Register `INotificationChannelSender` implementations in `Startup.cs` if not already present.
- **Before creating a custom channel**, always check if the required channel already exists (see [Custom Channel Pre-Check](#custom-channel-pre-check)).

## Artifact Catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Notification Data Model | Application | [references/data-models.md](references/data-models.md) §1 |
| 2 | Notification Sender Interface | Application | [references/sender-service.md](references/sender-service.md) §1 |
| 3 | Notification Sender Implementation | Application | [references/sender-service.md](references/sender-service.md) §2 |
| 4 | Database Migration (types + templates) | Domain | [references/migrations.md](references/migrations.md) |
| 5 | Channel Registration | Startup | [references/channel-registration.md](references/channel-registration.md) §1 |
| 6 | Custom Channel Sender | Application | [references/custom-channel.md](references/custom-channel.md) §1 |
| 7 | Custom Channel Config Migration | Domain | [references/custom-channel.md](references/custom-channel.md) §2 |
| 8 | API-Based Type + Template Creation | API | [references/api-workflow.md](references/api-workflow.md) |

## Folder Structure

```
{Module}.Application/
  Notifications/
    I{Domain}NotificationSender.cs
    {Domain}NotificationSender.cs
    {Domain}NotificationModel.cs
    Channels/
      {ChannelName}ChannelSender.cs

{Module}.Domain/
  Migrations/
    M{YYYYMMDDHHmmss}.cs
```

**Naming convention:** Group by business domain, not by notification type. One sender class handles all notifications for a domain area (e.g. `OrderNotificationSender` handles order confirmed, cancelled, shipped). Custom channel senders go in a `Channels/` subfolder.

## Custom Channel Pre-Check

**MANDATORY: Before creating any custom notification channel, perform these checks:**

### Check 1 — Query existing channels via API

Ensure the backend application is running, then call the CRUD GetAll endpoint for `NotificationChannelConfig`. Determine the correct base URL by reading `appsettings.json` for the `ServerRootAddress` setting.

```bash
# Find the backend base URL
grep -r "ServerRootAddress" --include="appsettings*.json" backend/src/

# Query existing channels (adjust URL/port to match the project)
curl -s "http://localhost:21021/api/dynamic/Shesha/NotificationChannelConfig/Crud/GetAll?properties=id name description statusLkp senderTypeName supportedFormatLkp&maxResultCount=100" | python -m json.tool
```

If the backend is not running, inform the user: **"The backend must be running to verify existing channels. Please start it and try again."**

### Check 2 — Check Startup.cs registrations

```bash
grep -rn "INotificationChannelSender" --include="*.cs" backend/src/
```

### Check 3 — Confirm with the user

Present the list of existing channels found and ask:
- **"The following notification channels are already registered: [list]. Do you still want to create a new [ChannelName] channel?"**
- If the requested channel already exists, suggest using the existing one instead.
- Only proceed with custom channel creation after the user confirms.

## Choosing a Workflow

| Scenario | Workflow |
|----------|----------|
| Building notification sender code (services, models) + migration-based templates | **Sending Notifications** (code-first) |
| Creating a new custom channel implementation | **Creating a Custom Channel** |
| Quickly creating notification types/templates via the running backend API (no migrations) | **API-Based Creation** |

## Quick Reference

### INotificationSender — Overloads

The primary service is `INotificationSender` from `Shesha.Notifications`. Two overloads:

**Overload 1 — Person-based (most common):**
```csharp
Task SendNotificationAsync<TData>(
    NotificationTypeConfig type,
    Person? sender,
    Person receiver,
    TData data,
    RefListNotificationPriority priority,
    List<NotificationAttachmentDto>? attachments = null,
    string? cc = null,
    GenericEntityReference? triggeringEntity = null,
    NotificationChannelConfig? channel = null,
    string? category = null
) where TData : NotificationData;
```

**Overload 2 — Participant-based (raw addresses):**
```csharp
Task SendNotificationAsync<TData>(
    NotificationTypeConfig type,
    IMessageSender? sender,
    IMessageReceiver receiver,
    TData data,
    RefListNotificationPriority priority,
    List<NotificationAttachmentDto>? attachments = null,
    string? cc = null,
    GenericEntityReference? triggeringEntity = null,
    NotificationChannelConfig? channel = null,
    string? category = null
) where TData : NotificationData;
```

Use `PersonMessageParticipant` or `RawAddressMessageParticipant` from `Shesha.Notifications.MessageParticipants` with overload 2.

### Key Types and Namespaces

| Type | Namespace | Purpose |
|------|-----------|---------|
| `INotificationSender` | `Shesha.Notifications` | Send notifications |
| `INotificationChannelSender` | `Shesha.Notifications` | Interface for custom channel senders |
| `SendStatus` | `Shesha.Notifications.Dto` | Return type from channel sender (`Success` / `Failed`) |
| `NotificationData` | `Abp.Notifications` | Base class for template data models |
| `NotificationTypeConfig` | `Shesha.Domain` | Notification type entity |
| `NotificationChannelConfig` | `Shesha.Domain` | Channel entity |
| `NotificationMessage` | `Shesha.Domain` | Rendered message passed to channel sender |
| `NotificationAttachmentDto` | `Shesha.Notifications.Dto` | File attachment descriptor |
| `RefListNotificationPriority` | `Shesha.Domain.Enums` | Priority: High (1), Medium (2), Low (3), Deferred (4) |
| `GenericEntityReference` | `Shesha.EntityReferences` | Links notification to triggering entity |
| `PersonMessageParticipant` | `Shesha.Notifications.MessageParticipants` | Wraps a `Person` entity |
| `RawAddressMessageParticipant` | `Shesha.Notifications.MessageParticipants` | Wraps a raw address string |

### Migration Helpers

| Method | Description |
|--------|-------------|
| `this.Shesha().NotificationCreate(module, name)` | Create notification type |
| `.SetDescription(text)` | Set type description |
| `.AddEmailTemplate(guid, name, subject, body)` | Add email template (RichText) |
| `.AddSmsTemplate(guid, name, body)` | Add SMS template (PlainText) |
| `.AddPushTemplate(guid, name, subject, body)` | Add push template (PlainText) |
| `this.Shesha().NotificationUpdate(module, name)` | Update existing type |
| `this.Shesha().NotificationTemplateUpdate(guid)` | Update a template |
| `this.Shesha().NotificationTemplateDelete(guid)` | Delete a template |

### HTML Body Conversion Rules (Email Templates)

When converting markdown or plain text to HTML for email template bodies (both migrations and API):

| Source | HTML |
|--------|------|
| Line breaks | `<br/>` |
| Bold `**text**` | `<strong>text</strong>` |
| Links `[text](url)` | `<a href="url">text</a>` |
| Placeholder links | `<a href="{{placeholder}}">Link Text</a>` |
| Bullet lists | `<ul><li>...</li></ul>` |
| Paragraphs (blank line separated) | `<br/><br/>` |
| Em-dash `–` | Use regular dash `-` (avoids encoding issues) |

### Channel Selection (automatic unless overridden)

When `channel` parameter is `null`, the framework resolves channels in this order:
1. User's `UserNotificationPreference` for this notification type
2. `OverrideChannels` configured on the `NotificationTypeConfig`
3. System default channels per priority level (from Notification Settings)

Pass an explicit `NotificationChannelConfig` to force a specific channel.

### NotificationTypeConfig Key Properties

| Property | Type | Effect |
|----------|------|--------|
| `Disable` | bool | Globally disable this type |
| `CanOptOut` | bool | Users can opt out |
| `IsTimeSensitive` | bool | Send synchronously (bypass queue) |
| `AllowAttachments` | bool | Enable file attachments |
| `OverrideChannels` | List | Force specific channels |

## Workflow — Sending Notifications (using existing channels)

```
- [ ] Step 1: Determine notification requirements (types, channels, template data)
- [ ] Step 2: Create data model class extending NotificationData
- [ ] Step 3: Create sender interface
- [ ] Step 4: Create sender implementation injecting INotificationSender
- [ ] Step 5: Create FluentMigrator migration for notification types and templates
- [ ] Step 6: Verify channel registration in Startup.cs
- [ ] Step 7: Integrate sender into calling service/workflow
```

## Workflow — Creating a Custom Channel

```
- [ ] Step 1: Run custom channel pre-check (API query + Startup.cs grep)
- [ ] Step 2: Present existing channels to user and get confirmation to proceed
- [ ] Step 3: Read references/custom-channel.md for implementation patterns
- [ ] Step 4: Create INotificationChannelSender implementation class
- [ ] Step 5: Register channel sender in Startup.cs
- [ ] Step 6: Create FluentMigrator migration for NotificationChannelConfig record
- [ ] Step 7: Create notification templates matching the new channel's SupportedFormat
- [ ] Step 8: Verify by querying the API again to confirm the channel appears
```

## Workflow — API-Based Creation (no migrations)

Use this when creating notification types and templates directly against a running backend, without writing C# code or migrations.

```
- [ ] Step 1: Resolve backend URL from appsettings.json and verify it is running
- [ ] Step 2: Authenticate via /api/TokenAuth/Authenticate
- [ ] Step 3: Parse notification requirements from $ARGUMENTS (or spec file)
- [ ] Step 4: Resolve module ID via Module/Crud/GetAll
- [ ] Step 5: Check for duplicate NotificationTypeConfig (by name)
- [ ] Step 6: Create NotificationTypeConfig via API
- [ ] Step 7: Create NotificationTemplate(s) via API (one per channel)
- [ ] Step 8: Verify by reading back created records
- [ ] Step 9: Report summary to user
```

**For each step**, read [references/api-workflow.md](references/api-workflow.md).

**For each step** in the other workflows, read the relevant reference file from the artifact catalog above.

### Key Rules

- **One sender per domain area** — e.g. `OrderNotificationSender` covers order confirmed, cancelled, and shipped.
- **Fetch notification type by name** — use `_notificationTypeRepo.FirstOrDefaultAsync(x => x.Name == "TypeName")` to look up types at runtime.
- **Null-check the notification type** — return early or log a warning if the type isn't found (migration may not have run yet).
- **Use `ITransientDependency`** — all notification senders and channel senders should be transient.
- **Template placeholders must match model properties** — `{{CustomerName}}` in the template maps to `public string CustomerName { get; set; }` on the model (case-insensitive).
- **For simple cases, skip the custom model** — use `NotificationData` as a dictionary: `data["Key"] = "value"`.
- **Attachments require opt-in** — set `AllowAttachments = true` on the type and ensure the channel supports them.
- **Time-sensitive messages** — set `IsTimeSensitive = true` for OTPs, security alerts, etc.
- **Always pre-check before creating custom channels** — never create a duplicate channel.

Now generate the requested notification artifact(s) based on: $ARGUMENTS
