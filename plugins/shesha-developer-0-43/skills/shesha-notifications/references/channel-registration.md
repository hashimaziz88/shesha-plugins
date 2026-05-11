# Channel Registration

## Contents
- §1 Registering built-in channels
- §2 Checking existing channels

## §1 Registering Built-In Channels

Channels must be registered in `Startup.cs` (or the DI configuration class) for the framework to route notifications to them.

Check if channels are already registered:

```bash
grep -rn "INotificationChannelSender" --include="*.cs" backend/src/
```

If not registered, add them in `ConfigureServices`:

```csharp
public void ConfigureServices(IServiceCollection services)
{
    // ... other registrations ...

    services.AddTransient<INotificationChannelSender, EmailChannelSender>();
    services.AddTransient<INotificationChannelSender, SmsChannelSender>();
}
```

**Namespaces:**
- `INotificationChannelSender` — `Shesha.Notifications`
- `EmailChannelSender` — `Shesha.Notifications.Emails`
- `SmsChannelSender` — `Shesha.Notifications.Sms`

For implementing custom channels, see [custom-channel.md](custom-channel.md).

## §2 Checking Existing Channels

Before creating or registering a new channel, verify what channels already exist.

### Via API (requires running backend)

Find the backend base URL:
```bash
grep -r "ServerRootAddress" --include="appsettings*.json" backend/src/
```

Query existing channels:
```bash
curl -s "http://localhost:21021/api/dynamic/Shesha/NotificationChannelConfig/Crud/GetAll?properties=id name description statusLkp senderTypeName supportedFormatLkp&maxResultCount=100" | python -m json.tool
```

The response returns `items` with each channel's `name`, `senderTypeName`, and `statusLkp` (1=Enabled, 2=Disabled, 3=Suppressed).

### Via code search

```bash
# Find all INotificationChannelSender registrations
grep -rn "INotificationChannelSender" --include="*.cs" backend/src/

# Find all INotificationChannelSender implementations
grep -rn "INotificationChannelSender" --include="*.cs" backend/src/ | grep "class.*:"
```
