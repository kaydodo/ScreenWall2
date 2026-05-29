@echo off
REM Force stop ALL Alist processes (including old watchdog without PID file)

echo Force stopping ALL Alist related processes...

REM Kill ALL hidden PowerShell processes (watchdogs)
powershell -Command "Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue"

REM Kill alist process
taskkill /IM "alist.exe" /F >nul 2>&1

REM Cleanup temp files
del /f /q "%TEMP%\alist_watchdog.pid" >nul 2>&1
del /f /q "%TEMP%\alist.stop" >nul 2>&1
del /f /q "%TEMP%\alist_watchdog.log" >nul 2>&1

echo Done. ALL processes killed.
pause