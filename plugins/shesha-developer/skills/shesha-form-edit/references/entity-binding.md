# Entity binding — resolve, verify, never guess

Everything that connects a form to the backend's registered entities: `modelType`, `entityType`, property metadata, reference lists, and the create-vs-bind decision. Skipped only when `formSettings.dataLoaderType === "none"`.

## 1. Probe first — one call, not ten

**The FIRST action is `scripts/backend-probe.mjs`** — it collapses module id + entity resolve + metadata + reflist existence into one call ([api.md — combined probe](api.md)). The manual steps below are the fallback for gaps, not the default path. Never guess `GetByName`/`GetAll` routes — a 404 is usually the wrong `app` vs `Shesha` namespace, not an absent resource (verify a KNOWN form/entity resolves before concluding one is missing).

## 2. Resolve `modelType` — the live EntityConfig is the only authority

`formSettings.modelType` must identify the exact registered entity for THIS backend — resolved every time, never assumed or copied. The same logical entity moves namespaces across versions (`Shesha.Domain.Person` vs `Shesha.Core.Person`; a backend may carry both); a mismatch 500s at runtime.

1. **Authoritative**: `GET $BASE_URL/api/services/app/EntityConfig/GetMainDataList?maxResultCount=200` — take the entity's **`name` + `module`** (for the modelType object) and its **`fullClassName`** (for the metadata `container` param and `dataContext.entityType`).
2. **Cross-check**: an existing form bound to the same entity (`FormConfiguration/GetAll`). Where forms disagree, EntityConfig wins.

**Shape** [R-016]: `formSettings.modelType` is the `{ name, module }` **object**; `dataContext.entityType` stays the full-class-name **string**.

**Portability:** a resolved binding is only valid on the backend it was resolved against. Framework entities (`Shesha.*`) are stable; a project's own generated entities carry the project's namespace. When the form's audience is another environment (config export, a harness grading on a different project), name every project-specific binding in the run summary so the importer re-resolves — and prefer a framework entity over creating a project-local twin when either could carry the task.

## 3. Entity existence — evidence before create

Try the metadata routes in order until one returns a 200 property array:
(1) `GET /api/services/app/Metadata/GetProperties?container=<fullClassName>` →
(2) `GET /api/services/app/Metadata/Get?container=<fullClassName>` (`result.properties[]`) →
(3) `GET /api/services/Shesha/Metadata/Get?container=<fullClassName>`.

- **A 404 is NOT proof the entity is missing.** If all three 404 but EntityConfig listed the class, the route/namespace or `fullClassName` is wrong — re-resolve and retry. Do NOT invoke `domain-model` to "create" an entity that already exists.
- Only an **empty property array from a 200** means truly unregistered → `Skill(shesha-developer:domain-model)`.

**Evidence-before-create gate (mandatory).** Creating an entity is the most expensive branch available (entity → migration → rebuild → double-boot ≈ 20–60 min). Before taking it, PRINT the evidence block: the EntityConfig search result for the entity name **and close variants/synonyms** (`Attendee` vs `EventAttendee` vs `Participant`), the three metadata-route URLs + HTTP codes, and one sentence "creating <Entity> because: <reason>". **Prefer binding to an existing entity whose properties cover the task** — disclose the substitution in the run summary (headless: in `disclosures`). Create only when the task explicitly demands a new domain concept, or no registered entity can carry the required fields.

**If prereqs ARE missing, fix them all at once.** Run `scripts/backend-probe.mjs` ONCE to enumerate the FULL gap (entities, properties, reflists, dynamic CRUD, permissions, junction DTO typing), plan every domain + app-layer change together, and apply them in a **single rebuild + (double-)boot** — the scan-once-build-once path in [backend-restart.md](backend-restart.md). Serial discover→build→discover→build is the single biggest wall-clock sink. Two facts that otherwise cost a rebuild-to-discover: a `[ReferenceList]` attribute auto-creates its (empty) reflist on boot (seed items, don't duplicate), and its DB column needs the `Lkp` suffix ([frontend-conventions.md](../../../knowledge/frontend-conventions.md) — backend bootstrap [R-040]).

## 4. Metadata-availability gate (BLOCKING)

If none of the three routes return a 200 property array for a bound entity, you may NOT author or push ANY entity-bound or reflist-bound component. Surface the failing URLs + codes and STOP. "Couldn't validate metadata" is never "validated" — guessed `propertyName`s ship dead bindings silently.

With metadata in hand:
- Fetch `GetProperties?container=<fullClassName>` (string, never the object); cache to `.claude/cache/shesha-form-edit/metadata/<entity>.raw.json` (TTL 24 h; `--refresh-cache` overrides).
- **Validate every `propertyName`** you author against the property list (camelCase them — metadata returns PascalCase paths).
- Array properties with `listConfiguration.mappingType: "many-to-many"` are junction subtables → [junction-subtables.md](components/junction-subtables.md).
- Semantics (referenceListName without `RefList` prefix, short-class `entityType` + separate `entityModule`, FK naming): [api.md §10](api.md).

## 5. Reference-list identity — copied from metadata, never derived

Every `dropdown`/`radio`/`checkboxGroup`/`refListStatus` with `dataSourceType: "referenceList"` takes its `referenceListId.{module,name}` (or `refListStatus`'s `module`/`referenceListName`) **verbatim** from the bound property's `referenceListName`/`referenceListModule` in the metadata. Deriving `status` → `FlightBookingStatus` when the real list is `BookingStatus` renders a silently EMPTY dropdown that passes every structural check. Assert authored-vs-metadata equality (mechanically re-checked in Step 6's `validate-guardrails.js` when the metadata dump is passed). **Existence + items gate before push:** the reflist configuration item (`app/ConfigurationItem/GetCurrent?itemType=reference-list&name=…&module=…` — the route `resolve-bindings.js` uses; see [api.md §10.5](api.md)) must return the list with ≥1 item; a 404 or zero items is a blocking fail → `domain-model` seeds it.

## 6. After any domain change

The backend MUST be rebuilt and restarted before the entity is usable — the full runbook (Kestrel takeover, never relaunch IIS Express outside VS, the two-boot rule for new entities, post-restart form re-verification) is [backend-restart.md](backend-restart.md). Order: domain change → rebuild+restart(+2-boot) → poll `…/api/dynamic/<module>/<Entity>/Crud/GetAll` until 200 → only then author/push the form.

For a NEW entity-bound form or an unverified entity, `scripts/backend-probe.mjs` must report `ready: true` (exit 0) before authoring; a broken entity looks fine in markup and fails at runtime (optionally `Skill(shesha-developer:test-entity-crud-api, "--no-fix")` to diagnose).
