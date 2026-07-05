# Embedded scripts — context, async rules, current user

Read when authoring any embedded JS (`onChangeCustom`, `onClickCustom`, `customVisibility`, `customEnabled`, `onBeforeDataLoad`, `actionConfiguration.actionArguments.expression`, etc.).

---

## Lifecycle timing (`formSettings.*` hooks)

| Hook | Fires | Form context (`form`, `setFormData`, `formMode`) | Use for |
|---|---|---|---|
| `onBeforeDataLoad` | before data fetch — **BEFORE the form context exists** | **undefined** | context-free prep only |
| `onDataLoaded` | after data load — fires even for create forms (data is empty) | available | `form.formArguments` reads, `form.setFieldsValue(...)`, `setFormData` |
| `onPrepareSubmitData` | at submit, before the POST | `data` + `form` available; **must `return` the payload object**; async-capable (per the groups index) | FK injection — see [add-dialogs.md](add-dialogs.md) |

Symptoms of form-context access in `onBeforeDataLoad`: `setFormData is not defined`, `Cannot read properties of undefined (reading formMode)`. Move the script to `onDataLoaded`.

- The groups index (`assets/groups/base.json` → `_formSettings.scripts`) lists `form`/`setFormData`/`formMode` in the `onBeforeDataLoad` context — runtime disagrees; trust runtime.
- Console errors from `onBeforeDataLoad` scripts are often pre-existing — verify they predate your change before treating them as regressions.
- Seeding values in *any* hook does not make them submit — only real components (`_formFields`) serialize; required contextual FKs need a component **and** `onPrepareSubmitData` injection. See [add-dialogs.md](add-dialogs.md).

---

## Script context globals

Inside any embedded JS string, these are available:

| Global | What it is |
|---|---|
| `data` / `formData` | The current form values object (entity instance keyed by `propertyName`) — form-scoped state |
| `formMode` | `'designer'` \| `'edit'` \| `'readonly'` |
| `setFormData` | `(values, mergeOrReplace) => void` — programmatic form mutation |
| `application` | App descriptor. Most useful: `application.user` (see below), `application.navigator.navigateToUrl(url)` for SPA navigation |
| `http` | Axios-like client. `http.get/post/put/delete` |
| `message` | AntD message (e.g. `message.success('Saved')`) |
| `moment` | Moment.js |
| `contexts.appContext` | App-wide shared state. Direct property access (`contexts.appContext.foo = bar`). See [shared-state.md](shared-state.md). |
| `pageContext` | Inter-page shared state — preferred over `appContext` when value is needed only across two pages |
| `selectedRow` | (in datatables) the currently selected row |
| `event` | (event handlers) the underlying DOM/AntD event |
| `value` | (onChange-style handlers) the new value |

**Forbidden globals** (technically present, but project house rule prohibits):
- `globalState`, `setGlobalState` — superseded by `contexts.appContext`. See [shared-state.md](shared-state.md).
- `window.localStorage`, `window.sessionStorage` — XSS-readable security hole.

**Do not use `console.log`** — `clean-form-config` strips them; the user runs a hardened build.

---

## Current user — use `application.user`, not an API call

`application.user` is populated synchronously inside any embedded script for an authenticated session. Read directly:

```js
const personId = application.user?.personId;
const fullName = `${application.user?.name ?? ''} ${application.user?.surname ?? ''}`.trim();
const email    = application.user?.emailAddress;
const phone    = application.user?.mobileNumber;
const userId   = application.user?.id;
```

Common fields:
- `id` — User PK
- `personId` — linked Person row's id (use this when creating Subscriptions, Applications, etc. that reference a Person)
- `userName`, `name`, `surname`, `emailAddress`, `mobileNumber`
- `requireChangePassword` — boolean (used by post-login routing)

If unauthenticated, `application.user` is `null`/`undefined` — always optional-chain (`application.user?.foo`).

**Don't:**
```js
// BAD — extra round-trip, slower, response shape changes between Shesha versions
const sess = await http.get('/api/services/app/Session/GetCurrentLoginInformations');
const personId = sess?.data?.result?.user?.personId;
```

Exception: when you need data that's *not* on `application.user` (session id, tenant info), then fetch the session endpoint.

---

## Async + try/catch (mandatory for API calls)

API calls must be wrapped in `try/catch` and properly awaited:

```js
try {
  const response = await http.get('/api/services/PBF.MembershipManagement/Member/GetTier', {
    params: { id: data.id }
  });
  setFormData({ values: { tier: response.data.result }, mergeValues: true });
} catch (err) {
  message.error(err?.response?.data?.error?.message ?? 'Failed to load tier');
}
```

The function holding this code must be `async`. For event-handler-style properties (`onChangeCustom`, `onClickCustom`), Shesha generates the function for you — `await` works directly inside the script body without an explicit `async` keyword.

**Banned patterns:**
- `.then(...).catch(...)` chains — convert to `async`/`await` + `try/catch`.
- Bare `await` outside an async wrapper — Shesha wraps event scripts but not arbitrary helpers; check the property's context.
- Unhandled promise (`http.get(...)` without `await` and without `.catch`).

The `clean-form-config` skill auto-fixes missing try/catch and missing async where unambiguous, and flags the rest. Invoke it after any script edit.

---

## Multiline JS in JSON

Escape newlines as `\n` inside JSON strings. Prefer building the tree in Node and `JSON.stringify`-ing — never hand-edit deeply nested escaped strings.

---

## Stable id references in scripts

Scripts that reference component ids (rare but possible — usually `useFormItem`-style lookups) break when ids are regenerated. **Prefer `data.<propertyName>` access** over id-based lookups.
