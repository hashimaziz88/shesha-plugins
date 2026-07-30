# Runtime verification and browser testing

Workflow for proving a push actually landed and smoke-testing it in the browser. Read after any push (Step 8/9) and before claiming success. Symptom→cause lookup lives in [debug.md](debug.md); API recipes in [api.md](api.md).

---

## 1. API-first verification

`UpdateMarkup` (`PUT /api/services/Shesha/FormConfiguration/UpdateMarkup`) is a **void endpoint**: it returns `success: true` with an **EMPTY/null `result`**. That is normal — it is NOT evidence your markup persisted.

| Signal | Means |
|---|---|
| HTTP 200 + `success: true` + empty `result` | Request accepted. Nothing more. |
| Re-fetch (`GetByName` markup or `GetJson`) shows your change | Push landed. The ONLY proof. |
| Re-fetch shows old markup | Push did not land (wrong id, wrong version, validation drop). |

**Never claim success from the 200 alone.** Always re-fetch and diff against what you sent — recipe and the list of harmless server normalizations (key reorder, stylingBox whitespace, `null`→`undefined`) are in [api.md §11](api.md). Surface anything else as a real diff.

```js
// Node diff skeleton — walk both trees in component-id order
const sent  = JSON.parse(fs.readFileSync('form-sent.json', 'utf8'));
const after = JSON.parse(JSON.parse(fs.readFileSync('form-after.json', 'utf8')).result.markup);
// assert: every property you changed survived; count components before/after (no field loss)
```

---

## 2. IndexedDB form cache

The frontend caches form configurations in **IndexedDB** (`form` / `form_lookup` databases). After a successful, API-verified push, the browser can keep rendering the **stale cached markup** — you will chase ghosts, "fixing" markup that is already correct.

| Trap | Rule |
|---|---|
| `indexedDB.deleteDatabase(...)` from inside the app | **BLOCKS silently** — the running app holds open connections; the delete never completes. |
| Clearing from a static page | Works. Navigate to a page where the app isn't running — e.g. `<FRONTEND_URL>/favicon.ico` — run the delete there, then navigate back and reload. |
| `localStorage.clear()` | **LOGS YOU OUT** — the auth token lives there. Don't use it as a cache-buster. |

```js
// Run in DevTools console ON <FRONTEND_URL>/favicon.ico (app not running there):
indexedDB.deleteDatabase('form');
indexedDB.deleteDatabase('form_lookup');
// then navigate back to the form and hard-reload
```

**When to run:** whenever the browser disagrees with a verified API re-fetch. Order of escalation: hard-refresh (Ctrl+Shift+R, [debug.md row 12](debug.md)) → IndexedDB clear from `/favicon.ico` → re-test. Run the clear after **every** re-push in a fix loop (see §6).

---

## 3. Navigating for tests

Test `*-details` forms via the table row's view/eye link, **NOT** by pasting a direct `?id=` URL.

| Path | Renders? | Subtable Add/Create submit |
|---|---|---|
| `<module>/<entity>-table` → row eye/view link → details | yes | works |
| Direct `/dynamic/<module>/<form>-details?id=<guid>` | yes (looks fine) | **HTTP 500** on `<Junction>/Crud/Create` — parent page context missing |
| `*-details` with NO `?id=` at all | blank | n/a — **blank is NORMAL** (gql loader has no id), not a bug; don't "fix" component config for it |

A 500 on a freshly wired Add button under direct `?id=` load is most likely a **test-navigation artifact**, not a form bug — re-test via table→details before touching the dialog wiring (see [add-dialogs.md](components/add-dialogs.md), [junction-subtables.md](components/junction-subtables.md)).

Playwright smoke recipe: start at `<module>/<entity>-table`, click the first row's eye/view action (the leftmost `columnType:"action"` item — icon `EyeOutlined`, minWidth/maxWidth 35), wait for the `-details` URL/render, then exercise the Add buttons.

---

## 4. Measure, don't screenshot

Assert layout with `getBoundingClientRect` / `getComputedStyle` against **exact expected values**. Scaled screenshots make 0px offsets look like 10–15px and cause false alarms.

```js
// DevTools / playwright evaluate — exact-value assertions, not eyeballing
const band = document.querySelector('<band-selector>');
const col  = document.querySelector('<kib-column-selector>');
col.getBoundingClientRect().height === band.getBoundingClientRect().height; // flush divider proof
getComputedStyle(col).borderLeft   === '1px solid rgb(217, 217, 217)';      // divider colour — shesha-design-system component-recipes.md
getComputedStyle(document.querySelector('.sha-page-content')).padding === '0px'; // no-padding applied
```

Example assertions that have caught real regressions:
- KIB column height `===` band height (stretch + border-left divider pattern — see [detail-page-pattern.md](detail-page-pattern.md)).
- `border-left: 1px solid rgb(217,217,217)` on KIB columns 2+.
- `.sha-page-content` padding `12px → 0px` after appending the `no-padding` class.
- Toolbar↔table left alignment via the `sha-index-table-control` class: measure the quick-search box's x-offset relative to the datatable edge (a −8px overhang means the class is missing).
- Squeezed/scrolling header containers: fix is `dimensions.minHeight: 'fit-content'` (runtime-verified; not in the groups index — clean-form-config may flag it; do NOT strip) — `dimensions` is the only channel reaching the container's outer div; see `style-channels.md` (in `shesha-design-system`).

For pixel-parity work ("match the reference form"), compare **computed** styles in-browser AND do a bidirectional full-key JSON diff — identical-looking designer props can render differently because of one extra key (e.g. a stray `font.color`).

---

## 5. Don't misattribute

Frontend dev-server compile errors (missing chunks, stuck initialization, blank pages) **look exactly like form bugs**. Before editing markup:

1. Confirm the form's server-side state via API re-fetch (§1) — independently of the browser.
2. If the API state is correct but the browser misrenders: cache (§2), then dev-server health, then [debug.md](debug.md).
3. Only then consider the markup wrong.

In embedded scripts, prefer `formArguments?.id` over parsing `window.location.search` — Shesha-idiomatic and robust across navigation patterns (direct URL, table→details, dialog). See [components/scripts.md](components/scripts.md).

---

## 6. Smoke-failure loop

When a browser smoke test fails, run this exact cycle — no shortcuts:

1. **Capture verbatim** — console errors and network responses with status ≥ 400, quoted exactly.
2. **Consult [debug.md](debug.md)** — match the symptom row; if no row matches, don't guess — report "no match" and ask.
3. **Fix markup** — apply the row's fix (or the diagnosed cause).
4. **Re-push** — [api.md §5](api.md).
5. **Re-fetch verify** — §1; confirm the fix persisted server-side.
6. **Clear the IndexedDB cache** — §2, from `/favicon.ico`. Never skip this after a re-push.
7. **Re-test** — via the correct navigation path (§3).

Never silently retry the same push. Never report success without steps 5–7 passing.

---

### Worked example (project-specific)

From the RequirementsStudio fleet work (2026-06):

- **§3 navigation artifact:** `service-definition-project-add`'s "Add Project" submit 500'd on `ServiceDefinitionProject/Crud/Create` under direct `?id=` load — the same link worked when reached via table→details in MS Edge. The form was never broken.
- **§4 measured proof:** after the `module-definition-details` KIB rebuild, computed column height `===` KIB band height (84px) and `border-left: 1px solid rgb(217,217,217)` on columns 2+ proved the flush-divider pattern; `getComputedStyle('.sha-page-content').padding` went `12px → 0px` across all 16 non-MDD forms after the `no-padding` class.
- **§4 false alarm:** during the all-17-forms KIB rollout, scaled screenshots suggested 10–15px label/value misalignment; `getBoundingClientRect` showed 0px offsets — no fix needed.
- **§2 ghost-chasing:** post-push verification repeatedly stalled on stale renders until the `form`/`form_lookup` IndexedDB databases were cleared from `/favicon.ico`; in-app `deleteDatabase` calls blocked silently.
