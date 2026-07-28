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

> **Credentials are never hardcoded.** They come from the task context, else `SHESHA_USER`/`SHESHA_PASSWORD`.
> For a throwaway local backend only, `--local-dev-insecure-defaults` opts the scripts into the
> well-known local-dev pair (`admin`/`123qwe`) — never use it against a shared or hosted backend.

**PowerShell (Windows — preferred). Writes the token BOM-free; a BOM breaks downstream `Bearer` auth.**

```powershell
$tokenFile = "$WORKDIR/access-token"
if (-not (Test-Path $tokenFile) -or -not (Get-Item $tokenFile).Length) {
  $auth  = Invoke-RestMethod -Method Post -Uri "$BASE_URL/api/TokenAuth/Authenticate" `
             -ContentType "application/json" `
             -Body (@{ userNameOrEmailAddress = $env:SHESHA_USER; password = $env:SHESHA_PASSWORD } | ConvertTo-Json -Compress)
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
    -d "$(node -e 'console.log(JSON.stringify({userNameOrEmailAddress:process.env.SHESHA_USER,password:process.env.SHESHA_PASSWORD}))')" \
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

## 5–7. Pushing markup

**Do not issue these by hand.** `scripts/apply-form.mjs` performs the whole mutation —
stage, gates, prior-markup snapshot, push, re-fetch, canonical diff, render, evidence bundle
and ledger entry — and it is the only writer of the ledger the Stop hook verifies [R-046].
The routes and DTOs are recorded here so its behaviour is legible, not so you can replicate it.

| Route | Method | DTO | Notes |
|---|---|---|---|
| `Shesha/FormConfiguration/UpdateMarkup` | PUT | `{ id, markup?, access?, permissions? }` | existing form. **Returns `void`** — HTTP 200 with `result: null` proves only that the request was accepted [R-047] |
| `Shesha/FormConfiguration/Create` | POST | `{ moduleId, name, label?, modelType?, generationLogicTypeName? }` | new form. `modelType` is the entity full-name **STRING** — see the trap below |
| `Shesha/FormConfiguration/ImportJson` | POST (multipart) | `{ ItemId, file }` | only to mimic the designer's "upload JSON" button. Field name must be lowercase `file` |

`markup` is the **stringified** form JSON. Build the body in Node — escaping nested
JSON-in-JSON by hand in a shell is a footgun.

> **`modelType` TRAP — two shapes, one key name.** The Create/Update ENVELOPE takes
> `modelType` as the entity's full class name **string** (`"Shesha.Domain.Site"`). Inside the
> markup, `formSettings.modelType` is the `{ name, module }` **object** [R-016]. Passing the
> object into the envelope returns HTTP 400 `Unexpected character encountered while parsing
> value: {. Path 'modelType'`. `apply-form.mjs` derives the envelope value from a
> `dataContext` node's `entityType`; verified live 2026-07-28.

On error ABP returns `{ success: false, error: { code, message, details } }` — surface
`error.message` and `error.details` and stop.

To resolve `moduleId`, query `GET /api/services/Shesha/Module/GetAll` and pick by `name`.

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

## 10. Entity metadata + reference lists — one probe

`scripts/backend-probe.mjs` replaces the ~10 round-trips a build otherwise makes (module id,
EntityConfig resolve, metadata routes with their 404 retries, one reflist check per bound
prop). Prefer it; it also writes the `<Entity>.probe.json` snapshot the compiler reads.

```bash
# spec.json: { "module": "<Mod>", "entities": [ { "name": "Site", "reflistProps": ["siteType"] } ] }
node scripts/backend-probe.mjs "$BASE_URL" "$WORKDIR/access-token" "$WORKDIR/spec.json"
```

Exit 0 = ready. Exit 1 lists each blocker with the skill that fixes it. It reuses the cached
token (§2), BOM-stripped, and a single non-2xx never throws — the status is recorded and the
run continues.

**The routes it uses, and why that order matters:**

- **Metadata**, tried until a 200 property array: `app/Metadata/GetProperties` (direct array,
  scoped — preferred) → `app/Metadata/Get` (ABP envelope, `result.properties[]`) →
  `Shesha/Metadata/Get`. A 404 on all three *while EntityConfig has the class* is a
  wrong-route/namespace problem, reported as `metadataUnavailable` — **never** as
  `entityMissing`, so it cannot trigger a bogus "create the entity".
- **Dynamic CRUD**: `/api/dynamic/<entityModule>/<Entity>/Crud/GetAll`. Keyed on the
  **entity's** module, not the form's — using the form's module 404s for any entity defined
  elsewhere.
- **Reference lists**: `app/ConfigurationItem/GetCurrent?itemType=reference-list` — reflists
  are configuration items on 0.45, and this is the route the renderer itself uses.
  `app/ReferenceList/GetByName` **404s on this generation** and is only a legacy fallback;
  probing it alone reports every reflist-bound property as missing. There is no
  `ReferenceList/GetItems`.

**Service prefixes are not interchangeable** [R-026]. These live under `app` —
`Metadata/*`, `EntityConfig/*`, `Module/*`, `ConfigurationItem/*` — while form configuration
lives under `Shesha` (`Shesha/FormConfiguration/*`). Guessing the prefix produces a 404 that
looks exactly like a missing entity, which is the wrong diagnosis and sends you to
`domain-model` for nothing.

A reflist that exists with **zero items** is still a blocker: the dropdown renders blank at
runtime and passes every structural check [R-015]. Both cases hand off to
`shesha-developer:domain-model`.

Property shape (the fields that matter): `{ path, name, label, dataType, required, readOnly,
referenceListName, referenceListModule, entityType }`. `path` is camelCase in metadata for
some builds and PascalCase in others — form `propertyName` must be camelCase either way.

**Never read a raw metadata response inline** — a full entity can exceed the `Read` limit.
Pipe to a file, then distil with `scripts/summarize.js --type metadata`.

---

## 11. Round-trip verify

Runs inside `scripts/apply-form.mjs`: re-fetch and canonically diff against what was sent.
A 200 alone proves nothing [R-047]; the re-fetch is the only proof.

Server normalizations that are **not** differences (the canonical diff absorbs them): key
re-ordering inside an object, whitespace inside string-encoded `stylingBox` values, and
`null` → `undefined` on optional fields. Anything else is a real diff and fails the apply.

For anonymous forms also assert the envelope — re-fetch via `GetByName` and check
`result.access === 5`. `Create` may not honour `access` on initial create; if it did not,
`UpdateMarkup` once more with `access: 5, permissions: []` and re-verify [R-022].

---

## 12. Browser smoke

`scripts/render-instrument.js --form <module>/<name>` — run inside `apply-form.mjs`. It
navigates, waits for settle, probes geometry, screenshots, and dumps console + network
errors, writing a verdict JSON and a PNG to the session workdir.

**Render against the `adminportal`** — that is the app UI this skill targets (typical dev
port 3000; read the real port from `adminportal/.env*` or its `package.json` `scripts.dev`).
`publicportal` (typical 3001) is the exception, used **only** for a genuinely anonymous form
(`access: 5` — login/register/OTP), never for ordinary CRUD.

Authenticated forms load at `/dynamic/<module>/<form>?mode=edit` — **without `mode=edit` the
dynamic page renders read-only**, so inputs are absent and every style probe reads as a false
no-op. The instrument sets the cached session token into `localStorage.accessToken` rather
than re-authenticating.

If the adminportal is not running, do **not** silently pass: the evidence bundle records
`pushed-unrendered`, which the Stop hook treats as not delivered. Report it that way.

Any captured error → [debug.md](debug.md) before guessing. Never silently re-edit and re-push.
