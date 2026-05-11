---
name: shesha-domain-events
description: Implements domain events and event handling in Shesha/.NET/ABP applications. Creates event data classes, event handlers, and integrates event triggering into services and entities. Covers custom domain events, predefined entity change events (EntityCreated, EntityUpdated, EntityDeleted), and background event queuing. Use when the user asks to create, implement, or wire up domain events, event handlers, event listeners, or event-driven logic in a Shesha project. Also use when the user wants to react to entity changes, decouple business logic via events, or trigger side effects (audit trails, sync, cascading updates) when domain state changes. ALSO USE when the user describes automatic behavior that should happen "when" or "whenever" an entity is created, updated, saved, or deleted — even if they don't mention events explicitly. Common trigger phrases include: "when [entity] is created", "whenever [entity] gets updated", "after [entity] is saved", "automatically [do something] on create/update", "assign [something] when [entity] changes", "sync [related data] when [entity] is modified", "log/track/notify when [entity] is [action]". If the requirement describes a side effect or reaction to an entity lifecycle change, this skill applies.
---

# Shesha Domain Events

Generate event-driven artifacts for a Shesha/.NET/ABP/NHibernate application based on $ARGUMENTS.

## Instructions

- Inspect nearby files to determine the correct namespace root and module name.
- All entity properties must be `virtual` (NHibernate requirement).
- Use property injection for `IEventBus` with `NullEventBus.Instance` fallback — never constructor-inject it.
- Event handlers must implement `ITransientDependency` for automatic registration.
- Place files according to the folder structure below.

## Artifact catalog

| # | Artifact | Layer | Template |
|---|----------|-------|----------|
| 1 | Event Data Class | Domain | [reference/event-artifacts.md](reference/event-artifacts.md) §1 |
| 2 | Event Handler | Domain or Application | [reference/event-artifacts.md](reference/event-artifacts.md) §2 |
| 3 | Event Triggering (in service) | Application | [reference/event-artifacts.md](reference/event-artifacts.md) §3 |
| 4 | Entity Change Event Handler | Domain or Application | [reference/event-artifacts.md](reference/event-artifacts.md) §4 |
| 5 | Background Event Queuing | Application | [reference/event-artifacts.md](reference/event-artifacts.md) §5 |

## Folder structure

```
{ModuleName}.Domain/
  Events/
    {EventName}EventData.cs

{ModuleName}.Application/
  EventHandlers/
    {HandlerName}.cs
```

For small modules with few events, handlers may live alongside the service that defines the domain area (e.g., `Services/{EntityNamePlural}/`) rather than in a separate `EventHandlers/` folder.

## Quick reference

### IEventBus injection pattern

```csharp
public IEventBus EventBus { get; set; }

public MyService()
{
    EventBus = NullEventBus.Instance;
}
```

**Why property injection?** Allows the class to work without the event bus (NullEventBus does nothing). Easier to test — no constructor dependency to mock if events aren't relevant to the test.

### Predefined entity change events

ABP automatically triggers these when entities are inserted, updated, or deleted — no manual `Trigger()` needed:

| Event Class | When Fired | Transaction State |
|-------------|-----------|-------------------|
| `EntityCreatingEventData<T>` | Before insert committed | Can rollback |
| `EntityCreatedEventData<T>` | After insert committed | Cannot rollback |
| `EntityUpdatingEventData<T>` | Before update committed | Can rollback |
| `EntityUpdatedEventData<T>` | After update committed | Cannot rollback |
| `EntityDeletingEventData<T>` | Before delete committed | Can rollback |
| `EntityDeletedEventData<T>` | After delete committed | Cannot rollback |
| `EntityChangingEventData<T>` | Before any change committed | Can rollback |
| `EntityChangedEventData<T>` | After any change committed | Cannot rollback |

**Key rules:**
- `*ing` events fire before the transaction commits — throw an exception to rollback. The NHibernate session is still active, so `eventData.Entity` can be used directly.
- `*ed` events fire after commit — use for side effects (notifications, audit, sync). **The NHibernate session is CLOSED** — see "Session gotchas" below.
- Entity change events support inheritance: registering for `EntityCreatedEventData<Person>` also fires for `Student` if `Student : Person`.

### Session gotchas for `*ed` event handlers

**CRITICAL:** `*ed` events (`EntityCreated`, `EntityUpdated`, `EntityDeleted`) fire **after the UoW completes**, so there is **no active NHibernate session**. Any repository call or lazy-loaded property access will throw `NullReferenceException` or "No session" errors.

**Rules for `*ed` handlers:**
1. **Capture primitive values** (IDs, enums, strings) from `eventData.Entity` immediately — these are safe.
2. **Create a new UoW** with `_unitOfWorkManager.Begin()` for any DB operations.
3. **Re-load entities** within the new UoW using repositories — do NOT pass `eventData.Entity` to new DB operations, as it is detached from the closed session and will cause "Illegal attempt to associate a collection with two open sessions" errors.
4. **Call `uow.CompleteAsync()`** to commit changes before the `using` block ends.

```csharp
// CORRECT pattern for *ed handlers:
public async Task HandleEventAsync(EntityUpdatedEventData<MyEntity> eventData)
{
    var entityId = eventData.Entity.Id;           // Safe — just a Guid
    var status = eventData.Entity.Status;          // Safe — just an enum value

    using var uow = _unitOfWorkManager.Begin();
    var freshEntity = await _repository.GetAsync(entityId);  // Load in new session
    // ... do work with freshEntity ...
    await uow.CompleteAsync();
}

// WRONG — will throw NullReferenceException or session errors:
public async Task HandleEventAsync(EntityUpdatedEventData<MyEntity> eventData)
{
    var items = await _otherRepo.GetAll()          // No session!
        .Where(x => x.ParentId == eventData.Entity.Id)
        .ToListAsync();
}
```

**`*ing` handlers** (`EntityCreating`, `EntityUpdating`, `EntityDeleting`) do NOT need this — the session is still active.

### Handler registration

Handlers are registered **automatically** when they:
1. Implement `IEventHandler<TEventData>` (sync) or `IAsyncEventHandler<TEventData>` (async)
2. Are registered with DI (implement `ITransientDependency`)

No manual registration or module wiring needed.

### Common use cases

| Use Case | Example Request | Approach |
|----------|----------------|----------|
| React to entity CRUD | "Do X when entity is created/updated" | Handle `EntityCreatedEventData<T>` etc. — no custom event needed |
| Sync related data on save | "Assign a role when employee is created or updated" | Handle `EntityCreatedEventData<T>` + `EntityUpdatedEventData<T>` |
| Auto-create child records | "Create a verification record when a contact is created" | Handle `EntityCreatedEventData<T>` |
| Cascade status changes | "When parent status changes, update all children" | Handle `EntityUpdatedEventData<T>`, check property value |
| Custom business event | "Trigger approval workflow when loan is submitted" | Define `EventData` subclass → trigger via `IEventBus` → handle |
| Decouple cross-cutting concerns | "Send notification when case is assigned" | Handler in separate class, same or different module |
| Async/background processing | "Generate report after batch import completes" | Queue via `IBackgroundJobManager.EnqueueEventAsync()` |
| Validate/prevent changes | "Prevent editing a locked record" | Handle `*ing` event, throw exception to rollback |

Now generate the requested artifact(s) based on: $ARGUMENTS
