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

**Do not ask the user for credentials.** This skill is a mandatory blocking step inside
`shesha-spec`'s push path, which is frequently headless — an interactive prompt here
dead-ends the entire run.

Resolve in this order:

1. A token or credentials supplied in the dispatch context / already held by the caller.
2. `SHESHA_BACKEND_URL` + the local-dev default `admin` / `123qwe`.
3. If neither resolves, fall back to Option B in Step 2 of `SKILL.md` (operate on a local file)
   and say so in the report — do not block.

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

Used by Step 9 of the `clean-form-config` skill. `FORM_ID` and `ACCESS_TOKEN` must already be set (from sections 2–4 above, or collected fresh for local-file flows).

Write the cleaned config to a temp file and build the request body via Node to avoid shell-escaping issues:

```bash
# Write cleaned JSON to temp file first (replace $RUN_DIR/staged/cleaned-form.json with the actual output path)
node -e "
const fs = require('fs');
const markup = fs.readFileSync('$RUN_DIR/staged/cleaned-form.json', 'utf8');
const body = JSON.stringify({ itemId: '{FORM_ID}', markup });
fs.writeFileSync('$RUN_DIR/staged/import-body.json', body);
"

curl -s -X POST "{BASE_URL}/api/services/Shesha/FormConfiguration/ImportJson" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @$RUN_DIR/staged/import-body.json
```

A successful response looks like:

```json
{ "result": true }
```

If the call fails (non-200 status, `result` is `false`, or an `error` key is present), show the raw response to the user and stop — do **not** retry automatically.

On success, confirm:

> Form config successfully pushed to `{BASE_URL}` for form `{FORM_ID}`.
