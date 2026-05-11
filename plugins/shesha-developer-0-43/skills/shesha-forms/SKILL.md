---
name: shesha-forms
description: Creates and modifies Shesha UI form configurations using the Shesha MCP server. Use when the user asks to create, update, design, or modify configuration-based forms, form views, table views, or form layouts in a Shesha application.
allowed-tools:
  - Bash(claude mcp *)
  - Bash(dotnet *)
  - Bash(powershell *)
  - Bash(curl *)
  - Read
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# Shesha Forms

Create and modify Shesha UI form configurations via the Shesha MCP server.

Arguments received: `$ARGUMENTS`

## Instructions

### Step 1: Verify Shesha MCP is Available

Check if the Shesha MCP server is connected by looking for MCP tools with names containing `shesha` (e.g., `shesha:create_form`, `shesha:update_form`, or similar).

#### If Shesha MCP is NOT available

Notify the user and stop:

> **The Shesha MCP server is not connected.** To install it:
>
> 1. Make sure `SheshaMCP.exe` is available and running locally (it serves on `http://localhost:8000/sse`).
> 2. Remove any old configuration:
>    ```
>    claude mcp remove shesha -s local
>    ```
> 3. Add the MCP server (replace `{port}` with your backend port and `{DBName}` with your database name):
>    ```
>    claude mcp add shesha -s local --transport sse http://localhost:8000/sse -H "backend_url: http://localhost:{port}" -H "backend_username: admin" -H "backend_password: 123qwe" -H "db_server: ." -H "db_database: {DBName}"
>    ```
> 4. Restart your Claude Code session so the MCP tools become available.

**Do NOT proceed** to form creation until the MCP is connected.

### Step 2: Verify Backend is Running

Before invoking any MCP form tools, confirm the backend server is reachable.

1. **Detect the backend URL.** Check these sources in order:
   - `appsettings.json` — look for `Kestrel:Endpoints:Http:Url` or similar
   - `Properties/launchSettings.json` — look for `applicationUrl` in the `Project` profile
   - Fall back to `http://localhost:21021`

2. **Ping the backend:**
   ```powershell
   try { Invoke-WebRequest -Uri "{BackendUrl}/api/services/app/Session/GetCurrentLoginInformations" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null; Write-Host "Backend is running" } catch { Write-Host "Backend is NOT reachable" }
   ```

3. **If the backend is not reachable**, notify the user and stop:
   > The backend server at `{BackendUrl}` is not responding. Please start it before creating forms.

### Step 3: Invoke the MCP Form Tools

**CRITICAL: Pass the user's requirements exactly as provided.** Do not embellish, rephrase, interpret, or add detail to what the user asked for. The MCP tool understands Shesha form conventions and will interpret the requirements correctly.

- **To create a new form:** Use the MCP `create_form` tool (or equivalent), passing the user's description/requirements verbatim.
- **To update an existing form:** Use the MCP `update_form` tool (or equivalent), passing the user's change request verbatim.

#### What NOT to do

- Do not invent field lists, layout structures, or component types unless the user explicitly specified them.
- Do not expand a request like "create a details form for Person" into a detailed specification of every field — just pass "create a details form for Person" to the MCP tool.
- Do not second-guess or override what the MCP tool returns.

### Step 4: Report Results

After the MCP tool completes:

1. Summarize what was created or modified (form name, module, entity type).
2. If the MCP tool returned warnings or errors, present them to the user.
3. If the user asked for multiple forms (e.g., table + create + details), invoke the MCP tool for each one sequentially.
4. **For each successfully created or updated form**, call the MCP `getTestUrl` tool (or equivalent) to retrieve a test URL and present it to the user so they can preview the form in their browser.
