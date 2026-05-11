# Event Artifacts

## §1. Event Data Class

**File:** `{EventName}EventData.cs` in `Events/`

```csharp
using Abp.Events.Bus;
using System;

namespace {ModuleNamespace}.Domain.Events
{
    /// <summary>
    /// Triggered when {description of what happened}.
    /// </summary>
    public class {EventName}EventData : EventData
    {
        public Guid {EntityName}Id { get; set; }

        // Add properties needed by handlers:
        // public string Reason { get; set; }
        // public Guid? TriggeredByUserId { get; set; }

        public {EventName}EventData(Guid {entityName}Id)
        {
            {EntityName}Id = {entityName}Id;
        }
    }
}
```

**Key rules:**
- Inherit from `Abp.Events.Bus.EventData` (provides `EventSource` and `EventTime` automatically).
- Include only the data handlers need — typically entity IDs and key context values.
- Name convention: `{What happened}EventData` (e.g., `TaskCompletedEventData`, `LeaveApprovedEventData`, `OrderCancelledEventData`).
- Keep event data immutable where practical — use constructor parameters for required fields.

**Event hierarchy pattern** — share a base class when multiple events relate to the same entity:

```csharp
public class TaskEventData : EventData
{
    public Guid TaskId { get; set; }
    public TaskEventData(Guid taskId) { TaskId = taskId; }
}

public class TaskCompletedEventData : TaskEventData
{
    public Guid CompletedByUserId { get; set; }
    public TaskCompletedEventData(Guid taskId, Guid completedByUserId) : base(taskId)
    {
        CompletedByUserId = completedByUserId;
    }
}

public class TaskCancelledEventData : TaskEventData
{
    public string Reason { get; set; }
    public TaskCancelledEventData(Guid taskId, string reason) : base(taskId)
    {
        Reason = reason;
    }
}
```

Handlers can then register for `TaskEventData` to handle all task events, or for a specific subclass.

---

## §2. Event Handler

**File:** `{HandlerName}.cs` in `EventHandlers/` (application layer) or `Events/` (domain layer)

### Sync handler

```csharp
using Abp.Dependency;
using Abp.Events.Bus.Handlers;
using {ModuleNamespace}.Domain.Events;

namespace {ModuleNamespace}.Application.EventHandlers
{
    public class {HandlerName} : IEventHandler<{EventName}EventData>, ITransientDependency
    {
        public void HandleEvent({EventName}EventData eventData)
        {
            // Handle the event
        }
    }
}
```

### Async handler

```csharp
using Abp.Dependency;
using Abp.Events.Bus.Handlers;
using Abp.Domain.Repositories;
using {ModuleNamespace}.Domain.Events;
using System;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Application.EventHandlers
{
    public class {HandlerName} : IAsyncEventHandler<{EventName}EventData>, ITransientDependency
    {
        private readonly IRepository<{Entity}, Guid> _{entity}Repository;

        public {HandlerName}(IRepository<{Entity}, Guid> {entity}Repository)
        {
            _{entity}Repository = {entity}Repository;
        }

        public async Task HandleEventAsync({EventName}EventData eventData)
        {
            var entity = await _{entity}Repository.GetAsync(eventData.{EntityName}Id);
            // Handle the event
        }
    }
}
```

### Multi-event handler

```csharp
public class ActivityLogger :
    IEventHandler<TaskCompletedEventData>,
    IEventHandler<TaskCancelledEventData>,
    ITransientDependency
{
    public void HandleEvent(TaskCompletedEventData eventData)
    {
        // Log completion
    }

    public void HandleEvent(TaskCancelledEventData eventData)
    {
        // Log cancellation
    }
}
```

**Key rules:**
- Always implement `ITransientDependency` — this enables automatic registration with the event bus.
- Use constructor injection for dependencies (repositories, services).
- Prefer `IAsyncEventHandler<T>` when the handler does async work (DB queries, API calls).
- Handler placement:
  - **Domain layer** (`Events/`): When the handler enforces domain invariants or updates domain state.
  - **Application layer** (`EventHandlers/`): When the handler does cross-cutting work (logging, notifications, external integrations).
- Exception behavior: If one handler throws, other handlers still execute. Multiple exceptions become an `AggregateException`.

---

## §3. Event Triggering (in service)

**Pattern:** Add `IEventBus` via property injection to any service, then call `Trigger()` or `TriggerAsync()`.

```csharp
using Abp.Events.Bus;
using Abp.Domain.Repositories;
using Shesha;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Threading.Tasks;
using {ModuleNamespace}.Domain.Events;

namespace {ModuleNamespace}.Application.Services.{EntityNamePlural}
{
    public class {EntityName}AppService : SheshaAppServiceBase
    {
        private readonly IRepository<{EntityName}, Guid> _{entityName}Repository;

        // Property injection with NullEventBus fallback
        public IEventBus EventBus { get; set; }

        public {EntityName}AppService(IRepository<{EntityName}, Guid> {entityName}Repository)
        {
            _{entityName}Repository = {entityName}Repository;
            EventBus = NullEventBus.Instance;
        }

        [HttpPost]
        public async Task CompleteAsync(Guid id)
        {
            var entity = await _{entityName}Repository.GetAsync(id);

            // Perform the domain operation
            entity.Status = RefListStatus.Completed;

            // Trigger the event after the state change
            EventBus.Trigger(new {EventName}EventData(entity.Id));
        }
    }
}
```

**Triggering from domain services:**

```csharp
using Abp.Domain.Services;
using Abp.Events.Bus;

namespace {ModuleNamespace}.Domain.DomainServices
{
    public class {EntityName}Manager : DomainService
    {
        public IEventBus EventBus { get; set; }

        public {EntityName}Manager()
        {
            EventBus = NullEventBus.Instance;
        }

        public void Complete({EntityName} entity)
        {
            entity.Status = RefListStatus.Completed;
            EventBus.Trigger(new {EventName}EventData(entity.Id));
        }
    }
}
```

**Key rules:**
- Always use property injection for `IEventBus` with `NullEventBus.Instance` default.
- Trigger events **after** the state change, not before.
- `Trigger()` is synchronous — handlers run inline in the same transaction by default.
- Use `TriggerAsync()` when handlers are async.
- Trigger overloads:
  - `EventBus.Trigger(eventData)` — basic
  - `EventBus.Trigger(this, eventData)` — sets `EventSource` to the triggering object
  - `EventBus.Trigger(typeof(TEvent), this, eventData)` — non-generic version

---

## §4. Entity Change Event Handler

**File:** `{HandlerName}.cs` in `EventHandlers/`

These handle ABP's **automatically triggered** entity change events — no manual `Trigger()` call needed.

### React after entity creation

> **IMPORTANT:** `*ed` events fire **after** the UoW/NHibernate session closes.
> You MUST create a new UoW for any DB work, and re-load entities within it.
> Do NOT pass `eventData.Entity` into new DB operations — it is detached from the closed session.

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Abp.Domain.Uow;
using Abp.Events.Bus.Entities;
using Abp.Events.Bus.Handlers;
using System;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Application.EventHandlers
{
    public class {EntityName}CreatedHandler : IAsyncEventHandler<EntityCreatedEventData<{EntityName}>>, ITransientDependency
    {
        private readonly IRepository<{EntityName}, Guid> _{entityName}Repository;
        private readonly IUnitOfWorkManager _unitOfWorkManager;

        public {EntityName}CreatedHandler(
            IRepository<{EntityName}, Guid> {entityName}Repository,
            IUnitOfWorkManager unitOfWorkManager)
        {
            _{entityName}Repository = {entityName}Repository;
            _unitOfWorkManager = unitOfWorkManager;
        }

        public async Task HandleEventAsync(EntityCreatedEventData<{EntityName}> eventData)
        {
            // Capture primitive values from the detached entity — safe to read
            var entityId = eventData.Entity.Id;

            // Create a new UoW to get an active NHibernate session
            using var uow = _unitOfWorkManager.Begin();

            // Re-load the entity within this session for any DB operations
            var entity = await _{entityName}Repository.GetAsync(entityId);

            // React to creation — e.g., send welcome notification, create related records

            await uow.CompleteAsync();
        }
    }
}
```

### Validate before update (rollback on failure)

```csharp
using Abp.Dependency;
using Abp.Events.Bus.Entities;
using Abp.Events.Bus.Handlers;
using Abp.UI;

namespace {ModuleNamespace}.Application.EventHandlers
{
    public class {EntityName}UpdatingValidator : IEventHandler<EntityUpdatingEventData<{EntityName}>>, ITransientDependency
    {
        public void HandleEvent(EntityUpdatingEventData<{EntityName}> eventData)
        {
            var entity = eventData.Entity;

            // Throw to prevent the update and rollback the transaction
            if (entity.Status == RefListStatus.Locked)
                throw new UserFriendlyException("Cannot modify a locked record.");
        }
    }
}
```

### React to deletion

```csharp
using Abp.Dependency;
using Abp.Domain.Uow;
using Abp.Events.Bus.Entities;
using Abp.Events.Bus.Handlers;
using System;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Application.EventHandlers
{
    public class {EntityName}DeletedHandler : IAsyncEventHandler<EntityDeletedEventData<{EntityName}>>, ITransientDependency
    {
        private readonly IUnitOfWorkManager _unitOfWorkManager;

        public {EntityName}DeletedHandler(IUnitOfWorkManager unitOfWorkManager)
        {
            _unitOfWorkManager = unitOfWorkManager;
        }

        public async Task HandleEventAsync(EntityDeletedEventData<{EntityName}> eventData)
        {
            var entityId = eventData.Entity.Id;

            using var uow = _unitOfWorkManager.Begin();
            // Clean up related resources, notify external systems, etc.
            await uow.CompleteAsync();
        }
    }
}
```

**Key rules:**
- Entity change events are in namespace `Abp.Events.Bus.Entities`.
- `*ing` handlers (EntityCreating, EntityUpdating, EntityDeleting) run **before** transaction commit — throw to rollback. The NHibernate session is active, so `eventData.Entity` works directly.
- `*ed` handlers (EntityCreated, EntityUpdated, EntityDeleted) run **after** transaction commit — cannot rollback. **The NHibernate session is CLOSED.**
- **For `*ed` handlers:** Do NOT use `eventData.Entity` for DB operations — it is detached. Capture its ID/primitive values, create a new UoW with `_unitOfWorkManager.Begin()`, and re-load entities within the new session.
- **For `*ing` handlers:** The `eventData.Entity` property gives you the entity instance directly — no need to re-fetch from the repository.
- Inheritance works: handling `EntityCreatedEventData<Person>` also fires for `Student : Person`.
- These fire automatically for any entity persisted via NHibernate — no opt-in required.

---

## §5. Background Event Queuing

**Pattern:** Queue an event to be triggered asynchronously via ABP's background job system.

```csharp
using Abp.BackgroundJobs;
using Abp.Events.Bus;
using Shesha;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Threading.Tasks;
using {ModuleNamespace}.Domain.Events;

namespace {ModuleNamespace}.Application.Services.{EntityNamePlural}
{
    public class {EntityName}AppService : SheshaAppServiceBase
    {
        private readonly IBackgroundJobManager _backgroundJobManager;

        public IEventBus EventBus { get; set; }

        public {EntityName}AppService(IBackgroundJobManager backgroundJobManager)
        {
            _backgroundJobManager = backgroundJobManager;
            EventBus = NullEventBus.Instance;
        }

        [HttpPost]
        public async Task ProcessAsync(Guid id)
        {
            // Queue the event for background processing
            await _backgroundJobManager.EnqueueEventAsync(new HeavyProcessingEventData(id));
        }
    }
}
```

**Key rules:**
- Use background queuing when handlers are expensive (external API calls, report generation, bulk operations).
- The event fires when the background job executes, NOT immediately.
- The handler runs outside the original HTTP request context — `IAbpSession` values may differ.
- Event data must be serializable since it's persisted to the job queue.
- Combine with regular `Trigger()` when you need both immediate and deferred reactions to the same event.
