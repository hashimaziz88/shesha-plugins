# Shesha Form API — Recipes

All curl recipes assume `$BASE_URL` and `$ACCESS_TOKEN` are set. On Windows, substitute `%BASE_URL%`/`%ACCESS_TOKEN%` for cmd or `$env:BASE_URL`/`$env:ACCESS_TOKEN` for PowerShell.

---

## 1. Resolve base URL

Order of precedence:

1. `src/PBF.MembershipManagement.Web.Host/Properties/launchSettings.json` → `profiles.Project.applicationUrl`
2. `src/PBF.MembershipManagement.Web.Host/appsettings.json` → `Kestrel:Endpoints:Http:Url`
3. Fallback: `http://localhost:21021`

Strip trailing slash.

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

`GetByName` resolves the **latest published (Live) revision** by default. Pass an optional `version` query
param to pin a specific `versionNo`.

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

**0.43 is version-aware — `versionNo`/`versionStatus` are load-bearing, not cosmetic.** On 0.43 a form is a
versioned ConfigurationItem: each edit produces a new revision (same `Origin`, `versionNo`+1) with a
`versionStatus` of `1=Draft, 2=Ready, 3=Live, 4=Cancelled, 5=Retired`. Before you push, branch on the
resolved `versionStatus`:

- **3 (Live):** never write it in place — `CreateNewVersion{id}` first, then `UpdateMarkup` the new Draft (see §4.5).
- **1 (Draft) / 2 (Ready):** an edit is already in flight — reuse that version (`UpdateMarkup` on it), don't create another.
- **4 (Cancelled) / 5 (Retired):** terminal — never edit; resolve to the latest non-terminal version first.

To find an in-flight Draft/Ready that `GetByName` (which resolves Live) won't return, use `GetAll` and
filter `IsLast==true` (latest revision per `Origin`). The full branch/publish algorithm lives in
[version lifecycle](version-lifecycle.md#edit-algorithm) — that file is the source of truth; §4.5 below is
the API-call cheat sheet.

If `result` is null, the form doesn't exist under that module/name. Stop and tell the user.

---

## 4. Fetch form JSON by id

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o /tmp/form-current.json
```

This endpoint returns the **raw markup as a file download** (`application/json` with `Content-Disposition: attachment`). The file content **is** the form JSON (already parsed as an object — no string wrapping). Read it with `JSON.parse`.

If you need the wrapping DTO (with id, name, modelType etc.) instead, use `Get` — `GET /api/services/Shesha/FormConfiguration/Get?id=$FORM_ID` — which returns the ABP envelope.

---

## 4.5. Version lifecycle endpoints (0.43 — read before any push to an existing form)

On 0.43, `UpdateMarkup`/`ImportJson` write to a **specific version id**. Writing them to a **Live** version
clobbers the published form in place, and writing to a Retired/Cancelled version corrupts a dead revision.
The correct flow is: resolve → branch on status → (if Live) branch a new Draft → push markup to the Draft →
publish. These endpoints are the moving parts; the algorithm that sequences them is the
**[version lifecycle](version-lifecycle.md) source of truth** — do not re-derive it, follow it.

| Endpoint | Method + body | Effect |
|---|---|---|
| `FormConfiguration/CreateNewVersion` | `POST { "id": "<current id>" }` | Clones the item to a **new Draft** (`versionNo`+1, same `Origin`). Returns the **new Draft id** — push to THAT id, never the source. |
| `FormConfiguration/UpdateStatus` | `PUT { "filter": {...}, "status": <n> }` | Advances status. Validates `Draft(1)→Ready(2)→Live(3)`. Promoting to Live **auto-retires the prior Live** revision. |
| `FormConfiguration/CancelVersion` | `POST { "id": "<draft id>" }` | Abandons an in-flight Draft (use when you orphaned one and are aborting). |

```bash
# 1. Branch a new Draft off the current Live form
NEW_ID=$(curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/CreateNewVersion" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"$FORM_ID\"}" | jq -r '.result.id // .result')

# 2. Push markup to the NEW DRAFT id (§5) — NOT $FORM_ID (that is the Live one)

# 3. Publish: Draft(1) → Ready(2) → Live(3). Promoting to Live auto-retires the old Live.
for S in 2 3; do
  curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateStatus" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"filter\":{\"and\":[{\"==\":[{\"var\":\"id\"},\"$NEW_ID\"]}]},\"status\":$S}"
done
```

**Invariants (from [version lifecycle → Invariants](version-lifecycle.md#invariants)):** `CreateNewVersion`
at most **once** per edit session; every re-push in the verify/fix loop targets the **same** Draft; publish
**once**, only after the gates pass. Never write a Retired/Cancelled version.

**Failure recovery:** if `UpdateStatus` fails after a good `UpdateMarkup`, the Draft exists unpublished —
**retry `UpdateStatus`**, do NOT `CreateNewVersion` again; on abort, optionally `CancelVersion` the orphan.
See [version lifecycle → Failure recovery](version-lifecycle.md#failure-recovery).

---

## 5. Push edited markup — UpdateMarkup (preferred)

`PUT /api/services/Shesha/FormConfiguration/UpdateMarkup`

> **0.43 caveat:** `UpdateMarkup` writes to the **version id you pass**. If `$FORM_ID` resolved to a **Live**
> revision, pushing here clobbers the published form in place. Do the §4.5 branch first and pass the **new
> Draft id**; if a Draft/Ready is already in flight, pass that one. Never pass a Retired/Cancelled id. Then
> publish once via `UpdateStatus` (§4.5). See [version lifecycle](version-lifecycle.md#edit-algorithm).

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
const tree = JSON.parse(fs.readFileSync('/tmp/form-edited.json', 'utf8'));
const body = JSON.stringify({
  id: process.env.FORM_ID,
  markup: JSON.stringify(tree)
});
fs.writeFileSync('/tmp/update-markup-body.json', body);
" 

curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/update-markup-body.json
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

> **0.43 caveat:** like `UpdateMarkup`, `ImportJson` writes to the `ItemId` version you pass — the same
> Live-clobber trap applies. Import into a Draft (branch via §4.5 if the form is Live), then publish with
> `UpdateStatus`. See [version lifecycle](version-lifecycle.md#edit-algorithm).

DTO (`ImportFormJsonInput`):

```ts
{
  ItemId: string,    // form Guid
  file: File         // the form JSON as a file upload, field name MUST be lowercase "file"
}
```

```bash
# /tmp/form-edited.json contains the stringified-or-tree form JSON.
# If your edits are an object (parsed tree), stringify first; the API expects the file content
# to be a JSON document representing the form markup.

curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "ItemId=$FORM_ID" \
  -F "file=@/tmp/form-edited.json;type=application/json"
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

To resolve `moduleId`, query `GET /api/services/Shesha/Module/GetAll` with bearer token and pick the module by `name`.

> **0.43 — a freshly Created form is a Draft(1) and is NOT yet renderable.** `Create` alone leaves the form
> unpublished; `GetByName`/the `/dynamic/<mod>/<name>` route (which resolve **Live**) will 404 until you
> publish. The full brand-new flow is: **Create → `UpdateMarkup` the initial Draft (§5) → `UpdateStatus`
> 1→2→3 (§4.5) → clear the adminportal cache** (forms/entities/ref-lists/misc IndexedDB stores from a static
> page, not just `form`/`form_lookup` — see [verification.md §2](verification.md)). See
> [version lifecycle → Edit algorithm, "brand-new" branch](version-lifecycle.md#edit-algorithm).

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
| Reflist dropdown empty | Reflist has no items, or wrong `referenceListId` pair | Confirm the reflist exists via the legacy `/settings` reference-list editor or `ReferenceList/GetByName` (0.43 has no Configuration Studio) |
| Empty `result` from GetByName | Form doesn't exist under that name/module | Verify via `GetAll` |
| `result: null` on UpdateMarkup but `success: true` | Normal — endpoint returns void | No action |

---

## 10. Fetch entity metadata (`/Metadata/Get`)

Used by Step 1.5 of the skill to validate `propertyName` references against the actual entity. Try the `app` namespace first; fall back to `Shesha` if it 404s:

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

Save raw response to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json`, then distill:

```bash
node .claude/skills/shesha-form-edit/scripts/summarize.js \
  .claude/cache/shesha-form-edit/metadata/Member.raw.json \
  --type metadata \
  --out .claude/cache/shesha-form-edit/metadata/Member.summary.md
```

Validation pass: for every input component in the edit, confirm `propertyName` matches a `properties[].path` (top-level only — nested-path validation is out of scope). Mismatches must be surfaced to the user before push.

**TTL**: 24 hours. Use `--refresh-cache` to force a re-fetch + re-distill. Invalidate manually after running new migrations or model-type changes.

---

## 11. Round-trip verify (post-push)

Step 8 of the skill. Re-fetch the form just pushed and diff against the markup we sent:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  > /tmp/form-after.json
```

Then in Node:

```js
const sent = JSON.parse(fs.readFileSync('/tmp/form-sent.json', 'utf8'));
const after = JSON.parse(JSON.parse(fs.readFileSync('/tmp/form-after.json', 'utf8')).result.markup);
// Walk both trees in component-id order; surface any property whose value differs.
```

For anonymous forms, also confirm the envelope: re-fetch via `GetByName` and assert `result.access === 5`. The `Create` endpoint may not honor `access` on initial create; on mismatch, call `UpdateMarkup` once more with `access: 5, permissions: []` and re-verify.

Common server normalizations to ignore (not bugs): re-ordered keys inside an object, whitespace inside string-encoded `stylingBox` values, `null` → `undefined` collapsing on optional fields. Anything else — surface to the user.

---

## 12. Browser smoke via the playwright skill

Step 9 of the skill. Invoke as:

```
Skill(skill="playwright", args="<directive>")
```

### Directive template

> Open `<FRONTEND_URL>/<no-auth|dynamic>/<MODULE>/<FORM_NAME>` in a fresh browser context.
> If path is `/dynamic/...`: first POST `/api/TokenAuth/Authenticate` with `admin`/`123qwe` and set the resulting token in `localStorage.accessToken` before navigating.
> Wait for the form to render (selector `.sha-form` or 5s timeout, whichever comes first).
> Capture: full-page screenshot, all console messages with level `error` or `warning`, all network responses with `status >= 400`.
> Then click the primary action button (if any) and capture again.
> Report: a one-paragraph summary, the screenshot path, and any captured errors / 4xx-5xx network responses verbatim.

### Frontend URL detection

The PBF project has two front-end apps:
- `adminportal/` — typical dev port `http://localhost:3000`
- `publicportal/` — typical dev port `http://localhost:3001`

Read the actual port from `<app>/.env*` (e.g. `PORT=3001`) or `<app>/package.json` `scripts.dev`. Anonymous forms (`access: 5`) usually live in `publicportal`; authenticated forms in `adminportal`. If neither is running, skip the smoke step and warn the user.

### Failure handling

Any captured error → consult [debug.md](debug.md) before guessing. Never silently re-edit and re-push. If the smoke step itself errors out (browser can't connect), warn the user and offer to skip via `--no-browser`.
