# Backend readiness after a missing/changed domain (thin runbook)

This skill builds forms; it does **not** own the backend lifecycle. When Step 2.3 finds the entity
missing or its dynamic CRUD unregistered, the domain must be created and the backend rebuilt +
restarted **before** any seed is copied. This doc is the *verify-centric* contract for that — the full
restart mechanics live in the authoritative shared runbook (see the last section); don't re-implement
them here.

## Order of operations

**Domain first, forms last.** Create the entity and get the backend restarted, poll until its CRUD is
live, *then* copy a seed. A form built against a not-yet-registered entity won't render; a form pushed
*before* a later restart can be orphaned (see "After a restart" below).

## Delegate the create + restart to `domain-model` — never restart yourself

`domain-model` already declares rebuild + restart **mandatory** after every domain change and owns the
restart end-to-end. Hand it the work and let it finish:

- Invoke `Skill(shesha-developer:domain-model)` with the full context block — Backend URL · Username ·
  Password · **Module** · **Working directory** (the .NET solution root the rebuild/restart run from) ·
  the **entity name + property list / requirements** · the **required outcome** ("entity live:
  `/api/dynamic/<module>/<Entity>/Crud/GetAll` returns 200; report final `{name, module, fullClassName}`").
- **Scenario detection is not this skill's job.** The shared runbook that `domain-model` follows detects
  ephemeral vs headless vs attended and picks the restart path itself. You only care about the two
  outcomes below — both resolve to the same verification poll.

### The two restart outcomes you should expect
- **Headless / CI** → the runbook self-hosts: it stops the port holder, `dotnet build`s the Web.Host,
  and launches the built DLL under Kestrel
  (`ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:<port> dotnet <App>.Web.Host.dll`),
  then polls `/swagger/index.html`.
- **Attended / Visual Studio / IIS Express / dll-locked** → the runbook **prompts the developer** to
  Stop ▸ Build ▸ Run, **twice** for a new entity, then continues.
- **Rule 0:** never relaunch IIS Express outside Visual Studio — `hostingModel=InProcess` +
  `processPath="%LAUNCHER_PATH%"` gives `HTTP 500.0 ANCM in-process` failure. Delegating keeps you out of
  this trap; do not take over the port from this skill.

## Verify (this is your only job here) — the 2-boot lag

A brand-new entity's dynamic CRUD controller registers only on the boot *after* its `EntityConfig` is
seeded. When `domain-model` returns:

1. Poll `GET /api/dynamic/<module>/<Entity>/Crud/GetAll?maxResultCount=1` (Bearer token) for HTTP 200.
2. Still 404? That's the known lag, not a failure — request **one** more delegated boot (budget 2–3),
   then re-poll. Do **not** spin up a parallel restart loop or call `dotnet build`/`dotnet run` / kill
   the port yourself.
3. A restart can change the module id — re-run `Module/GetAll` (Step 1) and re-resolve the entity
   (Step 2.1–2.2) before building and before Step 5's `moduleId`-based push.

## After a restart — re-verify the forms you push

Startup re-runs the config bootstrappers, which can leave a form without its live revision:
`FormConfiguration/GetByName` (and `/dynamic/<mod>/<name>`) return **404** while `GetJson?id=<id>` still
returns the markup. If that happens after a Step 2.3 restart, **re-push via `UpdateMarkup`** to restore
name-resolution, then re-fetch. A clean run that never restarted won't hit this (forms are built *after*
the restart).

## Authoritative source

For the full branch matrix (ephemeral shesha-agent API, exact headless command sequence, the cost-incident
context, and the 3-layer `EntityConfig` / GraphQL / dedicated-controller recovery table), defer to the
shared runbook `domain-model` uses:
[../../shesha-form-edit/references/backend-restart.md](../../shesha-form-edit/references/backend-restart.md).
Keep this local doc thin — do not restate those deep mechanics (single source of truth; avoids drift).
