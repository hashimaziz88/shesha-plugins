# Shesha API — Authentication and Form Fetch

Used by Step 2 of the `clean-form-config` skill to fetch a form configuration directly from a running Shesha backend.

---

## 1. Resolve the base URL

Check these sources in order, stopping at the first match:

1. `.env` in the project root — look for `NEXT_PUBLIC_BASE_URL`, `REACT_APP_BASE_URL`, or `BASE_URL`.
2. `appsettings.json` in the backend project — look for `Kestrel:Endpoints:Http:Url`.
3. Ask the user:
   > What is the base URL for your Shesha backend? (e.g. `http://localhost:21021`)

Strip any trailing slash from the resolved URL. Store as `BASE_URL`.

---

## 2. Authenticate

Ask the user:

> Please enter your Shesha username (or email) and password to fetch the form via the API.
> Leave blank to provide a local file path instead.

If the user leaves credentials blank → skip to Option B in Step 2 of `SKILL.md`.

If credentials are provided, run:

```bash
curl -s -X POST "{BASE_URL}/api/TokenAuth/Authenticate" \
  -H "Content-Type: application/json" \
  -d "{\"userNameOrEmailAddress\":\"{USERNAME}\",\"password\":\"{PASSWORD}\"}"
```

The response shape is:

```json
{
  "accessToken": "eyJ...",
  "encryptedAccessToken": "...",
  "expireInSeconds": 86400,
  "expireOn": "2026-03-10T13:00:00.000Z",
  "userId": 1,
  "personId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "resultType": 1
}
```

Extract `accessToken` and store it as `ACCESS_TOKEN`.

If the response has no `accessToken`, or `curl` returns a non-zero exit code, show the raw response to the user and fall back to Option B (local file path).

---

## 3. Fetch form by module + name

Ask the user:

> Enter the form **module** name and **form** name.
> (e.g. module: `Shesha`, name: `user-create`)

```bash
curl -s -G "{BASE_URL}/api/services/Shesha/FormConfiguration/GetByName" \
  --data-urlencode "module={MODULE}" \
  --data-urlencode "name={NAME}" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

The response shape is:

```json
{
  "result": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "module": { "name": "Shesha" },
    "name": "user-create",
    "markup": "{...}"
  }
}
```

Extract `result.id` and store it as `FORM_ID`. If the call fails or `result` is absent, show the error and stop.

---

## 4. Fetch the form JSON

```bash
curl -s -G "{BASE_URL}/api/services/Shesha/FormConfiguration/GetJson" \
  --data-urlencode "id={FORM_ID}" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

The response body is the raw form JSON string (same shapes as the normalisation table in [analysis.md § Normalisation](analysis.md#normalisation)). Parse and normalise to `{ components, formSettings }` using the normalisation table in [analysis.md](analysis.md) before proceeding to Step 3.

---

## 5. Push cleaned config to the backend (ImportJson)

Used by Step 9 of the `clean-form-config` skill. `ACCESS_TOKEN` must already be set (from sections 2–4 above, or collected fresh for local-file flows).

> **⚠️ 0.43 forms are versioned ConfigurationItems.** On 0.43 you must **NOT** push cleaned markup directly onto the resolved (Live) form id — that would overwrite a published version in place. You must first resolve the version state of the target form and, when it is Live, branch to a new Draft before writing. The full, authoritative algorithm (status enum, endpoints, edit branching, invariants, failure recovery, version-aware verification) lives in [version lifecycle](../shesha-form-edit/references/version-lifecycle.md). Read it before pushing. The steps below are the clean-form-config-specific application of that algorithm.

### 5a. Resolve the target version and pick the write id

`FORM_ID` from section 3 is the resolved **latest/Live** id. Before writing, resolve its version state (`id`, `versionNo`, `versionStatus`, `origin`) — GetByName / GetById returns these fields. Then branch (see the [Edit algorithm](../shesha-form-edit/references/version-lifecycle.md#edit-algorithm)):

- **Live (versionStatus == 3)** → call `CreateNewVersion` once (body `{ "id": "{FORM_ID}" }`); it returns a **new Draft** id. Set `WRITE_ID` to that new Draft id. **Never write to the Live id.**
- **Draft (1) / Ready (2) in flight** → reuse the newest non-Live version; set `WRITE_ID` to that in-flight version's id (do NOT create another version).
- **Retired (5) / Cancelled (4)** → never edit a terminal version; resolve to the latest non-terminal version first, then apply the rules above.

```bash
# Only when the resolved version is Live (versionStatus == 3):
curl -s -X POST "{BASE_URL}/api/services/Shesha/FormConfiguration/CreateNewVersion" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"{FORM_ID}\"}"
# → response.result.id is the new Draft id → use it as WRITE_ID
```

**Invariant:** call `CreateNewVersion` **at most once** per edit session. If the verify/fix loop (Step 4) needs to re-push, target the **same** `WRITE_ID` Draft again — do not create a second version.

### 5b. Write the cleaned markup to WRITE_ID

Write the cleaned config to a temp file and build the request body via Node to avoid shell-escaping issues:

```bash
# Write cleaned JSON to temp file first (replace /tmp/cleaned-form.json with the actual output path)
node -e "
const fs = require('fs');
const markup = fs.readFileSync('/tmp/cleaned-form.json', 'utf8');
const body = JSON.stringify({ itemId: '{WRITE_ID}', markup });
fs.writeFileSync('/tmp/import-body.json', body);
"

curl -s -X POST "{BASE_URL}/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/import-body.json
```

A successful response looks like:

```json
{ "result": true }
```

If the call fails (non-200 status, `result` is `false`, or an `error` key is present), show the raw response to the user and stop — do **not** retry automatically.

### 5c. Publish the Draft (Draft → Ready → Live)

Once the markup is written and all clean-form-config gates pass, promote `WRITE_ID` through the lifecycle so the cleaned version becomes Live (this auto-retires the previous Live version). Publish **once**:

```bash
# Draft(1) → Ready(2)
curl -s -X PUT "{BASE_URL}/api/services/Shesha/FormConfiguration/UpdateStatus" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":\"[\\\"=\\\",[\\\"id\\\"],\\\"{WRITE_ID}\\\"]\",\"status\":2}"

# Ready(2) → Live(3)  (auto-retires the prior Live version)
curl -s -X PUT "{BASE_URL}/api/services/Shesha/FormConfiguration/UpdateStatus" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":\"[\\\"=\\\",[\\\"id\\\"],\\\"{WRITE_ID}\\\"]\",\"status\":3}"
```

If `UpdateStatus` fails after a good `ImportJson`, the Draft exists but is unpublished — **retry UpdateStatus** (never re-run `CreateNewVersion`); on abort you may `CancelVersion` the orphan Draft. See [Failure recovery](../shesha-form-edit/references/version-lifecycle.md#failure-recovery).

### 5d. Verify and confirm

Verify against the **published** id, not the pre-edit `FORM_ID`: GetByName-latest must now return `versionStatus == 3` with the new `versionNo`, and the previous Live must now be `Retired (5)`. See [Version-aware verification](../shesha-form-edit/references/version-lifecycle.md#version-aware-verification). Then clear the browser IndexedDB caches (`forms`/`entities`/`ref-lists`/`misc`) so the cleaned form is served fresh rather than stale.

On success, confirm:

> Cleaned form config pushed and published as a new version to `{BASE_URL}` (origin `{ORIGIN}`, new version `{WRITE_ID}`); the previous Live version has been retired.
