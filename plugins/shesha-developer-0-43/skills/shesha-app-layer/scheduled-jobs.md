# Scheduled Jobs, Workflow Tasks, and PDF Controllers

## §1. Scheduled Job

**File:** `{JobName}Job.cs` in `Jobs/`

```csharp
using Abp.Dependency;
using Abp.Domain.Repositories;
using Abp.Domain.Uow;
using Shesha.Scheduler;
using Shesha.Scheduler.Attributes;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace {ModuleNamespace}.Application.Jobs
{
    [ScheduledJob("{new-guid-here}",
        startupMode: StartUpMode.Automatic,
        cronString: "0 0 * * *",
        description: "{Description}")]
    public class {JobName}Job : ScheduledJobBase, ITransientDependency
    {
        private readonly IRepository<{EntityName}, Guid> _{entityName}Repository;
        private readonly IUnitOfWorkManager _unitOfWorkManager;

        public {JobName}Job(
            IRepository<{EntityName}, Guid> {entityName}Repository,
            IUnitOfWorkManager unitOfWorkManager)
        {
            _{entityName}Repository = {entityName}Repository;
            _unitOfWorkManager = unitOfWorkManager;
        }

        public override async Task DoExecuteAsync(CancellationToken cancellationToken)
        {
            Log.Info("{JobName}Job: Started");

            using (var uow = _unitOfWorkManager.Begin())
            {
                try
                {
                    // Job logic here

                    await uow.CompleteAsync();
                    Log.Info("{JobName}Job: Completed successfully");
                }
                catch (Exception ex)
                {
                    Log.Error("{JobName}Job: Failed", ex);
                    throw;
                }
            }
        }
    }
}
```

**Key rules:**
- `[ScheduledJob]` with unique GUID, startup mode, cron string, description
- `StartUpMode.Automatic` for cron-scheduled, `StartUpMode.Manual` for on-demand
- Wrap work in `_unitOfWorkManager.Begin()` + `CompleteAsync()`
- Common cron: `"0 0 * * *"` (midnight), `"0 18 * * *"` (6 PM)

**Hangfire background job** (enqueued manually):

```csharp
public class {JobName}BackgroundJob : ITransientDependency
{
    private readonly IUnitOfWorkManager _unitOfWorkManager;

    public {JobName}BackgroundJob(IUnitOfWorkManager unitOfWorkManager)
    {
        _unitOfWorkManager = unitOfWorkManager;
    }

    public virtual async Task ExecuteAsync({InputDto} input)
    {
        using var uow = _unitOfWorkManager.Begin();
        try
        {
            // Job logic
            await uow.CompleteAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Hangfire Job] Failed: {ex.Message}");
            throw;
        }
    }
}

// Enqueue: BackgroundJob.Enqueue<{JobName}BackgroundJob>(job => job.ExecuteAsync(input));
```