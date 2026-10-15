# Environments

| Key | Role | API | Admin portal | Writes |
|---|---|---|---|---|
| `p2` | phase2, Shesha 0.43 - the visual reference | `https://landbankcrm-api-lb-phase2.shesha.app` | `https://landbankcrm-adminportal-lb-phase2.shesha.app` | never |
| `046` | deployed 0.46 upgrade | `https://landbankcrm-api-0-46-upgrade.shesha.app` | `https://landbankcrm-adminportal-0-46-upgrade.shesha.app` | never |
| `local` | developer's 0.46 build on a LOCAL COPY of the phase2 database (downloaded, migrated by the 0.46 backend) | `http://localhost:21021` | `http://localhost:3000` | yes, through `lbpush.py` only |

Nothing written locally reaches phase2 or 0-46-upgrade: the reconciled forms travel only through the owner's configuration package (`.shaconfig`) export after local testing. Data writes for functional tests are safe on the local copy.

The local backend is started from the developer's IDE (branch based on `lihlumise/upgrade-to-0-46`). Do not start,
stop or rebuild it. Before a functional check, probe it: `GET /api/services/app/Settings/GetValue?name=Shesha.ThemeSettings&module=Shesha&appKey=default-app` must answer 200.

## Auth

`POST /api/TokenAuth/Authenticate {userNameOrEmailAddress, password}` (rate limited: 10 logins/min). `lbapi.Api`
caches one token per environment per process; `lbbrowse.session` caches the browser login in `<work>/.state/`
for 40 minutes.

## Form API on 0.46

- Read: `GET /api/services/app/ConfigurationItem/GetCurrent?itemType=form&module=<m>&name=<n>` (lowercase params) or
  `GET /api/services/Shesha/FormConfiguration/Get?id=<id>` (flat DTO with `markup`); list:
  `FormConfiguration/GetAll?MaxResultCount=1000`. `FormConfiguration/GetByName` is a 404 on 0.46.
- Write: `PUT /api/services/Shesha/FormConfiguration/UpdateMarkup {id, markup, modelType}` writes in place - no
  Draft/Live, no revision - and OVERWRITES `modelType` with what is sent. `lbpush.py` always sends the stored value.
- Phase2 (0.43) is versioned: read Live versions only (`versionStatus == 3`).

## Caches after a push

- Browser: delete IndexedDB `form:default-app`, `form_lookup:default-app` and `forms`, then reload.
- Designer: close the form's Configuration Studio tab and reopen it (a stale tab saves old markup over the push).

## Settings

Theme settings are per front-end application: read and write with `appKey=default-app` (Default UI). Without it the
tenant-level object comes back - a different, stale value. Write: `POST /api/services/app/Settings/UpdateValue
{name: 'Shesha.ThemeSettings', module: 'Shesha', appKey: 'default-app', value}` (merge into the current value, back
it up, read it back).

## Metadata on 0.46

`Metadata/GetProperties?container=<fullClassName>` works on both versions. `Metadata/Get` needs
`entityType=<fullClassName>` (or `module` + `name`) on 0.46; `container=` answers 400.
`Metadata/GetNonFrameworkRelatedProperties?container=` is new in 0.46 (business properties only).
