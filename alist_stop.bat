@echo off
REM Alist Stop Script
REM Stops alist process and watchdog

echo Stopping Alist...

REM Kill alist process
taskkill /IM "alist.exe" /F >nul 2>&1

REM Kill hidden PowerShell watchdog processes
powershell -Command "Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo Alist stopped.
pause