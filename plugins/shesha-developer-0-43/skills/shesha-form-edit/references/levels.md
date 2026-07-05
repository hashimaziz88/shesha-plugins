# Scaling the effort (routing thresholds)

> The full capability-level (L1–L5) taxonomy was removed in favour of the short rule in SKILL.md
> **Step R**. This file remains only as the routing-threshold reference that
> `bulk-operations.md` and `orchestration.md` link to.

Scale process weight to the request, and **default down** when unsure:

- **Small edit** (one component/prop/script on an existing form) → inline, minimal steps, no agents, no full pipeline.
- **One whole form** → inline, full Steps 0–10, seed-first.
- **Backend prereqs may be missing** → gate on Step 4.5 / the `fullstack-prereq-checker` agent; fix via the owning sibling skill before writing form JSON.
- **Many linked forms / a whole app** → don't build it all in one context. Plan, then build in waves and orchestrate with `superpowers:dispatching-parallel-agents`. State the rough cost first.

**Threshold for fleet/agent mode:** more than ~3 forms changed, or a multi-page/app brief. Below that, stay inline. Dispatch mechanics: [orchestration.md](orchestration.md). Bulk-edit mechanics: [bulk-operations.md](bulk-operations.md).

**Route OUT non-form work** — reference lists, roles, notifications, background jobs, APIs go to the sibling skill directly, not wrapped in form workflow.
