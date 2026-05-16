@echo off
echo MuMu Camera Hook - MinGW Build Script
echo.

where g++ >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: MinGW g++ not found in PATH
    echo.
    echo Please install MinGW-w64:
    echo   1. Download from https://www.mingw-w64.org/
    echo   2. Or use: choco install mingw
    echo   3. Or use: scoop install mingw
    echo.
    pause
    exit /b 1
)

echo Found g++ compiler
echo.

echo Compiling injector.exe...
g++ -O2 -o injector.exe injector.cpp -lpsapi
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector.exe
    pause
    exit /b 1
)

echo Compiling camera_hook.dll...
g++ -O2 -shared -o camera_hook.dll camera_hook.cpp -static -luser32 -lshell32
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
echo Files created:
dir /b injector.exe camera_hook.dll 2>nul
echo.
echo camera_config.txt - Edit this to change camera name
echo.
pause
