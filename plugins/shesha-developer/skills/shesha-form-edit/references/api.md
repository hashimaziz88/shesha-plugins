# Shesha Form API — Recipes

All curl recipes assume `$BASE_URL` and `$ACCESS_TOKEN` are set. On Windows, substitute `%BASE_URL%`/`%ACCESS_TOKEN%` for cmd or `$env:BASE_URL`/`$env:ACCESS_TOKEN` for PowerShell.

---

## 1. Resolve base URL

Order of precedence — **the full list is in SKILL.md Step 1; don't shortcut it.** This section
previously started at step 3, omitting the two highest-precedence sources, which is exactly what
broke sandboxed and headless runs:

1. **A backend URL supplied in the task/dispatch context** — always wins.
2. **`$SHESHA_BACKEND_URL`**.
3. `src/*.Web.Host/Properties/launchSettings.json` → `profiles.Project.applicationUrl`
4. `src/*.Web.Host/appsettings.json` → `Kestrel:Endpoints:Http:Url`
5. Fallback: `http://localhost:21021`

Strip trailing slash. Glob the `.Web.Host` project rather than assuming a project name — the
examples below use a placeholder app (`PBF.MembershipManagement`) purely for illustration.

---

## 2. Authenticate

```bash
curl -s -X POST "$BASE_URL/api/TokenAuth/Authenticate" \
  -H "Content-Type: application/json" \
  -d '{"userNameOrEmailAddress":"admin","password":"123qwe"}'
```

ABP wraps responses; expect:

```json
{
  "result": {
    "accessToken": "eyJ...",
    "encryptedAccessToken": "...",
    "expireInSeconds": 86400,
    "expireOn": "...",
    "userId": 1,
    "personId": "...",
    "resultType": 1
  },
  "targetUrl": null,
  "success": true,
  "error": null,
  "unAuthorizedRequest": false,
  "__abp": true
}
```

Some Shesha builds return the token at the **root** instead. Try both:

```bash
TOKEN=$(curl ... | jq -r '.result.accessToken // .accessToken')
```

If both are null, the credentials are wrong (or the user is locked) — surface the raw response.

---

## 3. Resolve form id by name (when user gave module + name)

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetByName" \
  --data-urlencode "module=PBF.MembershipManagement" \
  --data-urlencode "name=member-create" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Response (ABP envelope):

```json
{
  "result": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "module": { "name": "PBF.MembershipManagement", "id": "..." },
    "name": "member-create",
    "label": "Member - Create",
    "markup": "{...stringified form JSON...}",
    "modelType": "PBF.MembershipManagement.Domain.Domain.Member",
    "versionNo": 1,
    "versionStatus": 3
  },
  "success": true
}
```

Extract `result.id` → `$FORM_ID`. Note: `GetByName` already includes `markup`, so if you used this endpoint you can skip Step 4.

If `result` is null, the form doesn't exist under that module/name. Stop and tell the user.

---

## 4. Fetch form JSON by id

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o $RUN_DIR/staged/form-current.json
```

**How many times to parse — the two endpoints differ, and conflating them is a real time-sink:**

| Endpoint | Body | Parses |
|---|---|---|
| `GetJson?id=` | the raw markup as a file download (`Content-Disposition: attachment`) | **once** — `JSON.parse(body)` gives you `{ components, formSettings }` |
| `Get?id=` / `GetByName` | the ABP envelope, with the markup as a **string** inside it | **twice** — `JSON.parse(JSON.parse(body).result.markup)` |

Use `GetJson` when you want the markup; use `Get`/`GetByName` when you also need the wrapping DTO
(id, name, modelType, versionStatus). This paragraph previously said the `GetJson` content was
"already parsed as an object — no string wrapping" **and** to "read it with `JSON.parse`" in the
same breath.

---

## 5. Push edited markup — UpdateMarkup (preferred)

`PUT /api/services/Shesha/FormConfiguration/UpdateMarkup`

DTO (`FormUpdateMarkupInput`):

```ts
{
  id: string,           // form Guid (required)
  markup?: string,      // stringified form JSON
  access?: number,      // RefListPermissionedAccess (optional)
  permissions?: string[] // optional
}
```

Build the body via Node so the markup string is properly JSON-escaped. Don't try to construct it inline in bash — escaping nested JSON-in-JSON manually is a footgun.

```bash
node -e "
const fs = require('fs');
const tree = JSON.parse(fs.readFileSync('$RUN_DIR/staged/form-edited.json', 'utf8'));
const body = JSON.stringify({
  id: process.env.FORM_ID,
  markup: JSON.stringify(tree)
});
fs.writeFileSync('$RUN_DIR/staged/update-markup-body.json', body);
" 

curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @$RUN_DIR/staged/update-markup-body.json
```

Successful response: HTTP 200 with `{ "result": null, "success": true, ... }`. The endpoint returns `void`.

On error, ABP returns:

```json
{
  "result": null,
  "success": false,
  "error": { "code": 0, "message": "...", "details": "..." },
  "unAuthorizedRequest": false
}
```

Surface `error.message` and `error.details` to the user and stop.

---

## 6. Push edited markup — ImportJson (multipart upload)

`POST /api/services/Shesha/FormConfiguration/ImportJson` with `multipart/form-data`. Use this when you specifically need to mimic the designer's "upload JSON" button.

DTO (`ImportFormJsonInput`):

```ts
{
  ItemId: string,    // form Guid
  file: File         // the form JSON as a file upload, field name MUST be lowercase "file"
}
```

```bash
# $RUN_DIR/staged/form-edited.json contains the stringified-or-tree form JSON.
# If your edits are an object (parsed tree), stringify first; the API expects the file content
# to be a JSON document representing the form markup.

curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "ItemId=$FORM_ID" \
  -F "file=@$RUN_DIR/staged/form-edited.json;type=application/json"
```

Successful response: HTTP 200 with `{ "result": { ...FormConfigurationDto... }, "success": true }`. The DTO contains the updated form record.

Field name **must be `file`** (lowercase) — see `ImportFormJsonInput.File` `[BindProperty(Name = "file")]`.

---

## 7. (Optional) Create a new form

`POST /api/services/Shesha/FormConfiguration/Create`

DTO (`CreateFormConfigurationRequest`):

```ts
{
  moduleId: string,        // module Guid (required)
  name: string,            // unique within module
  label?: string,
  description?: string,
  modelType?: string,      // entity full name
  generationLogicTypeName?: string,
  templateId?: string,     // copy from another form
  markup?: string          // initial markup; can be set later via UpdateMarkup
}
```

```bash
curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/Create" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "...module-guid...",
    "name": "member-quickview",
    "label": "Member - Quick View",
    "modelType": "PBF.MembershipManagement.Domain.Domain.Member"
  }'
```

To resolve `moduleId`, query `GET /api/services/app/Module/GetAll` with bearer token and pick the module by `name`. **Note the `app` namespace** — `Shesha/Module/GetAll` returns 404 (this line said `Shesha` until 2026-08-12).

---

## 8. List forms in a module (browsing)

`GET /api/services/Shesha/FormConfiguration/GetAll?Filter={...}` — ABP `GetAll` with paging. Easier:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetAll" \
  --data-urlencode "MaxResultCount=200" \
  --data-urlencode 'Filter={"and":[{"==":[{"var":"module.name"},"PBF.MembershipManagement"]}]}' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]` with `{ id, name, label, module: {...} }`.

---

## 9. Common errors

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing / expired token | Re-run Step 2 |
| `403 Forbidden` | User lacks `app:Configurator` permission | Login as admin (default has it) |
| `Form is not editable` | Module is read-only or imported-only | Module must have `IsEditable=true`; check `frwk.modules.is_editable` |
| `Module is null` | Form's module reference is broken | Reload the form, check `result.module` is populated |
| `Markup is not valid JSON` | The string you sent isn't parseable | Re-stringify; ensure no truncation in the curl `-d @file` form |
| Empty `result` from GetByName | Form doesn't exist under that name/module | Verify via `GetAll` |
| `result: null` on UpdateMarkup but `success: true` | Normal — endpoint returns void | No action |

---

## 10. Fetch entity metadata (`/Metadata/Get`)

Used by Step 4.5 of the skill to validate `propertyName` references against the actual entity. Try the `app` namespace first; fall back to `Shesha` if it 404s:

```bash
# Primary
curl -s -G "$BASE_URL/api/services/app/Metadata/Get" \
  --data-urlencode "container=PBF.MembershipManagement.Domain.Domain.Member" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Fallback (older / different routing)
curl -s -G "$BASE_URL/api/services/Shesha/Metadata/Get" \
  --data-urlencode "container=PBF.MembershipManagement.Domain.Domain.Member" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected response (ABP envelope; relevant fields):

```json
{
  "result": {
    "containerName": "PBF.MembershipManagement.Domain.Domain.Member",
    "entityFullName": "PBF.MembershipManagement.Domain.Domain.Member",
    "properties": [
      {
        "path": "firstName",
        "name": "firstName",
        "label": "First Name",
        "dataType": "string",
        "required": false,
        "readOnly": false,
        "referenceListName": null,
        "referenceListModule": null,
        "entityType": null
      }
    ]
  }
}
```

Save raw response to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`, then read the
`result.properties[]` array from it directly — each entry's `path` and `dataType` are the two fields
the edit needs.

Validation pass: for every input component in the edit, confirm `propertyName` matches a `properties[].path` (top-level only — nested-path validation is out of scope). Mismatches must be surfaced to the user before push.

**TTL**: 24 hours. Use `--refresh-cache` to force a re-fetch + re-distill. Invalidate manually after running new migrations or model-type changes.

---

## 11. Round-trip verify (post-push)

Step 8 of the skill. Re-fetch the form just pushed and diff against the markup we sent:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  > $RUN_DIR/staged/form-after.json
```

Then in Node:

```js
const sent = JSON.parse(fs.readFileSync('$RUN_DIR/staged/form-sent.json', 'utf8'));
const after = JSON.parse(JSON.parse(fs.readFileSync('$RUN_DIR/staged/form-after.json', 'utf8')).result.markup);
// Walk both trees in component-id order; surface any property whose value differs.
```

For anonymous forms, also confirm the envelope: re-fetch via `GetByName` and assert `result.access === 5`. The `Create` endpoint may not honor `access` on initial create; on mismatch, call `UpdateMarkup` once more with `access: 5, permissions: []` and re-verify.

Common server normalizations to ignore (not bugs): re-ordered keys inside an object, whitespace inside string-encoded `stylingBox` values, `null` → `undefined` collapsing on optional fields. Anything else — surface to the user.

---

## 12. Browser smoke

Step 9 of the skill. Drive whichever browser MCP the session exposes — `mcp__playwright__*`,
`mcp__Claude_Browser__*` or `mcp__claude-in-chrome__*`; the directive below is tool-agnostic.
(There is no `playwright` *skill*, despite what this section used to say.)

### Directive template

> Open `<FRONTEND_URL>/<no-auth|dynamic>/<MODULE>/<FORM_NAME>` in a fresh browser context.
> If path is `/dynamic/...`: first POST `/api/TokenAuth/Authenticate` with `admin`/`123qwe` and set the resulting token in `localStorage.accessToken` before navigating.
> Wait for the form to render (selector `.sha-form` or 5s timeout, whichever comes first).
> Capture: full-page screenshot, all console messages with level `error` or `warning`, all network responses with `status >= 400`.
> Then click the primary action button (if any) and capture again.
> Report: a one-paragraph summary, the screenshot path, and any captured errors / 4xx-5xx network responses verbatim.

### Frontend URL detection

A Shesha project typically has two front-end apps:
- `adminportal/` — typical dev port `http://localhost:3000`
- `publicportal/` — typical dev port `http://localhost:3001`

Read the actual port from `<app>/.env*` (e.g. `PORT=3001`) or `<app>/package.json` `scripts.dev`. Anonymous forms (`access: 5`) usually live in `publicportal`; authenticated forms in `adminportal`. If neither is running, skip the smoke step and warn the user.

### Failure handling

Any captured error → consult [debug.md](debug.md) before guessing. Never silently re-edit and re-push. If the smoke step itself errors out (browser can't connect), warn the user and offer to skip via `--no-browser`.
