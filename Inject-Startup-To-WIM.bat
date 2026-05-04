@echo off
setlocal enabledelayedexpansion

set "MOUNT_DIR=D:\666"
set "STARTUP_DIR=%MOUNT_DIR%\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
set "SCRIPT_NAME=ScanWall2Startup.bat"
set "SCRIPT_SOURCE=D:\ScreenWall2\%SCRIPT_NAME%"

echo ==========================================
echo Inject Startup Script to WIM
echo Mount Dir: %MOUNT_DIR%
echo ==========================================
echo.

if not exist "%MOUNT_DIR%\Windows" (
    echo ERROR: Windows directory not found
    pause
    exit /b 1
)

if not exist "%SCRIPT_SOURCE%" (
    echo ERROR: Source script not found: %SCRIPT_SOURCE%
    pause
    exit /b 1
)

echo [1/2] Creating Startup directory...
mkdir "%STARTUP_DIR%" 2>nul
echo Done
echo.

echo [2/2] Copying script to Startup...
copy /Y "%SCRIPT_SOURCE%" "%STARTUP_DIR%\%SCRIPT_NAME%" >nul
echo Done
echo.

echo ==========================================
echo Inject Complete!
echo File: %STARTUP_DIR%\%SCRIPT_NAME%
echo.
echo Unmount WIM: dism /Unmount-Wim /MountDir:"%MOUNT_DIR%" /Commit
echo ==========================================
pause
