# Form version lifecycle (0.43) — the single source of truth

On BoxStack **0.43.x** a form configuration is a **versioned ConfigurationItem**, not a mutable blob.
Every form has an `Origin` (the stable identity shared across versions), a `versionNo` (integer,
incrementing), and a `versionStatus` (the lifecycle state). Editing a **Live** form is NOT a
"PUT it back in place" — you **clone to a new Draft, edit the Draft, then publish it**, which
auto-retires the previous Live version and preserves history.

This file is the authoritative reference for that flow. `SKILL.md` (Steps 3, 7, 8) and any
component doc that mentions pushing/publishing should LINK here rather than re-deriving the algorithm.

All curl recipes assume `$BASE_URL` and `$ACCESS_TOKEN` are set (see [api.md §2](api.md) for auth).
On Windows, substitute `$env:BASE_URL`/`$env:ACCESS_TOKEN` (PowerShell) or `%BASE_URL%`/`%ACCESS_TOKEN%` (cmd).
Endpoints live under `$BASE_URL/api/services/Shesha/FormConfiguration/`.

---

## Status enum

`versionStatus` is an integer. The 0.43 values:

| value | status | meaning | editable? |
|---|---|---|---|
| 1 | Draft | in-flight, not yet published | **yes** — edit this |
| 2 | Ready | reviewed, queued to go Live | **yes** — still editable, publish when gates pass |
| 3 | Live | the published version end-users resolve | **no** — never edit in place; CreateNewVersion first |
| 4 | Cancelled | an abandoned Draft | **NEVER** — resolve to latest non-terminal first |
| 5 | Retired | a superseded former Live | **NEVER** — resolve to latest non-terminal first |

Legal transitions (enforced by `UpdateStatus`): **Draft(1) → Ready(2) → Live(3)**. Publishing a
version to Live **auto-retires** the version that was previously Live (it moves to Retired(5)). A Draft
can also be abandoned via `CancelVersion` → Cancelled(4).

---

## Endpoints

All on `$BASE_URL/api/services/Shesha/FormConfiguration/`.

| endpoint | verb | body / query | purpose |
|---|---|---|---|
| `GetByName` | GET | `module`, `name`, optional `version` | Resolves the **latest/Live** version by default; pass `version` to fetch a specific `versionNo`. Includes `versionNo`, `versionStatus`, `markup`. |
| `Get` | GET | `id` | ABP envelope for one specific version id — carries `versionNo`, `versionStatus`. |
| `GetAll` | GET | `Filter`, `MaxResultCount` | List versions. Filter `IsLast==true` to get the latest per Origin (finds in-flight Draft/Ready that `GetByName` hides). |
| `CreateNewVersion` | POST | `{ "id": "<current version id>" }` | Clones the given version to a **new Draft** (`versionNo`+1, same `Origin`). Returns the **new version's id**. |
| `UpdateStatus` | PUT | `{ "filter": {...}, "status": <int> }` | Advances a version's status. Validates Draft→Ready→Live; auto-retires the prior Live. |
| `CancelVersion` | POST | `{ "id": "<draft id>" }` | Abandons a Draft → Cancelled(4). |
| `UpdateMarkup` | PUT | `{ "id": "<version id>", "markup": "<stringified JSON>" }` | Writes markup to a **specific version id** (see [api.md §5](api.md)). |
| `ImportJson` | POST | multipart `ItemId` + `file` | Writes markup to a specific version id (see [api.md §6](api.md)). |

> **`UpdateMarkup`/`ImportJson` write to whatever version id you give them.** On 0.43 you must give
> them a **Draft** id — never a Live id. Getting the id wrong is how a Live version gets clobbered
> with no history.

### CreateNewVersion

```bash
# Clone the current Live version (id in $FORM_ID) to a fresh Draft. Returns the NEW draft id.
NEW_ID=$(curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/CreateNewVersion" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$FORM_ID\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.result?.id ?? r.result);})")
echo "New draft id: $NEW_ID"
```

The response is the ABP envelope; the new Draft's id is at `result.id` (some builds return the id
directly as `result`). **All subsequent edits (UpdateMarkup, and any verify/fix loop) target `$NEW_ID`,
never `$FORM_ID`.**

### UpdateStatus (publish Draft → Ready → Live)

`UpdateStatus` takes a **filter** selecting the version and the **target status**. Advance in two hops
(Draft→Ready, then Ready→Live); publishing to Live auto-retires the prior Live.

```bash
publish() {
  local ID="$1" STATUS="$2"
  curl -s -X PUT "$BASE_URL/api/services/Shesha/FormConfiguration/UpdateStatus" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"filter\":\"{\\\"and\\\":[{\\\"==\\\":[{\\\"var\\\":\\\"id\\\"},\\\"$ID\\\"]}]}\",\"status\":$STATUS}"
}

publish "$NEW_ID" 2   # Draft(1) → Ready(2)
publish "$NEW_ID" 3   # Ready(2) → Live(3)  (auto-retires the previous Live)
```

The `filter` value is a **stringified** JSON-logic expression (the same dialect `GetAll` uses).
Filtering by the version `id` is the most precise; you can also filter by `origin.id` + `versionNo`.
Do the two hops as separate calls — some builds reject a Draft→Live jump.

If your build exposes a simpler shape, `{ "id": "<id>", "status": <int> }` is also accepted on some
0.43 releases; prefer the `filter` form and fall back only if it 400s.

### CancelVersion (abandon an orphaned Draft)

```bash
curl -s -X POST "$BASE_URL/api/services/Shesha/FormConfiguration/CancelVersion" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$NEW_ID\"}"
```

Use this only in failure recovery (see below) to clean up a Draft you created but decided not to
publish. It moves the Draft → Cancelled(4). Never cancel a Live/Ready version.

### In-flight-draft lookup (GetAll + IsLast==true)

`GetByName` resolves the latest **Live** version and hides an unpublished Draft/Ready that already
exists for the same Origin. To find whether an edit is already in flight, list the latest version per
Origin with `IsLast==true`:

```bash
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetAll" \
  --data-urlencode "MaxResultCount=50" \
  --data-urlencode 'Filter={"and":[{"==":[{"var":"module.name"},"PBF.MembershipManagement"]},{"==":[{"var":"name"},"member-create"]},{"==":[{"var":"isLast"},true]}]}' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `result.items[]`; each item carries `id`, `versionNo`, `versionStatus`, and its `origin`. If the
`IsLast` item is a Draft(1) or Ready(2), **reuse it** — do NOT `CreateNewVersion` again. If it is Live(3),
you'll `CreateNewVersion` from it. If it is Retired(5)/Cancelled(4) with no newer version, resolve to the
latest non-terminal version before touching anything.

Node helper to resolve the full lifecycle context in one shot:

```js
// RESOLVE: given module+name (or an id), return { id, versionNo, versionStatus, originId }
const fetch = require('node-fetch'); // or built-in fetch on node 18+
const base = process.env.BASE_URL, tok = process.env.ACCESS_TOKEN;
const filter = JSON.stringify({ and: [
  { '==': [{ var: 'module.name' }, process.env.MODULE] },
  { '==': [{ var: 'name' },        process.env.NAME] },
  { '==': [{ var: 'isLast' },      true] },
]});
const url = `${base}/api/services/Shesha/FormConfiguration/GetAll?MaxResultCount=50&Filter=${encodeURIComponent(filter)}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
const { result } = await res.json();
const latest = (result.items || [])[0];
if (!latest) throw new Error('form not found — brand-new: use Create flow');
console.log({ id: latest.id, versionNo: latest.versionNo, versionStatus: latest.versionStatus, originId: latest.origin?.id });
```

---

## Edit algorithm

RESOLVE the current version's `id` + `versionNo` + `versionStatus` + `Origin` (via the in-flight
lookup above, or `GetByName`/`Get`), then **BRANCH on `versionStatus`**:

- **Brand-new form (no version exists — fresh `Create`)**
  1. `Create` the form (see [api.md §7](api.md)) → returns the new Draft's id.
  2. `UpdateMarkup` the initial markup onto that Draft.
  3. `UpdateStatus` 1→2→3 to publish.
  4. Clear the frontend cache (see [Cache clearing](#version-aware-verification)).

- **Live(3)**
  1. `CreateNewVersion { id }` → capture the **new Draft id** (`$NEW_ID`).
  2. `UpdateMarkup` on `$NEW_ID` (the Draft) — **NEVER the Live id**.
  3. Any verify/fix loop edits **this same Draft** (`$NEW_ID`) — do NOT `CreateNewVersion` again.
  4. Once quality gates pass: `UpdateStatus` 1→2→3 (auto-retires the old Live).
  5. Clear the frontend cache.

- **Draft(1) or Ready(2) in flight**
  1. **Reuse** the newest non-Live version (the `IsLast` item) — `UpdateMarkup` on **its** id.
  2. Do NOT `CreateNewVersion`; an unpublished version already exists.
  3. Publish (`UpdateStatus` up to 3) when gates pass; clear the cache.

- **Retired(5) or Cancelled(4)**
  - **NEVER edit** a terminal version. Resolve to the latest non-terminal version for the same Origin
    first (usually the current Live, via `GetByName` without `version`), then follow the Live branch.

---

## Invariants

1. **`CreateNewVersion` at most ONCE per edit session.** Every re-push during the verify/fix loop
   targets the **same** Draft id. Publish once. Repeatedly calling `CreateNewVersion` spawns a chain
   of orphaned Drafts.
2. **Never write to a Retired(5) or Cancelled(4) version.** Resolve to the latest non-terminal version
   before any `UpdateMarkup`/`ImportJson`.
3. **`UpdateMarkup`/`ImportJson` only ever target a Draft (or Ready) id** — never a Live id. On 0.43 a
   Live version is immutable-by-convention; the way to change it is CreateNewVersion → edit → publish.
4. **Publish is Draft→Ready→Live in order.** Don't skip Ready.

---

## Failure recovery

Recovery must be **lifecycle-aware** — a failure after a good `UpdateMarkup` leaves a real Draft on the
backend that must be either published or cancelled, not silently abandoned.

- **`UpdateMarkup` failed (non-200)** — the Draft exists but is unedited (or partially). Re-fetch and
  re-apply the markup to the **same Draft id** (do NOT CreateNewVersion again), then continue. If it
  keeps failing, surface the raw error and stop; optionally `CancelVersion` the empty Draft.

- **`UpdateStatus` (publish) failed after a good `UpdateMarkup`** — the Draft exists, correctly edited,
  but **unpublished**. Do **NOT** re-`CreateNewVersion` (that spawns a second Draft). Offer:
  - **retry UpdateStatus** on the same Draft id (the common fix — a transient/validation hiccup), OR
  - **abort**, optionally `CancelVersion` the orphaned Draft so it doesn't linger as a stale `IsLast`.

- **Interrupted mid-session / unsure of state** — run the in-flight lookup (`GetAll` + `IsLast==true`).
  If the `IsLast` item is a Draft you created, resume from it (edit or publish); never start a new
  version alongside it.

**Golden rule:** exactly one Draft per edit session, and it ends either **Live** (published) or
**Cancelled** (explicitly abandoned) — never left dangling as an unpublished `IsLast`.

---

## Version-aware verification

After publishing, verification must confirm the **lifecycle landed**, not just that markup round-trips:

1. **New version is Live with the incremented `versionNo`.** `GetByName` (latest, no `version` param)
   must return `versionStatus === 3` and `versionNo === <previous + 1>`.
2. **The previous Live is now Retired.** `Get?id=<old Live id>` (or `GetByName?version=<oldNo>`) must
   return `versionStatus === 5`.
3. **Verify against the PUBLISHED id, not the pre-edit id.** Re-fetching by the old `$FORM_ID` may
   return the retired version and mislead you. Diff the markup you sent against the **new** version's
   markup.
4. **Diff the markup** (Step 8 / [api.md §11](api.md)) against what you sent; surface any server
   normalization.

```bash
# assert latest is Live with the new versionNo
curl -s -G "$BASE_URL/api/services/Shesha/FormConfiguration/GetByName" \
  --data-urlencode "module=$MODULE" --data-urlencode "name=$NAME" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d).result;console.log('versionNo',r.versionNo,'versionStatus',r.versionStatus,'(expect 3)');})"
```

### Cache clearing (mandatory after create+publish)

A newly-created + published form 404s or renders stale from the frontend's IndexedDB unless the cache
is cleared. On 0.43 clear **more than `form`/`form_lookup`** — clear the `forms`, `entities`,
`ref-lists`, and `misc` IndexedDB stores. Do it from a static page (`/favicon.ico`) so the app's own
JS doesn't repopulate mid-clear. See [verification.md](verification.md) for the recipe.
