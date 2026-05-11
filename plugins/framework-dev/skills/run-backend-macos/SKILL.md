---
name: run-backend-macos
description: Starts the Shesha backend (.NET) on Mac using Docker SQL Server and dotnet run. Use when the user wants to run, start, or launch the Shesha backend API server locally.
---

# Run Shesha Backend

Start the Shesha backend API server on Mac following the official setup guide.

## Prerequisites

Verify the following are available before proceeding:

| Tool | Check Command | Install |
|------|--------------|---------|
| .NET 8 SDK | `dotnet --version` | `brew install dotnet@8` |
| Docker | `docker --version` | Install Docker Desktop |

## Step-by-Step Process

### Step 1: Locate the Solution

Find the `.sln` file and the `Web.Host` project:

```
{repo-root}/Shesha.sln
{repo-root}/src/Shesha.Web.Host/
```

For standalone projects, look for:

```
backend/{SolutionName}.sln
backend/src/{Org}.{Project}.Web.Host/
```

### Step 2: Start SQL Server via Docker

Check if a SQL Server container already exists:

```bash
docker ps -a --filter "name=SQL_Server_Docker" --format "{{.Names}} {{.Status}}"
```

**If it exists but is stopped**, start it:

```bash
docker start SQL_Server_Docker
```

**If it does not exist**, create it:

```bash
docker pull --platform linux/amd64 mcr.microsoft.com/mssql/server:2022-latest
docker run --platform linux/amd64 -d \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=@123Shesha" \
  -p 1433:1433 \
  --name SQL_Server_Docker \
  mcr.microsoft.com/mssql/server:2022-latest
```

**Default credentials:** `sa` / `@123Shesha`

### Step 3: Verify Database Exists

Check that a user database exists in SQL Server:

```bash
docker exec SQL_Server_Docker /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P '@123Shesha' -C \
  -Q "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb');"
```

If the target database does not exist, the user must import a `.bacpac` starter database:

```bash
sqlpackage /Action:Import \
  /SourceFile:"./path/to/file.bacpac" \
  /TargetConnectionString:"Server=localhost,1433;Initial Catalog={DatabaseName};Persist Security Info=False;User ID=sa;Password=@123Shesha;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=True;Connection Timeout=30;"
```

### Step 4: Configure Connection String

Update `appsettings.json` in the `Web.Host` project with the SQL Server connection string:

```json
{
  "ConnectionStrings": {
    "Default": "Server=localhost,1433;Initial Catalog={DatabaseName};Persist Security Info=False;User ID=sa;Password=@123Shesha;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=True;Connection Timeout=30;"
  },
  "App": {
    "ServerRootAddress": "http://localhost:21021",
    "CorsOrigins": "http://localhost:3000,http://localhost:3001"
  }
}
```

**Key rules:**
- Do NOT change `DbmsType` to PostgreSQL -- the Shesha framework migrations for initial schema creation are SQL Server only (`MsSqlOnly` tagged)
- Keep the existing `Authentication` and other settings unchanged
- Only update `ConnectionStrings.Default`, `App.ServerRootAddress`, and `App.CorsOrigins`

### Step 5: Build and Run

```bash
dotnet restore {SolutionFile}.sln
dotnet build --no-restore
dotnet run --project src/{WebHostProject} --no-build --urls "http://localhost:21021"
```

For the framework repo specifically:

```bash
dotnet restore Shesha.sln
dotnet build --no-restore
dotnet run --project src/Shesha.Web.Host --no-build --urls "http://localhost:21021"
```

### Step 6: Verify

The backend is ready when the log shows:

```
Now listening on: http://localhost:21021
Application started. Press Ctrl+C to shut down.
```

Swagger UI is available at: `http://localhost:21021/swagger`

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `citext does not exist` | Using PostgreSQL without extensions | Use SQL Server instead (Mac setup requires it) |
| `relation "Frwk_ConfigurationItems" does not exist` | Using PostgreSQL -- base schema migrations are `MsSqlOnly` | Use SQL Server instead |
| `Login failed for user 'sa'` | SQL Server container not running or wrong password | `docker start SQL_Server_Docker` |
| `Cannot connect to localhost:1433` | Docker not running or port conflict | Check `docker ps` and ensure port 1433 is free |
| Launch profile warning | No Kestrel profile in `launchSettings.json` | Pass `--urls` flag to `dotnet run` |

Now start the backend based on: $ARGUMENTS
