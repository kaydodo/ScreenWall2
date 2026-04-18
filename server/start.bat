@echo off
REM ScreenWall launcher - exits immediately, PowerShell watchdog runs invisible

set "LOG=%TEMP%\sw_server_watchdog.log"
set "WD=%~dp0watchdog.ps1"

echo ========================================= >> "%LOG%"
echo [%date% %time%] launcher start >> "%LOG%"

powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%WD%"

exit
