@echo off
REM ============================================================================
REM Shesha Project - Quick API Endpoint Test
REM ============================================================================
REM Works with any Shesha-based project following standard conventions
REM Usage: test-api.cmd [--start-server] [--update-entities] [--full-errors]
REM ============================================================================

cd /d "%~dp0"

set PARAMS=

:parse_args
if "%1"=="" goto run
if "%1"=="--start-server" set PARAMS=%PARAMS% -StartServer
if "%1"=="--update-entities" set PARAMS=%PARAMS% -UpdateEntities
if "%1"=="--full-errors" set PARAMS=%PARAMS% -FullErrors
shift
goto parse_args

:run
powershell -ExecutionPolicy Bypass -File "Run-EndpointTests.ps1" %PARAMS%

if errorlevel 1 (
    echo.
    echo Press any key to exit...
    pause >nul
)
