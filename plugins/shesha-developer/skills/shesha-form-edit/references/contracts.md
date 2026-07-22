# Session contracts — the cross-skill rules, stated once

The canonical home for the rules every skill and dispatched agent in the designer pipeline must obey. Other files say "per [contracts.md]" — this file carries the detail.

## 1. Pinned shell + tool

Pick ONE shell per session and stick to it: **on Windows run every command through the PowerShell tool, never the Bash tool** (a PowerShell one-liner in the Bash tool fails with `=: command not found`, exit 127); bash elsewhere. Every dispatched agent is HANDED the pinned shell/tool in its brief — an agent that re-picks a shell re-breaks quoting.

## 2. Auth once, cache BOM-free, never inline the JWT

- Authenticate ONCE per session: `POST $BASE_URL/api/TokenAuth/Authenticate` (`admin`/`123qwe` local-dev default; task-supplied credentials always win). Re-auth only on 401 or after the 24 h TTL.
- Cache the token to **one session file** — the `<workdir>/access-token` the orchestrator supplies, else `$env:TEMP/shesha-form-edit/access-token` — and read it back on every call (`$(cat <tokenfile>)` / `(Get-Content <tokenfile> -Raw).Trim()`).
- **Write it BOM-free** — `Out-File`/`Set-Content -Encoding utf8` emit a BOM that poisons the header (`Authorization: Bearer ﻿eyJ…` → *Invalid user name or password*) and breaks Node `JSON.parse`. Write via Node `fs.writeFileSync`, or `[System.IO.File]::WriteAllText(path, s, (New-Object System.Text.UTF8Encoding $false))`; trim on read (bash: `sed 's/^\xEF\xBB\xBF//'`).
- **Never paste the raw JWT into a command** — it echoes back into context on every result.
- Non-ASCII request bodies from PowerShell: send UTF-8 **bytes** (`[System.Text.Encoding]::UTF8.GetBytes($json)` or `curl --data-binary @file`) — em dashes/curly quotes in a text body trigger a server 500 code-page error.

## 3. Scratch under $WORKDIR, never the project tree

All scratch — build/push scripts, staged markup, probe dumps — goes in the session `$WORKDIR` (the orchestrator's `<workdir>`, else `$env:TEMP/shesha-form-edit/`). **Never** the user's project directory or cwd (litter erodes trust), and **never `/tmp`** (git-bash `/tmp` ≠ PowerShell `$env:TEMP` ≠ `C:\tmp` — files written in one shell are "not found" by the next). Pass values into Node via **env vars**, not positional argv. Prefer one combined fetch→mutate→push script over many small probe commands — each round-trip is paid context.

## 4. Dispatch contract — agents return markup, they never push and never style

A dispatched authoring agent (`form-author`, a comprehension agent, any ad-hoc builder):
- **returns markup ONLY** — it never calls Create/UpdateMarkup/ImportJson, never publishes, never clears caches;
- **never styles** — appearance is authored solely by `Skill(shesha-developer:shesha-design-system)`; an authoring agent hand-editing v7 style blocks bypasses token discipline and version-gating;
- receives in its brief: the pinned shell/tool (§1), `$WORKDIR` + token-file path (§2–3), its input (blueprint/seed/metadata summary), and this contract restated in one line.

## 5. One gated push path

ALL writes to the backend go through the `shesha-form-edit` push step, and every push is preceded by the full gate chain (`validate-schema.js` → `validate-guardrails.js` with the metadata arg → `resolve-bindings.js` → `validate-styledness.js`) — blocking, zero `fail` findings. A versioned foreign backend is a handoff, not an adaptation ([versioning.md](versioning.md)). If a form reached the backend without this gate, the gate did not run — that is a defect, not a shortcut.

## 6. Cost discipline

One auth, one metadata fetch per entity (scoped + distilled), one confirmation gate per run, at most ONE final screenshot per screen, no scripted browser wait over 20 s, fix loops capped at 2 cycles (details: [verification.md](verification.md)). Repeating any of these per screen is the main avoidable cost of a multi-screen run.
