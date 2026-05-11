# Notification Data Models

## Contents
- §1 Custom data model class
- §2 Using NotificationData directly (dictionary style)
- §3 Naming conventions

## §1 Custom Data Model Class

Create a class extending `NotificationData` with properties matching your template placeholders.

```csharp
using Abp.Notifications;

namespace {Namespace}.Notifications
{
    /// <summary>
    /// Data model for {Domain} notifications.
    /// Properties map to Mustache placeholders in notification templates.
    /// </summary>
    public class {Domain}NotificationModel : NotificationData
    {
        /// <summary>
        /// Recipient full name
        /// </summary>
        public string FullName { get; set; }

        /// <summary>
        /// Example domain-specific property
        /// </summary>
        public string {DomainProperty} { get; set; }
    }
}
```

**Rules:**
- Property names are **case-insensitive** when matched against template placeholders.
- Property types should be `string` — format dates, numbers, etc. before assigning.
- One model can serve multiple notification types if they share the same placeholders.
- Create separate models only when notification types need substantially different data.

### Real-World Example: Leave Application

```csharp
using Abp.Notifications;

namespace Shesha.Leave.Application.Notifications
{
    public class LeaveApplicationNotificationDto : NotificationData
    {
        public string ApplicationSubject { get; set; }
        public string ApplicantFullName { get; set; }
        public string ApplicantEmail { get; set; }
        public string Result { get; set; }
        public string RequestUrl { get; set; }
        public string Approver { get; set; }
    }
}
```

### Real-World Example: Change of Supervisor

```csharp
using Abp.Notifications;

namespace Shesha.Hcm.Common.Notifications
{
    public class ChangeOfSupervisorNotificationModel : NotificationData
    {
        public string? FullName { get; set; }
        public string? ProposedSupervisor { get; set; }
    }
}
```

## §2 Using NotificationData Directly

For simple notifications with few placeholders, skip the custom class:

```csharp
var data = new NotificationData();
data["FullName"] = person.FullName;
data["OrderNumber"] = order.OrderNumber;
data["OrderDate"] = order.OrderDate.ToString("dd MMM yyyy");
```

This is equivalent to a custom model — the template engine looks up keys the same way.

## §3 Naming Conventions

| Pattern | Example |
|---------|---------|
| Model class | `{Domain}NotificationModel` or `{Domain}NotificationDto` |
| File name | `{Domain}NotificationModel.cs` |
| Location | `{Module}.Application/Services/Notifications/` |
| Namespace | `{Namespace}.Notifications` |
