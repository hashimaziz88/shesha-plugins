# API-Based Notification Creation

## Contents
- §1 Prerequisites and authentication
- §2 Creating NotificationTypeConfig via API
- §3 Creating NotificationTemplate via API
- §4 Duplicate detection
- §5 Verification
- §6 HTML body conversion rules
- §7 API endpoint reference

Use this workflow to create notification types and templates directly via the running backend's CRUD API, without writing FluentMigrator migrations. Best for rapid prototyping, ad-hoc configuration, or when the backend is already running.

## §1 Prerequisites and Authentication

### Resolve backend URL

Find the backend base URL from `appsettings.json`:
```bash
grep -r "ServerRootAddress" --include="appsettings*.json" backend/src/
```

Verify the backend is reachable:
```bash
curl -s -o /dev/null -w "%{http_code}" {BASE_URL}/swagger/index.html
```

If the backend is not running (status `000` or non-`200`), inform the user and stop.

### Authenticate

```bash
TOKEN=$(curl -s -X POST "{BASE_URL}/api/TokenAuth/Authenticate" \
  -H "Content-Type: application/json" \
  -d '{"userNameOrEmailAddress":"admin","password":"123qwe"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['result']['accessToken'])")
```

If authentication fails (wrong credentials or no `accessToken` in response), ask the user for valid credentials.

## §2 Creating NotificationTypeConfig via API

### Required fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | kebab-case identifier (e.g., `order-confirmed`) |
| `label` | Yes | Human-readable display name |
| `description` | Yes | When/why this notification is sent |
| `module` | Yes | Module reference as `{ "id": "guid" }` |

### Optional fields

| Field | Default | Description |
|-------|---------|-------------|
| `allowAttachments` | `true` | Enable file attachments |
| `canOptOut` | `false` | Users can opt out |
| `isTimeSensitive` | `false` | Send synchronously (bypass queue) |
| `disable` | `false` | Globally disable this type |

### Resolve module ID

Query the API for the module:
```bash
curl -s "{BASE_URL}/api/dynamic/Shesha/Module/Crud/GetAll?properties=id%20name&maxResultCount=50" \
  -H "Authorization: Bearer $TOKEN"
```

Search the `items` array for the matching module name. If not found, ask the user.

### Create the type

```bash
curl -s -X POST "{BASE_URL}/api/dynamic/Shesha/NotificationTypeConfig/Crud/Create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "{name}",
    "label": "{label}",
    "description": "{description}",
    "module": { "id": "{moduleId}" },
    "disable": false,
    "canOptOut": {canOptOut},
    "isTimeSensitive": {isTimeSensitive},
    "allowAttachments": {allowAttachments},
    "versionNo": 1,
    "versionStatus": 3
  }'
```

Extract the created ID from `result.id`. If creation fails, report the error and stop.

## §3 Creating NotificationTemplate via API

### Message format values

| Channel | `messageFormat` | Body format |
|---------|----------------|-------------|
| Email | `2` (RichText) | HTML with `<br/>`, `<strong>`, `<a href>`, etc. |
| SMS | `1` (PlainText) | Plain text only |
| Push | `1` (PlainText) | Plain text only |

### Create the template

```bash
curl -s -X POST "{BASE_URL}/api/dynamic/Shesha/NotificationTemplate/Crud/Create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "titleTemplate": "{subject}",
    "bodyTemplate": "{body}",
    "messageFormat": {messageFormatValue},
    "partOf": { "id": "{notificationTypeConfigId}" }
  }'
```

Extract the created ID from `result.id`.

### Multiple channels

To create templates for multiple channels (e.g., both Email and SMS), create one template per channel, each linked to the same NotificationTypeConfig via `partOf.id`.

## §4 Duplicate Detection

**MANDATORY:** Before creating a NotificationTypeConfig, check for existing types with the same name.

```bash
curl -s "{BASE_URL}/api/dynamic/Shesha/NotificationTypeConfig/Crud/GetAll?properties=id%20name%20description%20module%7Bid%20name%7D&maxResultCount=200" \
  -H "Authorization: Bearer $TOKEN"
```

Search the `items` array for a matching `name`. If found, ask the user:
> **A NotificationTypeConfig named `{name}` already exists (ID: `{id}`). Do you want to add a template to it, or create a new one with a different name?**

## §5 Verification

After creating records, query them back to confirm:

```bash
# Verify NotificationTypeConfig
curl -s "{BASE_URL}/api/dynamic/Shesha/NotificationTypeConfig/Crud/Get?id={typeId}&properties=id%20name%20label%20description%20module%7Bname%7D" \
  -H "Authorization: Bearer $TOKEN"

# Verify NotificationTemplate
curl -s "{BASE_URL}/api/dynamic/Shesha/NotificationTemplate/Crud/Get?id={templateId}&properties=id%20titleTemplate%20bodyTemplate%20messageFormat%20partOf%7Bid%20name%7D" \
  -H "Authorization: Bearer $TOKEN"
```

Present a summary:

```
### Created NotificationTypeConfig
- **Name:** {name}
- **ID:** {id}
- **Module:** {moduleName}
- **Label:** {label}

### Created NotificationTemplate
- **ID:** {templateId}
- **Subject:** {subject}
- **Format:** Email (RichText) / SMS (PlainText) / Push (PlainText)
- **Linked to:** {notificationTypeConfigName}
- **Placeholders:** {{placeholder1}}, {{placeholder2}}, ...
```

## §6 HTML Body Conversion Rules

When converting markdown or plain text to HTML for email templates (both API-based and migration-based):

| Source | HTML |
|--------|------|
| Line breaks | `<br/>` |
| Bold `**text**` | `<strong>text</strong>` |
| Links `[text](url)` | `<a href="url">text</a>` |
| Placeholder links | `<a href="{{placeholder}}">Link Text</a>` |
| Bullet lists | `<ul><li>...</li></ul>` |
| Paragraphs (blank line separated) | `<br/><br/>` |
| Em-dash `–` | Use regular dash `-` (avoids encoding issues) |

These rules apply to both the `bodyTemplate` field in API calls and the body parameter in `.AddEmailTemplate()` migrations.

## §7 API Endpoint Reference

| Operation | Method | URL |
|-----------|--------|-----|
| Authenticate | POST | `/api/TokenAuth/Authenticate` |
| List modules | GET | `/api/dynamic/Shesha/Module/Crud/GetAll` |
| List notification types | GET | `/api/dynamic/Shesha/NotificationTypeConfig/Crud/GetAll` |
| Get notification type | GET | `/api/dynamic/Shesha/NotificationTypeConfig/Crud/Get?id={id}` |
| Create notification type | POST | `/api/dynamic/Shesha/NotificationTypeConfig/Crud/Create` |
| Update notification type | PUT | `/api/dynamic/Shesha/NotificationTypeConfig/Crud/Update` |
| List templates | GET | `/api/dynamic/Shesha/NotificationTemplate/Crud/GetAll` |
| Get template | GET | `/api/dynamic/Shesha/NotificationTemplate/Crud/Get?id={id}` |
| Create template | POST | `/api/dynamic/Shesha/NotificationTemplate/Crud/Create` |
| Update template | PUT | `/api/dynamic/Shesha/NotificationTemplate/Crud/Update` |

### Query parameter patterns

| Pattern | Syntax | Example |
|---------|--------|---------|
| Select properties | `?properties=field1%20field2` | `?properties=id%20name%20description` |
| Nested objects | `field%7Bsubfield%7D` | `module%7Bid%20name%7D` |
| Pagination | `&maxResultCount=N&skipCount=N` | `&maxResultCount=100&skipCount=0` |
