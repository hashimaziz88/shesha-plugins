# Shesha Template API + portal patterns

Base host: `http://demoshesha.azurewebsites.net`

All three template endpoints live under
`/api/services/SheshaAspnetCoreDemo/ProjectTemplate/`. They are ABP-style endpoints and the read
endpoints require a bearer token.

## 1. Authenticate (service account)

Shesha uses ABP token auth. Exchange the service-account credentials for a bearer token, then send
`Authorization: Bearer <token>` on subsequent calls.

```
POST /api/TokenAuth/Authenticate
Content-Type: application/json

{ "userNameOrEmailAddress": "<SERVICE_ACCOUNT_USER>", "password": "<SERVICE_ACCOUNT_PASSWORD>" }
```

The response contains `result.accessToken`. Use it as `Authorization: Bearer <accessToken>`.

**Credentials — never store in this skill.** Read them from the environment (`SHESHA_SVC_USER`,
`SHESHA_SVC_PASS`) or the OS keychain. If either is missing, the skill must stop and prompt the
developer (see `SKILL.md` → "Credentials — required behaviour"). Never hard-code, never echo, never
commit.

## 2. GetAll — resolve the projectTemplateId for a version

```
GET /api/services/SheshaAspnetCoreDemo/ProjectTemplate/GetAll
Authorization: Bearer <token>
```

Query parameters (from Swagger):

| param            | type          | use                                                            |
|------------------|---------------|----------------------------------------------------------------|
| `sorting`        | string        | order results, e.g. `creationTime desc` (newest first)         |
| `skipCount`      | int           | paging offset                                                  |
| `maxResultCount` | int           | page size; set `1` when you only want the latest match         |
| `filter`         | string        | **JsonLogic** filter (URL-encoded) — filter by version here    |
| `quickSearch`    | string        | free-text search                                               |
| `specifications` | string[]      | named specs (rarely needed)                                    |
| `api-version`    | string        | API version header/param (usually leave blank)                 |

**Version filter (JsonLogic).** Filter on the template's version property. The exact property name
may be `version` (confirm against a sample `GetAll` response). Equality example:

```json
{ "==": [ { "var": "version" }, "0.45" ] }
```

Prefix/family match (e.g. any `0.45.x`) — use a "starts with"/`in` style if the API supports it,
otherwise fetch by exact version or fetch unfiltered and pick client-side:

```json
{ "in": [ "0.45", { "var": "version" } ] }
```

Put the JsonLogic JSON into `filter` (URL-encoded), combine with `sorting=creationTime desc` and
`maxResultCount=1`. The first item's `id` is your `projectTemplateId`.

**Listing versions for the selector.** To populate the version dropdown, call `GetAll` with
`sorting=creationTime desc` and no version filter, then collect the distinct `version` values
(newest first). Present those with AskUserQuestion. Do not include `0.44.x` — it is out of scope.

## 3. Generate — download the template

```
POST /api/services/SheshaAspnetCoreDemo/ProjectTemplate/Generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "projectTemplateId": "<guid from GetAll>",
  "companyName": "<company>",
  "projectName": "<project>"
}
```

Returns the generated project (typically a downloadable archive / file stream). Save it, unzip it,
and locate the portal source folder inside:

- **0.43.x** → use the extracted `publicportal/` folder as the new portal's source.
- **0.45.x+** → the template has no `publicportal`; duplicate the project's local `adminportal/`
  instead. You only need `Generate` here if you want clean reference files.

## 4. Public / unauthenticated pages (no-auth pattern)

Shesha front-ends are Next.js apps. A custom page is a folder under `src/app/(main)/<path>/` with a
`page.tsx`. The route is the folder path, e.g. `.../(main)/custom/page.tsx` → `/custom`.

Any route whose path contains `/no-auth` is served **without authentication** — the
`ShaApplicationProvider` sets `noAuth={nextRouter.path?.includes('/no-auth')}`. So for a public,
login-free page, place it under a `/no-auth` segment, e.g. `src/app/(main)/no-auth/landing/page.tsx`.

```tsx
import React from 'react';
const PublicLanding = () => <div><h1>Welcome</h1></div>;
export default PublicLanding;
```

## Sources
- Creating a New Front End Application: https://docs.shesha.io/docs/front-end-basics/how-to-guides/create-front-end-application
- Custom Pages: https://docs.shesha.io/docs/front-end-basics/how-to-guides/create-custom-pages
- Swagger: http://demoshesha.azurewebsites.net/swagger/index.html