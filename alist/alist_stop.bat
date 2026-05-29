@echo off
REM Alist Stop Script - uses PID file, no conflict with other watchdogs

set "STOP=%TEMP%\alist.stop"
set "PIDFILE=%TEMP%\alist_watchdog.pid"

echo Stopping Alist watchdog...

REM Write stop signal
echo. > "%STOP%"
echo Waiting for watchdog to exit...
timeout /t 3 /nobreak >nul

REM Kill watchdog by PID from file
if exist "%PIDFILE%" (
    set /p WD_PID=<"%PIDFILE%"
    taskkill /PID %WD_PID% /F >nul 2>&1
    del /f /q "%PIDFILE%"
)

REM Kill alist process
echo Killing alist.exe...
taskkill /IM "alist.exe" /F >nul 2>&1

REM Cleanup
if exist "%STOP%" del /f /q "%STOP%"

echo Done.
timeout /t 2 /nobreak >nul