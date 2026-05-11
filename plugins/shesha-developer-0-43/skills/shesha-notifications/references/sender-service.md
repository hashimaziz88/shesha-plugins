# Notification Sender Service

## Contents
- §1 Sender interface
- §2 Sender implementation
- §3 Sending to raw addresses
- §4 Sending to multiple recipients
- §5 Including attachments

## §1 Sender Interface

Define an interface for each business domain's notification needs:

```csharp
using System;
using System.Threading.Tasks;

namespace {Namespace}.Notifications
{
    /// <summary>
    /// Sends notifications related to {Domain}.
    /// </summary>
    public interface I{Domain}NotificationSender
    {
        Task Notify{Event1}Async({EntityOrId} {param});
        Task Notify{Event2}Async({EntityOrId} {param});
    }
}
```

**Design rules:**
- One interface per business domain area (orders, leave, appointments, etc.).
- Method names: `Notify{Event}Async` — clearly describe what triggered the notification.
- Parameters: accept the minimum needed to build the notification (typically an entity ID or the entity itself).

### Real-World Example

```csharp
namespace Shesha.Leave.Application.Notifications
{
    public interface ILeaveApplicantNotificationSender : ITransientDependency
    {
        Task NotifyApplicantTheLeaveDecisionAsync(Guid leaveApplicationId);
    }
}
```

## §2 Sender Implementation

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Shesha.Domain;
using Shesha.Domain.Enums;
using Shesha.EntityReferences;
using Shesha.Notifications;
using Shesha.Notifications.Dto;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace {Namespace}.Notifications
{
    public class {Domain}NotificationSender : I{Domain}NotificationSender, ITransientDependency
    {
        private readonly INotificationSender _notificationSender;
        private readonly IRepository<NotificationTypeConfig, Guid> _notificationTypeRepo;
        private readonly IRepository<NotificationChannelConfig, Guid> _channelRepo;
        private readonly IRepository<Person, Guid> _personRepo;
        private readonly IRepository<{Entity}, Guid> _{entityLower}Repo;

        public {Domain}NotificationSender(
            INotificationSender notificationSender,
            IRepository<NotificationTypeConfig, Guid> notificationTypeRepo,
            IRepository<NotificationChannelConfig, Guid> channelRepo,
            IRepository<Person, Guid> personRepo,
            IRepository<{Entity}, Guid> {entityLower}Repo)
        {
            _notificationSender = notificationSender;
            _notificationTypeRepo = notificationTypeRepo;
            _channelRepo = channelRepo;
            _personRepo = personRepo;
            _{entityLower}Repo = {entityLower}Repo;
        }

        public async Task Notify{Event}Async(Guid {entityLower}Id)
        {
            var entity = await _{entityLower}Repo.GetAsync({entityLower}Id);

            // Look up the notification type by name (must match migration)
            var notificationType = await _notificationTypeRepo.FirstOrDefaultAsync(
                x => x.Name == "{NotificationTypeName}");
            if (notificationType == null)
                return; // Type not configured yet — fail gracefully

            // Look up sender (system user or null)
            var fromPerson = await _personRepo.FirstOrDefaultAsync(x => x.User.Id == 1);

            // Build template data
            var data = new {Domain}NotificationModel
            {
                FullName = entity.{RecipientPerson}.FullName,
                {DomainProperty} = entity.{PropertyValue}
            };

            // Optionally force a specific channel (null = use framework defaults)
            var channel = await _channelRepo.FirstOrDefaultAsync(x => x.Name == "Email");

            await _notificationSender.SendNotificationAsync(
                notificationType,
                fromPerson,
                entity.{RecipientPerson},
                data,
                RefListNotificationPriority.Medium,
                attachments: null,
                cc: null,
                triggeringEntity: new GenericEntityReference(entity),
                channel: channel);
        }
    }
}
```

**Implementation rules:**
- Always register as `ITransientDependency`.
- Look up `NotificationTypeConfig` by name at runtime — the name must match what was created in the migration.
- **Null-check** the notification type and return gracefully if not found.
- Pass `GenericEntityReference` to link the notification to the triggering entity for audit purposes.
- Pass `channel: null` to let the framework resolve channels automatically (recommended unless you have a specific reason to force a channel).

### Real-World Example: Leave Decision Notification

```csharp
using Abp.Domain.Repositories;
using Shesha.Domain;
using Shesha.Domain.Enums;
using Shesha.EntityReferences;
using Shesha.Extensions;
using Shesha.Leave.Domain.LeaveWorkflows;
using Shesha.Notifications;
using System;
using System.Threading.Tasks;

namespace Shesha.Leave.Application.Notifications
{
    public class LeaveApplicantNotificationSender : ILeaveApplicantNotificationSender
    {
        private readonly IRepository<LeaveApplication, Guid> _leaveApplicationRepo;
        private readonly INotificationSender _notificationSender;
        private readonly IRepository<NotificationTypeConfig, Guid> _notificationTypeConfigRepo;
        private readonly IRepository<NotificationChannelConfig, Guid> _notificationChannelConfigRepo;
        private readonly IRepository<Person, Guid> _personRepo;

        public LeaveApplicantNotificationSender(
            IRepository<LeaveApplication, Guid> leaveApplicationRepo,
            INotificationSender notificationSender,
            IRepository<NotificationTypeConfig, Guid> notificationTypeConfigRepo,
            IRepository<NotificationChannelConfig, Guid> notificationChannelConfigRepo,
            IRepository<Person, Guid> personRepo)
        {
            _leaveApplicationRepo = leaveApplicationRepo;
            _notificationSender = notificationSender;
            _personRepo = personRepo;
            _notificationTypeConfigRepo = notificationTypeConfigRepo;
            _notificationChannelConfigRepo = notificationChannelConfigRepo;
        }

        public async Task NotifyApplicantTheLeaveDecisionAsync(Guid leaveApplicationId)
        {
            var notificationType = await _notificationTypeConfigRepo
                .FirstOrDefaultAsync(x => x.Name == "LeaveDecisionNotification");
            var fromPerson = await _personRepo.FirstOrDefaultAsync(x => x.User.Id == 1);
            var channel = await _notificationChannelConfigRepo
                .FirstOrDefaultAsync(x => x.Name == "Email");

            var leaveApplication = await _leaveApplicationRepo.GetAsync(leaveApplicationId);

            var notificationData = new LeaveApplicationNotificationDto
            {
                ApplicantFullName = leaveApplication?.LeaveRequest?.LeaveProfile?.Person?.FullName,
                ApplicationSubject = leaveApplication.Subject,
                ApplicantEmail = leaveApplication?.LeaveRequest?.LeaveProfile?.Person?.EmailAddress1,
                Result = leaveApplication?.LeaveRequest.GetReferenceListDisplayText(x => x.RequestStatus),
                Approver = leaveApplication?.LeaveRequest?.Level2Approver?.ActiveAppointment?.Person?.FullName,
            };

            await _notificationSender.SendNotificationAsync(
                notificationType,
                fromPerson,
                leaveApplication.LeaveRequest?.LeaveProfile?.Person,
                notificationData,
                RefListNotificationPriority.Low,
                null,
                null,
                new GenericEntityReference(leaveApplication),
                channel);
        }
    }
}
```

### Real-World Example: Change of Supervisor (Multiple Recipients)

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Abp.Notifications;
using Shesha.Domain;
using Shesha.Domain.Enums;
using Shesha.EntityReferences;
using Shesha.Notifications;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Shesha.Hcm.Common.Notifications
{
    public class ChangeOfSupervisorNotificationSender : IChangeOfSupervisorNotificationSender, ITransientDependency
    {
        private readonly IRepository<ChangeOfSupervisorWorkflow, Guid> _workflowRepo;
        private readonly INotificationSender _notificationSender;
        private readonly IRepository<NotificationTypeConfig, Guid> _notificationTypeConfigRepo;
        private readonly IRepository<NotificationChannelConfig, Guid> _notificationChannelConfigRepo;
        private readonly IRepository<Person, Guid> _personRepo;

        public ChangeOfSupervisorNotificationSender(
            INotificationSender notificationSender,
            IRepository<ChangeOfSupervisorWorkflow, Guid> workflowRepo,
            IRepository<NotificationTypeConfig, Guid> notificationTypeConfigRepo,
            IRepository<NotificationChannelConfig, Guid> notificationChannelConfigRepo,
            IRepository<Person, Guid> personRepo)
        {
            _notificationSender = notificationSender;
            _workflowRepo = workflowRepo;
            _personRepo = personRepo;
            _notificationTypeConfigRepo = notificationTypeConfigRepo;
            _notificationChannelConfigRepo = notificationChannelConfigRepo;
        }

        public async Task NotifyCompletionOfNewSupervisorAsync(Guid workflowId)
        {
            var workflow = await _workflowRepo.GetAsync(workflowId);
            var notificationType = await _notificationTypeConfigRepo
                .FirstOrDefaultAsync(x => x.Name == "ChangeOfSupervisor");
            var fromPerson = await _personRepo.FirstOrDefaultAsync(x => x.User.Id == 1);
            var channel = await _notificationChannelConfigRepo
                .FirstOrDefaultAsync(x => x.Name == "Email");

            var data = new ChangeOfSupervisorNotificationModel
            {
                FullName = workflow?.PositionBeingChanged?.ActiveAppointment?.Person?.FullName,
                ProposedSupervisor = workflow?.ProposedSupervisorPosition?.ActiveAppointment?.Person?.FullName,
            };

            // Collect all people who should be notified
            var recipients = new List<Person>();
            if (workflow?.PositionBeingChanged?.ActiveAppointment?.Person != null)
                recipients.Add(workflow.PositionBeingChanged.ActiveAppointment.Person);
            if (workflow?.OriginalSupervisorPosition?.ActiveAppointment?.Person != null)
                recipients.Add(workflow.OriginalSupervisorPosition.ActiveAppointment.Person);
            if (workflow?.ProposedSupervisorPosition?.ActiveAppointment?.Person != null)
                recipients.Add(workflow.ProposedSupervisorPosition.ActiveAppointment.Person);

            foreach (var person in recipients)
            {
                await _notificationSender.SendNotificationAsync(
                    notificationType, fromPerson, person, data,
                    RefListNotificationPriority.Low,
                    null, null,
                    new GenericEntityReference(workflow),
                    channel);
            }
        }
    }
}
```

## §3 Sending to Raw Addresses

When you don't have a `Person` entity, use `RawAddressMessageParticipant`:

```csharp
using Shesha.Notifications.MessageParticipants;

// Send to a raw email address
var receiver = new RawAddressMessageParticipant("user@example.com");
await _notificationSender.SendNotificationAsync(
    notificationType,
    sender: null,           // IMessageSender? — null for system notifications
    receiver: receiver,     // IMessageReceiver
    data,
    RefListNotificationPriority.Medium);
```

## §4 Sending to Multiple Recipients

Loop through recipients — each call creates a separate `NotificationMessage`:

```csharp
foreach (var person in recipients)
{
    await _notificationSender.SendNotificationAsync(
        notificationType, fromPerson, person, data,
        RefListNotificationPriority.Medium,
        triggeringEntity: new GenericEntityReference(entity));
}
```

## §5 Including Attachments

```csharp
var attachments = new List<NotificationAttachmentDto>
{
    new NotificationAttachmentDto
    {
        FileName = "report.pdf",
        StoredFileId = storedFile.Id
    }
};

await _notificationSender.SendNotificationAsync(
    notificationType, fromPerson, recipient, data,
    RefListNotificationPriority.Medium,
    attachments: attachments);
```

The notification type must have `AllowAttachments = true` and the channel must support attachments.
