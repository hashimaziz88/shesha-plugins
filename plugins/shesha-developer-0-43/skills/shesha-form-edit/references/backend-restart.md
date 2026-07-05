# Backend restart after a domain change (the reliable runbook)

A **domain change** (new/changed entity, property, reference list, or migration) only takes effect
after the .NET backend is **rebuilt and restarted** — Shesha applies migrations and seeds
`EntityConfig` on startup. Doing this badly is the single biggest cost/failure sink (one harness run
burned **$12.50 / 27 min** on 14 restart attempts and corrupted an existing form). Follow this
runbook instead of improvising.

> **Order of operations:** do ALL domain changes + the restart **first**, then build forms **last**.
> A form built before the entity is ready won't render; and a form pushed *before* a later restart
> can be orphaned by that restart (see "re-verify forms" below).

---

## Rule 0 — never relaunch IIS Express outside Visual Studio

The dev backend is usually hosted by **IIS Express**, launched and managed by Visual Studio. Its
`applicationhost.config` uses `hostingModel="InProcess"` with `processPath="%LAUNCHER_PATH%"` — that
env var is only set by VS, so relaunching `iisexpress.exe` yourself gives **`HTTP Error 500.0 — ANCM
In-Process handler load failure`**. Do **not** try to relaunch IIS Express. Use the Kestrel path below
(headless) or hand back to VS (attended).

---

## Headless / CI / harness — take over the port with Kestrel

You're headless when the task supplied a context block (Backend URL / Module / Working directory) or
you're in `claude -p`. Run this **once** as a single combined sequence (don't probe step-by-step):

```bash
WH="<workingDir>/backend/src/<App>.Web.Host"          # e.g. .../boxfusion.test/backend/src/boxfusion.test.Web.Host
DLL="$WH/bin/Debug/net8.0/<App>.Web.Host.dll"          # e.g. boxfusion.test.Web.Host.dll
BASE="http://localhost:21021"

# 1. Stop whatever holds the port (IIS Express + its tray, or the port owner)
powershell -NoProfile -Command "Get-Process iisexpress,iisexpresstray -ErrorAction SilentlyContinue | Stop-Process -Force"
# (fallback: kill the PID returned by `Get-NetTCPConnection -LocalPort 21021 -State Listen`)

# 2. Build (Web.Host build compiles the Domain project + migration too)
dotnet build "$WH/<App>.Web.Host.csproj" -c Debug --nologo -v m

# 3. Launch Kestrel in the BACKGROUND on :21021 (NOT `dotnet run` — run the built DLL; it's faster and
#    avoids a rebuild). ASPNETCORE_ENVIRONMENT=Development is required (Production 500s here).
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="$BASE" dotnet "$DLL"   # run via run_in_background

# 4. Poll until Shesha finishes booting (migrations + bootstrappers ~10–30s)
#    until: curl -s -o /dev/null -w '%{http_code}' "$BASE/swagger/index.html"  == 200
```

Launch step 3 with `run_in_background: true` (it's a long-lived server) and then poll in a separate
call. Write any scratch scripts into `<workingDir>`, **not `/tmp`** (git-bash `/tmp` ≠ Windows paths).

### The 2-boot lag (new entities only) — handle it deterministically

A **newly added** entity's dynamic CRUD controller registers only on the boot *after* its
`EntityConfig` is seeded. So the first boot brings the app up but the new entity's endpoint 404s. After
step 4 succeeds, verify the entity and restart **once more** if needed — don't flail:

```bash
# dynamic CRUD endpoint format:  /api/dynamic/<module>/<Entity>/Crud/GetAll
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/dynamic/<module>/<Entity>/Crud/GetAll?MaxResultCount=1")
# 200 → ready.  404/500 → repeat steps 1–4 ONCE; the controller registers on the second boot.
```

For a brand-new entity, just **plan for two boots** up front (build once, then boot → boot) rather than
discovering the 404 and reacting.

---

## After ANY restart — re-verify the forms you'll touch (version-aware on 0.43)

Startup re-runs the configuration bootstrappers (`ConfigurableModuleBootstrapper` /
`ImportConfigurationAsync`), which can leave a previously-edited form without its "live" revision:
`FormConfiguration/GetByName` (and the `/dynamic/<mod>/<name>` route) return **404**, while
`GetJson?id=<id>` still returns the markup.

On 0.43 restoring the route is **two steps**, not one — 0.43 forms are versioned ConfigurationItems (status
`1=Draft, 2=Ready, 3=Live, 4=Cancelled, 5=Retired`; see [version lifecycle](version-lifecycle.md)):

1. **Re-push the markup** to a **non-terminal** version. First resolve which version the bootstrapper left
   behind (`GetAll` + filter `IsLast==true` for the latest revision per `Origin`, and its `versionStatus`).
   Re-push to that Draft/Ready version — **never** to a Retired(5) or Cancelled(4) revision (a bare
   `UpdateMarkup` on a terminal version does nothing useful and won't restore the route).
2. **`UpdateStatus` it back to Live(3).** Because the bootstrapper left the version **non-Live**, re-pushing
   markup alone does **not** restore `GetByName`/route resolution — those resolve **Live**. After the
   `UpdateMarkup` you must publish the version to Live so it is name-resolvable again.

```bash
# if GetByName 404s but you have the id + markup, and GetAll shows this id is the latest non-terminal version:
curl -s -X PUT "$BASE/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"<id>","markup":"<stringified markup>"}'

# then re-publish to Live(3) so GetByName / the /dynamic route resolves it again:
curl -s -X PUT "$BASE/api/services/Shesha/FormConfiguration/UpdateStatus" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter":{"and":[{"==":[{"var":"id"},"<id>"]}]},"status":3}'
```

Because you build forms **after** the restart, a clean single run normally won't hit this — it bites
when an earlier form exists and a later domain change forces a restart. Re-verify defensively, and confirm
the restored version is `versionStatus == 3` before resuming (see
[version lifecycle → Version-aware verification](version-lifecycle.md#version-aware-verification)).

---

## Attended / real-world (Visual Studio is running the app)

Do **NOT** kill VS's IIS Express or take over the port — that breaks the developer's session. Instead:

1. Tell the developer: *"I created/changed an entity + migration — rebuild and restart the app in
   Visual Studio (Stop ▸ Build ▸ Run), then I'll continue."* For a **new** entity, ask them to restart
   **twice** (the 2-boot lag).
2. Poll the entity's `Crud/GetAll` until it returns 200, then resume form work.
3. Only offer the headless Kestrel takeover above if the developer explicitly prefers it.

This keeps the skill usable in normal development, not just the test harness.
