@echo off
REM Alist Watchdog Launcher
REM Copy this file to D:\alist directory

cd /d "D:\alist"

echo Starting Alist watchdog...
echo Log: %TEMP%\alist_watchdog.log

powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "watchdog.ps1"

exit