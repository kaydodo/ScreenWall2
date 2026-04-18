@echo off
REM ScreenWall clean shutdown

set "STOP=%TEMP%\sw_server.stop"
set "PIDFILE=%TEMP%\sw_watchdog.pid"

REM Write stop signal
echo. > "%STOP%"
echo Waiting for watchdog to exit...
timeout /t 5 /nobreak >nul

REM Kill watchdog by PID from file
if exist "%PIDFILE%" (
    set /p WD_PID=<"%PIDFILE%"
    taskkill /PID %WD_PID% /F >nul 2>&1
    del /f /q "%PIDFILE%"
)

REM Kill all node server.js
echo Killing node server.js...
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1

REM Cleanup
if exist "%STOP%" del /f /q "%STOP%"

echo Done.
timeout /t 2 /nobreak >nul
