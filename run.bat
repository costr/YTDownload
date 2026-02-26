@echo off
setlocal
cd /d "%~dp0"

echo Checking PowerShell execution policy...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Unblock-File '.\start.ps1'; .\start.ps1}"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] The script failed to start.
    pause
)
