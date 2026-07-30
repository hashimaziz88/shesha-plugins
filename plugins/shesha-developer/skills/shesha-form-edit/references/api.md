# Shesha Form API — Recipes

## Conventions (read once, apply to every recipe below)

- **Pin one shell/tool for the whole session and dispatch every command to it.** This is a **tool-selection** rule, not just a syntax rule: on Windows run **every** command through the **PowerShell tool** (never the Bash tool); on Linux/macOS/WSL use bash. Shell state does not persist between calls, so re-affirm the pinned tool on each command. A PowerShell one-liner sent to the Bash tool fails with `=: command not found` / `New-Item: command not found` (exit 127) — the exact recurring failure this rule prevents. **On Windows, prefer the PowerShell forms below** (a PowerShell block is given for auth §2); the bash `$VAR` forms are the Linux fallback. Do not transpile a bash recipe into the Bash tool on Windows.
- **No `jq`.** It is absent on a default Windows box (exit 127). Parse JSON with `node -e` (shown below) or PowerShell's `ConvertFrom-Json`.
- **One session scratch dir.** Set `$WORKDIR` once — `$env:TEMP/shesha-form-edit` (PowerShell) or `${TMPDIR:-/tmp}/shesha-form-edit` (bash) — and create it. All temp request/response files below live under `$WORKDIR`. **Never hardcode `/tmp`** — it doesn't exist on Windows. When invoked by the `shesha-claude-designer` orchestrator, use the `<workdir>` it supplies so the token/metadata caches are shared across screens.
- **`$BASE_URL` and the access token** are resolved once (Steps 1–2 of the skill). Read the token from its cache file on each call (see §2) — never paste the raw JWT literally.

---

## 1. Resolve base URL

Order of precedence:

1. `src/PBF.MembershipManagement.Web.Host/Properties/launchSettings.json` → `profiles.Project.applicationUrl`
2. `src/PBF.MembershipManagement.Web.Host/appsettings.json` → `Kestrel:Endpoints:Http:Url`
3. Fallback: `http://localhost:21021`

Strip trailing slash.

---

## 2. Authenticate (once per session, then cache)

**Authenticate a single time and cache the token to `$WORKDIR/access-token`; reuse it on every subsequent call.** Re-authenticate only on a `401` or after the 24 h TTL. Never re-POST `Authenticate` per API call, and never inline the raw ~600-char JWT into a command — it echoes back into context on every result.

**PowerShell (Windows — preferred). Writes the token BOM-free; a BOM breaks downstream `Bearer` auth.**

```powershell
$tokenFile = "$WORKDIR/access-token"
if (-not (Test-Path $tokenFile) -or -not (Get-Item $tokenFile).Length) {
  $auth  = Invoke-RestMethod -Method Post -Uri "$BASE_URL/api/TokenAuth/Authenticate" `
             -ContentType "application/json" `
             -Body '{"userNameOrEmailAddress":"admin","password":"123qwe"}'
  $token = if ($auth.result.accessToken) { $auth.result.accessToken } else { $auth.accessToken }
  if (-not $token) { $auth | ConvertTo-Json -Depth 6; throw "auth failed" }
  # A JWT is pure ASCII — write WITHOUT a BOM and without a trailing newline.
  # ('Set-Content -Encoding utf8' / 'Out-File' add a BOM → 'Authorization: Bearer ﻿eyJ…' → "Current user did not login".)
  [System.IO.File]::WriteAllText($tokenFile, $token, (New-Object System.Text.UTF8Encoding $false))
}
```

**bash (Linux/macOS/WSL fallback).** Node's `fs.writeFileSync` is BOM-free on any shell:

```bash
# Cache-first: only authenticate if we don't already have a token this session.
if [ ! -s "$WORKDIR/access-token" ]; then
  curl -s -X POST "$BASE_URL/api/TokenAuth/Authenticate" \
    -H "Content-Type: application/json" \
    -d '{"userNameOrEmailAddress":"admin","password":"123qwe"}' \
    -o "$WORKDIR/auth.json"
  # Extract the token with node (no jq); handles both envelope and root shapes.
  node -e "const r=require('$WORKDIR/auth.json');const t=(r.result&&r.result.accessToken)||r.accessToken;if(!t){console.error(JSON.stringify(r));process.exit(1)}require('fs').writeFileSync('$WORKDIR/access-token',t)"
fi
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

The `node` extractor above already handles both the ABP envelope (`result.accessToken`) and the older root shape (`accessToken`). If it prints the raw response and exits non-zero, both were null — the credentials are wrong (or the user is locked); surface that response and stop.

**Every recipe below** starts by loading the cached token into `$ACCESS_TOKEN` (shell state doesn't persist between calls, so re-load it per command) — this references the file, never the literal JWT:

```bash
# PowerShell: $ACCESS_TOKEN = (Get-Content "$WORKDIR/access-token" -Raw).Trim()
# bash — strip any stray BOM + newline so it can never poison the header:
ACCESS_TOKEN=$(cat "$WORKDIR/access-token" | sed 's/^\xEF\xBB\xBF//' | tr -d '\r\n')
```

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
  -o "$WORKDIR/form-current.json"
```

This endpoint returns the **raw markup as a file download** (`application/json` with `Content-Disposition: attachment`). The file content **is** the form JSON (already parsed as an object — no string wrapping). Read it with `JSON.parse`.

If you need the wrapping DTO (with id, name, modelType etc.) instead, use `Get` — `GET /api/services/Shesha/FormConfiguration/Get?id=$FORM_ID` — which returns the ABP envelope.

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
const dir = process.env.WORKDIR;
const tree = JSON.parse(fs.readFileSync(dir + '/form-edited.json', 'utf8'));
const body = JSON.stringify({
  id: process.env.FORM_ID,
  markup: JSON.stringify(tree)
});
fs.writeFileSync(dir + '/update-markup-body.json', body);
" 

curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$WORKDIR/update-markup-body.json"
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
# $WORKDIR/form-edited.json contains the stringified-or-tree form JSON.
# If your edits are an object (parsed tree), stringify first; the API expects the file content
# to be a JSON document representing the form markup.

curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "ItemId=$FORM_ID" \
  -F "file=@$WORKDIR/form-edited.json;type=application/json"
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

## 10. Fetch entity metadata (scoped — `GetProperties`)

Used by `SKILL.md`'s **1 · Pre-flight** entity-binding gate to validate `propertyName` references against the actual entity. **Prefer the scoped `GetProperties` endpoint** (returns a direct array of the entity's properties, no envelope) over any full-metadata / `GetAll` dump — fetch exactly the container you need, once per entity, and reuse the cached summary.

**Never read the raw metadata response inline** — a full entity's properties can exceed the 25k-token `Read` limit and force a retry with offsets. Always pipe it straight to a file (`-o`), distill, and read only the `.summary.md`.

```bash
# Scoped, primary — direct array of properties. Pipe to file; do not read inline.
curl -s -G "$BASE_URL/api/services/app/Metadata/GetProperties" \
  --data-urlencode "container=PBF.MembershipManagement.Domain.Domain.Member" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o ".claude/cache/shesha-form-edit/metadata/Member.raw.json"
```

If `GetProperties` 404s on an older build, fall back to the fuller container fetch `GET /api/services/app/Metadata/Get` (ABP envelope, `result.properties[]`), then `Shesha/Metadata/Get` — same `-o`-to-file discipline; distill before reading.

Property shape (relevant fields). `GetProperties` returns this as a **direct array**; the `Metadata/Get` fallback wraps it in the ABP envelope shown here (`result.properties[]`):

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

## 10.5 Verify a reference list exists + has items

For every reflist-bound component, confirm the list is real and populated **before** push — a dropdown bound to a missing or empty reflist renders blank at runtime and passes every structural check [R-015]. Reflists are fetched as configuration items (this is the route `scripts/resolve-bindings.js` uses; there is **no** `ReferenceList/GetByName` or `ReferenceList/GetItems` service on this backend generation). Use the property's metadata `referenceListName` (full dotted) + `referenceListModule`:

```bash
curl -s -G "$BASE_URL/api/services/app/ConfigurationItem/GetCurrent" \
  --data-urlencode "itemType=reference-list" \
  --data-urlencode "name=<referenceListName>" \
  --data-urlencode "module=<referenceListModule>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

- `404` / null `result` → the reflist does **not exist** (the `[ReferenceList]` attribute is missing, or the name was guessed). Do NOT ship the component — hand off to `shesha-developer:domain-model`.
- `result.items` empty → the list exists but has **no items**; the dropdown will be empty. Same handoff.
- The route is under `app`, not `Shesha` [R-026].

---

## 10.6 Combined one-shot backend probe

A form build otherwise fires ~10 tiny round-trips — the module-id lookup (§7), the per-entity `EntityConfig` resolve (§10 / `SKILL.md`'s **1 · Pre-flight** entity-binding gate), each metadata route (§10, often with 404 retries), and one reflist existence check per reflist-bound prop (§10.5). `scripts/backend-probe.mjs` **replaces all of them with a single run** (module id + entity resolve + metadata + reflist existence, per entity), so prefer it over issuing those calls separately.

```bash
# spec.json: { "module": "<Mod>", "entities": [ { "name": "ShortlistResult", "reflistProps": ["outcome","status"] } ] }
node scripts/backend-probe.mjs "$BASE_URL" "$WORKDIR/access-token" "$WORKDIR/probe-spec.json"
```

It reuses the **cached** token file (§2) — strips a leading BOM + trims it, so the same BOM that would break `Bearer` auth can't leak in. One run does, per spec entity:

- `GET app/Module/GetAll?MaxResultCount=200` → resolves `spec.module` → id.
- `GET app/EntityConfig/GetMainDataList?maxResultCount=1000` **once** → each entity's `{ name, module, fullClassName }`.
- Metadata routes tried **in order until a 200 property array**: `app/Metadata/GetProperties` → `app/Metadata/Get` (`result.properties[]`) → `Shesha/Metadata/Get`; records which route worked. A 404 on all three while EntityConfig *has* the class is wrong-route/namespace → reported as `metadataUnavailable`, **not** `entityMissing` (never triggers a bogus `domain-model` "create").
- Each named `reflistProp` → reads its `referenceListName`/`referenceListModule` from the metadata, then the §10.5 reflist existence check → `{ exists, itemCount }`.

Emits ONE compact JSON summary to stdout (per entity: `modelType`, `fullClassName`, metadata route or `metadataUnavailable`, a distilled `properties[]` of `{ path, dataType, referenceListName }`, and per-reflistProp `{ name, module, exists, itemCount }`) and writes each entity's slice to `<tokenFile dir>/<Entity>.probe.json` for reuse. A single 404 (or any non-2xx / network error) never throws — the status is recorded and the run continues.

---

## 11. Round-trip verify (post-push)

The re-fetch + diff layer of `SKILL.md`'s **6 · Push + Oracle**. Re-fetch the form just pushed and diff against the markup we sent:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id=$FORM_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  > "$WORKDIR/form-after.json"
```

Then in Node:

```js
const sent = JSON.parse(fs.readFileSync(process.env.WORKDIR + '/form-sent.json', 'utf8'));
const after = JSON.parse(JSON.parse(fs.readFileSync(process.env.WORKDIR + '/form-after.json', 'utf8')).result.markup);
// Walk both trees in component-id order; surface any property whose value differs.
```

For anonymous forms, also confirm the envelope: re-fetch via `GetByName` and assert `result.access === 5`. The `Create` endpoint may not honor `access` on initial create; on mismatch, call `UpdateMarkup` once more with `access: 5, permissions: []` and re-verify.

Common server normalizations to ignore (not bugs): re-ordered keys inside an object, whitespace inside string-encoded `stylingBox` values, `null` → `undefined` collapsing on optional fields. Anything else — surface to the user.

---

## 12. Browser smoke via the playwright skill

The render-instrument / browser-verification layer of `SKILL.md`'s **6 · Push + Oracle**. Invoke as:

```
Skill(skill="playwright", args="<directive>")
```

### Directive template

> Open `<FRONTEND_URL>/<no-auth|dynamic>/<MODULE>/<FORM_NAME>` in a fresh browser context.
> If path is `/dynamic/...`: set the **cached** session token (contents of `$WORKDIR/access-token`) into `localStorage.accessToken` before navigating. Only POST `/api/TokenAuth/Authenticate` with `admin`/`123qwe` if no cached token exists.
> Wait for the form to render (selector `.sha-form` or 5s timeout, whichever comes first).
> Capture: full-page screenshot, all console messages with level `error` or `warning`, all network responses with `status >= 400`.
> Then click the primary action button (if any) and capture again.
> Report: a one-paragraph summary, the screenshot path, and any captured errors / 4xx-5xx network responses verbatim.

### Frontend URL detection — focus on the `adminportal`

**Render and verify against the `adminportal` — that is the app UI this skill targets.** It's the front-end app under `adminportal/` (typical dev port `http://localhost:3000`); read the actual port from `adminportal/.env*` (e.g. `PORT=3000`) or `adminportal/package.json` `scripts.dev`. Use it as `<FRONTEND_URL>` for every authenticated (`/dynamic/...`) form.

`publicportal/` (typical `http://localhost:3001`) is the **exception, not the default** — use it ONLY for a genuinely anonymous/public form (`access: 5`, e.g. login/register/OTP). Don't reach for it for ordinary CRUD forms.

If the adminportal isn't running, do NOT silently pass: report that the form **could not be visually verified (adminportal not running)** and offer `--no-browser`.

### Failure handling

Any captured error → consult [debug.md](debug.md) before guessing. Never silently re-edit and re-push. If the smoke step itself errors out (browser can't connect), warn the user and offer to skip via `--no-browser`.
