# Backend restart after a domain change (the reliable runbook)

A **domain change** (new/changed entity, property, reference list, or migration) only takes effect
after the .NET backend is **rebuilt and restarted** — Shesha applies migrations and seeds
`EntityConfig` on startup. Doing this badly is the single biggest cost/failure sink (one harness run
burned **$12.50 / 27 min** on 14 restart attempts and corrupted an existing form). Follow this
runbook instead of improvising.

> **Order of operations — scan ALL prereqs first, build ONCE, forms last.** BEFORE writing any code,
> run the single combined prereq scan (`scripts/backend-probe.mjs` + the
> `shesha-developer:fullstack-prereq-checker` agent) to surface EVERY gap at once — missing entity,
> reflist, endpoint, permissions. Enumerate all the domain + app-layer changes from that one scan, apply
> them together, then do **one** rebuild + the (double-)boot. **Never discover→build→discover→build** —
> that serial loop (one run did 5+ rebuild/boot cycles) is what turns a 10-minute change into an hour.
> A form built before the entity is ready won't render; a form pushed *before* a later restart can be
> orphaned by that restart (see "re-verify forms" below).

## Contents
1. Rule 0 — never relaunch IIS Express outside Visual Studio
2. Ephemeral / shesha-agent sandbox — check this FIRST
3. Headless / CI / harness — take over the port with Kestrel
4. After ANY restart — re-verify the forms you'll touch
5. Attended / real-world (Visual Studio is running the app)

---

## Rule 0 — never relaunch IIS Express outside Visual Studio

The dev backend is usually hosted by **IIS Express**, launched and managed by Visual Studio. Its
`applicationhost.config` uses `hostingModel="InProcess"` with `processPath="%LAUNCHER_PATH%"` — that
env var is only set by VS, so relaunching `iisexpress.exe` yourself gives **`HTTP Error 500.0 — ANCM
In-Process handler load failure`**. Do **not** try to relaunch IIS Express. Use the Kestrel path below
(headless) or hand back to VS (attended).

---

## Ephemeral / shesha-agent sandbox — check this FIRST

If the `SHESHA_AGENT_API_URL` and `SHESHA_SESSION_ID` environment variables are set, you're running
inside a shesha-agent ephemeral session, not on a developer's machine or in CI. The backend there
already runs under `dotnet watch`, and a separate system handles rebuild/redeploy — **do not** take
over the port or run `dotnet build`/`dotnet run` yourself (the Headless section below does exactly
that, and it will race the live process, producing MSB3027/MSB3021 file-copy errors). Instead,
trigger and wait for the restart yourself over shesha-agent's own API:

```bash
curl -X POST "$SHESHA_AGENT_API_URL/api/app-restart/$SHESHA_SESSION_ID/restart-changed-apps"

# Poll until the backend is running (a few minutes' timeout is reasonable)
until curl -s "$SHESHA_AGENT_API_URL/api/app-restart/$SHESHA_SESSION_ID/app-statuses" \
    | grep -q '"backend":"running"'; do
  sleep 3
done
```

Then verify against `$SHESHA_BACKEND_URL` (never `localhost`) — including the same 2-boot lag
described below for a brand-new entity: poll `Crud/GetAll`, and re-run the two commands above once
more if it 404s, since the controller only registers on the boot after `EntityConfig` is seeded.

Skip the rest of this doc in this case — the Headless and Attended sections below both assume you can
freely stop/rebuild/relaunch the backend process yourself, which you must never do here.

---

## Headless / CI / harness — take over the port with Kestrel

You're headless when the task supplied a context block (Backend URL / Module / Working directory) or
you're in `claude -p`. Run this **once** as a single combined sequence (don't probe step-by-step):

```bash
WH="<workingDir>/backend/src/<App>.Web.Host"          # e.g. .../<app>/backend/src/*.Web.Host
DLL="$WH/bin/Debug/net8.0/<App>.Web.Host.dll"          # e.g. *.Web.Host.dll
BASE="http://localhost:21021"

# 1. Stop whatever holds the port (IIS Express + its tray, or the port owner)
powershell -NoProfile -Command "Get-Process iisexpress,iisexpresstray -ErrorAction SilentlyContinue | Stop-Process -Force"
# (fallback: kill the PID returned by `Get-NetTCPConnection -LocalPort 21021 -State Listen`)

# 2. Build — the Web.Host build compiles Domain + the migration too, so DON'T run a separate
#    Domain build/compile-check (it doubles compile time). Restore ONCE per session, then build with
#    --no-restore and keep it incremental (never clean/`-t:Rebuild`) — a warm incremental build is far
#    faster than a cold one.
dotnet restore "$WH/<App>.Web.Host.csproj"                              # once per session only
dotnet build "$WH/<App>.Web.Host.csproj" -c Debug --nologo -v m --no-restore

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

## After ANY restart — re-verify the forms you'll touch

Startup re-runs the configuration bootstrappers (`ConfigurableModuleBootstrapper` /
`ImportConfigurationAsync`), which can leave a previously-edited form without its "live" revision:
`FormConfiguration/GetByName` (and the `/dynamic/<mod>/<name>` route) return **404**, while
`GetJson?id=<id>` still returns the markup. To restore name-resolution, **re-push the markup**:

```bash
# if GetByName 404s but you have the id + markup:
curl -s -X PUT "$BASE/api/services/Shesha/FormConfiguration/UpdateMarkup" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"<id>","markup":"<stringified markup>"}'
```

Because you build forms **after** the restart, a clean single run normally won't hit this — it bites
when an earlier form exists and a later domain change forces a restart. Re-verify defensively.

---

## Attended / real-world (Visual Studio is running the app)

Do **NOT** kill VS's IIS Express or take over the port — that breaks the developer's session. Instead:

1. Tell the developer: *"I created/changed an entity + migration — rebuild and restart the app in
   Visual Studio (Stop ▸ Build ▸ Run), then I'll continue."* For a **new** entity, ask them to restart
   **twice** (the 2-boot lag).
2. Poll the entity's `Crud/GetAll` until it returns 200, then resume form work.
3. Only offer the headless Kestrel takeover above if the developer explicitly prefers it.

This keeps the skill usable in normal development, not just the test harness.
