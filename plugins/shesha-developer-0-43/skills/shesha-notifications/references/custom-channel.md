# Custom Notification Channels

## Contents
- §1 INotificationChannelSender implementation
- §2 Database migration for channel config
- §3 Template considerations
- §4 INotificationChannelSender interface reference

## §1 INotificationChannelSender Implementation

### Interface

```csharp
public interface INotificationChannelSender
{
    string? GetRecipientId(Person person);
    Task<SendStatus> SendAsync(
        IMessageSender? sender,
        IMessageReceiver receiver,
        NotificationMessage message,
        List<EmailAttachment>? attachments = null);
}
```

### Template

```csharp
using Abp.Dependency;
using Shesha.Domain;
using Shesha.Email.Dtos;
using Shesha.Notifications;
using Shesha.Notifications.Dto;
using Shesha.Notifications.MessageParticipants;
using Microsoft.Extensions.Configuration;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace {Namespace}.Notifications.Channels
{
    /// <summary>
    /// Sends notifications via {ChannelName}.
    /// </summary>
    public class {ChannelName}ChannelSender : INotificationChannelSender, ITransientDependency
    {
        // Inject dependencies needed for your channel's API/SDK
        public {ChannelName}ChannelSender(/* dependencies */)
        {
        }

        public string? GetRecipientId(Person person)
        {
            // Return the channel-specific identifier for this person.
            // Examples:
            //   Email channel → person.EmailAddress1
            //   SMS channel   → person.MobileNumber1
            //   Slack         → person.EmailAddress1 (or a custom property)
            //   Teams         → person.EmailAddress1
            //   WhatsApp      → person.MobileNumber1
            return person.{RelevantProperty};
        }

        public async Task<SendStatus> SendAsync(
            IMessageSender? sender,
            IMessageReceiver receiver,
            NotificationMessage message,
            List<EmailAttachment>? attachments = null)
        {
            // 1. Get the recipient's address via this channel
            var recipientAddress = receiver.GetAddress(this);
            if (string.IsNullOrWhiteSpace(recipientAddress))
                return SendStatus.Failed("No recipient address available for {ChannelName}");

            try
            {
                // 2. Implement channel-specific send logic
                //    message.Subject — rendered subject (may be null for SMS-like channels)
                //    message.Message — rendered body (template placeholders already resolved)

                // 3. Return success or failure
                return SendStatus.Success(null);
            }
            catch (Exception ex)
            {
                // Return failure — framework will auto-retry up to 3 times
                return SendStatus.Failed(ex.Message);
            }
        }
    }
}
```

### Key implementation notes

- **`GetRecipientId(Person)`** — Maps a Person to the address your channel uses. Called by `PersonMessageParticipant.GetAddress()`. For `RawAddressMessageParticipant`, the raw address string is returned directly (bypasses this method).
- **`SendAsync` return values:**
  - `SendStatus.Success(null)` — message delivered. Status set to `Sent`.
  - `SendStatus.Success("optional info")` — delivered with info message.
  - `SendStatus.Failed("reason")` — delivery failed. Framework sets status to `WaitToRetry` and retries up to 3 times (delays: 10s, 20s, 20s). After all retries exhausted, status becomes `Failed`.
- **`NotificationMessage` properties available in `SendAsync`:**
  - `message.Subject` — rendered title template (placeholders resolved)
  - `message.Message` — rendered body template (placeholders resolved)
  - `message.RecipientText` — resolved recipient address string
  - `message.SenderText` — resolved sender address string
  - `message.Cc` — CC addresses (semicolon-delimited, primarily for email)

### Real-world example — Slack webhook

```csharp
using Abp.Dependency;
using Shesha.Domain;
using Shesha.Email.Dtos;
using Shesha.Notifications;
using Shesha.Notifications.Dto;
using Shesha.Notifications.MessageParticipants;
using Microsoft.Extensions.Configuration;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace MyProject.Notifications.Channels
{
    public class SlackChannelSender : INotificationChannelSender, ITransientDependency
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly string _webhookUrl;

        public SlackChannelSender(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _webhookUrl = configuration["Notifications:Slack:WebhookUrl"];
        }

        public string? GetRecipientId(Person person)
        {
            return person.EmailAddress1;
        }

        public async Task<SendStatus> SendAsync(
            IMessageSender? sender,
            IMessageReceiver receiver,
            NotificationMessage message,
            List<EmailAttachment>? attachments = null)
        {
            var recipientAddress = receiver.GetAddress(this);
            if (string.IsNullOrWhiteSpace(recipientAddress))
                return SendStatus.Failed("No recipient address available");

            try
            {
                var payload = new
                {
                    text = $"*{message.Subject}*\n{message.Message}"
                };

                var client = _httpClientFactory.CreateClient();
                var content = new StringContent(
                    JsonSerializer.Serialize(payload),
                    Encoding.UTF8,
                    "application/json");

                var response = await client.PostAsync(_webhookUrl, content);

                return response.IsSuccessStatusCode
                    ? SendStatus.Success(null)
                    : SendStatus.Failed($"Slack returned {response.StatusCode}");
            }
            catch (Exception ex)
            {
                return SendStatus.Failed(ex.Message);
            }
        }
    }
}
```

## §2 Database Migration for Channel Config

The framework needs a `NotificationChannelConfig` record to route notifications to your channel. The `SenderTypeName` must be the **fully qualified class name** of your implementation.

### Template

```csharp
using FluentMigrator;
using System;

namespace {Namespace}.Migrations
{
    [Migration({YYYYMMDDHHmmss})]
    public class M{YYYYMMDDHHmmss} : Migration
    {
        public override void Up()
        {
            Insert.IntoTable("Frwk_NotificationChannelConfigs")
                .Row(new
                {
                    Id = "{NEW-GUID}",
                    Name = "{ChannelName}",
                    Description = "{Description of channel}",
                    SupportedFormatLkp = 1,       // See lookup values below
                    SupportedMechanismLkp = 1,    // See lookup values below
                    SenderTypeName = "{Namespace}.Notifications.Channels.{ChannelName}ChannelSender",
                    StatusLkp = 1,                // 1 = Enabled
                    SupportsAttachment = false,
                    CreationTime = DateTime.UtcNow
                });
        }

        public override void Down()
        {
            Delete.FromTable("Frwk_NotificationChannelConfigs")
                .Row(new { Id = "{NEW-GUID}" });
        }
    }
}
```

### Lookup values

| Column | Value | Meaning |
|--------|-------|---------|
| `SupportedFormatLkp` | `1` | PlainText |
| `SupportedFormatLkp` | `2` | RichText (HTML) |
| `SupportedFormatLkp` | `3` | EnhancedText |
| `SupportedMechanismLkp` | `1` | Direct (one-to-one) |
| `SupportedMechanismLkp` | `2` | BulkSend |
| `SupportedMechanismLkp` | `4` | Broadcast |
| `StatusLkp` | `1` | Enabled |
| `StatusLkp` | `2` | Disabled |
| `StatusLkp` | `3` | Suppressed |

### Choosing the right SupportedFormat

| If your channel... | Use |
|---------------------|-----|
| Accepts only plain text (Slack, SMS, WhatsApp) | `PlainText` (1) |
| Accepts HTML content (Email, Teams adaptive cards) | `RichText` (2) |
| Needs unique templates separate from SMS and Email | `EnhancedText` (3) |

**Important:** Templates are matched to channels by `MessageFormat`. If your custom channel uses `PlainText`, it will share templates with SMS. Use `EnhancedText` if you need channel-specific templates.

## §3 Template Considerations

After creating the channel config, add templates for notification types that should use the new channel:

```csharp
// For PlainText channels — uses AddSmsTemplate helper
this.Shesha().NotificationUpdate("{ModuleName}", "{NotificationName}")
    .AddSmsTemplate(
        "{GUID}".ToGuid(),
        "{TemplateName} via {ChannelName}",
        "Message body with {{Placeholder}}");

// For RichText channels — uses AddEmailTemplate helper
this.Shesha().NotificationUpdate("{ModuleName}", "{NotificationName}")
    .AddEmailTemplate(
        "{GUID}".ToGuid(),
        "{TemplateName} via {ChannelName}",
        "Subject with {{Placeholder}}",
        @"<p>HTML body with {{Placeholder}}</p>");
```

## §4 INotificationChannelSender Interface Reference

| Method | Parameters | Returns | Called When |
|--------|-----------|---------|-------------|
| `GetRecipientId` | `Person person` | `string?` — channel-specific address | Framework resolves recipient address for a Person entity |
| `SendAsync` | `IMessageSender? sender`, `IMessageReceiver receiver`, `NotificationMessage message`, `List<EmailAttachment>? attachments` | `Task<SendStatus>` | Framework delivers a notification through this channel |

**SendStatus static methods:**
- `SendStatus.Success(string? message)` — delivery succeeded
- `SendStatus.Failed(string message)` — delivery failed (triggers retry)
