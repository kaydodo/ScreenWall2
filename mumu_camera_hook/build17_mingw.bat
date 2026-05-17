@echo off
echo MuMu Camera Hook v17 - MinGW Build Script
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

echo Compiling injector17.exe...
g++ -O2 -o injector17.exe injector.cpp -lpsapi
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector17.exe
    pause
    exit /b 1
)

echo Compiling camera_hook17.dll...
g++ -O2 -shared -o camera_hook17.dll camera_hook17.cpp -static -luser32 -ladvapi32 -lole32
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook17.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
echo Files created:
dir /b injector17.exe camera_hook17.dll 2>nul
echo.
echo Usage:
echo   1. Make sure MuMu is running
echo   2. Run injector17.exe
echo   3. Open camera in MuMu
echo   4. Check D:\mumu_camera_hook.log
echo.
pause
