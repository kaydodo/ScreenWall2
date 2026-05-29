@echo off
REM Alist stop script

set "LOG=%TEMP%\alist_watchdog.log"
set "STOPFILE=%TEMP%\alist.stop"
set "PIDFILE=%TEMP%\alist_watchdog.pid"

echo ========================================= >> "%LOG%"
echo [%date% %time%] stop signal sent >> "%LOG%"

echo stop > "%STOPFILE%"

if exist "%PIDFILE%" (
    set /p WDPID=<"%PIDFILE%"
    taskkill /PID %WDPID% /F >nul 2>&1
    del "%PIDFILE%" >nul 2>&1
)

taskkill /IM "alist.exe" /F >nul 2>&1

del "%STOPFILE%" >nul 2>&1

echo [%date% %time%] stopped >> "%LOG%"
echo Alist stopped.