---
name: shesha-api-finder-in-forms
description: Finds all Shesha form configurations that reference a specified API endpoint. Fetches every form from the Shesha backend, scans each form's raw markup string and structured component tree, and returns a table of matching forms. Triggers: "find this api", "where this api used", "form with this api".
allowedTools:
  - Read
  - Glob
  - Grep
  - WebFetch
  - PowerShell
  - ToolSearch
---

# Find Forms with this API

Accepts an API path pattern and returns every Shesha form configuration whose markup references it — checking `formSettings` URLs and every component property that can hold an API path.

## Instructions

### Step 1 — Collect inputs

- **API path** to search for (e.g. `/api/services/app/Person/GetList`).  
  If not supplied, ask the user before continuing.
- **Backend base URL** — default `http://localhost:21021`.  
  Ask the user to confirm if they are targeting a different environment.
- **Credentials** — ask the user for their username and password if not already provided.

---

### Step 2 — Authenticate

Use PowerShell `Invoke-RestMethod` to POST:

```
POST {baseUrl}/api/TokenAuth/Authenticate
Content-Type: application/json

{ "usernameOrEmailAddress": "{username}", "password": "{password}" }
```

Extract `result.accessToken` from the JSON response body.  
If the call fails or the token is absent, stop and report the authentication error.

---

### Step 3 — Fetch all form configurations (latest versions only)

Use PowerShell `Invoke-RestMethod` with pagination. The filter restricts results to **latest versions** (`isLast = true`) of **non-template** forms (`isTemplate = false`) — each form has one matching record.

Filter (JSON Logic, URL-encode when embedding in the query string):
```json
{"and":[{"and":[{"==":[{"var":"isLast"},true]}]},{"and":[{"==":[{"var":"isTemplate"},false]}]}]}
```

Request per page:
```
GET {baseUrl}/api/services/Shesha/FormConfiguration/GetAll
  ?maxResultCount=500
  &skipCount={skip}
  &filter=%7B%22and%22%3A%5B%7B%22and%22%3A%5B%7B%22%3D%3D%22%3A%5B%7B%22var%22%3A%22isLast%22%7D%2Ctrue%5D%7D%5D%7D%2C%7B%22and%22%3A%5B%7B%22%3D%3D%22%3A%5B%7B%22var%22%3A%22isTemplate%22%7D%2Cfalse%5D%7D%5D%7D%5D%7D
Authorization: Bearer {accessToken}
```

Response shape:
```json
{
  "result": {
    "totalCount": 120,
    "items": [
      {
        "id": "...",
        "name": "person-details",
        "module": { "name": "My Module" },
        "label": "Person Details",
        "markup": "{...json string...}"
      }
    ]
  }
}
```

- Read `totalCount` from the first page response.
- Page through with `skipCount=500`, `skipCount=1000`, etc. until all forms are retrieved.
- Collect the full list before proceeding to step 4.

---

### Step 4 — Scan each form's markup

For **every** form in the list:

**4a. Pre-filter with string search (fast)**  
Treat the raw `markup` string as plain text. Do a **case-insensitive substring search** for the API path. Skip forms where the path does not appear at all. This avoids parsing every form's component tree.

**4b. Structured scan on matching forms**  
Parse the markup JSON (it is a JSON string). The top-level object contains two areas to check:

1. **`formSettings` object** — check these properties:
   - `getUrl`, `postUrl`, `putUrl`, `deleteUrl`

2. **`components` array** — recursively walk every component object and check these string properties:
   - `url`, `getUrl`, `postUrl`, `putUrl`, `deleteUrl`
   - `dataSourceUrl`, `autocompleteUrl`, `listUrl`, `updateUrl`, `createUrl`
   - `endpoint`, `apiPath`
   
   For each matching component, note its `type` (e.g. `subForm`, `dataTable`, `entityPicker`) and `label`.

Record all match locations for the form (there may be more than one).

---

### Step 5 — Present results

Output a markdown table:

| Module | Form Name | Label | Match Location | Matched Value |
|--------|-----------|-------|----------------|---------------|
| My Module | person-details | Person Details | `formSettings.getUrl` | `/api/services/app/Person/Get` |
| My Module | person-list | Persons | `dataTable [Persons List] → url` | `/api/services/app/Person/GetList` |

- If a form has multiple matches, add one row per match location.
- If **no** forms match, say so clearly.
- At the bottom, always state: `Scanned {N} forms total. Found {M} form(s) with {count} match(es).`

---

## Notes

- Partial path matching is intentional: searching `/Person` will match both `/api/services/app/Person/Get` and `/api/services/app/Person/GetList`. If the user wants an exact match, they should include the full path.
- Forms where `markup` is `null`, `""`, or not valid JSON should be skipped silently.
- Some forms store components as a nested tree via a `components` property on each component (not just at the top level) — walk those recursively.
- If the API returns 401 at any point, re-authenticate (step 2) and retry once.
- Do **not** modify any form data — this is a read-only scan.

---

Now search for all forms that reference: 
