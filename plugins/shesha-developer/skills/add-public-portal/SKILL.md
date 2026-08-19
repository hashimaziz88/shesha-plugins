---
name: add-public-portal
description: >-
  Add a new public portal (public-facing / unauthenticated front-end app) to an existing Shesha
  framework project. Trigger for "add/create a public portal", "spin up a customer/vendor/citizen
  portal", "add another front-end", or "duplicate publicportal/adminportal" on a Shesha (Boxfusion,
  SmartGov) project — even without the word "portal", when the intent is a second public-facing
  Shesha front-end. Version-aware: Shesha 0.43.x sources from the template's shipped publicportal;
  0.45.x+ duplicates the project's adminportal (no publicportal ships). Resolves the project
  template via the Shesha demo API (GetAll → Generate), then wires package.json, the backend
  app-key migration, and ShaApplicationProvider. Do NOT use for building individual pages/forms
  inside an existing portal, or for non-Shesha portals.
---

# Adding a Public Portal to a Shesha Project

## What this skill does and why it exists

A Shesha project can host several front-end applications side by side — typically an internal
`adminportal` plus one or more public-facing portals (customer, vendor, citizen, etc.). Each
front-end is a self-contained Next.js/React app that talks to the same ASP.NET Core backend, and each
must be registered in the backend with its own **application key** so the framework can associate the
right forms, permissions and configuration with it.

"Adding a public portal" therefore means: get a correct copy of a portal folder, register a new app
key in the backend, point the new front-end at that key, and run it. The fiddly parts — which folder
to copy (it differs by Shesha version), how to resolve and download the right template, and the one
line in `app-provider.tsx` that people forget — are exactly what this skill exists to get right every
time.

This skill operates on an **existing Shesha project**. It does not create a project from scratch; it
adds a portal into a project the developer already has open.

## Before you start: confirm three things

Work through these up front, because they change every later step.

**1. The target Shesha version — always ask, never guess, never free-text.**
The version determines where the portal comes from, so present it as a *selection*, not an open text
box. Fetch the live list of available versions from the Shesha template API and let the developer
pick one. Read `references/api.md` for exactly how to authenticate and call `GetAll`, then present
the distinct versions (latest first) using the AskUserQuestion tool. If the API is unreachable, fall
back to offering the known families `0.43.x` and `0.45.x-and-above` and say so.

**2. The project location.** Confirm the root of the existing Shesha project (the folder that
contains `adminportal/`, `backend/`, `intent/`). If you don't have file access to it yet, request the
folder before doing anything else. You will read and write real files here.

**3. The new portal's name, company and project name.** Ask for a short portal name (lowercase, no
spaces — this becomes the folder name, the package name and the app key, so it must be consistent
everywhere). Also collect the `companyName` and `projectName` — these are required by the template
`Generate` call. A project may host **up to three public portals**; if three already exist, stop and
tell the developer rather than adding a fourth.

## The version rule (this is the crux)

Shesha changed what the starter template ships, so the *source* of the portal folder depends on the
version. Handle exactly two cases — **0.44.x is out of scope, do not offer or infer it.**

- **Shesha 0.43.x** — the template ships a ready-made `publicportal`. Generate that version's
  template from the API, extract it, and copy its `publicportal` folder into the existing project as
  the new portal (e.g. `publicportal2`). This gives an authentic public-portal starting point with the
  public header/login/footer already wired.

- **Shesha 0.45.x and above** — the template ships **no** publicportal. Duplicate the existing
  project's `adminportal` folder instead, then switch its layout over to the public-portal forms (see
  step 4). You still generate the template if you need clean reference files, but the practical source
  is the local `adminportal`.

Why generate the template at all for 0.43 rather than copy a local `publicportal`? Because the
existing project may have a customised or missing publicportal, and the server-generated template is
the canonical, clean copy for that version. You extract the whole template but only *use* the
`publicportal` folder from it.

## The workflow

Follow these in order. Steps 1–2 resolve and fetch the source; steps 3–7 wire up the new portal.
Naming must stay identical across the folder, `package.json`, the migration `app_key`, and
`applicationKey` — a mismatch is the most common reason a new portal silently fails to load.

### Step 1 — Resolve the template for the chosen version

Authenticate to the Shesha demo API with the service account and call `GetAll`, filtering on the
version property with JsonLogic and sorting by `creationTime desc` so the newest template for that
version comes first. Take the `id` of the first result as the `projectTemplateId`. The bundled script
`scripts/resolve_and_generate.py` does this end to end (auth → GetAll → pick latest → Generate);
prefer it over hand-rolling the calls. All endpoint URLs, the auth flow, the JsonLogic filter shape,
and the query parameters are documented in `references/api.md`.

### Step 2 — Generate and extract the template (only when you need the source files)

Call `Generate` with `{ projectTemplateId, companyName, projectName }` to download the template, then
extract it to a temp location. For **0.43.x**, locate the `publicportal` folder inside the extracted
template — that is your portal source. For **0.45.x+**, you can skip using the download and duplicate
the project's local `adminportal` instead.

### Step 3 — Copy the portal folder into the project

Copy the source folder into the existing project root under the new portal name. Keep names
lowercase and consistent, and don't exceed three public portals.

```bash
# 0.43.x — from the extracted template's publicportal
cp -r <extracted-template>/publicportal <project-root>/publicportal2

# 0.45.x+ — duplicate the project's adminportal
cp -r <project-root>/adminportal <project-root>/publicportal2
```

### Step 4 — Update package name and layout

In `<newportal>/package.json`, change `name` to something unique and descriptive, e.g.
`@shesha-io/<projectname>-publicportal2`.

In `<newportal>/src/app-constants/layout.ts`, point the portal at the **public** layout forms so it
looks and behaves like a public site rather than the admin app. This matters most for the 0.45.x+
case, where you started from `adminportal` and must switch it over:

```typescript
import {
  LayoutMode, FormFullName,
  HEADER_PUB_PORTAL_CONFIGURATION,
  LOGIN_PUB_PORTAL_CONFIGURATION,
  FOOTER_CONFIGURATION,
} from "@shesha-io/reactjs";

export const LAYOUT_MODE: LayoutMode = "horizontalLayout";
export const ACTIVE_HEADER: FormFullName = HEADER_PUB_PORTAL_CONFIGURATION;
export const ACTIVE_LOGIN: FormFullName = LOGIN_PUB_PORTAL_CONFIGURATION;
export const ACTIVE_FOOTER: FormFullName = FOOTER_CONFIGURATION;
```

Substitute custom forms (`{ module, name }`) if the developer has built their own in the Forms
Designer. For unauthenticated pages, Shesha treats any route containing `/no-auth` as public — the
`ShaApplicationProvider` already sets `noAuth` from the path — so place public pages under a
`/no-auth` segment. See `references/api.md` for the custom-page/no-auth pattern.

### Step 5 — Register the app key with a backend migration

Each front-end needs a row in `frwk.front_end_apps`. Create a FluentMigrator migration under
`backend/src/Module/<Project>.Domain/Migrations/` named `M<yyyyMMddHHmmss>.cs`. Use the timestamp for
both the file name and the `[Migration(...)]` attribute so ordering stays unique.
`assets/migration-template.cs` is a fill-in-the-blanks template — copy it and replace the app key,
name, description and namespace. The `app_key` MUST be lowercase, no spaces, and identical to the
portal name.

### Step 6 — Wire `applicationKey` into ShaApplicationProvider (the step everyone forgets)

Open `<newportal>/src/app/app-provider.tsx` and add `applicationKey` to `<ShaApplicationProvider>`,
matching the migration's `app_key` exactly. Without this the front-end loads but is never identified
as its own app, so it shows the wrong forms/config. See `assets/app-provider.snippet.tsx`.

```tsx
<ShaApplicationProvider
  backendUrl={backendUrl}
  router={nextRouter}
  applicationKey={"<portal-name>"}   // <-- add, must equal the migration app_key
  noAuth={nextRouter.path?.includes('/no-auth')}
>
```

### Step 7 — Install, run, verify

```bash
cd <newportal> && rm -rf node_modules package-lock.json .next && npm install
# start the backend so the migration auto-applies on startup:
cd ../backend && dotnet run --project src/<Project>.Web.Host
# then run the new portal:
cd ../<newportal> && npm run dev
```

Then verify against this checklist before declaring success:

- The new portal loads in the browser (its own port).
- `SELECT * FROM frwk.front_end_apps WHERE app_key = '<portal-name>';` returns exactly one row.
- Folder name, `package.json` name, migration `app_key`, and `applicationKey` all agree.
- There are no more than three public portals in the project.

## Credentials — required behaviour

The template API requires login. **This skill never contains credentials** and must never invent,
guess, or hard-code them.

Before any API call, check whether both `SHESHA_SVC_USER` and `SHESHA_SVC_PASS` are set in the
environment. Behave as follows:

**If both are set** — proceed. Never echo the password into chat, logs, commit output, or command
output. If the API rejects them (401), stop and report "credentials rejected" without printing the
values.

**If either is missing** — stop before calling the API and prompt the developer, using
AskUserQuestion. Offer two paths and honour whichever they pick:

1. *Set env vars, then retry* — show these exact commands (do NOT run them):

   ```bash
   # persistent (recommended) — appends to your shell profile:
   echo 'export SHESHA_SVC_USER="your-username"' >> ~/.zshrc
   echo 'export SHESHA_SVC_PASS="your-password"' >> ~/.zshrc
   # then reload your shell and re-run Claude Code
   ```

   Or, more securely on macOS, via Keychain:

   ```bash
   security add-generic-password -s shesha-svc -a "$USER" -w 'your-password'
   # then in your shell profile:
   export SHESHA_SVC_USER="your-username"
   export SHESHA_SVC_PASS="$(security find-generic-password -s shesha-svc -a "$USER" -w)"
   ```

   After they confirm they've done this, tell them to reopen Claude Code and re-run — the shell
   Claude Code was launched in doesn't pick up new env vars mid-session.

2. *Enter credentials for this session only* — collect username and password with AskUserQuestion
   (mark the password field as a secret / do not echo). Export them inline for the current bash
   process only:

   ```bash
   SHESHA_SVC_USER='...' SHESHA_SVC_PASS='...' python scripts/resolve_and_generate.py --list-versions
   ```

   Do not write them to disk, do not add them to `~/.zshrc`, do not commit anything referencing
   them, and do not repeat the password back to the user.

**Never** fall back to skipping the API call silently or to a hard-coded token. If the developer
declines both options, stop and explain what work is possible without the API (e.g. for 0.45.x+ you
can still duplicate the local `adminportal` without hitting `Generate`).

## Reference material

- `references/api.md` — auth flow, `GetAll` / `Generate` endpoints, JsonLogic version filter,
  query parameters, and the no-auth/custom-page pattern.
- `scripts/resolve_and_generate.py` — authenticate, resolve the latest `projectTemplateId` for a
  version, and download the template in one call.
- `assets/migration-template.cs` — FluentMigrator migration for registering the app key.
- `assets/app-provider.snippet.tsx` — the `ShaApplicationProvider` edit.